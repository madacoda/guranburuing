// src/engines/universal-workflow.engine.ts
import { Page, HTTPResponse } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { AlertRelay } from '../alert-relay.js';
import { DropLogger } from './drop-logger.js';
import { discordPresence } from '../relay/discord-presence.js';
import { ProSkipEngine } from './pro-skip.engine.js';
import {
  humanizedClick,
  humanReactionDelay,
  randomDelay,
  logNormalDelay,
  sampleGaussian,
  setSpeedProfile,
  getSpeedProfile
} from '../human-motor.js';
import {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowRunResult,
  WorkflowSummary
} from '../types/workflow.types.js';
import { RaidEvaluator, RaidCandidate, RaidEvaluationOptions } from './raid-evaluator.js';
import { AccountRegistry } from '../auth/account-registry.js';

export interface WorkflowLoopOptions {
  runs?: number;
  autoReplenishAp?: boolean;
  autoReplenishEp?: boolean;
  logPath?: string;
  onProgress?: (result: WorkflowRunResult) => void;
}

export class UniversalWorkflowEngine {
  private stopRequested = false;
  private totalGoldBarsAccumulated = 0;
  private totalBlueChestsAccumulated = 0;
  private totalHonorsAccumulated = 0;
  private totalLootItemsAccumulated = 0;
  private currentRaidId: string = 'N/A';
  private myUserId: string = '';
  private currentScore = 0;
  private currentTurn = 1;
  private dropLogger?: DropLogger;
  private alertRelay = new AlertRelay();
  private joinedInCurrentBatch = 0;
  private currentBatchThreshold = 3;
  private latestRewardData: any = null;
  private responseListenerInitialized = false;
  private currentLogPath = 'logs/workflow.md';
  private currentDropLogPath?: string;
  private currentWorkflowLogPath = 'logs/workflow.md';
  private currentBattleHadGoldBar = false;
  private currentBattleHadBlueChest = false;
  private totalCompletedRuns = 0;
  private dailyCatalogCache: any[] | null = null;
  private totalJoinedAndClearedBattles = 0;
  private lastStartFailureWasRaidLimit = false;
  private lastStartFailureWasRaidWait = false;
  private deadRaidIds = new Map<string, number>();
  private playerName?: string;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog,
    private template: WorkflowTemplate,
    private accountId: string
  ) {
    setSpeedProfile(template.speedProfile || 'fast');
    this.currentBatchThreshold = this.calculateNextBatchThreshold();
    const accConfig = AccountRegistry.getAccountById(this.accountId);
    this.playerName = accConfig?.name || this.accountId;
    this.sentinel?.setSessionContext?.({
      accountId: this.accountId,
      playerName: this.playerName,
      questName: this.template.name,
    });
    this.setupResponseListener();
  }

  public async syncInGamePlayerName(): Promise<string> {
    try {
      if (typeof this.page.evaluate === 'function') {
        const inGameName = await this.page.evaluate(() => {
          const Game = (window as any).Game;
          const nameEl = document.querySelector('.prt-user-name .txt-user-name, .prt-user-name, .txt-user-name, .prt-status-user-name');
          if (nameEl?.textContent?.trim()) return nameEl.textContent.trim();
          if (Game?.userName) return String(Game.userName).trim();
          return null;
        }).catch(() => null);

        if (inGameName && inGameName !== 'Player') {
          this.playerName = inGameName;
          this.sentinel?.setSessionContext?.({
            accountId: this.accountId,
            playerName: this.playerName,
            questName: this.template.name,
          });
          return inGameName;
        }
      }
    } catch {}
    return this.playerName || this.accountId;
  }

  public updatePage(newPage: Page): void {
    console.log(`[Workflow] 🔄 Re-binding active page for [${this.accountId}] following CDP reconnect.`);
    this.page = newPage;
    this.responseListenerInitialized = false;
    this.setupResponseListener();
  }

  public async ensureViewportAndMobile(): Promise<void> {
    try {
      await this.page.setViewport({
        width: 480,
        height: 960,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true
      });
    } catch (err: any) {
      console.warn('[Workflow] Notice setting viewport:', err.message);
    }
  }

  public requestStop(): void {
    console.log(`\n[Workflow] 🛑 Graceful stop requested for [${this.accountId}]. Finishing active run...`);
    this.stopRequested = true;
  }

  /**
   * Sets up real-time telemetry interceptor to track ground-truth turn count,
   * honors, raid IDs, and reward drops across combat JSON payloads.
   */
  private setupResponseListener(): void {
    if (this.responseListenerInitialized) return;
    this.responseListenerInitialized = true;

    this.page.on('response', async (res: HTTPResponse) => {
      const url = res.url();

      try {
        // 1. Initial Raid State or Mid-battle Re-sync
        if (
          url.includes('/quest/raid_info') ||
          url.includes('start.json') ||
          url.includes('raid_battle.json')
        ) {
          const json = await res.json().catch(() => null);
          if (json) {
            if (json.raid_id) {
              this.currentRaidId = String(json.raid_id);
              this.sentinel?.setSessionContext?.({ raidId: this.currentRaidId });
            }

            if (json.user_id && !this.myUserId) this.myUserId = String(json.user_id);
            let memberPoint: number | null = null;
            if (Array.isArray(json.multi_raid_member_info)) {
              const myId = String(this.myUserId || json.user_id || '');
              const myName = this.playerName || '';
              const me = json.multi_raid_member_info.find((m: any) => 
                (myId && String(m.user_id) === myId) || 
                (myName && (m.nickname === myName || m.name === myName)) ||
                (m.is_host && json.is_host)
              );
              if (me) {
                if (me.user_id && !this.myUserId) this.myUserId = String(me.user_id);
                if (me.point !== undefined) {
                  const pt = parseInt(String(me.point).replace(/,/g, ''), 10);
                  if (!isNaN(pt) && pt > 0) memberPoint = pt;
                }
              }
            }

            const serverPoint =
              memberPoint ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null) ??
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.player?.point === 'number' && json.player.point > 0 ? json.player.point : null);
            if (serverPoint !== null) this.currentScore = Math.max(this.currentScore, serverPoint);
            if (json.turn !== undefined) this.currentTurn = Number(json.turn);
            else if (json.status?.turn !== undefined) this.currentTurn = Number(json.status.turn);
          }
        }

        // 2. Normal Attack Result
        if (url.includes('normal_attack_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            if (json.user_id && !this.myUserId) this.myUserId = String(json.user_id);
            let directPoint: number | null = null;

            if (Array.isArray(json.multi_raid_member_info)) {
              const myId = String(this.myUserId || json.user_id || '');
              const myName = this.playerName || '';
              const me = json.multi_raid_member_info.find((m: any) => 
                (myId && String(m.user_id) === myId) || 
                (myName && (m.nickname === myName || m.name === myName)) ||
                (m.is_host && json.is_host)
              );
              if (me) {
                if (me.user_id && !this.myUserId) this.myUserId = String(me.user_id);
                if (me.point !== undefined) {
                  const pt = parseInt(String(me.point).replace(/,/g, ''), 10);
                  if (!isNaN(pt) && pt > 0) directPoint = pt;
                }
              }
            }

            if (directPoint === null) {
              directPoint =
                (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
                (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
                (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null) ??
                (typeof json.player?.point === 'number' && json.player.point > 0 ? json.player.point : null);
            }

            const targetHonors = this.template.targetScore || 1500000;
            if (directPoint !== null) {
              this.currentScore = Math.max(this.currentScore, directPoint);
              const pct = ((this.currentScore / targetHonors) * 100).toFixed(1);
              console.log(`[Combat] 🎯 Attack Honors Synced: ${this.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
            } else {
              const turnDmg = this.extractTurnDamage(json);
              if (turnDmg > 0) {
                // In Granblue Fantasy raids, 1 honor = 100 damage (e.g. 148M damage = 1.48M honors)
                const turnHonors = Math.floor(turnDmg / 100);
                this.currentScore += turnHonors;
                const pct = ((this.currentScore / targetHonors) * 100).toFixed(1);
                console.log(`[Combat] Turn Dmg: ${turnDmg.toLocaleString()} (~${turnHonors.toLocaleString()} pt) | Total Honors: ${this.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
              }
            }
            if (json.status?.turn !== undefined) this.currentTurn = Number(json.status.turn);
            else if (json.turn !== undefined) this.currentTurn = Number(json.turn);
          }
        }

        // 3. Ability Result
        if (url.includes('ability_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            const abilityPoint =
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null);
            if (abilityPoint !== null) this.currentScore = Math.max(this.currentScore, abilityPoint);
            if (json.status?.turn !== undefined) this.currentTurn = Number(json.status.turn);
          }
        }

        // 4. Summon Result
        if (url.includes('summon_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            const summonPoint =
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null);
            if (summonPoint !== null) this.currentScore = Math.max(this.currentScore, summonPoint);
            if (json.status?.turn !== undefined) this.currentTurn = Number(json.status.turn);
          }
        }

        // 5. Battle Result & Rewards
        if (
          url.includes('resultmulti') ||
          url.includes('result_multi') ||
          url.includes('/result/data') ||
          url.includes('/result/content') ||
          url.includes('reward.json')
        ) {
          const json = await res.json().catch(() => null);
          if (json) {
            this.latestRewardData = json;
            const resPoint =
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point === 'number' && json.point > 0 ? json.point : null) ??
              (typeof json.total_point === 'number' && json.total_point > 0 ? json.total_point : null);
            if (resPoint !== null) this.currentScore = Math.max(this.currentScore, resPoint);

            // Check if encoded HTML contains honors
            if (typeof json.data === 'string') {
              try {
                const decoded = decodeURIComponent(json.data);
                const match = decoded.match(/class=["'](?:prt-user-point|txt-user-point)["'][^>]*>.*?([0-9,]+)/i);
                if (match && match[1]) {
                  const num = parseInt(match[1].replace(/,/g, ''), 10);
                  if (!isNaN(num) && num > 0) this.currentScore = Math.max(this.currentScore, num);
                }
              } catch {}
            }

            this.checkForGoldBarDrop(json);
            this.checkForBlueChestDrop(json);
          }
        }
      } catch {
        // Silently ignore parsing errors on interrupted responses during navigation
      }
    });
  }

  /**
   * Traverses battle scenario AST to aggregate total damage dealt by player this turn.
   */
  public extractTurnDamage(data: any): number {
    if (!data || !Array.isArray(data.scenario)) return 0;
    let turnDamage = 0;

    const traverse = (node: any) => {
      if (!node) return;
      if (typeof node === 'number') {
        if (node > 0 && node < 100000000 && Number.isFinite(node)) {
          turnDamage += node;
        }
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) traverse(item);
        return;
      }
      if (typeof node === 'object') {
        for (const [key, val] of Object.entries(node)) {
          if (key === 'damage' || key === 'value' || key === 'val' || key === 'total_damage') {
            if (typeof val === 'number' && val > 0 && val < 100000000) {
              turnDamage += val;
            } else if (Array.isArray(val) || typeof val === 'object') {
              traverse(val);
            }
          } else if (key === 'list') {
            traverse(val);
          }
        }
      }
    };

    for (const s of data.scenario) {
      if (!s) continue;
      // Skip healing, boss gauges, and incoming enemy damage
      if (s.cmd === 'heal' || s.cmd === 'boss_gauge' || s.cmd === 'special' || s.cmd === 'special_npc') continue;
      if (s.from === 'boss' || s.from === 'enemy' || s.target === 'player' || s.to === 'player' || s.name === 'player') continue;

      if (s.cmd === 'attack' || s.cmd === 'damage') {
        if (s.damage !== undefined) traverse(s.damage);
        if (s.list !== undefined) traverse(s.list);
      }
    }

    return turnDamage;
  }

  /**
   * Synchronizes ground-truth honors from DOM and window/stage client state.
   */
  public async syncCurrentHonors(): Promise<number> {
    try {
      const result = await this.page.evaluate((cachedId, accountName) => {
        const stage = (window as any).stage;
        const pJsn = stage?.pJsnData;
        let detectedUserId = cachedId || '';

        // 1. Authoritative: multi_raid_member_info from stage.pJsnData
        if (pJsn?.multi_raid_member_info && Array.isArray(pJsn.multi_raid_member_info)) {
          const myId = String(cachedId || pJsn.user_id || (window as any).Game?.userId || '');
          const me = pJsn.multi_raid_member_info.find((m: any) => 
            (myId && String(m.user_id) === myId) || 
            (accountName && (m.nickname === accountName || m.name === accountName)) ||
            (m.is_host && pJsn.is_host)
          );
          if (me) {
            if (me.user_id) detectedUserId = String(me.user_id);
            if (me.point !== undefined) {
              const pt = parseInt(String(me.point).replace(/,/g, ''), 10);
              if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
            }
          }
        }

        if (pJsn?.user_id) detectedUserId = String(pJsn.user_id);

        // 2. Direct server user_point from stage.pJsnData
        if (pJsn?.user_point !== undefined) {
          const pt = parseInt(String(pJsn.user_point).replace(/,/g, ''), 10);
          if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
        }

        // 3. Direct server point_info from stage.pJsnData
        if (pJsn?.point_info?.user_point !== undefined) {
          const pt = parseInt(String(pJsn.point_info.user_point).replace(/,/g, ''), 10);
          if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
        }

        // 4. stage.gGameStatus.player.point
        if (stage?.gGameStatus?.player?.point !== undefined) {
          const pt = parseInt(String(stage.gGameStatus.player.point).replace(/,/g, ''), 10);
          if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
        }

        // 5. In raid & result DOM elements (.txt-user-point, .prt-user-point, .txt-point, .prt-point, .prt-point-info, .lis-user.user-me)
        const pointEls = Array.from(document.querySelectorAll('.txt-user-point, .prt-user-point, .txt-point, .prt-point, .prt-point-info .txt-point, .lis-user.user-me .txt-point'));
        for (const el of pointEls) {
          const text = (el as HTMLElement).innerText || '';
          const match = text.match(/(?:honors|貢献度|point)?\s*[:：]?\s*([0-9,]+)\s*(?:pt)?/i);
          if (match && match[1]) {
            const num = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(num) && num > 0) return { score: num, userId: detectedUserId };
          }
        }

        // 6. Look for any element displaying honors / points (e.g. "... pt")
        const ptElements = Array.from(document.querySelectorAll('.prt-raid-info *, .cnt-raid-info *, .prt-result-cnt *'));
        for (const el of ptElements) {
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (text.includes('pt') && text.length < 25) {
            const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num) && num > 0) return { score: num, userId: detectedUserId };
          }
        }

        return { score: 0, userId: detectedUserId };
      }, this.myUserId, this.playerName || '').catch(() => ({ score: 0, userId: '' }));

      if (result.userId && !this.myUserId) {
        this.myUserId = result.userId;
      }

      if (result.score > this.currentScore) {
        this.currentScore = result.score;
        const target = this.template.targetScore || 1500000;
        const pct = ((this.currentScore / target) * 100).toFixed(1);
        console.log(`[Honors] Synced: ${this.currentScore.toLocaleString()} / ${target.toLocaleString()} pt (${pct}%)`);
      }
      return this.currentScore;
    } catch {
      return this.currentScore;
    }
  }

  /**
   * Checks reward payload for Gold Bar (item_id 20004 / "ヒヒイロカネ" / "Gold Bar" / "Gold Brick").
   */
  private checkForGoldBarDrop(payload: any): boolean {
    if (!payload) return false;
    let found = false;

    // 1. Recursive object search across all properties (arrays, dictionaries, chest keys)
    const traverse = (node: any) => {
      if (!node || found) return;
      if (typeof node === 'object') {
        const itemId = String(node.item_id || node.id || '');
        const itemName = String(node.name || node.item_name || '');
        if (itemId === '20004' || itemName.includes('Gold Bar') || itemName.includes('Gold Brick') || itemName.includes('ヒヒイロカネ')) {
          found = true;
          return;
        }
        for (const key of Object.keys(node)) {
          traverse(node[key]);
        }
      }
    };
    traverse(payload);

    // 2. Fast string serialization check across entire payload
    if (!found) {
      try {
        const str = JSON.stringify(payload);
        if (str.includes('20004') || str.includes('ヒヒイロカネ') || str.includes('Gold Bar') || str.includes('Gold Brick')) {
          found = true;
        }
      } catch {}
    }

    // 3. Encoded data string check (HTML template inside payload.data)
    if (!found && typeof payload.data === 'string') {
      try {
        if (
          payload.data.includes('20004') ||
          payload.data.includes('ヒヒイロカネ') ||
          payload.data.includes('Gold%20Brick') ||
          payload.data.includes('Gold%20Bar')
        ) {
          found = true;
        } else {
          const decoded = decodeURIComponent(payload.data);
          if (
            decoded.includes('20004') ||
            decoded.includes('ヒヒイロカネ') ||
            decoded.includes('Gold Bar') ||
            decoded.includes('Gold Brick')
          ) {
            found = true;
          }
        }
      } catch {
        if (payload.data.includes('20004')) {
          found = true;
        }
      }
    }

    if (found && !this.currentBattleHadGoldBar) {
      this.currentBattleHadGoldBar = true;
      this.totalGoldBarsAccumulated++;
      this.broadcastGoldBarFound();
    }

    return found;
  }

  /**
   * Checks reward payload for Blue Chest (special_reward_flag / box_type 11 / "特別報酬").
   */
  private checkForBlueChestDrop(payload: any): boolean {
    if (!payload) return false;
    let found = false;

    if (payload.special_reward_flag || payload.special_reward || payload.reward_box_11) {
      found = true;
    }

    if (!found) {
      const traverse = (node: any) => {
        if (!node || found) return;
        if (typeof node === 'object') {
          const boxType = String(node.box_type || node.box_id || node.box || node.reward_type || '');
          if (boxType === '11') {
            found = true;
            return;
          }
          for (const key of Object.keys(node)) {
            traverse(node[key]);
          }
        }
      };
      traverse(payload);
    }

    if (!found && typeof payload.data === 'string') {
      try {
        if (
          payload.data.includes('box_type="11"') ||
          payload.data.includes('box-type="11"') ||
          payload.data.includes('prt-special-reward') ||
          payload.data.includes('特別報酬')
        ) {
          found = true;
        } else {
          const decoded = decodeURIComponent(payload.data);
          if (
            decoded.includes('box_type="11"') ||
            decoded.includes('box-type="11"') ||
            decoded.includes('prt-special-reward') ||
            decoded.includes('特別報酬') ||
            decoded.includes('Special Reward')
          ) {
            found = true;
          }
        }
      } catch {}
    }

    if (found && !this.currentBattleHadBlueChest) {
      this.currentBattleHadBlueChest = true;
      this.totalBlueChestsAccumulated++;
    }

    return found;
  }

  /**
   * Inspects result DOM for on-screen Gold Bar drop indicators.
   */
  private async inspectDomForGoldBar(): Promise<{ hasGoldBar: boolean; raidId: string }> {
    try {
      return await this.page.evaluate(() => {
        const text = document.body?.innerText || '';
        const hasText = text.includes('Gold Bar') || text.includes('Gold Brick') || text.includes('ヒヒイロカネ');
        const hasImg = !!document.querySelector([
          'img[src*="20004"]',
          'img.img-thumb[src*="20004"]',
          'img[src*="evolution/s/20004"]',
          'img[src*="evolution/m/20004"]',
          'img[src*="assets/item/evolution/s/20004.jpg"]',
          'img[src*="assets/item/evolution/m/20004.jpg"]',
          '[data-item-name*="Gold Bar"]',
          '[data-item-name*="Gold Brick"]',
          '[data-item-name*="ヒヒイロカネ"]',
          '[alt*="Gold Bar"]',
          '[alt*="Gold Brick"]',
          '[alt*="ヒヒイロカネ"]',
          'div[data-item-id="20004"]',
          '[data-item-id="20004"]'
        ].join(', '));

        const raidIdMatch = window.location.hash.match(/result(?:_multi)?\/(\d+)/);
        const textMatch = text.match(/ID[:\s]*(\d+)/i);
        const raidId = raidIdMatch ? raidIdMatch[1] : (textMatch ? textMatch[1] : '');
        return { hasGoldBar: hasText || hasImg, raidId };
      });
    } catch {
      return { hasGoldBar: false, raidId: '' };
    }
  }

  /**
   * Inspects result DOM for on-screen Blue Chest drop indicators.
   */
  private async inspectDomForBlueChest(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const hasSpecialRewardElement = !!document.querySelector([
          '.prt-special-reward',
          '.prt-special-reward-box',
          '.ico-special-reward',
          '.box-special',
          '.prt-box-special',
          '.special-reward',
          '[data-box-type="11"]',
          '.box-11',
          '.reward-box-11',
          'div.prt-special-item',
          'div.prt-special-box'
        ].join(', '));

        if (hasSpecialRewardElement) return true;

        const text = document.body?.innerText || '';
        if (text.includes('特別報酬') || text.includes('Special Reward') || text.includes('Blue Chest')) {
          return true;
        }

        try {
          const stage = (window as any).stage;
          if (stage && stage.g && stage.g.result) {
            const res = stage.g.result;
            if (res.special_reward_flag || res.special_reward || res.reward_box_11) {
              return true;
            }
          }
        } catch {}

        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Captures a clean, unobstructed proof screenshot of the raid rewards and loot collected.
   * Eliminates blocking modals (EXP Gained, Level Up, Trophy, overlays), brings the loot list
   * into crisp view, and clips neatly to the battle result card (.prt-module) whenever possible.
   */
  private async captureCleanLootProof(raidId?: string): Promise<{ buffer?: Buffer; path: string }> {
    const cleanRaidId = (raidId || this.currentRaidId || '').replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
    const capDir = path.resolve(process.cwd(), 'artifacts/captures');
    if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
    const proofPath = path.resolve(capDir, `gold-bar-${cleanRaidId || 'drop'}-${Date.now()}.png`);

    let shotBuf: Buffer | undefined;

    try {
      // 1. If clean numeric raidId is present and we're not already on the detail page, navigate to persistent detail URL
      const currentUrl = this.page.url();
      const isAlreadyDetail = currentUrl.includes(`result_multi/detail/${cleanRaidId}`);

      if (cleanRaidId && /^\d+$/.test(cleanRaidId) && !isAlreadyDetail) {
        const detailUrl = `https://game.granbluefantasy.jp/#result_multi/detail/${cleanRaidId}/1/0/0`;
        console.log(`[Workflow] 📸 Navigating to persistent battle detail for clean loot proof: ${detailUrl}`);
        await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
        await this.page.waitForSelector('.prt-reward-item, .cnt-result, .prt-module', { timeout: 8000 }).catch(() => null);
        await logNormalDelay(1000, 0.15);
      }

      // 2. Dismiss any active modal popups via UI click
      await this.page.evaluate(() => {
        const okBtns = document.querySelectorAll(
          '.pop-usual .btn-usual-ok, .btn-usual-ok, .pop-usual .btn-usual-close, .btn-usual-close, .btn-settle, .btn-result-close'
        );
        okBtns.forEach((b: any) => {
          try {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(b).trigger('tap');
            b.click();
          } catch {}
        });
      }).catch(() => null);
      await logNormalDelay(300, 0.1);

      // 3. Forcibly hide any lingering modal dialogs, popups, and backdrop masks
      await this.page.evaluate(() => {
        const hideSelectors = [
          '.pop-usual', '#pop', '.prt-popup-header', '.prt-popup-body',
          '.prt-popup-footer', '.mask', '.pop-show', '.common-pop-error', '.cnt-error'
        ];
        hideSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            const htmlEl = el as HTMLElement;
            htmlEl.style.display = 'none';
            htmlEl.style.visibility = 'hidden';
            htmlEl.style.opacity = '0';
            htmlEl.style.pointerEvents = 'none';
          });
        });
      }).catch(() => null);

      // 4. Scroll the loot / reward item container into view
      await this.page.evaluate(() => {
        const loot = document.querySelector(
          '.prt-reward-item, .prt-item-list, [data-item-id="20004"], img[src*="20004"], .prt-module'
        ) as HTMLElement;
        if (loot) {
          loot.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      }).catch(() => null);
      await logNormalDelay(200, 0.05);

      // 5. Measure .prt-module for a clean, framed card capture
      const clip = await this.page.evaluate(() => {
        const el = document.querySelector('.prt-module') as HTMLElement;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return {
          x: Math.max(0, Math.round(r.x)),
          y: Math.max(0, Math.round(r.y)),
          width: Math.round(r.width),
          height: Math.min(Math.round(r.height), 750)
        };
      }).catch(() => null);

      if (clip && clip.width > 0 && clip.height > 0) {
        console.log(`[Workflow] 📸 Clipping clean loot reward card (${clip.width}x${clip.height})...`);
        const buf = await this.page.screenshot({ clip });
        fs.writeFileSync(proofPath, buf);
        shotBuf = Buffer.from(buf);
      } else {
        const buf = await this.page.screenshot();
        fs.writeFileSync(proofPath, buf);
        shotBuf = Buffer.from(buf);
      }
      console.log(`[Workflow] ✅ Clean Gold Bar proof screenshot saved: ${proofPath}`);
    } catch (shotErr: any) {
      console.warn(`[Workflow] Notice taking clean screenshot, falling back to basic capture:`, shotErr.message);
      try {
        const fallbackBuf = await this.page.screenshot();
        fs.writeFileSync(proofPath, fallbackBuf);
        shotBuf = Buffer.from(fallbackBuf);
      } catch {}
    }

    return { buffer: shotBuf, path: proofPath };
  }

  private async broadcastGoldBarFound(overrideRaidId?: string): Promise<void> {
    const raidId = overrideRaidId || this.currentRaidId || '';
    console.log(`\n========================================================================`);
    console.log(`  🌟🌟🌟 [GOLD BAR FOUND!] Account: [${this.accountId}] Raid: ${raidId || 'Active'} 🌟🌟🌟`);
    console.log(`========================================================================\n`);

    // Terminal audible bell
    process.stdout.write('\x07\x07\x07');

    const battleUrl = raidId
      ? `https://game.granbluefantasy.jp/#result_multi/detail/${raidId}/1/0/0`
      : (this.page.url().includes('result') ? this.page.url() : '');

    try {
      const { buffer: shotBuffer, path: proofPath } = await this.captureCleanLootProof(raidId);

      if (this.dropLogger) {
        await this.dropLogger.notifyGoldBarDrop({
          raidId: raidId || 'Raid',
          honors: this.currentScore > 0 ? this.currentScore.toLocaleString() + ' pt' : '-',
          turns: this.currentTurn || '-',
          screenshotBuffer: shotBuffer,
          screenshotPath: proofPath,
          accountId: this.accountId,
        });
      } else {
        const playerName = this.accountId === 'acc1' || !this.accountId ? '『Danchou』' : this.accountId;
        await this.alertRelay.sendEmergencyAlert(
          `🌟 GOLD BAR DROP CONFIRMED for ${playerName}!\n• Raid: ${this.template.name}\n• Battle Log: ${battleUrl}\n• Honors: ${this.currentScore.toLocaleString()} pt\n• Total GB: ${this.totalGoldBarsAccumulated}`,
          shotBuffer
        );
      }
    } catch (err: any) {
      console.error(`[Workflow] Error broadcasting Gold Bar:`, err.message);
    }
  }

  private calculateNextBatchThreshold(): number {
    if (this.template.batchClaimSize && this.template.batchClaimSize > 0) {
      return Math.min(3, Math.max(1, this.template.batchClaimSize));
    }
    const min = Math.max(1, Math.min(this.template.minBatchClaim || 2, 3));
    const max = Math.max(min, Math.min(this.template.maxBatchClaim || 3, 3));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Runs the automated workflow loop.
   */
  public async runLoop(options: WorkflowLoopOptions = {}): Promise<WorkflowSummary> {
    const {
      runs = this.template.defaultRuns || 100,
      autoReplenishAp = this.template.autoElixir !== false,
      autoReplenishEp = this.template.autoBerry !== false,
      logPath = this.template.logPath,
      onProgress
    } = options;

    const startTime = Date.now();
    let totalCompleted = 0;
    this.stopRequested = false;
    this.totalGoldBarsAccumulated = 0;
    this.totalHonorsAccumulated = 0;
    this.totalLootItemsAccumulated = 0;
    this.joinedInCurrentBatch = 0;
    this.totalJoinedAndClearedBattles = 0;
    this.lastStartFailureWasRaidLimit = false;

    await this.syncInGamePlayerName();

    const isAssistRaid = this.template.questUrl.includes('assist');

    // Canonical drop log resolution (for Gold Bar ledger & raid statistics)
    let dropLogPath: string | undefined = logPath || this.template.logPath;
    if (!dropLogPath) {
      const lowerName = this.template.name.toLowerCase();
      if (lowerName.includes('akasha') || this.template.raidSlot === 3) {
        dropLogPath = 'logs/gb-akasha.md';
      } else if (lowerName.includes('pbhl') || this.template.raidSlot === 4) {
        dropLogPath = 'logs/gb-pbhl.md';
      } else if (lowerName.includes('go') || lowerName.includes('grand order') || this.template.raidSlot === 2) {
        dropLogPath = 'logs/gb-go.md';
      } else if (isAssistRaid) {
        dropLogPath = 'logs/gb-farm.md';
      }
    }

    const workflowSlug = this.template.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const workflowLogPath = `logs/workflow-${this.accountId}-${workflowSlug}.md`;
    this.currentWorkflowLogPath = workflowLogPath;
    this.currentDropLogPath = dropLogPath;
    const activeLogPath = dropLogPath || workflowLogPath;
    this.currentLogPath = activeLogPath;

    // Initialize DropLogger if dropLogPath resolved
    if (dropLogPath) {
      this.ensureLogDirExists(dropLogPath);
      this.dropLogger = new DropLogger(path.resolve(process.cwd(), dropLogPath), this.template.name);
      const initialStats = this.dropLogger.getStats();
      console.log(`[Workflow] Drop Logger active: ${dropLogPath} (${initialStats.totalBattles} historical battles, ${initialStats.blueChests} Blue Chests, ${initialStats.goldBars} Gold Bars, dry streak: ${initialStats.currentDryStreak} ${initialStats.dryStreakMode === 'blue_chest' ? 'blue chests' : 'battles'})`);

      discordPresence.updateStatus({
        raidName: this.template.name,
        runNumber: initialStats.totalBattles + 1,
        totalRuns: runs === Infinity ? undefined : runs,
        goldBars: initialStats.goldBars,
        goldBarsToday: initialStats.goldBarsToday,
        goldBarsSession: 0,
        blueChests: initialStats.blueChests,
        dryStreak: initialStats.currentDryStreak,
        dryStreakMode: initialStats.dryStreakMode,
        status: 'Searching',
        accountId: this.accountId
      }, true);
    }

    this.ensureLogDirExists(workflowLogPath);

    console.log(`\n========================================================================`);
    console.log(`     Universal Workflow Engine: ${this.template.name}`);
    console.log(`     Account:                   [${this.accountId}]`);
    console.log(`========================================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Quest URL:            ${this.template.questUrl}`);
    console.log(`Mode:                 ${isAssistRaid ? 'Multi-Raid Assist / Backup Farmer' : 'Single Quest / Supporter Runner'}`);
    console.log(`Total Steps:          ${this.template.steps.length}`);
    console.log(`Speed Profile:        ${(this.template.speedProfile || 'fast').toUpperCase()}`);
    console.log(`Human Motor:          ${this.template.humanMotor !== false ? 'Enabled (Gaussian Jitter & Log-Normal Delays)' : 'Disabled'}`);
    console.log(`Stop on CAPTCHA:      ${this.template.stopOnCaptcha !== false ? 'Enabled (Hard-Freeze & Alert)' : 'Disabled'}`);
    console.log(`Auto Half-Elixir:     ${autoReplenishAp ? 'Enabled' : 'Disabled'}`);
    console.log(`Auto Soul-Berry:      ${autoReplenishEp ? 'Enabled' : 'Disabled'}`);
    if (isAssistRaid) {
      console.log(`Batch Claim Window:   Randomized ${this.template.minBatchClaim || 3} - ${this.template.maxBatchClaim || 5} raids (First batch: ${this.currentBatchThreshold})`);
    }
    if (dropLogPath) {
      console.log(`Drop Log (Gold Bars): ${dropLogPath}`);
    }
    console.log(`Workflow Log:         ${workflowLogPath}`);
    console.log(`========================================================================\n`);

    // Clean up any lingering popups or unfinished battles on startup
    await this.resolveLingeringState();

    // Check and clear pre-existing pending battles before starting session
    // Critical for Guild Wars (GW / Unite and Fight) where having any unclaimed battle strictly blocks starting quests
    const isGw = this.template.name.toLowerCase().includes('gw') || this.template.questUrl.includes('teamraid') || this.template.questUrl.includes('event');
    if (isAssistRaid || isGw) {
      console.log('[Workflow] 🛡️ Verifying zero pending/unclaimed battles exist before starting runs...');
      await this.claimPendingBattles(activeLogPath, 0, this.template.questUrl);
    }

    let consecutiveStartFailures = 0;
    const MAX_START_FAILURES = 3;

    while (totalCompleted < runs && !this.stopRequested) {
      const runNumber = totalCompleted + 1;
      const runStart = Date.now();
      this.currentScore = 0;
      this.currentTurn = 1;
      this.currentBattleHadGoldBar = false;
      this.currentBattleHadBlueChest = false;
      this.totalCompletedRuns = totalCompleted;

      // Check proactive pending battle batch limit in assist mode
      if (isAssistRaid && this.joinedInCurrentBatch >= this.currentBatchThreshold) {
        console.log(`\n[Workflow] Batch claim threshold (${this.currentBatchThreshold}) reached. Claiming pending battles...`);
        await this.claimPendingBattles(activeLogPath, totalCompleted);
        this.joinedInCurrentBatch = 0;
        this.currentBatchThreshold = this.calculateNextBatchThreshold();
        console.log(`[Workflow] Next pending claim scheduled in ${this.currentBatchThreshold} raids.\n`);
      }

      if (this.stopRequested) break;

      console.log(`------------------------------------------------------------------------`);
      console.log(`[${this.accountId}] [Run ${runNumber}] Initiating Workflow Run...`);
      console.log(`------------------------------------------------------------------------`);

      this.sentinel?.setSessionContext?.({
        accountId: this.accountId,
        questName: this.template.name,
        runNumber: runNumber,
      });

      const currentStats = this.dropLogger?.getStats();
      discordPresence.updateStatus({
        raidName: this.template.name,
        runNumber: currentStats ? (currentStats.totalBattles + 1) : runNumber,
        totalRuns: runs === Infinity ? undefined : runs,
        goldBars: currentStats ? currentStats.goldBars : this.totalGoldBarsAccumulated,
        goldBarsToday: currentStats?.goldBarsToday,
        goldBarsSession: this.totalGoldBarsAccumulated,
        blueChests: currentStats ? currentStats.blueChests : this.totalBlueChestsAccumulated,
        dryStreak: currentStats ? currentStats.currentDryStreak : undefined,
        dryStreakMode: currentStats ? currentStats.dryStreakMode : undefined,
        status: 'In Combat',
        turn: 1,
        accountId: this.accountId
      });

      try {
        // Routine Mode: Directly navigate if questUrl provided and execute pipeline without raid/supporter initialization
        if (this.template.mode === 'routine') {
          if (this.template.questUrl && !this.template.questUrl.includes('#mypage')) {
            const currentHash = await this.page.evaluate(() => window.location.hash);
            const targetHash = this.template.questUrl.includes('#') ? '#' + this.template.questUrl.split('#')[1] : this.template.questUrl;
            if (!currentHash.includes(targetHash)) {
              console.log(`[${this.accountId}] [Run ${runNumber}] Navigating to routine URL: ${this.template.questUrl}`);
              await this.page.evaluate((url: string) => { window.location.href = url; }, this.template.questUrl).catch(() => null);
              await logNormalDelay(600, 0.2);
            }
          }

          const pipelineSuccess = await this.executeStepPipeline(runNumber);
          const durationMs = Date.now() - runStart;
          totalCompleted++;

          const result: WorkflowRunResult = {
            runNumber,
            status: pipelineSuccess ? 'SUCCESS' : 'FAILED',
            durationMs,
            supporterName: 'N/A (Routine Mode)',
            honors: 0,
            message: `Routine run ${runNumber} completed in ${(durationMs / 1000).toFixed(1)}s`
          };

          this.appendRunLog(workflowLogPath, result);
          console.log(`[${this.accountId}] [Run ${runNumber}] Routine run finished in ${(durationMs / 1000).toFixed(1)}s (Total Completed: ${totalCompleted}/${runs})\n`);
          if (onProgress) onProgress(result);
          continue;
        }

        // Step 1: Supporter Selection & Quest Start
        const questStarted = await this.selectSupporterAndStartQuest(autoReplenishAp, autoReplenishEp, activeLogPath, totalCompleted);
        if (!questStarted) {
          if (this.stopRequested) break;
          if (this.lastStartFailureWasRaidLimit) {
            this.lastStartFailureWasRaidLimit = false;
            consecutiveStartFailures = 0;
            continue;
          }
          if (this.lastStartFailureWasRaidWait) {
            this.lastStartFailureWasRaidWait = false;
            consecutiveStartFailures = 0;
            continue;
          }
          consecutiveStartFailures++;

          // Assert safety / check CAPTCHA immediately
          if (this.template.stopOnCaptcha !== false) {
            await this.sentinel.assertSafe();
          }

          // Perform on-screen failure diagnosis
          const diag = await this.diagnoseQuestStartFailure(runNumber);
          console.warn(`\n[${this.accountId}] [Run ${runNumber}] ⚠️ Failed to start quest (Attempt ${consecutiveStartFailures}/${MAX_START_FAILURES})`);
          if (diag.reason) {
            console.warn(`[Diagnostic] Probable Cause: ${diag.reason}`);
          }
          if (diag.popupText) {
            console.warn(`[Diagnostic] Screen Text: "${diag.popupText.replace(/\s+/g, ' ')}"`);
          }

          // Intercept 3-raid backup limit: do NOT penalize consecutive start failures!
          if (diag.isRaidBackupLimit) {
            console.log(`\n[Workflow] 🛡️ 3-Raid Backup Limit intercepted! Resetting failure counter and resolving lingering raids...`);
            consecutiveStartFailures = 0;
            await this.resolveLingeringRaidLimit(logPath, totalCompleted);
            continue;
          }

          // Intercept ended/unavailable raids: do NOT penalize consecutive start failures!
          if (diag.reason === 'Previous battle concluded or raid no longer available') {
            console.log(`[Workflow] Raid battle concluded or became unavailable. Resetting failure counter and returning to search...`);
            consecutiveStartFailures = 0;
            await logNormalDelay(1200, 0.12);
            continue;
          }

          if (consecutiveStartFailures >= MAX_START_FAILURES) {
            console.error(`\n========================================================================`);
            console.error(`  🚨 WORKFLOW HALTED: QUEST START FAILED ${consecutiveStartFailures} CONSECUTIVE TIMES`);
            console.error(`========================================================================`);
            console.error(`Account:      [${this.accountId}]`);
            console.error(`Quest:        ${this.template.questUrl}`);
            console.error(`Reason:       ${diag.reason || 'Modal / obstruction blocking quest start'}`);
            if (diag.capturePath) {
              console.error(`Screenshot:   ${diag.capturePath}`);
            }
            console.error(`Current URL:  ${this.page.url()}`);
            console.error(`========================================================================\n`);

            process.stdout.write('\x07\x07\x07');

            if (diag.isCaptcha) {
              console.log('[Workflow] 🚨 Verification challenge detected at quest start. Entering resolution...');
              const solved = await this.sentinel.handleVerificationChallenge();
              if (solved) {
                consecutiveStartFailures = 0;
                continue;
              }
            }

            break;
          }

          console.warn(`Retrying in 2.5s...\n`);
          await new Promise(r => setTimeout(r, 2500));
          continue;
        }

        consecutiveStartFailures = 0;

        this.joinedInCurrentBatch++;
        const battleStart = Date.now();

        // Step 2: Execute Step Pipeline
        const pipelineSuccess = await this.executeStepPipeline(runNumber);
        if (!pipelineSuccess) {
          console.warn(`[${this.accountId}] [Run ${runNumber}] Step pipeline exited early. Resolving battle state...`);
        }

        // Step 3: Resolve Result Screen & Collect Metrics
        await this.handleConfirmResult();

        const durationMs = Date.now() - battleStart;
        const totalCycleMs = Date.now() - runStart;
        totalCompleted++;
        this.totalHonorsAccumulated += this.currentScore;
        this.totalJoinedAndClearedBattles++;
        await this.checkFiveBattleMilestone(activeLogPath, totalCompleted);

        const result: WorkflowRunResult = {
          runNumber,
          status: 'SUCCESS',
          durationMs,
          supporterName: 'Selected Supporter',
          honors: this.currentScore,
          message: `Cleared in ${(durationMs / 1000).toFixed(1)}s`
        };

        // Record in DropLogger if assist mode or drop logger active
        if (this.dropLogger && (isAssistRaid || dropLogPath)) {
          const targetMet = this.template.targetScore ? this.currentScore >= this.template.targetScore : true;
          const hasBlueChest = this.currentBattleHadGoldBar || this.currentBattleHadBlueChest || targetMet;
          const { stats } = this.dropLogger.logBattle({
            raidId: this.currentRaidId,
            turns: this.currentTurn,
            honors: this.currentScore,
            targetMet,
            hasBlueChest,
            hasGoldBar: this.currentBattleHadGoldBar
          });

          discordPresence.updateStatus({
            raidName: this.template.name,
            runNumber: stats.totalBattles,
            totalRuns: runs === Infinity ? undefined : runs,
            goldBars: stats.goldBars,
            goldBarsToday: stats.goldBarsToday,
            goldBarsSession: this.totalGoldBarsAccumulated,
            blueChests: stats.blueChests,
            dryStreak: stats.currentDryStreak,
            dryStreakMode: stats.dryStreakMode,
            honors: this.currentScore,
            status: 'Searching'
          }, true);
        } else {
          discordPresence.updateStatus({
            raidName: this.template.name,
            runNumber,
            totalRuns: runs === Infinity ? undefined : runs,
            honors: this.currentScore,
            status: 'Searching'
          }, true);
        }

        this.appendRunLog(workflowLogPath, result);
        console.log(`[${this.accountId}] [Run ${runNumber}] Cleared in ${(durationMs / 1000).toFixed(1)}s (Total cycle: ${(totalCycleMs / 1000).toFixed(1)}s) | Honors: ${this.currentScore.toLocaleString()} pt (Total Session: ${this.totalHonorsAccumulated.toLocaleString()} pt)\n`);

        if (onProgress) onProgress(result);

      } catch (err: any) {
        const isSentinelHalt = err.message?.includes('SENTINEL') || (await this.sentinel.inspectForVerification());
        if (isSentinelHalt) {
          console.error(`\n========================================================================`);
          console.error(`  🚨 WORKFLOW HARD-FROZEN BY SAFETY SENTINEL: CAPTCHA DETECTED`);
          console.error(`========================================================================`);
          console.error(`👉 Automation is strictly paused to protect your account.`);
          console.error(`👉 Please solve the puzzle manually in your browser.`);
          console.error(`👉 Once solved, the engine will automatically resume your runs.`);
          console.error(`========================================================================\n`);

          process.stdout.write('\x07\x07\x07');
          const solved = await this.sentinel.handleVerificationChallenge();
          if (solved) {
            console.log(`[${this.playerName || this.accountId}] ✅ CAPTCHA solved by operator! Resuming in 3s...\n`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
          } else {
            console.error(`[${this.playerName || this.accountId}] 🛑 Verification wait timed out or aborted. Stopping workflow.`);
            break;
          }
        }

        console.error(`[${this.accountId}] [Run ${runNumber}] Error: ${err.message}`);
        await this.resolveLingeringState();
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Final pending battles sweep in assist mode
    if (isAssistRaid && this.joinedInCurrentBatch > 0) {
      console.log('\n[Workflow] Final sweep: Claiming remaining pending battles...');
      await this.claimPendingBattles(activeLogPath, totalCompleted);
    }

    discordPresence.updateStatus({
      status: 'Finished'
    }, true);

    const totalDurationMs = Date.now() - startTime;
    const avgSec = totalCompleted > 0 ? (totalDurationMs / totalCompleted / 1000) : 0;

    console.log(`\n========================================================================`);
    console.log(`                      Workflow Execution Summary                        `);
    console.log(`========================================================================`);
    console.log(`Template:                 ${this.template.name}`);
    console.log(`Account:                  ${this.accountId}`);
    console.log(`Total Battles Cleared:    ${totalCompleted}`);
    console.log(`Total Honors Earned:      ${this.totalHonorsAccumulated.toLocaleString()} pt`);
    if (this.totalGoldBarsAccumulated > 0) {
      console.log(`🌟 Total Gold Bars:       ${this.totalGoldBarsAccumulated}`);
    }
    console.log(`Average Time Per Run:     ${avgSec.toFixed(1)}s`);
    console.log(`Total Session Duration:   ${(totalDurationMs / 1000 / 60).toFixed(1)} minutes`);
    if (dropLogPath) {
      console.log(`Drop Log (Gold Bars):     ${dropLogPath}`);
    }
    console.log(`Workflow Execution Log:   ${workflowLogPath}`);
    console.log(`========================================================================\n`);

    return {
      templateName: this.template.name,
      accountId: this.accountId,
      totalRunsCompleted: totalCompleted,
      totalDurationMs,
      averageDurationSec: avgSec,
      logPath: dropLogPath || workflowLogPath
    };
  }

  /**
   * Executes the sequential step pipeline defined in the template.
   */
  private async executeStepPipeline(runNumber: number): Promise<boolean> {
    for (let i = 0; i < this.template.steps.length; i++) {
      const step = this.template.steps[i];
      if (this.stopRequested) return false;

      // Check CAPTCHA Sentinel before executing action
      if (this.template.stopOnCaptcha !== false) {
        await this.sentinel.assertSafe();
      }

      // Check early score termination condition
      if (this.template.targetScore && this.currentScore >= this.template.targetScore) {
        console.log(`[Run ${runNumber}] Target score reached (${this.currentScore.toLocaleString()} >= ${this.template.targetScore.toLocaleString()} pt). Terminating combat pipeline early.`);
        return true;
      }

      // Check explicit exit_if_score step
      if (step.code === 'exit_if_score' || step.action === 'exit_if_score') {
        await this.syncCurrentHonors();
        const threshold = step.targetScore || this.template.targetScore || 1500000;
        if (this.currentScore >= threshold) {
          console.log(`[Run ${runNumber}] Honor threshold met (${this.currentScore.toLocaleString()} >= ${threshold.toLocaleString()} pt). Exiting combat pipeline early.`);
          return true;
        }
        console.log(`[Run ${runNumber}] Current honors (${this.currentScore.toLocaleString()} pt) below threshold (${threshold.toLocaleString()} pt). Continuing pipeline...`);
        continue;
      }

      console.log(`[Run ${runNumber}] Step ${i + 1}/${this.template.steps.length}: ${step.code || step.action}${step.waitForNetwork ? ` (awaiting ${step.waitForNetwork})` : ''}`);

      const success = await this.executeSingleStep(step, i + 1, runNumber);
      if (!success && !step.optional) {
        console.warn(`[Run ${runNumber}] Step ${i + 1} (${step.code || step.action}) failed all attempts.`);
        if (await this.isBattleEnded()) {
          console.log(`[Run ${runNumber}] Battle already concluded. Proceeding to result resolution.`);
          return true;
        }
        await this.resolveLingeringState();
        return false;
      }

      if (step.delayAfterMs && step.delayAfterMs > 0) {
        await new Promise(r => setTimeout(r, step.delayAfterMs));
      }
    }

    // Enforce minimum honor threshold only if template does not already have an explicit repeat block
    const hasExplicitRepeatBlock = this.template.steps.some(s => s.code === 'repeat' || s.action === 'repeat');
    if (this.template.targetScore && !hasExplicitRepeatBlock) {
      await this.ensureMinimumHonors(this.template.targetScore);
    }

    return true;
  }

  /**
   * Executes a single workflow step with type-safe action dispatch.
   */
  private async executeSingleStep(step: WorkflowStep, stepNum: number, runNumber: number): Promise<boolean> {
    const actionCode = step.code || step.action;

    switch (actionCode) {
      case 'tap_ready':
        return await this.handleTapReady(step);

      case 'quick_call':
        return await this.handleQuickCall(step);

      case 'attack':
        return await this.handleAttack(step);

      case 'reload':
      case 'f5':
        return await this.handleReload(step);

      case 'skill':
        return await this.handleSkill(step);

      case 'summon':
        return await this.handleSummon(step);

      case 'target_enemy':
        return await this.handleTargetEnemy(step);

      case 'heal':
        return await this.handleHeal(step);

      case 'backup_request':
        return await this.handleBackupRequest();

      case 'exit_if_score':
        return await this.handleExitIfScore(step);

      case 'wait_turn':
        return await this.handleWaitTurn(step);

      case 'repeat':
        return await this.handleRepeat(step, runNumber);

      case 'auto':
        return await this.handleAuto(step);

      case 'guard':
        return await this.handleGuard(step);

      case 'navigate':
        if (step.target) {
          await this.page.evaluate((url: string) => { window.location.href = url; }, step.target).catch(() => null);
        }
        return true;

      case 'click':
        return await this.handleClick(step);

      case 'touch_tap':
        if (step.x !== undefined && step.y !== undefined) {
          await this.page.touchscreen.tap(step.x, step.y).catch(() => null);
          await this.page.mouse.click(step.x, step.y).catch(() => null);
        }
        return true;

      case 'wait':
        {
          const waitMs = step.ms || step.delayAfterMs || 500;
          await new Promise(r => setTimeout(r, waitMs));
        }
        return true;

      case 'wait_random':
      case 'wait_randomize':
        {
          const min = step.minMs || 300;
          const max = step.maxMs || 800;
          const delay = Math.floor(Math.random() * (max - min + 1)) + min;
          await new Promise(r => setTimeout(r, delay));
        }
        return true;

      case 'wait_network':
        if (step.waitForNetwork) {
          await this.waitForNetworkResponse(step.waitForNetwork, step.timeoutMs || 5000);
        }
        return true;

      case 'wait_element':
        if (step.target) {
          await this.page.waitForSelector(step.target, { visible: true, timeout: step.timeoutMs || 5000 }).catch(() => null);
        }
        return true;

      case 'eval':
        if (step.script) {
          await this.page.evaluate((js: string) => {
            try { return (window as any).eval(js); } catch { return null; }
          }, step.script).catch(() => null);
        }
        return true;

      case 'confirm_result':
        return await this.handleConfirmResult();

      case 'loop_while':
        return await this.handleLoopWhile(step, runNumber);

      case 'loop_until':
        return await this.handleLoopUntil(step, runNumber);

      case 'skip_story_scene':
        return await this.handleSkipStoryScene(step);

      case 'pro_skip_favorites':
        return await this.handleProSkipFavorites(step);

      case 'dismiss_popups':
        return await this.handleDismissPopups(step);

      case 'smart_full_auto':
        return await this.handleSmartFullAuto(step, runNumber);

      case 'do_until_finish':
      case 'run_daily_target':
        return await this.handleDoUntilFinish(step, runNumber);

      default:
        return true;
    }
  }

  /**
   * Executes a loop_while block of subSteps while selector exists and is visible.
   */
  private async handleLoopWhile(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const selector = step.target || step.conditionElement;
    if (!selector || !step.subSteps || step.subSteps.length === 0) return true;
    const maxLoops = step.maxLoops || 50;

    console.log(`[Workflow] 🔄 Starting loop_while: "${selector}" (max loops: ${maxLoops})...`);

    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (this.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      // Check if element exists and is visible on page (with initial settle window for AJAX mounting)
      let exists = false;
      const waitLimit = loopIdx === 0 ? 3500 : 600;
      const tCheckStart = Date.now();
      while (Date.now() - tCheckStart < waitLimit) {
        exists = await this.page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }, selector).catch(() => false);

        if (exists) break;
        await new Promise(r => setTimeout(r, 200));
      }

      if (!exists) {
        console.log(`[Workflow] ⏹️ loop_while condition met: element "${selector}" no longer present/visible. Loop completed at cycle ${loopIdx}.`);
        break;
      }

      console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Target "${selector}" active. Executing sub-steps...`);

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];
        const ok = await this.executeSingleStep(sub, s + 1, runNumber);
        if (!ok && !sub.optional) {
          console.warn(`[Workflow] Sub-step ${s + 1} (${sub.code}) failed inside loop_while.`);
          return false;
        }
      }

      await logNormalDelay(300, 0.15);
    }

    return true;
  }

  /**
   * Executes a loop_until block of subSteps until selector appears and is visible.
   */
  private async handleLoopUntil(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const selector = step.target || step.conditionElement;
    if (!selector || !step.subSteps || step.subSteps.length === 0) return true;
    const maxLoops = step.maxLoops || 50;

    console.log(`[Workflow] 🔄 Starting loop_until: "${selector}" (max loops: ${maxLoops})...`);

    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (this.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      const exists = await this.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }, selector).catch(() => false);

      if (exists) {
        console.log(`[Workflow] ⏹️ loop_until target "${selector}" reached. Exiting loop at cycle ${loopIdx}.`);
        break;
      }

      console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Target not yet met. Executing sub-steps...`);

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];
        const ok = await this.executeSingleStep(sub, s + 1, runNumber);
        if (!ok && !sub.optional) {
          return false;
        }
      }

      await logNormalDelay(300, 0.15);
    }

    return true;
  }

  /**
   * Fast-skips story dialogues, scene cutscenes, dialogue selections, and confirms dialog skips.
   */
  private async handleSkipStoryScene(step: WorkflowStep): Promise<boolean> {
    const timeoutMs = step.timeoutMs || 10000;
    console.log(`[Workflow] 📖 Fast-skipping story scene (timeout: ${timeoutMs}ms)...`);
    const tStart = Date.now();

    while (Date.now() - tStart < timeoutMs) {
      if (this.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      // Check if scene has already concluded (redirected to result, supporter, or list)
      const currentUrl = this.page.url();
      if (currentUrl.includes('result') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#raid')) {
        break;
      }

      // Check and execute scene progression actions
      const actionTaken = await this.page.evaluate(() => {
        const $ = (window as any).$ || (window as any).Zepto;

        // 1. Skip confirmation popup: ".pop-skip .btn-usual-ok", ".btn-skip-ok", ".btn-scene-skip"
        const skipOkBtn = document.querySelector('.pop-skip .btn-usual-ok, .btn-skip-ok, .pop-skip .btn-skip-confirm, .pop-usual .btn-usual-ok, .btn-scene-skip, .pop-synopsis .btn-scene-skip, .pop-usual .btn-scene-skip') as HTMLElement;
        if (skipOkBtn && skipOkBtn.offsetParent !== null) {
          if ($) $(skipOkBtn).trigger('tap');
          skipOkBtn.click();
          return 'confirmed_skip_modal';
        }

        // 2. Story scene SKIP button: ".btn-skip", ".prt-scene-setting .btn-skip", "[data-action='skip']"
        const skipBtn = document.querySelector('.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"]') as HTMLElement;
        if (skipBtn && skipBtn.offsetParent !== null) {
          if ($) $(skipBtn).trigger('tap');
          skipBtn.click();
          return 'clicked_skip_button';
        }

        // 3. Dialogue choice inside story: ".prt-selection .btn-selection", ".btn-command"
        const choiceBtn = document.querySelector('.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok') as HTMLElement;
        if (choiceBtn && choiceBtn.offsetParent !== null) {
          if ($) $(choiceBtn).trigger('tap');
          choiceBtn.click();
          return 'selected_choice';
        }

        // 4. Scene canvas or stage active: tap to awaken HUD
        const sceneCanvas = document.querySelector('canvas#canvas, canvas#cjs-canvas, .prt-scene-comment, .cnt-quest-scene') as HTMLElement;
        if (sceneCanvas && sceneCanvas.offsetParent !== null) {
          return 'canvas_ready';
        }

        return null;
      });

      if (actionTaken === 'confirmed_skip_modal') {
        console.log('[Workflow] Confirmed story skip dialog.');
        await logNormalDelay(600, 0.2);
        break;
      } else if (actionTaken === 'clicked_skip_button') {
        console.log('[Workflow] Clicked story Skip button.');
        await logNormalDelay(400, 0.2);
        continue;
      } else if (actionTaken === 'selected_choice') {
        console.log('[Workflow] Selected story dialogue option.');
        await logNormalDelay(350, 0.15);
        continue;
      } else if (actionTaken === 'canvas_ready') {
        // Tap screen to display HUD / skip button
        await this.page.touchscreen.tap(240, 360).catch(() => null);
        await logNormalDelay(350, 0.2);
      } else {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // Dismiss any post-scene reward dialogues (crystals, EXP, unlocked skills)
    await this.handleDismissPopups(step);
    return true;
  }

  /**
   * Executes all pinned Favorite Pro Skips via ProSkipEngine with full hybrid/DOM and AP handling.
   */
  private async handleProSkipFavorites(step: WorkflowStep): Promise<boolean> {
    console.log(`[Workflow] ⚡ Running Daily Favorites Pro Skips via ProSkipEngine...`);
    const autoReplenish = this.template.autoElixir !== false;
    const proSkipEngine = new ProSkipEngine(this.page, this.sentinel);
    const results = await proSkipEngine.runFavoritesProSkips(autoReplenish);

    let clearedCount = 0;
    for (const r of results) {
      if (r.status === 'SUCCESS' || r.status === 'ALREADY_CLEARED') {
        clearedCount++;
      }
    }
    console.log(`[Workflow] 🏁 Daily Favorites complete: ${clearedCount}/${results.length} pro skips processed.`);
    return true;
  }

  /**
   * Dismisses all active popups, result overlays, error notifications, and modals.
   */
  private async handleDismissPopups(step?: WorkflowStep): Promise<boolean> {
    const maxIterations = 5;
    for (let i = 0; i < maxIterations; i++) {
      const dismissed = await this.page.evaluate(() => {
        const selectors = [
          '.pop-usual .btn-usual-ok',
          '.pop-usual .btn-usual-cancel',
          '.pop-usual .btn-usual-close',
          '.pop-level-up .btn-usual-ok',
          '.common-pop-error .btn-usual-ok',
          '.common-pop-error .btn-usual-close',
          '.js-pop-skyscope-achieved .btn-usual-close',
          '.btn-result-close',
          '.btn-usual-close',
          '.prt-popup-footer .btn-usual-ok',
          '.prt-popup-footer .btn-usual-close',
          '.prt-popup-header .btn-usual-close',
          '.pop-synopsis.pop-show .btn-usual-ok',
          '.pop-synopsis.pop-show .btn-usual-cancel'
        ];

        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(el).trigger('tap');
              (el as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      });

      if (!dismissed) break;
      await logNormalDelay(250, 0.15);
    }
    return true;
  }

  /**
   * Retrieves a task definition from data/index.json dailyCatalog by tag or id.
   */
  private getDailyCatalogTask(tagOrId: string): any | null {
    try {
      if (!this.dailyCatalogCache) {
        const catalogPath = path.resolve(process.cwd(), 'data', 'index.json');
        if (fs.existsSync(catalogPath)) {
          const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
          this.dailyCatalogCache = raw.dailyCatalog?.tasks || [];
        } else {
          this.dailyCatalogCache = [];
        }
      }
      return (this.dailyCatalogCache || []).find((t: any) => t.tag === tagOrId || t.id === tagOrId) || null;
    } catch {
      return null;
    }
  }

  /**
   * Navigates to target page or hash if not already active.
   */
  private async navigateIfNeeded(targetUrl: string): Promise<void> {
    const currentUrl = this.page.url();
    const hash = targetUrl.includes('#') ? targetUrl.substring(targetUrl.indexOf('#')) : null;

    if (hash && currentUrl.includes(hash)) {
      return;
    }

    console.log(`[Workflow] 🧭 Navigating to: ${targetUrl}...`);
    await this.page.evaluate((dest: string) => {
      if (dest.startsWith('#')) {
        window.location.hash = dest;
      } else if (dest.includes('#')) {
        const h = dest.substring(dest.indexOf('#'));
        window.location.hash = h;
      } else {
        window.location.href = dest;
      }
    }, targetUrl).catch(() => null);

    await this.sentinel.assertSafe();
    await logNormalDelay(600, 0.2);
    await this.handleDismissPopups();
  }

  /**
   * Evaluates whether a target element or quest is finished today.
   */
  private async evaluateTargetFinished(selector: string): Promise<boolean> {
    return await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (!el) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';

      const classes = el.className || '';
      const text = (el.innerText || '').trim();
      const limitedCount = el.getAttribute('data-limited_count');
      const isCleared = el.getAttribute('data-cleared');
      const exchangeLimit = el.getAttribute('data-exchange-limit');

      // 1. Explicit GBF zero-remaining attributes
      if (limitedCount === '0' || isCleared === '1' || exchangeLimit === '0') return true;

      // 2. Element disabled classes
      if (classes.includes('is-completed') || classes.includes('btn-disable') || classes.includes('btn-cleared')) return true;
      if (classes.includes('disable') && !classes.includes('btn-enable')) return true;

      // 3. Text patterns indicating completion
      if (/\b0\s*\/\s*\d+/.test(text)) return true;
      if (/completed|finished|達成済み|本日分終了|残り\s*0\s*個|0\s*left/i.test(text)) return true;

      // 4. Button disabled attribute
      if ((el as HTMLButtonElement).disabled) return true;

      return false;
    }, selector).catch(() => false);
  }

  /**
   * Handles AP recovery modal if present, consuming Half-Elixir if autoElixir is permitted.
   */
  private async handleApRecoveryModal(): Promise<boolean> {
    const recoveryNeeded = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item');
      return !!modal;
    }).catch(() => false);

    if (!recoveryNeeded) return false;

    if (this.template.autoElixir === false) {
      console.warn('[Workflow] AP recovery modal detected, but autoElixir is disabled.');
      await this.page.evaluate(() => {
        const cancelBtn = document.querySelector('.pop-usual .btn-usual-cancel, .pop-show .btn-usual-cancel') as HTMLElement;
        if (cancelBtn) cancelBtn.click();
      }).catch(() => null);
      return false;
    }

    console.log('[Workflow] 🧪 AP recovery needed. Consuming Half-Elixir...');
    await this.page.evaluate(() => {
      const useBtn = document.querySelector('.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item') as HTMLElement;
      if (useBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(useBtn).trigger('tap');
        useBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);

    // Confirm item usage
    await this.page.evaluate(() => {
      const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok') as HTMLElement;
      if (okBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);
    await this.sentinel.assertSafe();
    return true;
  }

  /**
   * Detects and handles Replicard AAP (Arcarum Action Points) recovery modal.
   * Restores AAP using Half-Elixir / Elixir and confirms replenishment dialog.
   */
  public async handleAapRecoveryModal(autoReplenishAap = true): Promise<boolean> {
    try {
      const isAapModal = await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-usual');
        if (!pop) return false;
        const text = (pop as HTMLElement).innerText || '';
        return text.includes('AAP') || text.includes('回復') || text.includes('recover') || !!pop.querySelector('.btn-use-item');
      });

      if (!isAapModal) return false;

      console.log(`[${this.accountId}] [Replicard] AAP recovery modal detected.`);
      if (!autoReplenishAap) {
        console.warn(`[${this.accountId}] [Replicard] AAP replenishment is disabled. Canceling modal.`);
        const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel');
        if (cancelBtn) await humanizedClick(this.page, cancelBtn);
        return false;
      }

      console.log(`[${this.accountId}] [Replicard] Consuming item to restore AAP...`);
      const useItemBtn = await this.page.waitForSelector('.pop-usual .btn-use-item, .btn-use-item', { visible: true, timeout: 5000 }).catch(() => null);
      if (useItemBtn) {
        await humanReactionDelay(250, 0.18);
        await humanizedClick(this.page, useItemBtn);
        await logNormalDelay(600, 0.15);

        const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok, .btn-usual-ok', { visible: true, timeout: 5000 }).catch(() => null);
        if (confirmBtn) {
          await humanReactionDelay(250, 0.18);
          await humanizedClick(this.page, confirmBtn);
          await logNormalDelay(800, 0.15);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures the Cygames Pro Quest List modal (.pop-pro-quest-list) is open on #quest/extra.
   */
  private async ensureProListModalOpen(): Promise<boolean> {
    const isAlreadyOpen = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-pro-quest-list.pop-show') as HTMLElement;
      return !!(modal && modal.offsetParent !== null && window.getComputedStyle(modal).display !== 'none');
    }).catch(() => false);

    if (isAlreadyOpen) return true;

    // Await pro button on #quest/extra or #quest if page is still rendering
    await this.page.waitForSelector('.btn-pro-list, .btn-pro-quest, #js-pro-list-button .btn-pro-list, .prt-pro-list-wrapper .btn-pro-list, [data-location-id="pro_quest"]', { visible: true, timeout: 3500 }).catch(() => null);

    // Look for .btn-pro-list on #quest/extra or #quest
    const opened = await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-pro-list, .btn-pro-quest, #js-pro-list-button .btn-pro-list, .prt-pro-list-wrapper .btn-pro-list, [data-location-id="pro_quest"]') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (!opened) {
      return false;
    }

    // Await modal appearance
    await this.page.waitForSelector('.pop-pro-quest-list.pop-show', { visible: true, timeout: 5000 }).catch(() => null);
    await logNormalDelay(400, 0.15);
    return true;
  }

  /**
   * Closes the Pro Quest List modal if it is currently open.
   */
  private async closeProListModalIfOpen(): Promise<void> {
    await this.page.evaluate(() => {
      const closeBtn = document.querySelector('.pop-pro-quest-list .btn-usual-close') as HTMLElement;
      if (closeBtn) closeBtn.click();
    }).catch(() => null);
    await logNormalDelay(250, 0.1);
  }

  /**
   * Automated Pro Skip execution targeting specific catalog item or selector.
   * Handles opening the Cygames Pro Quest List modal (.pop-pro-quest-list), switching
   * tabs (normal, high, extra), checking completion (0/N), AP replenishment, supporter start,
   * and result dismissal.
   */
  private async executeAutomatedProSkip(task: any, selector?: string): Promise<boolean> {
    const qId = task?.questId;
    const chId = task?.chapterId;
    const proChId = task?.proChapterId;
    const qName = task?.name || qId || 'Pro Skip';
    console.log(`[Workflow] ⚡ Checking Pro Skip: "${qName}"...`);

    const currentUrl = this.page.url();
    const isQuestExtra = currentUrl.includes('#quest/extra');

    if (isQuestExtra) {
      // 1. Open Pro List modal if not open
      const modalReady = await this.ensureProListModalOpen();
      if (!modalReady) {
        console.warn(`[Workflow] Could not open Pro Quest List modal on #quest/extra`);
        return false;
      }

      // 2. Find quest button across tabs (normal, high, extra) and trigger skip click
      const itemState = await this.page.evaluate(async (questId, chapterId, questName, proChapterId) => {
        const $ = (window as any).$ || (window as any).Zepto;
        const tabs = Array.from(document.querySelectorAll('.pop-pro-quest-list .btn-quest-type')) as HTMLElement[];
        const numTabs = tabs.length > 0 ? tabs.length : 1;

        const matchBanner = () => {
          const activeStage = document.querySelector('.pop-pro-quest-list .prt-stage-quest.active') ||
                              document.querySelector('.pop-pro-quest-list .prt-stage-quest');
          const banners = Array.from((activeStage || document).querySelectorAll('.prt-quest-banner')) as HTMLElement[];
          for (const b of banners) {
            const bQuestId = b.getAttribute('data-quest-id');
            const btn = b.querySelector('.btn-set-quest') as HTMLElement;
            const bChapterId = btn?.getAttribute('data-chapter-id');
            const bProChapterId = btn?.getAttribute('data-pro-chapter-id') || b.getAttribute('data-pro-chapter-id');
            const bName = (b.getAttribute('data-chapter-name') || b.querySelector('.txt-quest-name')?.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const qLower = (questName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            const isMatch = (questId && bQuestId === questId) ||
                            (chapterId && bChapterId === chapterId) ||
                            (proChapterId && bProChapterId === proChapterId) ||
                            (qLower && (bName.includes(qLower) || qLower.includes(bName))) ||
                            (questId === '305321' && (bName.includes('atum') || bName.includes('ennead')));

            if (isMatch) {
              return { banner: b, btn };
            }
          }
          return null;
        };

        for (let t = 0; t < numTabs; t++) {
          if (tabs[t]) {
            if ($) $(tabs[t]).trigger('tap');
            tabs[t].click();
            await new Promise(r => setTimeout(r, 350));
          }

          const matched = matchBanner();
          if (matched) {
            const { banner, btn } = matched;
            const isLocked = !!banner.querySelector('.ico-lock, .prt-lock, .btn-lock') ||
                             banner.classList.contains('is-locked') ||
                             banner.classList.contains('lock') ||
                             btn?.classList.contains('btn-lock') ||
                             banner.getAttribute('data-is-lock') === '1';

            const limited = btn?.getAttribute('data-limited_count');
            const isCleared = banner.classList.contains('onm-mask') ||
                              !!banner.querySelector('.ico-cleared, .prt-cleared') ||
                              (btn?.classList.contains('disable') && !isLocked) ||
                              btn?.classList.contains('has-error') ||
                              btn?.classList.contains('is-completed') ||
                              limited === '0';

            let clicked = false;
            if (!isLocked && !isCleared && btn) {
              if ($) $(btn).trigger('tap');
              btn.click();
              clicked = true;
            }

            return {
              found: true,
              isLocked,
              isCleared,
              clicked
            };
          }
        }

        return { found: false, isLocked: false, isCleared: false, clicked: false };
      }, qId, chId, qName, proChId);

      if (!itemState.found) {
        console.warn(`[Workflow] ⚠️ Quest "${qName}" (ID: ${qId}) not found in Pro Quest List modal.`);
        await this.closeProListModalIfOpen();
        return true;
      }

      if (itemState.isCleared) {
        console.log(`[Workflow] ✅ "${qName}" is already cleared today.`);
        await this.closeProListModalIfOpen();
        return true;
      }

      if (itemState.isLocked) {
        console.warn(`[Workflow] ⚠️ "${qName}" is locked (prerequisites not met on this account). Skipping...`);
        await this.closeProListModalIfOpen();
        return true;
      }

      if (!itemState.clicked) {
        console.warn(`[Workflow] Quest button for "${qName}" was not clickable. Skipping...`);
        await this.closeProListModalIfOpen();
        return true;
      }

      await logNormalDelay(500, 0.15);
      await this.sentinel.assertSafe();

      // 4. Handle Phase 1 confirmation modal (.pop-pro-quest-skip)
      const confirmOk = await this.page.waitForSelector('.pop-pro-quest-skip .btn-usual-ok, .pop-usual .btn-usual-ok', { visible: true, timeout: 6000 }).catch(() => null);
      if (confirmOk) {
        console.log(`[Workflow] Confirming skip dialog for "${qName}"...`);
        await this.page.evaluate(() => {
          const okBtn = document.querySelector('.pop-pro-quest-skip .btn-usual-ok, .pop-usual .btn-usual-ok') as HTMLElement;
          if (okBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(okBtn).trigger('tap');
            okBtn.click();
          }
        });
        await logNormalDelay(500, 0.15);
      }

      // 5. Check AP recovery modal
      await this.handleApRecoveryModal();

      // 6. Handle Phase 2 supporter screen (.se-quest-start)
      const startOk = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok[data-type-id="28"]', { visible: true, timeout: 8000 }).catch(() => null);
      if (startOk) {
        console.log(`[Workflow] Confirming final skip start on supporter screen (.se-quest-start)...`);
        await this.page.evaluate(() => {
          const startBtn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok[data-type-id="28"]') as HTMLElement;
          if (startBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(startBtn).trigger('tap');
            startBtn.click();
          }
        });
      }

      // 7. Await result resolution (#result_pro_quest_skip)
      console.log(`[Workflow] Awaiting result for "${qName}"...`);
      await this.page.waitForFunction(() => {
        return window.location.hash.includes('result_pro_quest_skip') ||
               !!document.querySelector('.pop-exp, .prt-result-head');
      }, { timeout: 12000 }).catch(() => null);

      console.log(`[Workflow] 🎉 "${qName}" Pro Skip successfully cleared!`);
      await logNormalDelay(800, 0.2);

      // 8. Dismiss reward popups
      await this.handleDismissPopups();

      // 9. Safely return to #quest/extra for the next pro skip
      await this.navigateIfNeeded('https://game.granbluefantasy.jp/#quest/extra');
      return true;
    }

    // Fallback: If on #quest favorites list
    const favState = await this.page.evaluate((questId, chapterId, questName) => {
      const cards = Array.from(document.querySelectorAll('.prt-noindex-list .prt-list-contents, .cnt-quest .prt-list-contents'));
      for (const c of cards) {
        const proEl = c.querySelector('[data-pro-quest-skip="true"]') || (c.getAttribute('data-pro-quest-skip') === 'true' ? c : null);
        if (!proEl) continue;
        const qId = proEl.getAttribute('data-quest-id') || c.getAttribute('data-quest-id');
        const chId = proEl.getAttribute('data-pro-chapter-id') || c.getAttribute('data-pro-chapter-id');
        const name = c.getAttribute('data-quest-name') || proEl.getAttribute('data-quest-name') || c.querySelector('.txt-quest-title')?.textContent?.trim();

        if ((questId && qId === questId) || (chapterId && chId === chapterId) || (questName && name?.includes(questName))) {
          const limited = proEl.getAttribute('data-limited_count') || c.getAttribute('data-limited_count');
          return {
            found: true,
            isCleared: limited === '0' || c.classList.contains('is-completed') || c.classList.contains('disable')
          };
        }
      }
      return { found: false, isCleared: false };
    }, qId, chId, qName);

    if (favState.found && favState.isCleared) {
      console.log(`[Workflow] ✅ "${qName}" is already cleared in Favorites.`);
      return true;
    }

    // Default DOM click fallback
    const sel = selector || task?.selector || '.btn-pro-skip';
    return await this.executeGenericClickUntilFinish(sel);
  }

  /**
   * Automated 100-Draw Rupie Gacha execution.
   * Handles:
   * 1. Navigation directly to #gacha/normal
   * 2. Finding and clicking the 100-Draw button (.btn-lupi.multi[data-count="100"])
   * 3. Confirming expenditure modal (.btn-usual-ok)
   * 4. Fast-forwarding animation and dismissing result screen
   */
  private async executeAutomatedRupieGacha(task: any, selector?: string): Promise<boolean> {
    console.log('[Workflow] 🎁 Checking Daily 100-Draw Rupie Gacha...');

    // 1. Ensure navigation directly to #gacha/normal
    const currentUrl = this.page.url();
    if (!currentUrl.includes('#gacha/normal') && !currentUrl.includes('gacha/normal')) {
      console.log('[Workflow] 🧭 Navigating to #gacha/normal...');
      await this.page.evaluate(() => {
        window.location.hash = '#gacha/normal';
      });
      await logNormalDelay(1500, 0.2);
    }

    // Wait for the gacha container or .btn-lupi to appear
    await this.page.waitForSelector('.btn-lupi, [class*="btn-lupi"], .cnt-gacha, #gacha', { timeout: 8000 }).catch(() => null);
    await logNormalDelay(600, 0.15);

    // 2. Evaluate draw state on #gacha/normal
    const drawState = await this.page.evaluate((userSel?: string) => {
      const $ = (window as any).$ || (window as any).Zepto;

      // Check global completion text first
      const bodyText = document.body.innerText || '';
      if (bodyText.includes('本日分終了') || bodyText.includes('0/100') || bodyText.includes('100/100') || /0\s*left|Limit Reached/i.test(bodyText)) {
        return { status: 'already_drawn', reason: 'completion_text' };
      }

      // Locate the 100-Draw button:
      // Exact element: <div class="btn-lupi multi free" data-id="6002" data-count="100">
      let btn100 = (
        document.querySelector('.btn-lupi[data-count="100"]') ||
        document.querySelector('.btn-lupi.multi') ||
        document.querySelector('.btn-lupi[data-id="6002"]') ||
        document.querySelector('.btn-lupi.free') ||
        document.querySelector('.btn-lupi') ||
        (userSel ? document.querySelector(userSel) : null) ||
        document.querySelector('.btn-draw-100, .btn-multi-draw, .btn-draw')
      ) as HTMLElement;

      if (!btn100) {
        // Fallback: search by text for 100 draws
        const candidates = Array.from(document.querySelectorAll('.btn-draw, [class*="btn"], div, a')) as HTMLElement[];
        for (const c of candidates) {
          const t = (c.innerText || '').trim();
          if (
            t.includes('100回引く') ||
            t.includes('100連') ||
            t.includes('100回') ||
            t.includes('まとめて引く') ||
            t.includes('Draw 100') ||
            t.includes('100 Draws') ||
            t.includes('Draw Max')
          ) {
            btn100 = c;
            break;
          }
        }
      }

      if (!btn100) {
        return { status: 'not_found', reason: 'btn_lupi_missing' };
      }

      // Check if button is disabled or 0 remaining
      const classes = btn100.className || '';
      const count = btn100.getAttribute('data-count');
      const countZeroEl = btn100.querySelector('.txt-gacha-count .count-0');
      const countOneEl = btn100.querySelector('.txt-gacha-count .count-1');
      const btnText = btn100.innerText || '';

      if (
        classes.includes('disable') ||
        classes.includes('is-completed') ||
        classes.includes('btn-disable') ||
        (btn100 as HTMLButtonElement).disabled ||
        count === '0' ||
        (countZeroEl && !countOneEl && !count) ||
        btnText.includes('本日分終了') ||
        btnText.includes('0/100')
      ) {
        return { status: 'already_drawn', reason: 'button_disabled_or_zero_count' };
      }

      // Scroll into view if needed
      btn100.scrollIntoView({ behavior: 'instant', block: 'center' });

      // Click button
      if ($) $(btn100).trigger('tap');
      btn100.click();
      return { status: 'clicked', label: btnText || '100-Draw Rupie (.btn-lupi)' };
    }, selector);

    console.log(`[Workflow] Rupie Draw evaluation: ${JSON.stringify(drawState)}`);

    if (drawState.status === 'already_drawn') {
      console.log(`[Workflow] ✅ Rupie Gacha already drawn today (${drawState.reason}).`);
      return true;
    }

    if (drawState.status === 'not_found') {
      console.warn(`[Workflow] ⚠️ Could not find .btn-lupi on #gacha/normal. Retrying on next loop...`);
      return false;
    }

    if (drawState.status === 'clicked') {
      console.log(`[Workflow] Clicked Rupie 100-Draw. Confirming modal...`);
      await logNormalDelay(800, 0.15);

      // Confirm modal (e.g. pop-usual, pop-show)
      const confirmOk = await this.page.waitForSelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-settle, .btn-ok', { visible: true, timeout: 5000 }).catch(() => null);
      if (confirmOk) {
        await this.page.evaluate(() => {
          const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-settle, .btn-ok') as HTMLElement;
          if (okBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(okBtn).trigger('tap');
            okBtn.click();
          }
        });
      }

      // Wait for gacha result screen or animation
      await logNormalDelay(1500, 0.2);

      // Fast-forward / skip animation by clicking on the canvas/stage if present
      await this.page.evaluate(() => {
        const stage = document.querySelector('#stage, canvas, .cnt-gacha') as HTMLElement;
        if (stage) stage.click();
      }).catch(() => null);

      await logNormalDelay(1000, 0.2);

      // Wait for gacha result screen / close button
      await this.page.waitForFunction(() => {
        const hash = window.location.hash || '';
        return hash.includes('result') || !!document.querySelector('.prt-result, .pop-gacha-result, .btn-result-close, .btn-usual-ok');
      }, { timeout: 12000 }).catch(() => null);

      console.log('[Workflow] 🎉 Rupie 100-Draw successfully completed!');
      await logNormalDelay(800, 0.2);
      await this.handleDismissPopups();
      return true;
    }

    return false;
  }

  /**
   * Automated Skyscope Daily Missions claim execution.
   */
  private async executeAutomatedSkyscopeMission(task: any, selector?: string): Promise<boolean> {
    console.log('[Workflow] 🎯 Checking Skyscope Daily Missions...');
    await logNormalDelay(600, 0.15);

    const claimSelector = selector || '.btn-claim-all, .btn-receive-all, .prt-mission-complete .btn-receive-all, [data-action="claim-all"], .btn-all-receive';
    const claimState = await this.page.evaluate((sel: string) => {
      const btn = document.querySelector(sel) as HTMLElement;
      if (!btn || btn.offsetParent === null) return 'none_claimable';
      const classes = btn.className || '';
      if (classes.includes('disable')) return 'none_claimable';
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(btn).trigger('tap');
      btn.click();
      return 'claimed';
    }, claimSelector).catch(() => 'error');

    if (claimState === 'none_claimable' || claimState === 'error') {
      console.log('[Workflow] ✅ No unclaimed Skyscope missions pending.');
      return true;
    }

    if (claimState === 'claimed') {
      console.log('[Workflow] Claimed pending Skyscope missions. Dismissing rewards...');
      await logNormalDelay(600, 0.2);
      await this.handleDismissPopups();
      return true;
    }

    return true;
  }

  /**
   * Automated Casino daily item exchange execution.
   * Exchanges Half-Elixirs and Soul Berries up to daily cap.
   */
  private async executeAutomatedCasinoExchange(task: any, selector?: string): Promise<boolean> {
    console.log('[Workflow] 🎰 Checking Casino Daily Recovery Items Exchange...');

    // 1. Ensure navigation to #casino/exchange
    const currentUrl = this.page.url();
    if (!currentUrl.includes('casino/exchange')) {
      await this.navigateIfNeeded('https://game.granbluefantasy.jp/#casino/exchange');
      await logNormalDelay(1500, 0.2);
    }

    // 2. Check and exchange available daily items (Half-Elixir, Soul Berry)
    const exchangeResult = await this.page.evaluate(() => {
      const $ = (window as any).$ || (window as any).Zepto;
      const items = Array.from(document.querySelectorAll('.prt-item, .prt-exchange-item, .prt-trade-item, .lis-item'));

      for (const item of items) {
        const text = (item.textContent || '').trim();
        const isTarget = text.includes('Half Elixir') || text.includes('Soul Berry') ||
                         text.includes('エリクシールハーフ') || text.includes('ソウルシード');
        if (!isTarget) continue;

        const btn = item.querySelector('.btn-exchange, .btn-trade, [data-action="exchange"]') as HTMLElement;
        if (!btn || btn.offsetParent === null) continue;

        const isDisabled = btn.classList.contains('disable') || text.includes('0 left') || text.includes('残り0') || text.includes('0/100');
        if (!isDisabled) {
          if ($) $(btn).trigger('tap');
          btn.click();
          return { itemFound: true, itemName: text.includes('Elixir') || text.includes('エリクシール') ? 'Half-Elixir' : 'Soul Berry' };
        }
      }

      return { itemFound: false, itemName: '' };
    }).catch(() => ({ itemFound: false, itemName: '' }));

    if (!exchangeResult.itemFound) {
      console.log('[Workflow] ✅ Casino daily exchanges already completed (0 stock remaining).');
      return true; // All items fully exchanged
    }

    console.log(`[Workflow] Exchanging daily stock for "${exchangeResult.itemName}"...`);
    await logNormalDelay(600, 0.15);

    // Max quantity slider / button
    await this.page.evaluate(() => {
      const maxBtn = document.querySelector('.btn-max, .btn-use-max, .btn-trade-max') as HTMLElement;
      if (maxBtn) maxBtn.click();
    }).catch(() => null);
    await logNormalDelay(400, 0.1);

    // Click confirm / OK
    await this.page.evaluate(() => {
      const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-settle') as HTMLElement;
      if (okBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
      }
    }).catch(() => null);
    await logNormalDelay(800, 0.2);

    // Dismiss any success popups
    await this.handleDismissPopups();

    // Return false so next loop cycle exchanges remaining item (e.g. Soul Berry after Half-Elixir)
    return false;
  }

  /**
   * Generic fallback click and modal dismissal.
   */
  private async executeGenericClickUntilFinish(selector?: string): Promise<boolean> {
    if (!selector) return true;
    const clicked = await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el && el.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        el.click();
        return true;
      }
      return false;
    }, selector).catch(() => false);

    if (clicked) {
      await logNormalDelay(400, 0.15);
      await this.handleDismissPopups();
      return true;
    }
    return false;
  }

  /**
   * Universal Daily & Workflow Handler:
   * Executes a task or sequence of subSteps repeatedly until completion criteria are fulfilled.
   * Can resolve predefined data tags from data/index.json (e.g. daily_magna_pro, daily_rupie, daily_skyscope)
   * or navigate to arbitrary pages and interact with selectors until finished (data-limited_count="0", .is-completed, disabled).
   */
  private async handleDoUntilFinish(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const tag = step.tag || step.target;
    const task = tag ? this.getDailyCatalogTask(tag) : null;

    const taskName = task?.name || step.name || tag || step.target || 'Custom Daily Target';
    const targetUrl = step.page || task?.pageUrl;
    const targetSelector = step.target && step.target !== tag ? step.target : (task?.selector || step.target);
    const maxLoops = step.maxLoops || 20;

    console.log(`[Workflow] 🔄 Starting do_until_finish: "${taskName}" (max loops: ${maxLoops})...`);

    // 1. Navigation if page specified and not already on it
    if (targetUrl) {
      await this.navigateIfNeeded(targetUrl);
    }

    // 2. Loop until finished
    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (this.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      // Check if target is completed (skip for automated routines as their handlers manage inspection internally)
      const isAutomatedRoutine = task && ['pro_skip', 'gacha', 'mission', 'shop', 'casino'].includes(task.category);
      if (targetSelector && !isAutomatedRoutine) {
        const isFinished = await this.evaluateTargetFinished(targetSelector);
        if (isFinished) {
          console.log(`[Workflow] 🏁 do_until_finish: "${taskName}" is completed! (cycle ${loopIdx + 1})`);
          await this.handleDismissPopups();
          return true;
        }
      }

      // If user provided explicit subSteps, execute them
      if (step.subSteps && step.subSteps.length > 0) {
        console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Executing ${step.subSteps.length} sub-steps for "${taskName}"...`);
        for (let s = 0; s < step.subSteps.length; s++) {
          const sub = step.subSteps[s];
          const ok = await this.executeSingleStep(sub, s + 1, runNumber);
          if (!ok && !sub.optional) {
            console.warn(`[Workflow] Sub-step ${s + 1} (${sub.code}) failed inside do_until_finish.`);
            return false;
          }
        }
        await logNormalDelay(400, 0.15);
        continue;
      }

      // If no subSteps provided, execute automated category routine
      const category = task?.category || 'custom';
      console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Executing built-in routine for category "${category}"...`);

      let cycleSuccess = false;
      if (category === 'pro_skip') {
        cycleSuccess = await this.executeAutomatedProSkip(task, targetSelector);
      } else if (category === 'gacha') {
        cycleSuccess = await this.executeAutomatedRupieGacha(task, targetSelector);
      } else if (category === 'mission') {
        cycleSuccess = await this.executeAutomatedSkyscopeMission(task, targetSelector);
      } else if (category === 'shop' || category === 'casino') {
        cycleSuccess = await this.executeAutomatedCasinoExchange(task, targetSelector);
      } else {
        cycleSuccess = await this.executeGenericClickUntilFinish(targetSelector);
      }

      if (cycleSuccess) {
        console.log(`[Workflow] 🏁 do_until_finish: "${taskName}" verified complete.`);
        return true;
      }

      await logNormalDelay(500, 0.15);
    }

    console.log(`[Workflow] ⏹️ do_until_finish reached max loops (${maxLoops}) for "${taskName}".`);
    await this.handleDismissPopups();
    return true;
  }

  /**
   * Executes a repeat block of subSteps.
   */
  private async handleRepeat(step: WorkflowStep, runNumber: number): Promise<boolean> {
    if (!step.subSteps || step.subSteps.length === 0) return true;
    const count = step.repeatCount || 1;

    for (let r = 0; r < count; r++) {
      if (this.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      await this.syncCurrentHonors();

      if (this.template.targetScore && this.currentScore >= this.template.targetScore) {
        console.log(`[Repeat Block] Target score reached (${this.currentScore.toLocaleString()} >= ${this.template.targetScore.toLocaleString()} pt). Exiting repeat block.`);
        return true;
      }

      if (await this.isBattleEnded()) {
        console.log('[Repeat Block] Battle concluded during repeat loop. Exiting block.');
        return true;
      }

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];

        // Check explicit exit_if_score inside repeat block
        if (sub.code === 'exit_if_score' || sub.action === 'exit_if_score') {
          await this.syncCurrentHonors();
          const threshold = sub.targetScore || this.template.targetScore || 1480000;
          if (this.currentScore >= threshold) {
            console.log(`[Repeat Block] Honor threshold met (${this.currentScore.toLocaleString()} >= ${threshold.toLocaleString()} pt). Exiting repeat block early.`);
            return true;
          }
          console.log(`[Repeat Block] Current honors (${this.currentScore.toLocaleString()} pt) below threshold (${threshold.toLocaleString()} pt). Continuing loop...`);
          continue;
        }

        if (this.template.targetScore) {
          await this.syncCurrentHonors();
          if (this.currentScore >= this.template.targetScore) {
            console.log(`[Repeat Block] Target score reached (${this.currentScore.toLocaleString()} >= ${this.template.targetScore.toLocaleString()} pt). Exiting repeat block early.`);
            return true;
          }
        }

        const ok = await this.executeSingleStep(sub, s + 1, runNumber);
        if (!ok && !sub.optional) return false;
      }
    }

    return true;
  }

  /**
   * Evaluates early exit condition based on current honors.
   */
  private async handleExitIfScore(step: WorkflowStep): Promise<boolean> {
    await this.syncCurrentHonors();
    const threshold = step.targetScore || this.template.targetScore || 1480000;
    if (this.currentScore >= threshold) {
      console.log(`[Combat] Honor threshold met (${this.currentScore.toLocaleString()} >= ${threshold.toLocaleString()} pt). Exiting combat.`);
      return true;
    }
    return true;
  }

  /**
   * Waits until the combat turn counter reaches targetTurn.
   */
  private async handleWaitTurn(step: WorkflowStep): Promise<boolean> {
    const targetTurn = step.condition?.value || 2;
    const start = Date.now();
    while (Date.now() - start < (step.timeoutMs || 10000)) {
      if (this.stopRequested) return false;
      if (await this.isBattleEnded()) return true;
      if (this.currentTurn >= targetTurn) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  /**
   * Selects an enemy target index (1, 2, or 3).
   */
  private async handleTargetEnemy(step: WorkflowStep): Promise<boolean> {
    const enemyIdx = step.enemyIndex || 1;
    const selector = `.lis-enemy[pos="${enemyIdx - 1}"], .btn-enemy-${enemyIdx}, .prt-targeting[pos="${enemyIdx - 1}"]`;

    const enemyEl = await this.page.waitForSelector(selector, { visible: true, timeout: 3000 }).catch(() => null);
    if (enemyEl) {
      await humanizedClick(this.page, enemyEl);
      await logNormalDelay(150, 0.1);
      return true;
    }
    return false;
  }

  /**
   * Uses temporary potion (Green, Blue, or Elixir).
   */
  private async handleHeal(step: WorkflowStep): Promise<boolean> {
    const pType = step.potionType || 'green';

    // 1. Open temporary item tray
    const tempTrayBtn = await this.page.$('.btn-temporary, .btn-item');
    if (tempTrayBtn) {
      await humanizedClick(this.page, tempTrayBtn);
      await humanReactionDelay(120, 0.1);
    }

    // 2. Click potion item
    const itemSelector = pType === 'green'
      ? '.lis-item[item-id="1"], .btn-item-small'
      : pType === 'blue'
      ? '.lis-item[item-id="2"], .btn-item-all'
      : '.lis-item[item-id="3"], .btn-item-elixir';

    const potionBtn = await this.page.waitForSelector(itemSelector, { visible: true, timeout: 2500 }).catch(() => null);
    if (potionBtn) {
      await humanizedClick(this.page, potionBtn);
      // 3. Confirm usage OK if present
      const okBtn = await this.page.waitForSelector('.btn-usual-ok.btn-item-use, .btn-usual-ok.se-use', { visible: true, timeout: 1500 }).catch(() => null);
      if (okBtn) await humanizedClick(this.page, okBtn);
      await logNormalDelay(250, 0.1);
      return true;
    }
    return false;
  }

  /**
   * Sends a backup request to everyone in multi-raids.
   */
  private async handleBackupRequest(): Promise<boolean> {
    const assistBtn = await this.page.$('.btn-assist, .btn-request');
    if (assistBtn) {
      await humanizedClick(this.page, assistBtn);
      await humanReactionDelay(150, 0.1);

      const requestAllBtn = await this.page.waitForSelector('.btn-assist-all, .btn-usual-ok', { visible: true, timeout: 2000 }).catch(() => null);
      if (requestAllBtn) {
        await humanizedClick(this.page, requestAllBtn);
        await logNormalDelay(200, 0.1);
        return true;
      }
    }
    return false;
  }

  /**
   * Closes any open character ability drawer, skill details popup, target selection, or lingering modals.
   */
  private async dismissCombatDrawersAndPopups(): Promise<boolean> {
    try {
      const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
      const dismissed = await this.page.evaluate(() => {
        let acted = false;

        // Fast-forward active tweens and release visual/button locks immediately
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(2000, false);
        }
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }

        // 1. Dismiss any open modal / popup dialog (.pop-usual, .prt-popup-header .btn-close, etc.)
        const popBtns = Array.from(document.querySelectorAll(
          '.pop-usual .btn-close, .pop-usual .btn-usual-ok, .pop-usual .btn-usual-cancel, .prt-popup-header .btn-close, .btn-usual-close, .prt-popup-footer .btn-usual-ok'
        )) as HTMLElement[];
        for (const btn of popBtns) {
          if (btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none') {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
            acted = true;
          }
        }

        // 2. Close character ability drawer if open (Back button)
        const backBtn = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (backBtn && backBtn.offsetParent !== null && window.getComputedStyle(backBtn).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(backBtn).trigger('tap');
          backBtn.click();
          acted = true;
        }

        // 3. Clear READY screen if present
        const readyEl = document.querySelector('.prt-ready, #ready') as HTMLElement;
        if (readyEl && readyEl.offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(readyEl).trigger('tap');
          readyEl.click();
          acted = true;
        }

        return acted;
      });

      // If canvas READY overlay is active, discard it immediately with a physical touch tap
      const hasReady = await this.page.evaluate(() => {
        const ready = document.querySelector('.prt-ready, #ready');
        return !!ready && (ready as HTMLElement).offsetWidth > 0;
      }).catch(() => false);

      if (hasReady) {
        const vp = this.page.viewport() || { width: 480, height: 960 };
        const cx = Math.round(vp.width * 0.5);
        const cy = Math.round(vp.height * 0.35);
        await this.page.touchscreen.tap(cx, cy).catch(() => null);
        await this.page.mouse.click(cx, cy).catch(() => null);
        if (!isTurbo) await logNormalDelay(100, 0.1);
      }

      if (dismissed && !isTurbo) {
        await logNormalDelay(150, 0.12);
      }
      return dismissed;
    } catch {
      return false;
    }
  }

  /**
   * Waits for combat input readiness (verifies that stage locks and animation flags have cleared).
   * Accurately recognizes readiness whether on the main combat HUD, inside an open ability drawer,
   * or during character command mode without false display-off timeouts.
   */
  private async waitForCombatInputReady(timeoutMs = 6000): Promise<boolean> {
    const start = Date.now();
    const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const pollInterval = isTurbo ? 35 : (this.template?.speedProfile === 'fast' ? 50 : 80);

    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return false;
      if (await this.isBattleEnded()) return true;

      const isReady = await this.page.evaluate(() => {
        // 1. Must not have turn processing popup blocking input
        const pop = document.querySelector('.pop-usual, .prt-popup-header');
        if (pop && (pop as HTMLElement).offsetParent !== null) {
          const text = (pop as HTMLElement).innerText || '';
          if (text.includes('Processing') || text.includes('処理中') || text.includes('Wait') || text.includes('wait')) {
            return false;
          }
        }

        const stage = (window as any).stage;
        const lock = stage?.gGameStatus?.lock === true;
        const btnLock = stage?.gGameStatus?.btn_lock === true;
        const attacking = stage?.gGameStatus?.attacking === true;
        // In GBF, stage.gGameStatus.animation is purely visual canvas rendering and does NOT block player input.
        // Input is strictly gated by engine lock, button lock, or attacking state.
        if (lock || btnLock || attacking) return false;

        // 2. Ready if attack button is on and visible
        const atkBtn = document.querySelector('.btn-attack-start.display-on') as HTMLElement;
        if (atkBtn && atkBtn.offsetWidth > 0) return true;

        // 3. Ready if character ability drawer is open and Back button is active
        const backBtn = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (backBtn && backBtn.offsetWidth > 0 && window.getComputedStyle(backBtn).display !== 'none') return true;

        // 4. Ready if character portraits are initialized, stage status exists, and ready screen is gone
        const chara = document.querySelector('.lis-character0.btn-command-character, .lis-character0') as HTMLElement;
        const readyEl = document.querySelector('.prt-ready, #ready') as HTMLElement;
        const hasReady = readyEl && readyEl.offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none';
        if (chara && chara.offsetWidth > 0 && !hasReady && stage?.gGameStatus) return true;

        // 5. Ready if Quick Summon is ready
        const qsBtn = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
        if (qsBtn && qsBtn.offsetWidth > 0) return true;

        return false;
      }).catch(() => false);

      if (isReady) return true;
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return false;
  }

  /**
   * Triggers a character skill (Character 1-4, Skill 1-4) with state-aware tray handling.
   */
  private async handleSkill(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const char = step.character || 1;
    const skill = step.skill || 1;
    const skillSelector = `.ability-character-num-${char}-${skill}`;

    // 1. Check if the target skill button is already visible in the open drawer
    let isVisible = await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
    }, skillSelector).catch(() => false);

    // If not visible, dismiss open drawers/popups to switch character or clear overlays
    if (!isVisible) {
      await this.dismissCombatDrawersAndPopups();
      // Proactively dismiss READY overlay so character portraits are clickable immediately
      await this.page.evaluate(() => {
        const readyEl = document.querySelector('.prt-ready, #ready') as HTMLElement;
        if (readyEl && readyEl.offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(readyEl).trigger('tap');
          readyEl.click();
        }
      }).catch(() => null);
      await this.page.touchscreen.tap(240, 260).catch(() => null);
    }

    // 2. Wait for combat state to be ready (lock === false and not attacking)
    await this.waitForCombatInputReady(isTurbo ? 2000 : 5000);
    if (await this.isBattleEnded()) return true;

    // 3. Re-verify visibility after HUD ready
    if (!isVisible) {
      isVisible = await this.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
      }, skillSelector).catch(() => false);
    }

    // 4. If skill button is not visible, switch or open this character's ability drawer
    if (!isVisible) {
      const charIdx = char - 1;
      // Target ONLY the clickable character portrait, NEVER the parent column container!
      const charSelector = `.lis-character${charIdx}.btn-command-character, .lis-character${charIdx}`;

      // Find character portrait (in GBF, clicking the portrait directly switches drawer without needing Back first)
      let charBtn = await this.page.waitForSelector(charSelector, { visible: true, timeout: 3500 }).catch(() => null);
      if (!charBtn) {
        // Clear canvas or drawer if portrait was obscured
        await this.page.touchscreen.tap(240, 260).catch(() => null);
        if (!isTurbo) await logNormalDelay(150, 0.15);
        charBtn = await this.page.waitForSelector(charSelector, { visible: true, timeout: 2500 }).catch(() => null);
      }

      if (charBtn) {
        // Physical click + Zepto tap event trigger on character portrait
        await humanizedClick(this.page, charBtn);
        await charBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(el).trigger('tap');
            $(el).trigger('click');
          }
          el.click();
        }).catch(() => null);

        if (!isTurbo) await logNormalDelay(150, 0.12);
      } else {
        console.warn(`[Combat] Character portrait for C${char} not found!`);
        if (!step.optional) return false;
      }

      // Wait for the skill button to become visible inside the opened drawer
      isVisible = await this.page.waitForFunction((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
      }, { timeout: 2500 }, skillSelector).then(() => true).catch(() => false);

      if (!isVisible) {
        // Secondary attempt: dismiss any canvas overlay, re-tap character portrait
        console.log(`[Combat] Skill C${char}S${skill} not visible on first tap, re-tapping character portrait...`);
        await this.page.touchscreen.tap(240, 260).catch(() => null);
        if (!isTurbo) await logNormalDelay(100, 0.1);

        const retryCharBtn = await this.page.$(charSelector);
        if (retryCharBtn) {
          await humanizedClick(this.page, retryCharBtn);
          await retryCharBtn.evaluate((el: any) => {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) {
              $(el).trigger('tap');
              $(el).trigger('click');
            }
            el.click();
          }).catch(() => null);
          if (!isTurbo) await logNormalDelay(200, 0.15);
        }

        isVisible = await this.page.waitForFunction((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
        }, { timeout: 3000 }, skillSelector).then(() => true).catch(() => false);
      }
    }

    // 5. Retrieve visible skill button handle
    const skillBtn = await this.page.waitForSelector(skillSelector, { visible: true, timeout: 3000 }).catch(() => null);
    if (!skillBtn) {
      console.warn(`[Combat] Skill C${char}S${skill} could not be made visible!`);
      return step.optional ? true : false;
    }

    // 6. Check if skill is on cooldown / disabled / empty
    const isUnavailable = await this.page.evaluate((el: any) => {
      return el.classList.contains('btn-ability-unavailable') ||
             el.classList.contains('disabled') ||
             el.classList.contains('empty');
    }, skillBtn).catch(() => false);

    if (isUnavailable) {
      if (step.optional) {
        console.log(`[Combat] Skill C${char}S${skill} is on cooldown or unavailable (optional: skipped).`);
        return true;
      }
      console.warn(`[Combat] Skill C${char}S${skill} is on cooldown!`);
      return true;
    }

    // 7. Arm network response promise for ability_result.json
    const netPromise = this.waitForNetworkResponse('ability_result.json', 3500);

    // 8. Click the skill button (both physical CDP click + Zepto tap event)
    await humanizedClick(this.page, skillBtn);
    await skillBtn.evaluate((el: any) => {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(el).trigger('tap');
    }).catch(() => null);

    // If ability confirmation modal appears (for accounts with ability confirmation enabled in GBF settings)
    const confirmBtn = await this.page.waitForSelector('.btn-usual-ok.btn-ability-use, .pop-usual .btn-usual-ok, .btn-usual-ok.se-ability-use', {
      visible: true,
      timeout: 350
    }).catch(() => null);
    if (confirmBtn) {
      await humanizedClick(this.page, confirmBtn);
      await confirmBtn.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
      }).catch(() => null);
      if (!isTurbo) await logNormalDelay(100, 0.1);
    }

    // 9. Handle targeted skill (e.g. single-target ally buff like Florence S1 on MC)
    if (step.targetCharacter) {
      const targetIdx = step.targetCharacter - 1;
      const targetSelector = `.pop-usual .lis-character${targetIdx}.btn-command-character, .lis-character${targetIdx}.btn-command-character.front-member, .prt-popup-body .lis-character${targetIdx}, .pop-usual .lis-character${targetIdx}`;

      const targetEl = await this.page.waitForSelector(targetSelector, { visible: true, timeout: 5000 }).catch(() => null);
      if (targetEl) {
        if (!isTurbo) await logNormalDelay(100, 0.12);
        await humanizedClick(this.page, targetEl);
        await targetEl.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
        }).catch(() => null);
        if (!isTurbo) await logNormalDelay(150, 0.15);
      } else {
        console.warn(`[Combat] Target selection modal for Char ${step.targetCharacter} not found!`);
      }
    }

    // 10. Wait for ability_result.json from the server
    await netPromise;

    // Fast-bypass skill cut-in and particle animation, and immediately close ability drawer
    await this.page.evaluate(() => {
      const cjs = (window as any).createjs;
      if (cjs?.Tween?.tick) {
        cjs.Tween.tick(3000, false);
      }
      const stage = (window as any).stage;
      if (stage?.gGameStatus) {
        stage.gGameStatus.lock = false;
        stage.gGameStatus.btn_lock = false;
        stage.gGameStatus.animation = false;
      }
      // Force close character ability drawer to immediately expose Attack button
      const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
      if (back && back.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(back).trigger('tap');
        back.click();
      }
    }).catch(() => null);

    // 11. Snappy wait for input readiness (max 500ms in turbo)
    await this.waitForCombatInputReady(isTurbo ? 500 : 3000);
    if (!isTurbo) await logNormalDelay(60, 0.15);

    // Proactively dismiss any remaining modal backdrop/popups and ensure drawer closed
    await this.dismissCombatDrawersAndPopups();

    return true;
  }

  /**
   * Invokes a specific summon slot.
   */
  private async handleSummon(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    await this.waitForCombatInputReady(isTurbo ? 2000 : 4000);
    if (await this.isBattleEnded()) return true;

    const targetName = (step.target || '').toLowerCase().trim();
    let slot = step.slot || (targetName === 'hades' ? 6 : 1);

    if (targetName) {
      const dynamicSlot = await this.page.evaluate((target: string) => {
        const stage = (window as any).stage;
        const rawSummons = stage?.pJsnData?.summon || stage?.gGameStatus?.summon;
        if (rawSummons) {
          const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);
          for (let idx = 0; idx < summonsList.length; idx++) {
            const s: any = summonsList[idx];
            if (!s) continue;
            const name = String(s.name || '').toLowerCase();
            const id = String(s.id || '');
            const isReady = s.available_flag === 1 || s.available_flag === true || s.recast === '0' || s.recast === 0;
            if (target === 'agni' || target === 'agnis') {
              if (name.includes('agni') || name.includes('アグニス') || id.startsWith('2040023') || id.startsWith('2040094') || id.startsWith('2040417')) {
                if (isReady) return idx + 1;
              }
            } else if (target === 'hades') {
              if (name.includes('hades') || name.includes('ハデス') || id.startsWith('2040065') || id.startsWith('2040090') || id.startsWith('2040416') || id.startsWith('2040411')) {
                if (isReady) return idx + 1;
              }
            } else if (target === 'bahamut' || target === 'baha') {
              if (name.includes('bahamut') || name.includes('バハムート') || id.startsWith('2040003') || id.startsWith('2040056') || id.startsWith('2040412')) {
                if (isReady) return idx + 1;
              }
            } else if (name.includes(target) || id.includes(target)) {
              if (isReady) return idx + 1;
            }
          }
          // Secondary pass if no ready summon was found
          for (let idx = 0; idx < summonsList.length; idx++) {
            const s: any = summonsList[idx];
            if (!s) continue;
            const name = String(s.name || '').toLowerCase();
            const id = String(s.id || '');
            if (target === 'hades' && (name.includes('hades') || name.includes('ハデス') || id.startsWith('2040065') || id.startsWith('2040090') || id.startsWith('2040416') || id.startsWith('2040411'))) {
              return idx + 1;
            }
            if ((target === 'agni' || target === 'agnis') && (name.includes('agni') || name.includes('アグニス') || id.startsWith('2040023') || id.startsWith('2040094') || id.startsWith('2040417'))) {
              return idx + 1;
            }
            if (name.includes(target) || id.includes(target)) {
              return idx + 1;
            }
          }
        }

        // Also inspect DOM elements
        const summonEls = document.querySelectorAll('.lis-summon');
        for (let idx = 0; idx < summonEls.length; idx++) {
          const el = summonEls[idx];
          const imgSrc = el.querySelector('img')?.getAttribute('src') || '';
          const posAttr = el.getAttribute('pos');
          const posNum = posAttr ? parseInt(posAttr, 10) : (idx + 1);
          if (target === 'agni' || target === 'agnis') {
            if (imgSrc.includes('2040023') || imgSrc.includes('2040094') || imgSrc.includes('2040417')) {
              return posNum;
            }
          } else if (target === 'hades') {
            if (imgSrc.includes('2040065') || imgSrc.includes('2040090') || imgSrc.includes('2040416') || imgSrc.includes('2040411')) {
              return posNum;
            }
          }
        }
        return null;
      }, targetName).catch(() => null);

      if (dynamicSlot && dynamicSlot >= 1 && dynamicSlot <= 6) {
        slot = dynamicSlot;
        console.log(`[Workflow] Resolved summon "${targetName}" to slot ${slot}`);
      } else {
        console.log(`[Workflow] Summon "${targetName}" dynamic search deferred, using slot ${slot}`);
      }
    }

    // Open summon tray if not already open
    const isSummonOpen = await this.page.evaluate(() => {
      const slotEl = document.querySelector('.lis-summon');
      return !!slotEl && (slotEl as HTMLElement).offsetWidth > 0;
    }).catch(() => false);

    if (!isSummonOpen) {
      const summonTrayBtn = await this.page.$('.btn-summon-available, .btn-command-summon');
      if (summonTrayBtn) {
        await humanizedClick(this.page, summonTrayBtn);
        if (!isTurbo) await humanReactionDelay(180, 0.1);
      }
    }

    // Click summon slot strictly matching target slot (pos="1" is Main, pos="2" is Sub 1, etc.)
    let summonSlot = await this.page.waitForSelector(
      `.lis-summon[pos="${slot}"], .btn-summon-use[pos="${slot}"], #canv-summon-pos-${slot}, .lis-summon.summon-${slot}, div[pos="${slot}"].lis-summon`,
      { visible: true, timeout: 3500 }
    ).catch(() => null);

    // Fallback: query all summon cards and pick exact index (slot - 1)
    if (!summonSlot) {
      const allSummons = await this.page.$$('.lis-summon');
      if (allSummons && allSummons.length >= slot) {
        summonSlot = allSummons[slot - 1];
      }
    }

    if (summonSlot) {
      const netPromise = step.waitForNetwork ? this.waitForNetworkResponse(step.waitForNetwork, 4000) : Promise.resolve(true);
      await humanizedClick(this.page, summonSlot);
      if (!isTurbo) await logNormalDelay(150, 0.1);

      // Click confirm summon OK if present
      const okBtn = await this.page.waitForSelector(
        '.btn-usual-ok.btn-summon-use, .pop-summon-detail .btn-usual-ok, .pop-usual.pop-show .btn-usual-ok, .btn-summon-use, .btn-call, .se-summon-call',
        { visible: true, timeout: 1800 }
      ).catch(() => null);
      if (okBtn) {
        await humanizedClick(this.page, okBtn);
      }

      await netPromise;
      // Proactively dismiss any lingering summon detail modal, fast-forward summon animation, and clear locks
      await this.page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(3000, false);
        }
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }
        const pop = document.querySelector('.pop-summon-detail, .pop-usual.pop-show, .prt-popup-header .btn-close') as HTMLElement;
        if (pop && pop.offsetParent !== null) {
          const close = pop.querySelector('.btn-close, .btn-usual-ok, .btn-usual-cancel') as HTMLElement;
          if (close) close.click();
        }
      }).catch(() => null);
      await this.waitForCombatInputReady(isTurbo ? 400 : 3000);
      return true;
    }

    return step.optional ? true : false;
  }

  /**
   * Toggles Full Auto / Semi Auto.
   */
  private async handleAuto(step: WorkflowStep): Promise<boolean> {
    const autoBtn = await this.page.waitForSelector('.btn-auto', { visible: true, timeout: 3000 }).catch(() => null);
    if (autoBtn) {
      await humanizedClick(this.page, autoBtn);
      return true;
    }
    return false;
  }

  /**
   * Toggles guard (V2).
   */
  private async handleGuard(step: WorkflowStep): Promise<boolean> {
    const target = step.target || 'all';
    if (target === 'all') {
      const guardAllBtn = await this.page.$('.btn-guard-all');
      if (guardAllBtn) {
        await humanizedClick(this.page, guardAllBtn);
        return true;
      }
    }
    return false;
  }

  /**
   * High-speed optimized Full Auto ("The Full Auto Version of Us"):
   * - Eliminates built-in Full Auto UI latency.
   * - Optimally uses frontline character abilities with humanized reaction times.
   * - Detects plain damage omen (calls Beelzebub summon if available).
   * - Dispatches normal attack.
   * - Waits for server confirmation ('normal_attack_result.json') + calibrated delay (e.g. step.delayAfterMs || 350ms).
   * - Immediately reloads (F5) to cancel normal attack & charge attack animations, advancing turns instantly.
   * - Repeats turn-by-turn until the boss is defeated or safety turn limit reached.
   */
  private async handleSmartFullAuto(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const maxTurns = step.maxLoops || 25;
    const delayAfterAttack = step.delayAfterMs !== undefined ? step.delayAfterMs : 350;
    const targetChars = step.characters; // Optional character filter (e.g. [1] for MC only)
    const healHpThreshold = step.healHpThreshold ?? 0.75;
    const minHealHpThreshold = step.minHealHpThreshold ?? 0.60;
    const tacticalMode = step.tacticalSkillsMode ?? (step.skillsTurn1Only === true ? 'turn1_only' : 'smart');

    console.log(`[Workflow] ⚡ [Run ${runNumber}] Initiating Methodological Tactical Auto (max turns: ${maxTurns}, mode: ${tacticalMode}, post-attack wait: ${delayAfterAttack}ms)...`);

    for (let turn = 1; turn <= maxTurns; turn++) {
      if (this.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      // Check if battle already concluded
      if (await this.isBattleEnded()) {
        console.log(`[Workflow] [Run ${runNumber}] Battle concluded at Turn ${turn}.`);
        return true;
      }

      // Check combat HUD readiness
      await this.waitForCombatInputReady(6000);
      if (await this.isBattleEnded()) return true;

      // 1. Check for Plain Damage Omen ("Deal 1,000,000 plain damage")
      const omenActive = await this.isPlainDamageOmenActive();
      if (omenActive) {
        console.log(`[Workflow] ⚠️ Omen detected: [Deal 1,000,000 Plain Damage]! Checking Beelzebub summon...`);
        const bubsCalled = await this.executeBeelzebubSummonIfAvailable();
        if (bubsCalled) {
          console.log(`[Workflow] 🎉 Beelzebub summon cast! Plain Damage omen canceled.`);
          await this.waitForCombatInputReady(5000);
          if (await this.isBattleEnded()) return true;
        }
      }

      // 2. Quick summon call on Turn 1 if available
      if (turn === 1 && step.quickSummon !== false) {
        const qsReady = await this.page.evaluate(() => {
          const btn = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
          return !!(btn && btn.offsetParent !== null && !btn.classList.contains('disabled'));
        }).catch(() => false);
        if (qsReady) {
          console.log(`[Workflow] [Turn ${turn}] Invoking Quick Summon...`);
          await this.handleQuickCall({ code: 'quick_call', waitForNetwork: 'summon_result.json' });
          await logNormalDelay(150, 0.1);
        }
      }

      // 3. Methodological tactical skills execution across frontline characters
      // High-level GBF doctrine: Field (5) -> Debuff (4) -> Buff (3) -> Nuke (1) -> Needed Heal (2)
      // Evaluates readiness in < 1ms via stage.pJsnData; skips opening trays if no actionable skills are ready.
      const shouldCastSkills = tacticalMode === 'smart' || (tacticalMode === 'turn1_only' && turn === 1);
      if (shouldCastSkills) {
        await this.executeTacticalReadySkills(targetChars, healHpThreshold, minHealHpThreshold, turn);
      }

      if (await this.isBattleEnded()) return true;

      // 4. Attack dispatch
      console.log(`[Workflow] [Turn ${turn}] Dispatching Attack command...`);
      const attackDispatched = await this.handleAttack({
        code: 'attack',
        waitForNetwork: 'normal_attack_result.json'
      });

      if (!attackDispatched && !(await this.isBattleEnded())) {
        console.warn(`[Workflow] [Turn ${turn}] Attack dispatch failed or unconfirmed.`);
      }

      // 5. User requirement: "wait a bit then do reload so it cancels animation and a bit faster"
      if (delayAfterAttack > 0) {
        await new Promise(r => setTimeout(r, delayAfterAttack));
      }

      // 6. Fast animation cancel via reload (F5)
      console.log(`[Workflow] [Turn ${turn}] Reloading (F5) to cancel attack animation...`);
      await this.handleReload({ code: 'reload' });

      await logNormalDelay(150, 0.1);

      if (await this.isBattleEnded()) {
        console.log(`[Workflow] [Run ${runNumber}] Boss defeated after Turn ${turn}!`);
        return true;
      }
    }

    return true;
  }

  /**
   * Methodological Tactical Skill Engine for Granblue Fantasy:
   * 
   * Grounded in GBF game theory and competitive combat mechanics:
   * 1. Evaluates frontline combat state & cooldowns in < 1ms via `stage.pJsnData.ability` and DOM.
   * 2. Categorizes skills into the 5 Granblue battle roles:
   *    - Purple (Type 5): Field / Special auras (amplifies damage, raises caps).
   *    - Blue (Type 4): Debuffs & Dispels (strips buffs, caps enemy DEF down to -50% to double outgoing damage).
   *    - Yellow (Type 3): Offensive Buffs (ATK, Echoes, Guaranteed TA, Skill Specs Up, Limit Burst).
   *    - Red (Type 1): Damage Nukes (unleashed ONLY after Debuffs & Buffs are active for maximum payload).
   *    - Green (Type 2): Recovery / Heals (STRICTLY CONDITIONAL: evaluated against frontline HP & lethal debuffs).
   * 
   * Zero-Latency Optimization:
   * - If NO actionable skills are ready on any turn, opens 0 drawers (takes 0ms) and advances directly to Attack.
   * - Traversal minimization: groups prep skills (Field + Debuff + Buff) per character, then groups nukes per character.
   */
  private async executeTacticalReadySkills(
    targetCharacters?: number[],
    healHpThreshold = 0.75,
    minHealHpThreshold = 0.60,
    turn = 1
  ): Promise<void> {
    if (this.stopRequested) return;
    if (await this.isBattleEnded()) return;

    // 1. Zero-latency telemetry scan (< 1ms)
    const scan = await this.page.evaluate(
      (healThresh: number, minHealThresh: number, targetChars?: number[]) => {
        const stage = (window as any).stage;
        const pJsn = stage?.pJsnData;
        const gStatus = stage?.gGameStatus;

        // Triage frontline HP & conditions
        const players = pJsn?.player?.param || gStatus?.player?.param || [];
        let totalHp = 0;
        let totalMaxHp = 0;
        let minHpRatio = 1.0;
        let hasDebuffedAlly = false;

        const frontline = players.slice(0, 4);
        for (const p of frontline) {
          if (p && p.alive !== 0) {
            const cur = Number(p.hp) || 0;
            const max = Number(p.hpmax) || 1;
            const ratio = cur / max;
            totalHp += cur;
            totalMaxHp += max;
            if (ratio < minHpRatio) minHpRatio = ratio;
            if (p.condition?.debuff && Array.isArray(p.condition.debuff) && p.condition.debuff.length > 0) {
              hasDebuffedAlly = true;
            }
          }
        }
        const avgHpRatio = totalMaxHp > 0 ? (totalHp / totalMaxHp) : 1.0;
        const needsHealing = (avgHpRatio < healThresh) || (minHpRatio < minHealThresh) || hasDebuffedAlly;

        interface ScannedTacticalSkill {
          charIndex: number; // 0..3
          charNum: number;   // 1..4
          slot: number;      // 1..4
          abilityId: string;
          abilityName: string;
          iconType: number;  // 1: Red, 2: Green, 3: Yellow, 4: Blue, 5: Purple
          category: 'field' | 'debuff' | 'buff' | 'damage' | 'heal';
          requiresPick: boolean;
        }

        const scanned: ScannedTacticalSkill[] = [];
        const targetSet = (targetChars && targetChars.length > 0)
          ? new Set(targetChars.map(c => Number(c)))
          : null;

        // A. Primary extraction via stage.pJsnData.ability (server ground truth)
        const abilityMap = pJsn?.ability || {};
        const charKeys = Object.keys(abilityMap);

        if (charKeys.length > 0) {
          for (const charKey of charKeys) {
            const charObj = abilityMap[charKey];
            if (!charObj || charObj.alive === 0) continue;
            const charPos = charObj.pos !== undefined ? Number(charObj.pos) : (Number(charKey) - 1);
            const charNum = charPos + 1;

            if (charNum < 1 || charNum > 4) continue;
            if (targetSet && !targetSet.has(charNum)) continue;

            const list = charObj.list || {};
            for (const [slotKey, abilityArray] of Object.entries(list) as [string, any][]) {
              const slotNum = Number(slotKey);
              if (slotNum < 1 || slotNum > 4) continue;
              const ab = Array.isArray(abilityArray) ? abilityArray[0] : abilityArray;
              if (!ab) continue;

              const recast = String(ab['ability-recast'] ?? '');
              const reqMet = ab['requirement_result_flag'] !== false;
              const isReady = (recast === '0' || recast === '') && reqMet;
              if (!isReady) continue;

              const iconType = Number(ab['icon-type'] || '1');
              let category: 'field' | 'debuff' | 'buff' | 'damage' | 'heal' = 'damage';
              if (iconType === 5) category = 'field';
              else if (iconType === 4) category = 'debuff';
              else if (iconType === 3) category = 'buff';
              else if (iconType === 2) category = 'heal';
              else if (iconType === 1) category = 'damage';

              // TACTICAL FILTER: If green healing skill and party is healthy, do NOT waste it!
              if (category === 'heal' && !needsHealing) {
                continue;
              }

              scanned.push({
                charIndex: charPos,
                charNum,
                slot: slotNum,
                abilityId: String(ab['ability-id'] || ''),
                abilityName: String(ab['ability-name'] || ''),
                iconType,
                category,
                requiresPick: ab['ability-pick'] === '1' || ab['ability-pick'] === 1
              });
            }
          }
        } else {
          // B. DOM Fallback
          for (let c = 1; c <= 4; c++) {
            if (targetSet && !targetSet.has(c)) continue;
            for (let s = 1; s <= 4; s++) {
              const sel = `.ability-character-num-${c}-${s}`;
              const el = document.querySelector(sel) as HTMLElement;
              if (!el) continue;

              const isUnavail = el.classList.contains('btn-ability-unavailable') ||
                                el.classList.contains('empty');
              if (isUnavail) continue;

              let iconType = 1;
              const match = el.className.match(/ico-ability\d+_([1-5])/);
              if (match) {
                iconType = Number(match[1]);
              }

              let category: 'field' | 'debuff' | 'buff' | 'damage' | 'heal' = 'damage';
              if (iconType === 5) category = 'field';
              else if (iconType === 4) category = 'debuff';
              else if (iconType === 3) category = 'buff';
              else if (iconType === 2) category = 'heal';
              else if (iconType === 1) category = 'damage';

              if (category === 'heal' && !needsHealing) continue;

              scanned.push({
                charIndex: c - 1,
                charNum: c,
                slot: s,
                abilityId: el.getAttribute('ability-id') || '',
                abilityName: '',
                iconType,
                category,
                requiresPick: false
              });
            }
          }
        }

        return {
          avgHpRatio,
          minHpRatio,
          needsHealing,
          scanned
        };
      },
      healHpThreshold,
      minHealHpThreshold,
      targetCharacters
    ).catch(() => null);

    if (!scan || scan.scanned.length === 0) {
      console.log(`[Workflow] [Turn ${turn}] ⚡ Zero actionable skills ready (all on cooldown or heals unneeded). Instant pass to attack (0ms drawer overhead).`);
      return;
    }

    const fieldSkills = scan.scanned.filter(s => s.category === 'field');
    const debuffSkills = scan.scanned.filter(s => s.category === 'debuff');
    const buffSkills = scan.scanned.filter(s => s.category === 'buff');
    const damageSkills = scan.scanned.filter(s => s.category === 'damage');
    const healSkills = scan.scanned.filter(s => s.category === 'heal');

    console.log(
      `[Workflow] 🎯 [Turn ${turn}] Tactical Skill Execution Plan (${scan.scanned.length} skills | Party HP: ${(scan.avgHpRatio * 100).toFixed(0)}%): ` +
      `[Field: ${fieldSkills.length}, Debuff: ${debuffSkills.length}, Buff: ${buffSkills.length}, Damage: ${damageSkills.length}, Heal: ${healSkills.length}]`
    );

    let currentOpenChar: number | null = null;

    const openCharDrawer = async (charNum: number) => {
      if (currentOpenChar === charNum) return true;
      const charIndex = charNum - 1;
      const charSelector = `.lis-character${charIndex}.btn-command-character, .lis-character${charIndex}`;
      const charEl = await this.page.$(charSelector).catch(() => null);
      if (!charEl) return false;

      await humanReactionDelay(130, 0.1);
      await humanizedClick(this.page, charEl);
      await randomDelay(160, 240);
      currentOpenChar = charNum;
      return true;
    };

    const castSkill = async (skill: { charNum: number; slot: number; abilityName: string; category: string; requiresPick: boolean }) => {
      if (this.stopRequested) return false;
      if (await this.isBattleEnded()) return false;

      const opened = await openCharDrawer(skill.charNum);
      if (!opened) return false;

      const abilitySelector = `.ability-character-num-${skill.charNum}-${skill.slot}:not(.btn-ability-unavailable):not(.empty), .ability-character-num-${skill.charNum}-${skill.slot}`;
      const skillEl = await this.page.$(abilitySelector).catch(() => null);
      if (!skillEl) return false;

      // Verify button is actually clickable
      const canClick = await this.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        return el && el.offsetParent !== null && !el.classList.contains('btn-ability-unavailable') && !el.classList.contains('empty');
      }, abilitySelector).catch(() => false);

      if (!canClick) return false;

      await humanReactionDelay(100, 0.1);
      await humanizedClick(this.page, skillEl);
      // Snappy skill queue pacing (180ms - 260ms)
      await randomDelay(180, 260);

      // Handle single-target ally popup if it appeared
      const targetPopup = await this.page.$('.pop-usual .lis-character0, .pop-usual .btn-command-character, .pop-usual .btn-usual-ok').catch(() => null);
      if (targetPopup) {
        await humanReactionDelay(110, 0.1);
        await humanizedClick(this.page, targetPopup);
        await randomDelay(180, 260);
      }

      return true;
    };

    // Phase 1: Field Effects (Purple / Type 5)
    for (const skill of fieldSkills) {
      if (this.stopRequested || await this.isBattleEnded()) break;
      await castSkill(skill);
    }

    // Phase 2: Team Preparation (Debuffs & Buffs grouped per character to minimize drawer flips)
    // Debuff first, then Buff for that character
    const prepSkills = [...debuffSkills, ...buffSkills];
    const prepCharNums = Array.from(new Set(prepSkills.map(s => s.charNum))).sort((a, b) => a - b);
    for (const charNum of prepCharNums) {
      if (this.stopRequested || await this.isBattleEnded()) break;
      const charPrep = prepSkills.filter(s => s.charNum === charNum);
      // Sort: debuff (4) before buff (3)
      charPrep.sort((a, b) => (b.iconType - a.iconType));
      for (const skill of charPrep) {
        if (this.stopRequested || await this.isBattleEnded()) break;
        await castSkill(skill);
      }
    }

    // Phase 3: Damage Nukes (Red / Type 1)
    // Now all debuffs are capped on boss and buffs active on team!
    const nukeCharNums = Array.from(new Set(damageSkills.map(s => s.charNum))).sort((a, b) => a - b);
    for (const charNum of nukeCharNums) {
      if (this.stopRequested || await this.isBattleEnded()) break;
      const charNukes = damageSkills.filter(s => s.charNum === charNum);
      for (const skill of charNukes) {
        if (this.stopRequested || await this.isBattleEnded()) break;
        await castSkill(skill);
      }
    }

    // Phase 4: Conditional Recovery / Clears (Green / Type 2)
    for (const skill of healSkills) {
      if (this.stopRequested || await this.isBattleEnded()) break;
      await castSkill(skill);
    }

    // Final Step: Ensure character ability drawer is closed and Attack button is exposed
    try {
      const isBackVisible = await this.page.evaluate(() => {
        const el = document.querySelector('.btn-command-back, .ico-back') as HTMLElement;
        return !!(el && el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
      }).catch(() => false);
      if (isBackVisible) {
        const backBtn = await this.page.$('.btn-command-back, .ico-back');
        if (backBtn) {
          await humanizedClick(this.page, backBtn);
          await randomDelay(180, 280);
        }
      }
    } catch {}
  }

  /**
   * Fast-executes available abilities across frontline characters (1 to 4).
   * Backwards-compatible alias for executeTacticalReadySkills.
   */
  private async executeOptimalReadySkills(targetCharacters?: number[]): Promise<void> {
    await this.executeTacticalReadySkills(targetCharacters);
  }

  /**
   * Scans DOM and combat telemetry for the "Deal 1,000,000 plain damage" omen.
   */
  private async isPlainDamageOmenActive(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const omenContainers = document.querySelectorAll(
          '.prt-cancel-condition, .prt-condition-detail, .txt-condition, .prt-condition, .prt-special-motion, .pop-target-detail, .prt-boss-condition'
        );

        for (const el of Array.from(omenContainers)) {
          const text = (el as HTMLElement).innerText || '';
          const has1M = text.includes('1,000,000') || text.includes('1000000');
          const hasPlain = text.includes('plain') || text.includes('Plain') || text.includes('無属性');
          if (has1M && hasPlain) return true;
        }

        const bodyText = document.body ? document.body.innerText || '' : '';
        const regex1MPlain = /(?:1,?000,?000[\s\S]{0,40}(?:plain|無属性))|(?:(?:plain|無属性)[\s\S]{0,40}1,?000,?000)/i;
        if (regex1MPlain.test(bodyText)) return true;

        const stage = (window as any).stage;
        const boss = stage?.gGameStatus?.boss?.param?.[0] || stage?.pJsnData?.boss?.param?.[0];
        if (boss?.special_skill) {
          const specStr = JSON.stringify(boss.special_skill);
          if (regex1MPlain.test(specStr)) return true;
        }

        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Locates and calls Beelzebub summon if available in deck, then reloads to skip summon animation.
   */
  private async executeBeelzebubSummonIfAvailable(): Promise<boolean> {
    try {
      const bubsInfo = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const rawSummons = stage?.pJsnData?.summon || stage?.gGameStatus?.summon || {};
        const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);

        let bubsIndex = -1;
        let isAvailable = false;

        summonsList.forEach((s: any, idx: number) => {
          const idStr = String(s?.id || '');
          const nameStr = String(s?.name || '');
          if (idStr === '2040408000' || nameStr.toLowerCase().includes('beelzebub') || nameStr.includes('ベルゼバブ')) {
            bubsIndex = idx;
            isAvailable = s?.available_flag === 1 || s?.available_flag === true || s?.recast === '0' || s?.recast === 0;
          }
        });

        const summonEls = document.querySelectorAll('.lis-summon');
        summonEls.forEach((el, idx) => {
          const img = el.querySelector('img')?.getAttribute('src') || '';
          if (img.includes('2040408000')) {
            bubsIndex = idx;
            if (el.classList.contains('btn-summon-available') || el.classList.contains('on')) {
              isAvailable = true;
            }
          }
        });

        return { bubsIndex, isAvailable };
      });

      if (bubsInfo.bubsIndex === -1 || !bubsInfo.isAvailable) {
        return false;
      }

      console.log(`[Workflow] Calling Beelzebub (Summon Slot ${bubsInfo.bubsIndex})...`);
      const summonTab = await this.page.$('.prt-list-top.btn-command-summon:not(.summon-on)');
      if (summonTab) {
        await humanizedClick(this.page, summonTab);
        await randomDelay(250, 400);
      }

      const summonCards = await this.page.$$('.lis-summon');
      const bubsCard = summonCards[bubsInfo.bubsIndex];
      if (!bubsCard) return false;

      await humanReactionDelay(220, 0.15);
      await humanizedClick(this.page, bubsCard);
      await randomDelay(450, 700);

      const callBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-call, .btn-summon-start, #pop .btn-usual-ok');
      if (callBtn) {
        await humanReactionDelay(220, 0.15);
        await humanizedClick(this.page, callBtn);
        await randomDelay(600, 900);
      }

      await this.page.evaluate(() => location.reload()).catch(() => null);
      await randomDelay(600, 900);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Taps the READY screen overlay / Auto button to trigger Full Auto, Turn action, or Attack.
   * Strictly awaits server acknowledgment (ability_result.json, normal_attack_result.json, summon_result.json)
   * before allowing subsequent reload.
   */
  private async handleTapReady(step: WorkflowStep): Promise<boolean> {
    const targetNet = step.waitForNetwork || null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.stopRequested) return false;

      // 1. Ensure battle stage is mounted
      await this.waitForBattleToMount(8000);

      // 2. Check if battle concluded
      if (await this.isBattleEnded()) return true;

      // 3. Proactively clear turn processing popups
      await this.checkAndDismissProcessingTurnPopup();

      // Settle briefly for canvas event listeners
      await logNormalDelay(60, 0.1);

      // 4. Arm network listener: waits through Full Auto skill sequence until normal_attack_result.json
      const combatPromise = this.waitForCombatTurnResolution(targetNet, 15000);

      const x = Math.round(240 + sampleGaussian(0, 15));
      const y = Math.round(260 + sampleGaussian(0, 15));

      // 5. Physical touch tap + mouse click on READY screen / canvas
      await this.page.touchscreen.tap(x, y).catch(() => null);
      await this.page.mouse.click(x, y).catch(() => null);

      // 6. Trigger ready dismiss and engage Full Auto / Auto if not already active
      await this.page.evaluate((tapX, tapY) => {
        // Dismiss ready overlay if element exists
        const readyEl = document.elementFromPoint(tapX, tapY) || document.querySelector('.prt-ready, #ready, canvas, .cnt-raid');
        if (readyEl) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(readyEl).trigger('tap');
          (readyEl as HTMLElement).click();
        }

        // Engage Auto / Full Auto if present and NOT already active
        const auto = document.querySelector('.btn-auto, .btn-ability-auto, #btn-auto') as HTMLElement;
        if (auto && auto.offsetParent !== null) {
          const isActive = auto.classList.contains('display-on') || auto.classList.contains('active') || auto.classList.contains('full');
          if (!isActive) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(auto).trigger('tap');
            auto.click();
          }
        }
      }, x, y).catch(() => null);

      // 7. Await server action response
      let confirmed = await combatPromise;

      // 8. If not immediately confirmed, attempt fallback triggers
      if (!confirmed) {
        if (targetNet && targetNet.includes('summon')) {
          const qsPromise = this.waitForNetworkResponse('summon_result.json', 1500);
          const qsBtn = await this.page.$('.btn-quick-summon.qs-ready, .btn-quick-summon, #js-btn-quick-summon');
          if (qsBtn) {
            await humanizedClick(this.page, qsBtn);
            await qsBtn.evaluate((el: any) => {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(el).trigger('tap');
              el.click();
            }).catch(() => null);
          }
          confirmed = await qsPromise;
        } else {
          // Fallback: try tapping attack button directly if visible, or re-engage auto button
          const fallbackPromise = this.waitForCombatTurnResolution(targetNet, 4000);
          const atkBtn = await this.page.$('.btn-attack-start.display-on, .btn-attack-start');
          if (atkBtn) {
            const box = await atkBtn.boundingBox();
            if (box && box.width > 0) {
              const tapX = Math.round(box.x + box.width / 2 + sampleGaussian(0, 3));
              const tapY = Math.round(box.y + box.height / 2 + sampleGaussian(0, 2));
              await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
              await this.page.mouse.click(tapX, tapY).catch(() => null);
            }
            await atkBtn.evaluate((el: any) => {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(el).trigger('tap');
              el.click();
            }).catch(() => null);
          } else {
            // Re-engage auto button if not active
            await this.page.evaluate(() => {
              const auto = document.querySelector('.btn-auto, .btn-ability-auto, #btn-auto') as HTMLElement;
              if (auto && auto.offsetParent !== null) {
                const isActive = auto.classList.contains('display-on') || auto.classList.contains('active') || auto.classList.contains('full');
                if (!isActive) {
                  const $ = (window as any).$ || (window as any).Zepto;
                  if ($) $(auto).trigger('tap');
                  auto.click();
                }
              }
            }).catch(() => null);
          }
          confirmed = await fallbackPromise;
        }
      }

      // Check client-side visual / state indicators
      const isClientConfirmed = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const isAttacking = stage?.gGameStatus?.attacking === true;
        const isFinish = stage?.gGameStatus?.finish === true;
        return isAttacking || isFinish;
      }).catch(() => false);

      if (confirmed || isClientConfirmed || await this.isBattleEnded()) {
        await this.syncCurrentHonors();
        console.log(`[Combat] [tap_ready] Full Auto / Turn action completed. Honors: ${this.currentScore.toLocaleString()} pt`);
        return true;
      }

      // Fail-safe reload
      if (attempt < maxRetries) {
        console.warn(`[Combat] [tap_ready] Tap unacknowledged. Reloading (Attempt ${attempt}/${maxRetries})...`);
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
          this.page.evaluate(() => window.location.reload()).catch(() => null)
        ]);
        await logNormalDelay(150, 0.1);
        await this.checkAndDismissProcessingTurnPopup();
      }
    }

    return false;
  }

  /**
   * Executes Quick Call button directly.
   */
  private async handleQuickCall(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    await this.waitForCombatInputReady(isTurbo ? 600 : 4000);
    const qBtn = await this.page.waitForSelector('.btn-quick-summon, #js-btn-quick-summon', { visible: true, timeout: 2500 }).catch(() => null);
    if (qBtn) {
      const isUnavailable = await qBtn.evaluate((el: any) => {
        return el.classList.contains('btn-summon-unavailable') ||
               el.classList.contains('off') ||
               el.classList.contains('disabled') ||
               el.getAttribute('aria-disabled') === 'true' ||
               el.style.opacity === '0.5';
      }).catch(() => false);

      if (isUnavailable) {
        console.log('[Workflow] Quick Summon button disabled or already invoked this turn. Continuing...');
        return true;
      }

      const netPromise = this.waitForNetworkResponse(step.waitForNetwork || 'summon_result.json', 3500);
      await humanizedClick(this.page, qBtn);
      await qBtn.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
      }).catch(() => null);
      await netPromise;

      // Fast-forward summon cut-in animation and clear UI locks
      await this.page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(3000, false);
        }
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }
      }).catch(() => null);

      await this.waitForCombatInputReady(isTurbo ? 400 : 3000);
      return true;
    }
    return step.optional ? true : false;
  }

  /**
   * Executes Attack action with ability drawer dismissal, dynamic coordinate targeting,
   * network confirmation (normal_attack_result.json), and an automated retry loop.
   */
  private async handleAttack(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const targetNet = step.waitForNetwork || 'normal_attack_result.json';
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.stopRequested) return false;
      if (await this.isBattleEnded()) return true;

      // 1. Proactively dismiss any open character ability drawers, skill modals, or popups
      await this.dismissCombatDrawersAndPopups();

      // 2. Wait for combat input readiness (fast 500ms cap in turbo)
      await this.waitForCombatInputReady(isTurbo ? 500 : 3000);
      if (await this.isBattleEnded()) return true;

      // 3. Locate active Attack button (.btn-attack-start)
      // Active closing: while polling for attack button, trigger tap on Back button immediately if visible
      let atkBtn = await this.page.waitForFunction(() => {
        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          back.click();
        }
        const el = document.querySelector('.btn-attack-start') as HTMLElement;
        if (!el) return false;
        const isDisplayOn = (el.classList.contains('display-on') || !el.classList.contains('display-off')) && !el.classList.contains('lock');
        return isDisplayOn && el.offsetWidth > 0;
      }, { timeout: isTurbo ? 1000 : 2500 }).then(() => this.page.$('.btn-attack-start.display-on, .btn-attack-start')).catch(() => null);

      if (!atkBtn) {
        await this.dismissCombatDrawersAndPopups();
        atkBtn = await this.page.$('.btn-attack-start.display-on, .btn-attack-start');
      }

      // 4. Arm network promise for attack resolution BEFORE clicking
      const netPromise = this.waitForNetworkResponse(targetNet, isTurbo ? 3500 : 5000);

      // 5. Trigger attack via native touch/mouse at bounding box + Zepto tap
      let tapped = false;
      if (atkBtn) {
        const box = await atkBtn.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          const tapX = Math.round(box.x + box.width / 2 + (isTurbo ? 0 : sampleGaussian(0, 3)));
          const tapY = Math.round(box.y + box.height / 2 + (isTurbo ? 0 : sampleGaussian(0, 2)));
          await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
          await this.page.mouse.click(tapX, tapY).catch(() => null);
          tapped = true;
        } else {
          await humanizedClick(this.page, atkBtn);
          tapped = true;
        }

        // Zepto tap event trigger on attack button directly
        await atkBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          el.click();
        }).catch(() => null);
        tapped = true;
      }

      if (!tapped) {
        // Direct tap on standard Attack button viewport location in GBF mobile layout
        const vp = this.page.viewport() || { width: 480, height: 960 };
        const atkX = Math.round(vp.width * 0.75);
        const atkY = Math.round(vp.height * 0.46);
        await this.page.touchscreen.tap(atkX, atkY).catch(() => null);
        await this.page.mouse.click(atkX, atkY).catch(() => null);
      }

      // 6. Await network resolution
      const resolved = await netPromise;

      // Check client-side state in case response was already consumed or turn advanced
      const clientState = await this.page.evaluate((prevTurn) => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const isAttacking = gStatus?.attacking === true || gStatus?.lock === true || gStatus?.finish === true;
        const currentTurn = Number(stage?.pJsnData?.turn || gStatus?.turn || 0);
        return { isAttacking, turnAdvanced: currentTurn > prevTurn };
      }, this.currentTurn).catch(() => ({ isAttacking: false, turnAdvanced: false }));

      if (resolved || clientState.isAttacking || clientState.turnAdvanced || await this.isBattleEnded()) {
        console.log(`[Combat] Attack registered successfully (attempt ${attempt}).`);
        return true;
      }

      console.warn(`[Combat] Attack unacknowledged on attempt ${attempt}/${maxAttempts}. Retrying immediately...`);
      if (!isTurbo) await logNormalDelay(200, 0.12);
    }

    return false;
  }

  /**
   * Instant reload (F5) to skip animation frames.
   */
  private async handleReload(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
      this.page.evaluate(() => location.reload()).catch(() => null)
    ]);
    if (!isTurbo) await logNormalDelay(100, 0.1);
    await this.checkAndDismissProcessingTurnPopup();
    await this.waitForBattleToMount(isTurbo ? 5000 : 8000);
    await this.checkAndDismissProcessingTurnPopup();

    // Immediately clear canvas READY overlay, accelerate CreateJS Ticker to 120 FPS, and tick tweens
    await this.page.evaluate(() => {
      const cjs = (window as any).createjs;
      if (cjs?.Ticker) {
        cjs.Ticker.framerate = 120;
        if (typeof cjs.Ticker.setInterval === 'function') {
          cjs.Ticker.setInterval(1000 / 120);
        }
      }
      if (cjs?.Tween?.tick) {
        cjs.Tween.tick(2000, false);
      }
      const ready = document.querySelector('.prt-ready, #ready') as HTMLElement;
      if (ready) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(ready).trigger('tap');
        ready.click();
      }
    }).catch(() => null);
    await this.page.touchscreen.tap(240, 260).catch(() => null);
    await this.page.mouse.click(240, 260).catch(() => null);
    if (!isTurbo) await logNormalDelay(100, 0.1);

    // Sync authoritative ground-truth honors from stage/DOM
    await this.syncCurrentHonors();

    return true;
  }

  /**
   * Clicks an arbitrary selector.
   */
  private async handleClick(step: WorkflowStep): Promise<boolean> {
    if (!step.target) return false;
    const el = await this.page.waitForSelector(step.target, { visible: true, timeout: step.timeoutMs || 3000 }).catch(() => null);
    if (el) {
      await humanizedClick(this.page, el);
      return true;
    }
    return false;
  }

  /**
   * Confirms result, dismisses processing popups, syncs final honors,
   * and cleanly transitions out of combat to quest/assist URL.
   */
  private async handleConfirmResult(): Promise<boolean> {
    await this.checkAndDismissProcessingTurnPopup();

    // 1. Sync honors from active battle before result screen
    await this.syncCurrentHonors();

    // 2. Wait up to 3500ms for reload to settle into result screen, supporter, or quest
    const tStart = Date.now();
    while (Date.now() - tStart < 3500) {
      if (await this.isBattleEnded()) break;
      await new Promise(r => setTimeout(r, 150));
    }

    // Inspect DOM on result screen for Gold Bar and Blue Chest before dismissing
    const domCheck = await this.inspectDomForGoldBar();
    if (domCheck.hasGoldBar && !this.currentBattleHadGoldBar) {
      this.currentBattleHadGoldBar = true;
      this.currentBattleHadBlueChest = true;
      this.totalGoldBarsAccumulated++;
      this.totalBlueChestsAccumulated++;
      this.broadcastGoldBarFound(domCheck.raidId || this.currentRaidId);
    }

    if (!this.currentBattleHadBlueChest) {
      const blueChestDom = await this.inspectDomForBlueChest();
      if (blueChestDom) {
        this.currentBattleHadBlueChest = true;
        this.totalBlueChestsAccumulated++;
      }
    }

    // 3. Dismiss result screen OK buttons
    await this.page.evaluate(() => {
      const okBtns = Array.from(document.querySelectorAll('.btn-usual-ok, .btn-settle, .btn-usual-close, .pop-raid-result .btn-usual-ok, .btn-result-close, .btn-control.location-href, .prt-popup-body .btn-usual-ok')) as HTMLElement[];
      for (const btn of okBtns) {
        if (btn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
        }
      }
    }).catch(() => null);

    // 4. Final honor sync from settled result screen if present
    await this.syncCurrentHonors();

    // 5. In assist raid mode (e.g. multi-raid rotator / gb-farm), if the raid is still ongoing (#raid_multi),
    // cleanly retreat back to #quest/assist so the slot is freed and we don't linger on #raid_multi
    const isAssistRaid = this.template.questUrl.includes('assist') || (this.template.raidSlots && this.template.raidSlots.length > 0);
    if (isAssistRaid) {
      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHash)) {
        console.log('[Workflow] Multi-raid rotation burst completed. Returning to #quest/assist for next raid...');
        await this.page.evaluate(() => { window.location.hash = '#quest/assist'; }).catch(() => null);
        await logNormalDelay(800, 0.15);
      }
    }

    return true;
  }

  /**
   * Claims ALL pending/unclaimed battles at #quest/assist/unclaimed/0/0 until none remain,
   * checks for Gold Bar drops, and cleanly returns to returnUrl (or assist/quest URL).
   */
  public async claimPendingBattles(logPath: string, currentRuns: number, returnUrl?: string): Promise<number> {
    let claimedCount = 0;
    const maxClaims = 50; // Safety cap to avoid infinite loops

    try {
      console.log('[Workflow] Checking and clearing ALL unclaimed battles (#quest/assist/unclaimed/0/0)...');

      // Navigate to #quest/assist/unclaimed/0/0
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1200, 0.15);

      while (claimedCount < maxClaims && !this.stopRequested) {
        // Ensure we are on the unclaimed battles page
        const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
        if (!curHash.includes('unclaimed')) {
          await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' }).catch(() => null);
          await logNormalDelay(1200, 0.15);
        }

        // Check if there are no pending battles
        const status = await this.page.evaluate(() => {
          const bodyText = document.body.innerText || '';
          const noListEl = document.querySelector('.txt-no-list');
          const hasNoneText = (
            bodyText.includes("aren't any pending") ||
            bodyText.includes("aren't any pending battles") ||
            bodyText.includes('未確認バトルはありません') ||
            bodyText.includes('No pending battles')
          );
          const cards = document.querySelectorAll(
            '#prt-unclaimed-list .btn-multi-raid, #prt-unclaimed-list [data-href*="result_multi"], .cnt-quest-unclaimed .btn-multi-raid, .cnt-quest-unclaimed .lis-raid, .prt-raid-list .btn-multi-raid'
          );
          const hasVisibleCards = Array.from(cards).some(c => (c as HTMLElement).offsetParent !== null);
          return {
            hasNone: (noListEl !== null && hasNoneText) || (!hasVisibleCards && hasNoneText),
            hasVisibleCards,
            cardCount: cards.length
          };
        }).catch(() => ({ hasNone: true, hasVisibleCards: false, cardCount: 0 }));

        if (status.hasNone || (!status.hasVisibleCards && status.cardCount === 0)) {
          if (claimedCount > 0) {
            console.log(`[Workflow] 🎉 All unclaimed battles successfully cleared! Total claimed: ${claimedCount}.`);
          } else {
            console.log('[Workflow] No unclaimed battles found. Account clean.');
          }
          break;
        }

        console.log(`[Workflow] Found unclaimed battle(s) (${status.cardCount} remaining). Claiming battle #${claimedCount + 1}...`);
        this.latestRewardData = null;
        this.currentScore = 0;
        this.currentTurn = 0;

        // Click the first available unclaimed battle card
        const clicked = await this.page.evaluate(() => {
          const card = document.querySelector(
            '#prt-unclaimed-list .btn-multi-raid, #prt-unclaimed-list [data-href*="result_multi"], .cnt-quest-unclaimed .btn-multi-raid, .cnt-quest-unclaimed .lis-raid, .prt-raid-list .btn-multi-raid'
          ) as HTMLElement;
          if (card && card.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(card).trigger('tap');
            card.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (!clicked) {
          // Fallback: look for any element with data-href containing result_multi
          const hrefClicked = await this.page.evaluate(() => {
            const el = document.querySelector('[data-href*="result_multi"]') as HTMLElement;
            if (el) {
              const href = el.getAttribute('data-href');
              if (href) {
                window.location.hash = href;
                return true;
              }
            }
            return false;
          }).catch(() => false);

          if (!hrefClicked) {
            console.log('[Workflow] No clickable unclaimed card found. Finishing claim loop.');
            break;
          }
        }

        // Wait for result screen (#result_multi or #result)
        const tWait = Date.now();
        let resultLoaded = false;
        while (Date.now() - tWait < 8000) {
          if (this.stopRequested) break;
          const isResult = await this.page.evaluate(() => {
            const hash = window.location.hash;
            return hash.includes('result') || !!document.querySelector('.pop-raid-result, .prt-result-head, .cnt-result, #cnt-result');
          }).catch(() => false);

          if (isResult) {
            resultLoaded = true;
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }

        // Allow result settlement and check for Gold Bar drop
        await logNormalDelay(800, 0.15);

        // 1. Resolve claimed raid ID from location hash
        const urlRaidMatch = await this.page.evaluate(() => {
          const m = window.location.hash.match(/result(?:_multi)?\/(\d+)/);
          return m ? m[1] : '';
        }).catch(() => '');
        const activeClaimedRaidId = urlRaidMatch || this.currentRaidId;

        // 2. Perform deep inspection (DOM + Intercepted Payload)
        const domCheck = await this.inspectDomForGoldBar();
        const payloadCheck = this.latestRewardData ? this.checkForGoldBarDrop(this.latestRewardData) : false;
        const dropDetected = domCheck.hasGoldBar || payloadCheck;

        if (dropDetected) {
          const finalRaidId = domCheck.raidId || activeClaimedRaidId || 'Pending Claim';
          console.log(`\n========================================================================`);
          console.log(`  🌟🌟🌟 [GOLD BAR CONFIRMED IN CLAIMED BATTLE!] Raid: ${finalRaidId} 🌟🌟🌟`);
          console.log(`========================================================================\n`);

          const { buffer: shotBuf, path: proofPath } = await this.captureCleanLootProof(finalRaidId);

          if (this.dropLogger) {
            const stats = this.dropLogger.recordPendingGoldBar(finalRaidId, proofPath);
            discordPresence.updateStatus({
              raidName: this.template.name,
              goldBars: stats.goldBars,
              blueChests: stats.blueChests,
              dryStreak: stats.currentDryStreak,
              dryStreakMode: stats.dryStreakMode,
              status: 'Claiming Pending'
            }, true);
            await this.dropLogger.notifyGoldBarDrop({
              raidId: finalRaidId,
              honors: this.currentScore > 0 ? this.currentScore.toLocaleString() + ' pt' : '-',
              turns: this.currentTurn || '-',
              screenshotBuffer: shotBuf,
              screenshotPath: proofPath,
              accountId: this.accountId
            });
          } else {
            const playerName = this.accountId === 'acc1' || !this.accountId ? '『Danchou』' : this.accountId;
            await this.alertRelay.sendEmergencyAlert(
              `🌟 GOLD BAR DROP CONFIRMED for ${playerName}!\n• Raid: ${this.template.name}\n• Battle ID: ${finalRaidId}\n• Log URL: https://game.granbluefantasy.jp/#result_multi/detail/${finalRaidId}/1/0/0`,
              shotBuf
            );
          }
        }

        // Reset latest reward data to avoid state leakage into next claimed battle
        this.latestRewardData = null;

        // Sync and log settled honors for the claimed raid
        const claimedHonors = await this.syncCurrentHonors();
        if (claimedHonors > 0) {
          console.log(`[Workflow] Claimed Battle #${claimedCount + 1} settled with ${claimedHonors.toLocaleString()} honors.`);
        }

        // Dismiss result popups / modals
        await this.page.evaluate(() => {
          const ok = document.querySelector(
            '.pop-usual .btn-usual-ok, .btn-usual-ok, .btn-settle, .btn-result-close, .btn-control.location-href'
          ) as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
          }
        }).catch(() => null);

        claimedCount++;
        await logNormalDelay(500, 0.12);

        // Re-navigate to unclaimed battles list to check/claim next
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1000, 0.15);
      }

      // Determine return navigation URL
      const finalReturnUrl = returnUrl || (this.template.questUrl.includes('assist') ? 'https://game.granbluefantasy.jp/#quest/assist' : this.template.questUrl);
      if (finalReturnUrl) {
        console.log(`[Workflow] Clean return to: ${finalReturnUrl}`);
        const returnHash = finalReturnUrl.split('#')[1] || '';
        const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
        // If target is quest/assist, ensure we are NOT lingering on 'unclaimed'
        const isTargetAssist = returnHash === 'quest/assist';
        const alreadyThere = isTargetAssist
          ? ((currentHash === '#quest/assist' || currentHash === '#quest/assist/index') && !currentHash.includes('unclaimed'))
          : currentHash.includes(returnHash);

        if (!alreadyThere) {
          await Promise.all([
            this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
            this.page.evaluate((url: string) => {
              window.location.href = url;
              window.location.reload();
            }, finalReturnUrl).catch(() => null)
          ]);
          await logNormalDelay(800, 0.15);
        }
      }

    } catch (err: any) {
      console.warn('[Workflow] Notice claiming pending battles:', err.message);
    }

    return claimedCount;
  }

  /**
   * Detects if a "pending battle" or "unclaimed battle" popup modal is currently displayed
   * (e.g. in Guild Wars or assist raid joining), dismisses it, clears ALL unclaimed battles,
   * and returns to the target quest URL.
   * Returns true if a pending battle modal was detected and handled.
   */
  private async detectAndHandlePendingBattleModal(logPath: string, currentRuns: number): Promise<boolean> {
    const modalType = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
      if (!modal || (modal as HTMLElement).offsetParent === null) return null;
      const text = ((modal as HTMLElement).innerText || (modal as HTMLElement).textContent || '').toLowerCase();
      const rawText = (modal as HTMLElement).innerText || (modal as HTMLElement).textContent || '';

      const isThreeRaidLimit = (
        text.includes('three raid') ||
        text.includes('up to three') ||
        text.includes('provide backup in up to') ||
        text.includes('only provide backup') ||
        text.includes('3 battles') ||
        text.includes('3 raid') ||
        text.includes('participating in 3') ||
        text.includes('more than 3') ||
        text.includes('up to 3') ||
        rawText.includes('3件まで') ||
        rawText.includes('同時に参戦できる') ||
        rawText.includes('参戦中') ||
        rawText.includes('3件')
      );
      if (isThreeRaidLimit) return 'ACTIVE_RAID_LIMIT_3';

      const isPending = (
        text.includes('pending') ||
        text.includes('unclaimed') ||
        rawText.includes('未確認') ||
        text.includes('five or more') ||
        rawText.includes('5件')
      );
      if (isPending) return 'PENDING_MODAL';

      return null;
    }).catch(() => null);

    if (!modalType) {
      return false;
    }

    // Dismiss the popup
    await this.dismissPopupModal();
    await logNormalDelay(400, 0.1);

    if (modalType === 'ACTIVE_RAID_LIMIT_3') {
      console.warn('[Workflow] ⚠️ Active backup limit popup detected! Resolving lingering raids...');
      this.lastStartFailureWasRaidLimit = true;
      await this.resolveLingeringRaidLimit(logPath, currentRuns);
      return true;
    }

    console.warn('[Workflow] ⚠️ Pending/Unclaimed battle popup detected! Clearing all unclaimed battles...');
    // Clear ALL unclaimed battles and return cleanly to target quest URL
    const returnUrl = this.template.questUrl.includes('assist') ? 'https://game.granbluefantasy.jp/#quest/assist' : this.template.questUrl;
    await this.claimPendingBattles(logPath, currentRuns, returnUrl);

    return true;
  }

  /**
   * Waits until the battle HUD and canvas are fully mounted after quest start or reload.
   * Fast-fails early if a pending battle popup is detected.
   */
  private async waitForBattleToMount(timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return false;
      try {
        const check = await this.page.evaluate(() => {
          const hash = window.location.hash;
          const isCombatHash = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash) || hash.includes('replicard/battle') || hash.includes('stage');
          const stage = (window as any).stage;
          const hasGameStatus = !!stage?.gGameStatus;
          const isRes = hash.includes('result') || !!document.querySelector('.pop-raid-result, .prt-result-head');
          const hasReadyStage = (isCombatHash || !!document.querySelector('.lis-character0')) && (hasGameStatus || !!document.querySelector('.lis-character0, .btn-attack-start.display-on, .btn-quick-summon.qs-ready'));
          if (hasReadyStage || isRes) {
            return 'MOUNTED';
          }

          // Check if pending/unclaimed battle popup or raid limit popup appeared
          const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
          if (modal && (modal as HTMLElement).offsetParent !== null) {
            const text = ((modal as HTMLElement).innerText || '').toLowerCase();
            const rawText = (modal as HTMLElement).innerText || '';
            if (
              text.includes('three raid') ||
              text.includes('up to three') ||
              text.includes('provide backup in up to') ||
              text.includes('only provide backup') ||
              text.includes('pending') ||
              text.includes('unclaimed') ||
              rawText.includes('未確認') ||
              rawText.includes('参戦中') ||
              rawText.includes('同時に参戦できる') ||
              rawText.includes('3件') ||
              text.includes('3 battles')
            ) {
              return 'PENDING_MODAL';
            }
          }

          return null;
        });

        if (check === 'MOUNTED') {
          // Accelerate CreateJS animation ticker to 120 FPS
          await this.page.evaluate(() => {
            const cjs = (window as any).createjs;
            if (cjs?.Ticker) {
              cjs.Ticker.framerate = 120;
              if (typeof cjs.Ticker.setInterval === 'function') {
                cjs.Ticker.setInterval(1000 / 120);
              }
            }
          }).catch(() => null);
          const isTurbo = this.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
          if (!isTurbo) await logNormalDelay(150, 0.1);
          return true;
        }
        if (check === 'PENDING_MODAL') {
          return false;
        }
      } catch {
        // Safe navigation context handling
      }
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  }

  /**
   * Performs deep on-screen failure diagnosis when a quest fails to start.
   * Checks for CAPTCHA/Access Verification, item shortages (Meat/AP), and in-game error modals.
   */
  private async diagnoseQuestStartFailure(runNumber: number): Promise<{
    reason: string;
    popupText?: string;
    isCaptcha: boolean;
    isOutOfMeat: boolean;
    isOutOfAp: boolean;
    isRaidBackupLimit: boolean;
    capturePath?: string;
  }> {
    let reason = 'Unknown quest start obstruction';
    let popupText = '';
    let isCaptcha = false;
    let isOutOfMeat = false;
    let isOutOfAp = false;
    let isRaidBackupLimit = false;
    let capturePath: string | undefined;

    try {
      // 1. Check CAPTCHA / Access Verification
      isCaptcha = await this.sentinel.inspectForVerification();
      if (isCaptcha) {
        reason = 'Access Verification / CAPTCHA challenge is blocking the screen';
      }

      // 2. Inspect active popups, headers, and visible body text
      const screenInfo = await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-usual, .common-pop-error, .prt-popup-body, .cnt-error');
        const text = (pop as HTMLElement)?.innerText?.trim() || '';
        const bodyText = document.body.innerText || '';
        return { text, bodyText };
      }).catch(() => ({ text: '', bodyText: '' }));

      popupText = screenInfo.text;
      const combined = (screenInfo.text + ' ' + screenInfo.bodyText).toLowerCase();
      const rawCombined = screenInfo.text + ' ' + screenInfo.bodyText;

      if (!isCaptcha) {
        if (
          combined.includes('three raid') ||
          combined.includes('up to three') ||
          combined.includes('provide backup in up to') ||
          combined.includes('only provide backup') ||
          combined.includes('3 battles') ||
          combined.includes('3 raid') ||
          combined.includes('participating in 3') ||
          combined.includes('more than 3') ||
          combined.includes('up to 3') ||
          rawCombined.includes('3件まで') ||
          rawCombined.includes('同時に参戦できる') ||
          rawCombined.includes('参戦中') ||
          rawCombined.includes('3件')
        ) {
          isRaidBackupLimit = true;
          reason = `In-game modal detected: "${popupText.replace(/\s+/g, ' ') || 'Raids You can only provide backup in up to three raid battles at once.'}"`;
        } else if (
          combined.includes('access verification') ||
          combined.includes('verify access') ||
          combined.includes('verification challenge') ||
          combined.includes('画像認証') ||
          combined.includes('アクセス認証') ||
          combined.includes('セキュリティ認証') ||
          combined.includes('不正アクセス防止') ||
          combined.includes('歪んでいる文字') ||
          combined.includes('表示されている画像')
        ) {
          isCaptcha = true;
          reason = 'Access Verification / CAPTCHA challenge detected';
        } else if (combined.includes('not enough required items') || combined.includes('トレジャーが足りません') || combined.includes('chunky meat') || combined.includes('お肉')) {
          isOutOfMeat = true;
          reason = 'Insufficient Meat / Treasure to host this raid (Chunky Meat / 肉 depleted)';
        } else if (
          combined.includes('aap') ||
          rawCombined.includes('AAP') ||
          combined.includes('arcarum action point')
        ) {
          isOutOfAp = true;
          reason = 'Insufficient AAP (Arcarum Action Points) / Half-Elixirs needed for Replicard';
        } else if (combined.includes('not enough ap') || combined.includes('apが不足') || combined.includes('half elixir')) {
          isOutOfAp = true;
          reason = 'Insufficient AP / Half-Elixirs depleted';
        } else if (combined.includes('battle has already ended') || combined.includes('ended') || combined.includes('終了')) {
          reason = 'Previous battle concluded or raid no longer available';
        } else if (popupText) {
          reason = `In-game modal detected: "${popupText.substring(0, 80)}"`;
        }
      }

      // 3. Capture emergency screenshot to artifacts/captures
      const capDir = path.resolve(process.cwd(), 'artifacts/captures');
      if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
      capturePath = path.resolve(capDir, `quest-start-failed-run${runNumber}-${Date.now()}.png`);
      await this.page.screenshot({ path: capturePath, fullPage: false }).catch(() => null);

    } catch (err: any) {
      console.warn('[Diagnostic] Error during failure diagnosis:', err.message);
    }

    return { reason, popupText, isCaptcha, isOutOfMeat, isOutOfAp, isRaidBackupLimit, capturePath };
  }

  /**
   * Navigates to quest supporter URL, selects supporter, and ensures battle HUD is mounted.
   */
  private async selectSupporterAndStartQuest(
    autoReplenishAp: boolean,
    autoReplenishEp: boolean,
    logPath = this.currentLogPath,
    currentRuns = this.totalCompletedRuns
  ): Promise<boolean> {
    const targetUrl = this.template.questUrl;

    if (this.template.stopOnCaptcha !== false) {
      await this.sentinel.assertSafe();
    }

    // Check if lingering in an actual unfinished battle (e.g. #raid/12345 or #battle/12345)
    // Note: Do NOT match #quest/supporter_raid or #quest/assist as active combat!
    const initHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isReplicard = targetUrl.includes('replicard') || targetUrl.includes('819131') || targetUrl.includes('815091') || targetUrl.includes('816091');
    if (isReplicard && (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(initHash) || initHash.includes('replicard/battle') || initHash.includes('stage'))) {
      console.log(`[${this.accountId}] [Replicard] Active combat detected (${initHash}). Resuming combat directly...`);
      return true;
    }

    const isActualBattle = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(initHash);
    if (isActualBattle) {
      console.log(`[Workflow] Existing battle detected (${initHash}). Resolving prior battle...`);
      await this.resolveLingeringState();
    }

    // If targetUrl is an assist / raid finder URL
    if (targetUrl.includes('assist')) {
      const targetSlots = this.template.raidSlots || (this.template.raidSlot ? [this.template.raidSlot] : [4, 3, 2]);
      return await this.joinAssistRaidAndStartQuest(targetSlots, autoReplenishEp, logPath, currentRuns);
    }

    // Standard quest navigation
    const targetHash = targetUrl.split('#')[1] || '';
    const currentUrl = this.page.url();
    if (!currentUrl.includes(targetHash)) {
      await this.page.evaluate((hash: string) => {
        if (window.location.hash === '#' + hash) {
          window.location.reload();
        } else {
          window.location.hash = '#' + hash;
        }
      }, targetHash).catch(() => null);
      await logNormalDelay(350, 0.1);
    }

    const start = Date.now();
    while (Date.now() - start < 12000) {
      if (this.stopRequested) return false;

      if (this.template.stopOnCaptcha !== false) {
        await this.sentinel.assertSafe();
      }

      // Check if pending battle popup modal is currently displayed
      if (await this.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
        continue;
      }

      // Check Replicard AAP recovery modal before clicking start
      if (isReplicard && autoReplenishAp) {
        const aapHandled = await this.handleAapRecoveryModal(true);
        if (aapHandled) {
          await logNormalDelay(400, 0.1);
          continue;
        }
      }

      // 1. Deck confirmation / Quest Start OK button (.btn-usual-ok.se-quest-start)
      const autoOk = await this.page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle, .btn-usual-ok') as HTMLElement;
        if (ok && ok.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (autoOk) {
        if (isReplicard && autoReplenishAp) {
          await this.handleAapRecoveryModal(true);
        }
        const mounted = await this.waitForBattleToMount(12000);
        if (mounted) return true;
        if (await this.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
          continue;
        }
        if (isReplicard && autoReplenishAp) {
          const aapAfter = await this.handleAapRecoveryModal(true);
          if (aapAfter) continue;
        }
        return false;
      }

      // 2. AP replenishment popup
      if (autoReplenishAp) {
        const apHandled = await this.page.evaluate(() => {
          const elixirBtn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use') as HTMLElement;
          if (elixirBtn && elixirBtn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(elixirBtn).trigger('tap');
            elixirBtn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (apHandled) {
          await logNormalDelay(400, 0.1);
          continue;
        }
      }

      // 3. Supporter card selection
      const cardClicked = await this.page.evaluate((priorities: string[]) => {
        const cards = Array.from(document.querySelectorAll(
          '.prt-supporter-attribute.selected .lis-supporter, .prt-supporter-attribute .lis-supporter, .lis-supporter, .btn-supporter, .prt-supporter-detail'
        )) as HTMLElement[];
        const visibleCards = cards.filter(c => c.offsetParent !== null && c.getBoundingClientRect().height > 0);
        
        for (const p of priorities) {
          const match = visibleCards.find(c => (c.innerText || c.textContent || '').toLowerCase().includes(p.toLowerCase()));
          if (match) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(match).trigger('tap');
            match.click();
            return true;
          }
        }
        if (visibleCards.length > 0) {
          const first = visibleCards[0];
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(first).trigger('tap');
          first.click();
          return true;
        }
        return false;
      }, this.template.supporterPriority || ['Hades', 'Bahamut', 'Zeus', 'Lucifer', 'Kaguya']).catch(() => false);

      if (cardClicked) {
        await logNormalDelay(300, 0.1);
        const okClicked = await this.page.evaluate(() => {
          const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle, .btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (okClicked) {
          const mounted = await this.waitForBattleToMount(12000);
          if (mounted) return true;
        }

        if (await this.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
          continue;
        }
        continue;
      }

      await new Promise(r => setTimeout(r, 150));
    }

    return false;
  }

  /**
   * Finds, joins, and starts a Backup Request raid from #quest/assist with multi-slot rotation.
   */
  private async joinAssistRaidAndStartQuest(
    slots: number | number[],
    autoReplenishEp: boolean,
    logPath = this.currentLogPath,
    currentRuns = this.totalCompletedRuns
  ): Promise<boolean> {
    const slotList = Array.isArray(slots) ? slots : [slots];

    // Check if pending battles limit modal is shown
    await this.checkAndClearPendingBattles(logPath, currentRuns);

    // Navigate to #quest/assist if not already there (or if left on unclaimed/supporter_raid/other)
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isOnAssistFinder = (currentHash === '#quest/assist' || currentHash === '#quest/assist/index') && !currentHash.includes('unclaimed');
    if (!isOnAssistFinder) {
      console.log('[Workflow] Navigating to Backup Requests (#quest/assist)...');
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
        this.page.evaluate(() => {
          window.location.href = 'https://game.granbluefantasy.jp/#quest/assist';
          window.location.reload();
        }).catch(() => null)
      ]);
      await logNormalDelay(1000, 0.15);
    }

    // Check lingering active raids badge prior to searching
    const lingeringCount = await this.getLingeringJoinedRaidCount();
    if (lingeringCount >= 3) {
      console.warn(`[Workflow] ⚠️ Active backup limit detected prior to search (${lingeringCount}/3 raids in progress).`);
      this.lastStartFailureWasRaidLimit = true;
      await this.resolveLingeringRaidLimit(logPath, currentRuns);
      return false;
    }

    // Switch to Finder tab (#tab-search)
    const finderTab = await this.page.waitForSelector('#tab-search, .btn-tabs#tab-search', { visible: true, timeout: 5000 }).catch(() => null);
    if (finderTab) {
      const isActive = await this.page.evaluate((el: any) => el.classList.contains('active'), finderTab);
      if (!isActive) {
        await humanizedClick(this.page, finderTab);
        await logNormalDelay(600, 0.15);
      }
    }

    // Scan slots for eligible candidate
    const t0 = Date.now();
    const maxSearchMs = 45000;
    let raidClicked = false;
    let slotCycleIndex = 0;

    while (Date.now() - t0 < maxSearchMs && !raidClicked && !this.stopRequested) {
      const currentSlot = slotList[slotCycleIndex % slotList.length];
      slotCycleIndex++;

      // 1. Activate the slot button (.btn-search-switch.slot${currentSlot})
      const slotBtn = await this.page.waitForSelector(`.btn-search-switch.slot${currentSlot}, [data-slot="${currentSlot}"].btn-search-switch`, { visible: true, timeout: 2500 }).catch(() => null);
      if (slotBtn) {
        const isSlotActive = await this.page.evaluate((el: any) => el.classList.contains('active'), slotBtn).catch(() => false);
        if (!isSlotActive) {
          console.log(`[Workflow] Switching to Slot ${currentSlot}...`);
          await humanizedClick(this.page, slotBtn);
          await logNormalDelay(500, 0.12);
        }
      }

      // Check full/ended raid popup
      await this.dismissFullOrEndedRaidPopup();

      // 2. Scan cards in #prt-search-list
      const rawCandidates: RaidCandidate[] = await this.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('#prt-search-list .btn-multi-raid.lis-raid.search, #prt-search-list .btn-multi-raid, .lis-raid.search'));
        return cards.map((c, i) => {
          const el = c as HTMLElement;
          if (el.offsetParent === null) return null;

          const gauge = el.querySelector('.prt-raid-gauge-inner') as HTMLElement;
          const hpWidth = gauge?.style?.width || '0%';
          const hpPct = parseFloat(hpWidth) || 0;

          const playerEl = el.querySelector('.prt-flees-in') as HTMLElement;
          const playerText = playerEl ? (playerEl.innerText || '') : '';
          const match = playerText.match(/(\d+)\s*\/\s*(\d+)/);
          const players = match ? parseInt(match[1], 10) : 0;
          const maxPlayers = match ? parseInt(match[2], 10) : 30;

          const raidId = el.getAttribute('data-raid-id') || el.dataset?.raidId || '';
          const rect = el.getBoundingClientRect();

          return {
            index: i,
            raidId,
            hpPct,
            players,
            maxPlayers,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }).filter(Boolean) as any[];
      }).catch(() => []);

      // Prune dead raid IDs older than 2 minutes
      const now = Date.now();
      for (const [id, ts] of this.deadRaidIds.entries()) {
        if (now - ts > 120000) this.deadRaidIds.delete(id);
      }

      const isOtk = this.template.evaluatorStrategy === 'otk_burst';
      const evalOptions: RaidEvaluationOptions = {
        strategy: this.template.evaluatorStrategy || 'honor',
        minScore: this.template.minRaidScore ?? RaidEvaluator.DEFAULT_MIN_SCORE,
        minHpPct: this.template.minHpPct ?? (isOtk ? 1 : RaidEvaluator.DEFAULT_MIN_HP),
        maxHpPct: this.template.maxHpPct ?? (isOtk ? RaidEvaluator.DEFAULT_OTK_MAX_HP : undefined),
        minPlayers: this.template.minPlayers ?? (isOtk ? RaidEvaluator.DEFAULT_OTK_MIN_PLAYERS : 1),
        maxPlayers: this.template.maxPlayers ?? (isOtk ? 29 : RaidEvaluator.DEFAULT_MAX_PLAYERS),
        deadRaidIds: this.deadRaidIds,
        useCache: true
      };

      const selection = RaidEvaluator.selectBestCandidate(rawCandidates, evalOptions);
      const candidate = selection.best;

      if (candidate) {
        this.currentRaidId = candidate.raidId || 'pending';
        this.sentinel?.setSessionContext?.({
          raidId: candidate.raidId,
          hpPct: candidate.hpPct,
          players: `${candidate.players}/${candidate.maxPlayers || 30}`
        });

        console.log(`[Workflow] Selected Slot ${currentSlot} raid (ID: ${candidate.raidId || 'pending'}, Score: ${candidate.score} pt [Grade ${candidate.grade}], HP: ${candidate.hpPct}%, Players: ${candidate.players}/${candidate.maxPlayers || 30}). Joining...`);

        const cardElements = await this.page.$$('#prt-search-list .btn-multi-raid.lis-raid.search, #prt-search-list .btn-multi-raid, .lis-raid.search');
        const targetCard = cardElements[candidate.index];
        if (targetCard) {
          await humanizedClick(this.page, targetCard);
        } else if (candidate.x && candidate.y) {
          await this.page.touchscreen.tap(candidate.x, candidate.y).catch(() => null);
        }

        // Await transition: either #quest/supporter_raid mounts OR a popup modal appears
        const transitionState = await this.waitForSupporterOrModal(10000);

        if (transitionState === 'FULL_OR_ENDED') {
          console.warn(`[Workflow] Raid ${candidate.raidId || ''} was already full or ended. Blacklisting and continuing search...`);
          if (candidate.raidId) {
            this.deadRaidIds.set(candidate.raidId, Date.now());
          }
          await this.dismissFullOrEndedRaidPopup();
          const refreshBtn = await this.page.$('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
          if (refreshBtn) {
            await humanizedClick(this.page, refreshBtn);
            await logNormalDelay(800, 0.12);
          }
          if (Date.now() - t0 < maxSearchMs) {
            continue;
          }
          this.lastStartFailureWasRaidWait = true;
          return false;
        }

        if (transitionState === 'ACTIVE_RAID_LIMIT_3') {
          console.warn('[Workflow] ⚠️ Active raid limit reached (3 simultaneous battles in progress).');
          this.lastStartFailureWasRaidLimit = true;
          await this.resolveLingeringRaidLimit(logPath, currentRuns);
          return false;
        }

        if (transitionState === 'PENDING_LIMIT') {
          console.warn('[Workflow] Pending battle limit reached. Clearing all unclaimed battles...');
          await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
          return false;
        }

        if (transitionState === 'DIRECT_COMBAT') {
          return await this.waitForBattleToMount(12000);
        }

        if (transitionState === 'TIMEOUT') {
          console.warn('[Workflow] Supporter screen navigation timed out.');
          this.lastStartFailureWasRaidWait = true;
          return false;
        }

        raidClicked = true;
        break;
      } else {
        if (selection.nonViableCandidates.length > 0) {
          const top = selection.nonViableCandidates[0];
          console.log(`[Workflow] Slot ${currentSlot}: ${rawCandidates.length} raid(s) scanned, none meet viability score (Top: ${top.score || 0} pt [Grade ${top.grade || 'F'}, HP ${top.hpPct}%, ${top.players}/${top.maxPlayers} players] - ${top.reason}). Skipping...`);
        }

        // If all slots checked in this pass, click search refresh if available
        if (slotCycleIndex % slotList.length === 0) {
          const refreshBtn = await this.page.$('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
          if (refreshBtn) {
            await humanizedClick(this.page, refreshBtn);
            await logNormalDelay(1000, 0.15);
          } else {
            await new Promise(r => setTimeout(r, 1000));
          }
        } else {
          await logNormalDelay(350, 0.1);
        }
      }
    }

    if (!raidClicked) {
      console.log('[Workflow] No high-quality raids found within search window. Pausing briefly to allow fresh raids to appear...');
      this.lastStartFailureWasRaidWait = true;
      await logNormalDelay(2500, 0.15);
      return false;
    }

    // 2. Select Supporter Summon by priority
    const suppSelected = await this.selectSupporterCard(this.template.supporterPriority || ['Hades', 'Bahamut', 'Zeus', 'Lucifer', 'Kaguya']);
    if (!suppSelected) {
      console.warn('[Workflow] Could not select supporter summon.');
      return false;
    }

    // 3. Confirm Party & Start Quest (handling Soul Berry EP replenishment if needed)
    return await this.confirmPartyAndStartRaid(autoReplenishEp, logPath, currentRuns);
  }

  /**
   * Intelligently waits for at least one active raid slot to free up when the 3-raid limit is hit.
   * Backwards-compatible method that delegates to performPassiveWaitCycle.
   */
  private async waitForActiveRaidSlot(maxWaitSec = 90): Promise<boolean> {
    return await this.performPassiveWaitCycle(this.template.logPath || 'logs/workflow.md', 0);
  }

  /**
   * Reads the current number of joined/in-progress raids from the Recent/Joined tab badge (#tab-multi).
   * Returns 0-3 (or -1 if unable to read).
   */
  public async getLingeringJoinedRaidCount(): Promise<number> {
    try {
      return await this.page.evaluate(() => {
        const multiTab = document.querySelector('#tab-multi, .btn-tabs#tab-multi, [data-tab="multi"], [data-tab="recent"], [data-tab="joined"]');
        if (multiTab) {
          const badge = multiTab.querySelector('.prt-badge, .ico-badge, .cnt-badge');
          if (badge) {
            const num = parseInt(badge.textContent || '0', 10);
            return isNaN(num) ? 0 : num;
          }
          return 0;
        }
        return -1;
      });
    } catch {
      return -1;
    }
  }

  /**
   * Intelligently resolves the 3-raid backup limit when hit:
   * 1. Checks/clears any already completed pending battles.
   * 2. High chance (~80%): Navigates to #quest/assist -> Recent/Joined tab, selects raid with
   *    highest HP / fewer players, rejoins, uses random buff skills + attack + reload,
   *    helps for 5s - 20s (or until clear), and rechecks lingering count.
   * 3. Low chance (~20%): Passive wait for 0.5 - 15 minutes, polling every 12-15s to claim
   *    completed battles until a slot frees up.
   * 4. Enforces pending battle check every 5 joined and cleared battles.
   */
  public async resolveLingeringRaidLimit(logPath = this.currentLogPath, currentRuns = this.totalCompletedRuns): Promise<boolean> {
    console.log(`\n========================================================================`);
    console.log(`[Workflow] 🛡️ Resolving 3-Raid Backup Limit on Account [${this.accountId}]`);
    console.log(`========================================================================`);

    // 1. Proactively dismiss any open modal
    await this.dismissPopupModal();

    // 2. Check and claim any pending battles that may have already finished
    const initialClaimed = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
    if (initialClaimed > 0) {
      this.totalJoinedAndClearedBattles += initialClaimed;
      console.log(`[Workflow] 🎉 Initial sweep claimed ${initialClaimed} pending battle(s).`);
      await this.checkFiveBattleMilestone(logPath, currentRuns);
    }

    // 3. Check lingering count
    let lingeringCount = await this.getLingeringJoinedRaidCount();
    if (lingeringCount >= 0 && lingeringCount < 3) {
      console.log(`[Workflow] ✅ Active raids in progress dropped to ${lingeringCount}/3. Slot freed up!`);
      this.joinedInCurrentBatch = lingeringCount;
      return true;
    }

    // 4. Decide strategy: In otk_burst mode, 100% active assist cycle to clear fast; otherwise ~80% Active Assist Helper, ~20% Passive Wait
    const isOtk = this.template?.evaluatorStrategy === 'otk_burst';
    const shouldActivelyHelp = isOtk || (Math.random() < 0.80);

    if (shouldActivelyHelp) {
      console.log(`[Workflow] ⚔️ Strategy chosen: ACTIVE ASSIST (${isOtk ? '100% OTK burst clearing' : '~80% probability'}).`);
      const assisted = await this.performActiveAssistCycle(logPath, currentRuns);
      if (assisted) return true;
      // If active assist didn't free a slot (e.g. raid was still bulky), fall back to passive wait
    } else {
      console.log(`[Workflow] ⏳ Strategy chosen: PASSIVE WAIT (~20% probability).`);
    }

    // Passive Wait (also fallback if active assist didn't free slot)
    return await this.performPassiveWaitCycle(logPath, currentRuns);
  }

  /**
   * Performs an active assist on a lingering raid:
   * - Navigates to #quest/assist -> Recent/Joined tab
   * - Scans joined raids, picks the one with most HP / fewer players
   * - Rejoins raid, uses random buff skills + attack + reload for 5s - 20s
   * - If clear detected, records settlement and checks 5-battle milestone
   * - Rechecks lingering count at #quest/assist
   */
  private async performActiveAssistCycle(logPath: string, currentRuns: number): Promise<boolean> {
    try {
      // 1. Ensure we are on #quest/assist
      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (!curHash.includes('quest/assist') || curHash.includes('unclaimed')) {
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
          this.page.evaluate(() => {
            window.location.href = 'https://game.granbluefantasy.jp/#quest/assist';
            window.location.reload();
          }).catch(() => null)
        ]);
        await logNormalDelay(1000, 0.15);
      }

      // 2. Switch to Recent / Joined tab (#tab-multi)
      await this.switchToRecentJoinedTab();
      await logNormalDelay(600, 0.15);

      // 3. Scan joined raid cards
      const candidates = await this.scanJoinedRaidCards();
      if (candidates.length === 0) {
        console.log('[Workflow] No active joined raids found on Recent tab. Checking pending claims...');
        await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
        return true;
      }

      // 4. Sort by most HP first, then fewer players
      candidates.sort((a, b) => {
        const hpDiff = b.hpPct - a.hpPct;
        if (Math.abs(hpDiff) > 2) return hpDiff;
        return a.players - b.players;
      });

      const selected = candidates[0];
      console.log(`[Workflow] ⚔️ Selected lingering raid to help: "${selected.questName || 'Unknown'}" (HP: ${selected.hpPct}%, Players: ${selected.players}/${selected.maxPlayers}, ID: ${selected.raidId})`);

      // 5. Click the raid card to rejoin
      await this.clickJoinedRaidCard(selected);

      // 6. Wait for battle HUD or result
      const mountState = await this.waitForBattleToMountOrResult(12000);

      if (mountState === 'RESULT') {
        console.log('[Workflow] 🎉 Lingering raid was already completed! Resolving result...');
        await this.handleConfirmResult();
        this.totalJoinedAndClearedBattles++;
        await this.checkFiveBattleMilestone(logPath, currentRuns);
      } else if (mountState === 'MOUNTED') {
        // In combat: assist for 5s - 20s
        const helpDurationMs = Math.floor(Math.random() * (20000 - 5000 + 1)) + 5000;
        console.log(`[Workflow] ⚔️ Assisting in lingering battle for ${(helpDurationMs / 1000).toFixed(1)}s (buffs -> attack -> reload)...`);
        const tStart = Date.now();

        // Step 0: Broadcast backup request if available
        const assistBtn = await this.page.$('.btn-assist, .btn-request').catch(() => null);
        if (assistBtn) {
          console.log('[Workflow] Broadcasting backup request to invite active helpers...');
          await this.handleBackupRequest().catch(() => null);
          await logNormalDelay(250, 0.1);
        }

        // Step A: Click random buff skill
        if (!await this.isBattleEnded()) {
          const randChar = Math.floor(Math.random() * 3) + 1; // Character 1, 2, or 3
          const randSkill = Math.floor(Math.random() * 4) + 1; // Skill 1, 2, 3, or 4
          console.log(`[Workflow] Using random buff skill (C${randChar}S${randSkill})...`);
          await this.handleSkill({
            code: 'skill',
            character: randChar,
            skill: randSkill,
            optional: true
          });
          await logNormalDelay(350, 0.15);
        }

        // Step B: Attack
        if (!await this.isBattleEnded()) {
          console.log('[Workflow] Triggering attack in lingering raid...');
          await this.handleAttack({
            code: 'attack',
            waitForNetwork: 'normal_attack_result.json'
          });
          await logNormalDelay(250, 0.12);
        }

        // Step C: Reload
        if (!await this.isBattleEnded()) {
          console.log('[Workflow] Reloading after attack...');
          await this.handleReload({ code: 'reload' });
          await this.waitForCombatInputReady(4000).catch(() => null);
        }

        // Step D: Spend remaining time in the 5s - 20s window monitoring if battle clears
        const remainingMs = helpDurationMs - (Date.now() - tStart);
        if (remainingMs > 500) {
          const deadline = Date.now() + remainingMs;
          while (Date.now() < deadline && !this.stopRequested) {
            if (await this.isBattleEnded()) break;
            await new Promise(r => setTimeout(r, 800));
          }
        }

        // Check if battle cleared
        if (await this.isBattleEnded()) {
          console.log('[Workflow] 🎉 Lingering raid cleared while assisting!');
          await this.handleConfirmResult();
          this.totalJoinedAndClearedBattles++;
          await this.checkFiveBattleMilestone(logPath, currentRuns);
        }
      }

      // 7. Return to #quest/assist and check lingering count
      console.log('[Workflow] Returning to Backup Requests (#quest/assist) to recheck lingering slots...');
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
        this.page.evaluate(() => {
          window.location.href = 'https://game.granbluefantasy.jp/#quest/assist';
          window.location.reload();
        }).catch(() => null)
      ]);
      await logNormalDelay(1000, 0.15);

      const lingeringRemaining = await this.getLingeringJoinedRaidCount();
      if (lingeringRemaining >= 0 && lingeringRemaining < 3) {
        console.log(`[Workflow] ✅ Lingering raids reduced to ${lingeringRemaining}/3. Slot freed up! Resuming primary GB farm...`);
        this.joinedInCurrentBatch = lingeringRemaining;
        return true;
      }

      console.log(`[Workflow] Lingering raids still at ${lingeringRemaining}/3.`);
      return false;
    } catch (err: any) {
      console.warn('[Workflow] Notice during active assist cycle:', err.message);
      return false;
    }
  }

  /**
   * Performs passive wait for lingering raids to clear:
   * - Random duration between 0.5 min (30s) and up to 15 min (900s)
   * - Periodically checks and claims pending battles every 12-15s
   * - Early exits as soon as any battle is claimed or lingering badge < 3
   */
  private async performPassiveWaitCycle(logPath: string, currentRuns: number): Promise<boolean> {
    // Random wait between 30s and up to 15m (typically 45s-180s, occasional longer wait)
    const isLongWait = Math.random() < 0.12;
    const waitSeconds = isLongWait
      ? Math.floor(Math.random() * (900 - 180 + 1)) + 180
      : Math.floor(Math.random() * (180 - 30 + 1)) + 30;

    const t0 = Date.now();
    const maxWaitMs = waitSeconds * 1000;
    let pollCount = 0;

    console.log(`[Workflow] ⏳ Waiting up to ${(waitSeconds / 60).toFixed(1)}m (${waitSeconds}s) for participants to clear active raids...`);

    while (Date.now() - t0 < maxWaitMs && !this.stopRequested) {
      pollCount++;
      const pollDelay = Math.floor(Math.random() * 3000) + 12000; // 12-15s poll interval
      await new Promise(r => setTimeout(r, pollDelay));
      if (this.stopRequested) return false;

      console.log(`[Workflow] [Wait Poll #${pollCount}] Checking if any lingering battle concluded...`);
      const claimed = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
      if (claimed > 0) {
        this.totalJoinedAndClearedBattles += claimed;
        console.log(`[Workflow] 🎉 Raid concluded and claimed (${claimed} claimed)! Active slot freed up.`);
        await this.checkFiveBattleMilestone(logPath, currentRuns);
        return true;
      }

      const activeCount = await this.getLingeringJoinedRaidCount();
      if (activeCount >= 0 && activeCount < 3) {
        console.log(`[Workflow] ✅ Active battles in progress dropped to ${activeCount}/3. Slot freed up!`);
        this.joinedInCurrentBatch = activeCount;
        return true;
      }
    }

    console.log(`[Workflow] Passive wait interval (${waitSeconds}s) finished. Rechecking state...`);
    return true;
  }

  /**
   * Switches to the Recent / Joined raids tab (#tab-multi) on #quest/assist.
   */
  private async switchToRecentJoinedTab(): Promise<void> {
    await this.page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll(
        '#tab-multi, .btn-tabs#tab-multi, [data-tab="multi"], [data-tab="recent"], [data-tab="joined"], .tab-multi, .tab-recent, .tab-joined, .btn-tabs'
      )) as HTMLElement[];
      for (const t of tabs) {
        const text = (t.innerText || t.textContent || '').toLowerCase();
        const id = t.id || '';
        const dataTab = t.getAttribute('data-tab') || '';
        if (
          id === 'tab-multi' ||
          dataTab === 'multi' ||
          dataTab === 'recent' ||
          dataTab === 'joined' ||
          text.includes('joined') ||
          text.includes('recent') ||
          text.includes('参戦中')
        ) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(t).trigger('tap');
          t.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
  }

  /**
   * Scans joined raid cards inside the Recent / Joined tab panel.
   */
  private async scanJoinedRaidCards(): Promise<Array<{
    index: number;
    raidId: string;
    questName: string;
    hpPct: number;
    players: number;
    maxPlayers: number;
    x: number;
    y: number;
  }>> {
    return await this.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(
        '#prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid, .cnt-quest-assist .btn-multi-raid, #prt-search-list ~ .prt-raid-list .btn-multi-raid'
      )) as HTMLElement[];

      const validCards = cards.filter(c => c.offsetParent !== null);
      const targetCards = validCards.length > 0
        ? validCards
        : (Array.from(document.querySelectorAll('.btn-multi-raid.lis-raid, .btn-multi-raid, .lis-raid')) as HTMLElement[]).filter(c => c.offsetParent !== null);

      return targetCards.map((el, i) => {
        const gauge = el.querySelector('.prt-raid-gauge-inner, .prt-gauge-inner, .prt-hp-gauge-inner') as HTMLElement;
        const hpWidth = gauge?.style?.width || '100%';
        const hpPct = parseFloat(hpWidth) || 100;

        const playerEl = el.querySelector('.prt-flees-in, .prt-member, .txt-member, .prt-raid-gauge') as HTMLElement;
        const playerText = playerEl ? (playerEl.innerText || '') : '';
        const match = playerText.match(/(\d+)\s*\/\s*(\d+)/);
        const players = match ? parseInt(match[1], 10) : 1;
        const maxPlayers = match ? parseInt(match[2], 10) : 30;

        const nameEl = el.querySelector('.txt-quest-name, .prt-quest-name, .txt-name, .txt-title') as HTMLElement;
        const questName = nameEl ? (nameEl.innerText?.trim() || '') : '';

        const raidId = el.getAttribute('data-raid-id') || el.dataset?.raidId || el.getAttribute('data-href') || '';
        const rect = el.getBoundingClientRect();

        return {
          index: i,
          raidId,
          questName,
          hpPct,
          players,
          maxPlayers,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      });
    }).catch(() => []);
  }

  /**
   * Clicks a joined raid card from the Recent / Joined list to rejoin combat.
   */
  private async clickJoinedRaidCard(candidate: { index: number; x: number; y: number }): Promise<void> {
    const cardElements = await this.page.$$(
      '#prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid, .cnt-quest-assist .btn-multi-raid, .btn-multi-raid.lis-raid, .btn-multi-raid, .lis-raid'
    );
    const targetEl = cardElements[candidate.index];
    if (targetEl) {
      await humanizedClick(this.page, targetEl);
      await targetEl.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        el.click();
      }).catch(() => null);
    } else if (candidate.x > 0 && candidate.y > 0) {
      await this.page.touchscreen.tap(candidate.x, candidate.y).catch(() => null);
    }
  }

  /**
   * Waits for battle HUD to mount or result screen/modal to appear upon rejoining.
   */
  private async waitForBattleToMountOrResult(timeoutMs = 12000): Promise<'MOUNTED' | 'RESULT' | 'TIMEOUT'> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return 'TIMEOUT';
      const state = await this.page.evaluate(() => {
        const hash = window.location.hash;
        if (hash.includes('result') || document.querySelector('.pop-raid-result, .prt-result-head')) {
          return 'RESULT';
        }
        const modal = document.querySelector('.pop-usual, #pop');
        if (modal && (modal as HTMLElement).offsetParent !== null) {
          const text = (modal as HTMLElement).innerText || '';
          if (text.includes('ended') || text.includes('終了')) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
            if (ok) ok.click();
            return 'RESULT';
          }
        }
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        const stage = (window as any).stage;
        if (isCombat && stage?.gGameStatus) {
          return 'MOUNTED';
        }
        if (document.querySelector('.lis-character0, .btn-attack-start.display-on')) {
          return 'MOUNTED';
        }
        return null;
      }).catch(() => null);

      if (state) return state as any;
      await new Promise(r => setTimeout(r, 150));
    }
    return 'TIMEOUT';
  }

  /**
   * Proactively dismisses any popup modal visible on page.
   */
  private async dismissPopupModal(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
      if (modal && (modal as HTMLElement).offsetParent !== null) {
        const ok = modal.querySelector('.btn-usual-ok, #pop .btn-usual-ok, .btn-usual-close') as HTMLElement;
        if (ok) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
  }

  /**
   * Guarantees that every 5 battles joined & cleared (primary or assist),
   * pending battles are checked and swept.
   */
  private async checkFiveBattleMilestone(logPath: string, currentRuns: number): Promise<void> {
    if (this.totalJoinedAndClearedBattles > 0 && this.totalJoinedAndClearedBattles % 5 === 0) {
      console.log(`\n========================================================================`);
      console.log(`[Workflow] 🛡️ 5-Battle Milestone Reached (${this.totalJoinedAndClearedBattles} battles joined & cleared)`);
      console.log(`[Workflow] Checking and sweeping pending battles to avoid GBF 5-battle hard lock...`);
      console.log(`========================================================================\n`);
      await this.claimPendingBattles(logPath, currentRuns);
    }
  }

  /**
   * Waits for supporter screen to mount or detects early modal dismissal (room full, ended, limit).
   */
  private async waitForSupporterOrModal(timeoutMs = 10000): Promise<'SUPPORTER_READY' | 'FULL_OR_ENDED' | 'PENDING_LIMIT' | 'ACTIVE_RAID_LIMIT_3' | 'DIRECT_COMBAT' | 'TIMEOUT'> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return 'TIMEOUT';

      const state = await this.page.evaluate(() => {
        const hash = window.location.hash;

        // 1. Direct combat hash
        if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash)) {
          return 'DIRECT_COMBAT';
        }

        // 2. Check for popups/modals
        const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
        if (modal && (modal as HTMLElement).offsetParent !== null) {
          const text = (modal as HTMLElement).innerText || '';
          if (text.includes('already full') || text.includes('already ended') || text.includes('参加人数') || text.includes('終了')) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
            if (ok) ok.click();
            return 'FULL_OR_ENDED';
          }
          const rawText = (modal as HTMLElement).innerText || (modal as HTMLElement).textContent || '';
          const lowerText = text.toLowerCase();
          const isThreeRaidLimit = (
            lowerText.includes('three raid') ||
            lowerText.includes('up to three') ||
            lowerText.includes('provide backup in up to') ||
            lowerText.includes('only provide backup') ||
            lowerText.includes('3 battles') ||
            lowerText.includes('3 raid') ||
            lowerText.includes('participating in 3') ||
            lowerText.includes('more than 3') ||
            lowerText.includes('up to 3') ||
            rawText.includes('3件まで') ||
            rawText.includes('同時に参戦できる') ||
            rawText.includes('参戦中') ||
            rawText.includes('3件')
          );
          if (isThreeRaidLimit) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
            if (ok) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(ok).trigger('tap');
              ok.click();
            }
            return 'ACTIVE_RAID_LIMIT_3';
          }
          if (
            lowerText.includes('pending') ||
            lowerText.includes('unclaimed') ||
            rawText.includes('未確認') ||
            lowerText.includes('five or more') ||
            rawText.includes('5件')
          ) {
            const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
            if (ok) ok.click();
            return 'PENDING_LIMIT';
          }
        }

        // 3. Supporter raid screen with cards mounted
        if (hash.includes('supporter_raid') || hash.includes('supporter')) {
          const suppCards = document.querySelectorAll('.btn-supporter, .lis-supporter, .prt-supporter-attribute .lis-supporter, .prt-supporter-detail');
          const hasVisibleCards = Array.from(suppCards).some(c => (c as HTMLElement).offsetParent !== null);
          if (hasVisibleCards) {
            return 'SUPPORTER_READY';
          }
        }

        return null;
      }).catch(() => null);

      if (state) return state as any;
      await new Promise(r => setTimeout(r, 150));
    }
    return 'TIMEOUT';
  }

  /**
   * Scans and selects supporter summon card on #quest/supporter_raid by priority.
   */
  private async selectSupporterCard(priorities: string[]): Promise<boolean> {
    const cardSelected = await this.page.evaluate((priors: string[]) => {
      const cards = Array.from(document.querySelectorAll(
        '.btn-supporter, .lis-supporter, .prt-supporter-attribute .lis-supporter, .prt-supporter-detail'
      )) as HTMLElement[];

      const visibleCards = cards.filter(c => c.offsetParent !== null && c.getBoundingClientRect().height > 0);
      if (visibleCards.length === 0) return false;

      // 1. Match priorities
      for (const p of priors) {
        const match = visibleCards.find(c => (c.innerText || c.textContent || '').toLowerCase().includes(p.toLowerCase()));
        if (match) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(match).trigger('tap');
          match.click();
          return true;
        }
      }

      // 2. Fallback to first available supporter
      const first = visibleCards[0];
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(first).trigger('tap');
      first.click();
      return true;
    }, priorities).catch(() => false);

    if (cardSelected) {
      await logNormalDelay(400, 0.12);
      return true;
    }
    return false;
  }

  /**
   * Confirms party and clicks Quest Start OK button, handling Soul Berry EP replenishment if needed.
   */
  private async confirmPartyAndStartRaid(
    autoReplenishEp: boolean,
    logPath = this.currentLogPath,
    currentRuns = this.totalCompletedRuns
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if (this.stopRequested) return false;

      // Check if pending battle popup modal appeared during party confirmation
      if (await this.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
        return false;
      }

      // 1. Check if direct combat already mounted
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash)) {
        return await this.waitForBattleToMount(12000);
      }

      // 2. Handle EP replenishment (Soul Berry) if modal appears
      const berryModal = await this.page.evaluate((replenish: boolean) => {
        const berryBtn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use') as HTMLElement;
        if (berryBtn && berryBtn.offsetParent !== null) {
          if (!replenish) return 'EP_DENIED';
          berryBtn.click();
          return 'BERRY_CLICKED';
        }
        return null;
      }, autoReplenishEp).catch(() => null);

      if (berryModal === 'EP_DENIED') {
        console.warn('[Workflow] EP depleted and autoReplenishEp is disabled.');
        return false;
      }
      if (berryModal === 'BERRY_CLICKED') {
        await logNormalDelay(350, 0.1);
        // Confirm Soul Berry usage in confirmation popup
        const confirmBerry = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 3000 }).catch(() => null);
        if (confirmBerry) {
          await humanizedClick(this.page, confirmBerry);
          await logNormalDelay(400, 0.1);
        }
        continue;
      }

      // 3. Click Quest Start OK button (.btn-usual-ok.se-quest-start)
      const startBtn = await this.page.waitForSelector(
        '.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle',
        { visible: true, timeout: 1500 }
      ).catch(() => null);

      if (startBtn) {
        await humanizedClick(this.page, startBtn);
        await startBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          el.click();
        }).catch(() => null);

        const mounted = await this.waitForBattleToMount(12000);
        if (mounted) return true;
        if (await this.detectAndHandlePendingBattleModal(logPath, currentRuns)) {
          return false;
        }
        return false;
      }

      // Check full/ended raid modal
      if (await this.dismissFullOrEndedRaidPopup()) {
        console.warn('[Workflow] Raid was full or ended during party confirmation.');
        return false;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    return false;
  }

  private async dismissFullOrEndedRaidPopup(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
        if (!modal) return false;
        const text = (modal as HTMLElement).innerText || '';
        if (text.includes('already ended') || text.includes('already full') || text.includes('参加人数') || text.includes('終了')) {
          const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
          if (ok) ok.click();
          return true;
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  private async checkAndClearPendingBattles(logPath = this.currentLogPath, currentRuns = this.totalCompletedRuns): Promise<void> {
    const isLimit = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
      if (!modal || (modal as HTMLElement).offsetParent === null) return false;
      const text = ((modal as HTMLElement).innerText || '').toLowerCase();
      const rawText = (modal as HTMLElement).innerText || '';
      return (
        text.includes('three raid') ||
        text.includes('up to three') ||
        text.includes('provide backup in up to') ||
        text.includes('only provide backup') ||
        text.includes('pending') ||
        text.includes('unclaimed') ||
        rawText.includes('未確認') ||
        text.includes('five or more') ||
        text.includes('3 battles') ||
        text.includes('3 raid') ||
        text.includes('participating in 3') ||
        text.includes('more than 3') ||
        text.includes('up to 3') ||
        rawText.includes('3件まで') ||
        rawText.includes('同時に参戦できる') ||
        rawText.includes('参戦中') ||
        rawText.includes('3件') ||
        rawText.includes('5件')
      );
    }).catch(() => false);

    if (isLimit) {
      console.log('[Workflow] Raid limit / pending battles modal detected. Clearing all unclaimed battles...');
      await this.page.evaluate(() => {
        const ok = document.querySelector('.pop-usual .btn-usual-ok, #pop .btn-usual-ok, .btn-usual-close') as HTMLElement;
        if (ok) ok.click();
      }).catch(() => null);
      await logNormalDelay(400, 0.1);
      const returnUrl = this.template.questUrl.includes('assist') ? 'https://game.granbluefantasy.jp/#quest/assist' : this.template.questUrl;
      await this.claimPendingBattles(logPath, currentRuns, returnUrl);
    }
  }

  private async resolveLingeringState(): Promise<void> {
    try {
      if (await this.sentinel.inspectForVerification()) {
        console.warn('[Workflow] 🛑 CAPTCHA detected. resolveLingeringState aborted to preserve puzzle for operator.');
        return;
      }

      const hasRestartPop = await this.page.evaluate(() => {
        const pop = document.querySelector('.popRestartQuest, .pop-usual');
        if (pop && pop.textContent?.includes('in progress')) {
          const ok = pop.querySelector('.btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (hasRestartPop) {
        await this.waitForBattleToMount(10000);
      } else {
        await this.dismissOpenModals();
      }

      let attempts = 0;
      while (attempts < 6) {
        if (await this.isBattleEnded()) break;
        const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        if (!isCombat) break;

        // If in multi-raid assist mode, do NOT attack 6 times in a completed burst raid!
        const isAssistRaid = this.template.questUrl.includes('assist') || (this.template.raidSlots && this.template.raidSlots.length > 0);
        if (isAssistRaid) {
          console.log(`[Workflow] In multi-raid assist mode. Exiting lingering raid (${hash}) to #quest/assist...`);
          await this.syncCurrentHonors();
          await this.page.evaluate(() => { window.location.hash = '#quest/assist'; }).catch(() => null);
          await logNormalDelay(800, 0.15);
          break;
        }

        console.log(`[Workflow] Lingering raid detected (${hash}). Resolving battle turn...`);
        await new Promise(r => setTimeout(r, 200));
        await this.dismissOpenModals();

        const atkBtn = await this.page.waitForSelector('.btn-attack-start.display-on, .btn-attack-start', { visible: true, timeout: 5000 }).catch(() => null);
        if (atkBtn) {
          await humanizedClick(this.page, atkBtn);
          await this.waitForNetworkResponse('normal_attack_result.json', 3500);
          await logNormalDelay(400, 0.1);
        } else {
          await this.page.touchscreen.tap(260, 380).catch(() => null);
          await new Promise(r => setTimeout(r, 1000));
        }

        if (await this.isBattleEnded()) break;

        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
          this.page.evaluate(() => location.reload()).catch(() => null)
        ]);

        await this.waitForBattleToMount(6000);
        await this.dismissOpenModals();
        attempts++;
      }

      const endHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      const isStillCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(endHash);
      if (endHash.includes('result') || isStillCombat) {
        await this.page.evaluate(() => {
          const ok = document.querySelector('.btn-usual-ok, .btn-settle') as HTMLElement;
          if (ok && ok.offsetParent !== null) ok.click();
          window.location.href = 'https://game.granbluefantasy.jp/#quest/index';
        }).catch(() => null);
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch {}
  }

  private async dismissOpenModals(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        let dismissed = false;
        const btns = Array.from(document.querySelectorAll('.btn-usual-close, .btn-usual-ok, .pop-usual .btn-usual-cancel, .prt-popup-header .btn-close')) as HTMLElement[];
        for (const b of btns) {
          if (b.offsetParent !== null && window.getComputedStyle(b).display !== 'none') {
            b.click();
            dismissed = true;
          }
        }
        return dismissed;
      });
    } catch {
      return false;
    }
  }

  private async checkAndDismissProcessingTurnPopup(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-usual, .prt-popup-header');
        if (pop) {
          const ok = pop.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            ok.click();
            return true;
          }
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  private async isBattleEnded(): Promise<boolean> {
    try {
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.includes('result') || hash.includes('supporter') || hash.includes('mypage') || hash.includes('quest/index')) {
        return true;
      }

      return await this.page.evaluate(() => {
        if (document.querySelector('.pop-raid-result')) {
          return true;
        }

        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;

        if (gStatus?.finish || gStatus?.win || gStatus?.lose || pJsn?.finish || pJsn?.is_clear) {
          return true;
        }

        const boss = gStatus?.boss?.param?.[0] || pJsn?.boss?.param?.[0];
        if (boss?.hp !== undefined && Number(boss.hp) <= 0) {
          return true;
        }

        return false;
      }).catch(() => false);
    } catch {
      return false;
    }
  }

  private async waitForNetworkResponse(targetSubstring: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.page.off('response', responseHandler);
          resolve(false);
        }
      }, timeoutMs);

      const responseHandler = (res: HTTPResponse) => {
        if (res.url().includes(targetSubstring)) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.page.off('response', responseHandler);
            resolve(true);
          }
        }
      };

      this.page.on('response', responseHandler);
    });
  }

  /**
   * Waits for a combat turn action to resolve.
   * If Full Auto is active and casting skills, waits through the skill chain
   * until normal_attack_result.json arrives (or until skill queue settles).
   */
  private async waitForCombatTurnResolution(targetNet: string | null, totalTimeoutMs = 15000): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let resolved = false;
      let lastActionTime = Date.now();
      let hasSeenSkill = false;

      const finish = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(hardTimeout);
          clearInterval(pollInterval);
          this.page.off('response', responseHandler);
          resolve(result);
        }
      };

      const hardTimeout = setTimeout(() => {
        finish(hasSeenSkill);
      }, totalTimeoutMs);

      const responseHandler = (res: HTTPResponse) => {
        const url = res.url();

        // 1. Explicit target network requested (e.g. summon_result.json)
        if (targetNet && url.includes(targetNet)) {
          finish(true);
          return;
        }

        // 2. Normal attack: the ultimate conclusion of any Full Auto or normal attack turn
        if (url.includes('normal_attack_result.json')) {
          console.log('[Combat] Normal attack registered by server.');
          finish(true);
          return;
        }

        // 3. Summon result
        if (url.includes('summon_result.json')) {
          console.log('[Combat] Summon action registered by server.');
          finish(true);
          return;
        }

        // 4. Ability result: Full Auto is actively casting skills!
        if (url.includes('ability_result.json')) {
          hasSeenSkill = true;
          lastActionTime = Date.now();
          console.log('[Combat] Full Auto skill cast registered. Awaiting next skill or normal attack...');
        }
      };

      this.page.on('response', responseHandler);

      // Fast settle poll (every 80ms)
      const pollInterval = setInterval(async () => {
        if (resolved) return;

        // If at least one skill was cast, and no new action occurred for 2500ms, consider skill chain settled
        if (hasSeenSkill && (Date.now() - lastActionTime > 2500)) {
          console.log('[Combat] Full Auto skill sequence completed and settled.');
          finish(true);
          return;
        }

        try {
          const state = await this.page.evaluate(() => {
            const stage = (window as any).stage;
            const gStatus = stage?.gGameStatus;
            return {
              attacking: gStatus?.attacking === true,
              finish: gStatus?.finish === true
            };
          }).catch(() => null);

          if (state?.attacking || state?.finish) {
            finish(true);
          }
        } catch {
          // ignore
        }
      }, 80);
    });
  }

  /**
   * Backward-compatible combat action waiter.
   */
  private async waitForCombatActionResponse(targetNet: string | null, timeoutMs: number): Promise<boolean> {
    return this.waitForCombatTurnResolution(targetNet, timeoutMs);
  }

  /**
   * Enforces minimum honor threshold before leaving battle.
   * If honors are still below targetScore (default 1,500,000 pt), continues attacking until met or raid ends.
   */
  private async ensureMinimumHonors(minHonors = 1500000, maxExtraTurns = 25): Promise<void> {
    await this.syncCurrentHonors();
    if (this.currentScore >= minHonors) {
      console.log(`[Honors Guard] Minimum honor met (${this.currentScore.toLocaleString()} >= ${minHonors.toLocaleString()} pt).`);
      return;
    }

    if (await this.isBattleEnded()) {
      console.log(`[Honors Guard] Battle concluded with ${this.currentScore.toLocaleString()} pt.`);
      return;
    }

    console.log(`[Honors Guard] Current honors (${this.currentScore.toLocaleString()} pt) below minimum threshold (${minHonors.toLocaleString()} pt). Continuing attack loop...`);

    const usesTapReady = this.template.steps.some(s => s.code === 'tap_ready' || s.action === 'tap_ready');
    let consecutiveUnchangedTurns = 0;
    let lastObservedHonors = this.currentScore;

    for (let extra = 1; extra <= maxExtraTurns; extra++) {
      if (this.stopRequested) break;
      if (await this.isBattleEnded()) {
        console.log('[Honors Guard] Battle concluded during extra turns.');
        break;
      }

      await this.syncCurrentHonors();
      if (this.currentScore >= minHonors) {
        console.log(`[Honors Guard] Target honors reached on extra turn ${extra} (${this.currentScore.toLocaleString()} >= ${minHonors.toLocaleString()} pt).`);
        break;
      }

      if (extra > 1 && this.currentScore === lastObservedHonors) {
        consecutiveUnchangedTurns++;
        if (consecutiveUnchangedTurns >= 3) {
          console.log('[Honors Guard] Honors unchanged for 3 consecutive turns. Battle concluded or stalled; exiting guard loop.');
          break;
        }
      } else {
        consecutiveUnchangedTurns = 0;
      }
      lastObservedHonors = this.currentScore;

      const pct = ((this.currentScore / minHonors) * 100).toFixed(1);
      console.log(`[Honors Guard] Extra attack turn ${extra}/${maxExtraTurns} (Honors: ${this.currentScore.toLocaleString()} / ${minHonors.toLocaleString()} pt - ${pct}%)...`);

      if (usesTapReady) {
        const ok = await this.handleTapReady({ code: 'tap_ready' });
        if (ok) {
          await this.handleReload({ code: 'reload' });
        } else {
          await this.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' });
          await this.handleReload({ code: 'reload' });
        }
      } else {
        await this.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' });
        await this.handleReload({ code: 'reload' });
      }

      await this.syncCurrentHonors();
    }
  }

  private ensureLogDirExists(logPath: string): void {
    const dir = path.dirname(path.resolve(process.cwd(), logPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private appendRunLog(logPath: string, result: WorkflowRunResult): void {
    const fullPath = path.resolve(process.cwd(), logPath);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(
        fullPath,
        `# Workflow Execution Log: ${this.template.name} (${this.accountId})\n\n| Run | Time | Duration | Status | Honors | Notes |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`,
        'utf-8'
      );
    }
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = `| ${result.runNumber} | ${timestamp} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.status} | ${result.honors?.toLocaleString() || '0'} | ${result.message} |\n`;
    fs.appendFileSync(fullPath, line, 'utf-8');

    // Dual structured logging (Gold Industry Standard JSONL event stream)
    try {
      const jsonlPath = fullPath.replace(/\.md$/i, '.jsonl');
      const event = {
        runNumber: result.runNumber,
        timestamp: new Date().toISOString(),
        timeStr: timestamp,
        durationMs: result.durationMs,
        status: result.status,
        honors: result.honors || 0,
        message: result.message,
        accountId: this.accountId,
        templateName: this.template.name
      };
      fs.appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Non-critical logging failure
    }
  }
}

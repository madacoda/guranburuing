// src/engines/universal/telemetry.service.ts
import { Page, HTTPResponse } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { UniversalContext } from './types.js';
import { CombatResolutionService } from './combat-resolution.service.js';
import { goldBarTracker } from '../../services/telemetry/gold-bar-tracker.service.js';
import { LootTrackerService } from '../../services/telemetry/loot-tracker.service.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { logNormalDelay } from '../../human-motor.js';
import { WorkflowRunResult } from '../../types/workflow.types.js';

export interface UniversalTelemetryCallbacks {
  isSoloQuest: () => boolean;
}

export class UniversalTelemetryService {
  private responseHandler?: (res: HTTPResponse) => Promise<void>;
  private readonly verifiedLogDirs = new Set<string>();

  constructor(
    private ctx: UniversalContext,
    private callbacks: UniversalTelemetryCallbacks
  ) {}

  private get page(): Page {
    return this.ctx.page;
  }

  public updatePage(newPage: Page): void {
    this.detachResponseListener();
    this.ctx.page = newPage;
    this.setupResponseListener();
  }

  public detachResponseListener(): void {
    if (!this.page || !this.responseHandler) return;
    try {
      const p = this.page as any;
      if (typeof p.off === 'function') {
        p.off('response', this.responseHandler);
      } else if (typeof p.removeListener === 'function') {
        p.removeListener('response', this.responseHandler);
      }
    } catch {
      // Ignore cleanup errors on closed pages
    }
    this.responseHandler = undefined;
  }

  public async syncInGamePlayerName(): Promise<string> {
    try {
      const name = await this.page.evaluate(() => {
        const el = document.querySelector('.txt-user-name, .prt-user-name, .prt-user-id');
        return el ? (el.textContent || '').trim() : '';
      }).catch(() => '');

      if (name) {
        this.ctx.state.playerName = name;
        this.ctx.sentinel?.setSessionContext?.({ playerName: name });
        return name;
      }
    } catch {
      // Best-effort extraction
    }
    return this.ctx.state.playerName || this.ctx.accountId;
  }

  public setupResponseListener(): void {
    if (!this.page || typeof this.page.on !== 'function') return;
    this.detachResponseListener();

    this.responseHandler = async (res: HTTPResponse) => {
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
              this.ctx.state.currentRaidId = String(json.raid_id);
              this.ctx.sentinel?.setSessionContext?.({ raidId: this.ctx.state.currentRaidId });
            }

            if (json.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(json.user_id);
            let memberPoint: number | null = null;
            if (Array.isArray(json.multi_raid_member_info)) {
              const myId = String(this.ctx.state.myUserId || json.user_id || '');
              const myName = this.ctx.state.playerName || '';
              const me = json.multi_raid_member_info.find((m: any) =>
                (myId && String(m.user_id) === myId) ||
                (myName && (m.nickname === myName || m.name === myName)) ||
                (m.is_host && json.is_host)
              );
              if (me) {
                if (me.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(me.user_id);
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
            if (serverPoint !== null) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, serverPoint);
            if (json.turn !== undefined) this.ctx.state.currentTurn = Number(json.turn);
            else if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
          }
        }

        // 2. Normal Attack Result
        if (url.includes('normal_attack_result.json')) {
          this.ctx.state.lastAttackLockoutExpires = Date.now() + 2400;
          const json = await res.json().catch(() => null);
          if (json) {
            if (json.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(json.user_id);
            let directPoint: number | null = null;

            if (Array.isArray(json.multi_raid_member_info)) {
              const myId = String(this.ctx.state.myUserId || json.user_id || '');
              const myName = this.ctx.state.playerName || '';
              const me = json.multi_raid_member_info.find((m: any) =>
                (myId && String(m.user_id) === myId) ||
                (myName && (m.nickname === myName || m.name === myName)) ||
                (m.is_host && json.is_host)
              );
              if (me) {
                if (me.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(me.user_id);
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

            if (this.callbacks.isSoloQuest()) {
              if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
              else if (json.turn !== undefined) this.ctx.state.currentTurn = Number(json.turn);
              return;
            }

            const targetHonors = this.ctx.template.targetScore;
            const payloadKey = `${json.raid_id || 'battle'}_t${json.status?.turn || json.turn || ''}_hp${json.status?.boss?.param?.[0]?.hp ?? ''}`;

            if (directPoint !== null) {
              this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, directPoint);
              this.ctx.state.lastProcessedAttackKey = payloadKey;
              if (targetHonors) {
                const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
                console.log(`[Combat] 🎯 Attack Honors Synced: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
              } else {
                console.log(`[Combat] 🎯 Attack Honors Synced: ${this.ctx.state.currentScore.toLocaleString()} pt`);
              }
            } else if (this.ctx.state.lastProcessedAttackKey !== payloadKey) {
              this.ctx.state.lastProcessedAttackKey = payloadKey;
              const turnDmg = CombatResolutionService.extractTurnDamage(json);
              if (turnDmg > 0) {
                const turnHonors = Math.floor(turnDmg / 100);
                this.ctx.state.currentScore += turnHonors;
                if (targetHonors) {
                  const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
                  console.log(`[Combat] Turn Dmg: ${turnDmg.toLocaleString()} (~${turnHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
                } else {
                  console.log(`[Combat] Turn Dmg: ${turnDmg.toLocaleString()} (~${turnHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
                }
              }
            }
            if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
            else if (json.turn !== undefined) this.ctx.state.currentTurn = Number(json.turn);
          }
        }

        // 3. Ability Result
        if (url.includes('ability_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            const hasAttackCmd = Array.isArray(json.scenario) && json.scenario.some((s: any) => s && s.cmd === 'attack');
            if (hasAttackCmd) {
              this.ctx.state.lastAttackLockoutExpires = Date.now() + 2400;
            }

            if (this.callbacks.isSoloQuest()) {
              if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
              return;
            }

            const abilityDmg = CombatResolutionService.extractTurnDamage(json);
            if (abilityDmg > 0) {
              const abilityHonors = Math.floor(abilityDmg / 100);
              this.ctx.state.currentScore += abilityHonors;
              const targetHonors = this.ctx.template.targetScore;
              if (targetHonors) {
                const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
                console.log(`[Combat] ⚡ Skill Damage: ${abilityDmg.toLocaleString()} (~${abilityHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
              } else {
                console.log(`[Combat] ⚡ Skill Damage: ${abilityDmg.toLocaleString()} (~${abilityHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
              }
            }

            const abilityPoint =
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null);
            if (abilityPoint !== null) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, abilityPoint);
            if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
          }
        }

        // 4. Summon Result
        if (url.includes('summon_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            if (this.callbacks.isSoloQuest()) {
              if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
              return;
            }

            const summonPoint =
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null);
            if (summonPoint !== null) {
              this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, summonPoint);
            } else {
              const summonDmg = CombatResolutionService.extractTurnDamage(json);
              if (summonDmg > 0) {
                const summonHonors = Math.floor(summonDmg / 100);
                this.ctx.state.currentScore += summonHonors;
                const targetHonors = this.ctx.template.targetScore;
                if (targetHonors) {
                  const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
                  console.log(`[Combat] 🔮 Summon Damage: ${summonDmg.toLocaleString()} (~${summonHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
                } else {
                  console.log(`[Combat] 🔮 Summon Damage: ${summonDmg.toLocaleString()} (~${summonHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
                }
              }
            }
            if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
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
            this.ctx.state.latestRewardData = json;

            const urlRaidMatch = url.match(/result(?:_multi|multi)?\/(?:data|content\/(?:index|detail))\/(\d+)/i);
            const payloadRaidId =
              json.raid_id ||
              json.Point?.raid_id ||
              json.option?.result_data?.Point?.raid_id ||
              (urlRaidMatch ? urlRaidMatch[1] : null);
            if (payloadRaidId && !this.ctx.state.isClaimingPending) {
              this.ctx.state.currentRaidId = String(payloadRaidId);
              this.ctx.sentinel?.setSessionContext?.({ raidId: this.ctx.state.currentRaidId });
            }

            const resPoint =
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point === 'number' && json.point > 0 ? json.point : null) ??
              (typeof json.total_point === 'number' && json.total_point > 0 ? json.total_point : null);
            if (resPoint !== null) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, resPoint);

            if (typeof json.data === 'string') {
              try {
                const decoded = decodeURIComponent(json.data);
                const match = decoded.match(/class=["'](?:prt-user-point|txt-user-point)["'][^>]*>.*?([0-9,]+)/i);
                if (match && match[1]) {
                  const num = parseInt(match[1].replace(/,/g, ''), 10);
                  if (!isNaN(num) && num > 0) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, num);
                }
              } catch {}
            }

            if (!this.ctx.state.isClaimingPending) {
              this.checkForGoldBarDrop(json);
              this.checkForBlueChestDrop(json);
            }
          }
        }
      } catch {
        // Silently ignore parsing errors
      }
    };

    try {
      this.page.on('response', this.responseHandler);
    } catch {
      // Ignore on mock pages
    }
  }

  /**
   * Authoritative Gold Bar detection scoped strictly to reward structures (reward_list / rewards / result HTML).
   * Prevents false positives from Rupies (gold), EXP, damage, honors, or solo quests.
   */
  public checkForGoldBarDrop(payload: any): boolean {
    if (!payload || this.callbacks.isSoloQuest()) return false;

    const found = LootTrackerService.hasGoldBarInPayload(payload);

    if (found && !this.ctx.state.currentBattleHadGoldBar && !this.ctx.state.isClaimingPending) {
      this.ctx.state.currentBattleHadGoldBar = true;
      this.ctx.state.totalGoldBarsAccumulated++;
      this.broadcastGoldBarFound();
    }

    return found;
  }

  public checkForBlueChestDrop(payload: any): boolean {
    if (!payload || this.callbacks.isSoloQuest()) return false;
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
          payload.data.includes('box_type=\\"11\\"') ||
          payload.data.includes('special_reward') ||
          payload.data.includes('特別報酬') ||
          payload.data.includes('ico-treasure-11-mini')
        ) {
          found = true;
        }
      } catch {}
    }

    if (found && !this.ctx.state.currentBattleHadBlueChest) {
      this.ctx.state.currentBattleHadBlueChest = true;
      this.ctx.state.totalBlueChestsAccumulated++;
      console.log(`[Telemetry] 💎 Blue Chest drop confirmed! Total Blue Chests: ${this.ctx.state.totalBlueChestsAccumulated}`);
    }

    return found;
  }

  public async captureCleanLootProof(raidId?: string): Promise<{ buffer?: Buffer; path: string }> {
    const cleanRaidId = (raidId || this.ctx.state.currentRaidId || '').replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
    const capDir = path.resolve(process.cwd(), 'artifacts/captures');
    if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
    const proofPath = path.resolve(capDir, `gold-bar-${cleanRaidId || 'drop'}-${Date.now()}.png`);

    let shotBuf: Buffer | undefined;

    try {
      const currentUrl = this.page.url();
      const isAlreadyOnResult = currentUrl.includes('result_multi') || currentUrl.includes('result');

      if (!isAlreadyOnResult && cleanRaidId && /^\d+$/.test(cleanRaidId)) {
        const resultUrl = `https://game.granbluefantasy.jp/#result_multi/detail/${cleanRaidId}/1/0/0`;
        console.log(`[Workflow] 📸 Navigating to battle result for clean loot proof: ${resultUrl}`);
        await this.page.goto(resultUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
      }

      const tWaitStart = Date.now();
      while (Date.now() - tWaitStart < 7000) {
        const ready = await this.page.evaluate(() => {
          const hasLoot = !!document.querySelector(
            '.cnt-result, #cnt-result, .prt-result-cnt, .prt-reward-item, .prt-item-list, .prt-box-special, .prt-special-reward-box, [data-key="17_20004"], img[src*="/item/evolution/"][src*="20004."], .prt-module'
          );
          const loadingEl = document.querySelector('#loading, .prt-loading, .cnt-loading, .loading-stage');
          const isLoading = loadingEl && (loadingEl as HTMLElement).style.display !== 'none' && (loadingEl as HTMLElement).offsetParent !== null;
          return hasLoot && !isLoading;
        }).catch(() => false);

        if (ready) break;
        await new Promise(r => setTimeout(r, 250));
      }
      await logNormalDelay(600, 0.15);

      await this.page.evaluate(() => {
        const blueBox = document.querySelector(
          '.prt-box-special, .prt-special-reward-box, [data-box-type="11"], .prt-box-item.special, .ico-box-special'
        ) as HTMLElement;
        if (blueBox && blueBox.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(blueBox).trigger('tap');
          blueBox.click();
        }
      }).catch(() => null);
      await logNormalDelay(800, 0.15);

      await this.page.evaluate(() => {
        const okBtns = document.querySelectorAll(
          '.pop-usual .btn-usual-ok, .btn-usual-ok, .pop-usual .btn-usual-close, .btn-usual-close, .btn-settle, .btn-result-close'
        );
        okBtns.forEach((btn: any) => {
          if (btn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
          }
        });
      }).catch(() => null);
      await logNormalDelay(400, 0.1);

      const targetEl = await this.page.$(
        '#cnt-result, .cnt-result, .prt-result-cnt, #wrapper, body'
      );
      if (targetEl) {
        shotBuf = await targetEl.screenshot({ path: proofPath, type: 'png' }) as Buffer;
      } else {
        shotBuf = await this.page.screenshot({ path: proofPath, fullPage: false }) as Buffer;
      }
      console.log(`[Workflow] 📸 Proof screenshot captured: ${proofPath}`);
    } catch (shotErr: any) {
      console.warn(`[Workflow] Proof capture error: ${shotErr.message}`);
    }

    return { buffer: shotBuf, path: proofPath };
  }

  public async broadcastGoldBarFound(overrideRaidId?: string): Promise<void> {
    const raidId = overrideRaidId || this.ctx.state.currentRaidId || '';
    console.log(`\n========================================================================`);
    console.log(`  🌟🌟🌟 [GOLD BAR FOUND!] Account: [${this.ctx.accountId}] Raid: ${raidId || 'Active'} 🌟🌟🌟`);
    console.log(`========================================================================\n`);

    process.stdout.write('\x07\x07\x07');

    const battleUrl = raidId
      ? `https://game.granbluefantasy.jp/#result_multi/detail/${raidId}/1/0/0`
      : (this.page.url().includes('result') ? this.page.url() : 'https://game.granbluefantasy.jp/#quest/assist');

    try {
      const { buffer: shotBuffer, path: proofPath } = await this.captureCleanLootProof(raidId);

      await goldBarTracker.recordDrop({
        raidId: raidId || 'Raid',
        questName: this.ctx.template.name,
        honors: this.ctx.state.currentScore > 0 ? this.ctx.state.currentScore.toLocaleString() + ' pt' : '-',
        turns: this.ctx.state.currentTurn || '-',
        screenshotPath: proofPath,
        screenshotBuffer: shotBuffer,
        source: 'live_combat',
        accountId: this.ctx.accountId,
        skipAlert: true
      }).catch(() => null);

      if (this.ctx.dropLogger) {
        await this.ctx.dropLogger.notifyGoldBarDrop({
          raidId: raidId || 'Raid',
          honors: this.ctx.state.currentScore > 0 ? this.ctx.state.currentScore.toLocaleString() + ' pt' : '-',
          turns: this.ctx.state.currentTurn || '-',
          screenshotBuffer: shotBuffer,
          screenshotPath: proofPath,
          accountId: this.ctx.accountId,
        });
      } else {
        const playerName = this.ctx.accountId || 'acc1';
        await this.ctx.alertRelay.sendEmergencyAlert(
          `🌟 GOLD BAR DROP CONFIRMED for ${playerName}!\n• Raid: ${this.ctx.template.name}\n• Battle Log: ${battleUrl}\n• Honors: ${this.ctx.state.currentScore.toLocaleString()} pt\n• Total GB: ${this.ctx.state.totalGoldBarsAccumulated}`,
          shotBuffer
        );

        if (discordDmRelay.isConfigured()) {
          try {
            await discordDmRelay.sendMessage(
              `🌟 **Gold Brick Drop Confirmed** 🌟\n• **Raid**: ${this.ctx.template.name}\n• **Raid ID**: \`${raidId || 'N/A'}\`\n• **Battle Log**: ${battleUrl}\n• **Account**: ${playerName}\n• **Honors**: ${this.ctx.state.currentScore.toLocaleString()} pt\n• **Total GB**: ${this.ctx.state.totalGoldBarsAccumulated}`,
              shotBuffer,
              `gold-bar-${raidId || 'drop'}.png`,
              undefined,
              true
            );
          } catch (dmErr: any) {
            console.error('[Workflow] Direct Discord DM dispatch error:', dmErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error(`[Workflow] Error broadcasting Gold Bar:`, err.message);
    }
  }

  public ensureLogDirExists(logPath: string): void {
    const dir = path.dirname(path.resolve(process.cwd(), logPath));
    if (this.verifiedLogDirs.has(dir)) return;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.verifiedLogDirs.add(dir);
  }

  public appendRunLog(logPath: string, result: WorkflowRunResult): void {
    const fullPath = path.resolve(process.cwd(), logPath);
    if (!this.verifiedLogDirs.has(fullPath) && !fs.existsSync(fullPath)) {
      this.ensureLogDirExists(logPath);
      fs.writeFileSync(
        fullPath,
        `# Workflow Execution Log: ${this.ctx.template.name} (${this.ctx.accountId})\n\n| Run | Time | Duration | Status | Honors | Notes |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`,
        'utf-8'
      );
      this.verifiedLogDirs.add(fullPath);
    }
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = `| ${result.runNumber} | ${timestamp} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.status} | ${result.honors?.toLocaleString() || '0'} | ${result.message} |\n`;
    fs.appendFileSync(fullPath, line, 'utf-8');

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
        accountId: this.ctx.accountId,
        templateName: this.ctx.template.name
      };
      fs.appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Non-critical logging failure
    }
  }
}

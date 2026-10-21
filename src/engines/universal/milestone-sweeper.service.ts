// src/engines/universal/milestone-sweeper.service.ts
import { Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { logNormalDelay, humanizedClick } from '../../human-motor.js';
import { goldBarTracker } from '../../services/telemetry/gold-bar-tracker.service.js';
import { LootTrackerService } from '../../services/telemetry/loot-tracker.service.js';
import { discordPresence } from '../../relay/discord-presence.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { UniversalContext } from './types.js';
import { CombatResolutionService } from './combat-resolution.service.js';

export interface IMilestoneSweeperCombatDelegate {
  handleAttack: (step: any) => Promise<boolean>;
  handleReload: (step: any) => Promise<boolean>;
  handleSkill: (step: any) => Promise<boolean>;
  handleSummon: (step: any) => Promise<boolean>;
  handleQuickCall: (step: any) => Promise<boolean>;
  handleBackupRequest: () => Promise<boolean>;
}

export interface MilestoneSweeperHooks {
  claimPendingBattles?: (logPath: string, currentRuns: number, returnUrl?: string) => Promise<number>;
  resolveLingeringRaidLimit?: (logPath?: string, currentRuns?: number) => Promise<boolean>;
}

/**
 * Service managing 5-battle milestone sweeps, unclaimed battle claiming at #quest/assist/unclaimed,
 * and 3-raid backup limit resolution.
 * Adheres to SRP: Exclusively handles pending battle reconciliation and multi-raid slot freeing.
 */
export class MilestoneSweeperService {
  private combatResolution: CombatResolutionService;

  constructor(
    private ctx: UniversalContext,
    combatResolution?: CombatResolutionService,
    private combatDelegate?: IMilestoneSweeperCombatDelegate,
    private hooks?: MilestoneSweeperHooks
  ) {
    this.combatResolution = combatResolution || new CombatResolutionService(ctx);
  }

  public setCombatResolution(res: CombatResolutionService): void {
    this.combatResolution = res;
  }

  public setCombatDelegate(delegate: IMilestoneSweeperCombatDelegate): void {
    this.combatDelegate = delegate;
  }

  public setHooks(hooks: MilestoneSweeperHooks): void {
    this.hooks = hooks;
  }

  public get page(): Page {
    return this.ctx.page;
  }

  /**
   * Enforces GBF milestone check every 5 joined and cleared battles to prevent hard lock.
   */
  public async checkFiveBattleMilestone(logPath: string, currentRuns: number): Promise<void> {
    if (this.ctx.state.totalJoinedAndClearedBattles > 0 && this.ctx.state.totalJoinedAndClearedBattles % 5 === 0) {
      console.log(`\n========================================================================`);
      console.log(`[Workflow] 🛡️ 5-Battle Milestone Reached (${this.ctx.state.totalJoinedAndClearedBattles} battles joined & cleared)`);
      console.log(`[Workflow] Checking and sweeping pending battles to avoid GBF 5-battle hard lock...`);
      console.log(`========================================================================\n`);
      if (this.hooks?.claimPendingBattles) {
        await this.hooks.claimPendingBattles(logPath, currentRuns);
      } else {
        await this.claimPendingBattles(logPath, currentRuns);
      }
    }
  }

  /**
   * Claims ALL pending/unclaimed battles at #quest/assist/unclaimed/0/0 until none remain,
   * checks for Gold Bar drops, and cleanly returns to returnUrl (or assist/quest URL).
   */
  public async claimPendingBattles(logPath: string, currentRuns: number, returnUrl?: string): Promise<number> {
    let claimedCount = 0;
    const maxClaims = 50;

    const prevRaidId = this.ctx.state.currentRaidId;
    const prevScore = this.ctx.state.currentScore;
    const prevTurn = this.ctx.state.currentTurn;
    const prevHadGoldBar = this.ctx.state.currentBattleHadGoldBar;
    const prevHadBlueChest = this.ctx.state.currentBattleHadBlueChest;
    this.ctx.state.isClaimingPending = true;

    try {
      console.log('[Workflow] Checking and clearing ALL unclaimed battles (#quest/assist/unclaimed/0/0)...');

      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1200, 0.15);

      while (claimedCount < maxClaims && !this.ctx.state.stopRequested) {
        const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
        if (!curHash.includes('unclaimed')) {
          await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' }).catch(() => null);
          await logNormalDelay(1200, 0.15);
        }

        const tWaitCards = Date.now();
        let status = { hasNone: false, hasVisibleCards: false, cardCount: 0 };
        let pageSettled = false;

        while (Date.now() - tWaitCards < 7000 && !this.ctx.state.stopRequested) {
          status = await this.page.evaluate(() => {
            const bodyText = document.body.innerText || '';
            const noListEl = document.querySelector('.txt-no-list');
            const hasNoneText = (
              bodyText.includes("aren't any pending") ||
              bodyText.includes("aren't any pending battles") ||
              bodyText.includes('未確認バトルはありません') ||
              bodyText.includes('未確認のバトル結果はありません') ||
              bodyText.includes('No pending battles')
            );
            const cards = document.querySelectorAll(
              '#prt-unclaimed-list .btn-multi-raid, #prt-unclaimed-list [data-href*="result_multi"], .cnt-quest-unclaimed .btn-multi-raid, .cnt-quest-unclaimed .lis-raid, .prt-raid-list .btn-multi-raid'
            );
            const hasVisibleCards = Array.from(cards).some(c => (c as HTMLElement).offsetParent !== null);
            return {
              hasNone: (noListEl !== null && hasNoneText) || (hasNoneText && cards.length === 0),
              hasVisibleCards,
              cardCount: cards.length
            };
          }).catch(() => ({ hasNone: false, hasVisibleCards: false, cardCount: 0 }));

          if (status.hasVisibleCards && status.cardCount > 0) {
            pageSettled = true;
            break;
          }
          if (status.hasNone) {
            pageSettled = true;
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }

        if (status.hasNone || (pageSettled && status.cardCount === 0)) {
          if (claimedCount > 0) {
            console.log(`[Workflow] 🎉 All unclaimed battles successfully cleared! Total claimed: ${claimedCount}.`);
          } else {
            console.log('[Workflow] No unclaimed battles found. Account clean.');
          }
          break;
        }

        console.log(`[Workflow] Found unclaimed battle(s) (${status.cardCount} remaining). Claiming battle #${claimedCount + 1}...`);
        this.ctx.state.latestRewardData = null;
        this.ctx.state.currentScore = 0;
        this.ctx.state.currentTurn = 0;

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

        const tWait = Date.now();
        while (Date.now() - tWait < 6000) {
          if (this.ctx.state.stopRequested) break;
          const isResult = await this.page.evaluate(() => {
            return !!document.querySelector('.pop-raid-result, .prt-result-head, .cnt-result, #cnt-result, .prt-reward-item, .prt-item-list, .prt-module, .pop-usual, .btn-usual-ok');
          }).catch(() => false);

          if (isResult || this.ctx.state.latestRewardData !== null) {
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }

        await this.page.evaluate(() => {
          const ok = document.querySelector('.pop-usual .btn-usual-ok, .pop-usual .btn-usual-close') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
          }
        }).catch(() => null);

        await logNormalDelay(1200, 0.15);

        await this.page.evaluate(() => {
          const blueChest = document.querySelector('.prt-box-special, .prt-special-reward-box, [data-box-type="11"]') as HTMLElement;
          if (blueChest && blueChest.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(blueChest).trigger('tap');
            blueChest.click();
          }
        }).catch(() => null);
        await logNormalDelay(600, 0.1);

        const urlRaidMatch = await this.page.evaluate(() => {
          const m = window.location.hash.match(/result(?:_multi)?\/(\d+)/);
          return m ? m[1] : '';
        }).catch(() => '');
        const activeClaimedRaidId = urlRaidMatch || this.ctx.state.currentRaidId;

        const domCheck = await this.combatResolution.inspectDomForGoldBar();
        const payloadHasGoldBar = LootTrackerService.hasGoldBarInPayload(this.ctx.state.latestRewardData);
        const dropDetected = domCheck.hasGoldBar || payloadHasGoldBar;

        const claimedHonors = await this.combatResolution.syncCurrentHonors();
        if (claimedHonors > 0) {
          console.log(`[Workflow] Claimed Battle #${claimedCount + 1} settled with ${claimedHonors.toLocaleString()} honors.`);
        }

        if (dropDetected) {
          const finalRaidId = domCheck.raidId || activeClaimedRaidId || 'Pending Claim';
          console.log(`\n========================================================================`);
          console.log(`  🌟🌟🌟 [GOLD BAR CONFIRMED IN CLAIMED BATTLE!] Raid: ${finalRaidId} 🌟🌟🌟`);
          console.log(`========================================================================\n`);

          const lootTracker = new LootTrackerService(this.page);
          const proof = await lootTracker.captureCleanLootProof(this.page, finalRaidId);
          const shotBuf = proof.buffer;
          const proofPath = proof.path;

          const honorsStr = this.ctx.state.currentScore > 0 ? this.ctx.state.currentScore.toLocaleString() + ' pt' : '-';
          await goldBarTracker.recordDrop({
            raidId: finalRaidId,
            questName: this.ctx.template.name,
            honors: honorsStr,
            turns: '-',
            screenshotPath: shotBuf ? proofPath : undefined,
            screenshotBuffer: shotBuf ? Buffer.from(shotBuf) : undefined,
            source: 'pending_claim',
            accountId: this.ctx.accountId,
            skipAlert: Boolean(this.ctx.dropLogger)
          }).catch(() => null);

          if (this.ctx.dropLogger) {
            const stats = this.ctx.dropLogger.recordPendingGoldBar(finalRaidId, shotBuf ? proofPath : undefined);
            await this.ctx.dropLogger.notifyGoldBarDrop({
              raidId: finalRaidId,
              honors: honorsStr,
              turns: '-',
              screenshotBuffer: shotBuf ? Buffer.from(shotBuf) : undefined,
              screenshotPath: shotBuf ? proofPath : undefined,
              accountId: this.ctx.accountId
            }).catch(() => null);
            discordPresence.updateStatus({
              raidName: this.ctx.template.name,
              goldBars: stats.goldBars,
              blueChests: stats.blueChests,
              dryStreak: stats.currentDryStreak,
              dryStreakMode: stats.dryStreakMode,
              status: 'Claiming Pending'
            }, true);
          }
        }

        this.ctx.state.latestRewardData = null;

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

        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1000, 0.15);
      }

      const finalReturnUrl = returnUrl || (this.ctx.template.questUrl.includes('assist') ? 'https://game.granbluefantasy.jp/#quest/assist' : this.ctx.template.questUrl);
      if (finalReturnUrl) {
        console.log(`[Workflow] Clean return to: ${finalReturnUrl}`);
        const returnHash = finalReturnUrl.split('#')[1] || '';
        const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
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
    } finally {
      this.ctx.state.isClaimingPending = false;
      this.ctx.state.currentRaidId = prevRaidId;
      this.ctx.state.currentScore = prevScore;
      this.ctx.state.currentTurn = prevTurn;
      this.ctx.state.currentBattleHadGoldBar = prevHadGoldBar;
      this.ctx.state.currentBattleHadBlueChest = prevHadBlueChest;
    }

    return claimedCount;
  }

  public async detectAndHandlePendingBattleModal(
    logPath: string,
    currentRuns: number,
    handlers?: {
      onRaidLimit?: () => Promise<boolean>;
      onPendingLimit?: (returnUrl: string) => Promise<number>;
    }
  ): Promise<boolean> {
    const modalType = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual.pop-show, .pop-show, .pop-usual, .prt-popup-body') as HTMLElement;
      if (!modal || modal.offsetParent === null) return null;
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const style = window.getComputedStyle(modal);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0)) {
          return null;
        }
      }

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
        (rawText.includes('3件') && (rawText.includes('マルチバトル') || rawText.includes('救援')))
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

    if (!modalType) return false;

    await this.dismissPopupModal();
    await logNormalDelay(400, 0.1);

    if (modalType === 'ACTIVE_RAID_LIMIT_3') {
      console.warn('[Workflow] ⚠️ Active backup limit popup detected! Resolving lingering raids...');
      this.ctx.state.lastStartFailureWasRaidLimit = true;
      if (handlers?.onRaidLimit) {
        await handlers.onRaidLimit();
      } else {
        await this.resolveLingeringRaidLimit(logPath, currentRuns);
      }
      return true;
    }

    console.warn('[Workflow] ⚠️ Pending/Unclaimed battle popup detected! Clearing all unclaimed battles...');
    this.ctx.state.lastStartFailureWasMaintenance = true;
    const returnUrl = this.ctx.template.questUrl.includes('assist') ? 'https://game.granbluefantasy.jp/#quest/assist' : this.ctx.template.questUrl;
    if (handlers?.onPendingLimit) {
      await handlers.onPendingLimit(returnUrl);
    } else {
      await this.claimPendingBattles(logPath, currentRuns, returnUrl);
    }
    return true;
  }

  public async resolveLingeringRaidLimit(logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<boolean> {
    console.log(`\n========================================================================`);
    console.log(`[Workflow] 🛡️ Resolving 3-Raid Backup Limit on Account [${this.ctx.accountId}]`);
    console.log(`========================================================================`);

    await this.dismissPopupModal();

    // 1. Initial sweep: attempt to claim all completed/unclaimed battles
    const initialClaimed = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
    if (initialClaimed > 0) {
      this.ctx.state.totalJoinedAndClearedBattles += initialClaimed;
      console.log(`[Workflow] 🎉 Initial sweep claimed ${initialClaimed} pending battle(s). Slot freed up!`);
      await this.checkFiveBattleMilestone(logPath, currentRuns);
      return true;
    }

    // CRITICAL: If 0 battles were claimed, we are STILL at 3/3 active backup limit!
    // We must NOT falsely assume 0 slots are taken.
    console.log('[Workflow] No unclaimed battles found. All 3 backup slots are still occupied by in-progress raids.');
    console.log('[Workflow] ⚔️ Entering active assist & wait mode to help reduce enemy HP and free up a slot...');

    const maxResolutionCycles = 5;
    for (let cycle = 1; cycle <= maxResolutionCycles && !this.ctx.state.stopRequested; cycle++) {
      console.log(`\n[Workflow] --- Lingering Raid Resolution Cycle #${cycle}/${maxResolutionCycles} ---`);

      // 1. Active Assist: go to Recent tab, pick higher HP or random joined raid, and help deal damage
      const assisted = await this.performActiveAssistCycle(logPath, currentRuns);
      if (assisted) {
        console.log(`[Workflow] ✅ Active raid resolved during assist cycle #${cycle}. Slot freed up!`);
        return true;
      }

      // 2. Passive Wait: wait and poll for lingering raids to conclude
      const waited = await this.performPassiveWaitCycle(logPath, currentRuns);
      if (waited) {
        console.log(`[Workflow] ✅ Active raid concluded and claimed during wait poll in cycle #${cycle}. Slot freed up!`);
        return true;
      }
    }

    // Final sweep attempt
    const finalSweep = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
    if (finalSweep > 0) {
      this.ctx.state.totalJoinedAndClearedBattles += finalSweep;
      console.log(`[Workflow] 🎉 Final sweep claimed ${finalSweep} battle(s). Slot freed up!`);
      return true;
    }

    console.warn('[Workflow] ⚠️ Active backup limit could not be resolved after all cycles. Raids still in progress.');
    return false;
  }

  public async getLingeringJoinedRaidCount(): Promise<number> {
    try {
      return await this.page.evaluate(() => {
        // 1. Check all tab candidates for Joined / Recent / 参戦中 with a badge
        const tabs = Array.from(document.querySelectorAll('.btn-tabs, .tab, .tab-item, .prt-tabs > div, .cnt-tabs > div, #tab-multi, [data-tab]'));
        for (const t of tabs) {
          const text = (t.textContent || '').trim().toLowerCase();
          const id = t.id || '';
          const dataTab = t.getAttribute('data-tab') || '';
          const isJoinedTab = id === 'tab-multi' || dataTab === 'multi' || dataTab === 'recent' || dataTab === 'joined' || text.includes('参戦中') || text.includes('recent') || text.includes('joined');
          if (isJoinedTab && !text.includes('search') && id !== 'tab-search') {
            const badge = t.querySelector('.prt-badge, .ico-badge, .cnt-badge, .badge');
            if (badge && (badge as HTMLElement).offsetParent !== null) {
              const num = parseInt(badge.textContent || '0', 10);
              return isNaN(num) ? 0 : num;
            }
          }
        }

        // 2. Direct card scan if currently on Joined / Recent tab
        const joinedCards = document.querySelectorAll('#prt-assist-multi .btn-multi-raid, #prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid');
        const visibleJoined = Array.from(joinedCards).filter(c => {
          const isSearch = typeof (c as any).closest === 'function' ? ((c as any).closest('#prt-search-list') || (c as any).closest('#prt-assist-search') || (c as any).closest('.cnt-search')) : false;
          return !isSearch && (c as HTMLElement).offsetParent !== null;
        });
        if (visibleJoined.length > 0) {
          return visibleJoined.length;
        }

        // Default: If no badge and no visible joined cards, return 0
        return 0;
      });
    } catch {
      return 0;
    }
  }

  public async performActiveAssistCycle(logPath: string, currentRuns: number): Promise<boolean> {
    try {
      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (!curHash.includes('quest/assist') || curHash.includes('unclaimed')) {
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
          this.page.evaluate(() => { window.location.href = 'https://game.granbluefantasy.jp/#quest/assist'; }).catch(() => null)
        ]);
        await logNormalDelay(1000, 0.15);
      }

      await this.switchToRecentJoinedTab();
      await logNormalDelay(600, 0.15);

      const candidates = await this.scanJoinedRaidCards();
      if (candidates.length === 0) {
        console.log('[Workflow] No active joined raids found on Recent tab. Checking pending claims...');
        const claimed = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
        if (claimed > 0) {
          this.ctx.state.totalJoinedAndClearedBattles += claimed;
          await this.checkFiveBattleMilestone(logPath, currentRuns);
          return true;
        }
        return false;
      }

      // User instruction: "assist randomly or the higher hp to make sure help them reduce the enemy hp faster"
      let selected: typeof candidates[0];
      const chooseRandom = Math.random() < 0.40 && candidates.length > 1;

      if (chooseRandom) {
        selected = candidates[Math.floor(Math.random() * candidates.length)];
        console.log(`[Workflow] 🎲 Strategy: RANDOM ASSIST -> "${selected.questName || 'Unknown'}" (HP: ${selected.hpPct}%, Players: ${selected.players}/${selected.maxPlayers}, ID: ${selected.raidId})`);
      } else {
        // Higher HP first (descending: b.hpPct - a.hpPct), then fewer players (a.players - b.players)
        candidates.sort((a, b) => {
          const hpDiff = b.hpPct - a.hpPct;
          if (Math.abs(hpDiff) > 2) return hpDiff;
          return a.players - b.players;
        });
        selected = candidates[0];
        console.log(`[Workflow] ⚔️ Strategy: HIGHER HP ASSIST -> "${selected.questName || 'Unknown'}" (HP: ${selected.hpPct}%, Players: ${selected.players}/${selected.maxPlayers}, ID: ${selected.raidId})`);
      }

      if (selected.raidId && /^\d+$/.test(selected.raidId)) {
        console.log(`[Workflow] 🚀 Joining lingering battle via direct hash: #raid_multi/${selected.raidId}...`);
        await this.page.evaluate((id: string) => {
          const Game = (window as any).Game;
          if (Game?.Router?.navigate) {
            Game.Router.navigate('raid_multi/' + id, { trigger: true });
          } else {
            window.location.hash = '#raid_multi/' + id;
          }
        }, selected.raidId).catch(() => null);
      } else {
        await this.clickJoinedRaidCard(selected);
      }

      const mountState = await this.combatResolution.waitForBattleToMountOrResult(12000);

      if (mountState === 'RESULT') {
        console.log('[Workflow] 🎉 Lingering raid was already completed! Resolving result...');
        await this.combatResolution.handleConfirmResult();
        this.ctx.state.totalJoinedAndClearedBattles++;
        await this.checkFiveBattleMilestone(logPath, currentRuns);
        return true;
      } else if (mountState === 'MOUNTED') {
        console.log('[Workflow] ⚔️ Active combat mounted! Assisting participants to reduce enemy HP faster...');

        // Check if knocked out and need to salute to buff participants
        const handledSalute = await this.page.evaluate(() => {
          const pop = document.querySelector('.pop-usual, #pop, .prt-popup-body');
          if (pop && (pop as HTMLElement).offsetParent !== null) {
            const text = (pop.textContent || '').toLowerCase();
            if (text.includes('salute') || text.includes('knocked out') || text.includes('全滅') || text.includes('応援')) {
              const ok = pop.querySelector('.btn-usual-ok, .btn-salute, .btn-usual-close') as HTMLElement;
              if (ok) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(ok).trigger('tap');
                ok.click();
                return true;
              }
            }
          }
          return false;
        }).catch(() => false);
        if (handledSalute) {
          console.log('[Workflow] 🫡 Saluted participants to buff remaining players with charge bar!');
          await logNormalDelay(400, 0.1);
        }

        if (this.combatDelegate) {
          // Request backup to invite more players to deal damage
          await this.combatDelegate.handleBackupRequest().catch(() => null);
          await logNormalDelay(250, 0.1);

          if (!await this.combatResolution.isBattleEnded()) {
            await this.combatDelegate.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' }).catch(() => null);
            await logNormalDelay(250, 0.1);
          }

          if (!await this.combatResolution.isBattleEnded()) {
            await this.combatDelegate.handleReload({ code: 'reload' }).catch(() => null);
            await this.combatResolution.waitForCombatInputReady(3000).catch(() => null);
          }
        }

        const tStart = Date.now();
        while (Date.now() - tStart < 5000 && !this.ctx.state.stopRequested) {
          if (await this.combatResolution.isBattleEnded()) break;
          await new Promise(r => setTimeout(r, 600));
        }

        if (await this.combatResolution.isBattleEnded()) {
          console.log('[Workflow] 🎉 Lingering raid cleared while assisting!');
          await this.combatResolution.handleConfirmResult();
          this.ctx.state.totalJoinedAndClearedBattles++;
          await this.checkFiveBattleMilestone(logPath, currentRuns);
          return true;
        }
      }

      console.log('[Workflow] Returning to Backup Requests (#quest/assist) to check if any raid concluded...');
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null),
        this.page.evaluate(() => { window.location.href = 'https://game.granbluefantasy.jp/#quest/assist'; }).catch(() => null)
      ]);
      await logNormalDelay(1000, 0.15);

      const postAssistClaimed = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
      if (postAssistClaimed > 0) {
        this.ctx.state.totalJoinedAndClearedBattles += postAssistClaimed;
        console.log(`[Workflow] 🎉 Post-assist sweep claimed ${postAssistClaimed} battle(s). Slot freed up!`);
        await this.checkFiveBattleMilestone(logPath, currentRuns);
        return true;
      }

      return false;
    } catch (err: any) {
      console.warn('[Workflow] Notice during active assist cycle:', err.message);
      return false;
    }
  }

  public async performPassiveWaitCycle(logPath: string, currentRuns: number): Promise<boolean> {
    const isLongWait = Math.random() < 0.12;
    const waitSeconds = isLongWait
      ? Math.floor(Math.random() * (180 - 90 + 1)) + 90
      : Math.floor(Math.random() * (90 - 30 + 1)) + 30;

    const t0 = Date.now();
    const maxWaitMs = waitSeconds * 1000;
    let pollCount = 0;

    console.log(`[Workflow] ⏳ Waiting up to ${(waitSeconds / 60).toFixed(1)}m (${waitSeconds}s) for participants to clear active raids...`);

    while (Date.now() - t0 < maxWaitMs && !this.ctx.state.stopRequested) {
      pollCount++;
      const pollDelay = Math.floor(Math.random() * 3000) + 10000;
      await new Promise(r => setTimeout(r, pollDelay));
      if (this.ctx.state.stopRequested) return false;

      console.log(`[Workflow] [Wait Poll #${pollCount}] Checking if any lingering battle concluded...`);
      const claimed = await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
      if (claimed > 0) {
        this.ctx.state.totalJoinedAndClearedBattles += claimed;
        console.log(`[Workflow] 🎉 Raid concluded and claimed (${claimed} claimed)! Active slot freed up.`);
        await this.checkFiveBattleMilestone(logPath, currentRuns);
        return true;
      }
    }

    console.log(`[Workflow] Passive wait interval (${waitSeconds}s) finished. Proceeding to next cycle...`);
    return false;
  }

  private async switchToRecentJoinedTab(): Promise<void> {
    try {
      const switched = await this.page.evaluate(() => {
        const tab = document.querySelector('#tab-multi, .btn-tabs[data-tab="multi"], [data-tab="recent"], [data-tab="joined"]') as HTMLElement;
        if (tab) {
          const isActive = tab.classList.contains('active') || tab.classList.contains('selected');
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(tab).trigger('tap');
          tab.click();
          return !isActive;
        }
        return false;
      }).catch(() => false);

      if (switched) {
        console.log('[Workflow] Switching to Recent / Joined tab (#tab-multi)...');
        await logNormalDelay(800, 0.15);
      }

      // Check selector if not active yet
      const recentTab = await this.page.$('#tab-multi, .btn-tabs[data-tab="multi"]');
      if (recentTab) {
        const isActive = await recentTab.evaluate((el: any) => el.classList.contains('active') || el.classList.contains('selected')).catch(() => false);
        if (!isActive) {
          await humanizedClick(this.page, recentTab);
          await logNormalDelay(800, 0.15);
        }
      }

      // Wait for content container #prt-assist-multi or cards to be populated
      await this.page.waitForFunction(() => {
        const container = document.querySelector('#prt-assist-multi, .cnt-quest-assist');
        const cards = document.querySelectorAll('#prt-assist-multi .btn-multi-raid, #prt-assist-multi .lis-raid');
        return (container !== null && container.classList.contains('active')) || cards.length > 0;
      }, { timeout: 3500 }).catch(() => null);
    } catch {}
  }

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
      const rawCards = Array.from(document.querySelectorAll(
        '#prt-assist-multi .btn-multi-raid, #prt-assist-multi .lis-raid, #prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid, .prt-multi-list .btn-multi-raid, .prt-multi-list .lis-raid'
      )) as HTMLElement[];

      const filteredCards = rawCards.filter((el: any) => {
        const isSearch = typeof el.closest === 'function' ? (el.closest('#prt-search-list') || el.closest('#prt-assist-search') || el.closest('.cnt-search') || el.closest('#prt-search')) : false;
        if (isSearch) return false;
        if (el.classList?.contains('search')) return false;
        if (el.offsetParent === null) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && style.display === 'none') return false;
        return true;
      });

      return filteredCards.map((el, i) => {
        const gauge = el.querySelector('.prt-raid-gauge-inner, .prt-gauge-inner, .prt-hp-gauge-inner, .prt-gauge-bar, .prt-hp-gauge') as HTMLElement;
        const hpWidth = gauge?.style?.width || '100%';
        const hpPct = parseFloat(hpWidth) || 100;

        const playerEl = el.querySelector('.prt-flees-in, .prt-member, .txt-member, .prt-raid-gauge, .prt-user-count, .txt-user-count') as HTMLElement;
        const playerText = playerEl ? (playerEl.innerText || playerEl.textContent || '') : (el.innerText || '');
        const match = playerText.match(/(\d+)\s*\/\s*(\d+)/);
        const players = match ? parseInt(match[1], 10) : 1;
        const maxPlayers = match ? parseInt(match[2], 10) : 30;

        const nameEl = el.querySelector('.txt-quest-name, .prt-quest-name, .txt-name, .txt-title, .txt-raid-name') as HTMLElement;
        const questName = (nameEl ? (nameEl.innerText || nameEl.textContent) : '')?.trim() || el.dataset?.chapterName || '';

        let raidId = el.getAttribute('data-raid-id') || el.dataset?.raidId || '';
        if (!raidId) {
          const href = el.getAttribute('data-href') || el.getAttribute('href') || '';
          const m = href.match(/\d{8,}/);
          if (m) raidId = m[0];
        }

        const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };

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

  private async clickJoinedRaidCard(candidate: { index: number; x: number; y: number; raidId?: string }): Promise<void> {
    if (candidate.raidId && /^\d+$/.test(candidate.raidId)) {
      await this.page.evaluate((id: string) => {
        const Game = (window as any).Game;
        if (Game?.Router?.navigate) {
          Game.Router.navigate('raid_multi/' + id, { trigger: true });
        } else {
          window.location.hash = '#raid_multi/' + id;
        }
      }, candidate.raidId).catch(() => null);
      return;
    }

    const clicked = await this.page.evaluate((idx: number) => {
      const cards = Array.from(document.querySelectorAll(
        '#prt-assist-multi .btn-multi-raid, #prt-assist-multi .lis-raid, #prt-multi-list .btn-multi-raid, .cnt-quest-multi .btn-multi-raid, #prt-multi-list .lis-raid, .cnt-quest-multi .lis-raid'
      )).filter((c: any) => {
        const isSearch = typeof c.closest === 'function' ? (c.closest('#prt-search-list') || c.closest('#prt-assist-search') || c.closest('.cnt-search')) : false;
        return !isSearch && (c as HTMLElement).offsetParent !== null;
      }) as HTMLElement[];
      const card = cards[idx];
      if (card) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(card).trigger('tap');
        card.click();
        return true;
      }
      return false;
    }, candidate.index).catch(() => false);

    if (!clicked && candidate.x > 0 && candidate.y > 0) {
      await this.page.touchscreen.tap(candidate.x, candidate.y).catch(() => null);
    }
  }

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

  public async checkAndClearPendingBattles(logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<void> {
    const hasPendingModal = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
      if (!modal || (modal as HTMLElement).offsetParent === null) return false;
      const text = (modal as HTMLElement).innerText || '';
      return text.includes('pending') || text.includes('unclaimed') || text.includes('未確認') || text.includes('five or more') || text.includes('5件');
    }).catch(() => false);

    if (hasPendingModal) {
      console.log('[Workflow] Pending battle limit popup detected. Auto-clearing...');
      await this.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
    }
  }
}

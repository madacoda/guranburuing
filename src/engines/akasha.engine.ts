import { Page, ElementHandle } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { config } from '../config.js';
import { humanizedClick, humanReactionDelay, logNormalDelay, randomDelay } from '../human-motor.js';
import fs from 'fs';
import path from 'path';
import { DropLogger, RaidCandidate, RaidWorkflowResult } from './drop-logger.js';

export interface AkashaJoinOptions {
  raidTarget: string; // Raid code or URL
  targetScore?: number; // Default: 1,560,000 pt
  autoReplenishEp?: boolean;
}

export interface AkashaCombatResult {
  status: 'SUCCESS' | 'TARGET_SCORE_REACHED' | 'RAID_EXPIRED' | 'JOIN_FAILED' | 'FAILED';
  finalScore: number;
  turnsElapsed: number;
  durationMs: number;
  message: string;
}

export interface AkashaFarmingOptions {
  runs?: number; // Total runs (default: Infinity)
  targetScore?: number; // Default: 1,560,000 pt
  autoReplenishEp?: boolean;
  minBatchClaim?: number; // Default: 3
  maxBatchClaim?: number; // Default: 5
  batchClaimSize?: number; // Fixed override if provided
  logPath?: string; // Default: 'logs/gb-akasha.md'
}

export interface AkashaFarmingSummary {
  totalRunsAttempted: number;
  totalRunsCompleted: number;
  totalGoldBars: number;
  battlesWithoutGb: number;
  currentDryStreak: number;
  dropRatePct: string;
  durationMs: number;
}

export class AkashaEngine {
  private currentScore = 0;
  private attackResolved = false;
  private summonResolved = false;
  private stopRequested = false;
  private latestRewardData: any = null;
  private responseListenerInitialized = false;
  private isCombatActive = false;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {}

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Continuous farming loop for Akasha HL:
   * 1. Finds Akasha raid on #quest/assist (Finder tab, 3rd slot: HP > 70% & <= 3/30, or >= 50% & <= 4/30)
   * 2. Selects Dark supporter summon by priority (Hades 250 -> Baha 250 -> Hades any -> fallback)
   * 3. Executes fast rotation:
   *    - Quick Summon -> reload (F5)
   *    - 4th Char (Nier) Skill 1
   *    - Death Summon (one-click) -> reload (F5)
   *    - 2nd Char (Yukata Ilsa) Skill 1
   *    - Attack loop with F5 until honors > 1,560,000 pt
   * 4. Claims pending battles in randomized batches of 3 - 5 raids (never exceeding 5)
   *    and logs any Gold Bar drops to logs/gb-akasha.md
   */
  public async runAkashaFarmingLoop(options: AkashaFarmingOptions = {}): Promise<AkashaFarmingSummary> {
    const {
      runs = Infinity,
      targetScore = 1560000,
      autoReplenishEp = true,
      minBatchClaim = 3,
      maxBatchClaim = 5,
      batchClaimSize,
      logPath = 'logs/gb-akasha.md'
    } = options;

    const startTime = Date.now();
    let totalCompleted = 0;
    let joinedInCurrentBatch = 0;
    let totalGoldBars = 0;
    this.stopRequested = false;

    // Randomized batch threshold between 2 and 3 raids (never exceeds GBF's 3-active raid limit)
    const getNextBatchThreshold = (): number => {
      if (batchClaimSize && batchClaimSize > 0) return Math.min(3, Math.max(1, batchClaimSize));
      const min = Math.max(1, Math.min(minBatchClaim, 3));
      const max = Math.max(min, Math.min(maxBatchClaim, 3));
      return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    let currentBatchThreshold = getNextBatchThreshold();

    console.log(`\n=====================================================`);
    console.log(`      Granblue Fantasy - Akasha Auto-Farming Loop     `);
    console.log(`=====================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Honor Threshold:      ${targetScore.toLocaleString()} pt`);
    console.log(`Pending Claim Batch:  Randomized 3 - 5 raids (first batch: ${currentBatchThreshold})`);
    console.log(`Drop Log File:        ${logPath}`);
    console.log(`=====================================================\n`);

    const dropLogger = new DropLogger(logPath, 'Akasha HL');
    const initialStats = dropLogger.getStats();
    console.log(`[AkashaEngine] Historical Log: ${initialStats.totalBattles} total battles, ${initialStats.goldBars} Gold Bars (${initialStats.battlesWithoutGb} battles without Gold Bar, current dry streak: ${initialStats.currentDryStreak})`);

    this.setupResponseListener();

    // Initial safety check: clear pre-existing pending battles so we don't start near the 5-limit cap
    console.log('[AkashaEngine] Checking for pre-existing pending battles before starting session...');
    const initialGb = await this.claimPendingBattles(logPath, 0, dropLogger);
    totalGoldBars += initialGb;

    while (totalCompleted < runs && !this.stopRequested) {
      const iterationStartTime = Date.now();
      console.log(`\n-----------------------------------------------------`);
      console.log(`[AkashaEngine] [Run ${totalCompleted + 1}] Searching for eligible Akasha raid...`);
      console.log(`-----------------------------------------------------`);

      await this.sentinel.assertSafe();

      // 1. Scan #quest/assist (Finder tab, 3rd slot)
      const raidTarget = await this.findAndSelectRaid();

      // Check if pending limit modal was triggered during finder selection
      if (await this.isPendingLimitReached()) {
        console.log('[AkashaEngine] ⚠️ Pending battle limit modal detected! Claiming pending battles now...');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      if (!raidTarget) {
        if (this.stopRequested) break;
        console.warn(`[AkashaEngine] No eligible Akasha raid found within search window. Session pausing.`);
        break;
      }

      await this.sentinel.assertSafe();

      const workflowResult = await this.executeRaidWorkflow(raidTarget, {
        runNumber: totalCompleted + 1,
        targetScore,
        autoReplenishEp,
        logPath,
        dropLogger
      });

      if (workflowResult.hitPendingLimit) {
        console.log('[AkashaEngine] ⚠️ Pending battle limit modal encountered! Claiming pending battles now...');
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      totalCompleted++;
      joinedInCurrentBatch++;

      // Check if we reached our randomized batch threshold (3 - 5 raids)
      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`[AkashaEngine] Batch threshold reached (${joinedInCurrentBatch}/${currentBatchThreshold} raids). Checking pending battles...`);
        const claimStartTime = Date.now();
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        const claimElapsedSec = ((Date.now() - claimStartTime) / 1000).toFixed(1);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        console.log(`[AkashaEngine] Next pending check scheduled after ${currentBatchThreshold} raids (claim took ${claimElapsedSec}s).`);
      } else {
        console.log(`[AkashaEngine] Pending battle check skipped (${joinedInCurrentBatch}/${currentBatchThreshold} raids in batch). Returning to Finder...`);
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1200, 0.15);
      }

      const iterationElapsedSec = ((Date.now() - iterationStartTime) / 1000).toFixed(1);
      console.log(`[AkashaEngine] [Run ${totalCompleted}] Iteration concluded in ${iterationElapsedSec}s total.\n`);
    }

    // Claim any remaining pending battles before exit
    if (joinedInCurrentBatch > 0) {
      console.log(`\n[AkashaEngine] Session ended. Claiming final batch of ${joinedInCurrentBatch} pending battle(s)...`);
      const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
      totalGoldBars += gbFound;
    }

    console.log(`\n[AkashaEngine] Farming session concluded. Returning to #mypage...`);
    await this.page.evaluate(() => { window.location.hash = '#mypage'; }).catch(() => null);

    const finalStats = dropLogger.getStats();
    return {
      totalRunsAttempted: totalCompleted,
      totalRunsCompleted: totalCompleted,
      totalGoldBars: finalStats.goldBars,
      battlesWithoutGb: finalStats.battlesWithoutGb,
      currentDryStreak: finalStats.currentDryStreak,
      dropRatePct: finalStats.dropRatePct,
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Searches #quest/assist (Finder tab, 3rd slot / Akasha) for an eligible raid.
   * Priority 1: HP > 70% && players <= 3
   * Priority 2: HP >= 50% && players <= 4
   * If none found: waits random 3s - 15s, refreshes, and retries.
   */
  /**
   * Scans Slot 3 (Akasha) once on the Finder tab for an eligible raid.
   * Does NOT wait or refresh; returns the chosen candidate or null immediately.
   */
  public async scanSlotForCandidate(): Promise<RaidCandidate | null> {
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash !== '#quest/assist') {
      console.log('[AkashaEngine] Navigating to Backup Requests (#quest/assist)...');
      if (currentHash.includes('result') || currentHash.includes('empty')) {
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' });
      } else {
        await this.page.evaluate(() => { window.location.hash = '#quest/assist'; });
      }
      await logNormalDelay(1400, 0.15);
    }
    await this.sentinel.assertSafe();

    // 1. Ensure Finder tab is active
    let finderTab = await this.page.waitForSelector('#tab-search, .btn-tabs#tab-search', { visible: true, timeout: 5000 }).catch(() => null);
    if (!finderTab) {
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' });
      finderTab = await this.page.waitForSelector('#tab-search, .btn-tabs#tab-search', { visible: true, timeout: 8000 }).catch(() => null);
    }

    if (finderTab) {
      const isActive = await this.page.evaluate((el: any) => el.classList.contains('active'), finderTab);
      if (!isActive) {
        console.log('[AkashaEngine] Switching to Finder tab...');
        await humanizedClick(this.page, finderTab);
        await logNormalDelay(800, 0.15);
      }
    }

    // 2. Ensure 3rd slot (Akasha) is active
    const slot3 = await this.page.waitForSelector('.btn-search-switch.slot3, div[data-slot="3"]', { visible: true, timeout: 5000 }).catch(() => null);
    if (slot3) {
      const isSlot3Active = await this.page.evaluate((el: any) => el.classList.contains('active'), slot3);
      if (!isSlot3Active) {
        console.log('[AkashaEngine] Activating Akasha (3rd Slot) filter...');
        await humanizedClick(this.page, slot3);
        await logNormalDelay(800, 0.15);
      }
    }

    // 3. Scan cards in #prt-search-list
    const candidates = await this.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#prt-search-list .btn-multi-raid.lis-raid.search, .btn-multi-raid.lis-raid.search'));
      return cards.map((card, index) => {
        const gaugeInner = card.querySelector('.prt-raid-gauge-inner') as HTMLElement;
        const hpWidth = gaugeInner?.style?.width || '0%';
        const hpPct = parseFloat(hpWidth) || 0;

        const playerText = (card.querySelector('.prt-flees-in') as HTMLElement)?.innerText || '';
        const match = playerText.match(/(\d+)\s*\/\s*30/);
        const players = match ? parseInt(match[1], 10) : 99;

        const raidId = (card as HTMLElement).dataset.raidId || '';
        const isVisible = (card as HTMLElement).offsetParent !== null;

        return {
          index,
          raidId,
          hpPct,
          players,
          isVisible
        };
      }).filter(c => c.isVisible && c.raidId);
    });

    console.log(`[AkashaEngine] Scanned ${candidates.length} Akasha raids on screen.`);

    // Priority 1: HP >= 75% && players <= 3
    const prio1 = candidates.filter(c => c.hpPct >= 75 && c.players <= 3);
    if (prio1.length > 0) {
      prio1.sort((a, b) => b.hpPct - a.hpPct || a.players - b.players);
      const best = prio1[0];
      console.log(`[AkashaEngine] Selected raid: ID ${best.raidId} (HP: ${best.hpPct}%, Players: ${best.players}/30) [Priority 1 match]`);
      await this.clickCandidateCard(best.index);
      return best;
    }

    // Priority 2: HP >= 60% && players <= 3 (strictly >= 60% minimum)
    const prio2 = candidates.filter(c => c.hpPct >= 60 && c.players <= 3);
    if (prio2.length > 0) {
      prio2.sort((a, b) => b.hpPct - a.hpPct || a.players - b.players);
      const best = prio2[0];
      console.log(`[AkashaEngine] Selected raid: ID ${best.raidId} (HP: ${best.hpPct}%, Players: ${best.players}/30) [Priority 2 match]`);
      await this.clickCandidateCard(best.index);
      return best;
    }

    return null;
  }

  /**
   * Searches #quest/assist (Finder tab, 3rd slot / Akasha) for an eligible raid.
   * Priority 1: HP > 70% && players <= 3
   * Priority 2: HP >= 50% && players <= 4
   * If none found: waits random 3s - 15s, refreshes, and retries.
   */
  public async findAndSelectRaid(): Promise<RaidCandidate | null> {
    const searchStartTime = Date.now();
    const maxSearchDurationMs = 10 * 60 * 1000; // 10 minutes timeout

    while (!this.stopRequested) {
      await this.sentinel.assertSafe();

      const elapsedSearchMs = Date.now() - searchStartTime;
      if (elapsedSearchMs >= maxSearchDurationMs) {
        console.warn('\n========================================================================');
        console.warn('⚠️ [AkashaEngine] No eligible Akasha raid found within 10 minutes.');
        console.warn('⚠️ Currently Akasha is not optimal for raid gold bar.');
        console.warn('========================================================================\n');
        return null;
      }

      const candidate = await this.scanSlotForCandidate();
      if (candidate) return candidate;

      // No match: Randomized wait between 3.0s and 15.0s
      const waitMs = 3000 + Math.floor(Math.random() * 12001);
      const remainingMin = ((maxSearchDurationMs - elapsedSearchMs) / 1000 / 60).toFixed(1);
      console.log(`[AkashaEngine] No eligible raids found. Waiting ${(waitMs / 1000).toFixed(1)}s before refresh... (${remainingMin}m remaining)`);
      await new Promise(resolve => setTimeout(resolve, waitMs));

      if (this.stopRequested) return null;

      // Click Search Refresh button (.btn-search-refresh)
      const refreshBtn = await this.page.$('.btn-search-refresh');
      if (refreshBtn) {
        console.log('[AkashaEngine] Clicking search refresh button...');
        await humanReactionDelay(280, 0.22);
        await humanizedClick(this.page, refreshBtn);
        await logNormalDelay(1400, 0.15);
      } else {
        console.log('[AkashaEngine] Refresh button not found. Reloading page...');
        await this.page.evaluate(() => location.reload()).catch(() => null);
        await logNormalDelay(2500, 0.15);
      }
    }

    return null;
  }

  /**
   * Executes the full Akasha workflow (Supporter summon -> Party confirm -> Combat rotation -> Drop log)
   * after a raid card has been selected.
   */
  public async executeRaidWorkflow(
    raidCandidate: RaidCandidate,
    options: {
      runNumber: number;
      targetScore?: number;
      autoReplenishEp?: boolean;
      logPath?: string;
      dropLogger?: DropLogger;
    }
  ): Promise<RaidWorkflowResult> {
    const {
      runNumber,
      targetScore = 1560000,
      autoReplenishEp = true,
      logPath = 'logs/gb-akasha.md',
      dropLogger = new DropLogger(path.resolve(logPath), 'Akasha HL')
    } = options;

    const prepStartTime = Date.now();
    this.setupResponseListener();

    // 1. Select supporter summon according to Dark priority
    console.log(`[AkashaEngine] [Run ${runNumber}] Selecting supporter summon by priority...`);
    const suppSelected = await this.selectSupporterByPriority();
    if (!suppSelected) {
      const hitPendingLimit = await this.isPendingLimitReached();
      if (hitPendingLimit) {
        console.log('[AkashaEngine] ⚠️ Supporter selection blocked by pending battle limit modal!');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, hitPendingLimit: true };
      }
      console.warn(`[AkashaEngine] [Run ${runNumber}] Could not select supporter (raid already ended/cleared). Returning to Finder...`);
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1200, 0.15);
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, raidEndedEarly: true };
    }
    await this.sentinel.assertSafe();

    // 2. Confirm party & Start Quest
    console.log(`[AkashaEngine] [Run ${runNumber}] Confirming party and starting quest...`);
    const questStarted = await this.confirmPartyAndStartQuest(autoReplenishEp);
    if (!questStarted) {
      console.warn(`[AkashaEngine] [Run ${runNumber}] Failed to start quest (raid already ended/cleared or pending limit).`);
      const hitPendingLimit = await this.isPendingLimitReached();
      if (hitPendingLimit) {
        console.log('[AkashaEngine] ⚠️ Pending battle limit modal detected!');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, hitPendingLimit: true };
      }
      await this.checkIfRaidEnded();
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1200, 0.15);
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, raidEndedEarly: true };
    }
    await this.sentinel.assertSafe();

    // 3. Wait for Combat HUD
    const combatReady = await this.waitForCombatReady();
    if (!combatReady) {
      console.warn(`[AkashaEngine] [Run ${runNumber}] Raid ended or room full before combat could start.`);
      await this.checkIfRaidEnded();
      const { stats } = dropLogger.logBattle({
        raidId: raidCandidate?.raidId || 'UNKNOWN',
        turns: 0,
        honors: 0,
        targetMet: false,
        hasGoldBar: false
      });
      console.log(`[AkashaEngine] [Run ${runNumber}] Logged to ${logPath} | Total: ${stats.totalBattles} battles | Gold Bars: ${stats.goldBars} (${stats.battlesWithoutGb} battles without Gold Bar, dry streak: ${stats.currentDryStreak})`);
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, raidEndedEarly: true };
    }
    const prepElapsedSec = ((Date.now() - prepStartTime) / 1000).toFixed(1);
    console.log(`[AkashaEngine] Combat stage ready (prep took ${prepElapsedSec}s)`);
    await this.sentinel.assertSafe();

    this.currentScore = 0;
    this.attackResolved = false;
    this.summonResolved = false;
    this.isCombatActive = true;

    let combatResult: AkashaCombatResult = {
      status: 'SUCCESS',
      finalScore: 0,
      turnsElapsed: 0,
      durationMs: 0,
      message: ''
    };

    // 4. Execute Strict Akasha Rotation:
    // Quick Summon -> Reload -> Char #4 S1 -> Death Summon -> Reload -> Char #2 S1 -> Attack Loop
    try {
      const rotationStartTime = Date.now();
      let rotationAborted = false;

      // Step 1: Quick Summon Call -> Fast F5 Reload
      await this.executeQuickCallWithReload();
      if (await this.checkIfRaidEnded()) rotationAborted = true;
      await this.sentinel.assertSafe();

      // Step 2: Char #4 (Nier) Skill 1
      if (!rotationAborted) {
        await this.executeChar4Skill1();
        if (await this.checkIfRaidEnded()) rotationAborted = true;
        await this.sentinel.assertSafe();
      }

      // Step 3: Summon #3 (Death) -> Fast F5 Reload
      if (!rotationAborted) {
        await this.executeDeathSummonWithReload();
        if (await this.checkIfRaidEnded()) rotationAborted = true;
        await this.sentinel.assertSafe();
      }

      // Step 4: Char #2 (Yukata Ilsa) Skill 1
      if (!rotationAborted) {
        await this.executeChar2Skill1();
        if (await this.checkIfRaidEnded()) rotationAborted = true;
        await this.sentinel.assertSafe();
      }

      const rotationElapsedSec = ((Date.now() - rotationStartTime) / 1000).toFixed(1);
      console.log(`[AkashaEngine] Quick Call (F5) -> Nier S1 -> Death Summon (F5) -> Ilsa S1 (took ${rotationElapsedSec}s)`);

      // Step 5: Attack Loop until score >= targetScore (1,560,000 pt)
      const battleStartTime = Date.now();
      if (rotationAborted) {
        console.log(`[AkashaEngine] [Run ${runNumber}] Raid ended or cleared during skill rotation.`);
        combatResult = {
          status: 'SUCCESS',
          finalScore: this.currentScore,
          turnsElapsed: 0,
          durationMs: 0,
          message: 'Raid cleared during skill rotation.'
        };
      } else {
        combatResult = await this.executeAttackUntilScore(targetScore, battleStartTime);
      }
      const battleElapsedSec = ((Date.now() - battleStartTime) / 1000).toFixed(1);
      console.log(`[AkashaEngine] Battle completed: ${combatResult.status} (${combatResult.finalScore.toLocaleString()} pt in ${combatResult.turnsElapsed} turns, took ${battleElapsedSec}s)`);
    } catch (combatErr: any) {
      console.warn(`[AkashaEngine] Notice during battle: ${combatErr.message}`);
      await this.checkIfRaidEnded();
    } finally {
      this.isCombatActive = false;
    }

    // Log battle to DropLogger
    const isTargetMet = this.currentScore >= targetScore || combatResult.status === 'TARGET_SCORE_REACHED';
    const { record, stats } = dropLogger.logBattle({
      raidId: raidCandidate?.raidId || 'UNKNOWN',
      turns: combatResult.turnsElapsed || 1,
      honors: this.currentScore,
      targetMet: isTargetMet,
      hasGoldBar: false
    });
    console.log(`[AkashaEngine] [Run ${runNumber}] Logged to ${logPath} | Total: ${stats.totalBattles} battles | Gold Bars: ${stats.goldBars} (${stats.battlesWithoutGb} battles without Gold Bar, dry streak: ${stats.currentDryStreak})`);

    return {
      success: true,
      score: this.currentScore,
      turns: combatResult.turnsElapsed || 1,
      durationMs: Date.now() - prepStartTime,
      goldBarFound: false
    };
  }

  /**
   * Checks if an unclaimed pending battle limit modal is currently visible on page.
   */
  public async isPendingLimitReached(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body, .prt-popup-header');
        if (!modal) return false;
        const text = (modal as HTMLElement).innerText || '';
        if (
          text.includes("aren't any pending") ||
          text.includes('未確認バトルはありません')
        ) {
          return false;
        }
        return (
          text.includes('pending battles') ||
          text.includes('Pending Battles') ||
          text.includes('pending battle') ||
          text.includes('未確認バトル') ||
          text.includes('five or more pending') ||
          text.includes('5件') ||
          text.includes('three raid') ||
          text.includes('up to three') ||
          text.includes('provide backup in up to') ||
          text.includes('only provide backup') ||
          text.includes('3 battles') ||
          text.includes('3 raid') ||
          text.includes('participating in 3') ||
          text.includes('more than 3') ||
          text.includes('up to 3') ||
          text.includes('3件まで') ||
          text.includes('同時に参戦できる') ||
          text.includes('参戦中') ||
          text.includes('3件')
        );
      });
    } catch {
      return false;
    }
  }

  private async clickCandidateCard(cardIndex: number): Promise<void> {
    const cards = await this.page.$$('#prt-search-list .btn-multi-raid.lis-raid.search, .btn-multi-raid.lis-raid.search');
    if (cards[cardIndex]) {
      await humanReactionDelay(300, 0.20);
      await humanizedClick(this.page, cards[cardIndex]);
      await logNormalDelay(1200, 0.15);

      if (await this.isPendingLimitReached()) {
        console.warn('[AkashaEngine] ⚠️ Pending battle limit popup detected on raid click. Dismissing...');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
      }
    }
  }

  /**
   * Selects Dark supporter summon by priority:
   * 1. Lvl 250 Hades
   * 2. Lvl 250 Bahamut
   * 3. Lvl <= 250 Hades
   * 4. Fallback: First visible Dark supporter
   */
  public async selectSupporterByPriority(): Promise<boolean> {
    const suppStartTime = Date.now();
    await this.page.waitForFunction(() => {
      const isSupp = window.location.hash.includes('supporter');
      const isResult = window.location.hash.includes('result');
      const modal = document.querySelector('.pop-usual');
      return isSupp || isResult || !!modal;
    }, { timeout: 15000 }).catch(() => null);

    if (await this.isPendingLimitReached()) {
      console.warn('[AkashaEngine] Supporter selection blocked by unclaimed pending battles limit modal.');
      return false;
    }

    if (await this.checkIfRaidEnded()) {
      return false;
    }

    // Switch to Dark Element tab (data-element="6")
    const darkTab = await this.page.waitForSelector('.icon-supporter-type[data-element="6"], .btn-supporter-element[data-element="6"], div[data-type="6"]', { visible: true, timeout: 6000 }).catch(() => null);
    if (darkTab) {
      const isSelected = await this.page.evaluate((el: any) => el.classList.contains('selected') || el.classList.contains('on'), darkTab);
      if (!isSelected) {
        await humanReactionDelay(250, 0.20);
        await humanizedClick(this.page, darkTab);
        await logNormalDelay(600, 0.15);
      }
    }

    await this.page.waitForSelector('.lis-supporter', { visible: true, timeout: 8000 }).catch(() => null);

    const supporters = await this.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.lis-supporter'));
      return cards.map((card, index) => {
        const text = (card as HTMLElement).innerText || '';
        const isVisible = (card as HTMLElement).offsetParent !== null;

        const isHades = text.includes('Hades') || text.includes('ハデス');
        const isBaha = text.includes('Bahamut') || text.includes('バハムート');
        const isLvl250 = text.includes('250') || text.includes('Lvl 250') || text.includes('Lv 250') || text.includes('Lv250');

        return {
          index,
          text: text.slice(0, 50).replace(/\s+/g, ' '),
          isHades,
          isBaha,
          isLvl250,
          isVisible
        };
      }).filter(s => s.isVisible);
    });

    if (supporters.length === 0) {
      if (await this.isPendingLimitReached()) {
        console.warn('[AkashaEngine] Supporter selection blocked by unclaimed pending battles limit modal.');
        return false;
      }
      if (await this.checkIfRaidEnded()) return false;
      console.warn('[AkashaEngine] No supporter summon cards visible.');
      return false;
    }

    // 1. Priority 1: Lvl 250 Hades
    let chosen = supporters.find(s => s.isHades && s.isLvl250);
    let chosenTier = 'Lvl 250 Hades';

    // 2. Priority 2: Lvl 250 Bahamut
    if (!chosen) {
      chosen = supporters.find(s => s.isBaha && s.isLvl250);
      chosenTier = 'Lvl 250 Bahamut';
    }

    // 3. Priority 3: Any Lvl <= 250 Hades
    if (!chosen) {
      chosen = supporters.find(s => s.isHades);
      chosenTier = 'Hades (<250)';
    }

    // 4. Fallback: First visible Dark supporter
    if (!chosen) {
      chosen = supporters[0];
      chosenTier = `Fallback [${chosen.text}]`;
    }

    const suppCards = await this.page.$$('.lis-supporter');
    if (suppCards[chosen.index]) {
      const suppElapsedSec = ((Date.now() - suppStartTime) / 1000).toFixed(1);
      console.log(`[AkashaEngine] Selected supporter [${chosenTier}] (took ${suppElapsedSec}s)`);
      await humanReactionDelay(250, 0.20);
      await humanizedClick(this.page, suppCards[chosen.index]);
      await logNormalDelay(900, 0.15);
      return true;
    }

    return false;
  }

  /**
   * Pending battle claim logic (batches of 3 - 5 raids).
   * Navigates to #quest/assist/unclaimed/0/0, loops until empty, checks Gold Bar drop.
   */
  public async claimPendingBattles(logPath: string, totalRuns: number, dropLogger?: DropLogger): Promise<number> {
    console.log('\n[AkashaEngine] Ensuring no pending battles exist (#quest/assist/unclaimed/0/0)...');
    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1400, 0.15);

    let goldBarsFound = 0;
    let battlesClaimed = 0;
    const maxClaims = 15;

    while (battlesClaimed < maxClaims && !this.stopRequested) {
      await this.sentinel.assertSafe();

      // Check if "There aren't any pending battles now" is displayed
      const isClean = await this.page.evaluate(() => {
        const text = document.body.innerText || '';
        return (
          text.includes("There aren't any pending battles now") ||
          text.includes("There aren't any pending battles") ||
          text.includes('未確認バトルはありません') ||
          text.includes('No pending battles')
        );
      });

      if (isClean) {
        console.log(`[AkashaEngine] No pending battles found. Total claimed: ${battlesClaimed}.`);
        break;
      }

      // Robust GBF pending card selector
      const pendingCard = await this.page.$(
        '.cnt-quest-unclaimed .prt-raid-list .btn-multi-raid, div[data-href*="result_multi"], .lis-raid[data-raid-id], .cnt-quest-unclaimed .btn-multi-raid'
      );

      if (!pendingCard) {
        console.log(`[AkashaEngine] No clickable pending battles remain. Finished claiming (${battlesClaimed} claimed).`);
        break;
      }

      const raidId = await this.page.evaluate((el: any) => el.dataset?.raidId || el.dataset?.href || '', pendingCard).catch(() => '');
      console.log(`[AkashaEngine] Claiming pending battle #${battlesClaimed + 1} (${raidId || 'ID pending'})...`);

      await humanReactionDelay(300, 0.20);
      await humanizedClick(this.page, pendingCard);
      battlesClaimed++;

      // Wait for result screen to load
      await this.page.waitForFunction(() => {
        const isResult = window.location.hash.includes('result');
        const modal = document.querySelector('.pop-usual, .pop-raid-result');
        return isResult || !!modal;
      }, { timeout: 15000 }).catch(() => null);

      await logNormalDelay(1100, 0.15);

      // Inspect reward for Gold Bar
      const dropInfo = await this.inspectForGoldBar();
      if (dropInfo.hasGoldBar) {
        goldBarsFound++;
        console.log('\n\x07\x07\x07');
        console.log('🌟===========================================================🌟');
        console.log('   🎉 GOLD BAR (ヒヒイロカネ) ACQUIRED FROM AKASHA BLUE CHEST! 🎉   ');
        console.log(`   Raid ID: ${dropInfo.raidId || 'N/A'}`);
        console.log(`   Cumulative Completed Runs: ${totalRuns}`);
        console.log('🌟===========================================================🌟\n');

        if (dropLogger) {
          dropLogger.recordPendingGoldBar(dropInfo.raidId || 'Akasha');
        } else {
          await this.appendGoldBarLog(logPath, {
            timestamp: new Date().toISOString(),
            raidId: dropInfo.raidId || 'N/A',
            turns: 'N/A',
            honors: '~1,560,000 pt',
            totalRuns
          });
        }
      }

      // Dismiss result screen
      const closeBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close, .btn-usual-ok, .btn-control.location-href');
      if (closeBtn) {
        await humanReactionDelay(250, 0.20);
        await humanizedClick(this.page, closeBtn);
        await randomDelay(400, 700);
      }

      // Re-navigate to unclaimed list to verify if more pending battles exist
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' });
      await randomDelay(1200, 1500);
    }

    console.log(`[AkashaEngine] Finished ensuring no pending battles (claimed ${battlesClaimed}). Returning to Backup Requests...`);
    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1500, 0.15);

    return goldBarsFound;
  }

  /**
   * Inspects result DOM and response payload for Gold Bar.
   */
  private async inspectForGoldBar(): Promise<{ hasGoldBar: boolean; raidId: string }> {
    try {
      const dropInfo = await this.page.evaluate(() => {
        const text = document.body.innerText || '';
        const hasText = text.includes('Gold Bar') || text.includes('Gold Brick') || text.includes('ヒヒイロカネ');
        const hasImg = !!document.querySelector([
          'img[src*="20004"]',
          'img.img-thumb[src*="20004"]',
          'img[src*="evolution/s/20004"]',
          'img[src*="assets/item/evolution/s/20004.jpg"]',
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

      if (!dropInfo.hasGoldBar && this.latestRewardData) {
        const rewardStr = JSON.stringify(this.latestRewardData);
        if (rewardStr.includes('20004') || rewardStr.includes('Gold Bar') || rewardStr.includes('Gold Brick') || rewardStr.includes('ヒヒイロカネ')) {
          dropInfo.hasGoldBar = true;
        }
      }

      return dropInfo;
    } catch {
      return { hasGoldBar: false, raidId: '' };
    }
  }

  private async appendGoldBarLog(logPath: string, entry: { timestamp: string; raidId: string; turns: string; honors: string; totalRuns: number }): Promise<void> {
    try {
      const line = `| ${entry.timestamp} | ${entry.raidId} | ${entry.turns} | ${entry.honors} | 🌟 YES! GOLD BAR! 🌟 | Run #${entry.totalRuns} |\n`;
      await fs.promises.appendFile(logPath, line, 'utf-8');
      console.log(`[AkashaEngine] Logged Gold Bar drop to ${logPath}`);
    } catch (e: any) {
      console.error(`[AkashaEngine] Failed to write to log file:`, e.message);
    }
  }

  /**
   * Single raid join & combat method.
   */
  public async runAkasha(options: AkashaJoinOptions): Promise<AkashaCombatResult> {
    const {
      raidTarget,
      targetScore = 1560000,
      autoReplenishEp = true
    } = options;

    const startTime = Date.now();
    this.currentScore = 0;
    this.attackResolved = false;
    this.summonResolved = false;

    console.log(`\n=====================================================`);
    console.log(`[AkashaEngine] Starting Akasha single routine`);
    console.log(`[AkashaEngine] Target: ${raidTarget}`);
    console.log(`[AkashaEngine] Honor Threshold: ${targetScore.toLocaleString()} pt`);
    console.log(`=====================================================`);

    await this.sentinel.assertSafe();
    this.setupResponseListener();

    const joinStatus = await this.navigateOrJoin(raidTarget, autoReplenishEp);
    if (joinStatus !== 'JOIN_OK') {
      return {
        status: joinStatus as AkashaCombatResult['status'],
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - startTime,
        message: `Failed to join raid: ${joinStatus}`
      };
    }

    console.log('[AkashaEngine] Selecting supporter summon according to priority...');
    const suppSelected = await this.selectSupporterByPriority();
    if (!suppSelected) {
      throw new Error('[AkashaEngine] Could not select any supporter summon.');
    }
    await this.sentinel.assertSafe();

    console.log('[AkashaEngine] Waiting for Quest Start OK button...');
    const questStarted = await this.confirmPartyAndStartQuest(autoReplenishEp);
    if (!questStarted) {
      return {
        status: 'FAILED',
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - startTime,
        message: 'Could not start quest from party confirmation screen.'
      };
    }

    console.log('[AkashaEngine] Entering combat stage, waiting for HUD...');
    const combatReady = await this.waitForCombatReady();
    if (!combatReady) {
      console.log('[AkashaEngine] Raid ended or room full before entering combat.');
      return {
        status: 'RAID_EXPIRED',
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - startTime,
        message: 'This battle has already ended or maximum participants reached.'
      };
    }
    await this.sentinel.assertSafe();

    // Step 1: Quick Summon -> Reload (F5)
    await this.executeQuickCallWithReload();
    await this.sentinel.assertSafe();

    // Step 2: 4th char skill 1
    await this.executeChar4Skill1();
    await this.sentinel.assertSafe();

    // Step 3: Summon death by clicking it -> reload (F5)
    await this.executeDeathSummonWithReload();
    await this.sentinel.assertSafe();

    // Step 4: 2nd char skill 1
    await this.executeChar2Skill1();
    await this.sentinel.assertSafe();

    // Step 5: Attack until score >= targetScore (1,560,000 pt)
    const combatResult = await this.executeAttackUntilScore(targetScore, startTime);

    return combatResult;
  }

  private extractTurnDamage(data: any): number {
    if (!data || !Array.isArray(data.scenario)) return 0;
    let turnDamage = 0;

    const traverse = (node: any) => {
      if (!node) return;
      if (typeof node === 'number') {
        if (node > 0 && node < 30000000 && Number.isFinite(node)) {
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
            if (typeof val === 'number' && val > 0 && val < 30000000) {
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
      if (s.cmd === 'heal' || s.cmd === 'boss_gauge' || s.cmd === 'special' || s.cmd === 'special_npc') continue;
      if (s.from === 'boss' || s.from === 'enemy' || s.target === 'player' || s.to === 'player' || s.name === 'player') continue;

      if (s.cmd === 'attack' || s.cmd === 'damage') {
        if (s.damage !== undefined) traverse(s.damage);
        if (s.list !== undefined) traverse(s.list);
      }
    }

    return turnDamage;
  }

  public setupResponseListener(): void {
    if (this.responseListenerInitialized) return;
    this.responseListenerInitialized = true;
    this.page.on('response', async (res) => {
      if (!this.isCombatActive) return;
      try {
        const url = res.url();
        if (
          url.includes('normal_attack_result.json') ||
          url.includes('ability_result.json') ||
          url.includes('summon_result.json') ||
          url.includes('start.json') ||
          url.includes('raid_battle.json') ||
          url.includes('reward.json') ||
          url.includes('result.json')
        ) {
          if (url.includes('normal_attack_result.json')) {
            this.attackResolved = true;
          }
          if (url.includes('summon_result.json')) {
            this.summonResolved = true;
          }

          if (res.status() === 200) {
            const data = await res.json().catch(() => null);
            if (data) {
              if (url.includes('reward.json') || url.includes('result.json')) {
                this.latestRewardData = data;
              }

              if (url.includes('/start.json') || url.includes('/raid_battle.json')) {
                const serverHonors =
                  (typeof data.user_point === 'number' && data.user_point > 0 ? data.user_point : null) ??
                  (typeof data.point_info?.user_point === 'number' && data.point_info.user_point > 0 ? data.point_info.user_point : null) ??
                  (typeof data.status?.user_point === 'number' && data.status.user_point > 0 ? data.status.user_point : null) ??
                  (typeof data.player?.point === 'number' && data.player.point > 0 ? data.player.point : null);

                if (serverHonors && serverHonors > this.currentScore) {
                  this.currentScore = serverHonors;
                  console.log(`[AkashaEngine] Server honors synced from raid state: ${this.currentScore.toLocaleString()} pt`);
                }
              }

              if (url.includes('normal_attack_result.json')) {
                const directPoint =
                  (typeof data.status?.user_point === 'number' && data.status.user_point > 0 ? data.status.user_point : null) ??
                  (typeof data.user_point === 'number' && data.user_point > 0 ? data.user_point : null) ??
                  (typeof data.point_info?.user_point === 'number' && data.point_info.user_point > 0 ? data.point_info.user_point : null);

                if (directPoint !== null) {
                  this.currentScore = directPoint;
                  console.log(`[AkashaEngine] Ground-truth server honors: ${this.currentScore.toLocaleString()} pt`);
                } else {
                  const turnDmg = this.extractTurnDamage(data);
                  if (turnDmg > 0) {
                    const turnHonors = Math.floor(turnDmg / 1000);
                    this.currentScore += turnHonors;
                    console.log(`[AkashaEngine] Attack resolved. Turn Dmg: ${turnDmg.toLocaleString()} (~${turnHonors.toLocaleString()} pt) | Estimated Total Honors: ${this.currentScore.toLocaleString()} pt`);
                  }
                }
              }
            }
          }
        }
      } catch {}
    });
  }

  private async navigateOrJoin(raidTarget: string, autoReplenishEp: boolean): Promise<string> {
    const isUrl = raidTarget.startsWith('http://') || raidTarget.startsWith('https://') || raidTarget.startsWith('#quest/supporter_raid');

    if (isUrl) {
      const hash = raidTarget.includes('#') ? raidTarget.substring(raidTarget.indexOf('#')) : raidTarget;
      console.log(`[AkashaEngine] Navigating directly to supporter raid URL: ${hash}`);
      await this.page.evaluate((h) => { window.location.hash = h; }, hash);
    } else {
      console.log(`[AkashaEngine] Joining raid via code: ${raidTarget}`);
      await this.page.evaluate(() => { window.location.hash = '#quest/assist'; });
      await this.sentinel.assertSafe();

      const enterIdTab = await this.page.waitForSelector('.tab-enter-id, div[data-tab="enter_id"]', { visible: true, timeout: 8000 });
      if (!enterIdTab) throw new Error('Enter ID tab not found on #quest/assist');
      await humanizedClick(this.page, enterIdTab);
      await this.sentinel.assertSafe();

      const inputSelector = 'input.frm-raid-id';
      await humanizedClick(this.page, inputSelector);
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyA');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Backspace');
      await this.page.keyboard.type(raidTarget, { delay: 45 });
      await randomDelay(300, 600);

      const joinBtn = await this.page.waitForSelector('.btn-post-key, .btn-join', { visible: true, timeout: 5000 });
      if (!joinBtn) throw new Error('Join button not found after entering ID');
      await humanizedClick(this.page, joinBtn);
    }

    await this.page.waitForFunction(() => {
      const isSupporter = window.location.hash.includes('supporter');
      const isBattle = window.location.hash.includes('raid');
      const modal = document.querySelector('.pop-usual');
      return isSupporter || isBattle || !!modal;
    }, { timeout: 12000 }).catch(() => null);

    return await this.checkJoinModals(autoReplenishEp);
  }

  private async checkJoinModals(autoReplenishEp: boolean): Promise<string> {
    const modal = await this.page.$('.pop-usual');
    if (!modal) return 'JOIN_OK';

    const modalText = await this.page.evaluate((el: any) => el.innerText || '', modal);

    if (modalText.includes('Soul Balm') || modalText.includes('Soul Berry') || modalText.includes('use items') || modalText.includes('回復')) {
      if (!autoReplenishEp) {
        console.warn('[AkashaEngine] EP depleted and autoReplenishEp is disabled.');
        return 'EP_DEPLETED';
      }
      console.log('[AkashaEngine] EP depleted, replenishing with Soul Berries...');
      const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
      if (okBtn) {
        await humanReactionDelay(300, 0.20);
        await humanizedClick(this.page, okBtn);
        await randomDelay(800, 1200);
        return 'JOIN_OK';
      }
    }

    if (modalText.includes('ended') || modalText.includes('終了')) {
      console.warn('[AkashaEngine] Raid has already ended.');
      const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
      if (okBtn) await humanizedClick(this.page, okBtn);
      return 'RAID_EXPIRED';
    }

    if (modalText.includes('participants') || modalText.includes('参戦人数')) {
      console.warn('[AkashaEngine] Maximum participants reached.');
      const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
      if (okBtn) await humanizedClick(this.page, okBtn);
      return 'ROOM_FULL';
    }

    if (modalText.includes('pending') || modalText.includes('未確認')) {
      console.warn('[AkashaEngine] Unclaimed pending battles limit reached.');
      const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
      if (okBtn) await humanizedClick(this.page, okBtn);
      return 'PENDING_LIMIT';
    }

    return 'JOIN_OK';
  }

  private async confirmPartyAndStartQuest(autoReplenishEp: boolean): Promise<boolean> {
    await this.page.waitForFunction(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      const modal = document.querySelector('.pop-usual');
      const isResult = window.location.hash.includes('result');
      return (ok && ok.offsetParent !== null) || !!modal || isResult;
    }, { timeout: 15000 }).catch(() => null);

    if (await this.checkIfRaidEnded()) {
      console.warn('[AkashaEngine] Raid ended or cleared on party confirmation screen.');
      return false;
    }

    const joinStatus = await this.checkJoinModals(autoReplenishEp);
    if (joinStatus !== 'JOIN_OK') {
      console.warn(`[AkashaEngine] Join modal returned: ${joinStatus}`);
      return false;
    }

    const startBtn = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok', { visible: true, timeout: 8000 }).catch(() => null);
    if (!startBtn) {
      if (await this.checkIfRaidEnded()) return false;
      console.warn('[AkashaEngine] Quest Start button not found.');
      return false;
    }

    console.log('[AkashaEngine] Clicking Quest Start OK button...');
    await humanReactionDelay(300, 0.20);
    await humanizedClick(this.page, startBtn);
    return true;
  }

  private async waitForCombatReady(): Promise<boolean> {
    await this.page.waitForFunction(() => {
      const hasAtk = !!document.querySelector('.btn-attack-start');
      const hasQs = !!document.querySelector('.btn-quick-summon');
      const hasChara = !!document.querySelector('.lis-character0.btn-command-character, .prt-command-chara .lis-character0');
      const isResult = window.location.hash.includes('result');
      const modal = document.querySelector('.pop-usual');
      return hasAtk || hasQs || hasChara || isResult || !!modal;
    }, { timeout: 25000 });

    const currentHash = await this.page.evaluate(() => window.location.hash);
    if (currentHash.includes('result')) {
      console.warn('[AkashaEngine] Raid ended or cleared before combat could begin.');
      const okBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close, .btn-control.location-href');
      if (okBtn) await humanizedClick(this.page, okBtn);
      return false;
    }

    const modal = await this.page.$('.pop-usual');
    if (modal) {
      const modalText = await this.page.evaluate((el: any) => el.innerText || '', modal);
      if (modalText.includes('ended') || modalText.includes('終了')) {
        console.warn('[AkashaEngine] Raid has already ended.');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return false;
      }
      if (modalText.includes('participants') || modalText.includes('参戦人数')) {
        console.warn('[AkashaEngine] Maximum participants reached.');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return false;
      }
      if (modalText.includes('pending') || modalText.includes('未確認')) {
        console.warn('[AkashaEngine] Unclaimed pending battles limit reached.');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return false;
      }
    }

    const hasCombatHud = await this.page.evaluate(() => {
      return !!document.querySelector('.btn-attack-start, .btn-attack, .btn-quick-summon, .lis-character0.btn-command-character, .prt-command-chara');
    });

    if (!hasCombatHud) {
      console.warn('[AkashaEngine] Combat HUD not detected. Raid likely concluded.');
      return false;
    }

    await randomDelay(600, 900);
    return true;
  }

  /**
   * Action 1: Quick Summoning Call -> Reload (F5)
   */
  private async executeQuickCallWithReload(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[AkashaEngine] [Action 1/4] Quick Summon -> Reload (F5)...');
    const qsBtn = await this.page.waitForSelector('.btn-quick-summon.qs-ready, .btn-quick-summon', { visible: true, timeout: 6000 }).catch(() => null);
    if (qsBtn) {
      this.summonResolved = false;
      await humanReactionDelay(200, 0.18);
      await humanizedClick(this.page, qsBtn, { allowMultiClick: true, multiClickChance: 0.40 });
      console.log('[AkashaEngine] Quick Summon triggered.');

      // Wait briefly for network dispatch (max 300ms)
      await this.waitForSummonResolution(300);

      // Reload F5 to skip summon animation!
      console.log('[AkashaEngine] Fast F5 reloading to skip Quick Summon animation...');
      await this.page.evaluate(() => location.reload()).catch(() => null);

      await this.page.waitForFunction(() => {
        const hasAtk = !!document.querySelector('.btn-attack-start') || !!document.querySelector('.btn-attack');
        const hasChara = !!document.querySelector('.lis-character3') || !!document.querySelector('.prt-command-chara');
        const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
        return (hasAtk && hasChara) || isRes;
      }, { timeout: 12000 }).catch(() => null);

      await randomDelay(250, 450);
      console.log('[AkashaEngine] Quick Summon resolved & skipped via F5.');
    } else {
      console.warn('[AkashaEngine] Quick Summon button not ready or not available. Continuing...');
    }
  }

  /**
   * Action 2: 4th char (Nier) Skill 1
   */
  private async executeChar4Skill1(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[AkashaEngine] [Action 2/4] Char #4 (Nier) -> Skill 1...');

    // 1. Close any open ability tray if present
    await this.page.evaluate(() => {
      const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
      if (back && back.offsetParent !== null) back.click();
    }).catch(() => null);

    const char4 = await this.page.waitForSelector('.lis-character3', { visible: true, timeout: 6000 }).catch(() => null);
    if (!char4) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[AkashaEngine] Char #4 portrait not found.');
      return;
    }

    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, char4, { allowMultiClick: true, multiClickChance: 0.30 });
    await randomDelay(350, 550);

    console.log('[AkashaEngine] Using Char #4 Skill 1 (World of Death and Love)...');
    let s1 = await this.page.waitForSelector('.ability-character-num-4-1', { visible: true, timeout: 4000 }).catch(() => null);
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.log('[AkashaEngine] Char #4 ability tray not yet visible, re-clicking portrait...');
      await humanizedClick(this.page, char4);
      s1 = await this.page.waitForSelector('.ability-character-num-4-1', { visible: true, timeout: 4000 }).catch(() => null);
    }
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[AkashaEngine] Char #4 Skill 1 not found.');
      return;
    }

    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, s1, { allowMultiClick: true, multiClickChance: 0.45 });
    await randomDelay(450, 650);

    // Close ability tray
    await this.page.evaluate(() => {
      const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
      if (back && back.offsetParent !== null) back.click();
    }).catch(() => null);
    await randomDelay(150, 300);
  }

  /**
   * Action 3: Summon Death by clicking it -> reload (F5)
   */
  private async executeDeathSummonWithReload(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[AkashaEngine] [Action 3/4] Calling Summon #3 (Death) with instant F5 animation skip...');

    // 1. Close any open ability tray if present
    await this.page.evaluate(() => {
      const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
      if (back && back.offsetParent !== null) back.click();
    }).catch(() => null);

    // 2. Click Summon Menu button (.btn-command-summon)
    const summonCmd = await this.page.waitForSelector('.btn-command-summon', { visible: true, timeout: 6000 }).catch(() => null);
    if (!summonCmd) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[AkashaEngine] Summon menu button not found.');
      return;
    }
    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, summonCmd, { allowMultiClick: true, multiClickChance: 0.35 });

    // 3. Wait for summon #3 (Death) to appear
    console.log('[AkashaEngine] Clicking Summon #3 (Death)...');
    const deathSummon = await this.page.waitForSelector(
      '.lis-summon[pos="3"], #canv-summon-pos-3, .lis-summon.summon-3, div[pos="3"].lis-summon',
      { visible: true, timeout: 5000 }
    ).catch(() => null);

    if (!deathSummon) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[AkashaEngine] Death summon (pos 3) not found.');
      return;
    }

    this.summonResolved = false;

    // 4. Click Death summon card directly (one-click call)
    await humanReactionDelay(180, 0.18);
    await humanizedClick(this.page, deathSummon, { allowMultiClick: true, multiClickChance: 0.40 });

    // 5. Brief check for confirm modal (300ms max)
    const callBtn = await this.page.waitForSelector(
      '.btn-usual-ok.btn-summon-use, .btn-summon-use, .pop-usual .btn-usual-ok, .se-summon-call',
      { visible: true, timeout: 300 }
    ).catch(() => null);

    if (callBtn) {
      console.log('[AkashaEngine] Confirming Call button for Death...');
      await humanizedClick(this.page, callBtn);
    }

    // 6. Wait briefly for summon network dispatch (max 300ms)
    await this.waitForSummonResolution(300);

    // 7. Instant F5 Reload to skip Death summon animation & sacrifice delay!
    console.log('[AkashaEngine] Fast F5 reloading to skip Death summon animation...');
    await this.page.evaluate(() => location.reload()).catch(() => null);

    // 8. Wait for page reload to complete and combat HUD to return
    await this.page.waitForFunction(() => {
      const hasAtk = !!document.querySelector('.btn-attack-start') || !!document.querySelector('.btn-attack');
      const hasChara = !!document.querySelector('.lis-character1') || !!document.querySelector('.prt-command-chara');
      const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
      const isEnd =
        document.body.innerText.includes('ended') ||
        document.body.innerText.includes('終了') ||
        document.body.innerText.includes('concluded');
      return (hasAtk && hasChara) || isRes || isEnd;
    }, { timeout: 12000 }).catch(() => null);

    await randomDelay(250, 450);
    console.log('[AkashaEngine] Death summon called & animation skipped via F5.');
  }

  /**
   * Action 4: 2nd char (Yukata Ilsa) Skill 1
   */
  private async executeChar2Skill1(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[AkashaEngine] [Action 4/4] Char #2 (Yukata Ilsa) -> Skill 1...');

    await this.page.evaluate(() => {
      const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
      if (back && back.offsetParent !== null) back.click();
    }).catch(() => null);

    const char2 = await this.page.waitForSelector('.lis-character1', { visible: true, timeout: 6000 }).catch(() => null);
    if (!char2) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[AkashaEngine] Char #2 portrait not found.');
      return;
    }
    await humanReactionDelay(220, 0.18);
    await humanizedClick(this.page, char2, { allowMultiClick: true, multiClickChance: 0.30 });
    await randomDelay(350, 550);

    console.log('[AkashaEngine] Using Char #2 Skill 1 (Midnight Ray)...');
    let s1 = await this.page.waitForSelector('.ability-character-num-2-1', { visible: true, timeout: 4000 }).catch(() => null);
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.log('[AkashaEngine] Char #2 ability tray not yet visible, re-clicking portrait...');
      await humanizedClick(this.page, char2);
      s1 = await this.page.waitForSelector('.ability-character-num-2-1', { visible: true, timeout: 4000 }).catch(() => null);
    }
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[AkashaEngine] Char #2 Skill 1 not found.');
      return;
    }
    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, s1, { allowMultiClick: true, multiClickChance: 0.50 });
    await randomDelay(500, 750);

    // Close ability tray so Attack button is exposed immediately
    await this.page.evaluate(() => {
      const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
      if (back && back.offsetParent !== null) back.click();
    }).catch(() => null);
    await randomDelay(150, 300);
  }

  /**
   * Action 5: Attack Loop until score > targetScore (1,560,000 pt)
   */
  private async executeAttackUntilScore(targetScore: number, startTime: number): Promise<AkashaCombatResult> {
    console.log(`\n-----------------------------------------------------`);
    console.log(`[AkashaEngine] Attack phase until honors > ${targetScore.toLocaleString()} pt...`);
    console.log(`-----------------------------------------------------`);

    const maxDurationMs = 10 * 60 * 1000;
    let attackCommandsIssued = 0;
    let stalledHudCount = 0;

    while (Date.now() - startTime < maxDurationMs && !this.stopRequested) {
      await this.sentinel.assertSafe();

      // 1. Check if raid is already finished or cleared
      const isRaidEnded = await this.checkIfRaidEnded();
      if (isRaidEnded) {
        const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[AkashaEngine] Raid ended or cleared with score: ${this.currentScore.toLocaleString()} pt (attack phase took ${totalBattleSec}s).`);
        return {
          status: 'SUCCESS',
          finalScore: this.currentScore,
          turnsElapsed: attackCommandsIssued,
          durationMs: Date.now() - startTime,
          message: `Raid finished. Final score: ${this.currentScore.toLocaleString()} pt.`
        };
      }

      // 2. Check current ground-truth honors before issuing next turn
      const currentHonors = await this.fetchCurrentScore();
      if (currentHonors > this.currentScore) {
        this.currentScore = currentHonors;
      }

      // 3. If target score is reached (> 1,560,000 pt), stop immediately!
      if (attackCommandsIssued >= 1 && this.currentScore >= targetScore) {
        const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const inGameTurn = await this.getInGameTurn();
        console.log(`\n🎉 [AkashaEngine] Blue chest target reached! (${this.currentScore.toLocaleString()} >= ${targetScore.toLocaleString()} pt on In-Game Turn ${inGameTurn}, attack phase took ${totalBattleSec}s)`);
        return {
          status: 'TARGET_SCORE_REACHED',
          finalScore: this.currentScore,
          turnsElapsed: attackCommandsIssued,
          durationMs: Date.now() - startTime,
          message: `Reached target honor score of ${this.currentScore.toLocaleString()} pt in ${attackCommandsIssued} attacks (In-Game Turn ${inGameTurn}).`
        };
      }

      // 4. Wait for combat input to be genuinely ready
      const inputReady = await this.waitForCombatInputReady(8000);
      if (!inputReady) {
        if (await this.checkIfRaidEnded()) {
          const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[AkashaEngine] Raid ended or cleared with score: ${this.currentScore.toLocaleString()} pt (attack phase took ${totalBattleSec}s).`);
          return {
            status: 'SUCCESS',
            finalScore: this.currentScore,
            turnsElapsed: attackCommandsIssued,
            durationMs: Date.now() - startTime,
            message: `Raid finished. Final score: ${this.currentScore.toLocaleString()} pt.`
          };
        }

        stalledHudCount++;
        const currentTurn = await this.getInGameTurn();
        console.log(`[AkashaEngine] [In-Game Turn ${currentTurn}] Combat HUD not ready (attempt ${stalledHudCount}/2)...`);

        if (stalledHudCount >= 2) {
          const isEnded = await this.checkIfRaidEnded();
          if (isEnded || this.currentScore >= targetScore * 0.90 || stalledHudCount >= 3) {
            console.log(`[AkashaEngine] Combat HUD remained inactive (${stalledHudCount} attempts, raid ended: ${isEnded}). Concluding battle...`);
            const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
            return {
              status: 'SUCCESS',
              finalScore: this.currentScore,
              turnsElapsed: attackCommandsIssued,
              durationMs: Date.now() - startTime,
              message: `Raid concluded (HUD inactive). Final score: ${this.currentScore.toLocaleString()} pt.`
            };
          }
        }

        await randomDelay(800, 1200);
        continue;
      }
      stalledHudCount = 0;

      // 5. Human reaction delay
      await humanReactionDelay(300, 0.20);

      // 6. In-game turn & Attack click
      const inGameTurn = await this.getInGameTurn();
      attackCommandsIssued++;
      const turnStartTime = Date.now();
      this.attackResolved = false;

      console.log(`[AkashaEngine] [In-Game Turn ${inGameTurn}] Clicking Attack... (Current Honors: ${this.currentScore.toLocaleString()} pt)`);
      const attackBtn = await this.page.$('.btn-attack-start');
      if (!attackBtn) {
        console.warn('[AkashaEngine] Attack button disappeared. Re-checking state...');
        await randomDelay(400, 750);
        continue;
      }

      await humanizedClick(this.page, attackBtn, { allowMultiClick: true, multiClickChance: 0.50, maxClicks: 2 });

      // 7. Wait for server resolution of normal_attack_result.json
      const responseResolved = await this.waitForAttackResolution(12000);

      if (responseResolved && config.COMBAT_AUTO_REFRESH) {
        await randomDelay(180, 360);
        await this.page.evaluate(() => location.reload()).catch(() => null);

        await this.page.waitForFunction(() => {
          const hasAtk = !!document.querySelector('.btn-attack-start') || !!document.querySelector('.btn-attack');
          const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
          return hasAtk || isRes;
        }, { timeout: 15000 }).catch(() => null);

        await randomDelay(400, 700);

        const scoreAfterReload = await this.fetchCurrentScore();
        if (scoreAfterReload > this.currentScore) {
          this.currentScore = scoreAfterReload;
        }

        await this.waitForCombatInputReady(8000);
      } else if (!responseResolved) {
        console.log(`[AkashaEngine] [In-Game Turn ${inGameTurn}] Turn still processing on server. Waiting for lock release...`);
        await randomDelay(2000, 3000);
        const scoreAfterWait = await this.fetchCurrentScore();
        if (scoreAfterWait > this.currentScore) {
          this.currentScore = scoreAfterWait;
        }
      }

      const nextInGameTurn = await this.getInGameTurn();
      const turnElapsedSec = ((Date.now() - turnStartTime) / 1000).toFixed(1);
      const battleElapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const updatedProgressPct = ((this.currentScore / targetScore) * 100).toFixed(1);

      if (nextInGameTurn > inGameTurn) {
        console.log(`[AkashaEngine] [In-Game Turn ${inGameTurn} -> ${nextInGameTurn}] Resolved in ${turnElapsedSec}s (Attack phase: ${battleElapsedSec}s) | Honors: ${this.currentScore.toLocaleString()} / ${targetScore.toLocaleString()} pt (${updatedProgressPct}%)`);
      } else {
        console.log(`[AkashaEngine] [In-Game Turn ${inGameTurn}] Turn cycle completed in ${turnElapsedSec}s (Attack phase: ${battleElapsedSec}s) | Honors: ${this.currentScore.toLocaleString()} / ${targetScore.toLocaleString()} pt (${updatedProgressPct}%)`);
      }
    }

    return {
      status: this.stopRequested ? 'FAILED' : 'SUCCESS',
      finalScore: this.currentScore,
      turnsElapsed: attackCommandsIssued,
      durationMs: Date.now() - startTime,
      message: this.stopRequested ? 'Stopped by user.' : `Akasha battle completed with score ${this.currentScore.toLocaleString()} pt.`
    };
  }

  private async getInGameTurn(): Promise<number> {
    try {
      return await this.page.evaluate(() => {
        const stage = (window as any).stage;
        if (stage?.gGameStatus?.turn !== undefined && typeof stage.gGameStatus.turn === 'number' && stage.gGameStatus.turn > 0) {
          return stage.gGameStatus.turn;
        }
        if (stage?.pJsnData?.turn !== undefined && typeof stage.pJsnData.turn === 'number' && stage.pJsnData.turn > 0) {
          return stage.pJsnData.turn;
        }
        const turnEl = document.querySelector('.prt-turn-info, .txt-turn-num, .prt-turn');
        if (turnEl) {
          const num = parseInt((turnEl as HTMLElement).innerText?.replace(/[^0-9]/g, '') || '', 10);
          if (!isNaN(num) && num > 0) return num;
        }
        return 1;
      });
    } catch {
      return 1;
    }
  }

  private async waitForCombatInputReady(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    let reloadAttempted = false;

    while (Date.now() - start < timeoutMs && !this.stopRequested) {
      if (await this.checkIfRaidEnded()) return false;

      // Close drawer if open
      await this.page.evaluate(() => {
        const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
        if (back && back.offsetParent !== null) {
          back.click();
        }
      }).catch(() => null);

      // Check if Attack button is truly ready
      const isReady = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          if (stage.gGameStatus.attacking || stage.gGameStatus.lock || stage.gGameStatus.btn_lock) {
            return false;
          }
        }
        const atk = document.querySelector('.btn-attack-start') as HTMLElement;
        if (!atk) return false;
        const style = window.getComputedStyle(atk);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (atk.classList.contains('display-off') || atk.classList.contains('lock')) return false;
        const rect = atk.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      if (isReady) return true;

      // If stuck waiting >3.5s, fast F5 reload to unfreeze state or detect ended raid
      if (!reloadAttempted && Date.now() - start > 3500) {
        reloadAttempted = true;
        console.log('[AkashaEngine] Combat HUD unresponsive or turn processing. Fast F5 reloading to sync state...');
        await this.page.evaluate(() => location.reload()).catch(() => null);

        await this.page.waitForFunction(() => {
          const hasAtk = !!document.querySelector('.btn-attack-start') || !!document.querySelector('.btn-attack');
          const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
          const isEnd =
            document.body.innerText.includes('ended') ||
            document.body.innerText.includes('終了') ||
            document.body.innerText.includes('concluded') ||
            document.body.innerText.includes('クリア');
          return hasAtk || isRes || isEnd;
        }, { timeout: 10000 }).catch(() => null);

        await randomDelay(400, 650);
        if (await this.checkIfRaidEnded()) return false;
      }

      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  private async fetchCurrentScore(): Promise<number> {
    try {
      const scoreFromPage = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const pJsn = stage?.pJsnData;

        if (pJsn?.user_point !== undefined) {
          const pt = Number(pJsn.user_point);
          if (!isNaN(pt) && pt > 0) return pt;
        }

        if (pJsn?.point_info?.user_point !== undefined) {
          const pt = Number(pJsn.point_info.user_point);
          if (!isNaN(pt) && pt > 0) return pt;
        }

        if (stage?.gGameStatus?.player?.point !== undefined) {
          const pt = Number(stage.gGameStatus.player.point);
          if (!isNaN(pt) && pt > 0) return pt;
        }

        const pointEl = document.querySelector('.txt-user-point, .prt-user-point, .txt-point, .prt-point, .prt-point-info .txt-point');
        if (pointEl) {
          const parsed = parseInt((pointEl as HTMLElement).innerText?.replace(/[^0-9]/g, '') || '', 10);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }

        const ptElements = Array.from(document.querySelectorAll('.prt-raid-info *, .cnt-raid-info *'));
        for (const el of ptElements) {
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (text.includes('pt') && text.length < 25) {
            const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num) && num > 0) return num;
          }
        }

        return 0;
      });

      return Math.max(scoreFromPage, this.currentScore);
    } catch {
      return this.currentScore;
    }
  }

  public async checkIfRaidEnded(): Promise<boolean> {
    try {
      const currentUrl = this.page.url();
      const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');

      if (
        currentUrl.includes('result') ||
        currentUrl.includes('empty') ||
        currentHash.includes('result') ||
        currentHash.includes('empty')
      ) {
        return true;
      }

      const raidState = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;

        // 1. Check stage game status flags
        if (gStatus) {
          if (gStatus.finish || gStatus.raid_finish || gStatus.lose || gStatus.win) {
            return { isEnded: true, reason: 'gGameStatus finish/win flag' };
          }
          if (gStatus.boss?.param?.[0]?.hp !== undefined && Number(gStatus.boss.param[0].hp) <= 0) {
            return { isEnded: true, reason: 'gGameStatus Boss HP <= 0' };
          }
        }

        // 2. Check stage pJsnData (raw API response from start.json / raid_battle.json)
        if (pJsn) {
          if (pJsn.finish || pJsn.raid_finish || pJsn.is_finish || pJsn.result || pJsn.is_clear) {
            return { isEnded: true, reason: 'pJsnData finish/result flag' };
          }
          if (pJsn.boss?.param?.[0]?.hp !== undefined && Number(pJsn.boss.param[0].hp) <= 0) {
            return { isEnded: true, reason: 'pJsnData Boss HP <= 0' };
          }
        }

        // 3. Check DOM enemy HP percent (only if boss HP is not explicitly positive)
        const activeHp = Number(gStatus?.boss?.param?.[0]?.hp ?? pJsn?.boss?.param?.[0]?.hp ?? -1);
        if (activeHp <= 0) {
          const enemyGauges = document.querySelectorAll('.prt-enemy-percent, .txt-enemy-hp, .prt-boss-percent');
          for (const g of Array.from(enemyGauges)) {
            const el = g as HTMLElement;
            if (el.offsetParent !== null) {
              const txt = el.innerText?.trim();
              if (txt === '0%' || txt === '0' || txt === 'HP 0%') {
                return { isEnded: true, reason: `Enemy gauge: ${txt}` };
              }
            }
          }
        }

        // 4. Check entire visible text for conclusive raid conclusion phrases
        const bodyText = document.body ? document.body.innerText || '' : '';
        const endedPhrases = [
          'This raid battle has already ended',
          'This battle has already ended',
          'The battle has concluded',
          'The battle has ended',
          'Raid Battle Results',
          'Quest Cleared',
          'Quest Results',
          'このバトルは既に終了しています',
          'バトルが終了しました',
          'このクエストは終了しています',
          '報酬を獲得しました',
          'クエストクリア',
          '討伐成功',
          '既に終了'
        ];
        for (const phrase of endedPhrases) {
          if (bodyText.includes(phrase)) {
            return { isEnded: true, reason: `Body text phrase: "${phrase}"` };
          }
        }

        // 5. Check all visible modals / popups
        const popups = document.querySelectorAll(
          '.pop-usual, .pop-raid-result, #pop, .prt-popup-body, .prt-popup-container, .pop-synced, .txt-popup-body'
        );
        for (const pop of Array.from(popups)) {
          const style = window.getComputedStyle(pop);
          if (style.display !== 'none' && style.visibility !== 'hidden') {
            const t = (pop as HTMLElement).innerText || '';
            for (const phrase of endedPhrases) {
              if (t.includes(phrase)) {
                return { isEnded: true, reason: `Visible modal phrase: "${phrase}"` };
              }
            }
          }
        }

        // 6. Check for result buttons
        const resultBtn = document.querySelector('.btn-result-close, .btn-control.location-href');
        if (resultBtn) {
          return { isEnded: true, reason: 'Result button present' };
        }

        return { isEnded: false, reason: '' };
      });

      if (raidState.isEnded) {
        console.log(`[AkashaEngine] Raid concluded detected (${raidState.reason}).`);
        await this.page.evaluate(() => {
          const okBtn = document.querySelector(
            '.pop-usual .btn-usual-ok, .pop-raid-result .btn-usual-ok, #pop .btn-usual-ok, .prt-popup-footer .btn-usual-ok, .btn-result-close, .btn-usual-ok'
          ) as HTMLElement;
          if (okBtn && okBtn.offsetParent !== null) {
            okBtn.click();
          }
        }).catch(() => null);
        await randomDelay(300, 500);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private async waitForAttackResolution(timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.attackResolved) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  private async waitForSummonResolution(timeoutMs = 800): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.summonResolved) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  }
}

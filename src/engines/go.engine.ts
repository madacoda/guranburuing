/**
 * @file go.engine.ts
 * @description High-performance Grand Order HL (GO HL / The Peacemaker's Wings Impossible) automated Gold Bar hunter.
 * 
 * ### Key Architectural Principles:
 * 1. **Biomechanical Human Motor Simulation**:
 *    - Cognitive reaction delays (`humanReactionDelay`) modeling visual-motor perception latencies.
 *    - Physical switch hold actuation (40ms - 75ms) and hover padding.
 *    - Continuous cubic Bézier mouse movement with frame-separated step latencies.
 *    - Natural rapid tapping (multi-clicking) on high-frequency attack and skill buttons.
 *    - Anticipatory F5 refresh latency (180ms - 380ms) and post-reload orientation pauses (450ms - 750ms).
 * 
 * 2. **Honest In-Game Turn Telemetry**:
 *    - Ground-truth turns directly queried from the GBF battle engine (`stage.gGameStatus.turn`).
 *    - Eliminates blind loop counter desync; distinguishes between server lock waits and turn increments.
 *    - Guarded by `waitForCombatInputReady` checking engine locks, animation flags, and layout bounding rects.
 * 
 * 3. **Dual-Track Real-Time Honor Synchronization**:
 *    - Track 1: Deep recursive tree traversal of `normal_attack_result.json` capturing echoes, multi-attacks, and passives.
 *    - Track 2: Ground-truth server honors queried from `stage.pJsnData.user_point` and `/start.json` upon F5 reload.
 *    - Instant exit on Turn 2 once reaching the Blue Chest threshold (~1,480,000 pt).
 * 
 * 4. **Dynamic Randomized Pending Battle Recovery**:
 *    - Batches unclaimed battle claims every 3 to 5 raids, strictly capping below GBF's 5-battle hard limit.
 *    - Automated inspection of DOM and network payload for un-capped Gold Bars (`item_id 20004`).
 * 
 * @see {@link file:///c:/laragon/www/gbf/logs/gb-go.md}
 */

import { Page, HTTPResponse } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, humanizedType, logNormalDelay, randomDelay, humanReactionDelay } from '../human-motor.js';
import { config } from '../config.js';
import { DropLogger, RaidCandidate, RaidWorkflowResult } from './drop-logger.js';

export interface GoJoinOptions {
  /** Raid code (e.g. "ABC12345") or full supporter_raid URL */
  raidTarget: string;
  /** Target honor score before terminating combat (default: 1,480,000 pt) */
  targetScore?: number;
  /** Automatically consume Soul Berries if EP is insufficient */
  autoReplenishEp?: boolean;
}

export interface GoCombatResult {
  status: 'SUCCESS' | 'TARGET_SCORE_REACHED' | 'RAID_EXPIRED' | 'ROOM_FULL' | 'PENDING_LIMIT' | 'EP_DEFICIENT' | 'FAILED';
  finalScore: number;
  turnsElapsed: number;
  durationMs: number;
  message: string;
}

export interface GoFarmingOptions {
  runs?: number; // Total runs (default: Infinity)
  targetScore?: number; // Default: 1,480,000 pt
  autoReplenishEp?: boolean;
  minBatchClaim?: number; // Default: 3
  maxBatchClaim?: number; // Default: 5
  batchClaimSize?: number; // Fixed override if provided
  logPath?: string; // Default: 'logs/gb-go.md'
}

export interface GoFarmingSummary {
  totalRunsAttempted: number;
  totalRunsCompleted: number;
  totalGoldBars: number;
  battlesWithoutGb: number;
  currentDryStreak: number;
  dropRatePct: string;
  durationMs: number;
}

export class GoEngine {
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
   * Continuous farming loop for Grand Order HL (GO HL):
   * 1. Finds GO HL raid on #quest/assist (Slot 2: HP > 70% & <= 3/18 players, or >= 50% & <= 4/18)
   * 2. Selects supporter summon by priority (Hades 250 -> Baha 250 -> Hades any -> fallback)
   * 3. Executes exact skill sequence & attacks until >= 1,480,000 pt
   * 4. Claims pending battles in randomized batches of 3 - 5 raids (never exceeding 5)
   *    and logs any Gold Bar drops to logs/gb-go.md
   */
  public async runGoFarmingLoop(options: GoFarmingOptions = {}): Promise<GoFarmingSummary> {
    const {
      runs = Infinity,
      targetScore = 1480000,
      autoReplenishEp = true,
      minBatchClaim = 3,
      maxBatchClaim = 5,
      batchClaimSize,
      logPath = 'logs/gb-go.md'
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
    console.log(`       Granblue Fantasy - GO HL Auto-Farming Loop    `);
    console.log(`         (The Peacemaker's Wings Impossible)         `);
    console.log(`=====================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Infinite (Press Ctrl+C to stop)' : runs}`);
    console.log(`Honor Threshold:      ${targetScore.toLocaleString()} pt`);
    console.log(`Pending Claim Batch:  Randomized 3 - 5 raids (first batch: ${currentBatchThreshold})`);
    console.log(`Drop Log File:        ${logPath}`);
    console.log(`=====================================================\n`);

    const dropLogger = new DropLogger(logPath, "Grand Order HL (The Peacemaker's Wings Impossible)");
    const initialStats = dropLogger.getStats();
    console.log(`[GoEngine] Historical Log: ${initialStats.totalBattles} total battles, ${initialStats.goldBars} Gold Bars (${initialStats.battlesWithoutGb} battles without Gold Bar, current dry streak: ${initialStats.currentDryStreak})`);

    this.setupResponseListener();

    // Initial safety check: clear pre-existing pending battles so we don't start near the 5-limit cap
    console.log('[GoEngine] Checking for pre-existing pending battles before starting session...');
    const initialGb = await this.claimPendingBattles(logPath, 0, dropLogger);
    totalGoldBars += initialGb;

    while (totalCompleted < runs && !this.stopRequested) {
      // 1. Safety check: if pending battles reached batch threshold, claim before searching
      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`\n[GoEngine] Batch threshold of ${currentBatchThreshold} reached (${joinedInCurrentBatch} joined). Claiming pending battles...`);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        console.log(`[GoEngine] Next pending check scheduled in ${currentBatchThreshold} raids.`);
      }

      if (this.stopRequested) break;

      // 2. Find eligible GO HL raid (>70% HP & <=3/18, or >=50% HP & <=4/18)
      const iterationStartTime = Date.now();
      console.log(`\n-----------------------------------------------------`);
      console.log(`[GoEngine] [Run ${totalCompleted + 1}] Searching for eligible GO HL raid...`);
      console.log(`-----------------------------------------------------`);

      let raidCandidate;
      try {
        raidCandidate = await this.findAndSelectRaid();
      } catch (err: any) {
        if (this.stopRequested) break;
        console.warn(`[GoEngine] Search warning: ${err.message}. Retrying in 4s...`);
        await logNormalDelay(4000, 0.1);
        continue;
      }

      // Check if pending limit modal was triggered during finder selection
      if (await this.isPendingLimitReached()) {
        console.log('[GoEngine] ⚠️ Pending battle limit modal detected! Claiming pending battles now...');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      if (!raidCandidate) {
        if (this.stopRequested) break;
        console.warn(`\n========================================================================`);
        console.warn(`⚠️ [GoEngine] No eligible GO HL raid found within 10 minutes.`);
        console.warn(`⚠️ Currently Grand Order HL is not optimal for raid gold bar`);
        console.warn(`========================================================================\n`);
        break;
      }

      const prepStartTime = Date.now();

      const workflowResult = await this.executeRaidWorkflow(raidCandidate, {
        runNumber: totalCompleted + 1,
        targetScore,
        autoReplenishEp,
        logPath,
        dropLogger
      });

      if (workflowResult.hitPendingLimit) {
        console.log('[GoEngine] ⚠️ Pending battle limit modal encountered! Claiming pending battles now...');
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      totalCompleted++;
      joinedInCurrentBatch++;

      // 7. Check if batch threshold is reached
      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`\n[GoEngine] Batch threshold reached (${joinedInCurrentBatch}/${currentBatchThreshold} raids). Checking pending battles...`);
        const claimStartTime = Date.now();
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        const claimElapsedSec = ((Date.now() - claimStartTime) / 1000).toFixed(1);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        console.log(`[GoEngine] Next pending check scheduled after ${currentBatchThreshold} raids (claim took ${claimElapsedSec}s).`);
      } else {
        console.log(`[GoEngine] Pending battle check skipped (${joinedInCurrentBatch}/${currentBatchThreshold} raids in batch). Returning to Finder...`);
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1200, 0.15);
      }

      const iterationElapsedSec = ((Date.now() - iterationStartTime) / 1000).toFixed(1);
      console.log(`[GoEngine] [Run ${totalCompleted}] Iteration concluded in ${iterationElapsedSec}s total.\n`);
    }

    // Claim any remaining pending battles upon session termination
    if (joinedInCurrentBatch > 0) {
      console.log(`\n[GoEngine] Session ended. Claiming final batch of ${joinedInCurrentBatch} pending battle(s)...`);
      const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
      totalGoldBars += gbFound;
    }

    console.log(`\n[GoEngine] Auto-farming session concluded. Returning to #mypage...`);
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
   * Scans #quest/assist (Finder tab, 2nd Slot / Grand Order HL) for raids matching:
   * - Priority 1: HP > 70% && players <= 3/18
   * - Priority 2: HP >= 50% && players <= 4/18
   * If none found, waits randomized 3s - 15s and refreshes.
   * Hard timeout: 10 minutes.
   */
  /**
   * Scans Slot 2 (GO HL) once on the Finder tab for an eligible raid.
   * Does NOT wait or refresh; returns the chosen candidate or null immediately.
   */
  public async scanSlotForCandidate(): Promise<RaidCandidate | null> {
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash !== '#quest/assist') {
      console.log('[GoEngine] Navigating to Backup Requests (#quest/assist)...');
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
        console.log('[GoEngine] Switching to Finder tab...');
        await humanizedClick(this.page, finderTab);
        await logNormalDelay(800, 0.15);
      }
    }

    // 2. Ensure 2nd slot (GO HL / Grand Order) is active
    const slot2 = await this.page.waitForSelector('.btn-search-switch.slot2, div[data-slot="2"]', { visible: true, timeout: 5000 }).catch(() => null);
    if (slot2) {
      const isSlot2Active = await this.page.evaluate((el: any) => el.classList.contains('active'), slot2);
      if (!isSlot2Active) {
        console.log('[GoEngine] Activating Grand Order HL (2nd Slot) filter...');
        await humanizedClick(this.page, slot2);
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
        const match = playerText.match(/(\d+)\s*\/\s*(?:18|30|\d+)/);
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

    console.log(`[GoEngine] Scanned ${candidates.length} Grand Order HL raids on screen.`);

    // Priority 1: HP >= 75% && players <= 3/18
    let priority = 0;
    let chosen: any = null;

    const prio1 = candidates.filter(c => c.hpPct >= 75 && c.players <= 3);
    if (prio1.length > 0) {
      prio1.sort((a, b) => b.hpPct - a.hpPct || a.players - b.players);
      chosen = prio1[0];
      priority = 1;
    } else {
      // Priority 2: HP >= 60% && players <= 3/18 (strictly >= 60% minimum)
      const prio2 = candidates.filter(c => c.hpPct >= 60 && c.players <= 3);
      if (prio2.length > 0) {
        prio2.sort((a, b) => b.hpPct - a.hpPct || a.players - b.players);
        chosen = prio2[0];
        priority = 2;
      }
    }

    if (chosen) {
      console.log(`[GoEngine] Selected raid: ID ${chosen.raidId} (HP: ${chosen.hpPct}%, Players: ${chosen.players}/18) [Priority ${priority} match]`);

      const cardElements = await this.page.$$('#prt-search-list .btn-multi-raid.lis-raid.search, .btn-multi-raid.lis-raid.search');
      const targetCard = cardElements[chosen.index];
      if (targetCard) {
        await humanReactionDelay(300, 0.20);
        await humanizedClick(this.page, targetCard);
        await randomDelay(800, 1200);

        if (await this.isPendingLimitReached()) {
          console.warn('[GoEngine] ⚠️ Pending battle limit popup detected on raid click. Dismissing...');
          const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
          if (okBtn) await humanizedClick(this.page, okBtn);
          return null;
        }

        return chosen;
      }
    }

    return null;
  }

  /**
   * Searches #quest/assist (Finder tab, 2nd Slot / Grand Order HL) for raids matching:
   * - Priority 1: HP > 70% && players <= 3/18
   * - Priority 2: HP >= 50% && players <= 4/18
   * If none found, waits randomized 3s - 15s and refreshes.
   */
  public async findAndSelectRaid(): Promise<RaidCandidate | null> {
    const searchStartTime = Date.now();
    const maxSearchDurationMs = 10 * 60 * 1000; // 10 minutes timeout

    while (!this.stopRequested) {
      await this.sentinel.assertSafe();

      // Check 10-minute timeout
      const elapsedSearchMs = Date.now() - searchStartTime;
      if (elapsedSearchMs >= maxSearchDurationMs) {
        console.warn('\n========================================================================');
        console.warn('⚠️ [GoEngine] No eligible GO HL raid found within 10 minutes.');
        console.warn('⚠️ Currently Grand Order HL is not optimal for raid gold bar.');
        console.warn('========================================================================\n');
        return null;
      }

      const candidate = await this.scanSlotForCandidate();
      if (candidate) return candidate;

      // If none found, wait random 3s - 15s and click refresh
      const waitMs = 3000 + Math.floor(Math.random() * 12001); // 3s - 15s randomized
      const remainingMin = Math.max(0, (maxSearchDurationMs - elapsedSearchMs) / 1000 / 60).toFixed(1);
      console.log(`[GoEngine] No eligible raids found. Waiting ${(waitMs / 1000).toFixed(1)}s before refresh... (${remainingMin}m remaining)`);
      await randomDelay(waitMs, waitMs + 200);

      if (this.stopRequested) break;

      const refreshBtn = await this.page.$('.btn-search-refresh');
      if (refreshBtn) {
        console.log('[GoEngine] Clicking search refresh button...');
        await humanReactionDelay(280, 0.22);
        await humanizedClick(this.page, refreshBtn);
        await randomDelay(1000, 1400);
      } else {
        await this.page.evaluate(() => location.reload());
        await randomDelay(1800, 2400);
      }
    }

    return null;
  }

  /**
   * Executes the full GO HL workflow (Supporter summon -> Party confirm -> Combat rotation -> Drop log)
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
      targetScore = 1480000,
      autoReplenishEp = true,
      logPath = 'logs/gb-go.md',
      dropLogger = new DropLogger(path.resolve(logPath), 'Grand Order HL (GO HL)')
    } = options;

    const prepStartTime = Date.now();
    this.setupResponseListener();

    // 1. Supporter Selection
    console.log(`[GoEngine] [Run ${runNumber}] Selecting supporter summon by priority...`);
    const suppSelected = await this.selectSupporterByPriority();
    if (!suppSelected) {
      const hitPendingLimit = await this.isPendingLimitReached();
      if (hitPendingLimit) {
        console.log('[GoEngine] ⚠️ Supporter selection blocked by pending battle limit modal!');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, hitPendingLimit: true };
      }
      console.warn(`[GoEngine] [Run ${runNumber}] Could not select supporter (raid already ended/cleared). Returning to Finder...`);
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1200, 0.15);
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, raidEndedEarly: true };
    }
    await this.sentinel.assertSafe();

    // 2. Party confirmation / Quest Start
    console.log(`[GoEngine] [Run ${runNumber}] Confirming party and starting quest...`);
    const questStarted = await this.confirmPartyAndStartQuest(autoReplenishEp);
    if (!questStarted) {
      console.warn(`[GoEngine] [Run ${runNumber}] Failed to start quest (raid already ended/cleared or pending limit).`);
      const hitPendingLimit = await this.isPendingLimitReached();
      if (hitPendingLimit) {
        console.log('[GoEngine] ⚠️ Pending battle limit modal detected!');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, hitPendingLimit: true };
      }
      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1200, 0.15);
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, raidEndedEarly: true };
    }

    // 3. Wait for Combat Stage Ready
    const combatReady = await this.waitForCombatReady();
    if (!combatReady) {
      console.log(`[GoEngine] [Run ${runNumber}] Raid ended or cleared before entering combat.`);
      const { stats } = dropLogger.logBattle({
        raidId: raidCandidate?.raidId || 'UNKNOWN',
        turns: 0,
        honors: 0,
        targetMet: false,
        hasGoldBar: false
      });
      console.log(`[GoEngine] [Run ${runNumber}] Logged to ${logPath} | Total: ${stats.totalBattles} battles | Gold Bars: ${stats.goldBars} (${stats.battlesWithoutGb} battles without Gold Bar, dry streak: ${stats.currentDryStreak})`);
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - prepStartTime, goldBarFound: false, raidEndedEarly: true };
    }
    await this.sentinel.assertSafe();

    const prepElapsedSec = ((Date.now() - prepStartTime) / 1000).toFixed(1);
    console.log(`[GoEngine] Combat stage ready (prep took ${prepElapsedSec}s)`);

    // 4. Strict Combat Rotation
    this.currentScore = 0;
    this.attackResolved = false;
    this.summonResolved = false;

    let combatResult: GoCombatResult;
    const combatStartTime = Date.now();

    try {
      combatResult = await this.executeGoCombatRotation(targetScore, combatStartTime);
    } catch (err: any) {
      console.warn(`[GoEngine] Combat exception caught: ${err.message}. Verifying raid status...`);
      const ended = await this.checkIfRaidEnded();
      combatResult = {
        status: ended ? 'SUCCESS' : 'FAILED',
        finalScore: this.currentScore,
        turnsElapsed: 0,
        durationMs: Date.now() - combatStartTime,
        message: err.message
      };
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
    console.log(`[GoEngine] [Run ${runNumber}] Logged to ${logPath} | Total: ${stats.totalBattles} battles | Gold Bars: ${stats.goldBars} (${stats.battlesWithoutGb} battles without Gold Bar, dry streak: ${stats.currentDryStreak})`);

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

  /**
   * Navigates to #quest/assist/unclaimed/0/0 and ensures no pending battles remain.
   * If a Gold Bar drops (item id 20004 / "Gold Bar" / "ヒヒイロカネ"), logs it to logPath.
   * After clearing all pending battles, returns cleanly to https://game.granbluefantasy.jp/#quest/assist.
   */
  public async claimPendingBattles(logPath = 'logs/gb-go.md', totalRuns = 0, dropLogger?: DropLogger): Promise<number> {
    console.log('[GoEngine] Ensuring no pending battles exist (#quest/assist/unclaimed/0/0)...');
    await this.checkIfRaidEnded();

    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1400, 0.15);
    await this.sentinel.assertSafe();

    let goldBarsFound = 0;
    let claimedCount = 0;
    const maxClaims = 15;

    while (claimedCount < maxClaims && !this.stopRequested) {
      await this.sentinel.assertSafe();

      // Check if any pending battles are listed
      const hasNoPending = await this.page.evaluate(() => {
        const bodyText = document.body.innerText || '';
        return (
          bodyText.includes("There aren't any pending battles") ||
          bodyText.includes("There aren't any pending battles now") ||
          bodyText.includes('未確認バトルはありません') ||
          bodyText.includes('No pending battles')
        );
      });

      if (hasNoPending) {
        console.log(`[GoEngine] No pending battles found. Total claimed: ${claimedCount}.`);
        break;
      }

      // Robust GBF selector for pending battle cards
      const pendingCard = await this.page.$(
        '.cnt-quest-unclaimed .prt-raid-list .btn-multi-raid, div[data-href*="result_multi"], .lis-raid[data-raid-id], .cnt-quest-unclaimed .btn-multi-raid'
      );

      if (!pendingCard) {
        console.log(`[GoEngine] No clickable pending battles remain. Finished claiming (${claimedCount} claimed).`);
        break;
      }

      const raidId = await this.page.evaluate((el: any) => el.dataset?.raidId || el.dataset?.href || '', pendingCard).catch(() => '');
      claimedCount++;
      console.log(`[GoEngine] Claiming pending battle #${claimedCount} (${raidId || 'ID pending'})...`);
      await humanReactionDelay(300, 0.22);
      await humanizedClick(this.page, pendingCard);

      // Wait for result screen (#result_multi or #result)
      await this.page.waitForFunction(() => {
        const url = window.location.hash;
        const isResult = url.includes('result') || !!document.querySelector('.pop-raid-result, .prt-result-head');
        return isResult;
      }, { timeout: 15000 }).catch(() => null);

      await randomDelay(1200, 1600);

      // Inspect drops for Gold Bar
      const dropCheck = await this.inspectForGoldBar();
      if (dropCheck.hasGoldBar) {
        goldBarsFound++;
        console.log('\n\x07\x07\x07');
        console.log('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟');
        console.log('🎉🎉🎉 GOLD BAR DROPPED IN GRAND ORDER HL! 🎉🎉🎉');
        console.log('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟\n');

        let proofScreenshotPath: string | undefined;
        let screenshotBuf: Buffer | undefined;
        try {
          const capDir = path.resolve(process.cwd(), 'artifacts/captures');
          if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
          proofScreenshotPath = path.resolve(capDir, `gold-bar-${dropCheck.raidId || 'go'}-${Date.now()}.png`);

          // Dismiss & hide modals, scroll loot into view
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
            const hideSelectors = ['.pop-usual', '#pop', '.prt-popup-header', '.prt-popup-body', '.prt-popup-footer', '.mask', '.pop-show'];
            hideSelectors.forEach(sel => {
              document.querySelectorAll(sel).forEach(el => { (el as HTMLElement).style.display = 'none'; });
            });
            const loot = document.querySelector('.prt-reward-item, .prt-item-list, [data-item-id="20004"], img[src*="20004"], .prt-module') as HTMLElement;
            if (loot) loot.scrollIntoView({ behavior: 'instant', block: 'center' });
          }).catch(() => null);

          screenshotBuf = (await this.page.screenshot({ path: proofScreenshotPath, type: 'png' })) as Buffer;
          console.log(`[GoEngine] 📸 Captured Gold Bar proof screenshot: ${proofScreenshotPath}`);
        } catch (e: any) {
          console.warn('[GoEngine] Could not capture proof screenshot:', e.message);
        }

        if (dropLogger) {
          dropLogger.recordPendingGoldBar(dropCheck.raidId || 'GO-HL', proofScreenshotPath);
          await dropLogger.notifyGoldBarDrop({
            raidId: dropCheck.raidId || 'GO-HL',
            honors: '-',
            turns: '-',
            screenshotBuffer: screenshotBuf,
            screenshotPath: proofScreenshotPath,
          });
        } else {
          await this.appendGoldBarLog(logPath, {
            timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
            raidId: dropCheck.raidId || 'GO-HL',
            turns: '-',
            honors: '-',
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

    console.log(`[GoEngine] Finished ensuring no pending battles (claimed ${claimedCount}). Returning to Backup Requests (https://game.granbluefantasy.jp/#quest/assist)...`);
    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1500, 0.15);

    return goldBarsFound;
  }

  /**
   * Inspects result DOM and response payload for Gold Bar (item id 20004 / "Gold Bar" / "ヒヒイロカネ").
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

        return {
          hasGoldBar: hasText || hasImg,
          raidId: raidIdMatch ? raidIdMatch[1] : ''
        };
      });

      if (this.latestRewardData) {
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

  /**
   * Appends an entry to logs/gb-go.md.
   */
  private async appendGoldBarLog(logPath: string, entry: { timestamp: string; raidId: string; turns: string; honors: string; totalRuns: number }): Promise<void> {
    try {
      const line = `| ${entry.timestamp} | ${entry.raidId} | ${entry.turns} | ${entry.honors} | 🌟 YES! GOLD BAR! 🌟 | Run #${entry.totalRuns} |\n`;
      await fs.promises.appendFile(logPath, line, 'utf-8');
      console.log(`[GoEngine] Logged Gold Bar drop to ${logPath}`);
    } catch (e: any) {
      console.error(`[GoEngine] Failed to write to log file:`, e.message);
    }
  }

  /**
   * Single raid join & combat method.
   */
  public async runGo(options: GoJoinOptions): Promise<GoCombatResult> {
    const {
      raidTarget,
      targetScore = 1480000,
      autoReplenishEp = true
    } = options;

    const startTime = Date.now();
    this.currentScore = 0;
    this.attackResolved = false;

    console.log(`\n=====================================================`);
    console.log(`[GoEngine] Starting Grand Order HL single routine`);
    console.log(`[GoEngine] Target: ${raidTarget}`);
    console.log(`[GoEngine] Honor Threshold: ${targetScore.toLocaleString()} pt`);
    console.log(`=====================================================`);

    await this.sentinel.assertSafe();

    this.setupResponseListener();

    const joinStatus = await this.navigateOrJoin(raidTarget, autoReplenishEp);
    if (joinStatus !== 'JOIN_OK') {
      return {
        status: joinStatus as GoCombatResult['status'],
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - startTime,
        message: `Failed to join raid: ${joinStatus}`
      };
    }

    console.log('[GoEngine] Selecting supporter summon according to priority...');
    const suppSelected = await this.selectSupporterByPriority();
    if (!suppSelected) {
      throw new Error('[GoEngine] Could not select any supporter summon.');
    }
    await this.sentinel.assertSafe();

    console.log('[GoEngine] Waiting for Quest Start OK button...');
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

    console.log('[GoEngine] Entering combat stage, waiting for HUD...');
    const combatReady = await this.waitForCombatReady();
    if (!combatReady) {
      console.log('[GoEngine] Raid ended or room full before entering combat.');
      return {
        status: 'RAID_EXPIRED',
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - startTime,
        message: 'Raid expired or room filled before combat could begin.'
      };
    }

    await this.sentinel.assertSafe();
    console.log('[GoEngine] HUD confirmed active. Executing GO HL combat rotation...');

    const combatResult = await this.executeGoCombatRotation(targetScore, startTime);

    console.log(`\n[GoEngine] Routine finished: ${combatResult.status}`);
    console.log(`[GoEngine] Final Honors: ${combatResult.finalScore.toLocaleString()} pt in ${combatResult.turnsElapsed} turns`);
    console.log(`[GoEngine] Total Time: ${(combatResult.durationMs / 1000).toFixed(1)}s\n`);

    return combatResult;
  }

  /**
   * Navigates to direct supporter_raid URL or enters raid ID on #quest/assist.
   */
  private async navigateOrJoin(raidTarget: string, autoReplenishEp: boolean): Promise<string> {
    if (raidTarget.startsWith('http') || raidTarget.includes('#quest/supporter_raid')) {
      const hash = raidTarget.includes('#') ? raidTarget.slice(raidTarget.indexOf('#')) : raidTarget;
      console.log(`[GoEngine] Navigating directly to supporter raid URL: ${hash}`);
      await this.page.evaluate((h) => { window.location.hash = h; }, hash);
    } else {
      console.log(`[GoEngine] Joining raid via code: ${raidTarget}`);
      await this.page.evaluate(() => { window.location.hash = '#quest/assist'; });
      await this.sentinel.assertSafe();

      const enterIdTab = await this.page.waitForSelector('.tab-enter-id, div[data-tab="enter_id"]', { visible: true, timeout: 8000 });
      if (!enterIdTab) throw new Error('Enter ID tab not found on #quest/assist');
      await humanizedClick(this.page, enterIdTab);
      await this.sentinel.assertSafe();

      const inputSelector = 'input.frm-raid-id';
      await humanizedClick(this.page, inputSelector);
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('A');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Backspace');
      await humanizedType(this.page, inputSelector, raidTarget.trim().toUpperCase());

      const submitBtn = await this.page.waitForSelector('.btn-post-key', { visible: true, timeout: 8000 });
      if (!submitBtn) throw new Error('Post key submit button not found');
      await humanizedClick(this.page, submitBtn);
    }

    await logNormalDelay(800, 0.15);
    await this.sentinel.assertSafe();

    return await this.checkJoinModals(autoReplenishEp);
  }

  private async checkJoinModals(autoReplenishEp: boolean): Promise<string> {
    const modal = await this.page.$('.pop-usual');
    if (modal) {
      const modalText = await this.page.evaluate((el: any) => el.innerText || '', modal);

      if (modalText.includes('pending') || modalText.includes('未確認')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return 'PENDING_LIMIT';
      }

      if (modalText.includes('ended') || modalText.includes('終了')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return 'RAID_EXPIRED';
      }

      if (modalText.includes('participants') || modalText.includes('参戦人数')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return 'ROOM_FULL';
      }

      const useItemBtn = await this.page.$('.pop-usual .btn-use-item');
      if (useItemBtn) {
        if (!autoReplenishEp) {
          const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel');
          if (cancelBtn) await humanizedClick(this.page, cancelBtn);
          return 'EP_DEFICIENT';
        }

        console.log('[GoEngine] EP depleted. Consuming Soul Berry...');
        await humanizedClick(this.page, useItemBtn);
        const confirmUse = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 6000 });
        if (confirmUse) {
          await humanizedClick(this.page, confirmUse);
          await this.sentinel.assertSafe();
        }
      }
    }

    return 'JOIN_OK';
  }

  /**
   * Supporter selection with user's priority:
   * 1. Lvl 250 Hades
   * 2. Lvl 250 Bahamut
   * 3. Lvl <= 250 Hades (210, 220, 230, 240, etc.)
   * 4. Fallback: First visible Dark supporter
   */
  private async selectSupporterByPriority(): Promise<boolean> {
    const suppStartTime = Date.now();
    await this.page.waitForFunction(() => {
      const supps = document.querySelectorAll('.btn-supporter, .lis-supporter');
      const hasSupp = Array.from(supps).some(s => (s as HTMLElement).offsetParent !== null);
      const modal = document.querySelector('.pop-usual');
      const isResult = window.location.hash.includes('result');
      return hasSupp || !!modal || isResult;
    }, { timeout: 15000 }).catch(() => null);

    if (await this.isPendingLimitReached()) {
      console.warn('[GoEngine] Supporter selection blocked by unclaimed pending battles limit modal.');
      return false;
    }

    if (await this.checkIfRaidEnded()) {
      console.warn('[GoEngine] Raid ended or cleared before supporter could be selected.');
      return false;
    }

    const darkTab = await this.page.$('.btn-supporter-element[data-element="6"]');
    if (darkTab) {
      const isSelected = await this.page.evaluate((el: any) => el.classList.contains('selected') || el.classList.contains('on'), darkTab);
      if (!isSelected) {
        console.log('[GoEngine] Switching to Dark element supporter tab (element 6)...');
        await humanizedClick(this.page, darkTab);
        await logNormalDelay(600, 0.15);
      }
    }

    const suppEvaluation = await this.page.evaluate(() => {
      const list = Array.from(document.querySelectorAll('.prt-supporter-list:not([style*="none"]) .btn-supporter, .lis-supporter')).filter(
        el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).getBoundingClientRect().height > 0
      );

      const items = list.map((el, index) => {
        const text = (el as HTMLElement).innerText || '';
        return { index, text };
      });

      // Priority 1: Lvl 250 Hades
      const p1 = items.find(i => /Hades/i.test(i.text) && /250/.test(i.text));
      if (p1) return { index: p1.index, tier: 'Lvl 250 Hades', text: p1.text };

      // Priority 2: Lvl 250 Bahamut
      const p2 = items.find(i => /Bahamut/i.test(i.text) && /250/.test(i.text));
      if (p2) return { index: p2.index, tier: 'Lvl 250 Bahamut', text: p2.text };

      // Priority 3: Lvl <= 250 Hades (e.g. 210, 220, 230, 240, etc.)
      const p3 = items.find(i => /Hades/i.test(i.text));
      if (p3) return { index: p3.index, tier: 'Lvl <= 250 Hades', text: p3.text };

      // Fallback: First visible
      if (items.length > 0) {
        return { index: 0, tier: 'Fallback First Available', text: items[0].text };
      }

      return null;
    });

    if (!suppEvaluation) {
      if (await this.isPendingLimitReached()) {
        console.warn('[GoEngine] Supporter selection blocked by unclaimed pending battles limit modal.');
        return false;
      }
      if (await this.checkIfRaidEnded()) return false;
      console.warn('[GoEngine] No supporter summon elements visible in DOM.');
      return false;
    }

    const suppElapsedSec = ((Date.now() - suppStartTime) / 1000).toFixed(1);
    console.log(`[GoEngine] Selected supporter [${suppEvaluation.tier}] (took ${suppElapsedSec}s)`);

    const allSupps = await this.page.$$('.prt-supporter-list:not([style*="none"]) .btn-supporter, .lis-supporter');
    const visibleElements: any[] = [];
    for (const s of allSupps) {
      const vis = await this.page.evaluate((el: any) => el.offsetParent !== null && el.getBoundingClientRect().height > 0, s);
      if (vis) visibleElements.push(s);
    }

    const targetEl = visibleElements[suppEvaluation.index];
    if (!targetEl) {
      throw new Error(`[GoEngine] Target supporter element at index ${suppEvaluation.index} could not be resolved.`);
    }

    await humanReactionDelay(350, 0.22);
    await humanizedClick(this.page, targetEl);
    await randomDelay(700, 1100);
    return true;
  }

  /**
   * Confirms party and clicks Quest Start / OK.
   */
  private async confirmPartyAndStartQuest(autoReplenishEp: boolean): Promise<boolean> {
    await this.page.waitForFunction(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      const modal = document.querySelector('.pop-usual');
      const isResult = window.location.hash.includes('result');
      return (ok && ok.offsetParent !== null) || !!modal || isResult;
    }, { timeout: 15000 }).catch(() => null);

    if (await this.checkIfRaidEnded()) {
      console.warn('[GoEngine] Raid ended or cleared on party confirmation screen.');
      return false;
    }

    const joinStatus = await this.checkJoinModals(autoReplenishEp);
    if (joinStatus !== 'JOIN_OK') {
      console.warn(`[GoEngine] Join modal returned: ${joinStatus}`);
      return false;
    }

    const startBtn = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok', { visible: true, timeout: 8000 }).catch(() => null);
    if (!startBtn) {
      if (await this.checkIfRaidEnded()) return false;
      console.warn('[GoEngine] Quest Start button not found.');
      return false;
    }

    console.log('[GoEngine] Clicking Quest Start OK button...');
    await humanReactionDelay(320, 0.22);
    await humanizedClick(this.page, startBtn);
    return true;
  }

  /**
   * Waits for Combat HUD to become active, or detects raid expiration / room full popups.
   */
  private async waitForCombatReady(): Promise<boolean> {
    await this.page.waitForFunction(() => {
      const hasAtk = !!document.querySelector('.btn-attack-start');
      const hasQs = !!document.querySelector('.btn-quick-summon');
      const hasChara = !!document.querySelector('.lis-character0.btn-command-character, .prt-command-chara .lis-character0');
      const isResult = window.location.hash.includes('result');
      const modal = document.querySelector('.pop-usual');
      return hasAtk || hasQs || hasChara || isResult || !!modal;
    }, { timeout: 25000 });

    // 1. Check if navigated directly to result screen (raid died before entering)
    const currentHash = await this.page.evaluate(() => window.location.hash);
    if (currentHash.includes('result')) {
      console.warn('[GoEngine] Raid ended or cleared before combat could begin (navigated to result screen).');
      const okBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close, .btn-control.location-href');
      if (okBtn) await humanizedClick(this.page, okBtn);
      return false;
    }

    // 2. Check modal popups (raid ended / room full / pending limit)
    const modal = await this.page.$('.pop-usual');
    if (modal) {
      const modalText = await this.page.evaluate((el: any) => el.innerText || '', modal);
      if (modalText.includes('ended') || modalText.includes('終了')) {
        console.warn('[GoEngine] Raid has already ended.');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return false;
      }
      if (modalText.includes('participants') || modalText.includes('参戦人数')) {
        console.warn('[GoEngine] Maximum participants reached.');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return false;
      }
      if (modalText.includes('pending') || modalText.includes('未確認')) {
        console.warn('[GoEngine] Unclaimed pending battles limit reached.');
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return false;
      }
    }

    // 3. Confirm combat controls are actually present
    const hasCombatHud = await this.page.evaluate(() => {
      return !!document.querySelector('.btn-attack-start, .btn-attack, .btn-quick-summon, .lis-character0.btn-command-character, .prt-command-chara');
    });

    if (!hasCombatHud) {
      console.warn('[GoEngine] Combat HUD not detected. Raid likely concluded.');
      return false;
    }

    await randomDelay(600, 1000);
    return true;
  }

  /**
   * Combat Action 1: Quick Call
   */
  private async executeQuickCall(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[GoEngine] [Action 1/5] Executing Quick Call...');
    const qsBtn = await this.page.waitForSelector('.btn-quick-summon.qs-ready, .btn-quick-summon', { visible: true, timeout: 6000 }).catch(() => null);
    if (qsBtn) {
      await humanReactionDelay(280, 0.22);
      await humanizedClick(this.page, qsBtn, { allowMultiClick: true, multiClickChance: 0.40 });
      console.log('[GoEngine] Quick Summon triggered.');
      await randomDelay(1200, 1600);
    } else {
      console.warn('[GoEngine] Quick Summon button not ready or not available. Continuing...');
    }
  }

  /**
   * Combat Action 2: Char #4 (Nier) Skill 1, then Skill 2 (select Char #2 / Ilsa in popup)
   */
  private async executeChar4Skills(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[GoEngine] [Action 2/5] Char #4 (Nier) -> Skill 1, Skill 2 (target Char #2)...');

    const char4 = await this.page.waitForSelector('.lis-character3', { visible: true, timeout: 6000 }).catch(() => null);
    if (!char4) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Char #4 portrait not found.');
      return;
    }

    await humanReactionDelay(260, 0.22);
    await humanizedClick(this.page, char4, { allowMultiClick: true, multiClickChance: 0.30 });
    await randomDelay(450, 750);

    console.log('[GoEngine] Using Char #4 Skill 1...');
    let s1 = await this.page.waitForSelector('.ability-character-num-4-1', { visible: true, timeout: 4000 }).catch(() => null);
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.log('[GoEngine] Char #4 ability tray not yet visible, re-clicking portrait...');
      await humanizedClick(this.page, char4);
      s1 = await this.page.waitForSelector('.ability-character-num-4-1', { visible: true, timeout: 4000 }).catch(() => null);
    }
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Char #4 Skill 1 not found (raid may have ended).');
      return;
    }
    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, s1, { allowMultiClick: true, multiClickChance: 0.45 });
    await randomDelay(450, 650);

    if (await this.checkIfRaidEnded()) return;

    console.log('[GoEngine] Using Char #4 Skill 2...');
    let s2 = await this.page.waitForSelector('.ability-character-num-4-2', { visible: true, timeout: 4000 }).catch(() => null);
    if (!s2) {
      if (await this.checkIfRaidEnded()) return;
      await humanizedClick(this.page, char4);
      s2 = await this.page.waitForSelector('.ability-character-num-4-2', { visible: true, timeout: 4000 }).catch(() => null);
    }
    if (!s2) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Char #4 Skill 2 not found.');
      return;
    }
    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, s2, { allowMultiClick: true, multiClickChance: 0.45 });

    console.log('[GoEngine] Waiting for target selection popup...');
    await this.page.waitForFunction(() => {
      const popupChara = document.querySelector('.pop-usual .lis-character1.btn-command-character, .lis-character1.btn-command-character.front-member, .prt-popup-body .lis-character1');
      const isRes = window.location.hash.includes('result');
      const modal = document.querySelector('.pop-usual');
      return !!popupChara || isRes || !!modal;
    }, { timeout: 8000 }).catch(() => null);

    if (await this.checkIfRaidEnded()) return;

    await humanReactionDelay(180, 0.18);

    console.log('[GoEngine] Selecting Char #2 (Yukata Ilsa) in popup...');
    const targetChar2 = await this.page.waitForSelector(
      '.pop-usual .lis-character1.btn-command-character, .lis-character1.btn-command-character.front-member, .prt-popup-body .lis-character1.btn-command-character',
      { visible: true, timeout: 6000 }
    ).catch(() => null);
    if (!targetChar2) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Char #2 target card in popup not found.');
      return;
    }
    await humanizedClick(this.page, targetChar2, { allowMultiClick: true, multiClickChance: 0.35 });
    console.log('[GoEngine] Char #2 targeted successfully.');

    await randomDelay(400, 600);
  }

  /**
   * Combat Action 3: Summon Menu -> Click #3 (Death) -> Instant F5 Reload
   */
  private async executeDeathSummon(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[GoEngine] [Action 3/5] Calling Summon #3 (Death) with instant F5 animation skip...');

    // Wait for skill animation/popup to clear
    await randomDelay(250, 400);

    // 1. Close any open ability tray if present
    const backBtn = await this.page.$('.btn-command-back.display-on');
    if (backBtn) {
      await humanizedClick(this.page, backBtn);
      await randomDelay(200, 350);
    }

    // 2. Click Summon Menu button (.btn-command-summon)
    let summonCmd = await this.page.waitForSelector('.btn-command-summon', { visible: true, timeout: 6000 }).catch(() => null);
    if (!summonCmd) {
      // Re-try closing ability tray in case back button was transitioning
      await this.page.evaluate(() => {
        const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
        if (back && back.offsetParent !== null) back.click();
      }).catch(() => null);
      await randomDelay(250, 450);
      summonCmd = await this.page.waitForSelector('.btn-command-summon', { visible: true, timeout: 4000 }).catch(() => null);
    }

    if (!summonCmd) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Summon menu button not found.');
      return;
    }
    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, summonCmd, { allowMultiClick: true, multiClickChance: 0.35 });

    // 3. Wait for summon #3 (Death) to appear
    console.log('[GoEngine] Clicking Summon #3 (Death)...');
    const deathSummon = await this.page.waitForSelector(
      '.lis-summon[pos="3"], #canv-summon-pos-3, .lis-summon.summon-3, div[pos="3"].lis-summon',
      { visible: true, timeout: 5000 }
    ).catch(() => null);

    if (!deathSummon) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Death summon (pos 3) not found.');
      return;
    }

    // Reset summonResolved tracker before invocation
    this.summonResolved = false;

    // 4. Click Death summon card directly (invokes summon in one-click mode)
    await humanReactionDelay(180, 0.18);
    await humanizedClick(this.page, deathSummon, { allowMultiClick: true, multiClickChance: 0.40 });

    // 5. Brief check: if confirmation modal appears (for accounts with summon confirmation enabled), click OK
    const callBtn = await this.page.waitForSelector(
      '.btn-usual-ok.btn-summon-use, .btn-summon-use, .pop-usual .btn-usual-ok, .se-summon-call',
      { visible: true, timeout: 300 }
    ).catch(() => null);

    if (callBtn) {
      console.log('[GoEngine] Confirming Call button for Death...');
      await humanizedClick(this.page, callBtn);
    }

    // 6. Wait briefly for summon network dispatch (max 300ms)
    await this.waitForSummonResolution(300);

    // 7. Instant F5 Reload to skip Death summon animation & Nier -> Bowman sacrifice delay!
    console.log('[GoEngine] Fast F5 reloading to skip Death summon animation...');
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
    console.log('[GoEngine] Death summon called & animation skipped via F5.');
  }

  /**
   * Combat Action 4: Char #2 (Yukata Ilsa) Skill 1
   */
  private async executeChar2Skill1(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    console.log('[GoEngine] [Action 4/5] Char #2 (Yukata Ilsa) -> Skill 1...');

    const backBtn = await this.page.$('.btn-command-back.display-on');
    if (backBtn) {
      await humanizedClick(this.page, backBtn);
      await randomDelay(200, 350);
    }

    const char2 = await this.page.waitForSelector('.lis-character1', { visible: true, timeout: 6000 }).catch(() => null);
    if (!char2) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Char #2 portrait not found.');
      return;
    }

    await humanReactionDelay(220, 0.18);
    await humanizedClick(this.page, char2, { allowMultiClick: true, multiClickChance: 0.35 });
    await randomDelay(350, 550);

    const s1 = await this.page.waitForSelector('.ability-character-num-2-1', { visible: true, timeout: 5000 }).catch(() => null);
    if (!s1) {
      if (await this.checkIfRaidEnded()) return;
      console.warn('[GoEngine] Char #2 Skill 1 not found.');
      return;
    }

    console.log('[GoEngine] Using Char #2 Skill 1 (Midnight Ray)...');
    await humanReactionDelay(200, 0.18);
    await humanizedClick(this.page, s1, { allowMultiClick: true, multiClickChance: 0.45 });
    await randomDelay(500, 750);

    // Close ability tray cleanly
    await this.page.evaluate(() => {
      const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
      if (back && back.offsetParent !== null) back.click();
    }).catch(() => null);
    await randomDelay(150, 300);
  }

  /**
   * Optional Bonus Action: Char #3 (Lich) Skill 1
   */
  private async executeChar3BonusSkill(): Promise<void> {
    if (await this.checkIfRaidEnded()) return;

    try {
      const char3 = await this.page.$('.lis-character2');
      if (!char3) return;

      await humanReactionDelay(260, 0.22);
      await humanizedClick(this.page, char3, { allowMultiClick: true, multiClickChance: 0.35 });
      await randomDelay(450, 700);

      const s1 = await this.page.waitForSelector('.ability-character-num-3-1', { visible: true, timeout: 5000 }).catch(() => null);
      if (s1) {
        console.log('[GoEngine] Activated Char #3 Skill 1 (Gate of Demons)...');
        await humanizedClick(this.page, s1, { allowMultiClick: true, multiClickChance: 0.50 });
        await randomDelay(1050, 1450);
      }

      await this.page.evaluate(() => {
        const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
        if (back && back.offsetParent !== null) back.click();
      }).catch(() => null);
      await randomDelay(250, 400);
    } catch (e: any) {
      console.warn(`[GoEngine] Char #3 bonus skill omitted: ${e.message}`);
    }
  }

  /**
   * Combat Action 5: Attack Loop until score >= targetScore (1,480,000 pt)
   */
  private async executeAttackUntilScore(targetScore: number, startTime: number): Promise<GoCombatResult> {
    console.log(`\n-----------------------------------------------------`);
    console.log(`[GoEngine] [Action 5/5] Attack phase until score >= ${targetScore.toLocaleString()} pt...`);
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
        console.log(`[GoEngine] Raid ended or cleared with score: ${this.currentScore.toLocaleString()} pt (attack phase took ${totalBattleSec}s).`);
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

      // 3. If target score is reached, stop immediately!
      if (attackCommandsIssued >= 1 && this.currentScore >= targetScore) {
        const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const inGameTurn = await this.getInGameTurn();
        console.log(`\n🎉 [GoEngine] Blue chest target reached! (${this.currentScore.toLocaleString()} >= ${targetScore.toLocaleString()} pt on In-Game Turn ${inGameTurn}, attack phase took ${totalBattleSec}s)`);
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
          console.log(`[GoEngine] Raid ended or cleared with score: ${this.currentScore.toLocaleString()} pt (attack phase took ${totalBattleSec}s).`);
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
        console.log(`[GoEngine] [In-Game Turn ${currentTurn}] Combat HUD not ready (attempt ${stalledHudCount}/2)...`);

        if (stalledHudCount >= 2) {
          const isEnded = await this.checkIfRaidEnded();
          if (isEnded || this.currentScore >= targetScore * 0.90 || stalledHudCount >= 3) {
            console.log(`[GoEngine] Combat HUD remained inactive (${stalledHudCount} attempts, raid ended: ${isEnded}). Concluding battle...`);
            const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
            return {
              status: 'SUCCESS',
              finalScore: this.currentScore,
              turnsElapsed: attackCommandsIssued,
              durationMs: Date.now() - startTime,
              message: `Raid concluded with final honors of ${this.currentScore.toLocaleString()} pt.`
            };
          }
        }

        console.log(`[GoEngine] Combat HUD unresponsive or turn processing. Fast F5 reloading to sync state...`);
        await this.page.evaluate(() => location.reload()).catch(() => null);
        await this.waitForCombatReady();
        continue;
      }

      stalledHudCount = 0;

      // Close back tray if open
      await this.page.evaluate(() => {
        const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
        if (back && back.offsetParent !== null) back.click();
      }).catch(() => null);

      // Locate Attack button
      const atkBtn = await this.page.waitForSelector('.btn-attack-start.display-on, .btn-attack-start', { visible: true, timeout: 6000 }).catch(() => null);
      if (!atkBtn) {
        if (await this.checkIfRaidEnded()) {
          const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[GoEngine] Raid ended with score: ${this.currentScore.toLocaleString()} pt (attack phase took ${totalBattleSec}s).`);
          return {
            status: 'SUCCESS',
            finalScore: this.currentScore,
            turnsElapsed: attackCommandsIssued,
            durationMs: Date.now() - startTime,
            message: `Raid ended with score: ${this.currentScore.toLocaleString()} pt.`
          };
        }
        await randomDelay(300, 500);
        continue;
      }

      // 5. Execute Honest In-Game Turn
      const turnBeforeAttack = await this.getInGameTurn();
      attackCommandsIssued++;
      this.attackResolved = false;

      const actionStartMs = Date.now();
      console.log(`[GoEngine] [In-Game Turn ${turnBeforeAttack}] Clicking Attack... (Current Score: ${this.currentScore.toLocaleString()} pt)`);
      await humanReactionDelay(250, 0.20);
      await humanizedClick(this.page, atkBtn, { allowMultiClick: true, multiClickChance: 0.40 });

      // 6. Fast F5 reload to skip combat attack animation
      const attackDispatched = await this.waitForAttackResolution(1800);
      const preReloadMs = Date.now() - actionStartMs;

      if (attackDispatched) {
        console.log(`[GoEngine] Normal attack dispatched (${preReloadMs}ms). Fast F5 reloading to skip attack animation...`);
      } else {
        console.log(`[GoEngine] Attack command issued (${preReloadMs}ms). Fast F5 reloading to process turn...`);
      }

      await this.page.evaluate(() => location.reload()).catch(() => null);

      // Wait for page reload to restore HUD or show result screen
      await this.page.waitForFunction(() => {
        const hasAtk = !!document.querySelector('.btn-attack-start') || !!document.querySelector('.btn-attack');
        const hasChara = !!document.querySelector('.lis-character0') || !!document.querySelector('.prt-command-chara');
        const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
        const isEnd =
          document.body.innerText.includes('ended') ||
          document.body.innerText.includes('終了') ||
          document.body.innerText.includes('concluded');
        return (hasAtk && hasChara) || isRes || isEnd;
      }, { timeout: 12000 }).catch(() => null);

      await randomDelay(350, 600);

      // Check ground-truth honors updated after reload
      const postReloadHonors = await this.fetchCurrentScore();
      if (postReloadHonors > this.currentScore) {
        this.currentScore = postReloadHonors;
      }

      const turnAfterAttack = await this.getInGameTurn();
      const actionElapsedSec = ((Date.now() - actionStartMs) / 1000).toFixed(1);
      const totalAttackPhaseSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = Math.min(100, (this.currentScore / targetScore) * 100).toFixed(1);

      console.log(
        `[GoEngine] [In-Game Turn ${turnAfterAttack}] Turn resolved in ${actionElapsedSec}s (Attack phase: ${totalAttackPhaseSec}s) | Honors: ${this.currentScore.toLocaleString()} / ${targetScore.toLocaleString()} pt (${pct}%)`
      );

      // Check if target reached after attack
      if (this.currentScore >= targetScore) {
        const totalBattleSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n🎉 [GoEngine] Blue chest target reached! (${this.currentScore.toLocaleString()} >= ${targetScore.toLocaleString()} pt on In-Game Turn ${turnAfterAttack}, attack phase took ${totalBattleSec}s)`);
        return {
          status: 'TARGET_SCORE_REACHED',
          finalScore: this.currentScore,
          turnsElapsed: attackCommandsIssued,
          durationMs: Date.now() - startTime,
          message: `Target honor score reached: ${this.currentScore.toLocaleString()} pt.`
        };
      }
    }

    return {
      status: this.currentScore >= targetScore ? 'TARGET_SCORE_REACHED' : 'SUCCESS',
      finalScore: this.currentScore,
      turnsElapsed: attackCommandsIssued,
      durationMs: Date.now() - startTime,
      message: 'Attack phase concluded.'
    };
  }

  /**
   * Orchestrates the complete Grand Order HL rotation:
   * 1. Quick Call
   * 2. Char #4 (Nier) Skill 1, Skill 2 (on Char #2 / Ilsa)
   * 3. Summon #3 (Death) -> instant F5 animation skip
   * 4. Char #2 (Yukata Ilsa) Skill 1 (Midnight Ray)
   * 5. Optional Bonus: Char #3 (Lich) Skill 1
   * 6. Attack phase until honors >= 1,480,000 pt
   */
  private async executeGoCombatRotation(targetScore: number, startTime: number): Promise<GoCombatResult> {
    this.isCombatActive = true;
    try {
      const rotationStartMs = Date.now();

      // 1. Quick Call
      await this.executeQuickCall();
      if (await this.checkIfRaidEnded()) {
        return this.concludeRaidEarly('Quick Call', startTime);
      }

      // 2. Char #4 (Nier) S1, S2 -> Char #2 (Yukata Ilsa)
      await this.executeChar4Skills();
      if (await this.checkIfRaidEnded()) {
        return this.concludeRaidEarly('Char #4 Skills', startTime);
      }

      // 3. Summon #3 (Death) -> instant F5 skip
      await this.executeDeathSummon();
      if (await this.checkIfRaidEnded()) {
        return this.concludeRaidEarly('Death Summon', startTime);
      }

      // 4. Char #2 (Yukata Ilsa) Skill 1
      await this.executeChar2Skill1();
      if (await this.checkIfRaidEnded()) {
        return this.concludeRaidEarly('Char #2 Skill 1', startTime);
      }

      const rotationElapsedSec = ((Date.now() - rotationStartMs) / 1000).toFixed(1);
      console.log(`[GoEngine] Quick Call -> Nier S1, S2 (on Ilsa) -> Death Summon -> Ilsa S1 (took ${rotationElapsedSec}s)`);

      // 5. Attack Loop until targetScore
      return await this.executeAttackUntilScore(targetScore, startTime);
    } finally {
      this.isCombatActive = false;
    }
  }

  private concludeRaidEarly(phaseName: string, startTime: number): GoCombatResult {
    console.log(`[GoEngine] Raid ended or cleared during ${phaseName}.`);
    return {
      status: 'SUCCESS',
      finalScore: this.currentScore,
      turnsElapsed: 0,
      durationMs: Date.now() - startTime,
      message: `Raid concluded early during ${phaseName}.`
    };
  }

  /**
   * Evaluates if combat HUD is genuinely interactable (no lock, no pending animations).
   */
  private async waitForCombatInputReady(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !this.stopRequested) {
      const isReady = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          const s = stage.gGameStatus;
          if (s.lock === true || s.animation === true) return false;
        }

        const atkBtn = document.querySelector('.btn-attack-start.display-on, .btn-attack-start') as HTMLElement;
        if (atkBtn && atkBtn.offsetParent !== null) {
          const rect = atkBtn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return true;
        }

        const qsBtn = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
        if (qsBtn && qsBtn.offsetParent !== null) return true;

        return false;
      }).catch(() => false);

      if (isReady) return true;
      await new Promise(r => setTimeout(r, 150));
    }
    return false;
  }

  /**
   * Retrieves ground-truth in-game turn number directly from the GBF battle engine.
   */
  private async getInGameTurn(): Promise<number> {
    try {
      return await this.page.evaluate(() => {
        const stage = (window as any).stage;
        if (stage?.gGameStatus?.turn !== undefined) {
          return Number(stage.gGameStatus.turn);
        }
        if (stage?.pJsnData?.turn !== undefined) {
          return Number(stage.pJsnData.turn);
        }
        const turnEl = document.querySelector('.prt-turn-info .txt-turn-num, .prt-turn-number, .txt-turn-num');
        if (turnEl) {
          const parsed = parseInt((turnEl as HTMLElement).innerText || '', 10);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        return 1;
      });
    } catch {
      return 1;
    }
  }

  /**
   * Fetches ground-truth honors from GBF page context.
   */
  private async fetchCurrentScore(): Promise<number> {
    try {
      const scoreFromPage = await this.page.evaluate(() => {
        const stage = (window as any).stage;

        // 1. In stage.pJsnData.user_point (from /start.json or /raid_battle.json)
        if (stage?.pJsnData?.user_point !== undefined) {
          const pt = Number(stage.pJsnData.user_point);
          if (!isNaN(pt) && pt > 0) return pt;
        }

        // 2. In stage.gGameStatus.user_point
        if (stage?.gGameStatus?.user_point !== undefined) {
          const pt = Number(stage.gGameStatus.user_point);
          if (!isNaN(pt) && pt > 0) return pt;
        }

        // 3. In stage.pJsnData.point
        if (stage?.pJsnData?.point !== undefined) {
          const pt = Number(stage.pJsnData.point);
          if (!isNaN(pt) && pt > 0) return pt;
        }

        // 4. In raid DOM elements
        const pointEl = document.querySelector('.txt-user-point, .prt-user-point, .txt-point, .prt-point, .prt-point-info .txt-point');
        if (pointEl) {
          const parsed = parseInt((pointEl as HTMLElement).innerText?.replace(/[^0-9]/g, '') || '', 10);
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }

        // 5. Look for any element displaying honors / points (e.g. "... pt")
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
        console.log(`[GoEngine] Raid concluded detected (${raidState.reason}).`);
        // Dismiss any modal OK button
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

  /**
   * Sets up network response interceptor for honor and attack tracking.
   */
  public setupResponseListener(): void {
    if (this.responseListenerInitialized) return;
    this.responseListenerInitialized = true;
    this.page.on('response', async (res: HTTPResponse) => {
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

              // Update ground truth score from payload
              if (data.user_point !== undefined && typeof data.user_point === 'number') {
                this.currentScore = Math.max(this.currentScore, data.user_point);
              }
              if (data.point !== undefined && typeof data.point === 'number') {
                this.currentScore = Math.max(this.currentScore, data.point);
              }

              // Turn resolution from normal_attack_result.json
              if (url.includes('normal_attack_result.json')) {
                const directPoint =
                  (typeof data.status?.user_point === 'number' && data.status.user_point > 0 ? data.status.user_point : null) ??
                  (typeof data.user_point === 'number' && data.user_point > 0 ? data.user_point : null) ??
                  (typeof data.point_info?.user_point === 'number' && data.point_info.user_point > 0 ? data.point_info.user_point : null);

                if (directPoint !== null) {
                  this.currentScore = directPoint;
                  console.log(`[GoEngine] Ground-truth server honors: ${this.currentScore.toLocaleString()} pt`);
                } else if (data.scenario && Array.isArray(data.scenario)) {
                  const turnDamage = this.calculateScenarioDamage(data);
                  if (turnDamage > 0) {
                    const estimatedHonorsFromTurn = Math.floor(turnDamage / 1000);
                    this.currentScore += estimatedHonorsFromTurn;
                    console.log(
                      `[GoEngine] Attack resolved. Turn Dmg: ${turnDamage.toLocaleString()} (~${estimatedHonorsFromTurn.toLocaleString()} pt) | Total Honors: ${this.currentScore.toLocaleString()} pt`
                    );
                  }
                }
              }
            }
          }
        }
      } catch {
        // Silent failure for non-JSON payloads
      }
    });
  }

  private calculateScenarioDamage(data: any): number {
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
}

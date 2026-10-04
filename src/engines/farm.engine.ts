/**
 * @file farm.engine.ts
 * @description Master Gold Bar multi-raid farming orchestrator for Granblue Fantasy.
 * 
 * Rotates dynamically across all three Gold Bar raids:
 * - Proto Bahamut HL (PBHL / Tsuyo Baha) - Slot 4
 * - Akasha HL - Slot 3
 * - Grand Order HL (GO HL) - Slot 2
 * 
 * ### Key Architectural Principles:
 * 1. **Randomized Multi-Slot Rotation**:
 *    - In each search cycle, check order across PBHL, Akasha, and GO is randomized using Fisher-Yates shuffle.
 *    - If Slot A has no candidate, checks Slot B immediately without waiting or refreshing.
 *    - If Slot B has no candidate, checks Slot C.
 *    - Only if all 3 slots have no eligible raids does it pause (randomized 2.5s - 5.0s), click refresh, and repeat.
 * 
 * 2. **Domain-Specific Execution Hand-off**:
 *    - When an eligible raid is found in any slot, hands off execution to the matching engine
 *      (PbhlEngine, AkashaEngine, or GoEngine) with exact combat rotations and honor thresholds:
 *        - PBHL: 1,480,000 pt (Light supporter priority)
 *        - Akasha: 1,560,000 pt (Dark supporter priority)
 *        - GO: 1,480,000 pt (Dark supporter priority)
 * 
 * 3. **Isolated Drop Rate & Dry Streak Accounting**:
 *    - Accurately tracks drop and non-drop battle telemetry into each raid's designated log:
 *        - logs/gb-pbhl.md
 *        - logs/gb-akasha.md
 *        - logs/gb-go.md
 *    - Gold Bars from pending battle claims are attributed to the exact raid that generated them.
 * 
 * 4. **Randomized Batch Pending Battle Claims**:
 *    - Batches unclaimed battle claims every 3 to 5 raids, strictly capping below GBF's 5-battle hard limit.
 *    - Detects pending battle limit modals instantly and recovers.
 * 
 * @see {@link file:///c:/laragon/www/gbf/src/engines/pbhl.engine.ts}
 * @see {@link file:///c:/laragon/www/gbf/src/engines/akasha.engine.ts}
 * @see {@link file:///c:/laragon/www/gbf/src/engines/go.engine.ts}
 */

import { Page, HTTPResponse } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, randomDelay, logNormalDelay, humanReactionDelay } from '../human-motor.js';
import { PbhlEngine } from './pbhl.engine.js';
import { AkashaEngine } from './akasha.engine.js';
import { GoEngine } from './go.engine.js';
import { DropLogger, RaidCandidate, RaidWorkflowResult } from './drop-logger.js';

export type FarmRaidType = 'PBHL' | 'AKASHA' | 'GO';

export interface FarmOptions {
  /** Total combined runs across all raids (default: Infinity) */
  runs?: number;
  autoReplenishEp?: boolean;
  minBatchClaim?: number; // Default: 3
  maxBatchClaim?: number; // Default: 5
  batchClaimSize?: number; // Fixed override if provided
  pbhlTargetScore?: number; // Default: 1,480,000 pt
  akashaTargetScore?: number; // Default: 1,560,000 pt
  goTargetScore?: number; // Default: 1,480,000 pt
  pbhlLogPath?: string; // Default: 'logs/gb-pbhl.md'
  akashaLogPath?: string; // Default: 'logs/gb-akasha.md'
  goLogPath?: string; // Default: 'logs/gb-go.md'
}

export interface FarmRaidStats {
  runs: number;
  goldBars: number;
  dryStreak: number;
  battlesWithoutGb: number;
  dropRatePct: string;
}

export interface FarmSummary {
  totalRunsAttempted: number;
  totalRunsCompleted: number;
  totalGoldBars: number;
  durationMs: number;
  raidBreakdown: {
    PBHL: FarmRaidStats;
    AKASHA: FarmRaidStats;
    GO: FarmRaidStats;
  };
}

export class FarmEngine {
  private pbhlEngine: PbhlEngine;
  private akashaEngine: AkashaEngine;
  private goEngine: GoEngine;
  private pbhlLogger: DropLogger;
  private akashaLogger: DropLogger;
  private goLogger: DropLogger;
  private stopRequested = false;
  private recentRaidMap = new Map<string, FarmRaidType>();
  private latestClaimRewardData: any = null;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {
    this.pbhlEngine = new PbhlEngine(page, sentinel);
    this.akashaEngine = new AkashaEngine(page, sentinel);
    this.goEngine = new GoEngine(page, sentinel);

    this.pbhlLogger = new DropLogger(path.resolve('logs/gb-pbhl.md'), 'Proto Bahamut HL (PBHL)');
    this.akashaLogger = new DropLogger(path.resolve('logs/gb-akasha.md'), 'Akasha HL');
    this.goLogger = new DropLogger(path.resolve('logs/gb-go.md'), 'Grand Order HL (GO HL)');
  }

  public requestStop(): void {
    this.stopRequested = true;
    this.pbhlEngine.requestStop();
    this.akashaEngine.requestStop();
    this.goEngine.requestStop();
  }

  /**
   * Shuffles an array randomly using Fisher-Yates algorithm.
   */
  private shuffleArray<T>(array: T[]): T[] {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /**
   * Main multi-raid rotator loop.
   */
  public async runFarmLoop(options: FarmOptions = {}): Promise<FarmSummary> {
    const {
      runs = Infinity,
      autoReplenishEp = true,
      minBatchClaim = 3,
      maxBatchClaim = 5,
      batchClaimSize,
      pbhlTargetScore = 1480000,
      akashaTargetScore = 1560000,
      goTargetScore = 1480000,
      pbhlLogPath = 'logs/gb-pbhl.md',
      akashaLogPath = 'logs/gb-akasha.md',
      goLogPath = 'logs/gb-go.md'
    } = options;

    // Refresh loggers with provided paths if different
    this.pbhlLogger = new DropLogger(path.resolve(pbhlLogPath), 'Proto Bahamut HL (PBHL)');
    this.akashaLogger = new DropLogger(path.resolve(akashaLogPath), 'Akasha HL');
    this.goLogger = new DropLogger(path.resolve(goLogPath), 'Grand Order HL (GO HL)');

    const startTime = Date.now();
    let totalCompleted = 0;
    let joinedInCurrentBatch = 0;
    let totalGoldBars = 0;
    this.stopRequested = false;

    const completedCounts: Record<FarmRaidType, number> = {
      PBHL: 0,
      AKASHA: 0,
      GO: 0
    };

    const getNextBatchThreshold = (): number => {
      if (batchClaimSize && batchClaimSize > 0) return Math.min(3, Math.max(1, batchClaimSize));
      const min = Math.max(1, Math.min(minBatchClaim, 3));
      const max = Math.max(min, Math.min(maxBatchClaim, 3));
      return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    let currentBatchThreshold = getNextBatchThreshold();

    const pbhlInit = this.pbhlLogger.getStats();
    const akashaInit = this.akashaLogger.getStats();
    const goInit = this.goLogger.getStats();

    console.log(`\n========================================================================`);
    console.log(`         Granblue Fantasy - Gold Bar Multi-Raid Rotator (gb-farm)        `);
    console.log(`========================================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Target Honor Scores:  PBHL: ${pbhlTargetScore.toLocaleString()} pt | Akasha: ${akashaTargetScore.toLocaleString()} pt | GO: ${goTargetScore.toLocaleString()} pt`);
    console.log(`Pending Claim Batch:  Randomized 3 - 5 raids (first batch: ${currentBatchThreshold})`);
    console.log(`------------------------------------------------------------------------`);
    console.log(`Historical Log Telemetry:`);
    console.log(`  - PBHL:   ${pbhlInit.totalBattles} battles | ${pbhlInit.blueChests} Blue (${pbhlInit.blueChestRatePct}) | ${pbhlInit.goldBars} GB (Dry streak: ${pbhlInit.currentDryStreak} ${pbhlInit.dryStreakMode === 'blue_chest' ? 'blue chests' : 'battles'}, rate: ${pbhlInit.dropRatePct})`);
    console.log(`  - Akasha: ${akashaInit.totalBattles} battles | ${akashaInit.blueChests} Blue (${akashaInit.blueChestRatePct}) | ${akashaInit.goldBars} GB (Dry streak: ${akashaInit.currentDryStreak} ${akashaInit.dryStreakMode === 'blue_chest' ? 'blue chests' : 'battles'}, rate: ${akashaInit.dropRatePct})`);
    console.log(`  - GO HL:  ${goInit.totalBattles} battles | ${goInit.blueChests} Blue (${goInit.blueChestRatePct}) | ${goInit.goldBars} GB (Dry streak: ${goInit.currentDryStreak} ${goInit.dryStreakMode === 'blue_chest' ? 'blue chests' : 'battles'}, rate: ${goInit.dropRatePct})`);
    console.log(`========================================================================\n`);

    this.setupClaimResponseListener();

    // Initial safety check: clear pre-existing pending battles so we don't start near the 5-limit cap
    console.log('[FarmEngine] Checking for pre-existing pending battles before starting session...');
    const initialGb = await this.claimPendingBattles(0);
    totalGoldBars += initialGb;

    while (totalCompleted < runs && !this.stopRequested) {
      // 1. Safety check: if pending battles reached batch threshold, claim before searching
      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`\n[FarmEngine] Batch threshold of ${currentBatchThreshold} reached (${joinedInCurrentBatch} joined). Claiming pending battles...`);
        const gbFound = await this.claimPendingBattles(totalCompleted);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        console.log(`[FarmEngine] Next pending check scheduled in ${currentBatchThreshold} raids.`);
      }

      if (this.stopRequested) break;

      const runNumber = totalCompleted + 1;
      const iterationStartTime = Date.now();

      console.log(`\n------------------------------------------------------------------------`);
      console.log(`[FarmEngine] [Run ${runNumber}] Searching across raids (PBHL / Akasha / GO)...`);
      console.log(`------------------------------------------------------------------------`);

      // 2. Randomized multi-slot search loop
      let selectedCandidate: RaidCandidate | null = null;
      let selectedRaidType: FarmRaidType | null = null;
      const searchStartTime = Date.now();
      const maxSearchDurationMs = 15 * 60 * 1000; // 15 minutes timeout

      while (!this.stopRequested && !selectedCandidate) {
        await this.sentinel.assertSafe();

        if (Date.now() - searchStartTime >= maxSearchDurationMs) {
          console.warn('\n⚠️ [FarmEngine] No eligible raid found across any slot within 15 minutes. Pausing.');
          break;
        }

        // Check if pending limit modal popped up
        if (await this.isPendingLimitReached()) {
          console.log('[FarmEngine] ⚠️ Pending battle limit modal detected during search! Claiming now...');
          const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
          if (okBtn) await humanizedClick(this.page, okBtn);
          const gbFound = await this.claimPendingBattles(totalCompleted);
          totalGoldBars += gbFound;
          joinedInCurrentBatch = 0;
          currentBatchThreshold = getNextBatchThreshold();
          continue;
        }

        // Randomize check order for this search pass
        const checkOrder: FarmRaidType[] = this.shuffleArray(['PBHL', 'AKASHA', 'GO']);
        console.log(`[FarmEngine] Checking slots in randomized order: [ ${checkOrder.join(' -> ')} ]`);

        for (const raidType of checkOrder) {
          if (this.stopRequested) break;

          let candidate: RaidCandidate | null = null;
          try {
            if (raidType === 'PBHL') {
              candidate = await this.pbhlEngine.scanSlotForCandidate();
            } else if (raidType === 'AKASHA') {
              candidate = await this.akashaEngine.scanSlotForCandidate();
            } else if (raidType === 'GO') {
              candidate = await this.goEngine.scanSlotForCandidate();
            }
          } catch (scanErr: any) {
            console.warn(`[FarmEngine] Notice during ${raidType} scan: ${scanErr.message}`);
          }

          // Check if pending limit modal appeared on click
          if (await this.isPendingLimitReached()) {
            console.log('[FarmEngine] ⚠️ Pending battle limit modal detected! Claiming pending battles now...');
            const okBtn = await this.page.$('.pop-usual .btn-usual-ok, #pop .btn-usual-ok');
            if (okBtn) await humanizedClick(this.page, okBtn);
            const gbFound = await this.claimPendingBattles(totalCompleted);
            totalGoldBars += gbFound;
            joinedInCurrentBatch = 0;
            currentBatchThreshold = getNextBatchThreshold();
            candidate = null;
            break; // Restart check cycle after claiming
          }

          if (candidate) {
            selectedCandidate = candidate;
            selectedRaidType = raidType;
            console.log(`🎯 [FarmEngine] Eligible raid acquired: ${raidType} (ID: ${candidate.raidId}, HP: ${candidate.hpPct}%, Players: ${candidate.players})`);
            break; // Found candidate! Stop checking other slots
          }

          // Small natural pause between checking slots
          await randomDelay(400, 750);
        }

        if (this.stopRequested) break;

        // If none of the 3 slots had an eligible raid, pause & click refresh
        if (!selectedCandidate) {
          const waitMs = 2500 + Math.floor(Math.random() * 2501); // 2.5s - 5.0s
          console.log(`[FarmEngine] No eligible raids across all 3 slots. Waiting ${(waitMs / 1000).toFixed(1)}s before search refresh...`);
          await randomDelay(waitMs, waitMs + 200);

          if (this.stopRequested) break;

          const refreshBtn = await this.page.$('.btn-search-refresh');
          if (refreshBtn) {
            await humanReactionDelay(280, 0.20);
            await humanizedClick(this.page, refreshBtn);
            await randomDelay(1000, 1400);
          } else {
            await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
            await logNormalDelay(1800, 0.15);
          }
        }
      }

      if (!selectedCandidate || !selectedRaidType) {
        if (this.stopRequested) break;
        console.warn('[FarmEngine] Search cycle yielded no candidate. Ending session.');
        break;
      }

      // Record candidate in recent raid map for pending attribution
      this.recentRaidMap.set(selectedCandidate.raidId, selectedRaidType);

      // 3. Dispatch to matching raid workflow
      console.log(`\n🚀 [FarmEngine] [Run ${runNumber}] Dispatching workflow to ${selectedRaidType} engine...`);
      let workflowResult: RaidWorkflowResult;

      if (selectedRaidType === 'PBHL') {
        workflowResult = await this.pbhlEngine.executeRaidWorkflow(selectedCandidate, {
          runNumber,
          targetScore: pbhlTargetScore,
          autoReplenishEp,
          logPath: pbhlLogPath,
          dropLogger: this.pbhlLogger
        });
      } else if (selectedRaidType === 'AKASHA') {
        workflowResult = await this.akashaEngine.executeRaidWorkflow(selectedCandidate, {
          runNumber,
          targetScore: akashaTargetScore,
          autoReplenishEp,
          logPath: akashaLogPath,
          dropLogger: this.akashaLogger
        });
      } else {
        workflowResult = await this.goEngine.executeRaidWorkflow(selectedCandidate, {
          runNumber,
          targetScore: goTargetScore,
          autoReplenishEp,
          logPath: goLogPath,
          dropLogger: this.goLogger
        });
      }

      // Check if pending limit modal blocked join
      if (workflowResult.hitPendingLimit) {
        console.log('[FarmEngine] ⚠️ Pending battle limit modal hit during workflow! Claiming pending battles now...');
        const gbFound = await this.claimPendingBattles(totalCompleted);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      totalCompleted++;
      completedCounts[selectedRaidType]++;
      joinedInCurrentBatch++;

      // 4. Batch pending battle claims check
      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`[FarmEngine] Batch threshold reached (${joinedInCurrentBatch}/${currentBatchThreshold} raids). Checking pending battles...`);
        const claimStartTime = Date.now();
        const gbFound = await this.claimPendingBattles(totalCompleted);
        const claimElapsedSec = ((Date.now() - claimStartTime) / 1000).toFixed(1);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        console.log(`[FarmEngine] Next pending check scheduled after ${currentBatchThreshold} raids (claim took ${claimElapsedSec}s).`);
      } else {
        console.log(`[FarmEngine] Pending check skipped (${joinedInCurrentBatch}/${currentBatchThreshold} in batch). Returning to Finder...`);
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1200, 0.15);
      }

      const iterationElapsedSec = ((Date.now() - iterationStartTime) / 1000).toFixed(1);
      console.log(`[FarmEngine] [Run ${totalCompleted}] Iteration concluded in ${iterationElapsedSec}s total. (PBHL: ${completedCounts.PBHL} | Akasha: ${completedCounts.AKASHA} | GO: ${completedCounts.GO})\n`);
    }

    // Final claim of any remaining pending battles
    if (joinedInCurrentBatch > 0) {
      console.log(`\n[FarmEngine] Session ended. Claiming final batch of ${joinedInCurrentBatch} pending battle(s)...`);
      const gbFound = await this.claimPendingBattles(totalCompleted);
      totalGoldBars += gbFound;
    }

    console.log(`\n[FarmEngine] Farming session concluded. Returning to #mypage...`);
    await this.page.evaluate(() => { window.location.hash = '#mypage'; }).catch(() => null);

    const pbhlFinal = this.pbhlLogger.getStats();
    const akashaFinal = this.akashaLogger.getStats();
    const goFinal = this.goLogger.getStats();

    return {
      totalRunsAttempted: totalCompleted,
      totalRunsCompleted: totalCompleted,
      totalGoldBars,
      durationMs: Date.now() - startTime,
      raidBreakdown: {
        PBHL: {
          runs: completedCounts.PBHL,
          goldBars: pbhlFinal.goldBars,
          dryStreak: pbhlFinal.currentDryStreak,
          battlesWithoutGb: pbhlFinal.battlesWithoutGb,
          dropRatePct: pbhlFinal.dropRatePct
        },
        AKASHA: {
          runs: completedCounts.AKASHA,
          goldBars: akashaFinal.goldBars,
          dryStreak: akashaFinal.currentDryStreak,
          battlesWithoutGb: akashaFinal.battlesWithoutGb,
          dropRatePct: akashaFinal.dropRatePct
        },
        GO: {
          runs: completedCounts.GO,
          goldBars: goFinal.goldBars,
          dryStreak: goFinal.currentDryStreak,
          battlesWithoutGb: goFinal.battlesWithoutGb,
          dropRatePct: goFinal.dropRatePct
        }
      }
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
   * If a Gold Bar drops, attributes it to the matching raid's DropLogger.
   */
  public async claimPendingBattles(totalRuns = 0): Promise<number> {
    console.log('[FarmEngine] Ensuring no pending battles exist (#quest/assist/unclaimed/0/0)...');

    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1400, 0.15);
    await this.sentinel.assertSafe();

    let goldBarsFound = 0;
    let claimedCount = 0;
    const maxClaims = 15;

    while (claimedCount < maxClaims && !this.stopRequested) {
      await this.sentinel.assertSafe();

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
        console.log(`[FarmEngine] No pending battles found. Total claimed: ${claimedCount}.`);
        break;
      }

      const pendingCard = await this.page.$(
        '.cnt-quest-unclaimed .prt-raid-list .btn-multi-raid, div[data-href*="result_multi"], .lis-raid[data-raid-id], .cnt-quest-unclaimed .btn-multi-raid'
      );

      if (!pendingCard) {
        console.log(`[FarmEngine] No clickable pending battles remain. Finished claiming (${claimedCount} claimed).`);
        break;
      }

      const raidInfo = await this.page.evaluate((el: any) => {
        const raidId = el.dataset?.raidId || el.dataset?.href || '';
        const text = el.innerText || '';
        return { raidId, text };
      }, pendingCard).catch(() => ({ raidId: '', text: '' }));

      claimedCount++;
      console.log(`[FarmEngine] Claiming pending battle #${claimedCount} (${raidInfo.raidId || 'ID pending'})...`);
      await humanReactionDelay(300, 0.22);
      await humanizedClick(this.page, pendingCard);

      // Wait for result screen
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
        const resolvedRaidId = dropCheck.raidId || raidInfo.raidId || 'UNKNOWN';

        // Identify raid type by map or text
        let attributedType: FarmRaidType = 'PBHL';
        if (this.recentRaidMap.has(resolvedRaidId)) {
          attributedType = this.recentRaidMap.get(resolvedRaidId)!;
        } else {
          const lowerText = (raidInfo.text + ' ' + dropCheck.pageText).toLowerCase();
          if (lowerText.includes('akasha') || lowerText.includes('アーカーシャ') || lowerText.includes('303251')) {
            attributedType = 'AKASHA';
          } else if (lowerText.includes('grande') || lowerText.includes('grand order') || lowerText.includes('グランデ') || lowerText.includes('301071')) {
            attributedType = 'GO';
          } else {
            attributedType = 'PBHL';
          }
        }

        console.log('\n\x07\x07\x07');
        console.log('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟');
        console.log(`🎉🎉🎉 GOLD BAR DROPPED IN ${attributedType}! 🎉🎉🎉`);
        console.log('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟\n');

        // Record in matching logger
        if (attributedType === 'PBHL') {
          this.pbhlLogger.recordPendingGoldBar(resolvedRaidId);
        } else if (attributedType === 'AKASHA') {
          this.akashaLogger.recordPendingGoldBar(resolvedRaidId);
        } else {
          this.goLogger.recordPendingGoldBar(resolvedRaidId);
        }
      }

      // Dismiss result screen
      const closeBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close, .btn-usual-ok, .btn-control.location-href');
      if (closeBtn) {
        await humanReactionDelay(250, 0.20);
        await humanizedClick(this.page, closeBtn);
        await randomDelay(400, 700);
      }

      await this.page.goto('https://game.granbluefantasy.jp/#quest/assist/unclaimed/0/0', { waitUntil: 'domcontentloaded' });
      await randomDelay(1200, 1500);
    }

    console.log(`[FarmEngine] Finished ensuring no pending battles (claimed ${claimedCount}). Returning to Backup Requests (#quest/assist)...`);
    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1500, 0.15);

    return goldBarsFound;
  }

  private async inspectForGoldBar(): Promise<{ hasGoldBar: boolean; raidId: string; pageText: string }> {
    try {
      const dropInfo = await this.page.evaluate(() => {
        const text = document.body.innerText || '';
        const hasText = text.includes('Gold Bar') || text.includes('Gold Brick') || text.includes('ヒヒイロカネ');
        const hasImg = !!document.querySelector('img[src*="20004"], [data-item-name*="Gold Bar"], [data-item-name*="Gold Brick"], [alt*="Gold Bar"], [alt*="Gold Brick"], [alt*="ヒヒイロカネ"], [data-item-id="20004"]');
        const raidIdMatch = window.location.hash.match(/result(?:_multi)?\/(\d+)/);

        return {
          hasGoldBar: hasText || hasImg,
          raidId: raidIdMatch ? raidIdMatch[1] : '',
          pageText: text
        };
      });

      if (!dropInfo.hasGoldBar && this.latestClaimRewardData) {
        const rewardStr = JSON.stringify(this.latestClaimRewardData);
        if (rewardStr.includes('20004') || rewardStr.includes('Gold Bar') || rewardStr.includes('Gold Brick') || rewardStr.includes('ヒヒイロカネ')) {
          dropInfo.hasGoldBar = true;
        }
      }

      return dropInfo;
    } catch {
      return { hasGoldBar: false, raidId: '', pageText: '' };
    }
  }

  private setupClaimResponseListener(): void {
    this.page.on('response', async (res: HTTPResponse) => {
      try {
        const url = res.url();
        if (url.includes('reward.json') || url.includes('result.json')) {
          if (res.status() === 200) {
            const data = await res.json().catch(() => null);
            if (data) this.latestClaimRewardData = data;
          }
        }
      } catch {
        // Ignore network telemetry errors
      }
    });
  }
}

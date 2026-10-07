// src/engines/gold-bar-hunter.engine.ts
import { Page, HTTPResponse } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, logNormalDelay, humanReactionDelay } from '../human-motor.js';
import { DropLogger, RaidCandidate, RaidWorkflowResult } from './drop-logger.js';
import { discordPresence } from '../relay/discord-presence.js';
import {
  GoldBarRaidDefinition,
  GoldBarCombatOutcome,
  GoldBarFarmingOptions,
  GoldBarFarmingSummary,
  GoldBarJoinOptions
} from '../domain/gold-bar/gold-bar.types.js';
import { IGoldBarHunterEngine } from '../domain/gold-bar/gold-bar.interfaces.js';
import { RecoveryModalService } from '../services/navigation/recovery-modal.service.js';
import { PendingBattleService } from '../services/navigation/pending-battle.service.js';
import { SupporterSelectionService } from '../services/navigation/supporter-selection.service.js';

/**
 * Unified Gold Bar Hunting Engine (SRP, OCP, DIP).
 *
 * Consolidates the common Gold Bar hunting lifecycle across Proto Bahamut HL,
 * Akasha, and Grand Order HL:
 * - Finder slot scanning with sweet-spot filtering
 * - Supporter summon selection with priority fallback
 * - Party confirmation & EP restoration
 * - Tactical dark burst combat rotation & fast F5 reload
 * - Dual-track honor tracking and early exit upon blue chest threshold
 * - Batch pending battle resolution with Gold Bar drop accounting
 */
export class GoldBarHunterEngine implements IGoldBarHunterEngine {
  protected currentScore = 0;
  protected attackResolved = false;
  protected summonResolved = false;
  protected stopRequested = false;
  protected latestRewardData: any = null;
  protected responseListenerInitialized = false;
  protected isCombatActive = false;

  protected recoveryService: RecoveryModalService;
  protected pendingService: PendingBattleService;
  protected supporterService: SupporterSelectionService;

  constructor(
    protected page: Page,
    protected sentinel: SentinelWatchdog = new SentinelWatchdog(page),
    public readonly raidDef: GoldBarRaidDefinition
  ) {
    this.recoveryService = new RecoveryModalService(page);
    this.pendingService = new PendingBattleService(page);
    this.supporterService = new SupporterSelectionService(page);
  }

  public updatePage(newPage: Page): void {
    this.page = newPage;
    this.sentinel.updatePage(newPage);
    this.recoveryService.updatePage(newPage);
    this.pendingService.updatePage(newPage);
    this.supporterService.updatePage(newPage);
    this.responseListenerInitialized = false;
    this.setupResponseListener();
  }

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Continuous farming loop for the configured Gold Bar raid.
   */
  public async runFarmingLoop(options: GoldBarFarmingOptions = {}): Promise<GoldBarFarmingSummary> {
    const runs = options.runs ?? Infinity;
    const targetScore = options.targetScore ?? this.raidDef.defaultTargetScore;
    const autoReplenishEp = options.autoReplenishEp ?? true;
    const minBatchClaim = options.minBatchClaim ?? 3;
    const maxBatchClaim = options.maxBatchClaim ?? 5;
    const batchClaimSize = options.batchClaimSize;
    const logPath = options.logPath ?? this.raidDef.defaultLogPath;

    const startTime = Date.now();
    let totalCompleted = 0;
    let joinedInCurrentBatch = 0;
    let totalGoldBars = 0;
    this.stopRequested = false;

    const getNextBatchThreshold = (): number => {
      if (batchClaimSize && batchClaimSize > 0) return Math.min(3, Math.max(1, batchClaimSize));
      const min = Math.max(1, Math.min(minBatchClaim, 3));
      const max = Math.max(min, Math.min(maxBatchClaim, 3));
      return Math.floor(Math.random() * (max - min + 1)) + min;
    };

    let currentBatchThreshold = getNextBatchThreshold();

    console.log(`\n=====================================================`);
    console.log(`  Granblue Fantasy - ${this.raidDef.name} Auto-Farming Loop `);
    console.log(`=====================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Honor Threshold:      ${targetScore.toLocaleString()} pt`);
    console.log(`Pending Claim Batch:  Randomized 3 - 5 raids (first batch: ${currentBatchThreshold})`);
    console.log(`Drop Log File:        ${logPath}`);
    console.log(`=====================================================\n`);

    const dropLogger = new DropLogger(logPath, `${this.raidDef.name} (${this.raidDef.shortName})`);
    const initialStats = dropLogger.getStats();
    console.log(`[${this.raidDef.shortName}Engine] Historical Log: ${initialStats.totalBattles} total battles, ${initialStats.blueChests} Blue Chests (${initialStats.blueChestRatePct}), ${initialStats.goldBars} Gold Bars (Dry streak: ${initialStats.currentDryStreak} battles)`);

    discordPresence.updateStatus({
      raidName: this.raidDef.shortName,
      runNumber: 1,
      totalRuns: runs === Infinity ? undefined : runs,
      goldBars: initialStats.goldBars,
      blueChests: initialStats.blueChests,
      dryStreak: initialStats.currentDryStreak,
      dryStreakMode: initialStats.dryStreakMode,
      status: 'Searching'
    }, true);

    this.setupResponseListener();

    console.log(`[${this.raidDef.shortName}Engine] Checking for pre-existing pending battles before starting session...`);
    const initialGb = await this.claimPendingBattles(logPath, 0, dropLogger);
    totalGoldBars += initialGb;

    while (totalCompleted < runs && !this.stopRequested) {
      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`\n[${this.raidDef.shortName}Engine] Batch threshold of ${currentBatchThreshold} reached (${joinedInCurrentBatch} joined). Claiming pending battles...`);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        console.log(`[${this.raidDef.shortName}Engine] Next pending check scheduled in ${currentBatchThreshold} raids.`);
      }

      if (this.stopRequested) break;

      const iterationStartTime = Date.now();
      discordPresence.updateStatus({
        raidName: this.raidDef.shortName,
        runNumber: totalCompleted + 1,
        totalRuns: runs === Infinity ? undefined : runs,
        status: 'Searching'
      });

      console.log(`\n-----------------------------------------------------`);
      console.log(`[${this.raidDef.shortName}Engine] [Run ${totalCompleted + 1}] Searching for eligible ${this.raidDef.shortName} raid...`);
      console.log(`-----------------------------------------------------`);

      this.sentinel?.setSessionContext?.({
        questName: this.raidDef.name,
        runNumber: totalCompleted + 1
      });

      let raidCandidate: RaidCandidate | null = null;
      try {
        raidCandidate = await this.findAndSelectRaid();
        if (raidCandidate?.raidId) {
          this.sentinel?.setSessionContext?.({ raidId: raidCandidate.raidId, hpPct: raidCandidate.hpPct });
        }
      } catch (err: any) {
        if (this.stopRequested) break;
        console.warn(`[${this.raidDef.shortName}Engine] Search warning: ${err.message}. Retrying in 4s...`);
        await logNormalDelay(4000, 0.1);
        continue;
      }

      if (await this.isPendingLimitReached()) {
        console.log(`[${this.raidDef.shortName}Engine] ⚠️ Pending battle limit modal detected! Claiming pending battles now...`);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      if (!raidCandidate) {
        if (this.stopRequested) break;
        console.warn(`\n[${this.raidDef.shortName}Engine] No eligible ${this.raidDef.shortName} raid found within window. Retrying...`);
        await logNormalDelay(3000, 0.15);
        continue;
      }

      const workflowResult = await this.executeRaidWorkflow(raidCandidate, {
        runNumber: totalCompleted + 1,
        targetScore,
        autoReplenishEp,
        logPath,
        dropLogger
      });

      if (workflowResult.hitPendingLimit) {
        console.log(`[${this.raidDef.shortName}Engine] ⚠️ Pending battle limit modal encountered! Claiming pending battles now...`);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
        continue;
      }

      totalCompleted++;
      joinedInCurrentBatch++;

      if (joinedInCurrentBatch >= currentBatchThreshold) {
        console.log(`[${this.raidDef.shortName}Engine] Batch threshold reached (${joinedInCurrentBatch}/${currentBatchThreshold} raids). Checking pending battles...`);
        const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
        totalGoldBars += gbFound;
        joinedInCurrentBatch = 0;
        currentBatchThreshold = getNextBatchThreshold();
      } else {
        console.log(`[${this.raidDef.shortName}Engine] Pending check skipped (${joinedInCurrentBatch}/${currentBatchThreshold} in batch). Returning to Finder...`);
        await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1200, 0.15);
      }

      const elapsedSec = ((Date.now() - iterationStartTime) / 1000).toFixed(1);
      console.log(`[${this.raidDef.shortName}Engine] [Run ${totalCompleted}] Iteration concluded in ${elapsedSec}s total.\n`);
    }

    if (joinedInCurrentBatch > 0) {
      console.log(`\n[${this.raidDef.shortName}Engine] Session ended. Claiming final batch of ${joinedInCurrentBatch} pending battle(s)...`);
      const gbFound = await this.claimPendingBattles(logPath, totalCompleted, dropLogger);
      totalGoldBars += gbFound;
    }

    console.log(`\n[${this.raidDef.shortName}Engine] Farming session concluded. Returning to #mypage...`);
    discordPresence.updateStatus({ status: 'Finished' }, true);
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
   * Directly joins and bursts a specific raid target by code or URL.
   */
  public async joinAndBurstRaid(options: GoldBarJoinOptions): Promise<GoldBarCombatOutcome> {
    const targetScore = options.targetScore ?? this.raidDef.defaultTargetScore;
    const autoReplenishEp = options.autoReplenishEp ?? true;
    const t0 = Date.now();

    this.setupResponseListener();
    await this.page.goto('https://game.granbluefantasy.jp/#quest/assist', { waitUntil: 'domcontentloaded' });
    await logNormalDelay(1200, 0.15);

    // Navigate to supporter or battle
    const supporterOutcome = await this.supporterService.selectSupporterSummon([...this.raidDef.supporterPriorities]);
    if (!supporterOutcome.selected) {
      return {
        status: 'JOIN_FAILED',
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - t0,
        message: 'Could not select supporter summon.'
      };
    }

    const questStarted = await this.confirmPartyAndStartQuest(autoReplenishEp);
    if (!questStarted) {
      return {
        status: 'JOIN_FAILED',
        finalScore: 0,
        turnsElapsed: 0,
        durationMs: Date.now() - t0,
        message: 'Could not start quest.'
      };
    }

    const combatOutcome = await this.executeCombatRotation(targetScore);
    return combatOutcome;
  }

  /**
   * Scans the assigned Finder slot once without waiting.
   */
  public async scanSlotForCandidate(): Promise<RaidCandidate | null> {
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash !== '#quest/assist') {
      await this.page.evaluate(() => { window.location.hash = '#quest/assist'; }).catch(() => null);
      await logNormalDelay(1400, 0.15);
    }
    await this.sentinel.assertSafe();

    // Ensure Finder tab is active
    await this.page.evaluate(() => {
      const tab = document.querySelector('#tab-search, .btn-tabs#tab-search') as HTMLElement;
      if (tab && !tab.classList.contains('active')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(tab).trigger('tap');
        tab.click();
      }
    }).catch(() => null);
    await logNormalDelay(600, 0.15);

    // Ensure target slot is active
    const slotClass = `.btn-search-switch.slot${this.raidDef.finderSlot}, div[data-slot="${this.raidDef.finderSlot}"]`;
    await this.page.evaluate((sel: string) => {
      const slot = document.querySelector(sel) as HTMLElement;
      if (slot && !slot.classList.contains('active')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(slot).trigger('tap');
        slot.click();
      }
    }, slotClass).catch(() => null);
    await logNormalDelay(600, 0.15);

    // Scan cards
    const candidates = await this.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#prt-search-list .btn-multi-raid.lis-raid.search, .btn-multi-raid.lis-raid.search'));
      return cards.map((card, index) => {
        const gaugeInner = card.querySelector('.prt-raid-gauge-inner') as HTMLElement;
        const hpPct = parseFloat(gaugeInner?.style?.width || '0%') || 0;
        const playerText = (card.querySelector('.prt-flees-in') as HTMLElement)?.innerText || '';
        const match = playerText.match(/(\d+)\s*\/\s*(\d+)/);
        const players = match ? parseInt(match[1], 10) : 99;
        const raidId = (card as HTMLElement).dataset.raidId || '';
        return { index, raidId, hpPct, players, isVisible: (card as HTMLElement).offsetParent !== null };
      });
    }).catch(() => []);

    const eligible = candidates.filter(c => c.isVisible && c.raidId);
    // Priority 1: sweet spot
    const p1 = eligible.find(c => c.hpPct > this.raidDef.sweetSpotMinHp && c.players <= this.raidDef.sweetSpotMaxPlayers);
    if (p1) return { raidId: p1.raidId, hpPct: p1.hpPct, players: p1.players };

    // Priority 2: backup sweet spot
    const p2 = eligible.find(c => c.hpPct >= this.raidDef.sweetSpotBackupMinHp && c.players <= this.raidDef.sweetSpotBackupMaxPlayers);
    if (p2) return { raidId: p2.raidId, hpPct: p2.hpPct, players: p2.players };

    return null;
  }

  /**
   * Executes the full raid workflow for an eligible candidate.
   */
  public async executeRaidWorkflow(
    raidCandidate: RaidCandidate | null,
    options: {
      runNumber: number;
      targetScore: number;
      autoReplenishEp: boolean;
      logPath: string;
      dropLogger: DropLogger;
    }
  ): Promise<RaidWorkflowResult> {
    const t0 = Date.now();
    const runNumber = options.runNumber;
    const targetScore = options.targetScore;
    const autoReplenishEp = options.autoReplenishEp;
    const logPath = options.logPath;
    const dropLogger = options.dropLogger;

    // 1. Select Supporter
    const supporterSelected = await this.supporterService.selectSupporterSummon([...this.raidDef.supporterPriorities]);
    if (!supporterSelected.selected) {
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - t0, goldBarFound: false };
    }

    // 2. Party Confirmation / Quest Start
    const questStarted = await this.confirmPartyAndStartQuest(autoReplenishEp);
    if (!questStarted) {
      if (await this.isPendingLimitReached()) {
        return { success: false, score: 0, turns: 0, durationMs: Date.now() - t0, goldBarFound: false, hitPendingLimit: true };
      }
      return { success: false, score: 0, turns: 0, durationMs: Date.now() - t0, goldBarFound: false, raidEndedEarly: true };
    }

    // 3. Combat
    const combatOutcome = await this.executeCombatRotation(targetScore);

    // 4. Log Battle
    const isTargetMet = combatOutcome.finalScore >= targetScore || combatOutcome.status === 'TARGET_SCORE_REACHED';
    const hasBlueChest = isTargetMet || combatOutcome.finalScore >= 1480000;
    const { stats } = dropLogger.logBattle({
      raidId: raidCandidate?.raidId || 'UNKNOWN',
      turns: combatOutcome.turnsElapsed || 1,
      honors: combatOutcome.finalScore,
      targetMet: isTargetMet,
      hasBlueChest,
      hasGoldBar: false
    });

    console.log(`[${this.raidDef.shortName}Engine] [Run ${runNumber}] Logged to ${logPath} | Total: ${stats.totalBattles} | Blue: ${stats.blueChests} | Gold: ${stats.goldBars} (Dry: ${stats.currentDryStreak})`);

    return {
      success: true,
      score: combatOutcome.finalScore,
      turns: combatOutcome.turnsElapsed || 1,
      durationMs: Date.now() - t0,
      goldBarFound: false
    };
  }

  /**
   * Standardized dark burst combat rotation.
   */
  protected async executeCombatRotation(targetScore: number): Promise<GoldBarCombatOutcome> {
    const t0 = Date.now();
    this.currentScore = 0;
    let turnsElapsed = 0;

    // Wait for combat HUD
    await this.waitForCombatReady();

    // Turn 1 Quick Call
    await this.executeQuickCall();

    // Nier S1 + S2 on Char 2
    await this.executeChar4Skills();

    // Death Summon (Summon #3)
    await this.executeDeathSummon();

    // Char 2 (Ilsa) S1
    await this.executeChar2Skill1();

    // Attack Loop until targetScore or boss dead
    while (!this.stopRequested && turnsElapsed < 10) {
      const state = await this.getCombatState();
      this.currentScore = Math.max(this.currentScore, state.honors);

      if (this.currentScore >= targetScore) {
        console.log(`[${this.raidDef.shortName}Engine] 🎯 Target score reached (${this.currentScore.toLocaleString()} pt)! Exiting combat...`);
        return {
          status: 'TARGET_SCORE_REACHED',
          finalScore: this.currentScore,
          turnsElapsed,
          durationMs: Date.now() - t0,
          message: 'Target score reached.'
        };
      }

      if (state.isVictory || state.bossHpPct <= 0) {
        console.log(`[${this.raidDef.shortName}Engine] 🏆 Boss defeated! Final Score: ${this.currentScore.toLocaleString()} pt`);
        return {
          status: 'SUCCESS',
          finalScore: this.currentScore,
          turnsElapsed,
          durationMs: Date.now() - t0,
          message: 'Boss defeated.'
        };
      }

      turnsElapsed++;
      // Dispatch attack
      await this.dispatchAttack();
      // Fast reload lockout bypass
      await this.page.evaluate(() => { window.location.reload(); }).catch(() => null);
      await logNormalDelay(1400, 0.15);
      await this.waitForCombatReady();
    }

    return {
      status: 'SUCCESS',
      finalScore: this.currentScore,
      turnsElapsed,
      durationMs: Date.now() - t0,
      message: 'Combat sequence finished.'
    };
  }

  public async isPendingLimitReached(): Promise<boolean> {
    const resolution = await this.pendingService.checkAndClearPendingBattles();
    return resolution.hasPendingBattles;
  }

  public async claimPendingBattles(logPath: string, totalRuns: number, dropLogger?: DropLogger): Promise<number> {
    const resolution = await this.pendingService.claimAllUnclaimedBattles('https://game.granbluefantasy.jp/#quest/assist');
    if (resolution.goldBarDetected && dropLogger) {
      dropLogger.logBattle({
        raidId: 'CLAIMED_PENDING',
        turns: 0,
        honors: 0,
        targetMet: true,
        hasBlueChest: true,
        hasGoldBar: true
      });
      return 1;
    }
    return 0;
  }

  protected async findAndSelectRaid(): Promise<RaidCandidate | null> {
    return await this.scanSlotForCandidate();
  }

  protected async confirmPartyAndStartQuest(autoReplenishEp: boolean): Promise<boolean> {
    // Recover EP if modal present
    await this.recoveryService.handleEpRecovery(autoReplenishEp);

    // Click Quest Start
    return await this.page.evaluate(() => {
      const startBtn = document.querySelector(
        '.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle'
      ) as HTMLElement;
      if (startBtn && startBtn.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(startBtn).trigger('tap');
        startBtn.click();
        return true;
      }
      return false;
    }).catch(() => false);
  }

  protected async waitForCombatReady(timeoutMs = 12000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const isReady = await this.page.evaluate(() => {
        const hash = window.location.hash || '';
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        const hasAttack = !!document.querySelector('.btn-attack-start.display-on, .btn-attack-start');
        return isCombat && hasAttack;
      }).catch(() => false);

      if (isReady) return true;
      await logNormalDelay(250, 0.1);
    }
    return false;
  }

  protected async executeQuickCall(): Promise<void> {
    await this.page.evaluate(() => {
      const qs = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
      if (qs && qs.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(qs).trigger('tap');
        qs.click();
      }
    }).catch(() => null);
    await logNormalDelay(400, 0.1);
  }

  protected async executeChar4Skills(): Promise<void> {
    await this.page.evaluate(() => {
      // Open Char 4 drawer
      const char4 = document.querySelector('.lis-character4, .btn-command-character4') as HTMLElement;
      if (char4) char4.click();
    }).catch(() => null);
    await logNormalDelay(350, 0.1);

    // Char 4 S1 + S2 on Char 2
    await this.page.evaluate(() => {
      const s1 = document.querySelector('.prt-ability-list .btn-ability[data-ability-id="1"]') as HTMLElement;
      if (s1) s1.click();
      const s2 = document.querySelector('.prt-ability-list .btn-ability[data-ability-id="2"]') as HTMLElement;
      if (s2) s2.click();
      const targetChar2 = document.querySelector('.lis-character2, .btn-command-character2') as HTMLElement;
      if (targetChar2) targetChar2.click();
    }).catch(() => null);
    await logNormalDelay(400, 0.1);
  }

  protected async executeDeathSummon(): Promise<void> {
    await this.page.evaluate(() => {
      const summonTab = document.querySelector('.btn-summon-toggle, .btn-summon') as HTMLElement;
      if (summonTab) summonTab.click();
      const death = document.querySelector('.lis-summon[data-pos="3"], .lis-summon3') as HTMLElement;
      if (death) death.click();
      const callBtn = document.querySelector('.btn-usual-ok.se-quest-start, .btn-usual-ok') as HTMLElement;
      if (callBtn) callBtn.click();
    }).catch(() => null);
    await logNormalDelay(500, 0.15);
  }

  protected async executeChar2Skill1(): Promise<void> {
    await this.page.evaluate(() => {
      const char2 = document.querySelector('.lis-character2, .btn-command-character2') as HTMLElement;
      if (char2) char2.click();
      const s1 = document.querySelector('.prt-ability-list .btn-ability[data-ability-id="1"]') as HTMLElement;
      if (s1) s1.click();
    }).catch(() => null);
    await logNormalDelay(350, 0.1);
  }

  protected async dispatchAttack(): Promise<void> {
    await this.page.evaluate(() => {
      const atk = document.querySelector('.btn-attack-start.display-on, .btn-attack-start') as HTMLElement;
      if (atk) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(atk).trigger('tap');
        atk.click();
      }
    }).catch(() => null);
    await logNormalDelay(350, 0.1);
  }

  protected async getCombatState(): Promise<{ honors: number; bossHpPct: number; isVictory: boolean }> {
    return await this.page.evaluate(() => {
      let honors = 0;
      const pointEl = document.querySelector('.txt-point, .prt-point, .prt-total-honor');
      if (pointEl?.textContent) {
        const parsed = parseInt(pointEl.textContent.replace(/,/g, '').trim(), 10);
        if (!isNaN(parsed)) honors = parsed;
      }

      const boss = (window as any).stage?.gGameStatus?.boss?.param?.[0];
      const bossHp = boss?.hp !== undefined ? Number(boss.hp) : null;
      const bossHpMax = boss?.hpmax !== undefined ? Number(boss.hpmax) : null;
      const bossHpPct = bossHp !== null && bossHpMax !== null && bossHpMax > 0 ? (bossHp / bossHpMax) * 100 : 100;

      const isVictory = !!document.querySelector('.pop-raid-result') || window.location.hash.includes('result');
      return { honors, bossHpPct, isVictory };
    }).catch(() => ({ honors: 0, bossHpPct: 100, isVictory: false }));
  }

  protected setupResponseListener(): void {
    if (this.responseListenerInitialized) return;
    this.responseListenerInitialized = true;

    this.page.on('response', async (response: HTTPResponse) => {
      try {
        const url = response.url();
        if (url.includes('/result/data/') || url.includes('/rewardcontent/')) {
          const json = await response.json().catch(() => null);
          if (json) this.latestRewardData = json;
        }
      } catch {}
    });
  }
}

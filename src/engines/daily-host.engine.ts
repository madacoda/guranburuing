// src/engines/daily-host.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { UniversalWorkflowEngine } from './universal-workflow.engine.js';
import { WorkflowTemplate } from '../types/workflow.types.js';
import { logNormalDelay } from '../human-motor.js';

// Domain Core
export { DAILY_HOST_CATALOG } from '../domain/daily-host/daily-host.catalog.js';
export * from '../domain/daily-host/daily-host.types.js';
export * from '../domain/daily-host/daily-host.interfaces.js';

import { DAILY_HOST_CATALOG } from '../domain/daily-host/daily-host.catalog.js';
import {
  DailyRaidHostDefinition,
  DailyRaidExecutionRecord,
  DailyHostExecutionSummary,
  DailyHostExecutionOptions,
  DailyRaidExecutionStatus
} from '../domain/daily-host/daily-host.types.js';
import {
  IActiveHostedRaidScanner,
  IStageModalNavigator,
  IHostPreconditionValidator,
  ISupporterPartyLauncher,
  IBackupBroadcastService,
  IHostedCombatRunner,
  IAssistInterleaver,
  IDailyHostReporter
} from '../domain/daily-host/daily-host.interfaces.js';

// Specialized Domain Services (Single Responsibility)
import { ActiveHostedRaidScanner } from '../services/daily-host/active-hosted-raid.scanner.js';
import { StageModalNavigator } from '../services/daily-host/stage-modal.navigator.js';
import { HostPreconditionValidator } from '../services/daily-host/host-precondition.validator.js';
import { SupporterPartyLauncher } from '../services/daily-host/supporter-party.launcher.js';
import { BackupBroadcastService } from '../services/daily-host/backup-broadcast.service.js';
import { HostedCombatRunner } from '../services/daily-host/hosted-combat.runner.js';
import { AssistInterleaverService } from '../services/daily-host/assist-interleaver.service.js';
import { DailyHostReporter } from '../services/daily-host/daily-host.reporter.js';
import { FailureAnalyzerService } from '../services/daily-host/failure-analyzer.service.js';

/**
 * DailyHostEngine (Orchestrator)
 *
 * Adheres strictly to SOLID principles:
 * - Single Responsibility Principle (SRP): Only coordinates the high-level workflow across raids.
 * - Open/Closed Principle (OCP): New combat strategies or validators can be plugged in without changing orchestration.
 * - Liskov Substitution Principle (LSP): Accepts any implementation of the domain interfaces.
 * - Interface Segregation Principle (ISP): Granular interfaces in `daily-host.interfaces.ts`.
 * - Dependency Inversion Principle (DIP): High-level engine depends on abstractions, injectable via constructor.
 */
export class DailyHostEngine {
  private page: Page;
  private sentinel: SentinelWatchdog;
  private accountId: string;
  private stopRequested = false;

  // Injected Domain Dependencies
  private workflow: UniversalWorkflowEngine;
  private scanner: IActiveHostedRaidScanner;
  private navigator: IStageModalNavigator;
  private validator: IHostPreconditionValidator;
  private launcher: ISupporterPartyLauncher;
  private broadcast: IBackupBroadcastService;
  private combat: IHostedCombatRunner;
  private interleaver: IAssistInterleaver;
  private reporter: IDailyHostReporter;

  constructor(
    page: Page,
    sentinel: SentinelWatchdog,
    accountId = 'acc1',
    dependencies?: {
      workflow?: UniversalWorkflowEngine;
      scanner?: IActiveHostedRaidScanner;
      navigator?: IStageModalNavigator;
      validator?: IHostPreconditionValidator;
      launcher?: ISupporterPartyLauncher;
      broadcast?: IBackupBroadcastService;
      combat?: IHostedCombatRunner;
      interleaver?: IAssistInterleaver;
      reporter?: IDailyHostReporter;
    }
  ) {
    this.page = page;
    this.sentinel = sentinel;
    this.accountId = accountId;

    // Default Companion Workflow Engine
    const defaultTemplate: WorkflowTemplate = {
      name: 'Daily Host Routine',
      questUrl: 'https://game.granbluefantasy.jp/#quest/multi/0',
      speedProfile: 'fast',
      autoElixir: true,
      autoBerry: true,
      supporterPriority: ['Hades', 'Bahamut', 'Lucifer', 'Zeus', 'Agni', 'Varuna', 'Titan', 'Zephyrus', 'Kaguya'],
      steps: []
    };

    this.workflow = dependencies?.workflow ?? new UniversalWorkflowEngine(this.page, this.sentinel, defaultTemplate, this.accountId);
    this.navigator = dependencies?.navigator ?? new StageModalNavigator(this.page);
    this.broadcast = dependencies?.broadcast ?? new BackupBroadcastService(this.page);
    this.validator = dependencies?.validator ?? new HostPreconditionValidator(this.page);
    this.launcher = dependencies?.launcher ?? new SupporterPartyLauncher(this.page, this.workflow);
    this.combat = dependencies?.combat ?? new HostedCombatRunner(this.page, this.workflow, this.broadcast, this.navigator);
    this.interleaver = dependencies?.interleaver ?? new AssistInterleaverService(
      this.page,
      this.sentinel,
      this.broadcast,
      this.combat,
      this.navigator,
      this.accountId
    );
    this.scanner = dependencies?.scanner ?? new ActiveHostedRaidScanner(this.page, this.workflow, this.combat, this.interleaver);
    this.reporter = dependencies?.reporter ?? new DailyHostReporter();
  }

  /**
   * Rebinds active Puppeteer page context across all injected services upon CDP reconnection.
   */
  public updatePage(newPage: Page): void {
    this.page = newPage;
    this.sentinel.updatePage(newPage);
    this.workflow.updatePage(newPage);
    this.navigator.updatePage(newPage);
    this.broadcast.updatePage(newPage);
    this.validator.updatePage(newPage);
    this.launcher.updatePage(newPage);
    this.combat.updatePage(newPage);
    this.interleaver.updatePage(newPage);
    this.scanner.updatePage(newPage);
  }

  /**
   * Signals graceful cancellation of the daily host routine.
   */
  public requestStop(): void {
    this.stopRequested = true;
    this.workflow.requestStop();
    this.combat.requestStop();
    this.interleaver.requestStop();
    if ('requestStop' in this.launcher && typeof (this.launcher as any).requestStop === 'function') {
      (this.launcher as any).requestStop();
    }
  }

  /**
   * Main Orchestrator:
   * 1. Performs pre-flight sanitation (unclaimed battles & active self-hosted raid recovery).
   * 2. Iterates through target raids sequentially.
   * 3. Handles limits, material verification, party launch, full auto combat, and pub assistance.
   * 4. Synthesizes standardized telemetry summaries and persists audit markdown reports.
   */
  public async runDailyHost(options: DailyHostExecutionOptions = {}): Promise<DailyHostExecutionSummary> {
    const startedAt = new Date().toISOString();
    const categoryFilter = options.categoryFilter || 'all';
    const specificRaidId = options.specificRaidId;

    // Filter target catalog
    let targetRaids = DAILY_HOST_CATALOG;
    if (specificRaidId) {
      targetRaids = targetRaids.filter(
        r => r.id.toLowerCase() === specificRaidId.toLowerCase() ||
             r.name.toLowerCase().includes(specificRaidId.toLowerCase())
      );
    } else if (categoryFilter !== 'all') {
      targetRaids = targetRaids.filter(r => r.category === categoryFilter);
    }

    console.log('\n========================================================================');
    console.log('       Granblue Fantasy Daily Raid Hosting Engine (bun run daily:host)   ');
    console.log('========================================================================');
    console.log(`Account:           [${this.accountId}]`);
    console.log(`Target Category:   ${categoryFilter.toUpperCase()}`);
    console.log(`Total Raids:       ${targetRaids.length}`);
    console.log(`Architecture:      SOLID Standard (SRP, OCP, LSP, ISP, DIP)`);
    console.log(`Smart Combat:      Tactical Full Auto + Lockout Fast Reload (F5)`);
    console.log(`Multiplayer Pub:   Automatic Request Backup (Everyone, Friends, Crew)`);
    console.log('========================================================================\n');

    const executionRecords: DailyRaidExecutionRecord[] = [];
    this.navigator.resetActiveStage();

    // Pre-flight 1: Ensure no lingering unclaimed battles block quest entry
    await this.clearPendingBattlesIfNeeded();

    // Pre-flight 2: Check if an active self-hosted raid is already in progress
    console.log('[DailyHost] 🔍 Inspecting for any active in-progress hosted raid first...');
    const activeRaidRecord = await this.scanner.scanAndResumeActiveHostedRaid(true, options);
    if (activeRaidRecord) {
      executionRecords.push(activeRaidRecord);
      console.log(`[DailyHost] ✅ In-progress raid "${activeRaidRecord.raid.name}" cleared! Continuing with remaining daily hosts...\n`);
    }

    // Main Sequential Hosting Loop
    for (let i = 0; i < targetRaids.length; i++) {
      if (this.stopRequested) {
        console.log('\n[DailyHost] ⏹️ Stop requested. Halting remaining raid hosts.');
        break;
      }

      const raid = targetRaids[i];

      // Deduplication: check if already cleared (e.g. during in-progress pre-flight resumption)
      const alreadyCleared = executionRecords.some(
        r => (r.raid.id === raid.id || r.raid.name.toLowerCase() === raid.name.toLowerCase()) &&
             r.status === 'CLEARED'
      );

      if (alreadyCleared) {
        console.log(`\n------------------------------------------------------------------------`);
        console.log(`[Raid ${i + 1}/${targetRaids.length}] ⏭️ Skipping: "${raid.name}" (Already cleared in this session)`);
        console.log(`------------------------------------------------------------------------`);
        continue;
      }

      console.log(`\n------------------------------------------------------------------------`);
      console.log(`[Raid ${i + 1}/${targetRaids.length}] 🛡️ Processing Host: "${raid.name}"`);
      console.log(`------------------------------------------------------------------------`);

      const t0 = Date.now();
      const record = await this.hostSingleRaid(raid, options);
      executionRecords.push(record);

      // Brief humanized relaxation delay between battles
      await logNormalDelay(1000, 0.15);
    }

    // Autonomous Self-Healing Retry Pass for Transient / Modal / Network Failures
    const shouldRetry = options.autoRetryFailures !== false;
    let retriedCount = 0;
    let retriedClearedCount = 0;
    const failureDiagnoses: any[] = [];

    if (shouldRetry && !this.stopRequested) {
      const maxRetries = options.maxFailureRetries ?? 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Identify failed records that are diagnosed as retriable (excludes genuine material deficits or limits)
        const failedIndices = executionRecords
          .map((rec, idx) => ({ rec, idx }))
          .filter(({ rec }) => rec.status === 'FAILED' && FailureAnalyzerService.isRetriable(rec));

        if (failedIndices.length === 0) break;

        console.log(`\n========================================================================`);
        console.log(`  🛡️ [DailyHost:Self-Healing] Retry Pass ${attempt}/${maxRetries} for ${failedIndices.length} Failed Raid(s)`);
        console.log(`========================================================================`);

        for (const { rec, idx } of failedIndices) {
          if (this.stopRequested) break;
          const diag = FailureAnalyzerService.diagnose(rec);
          failureDiagnoses.push({ raidId: rec.raid.id, attempt, diagnosis: diag });

          console.log(`\n[DailyHost:Retry] 🔄 Re-attempting "${rec.raid.name}"`);
          console.log(`   • Diagnosis:   ${diag.category} (${diag.reason})`);
          console.log(`   • Original:    ${rec.message}`);
          console.log(`   • Mitigation:  ${diag.recommendedAction}`);

          // Self-healing browser sanitation before re-attempting
          await this.sanitizeBrowserState();

          retriedCount++;
          const retryRecord = await this.hostSingleRaid(rec.raid, options);

          if (retryRecord.status === 'CLEARED') {
            console.log(`🎉 [DailyHost:Retry] SUCCESS! "${rec.raid.name}" cleared on retry attempt #${attempt}!`);
            executionRecords[idx] = retryRecord;
            retriedClearedCount++;
          } else {
            console.log(`⚠️ [DailyHost:Retry] Attempt #${attempt} for "${rec.raid.name}" ended with status: ${retryRecord.status}`);
            executionRecords[idx] = retryRecord;
          }
        }
      }
    }

    const completedAt = new Date().toISOString();
    const summary: DailyHostExecutionSummary = {
      accountId: this.accountId,
      startedAt,
      completedAt,
      totalRaidsTargeted: targetRaids.length,
      clearedCount: executionRecords.filter(r => r.status === 'CLEARED').length,
      skippedNoMaterialCount: executionRecords.filter(r => r.status === 'SKIPPED_NO_MATERIAL').length,
      skippedLimitCount: executionRecords.filter(r => r.status === 'SKIPPED_LIMIT').length,
      failedCount: executionRecords.filter(r => r.status === 'FAILED').length,
      executionRecords,
      retriedCount,
      retriedClearedCount,
      failureDiagnoses,

      // Backward compatibility fields
      account: this.accountId,
      startTime: startedAt,
      endTime: completedAt,
      totalRaids: targetRaids.length,
      cleared: executionRecords.filter(r => r.status === 'CLEARED').length,
      skippedNoMaterial: executionRecords.filter(r => r.status === 'SKIPPED_NO_MATERIAL').length,
      skippedLimit: executionRecords.filter(r => r.status === 'SKIPPED_LIMIT').length,
      failed: executionRecords.filter(r => r.status === 'FAILED').length,
      results: executionRecords
    };

    // Output formatted console and disk reports
    this.reporter.renderConsoleSummary(summary);
    this.reporter.persistMarkdownAuditReport(summary, options.logPath);

    return summary;
  }

  /**
   * Handles the complete end-to-end lifecycle for hosting a single raid.
   */
  private async hostSingleRaid(
    raid: DailyRaidHostDefinition,
    options: DailyHostExecutionOptions
  ): Promise<DailyRaidExecutionRecord> {
    const t0 = Date.now();

    try {
      // 1. Navigate to Raid host list (#quest/multi/0)
      await this.navigator.navigateToMultiList();

      // Check if blocked by an active raid modal upon navigation
      const activePreNav = await this.scanner.scanAndResumeActiveHostedRaid(false, options);
      if (activePreNav) {
        if (activePreNav.raid.id === raid.id || activePreNav.raid.name.toLowerCase().includes(raid.name.toLowerCase())) {
          return activePreNav;
        }
        console.log(`[DailyHost] ✅ In-progress raid "${activePreNav.raid.name}" cleared. Now hosting intended raid "${raid.name}"...`);
        await this.navigator.navigateToMultiList();
      }

      // 2. Open stage category modal (12061, 12042, 12051)
      const stageOpened = await this.navigator.openStageCategoryModal(raid.stageId);
      if (!stageOpened) {
        return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, `Could not open Stage modal [${raid.stageId}].`);
      }

      // 3. Inspect quest availability & daily limit
      const availability = await this.validator.inspectQuestAvailability(raid.questId);
      if (!availability.isAvailable && availability.remainingHostsToday <= 0 && availability.status === 'SKIPPED_LIMIT') {
        console.log(`[DailyHost] ⏭️ Skipping "${raid.name}": Daily host limit reached today (0 remaining).`);
        return this.createRecord(raid, 'SKIPPED_LIMIT', 0, 0, Date.now() - t0, 'Daily host limit reached today.');
      }

      if (!availability.isAvailable) {
        return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, availability.reason);
      }

      // Check if this quest is ALREADY in progress
      if (availability.isInProgress) {
        console.log(`[DailyHost] ⚡ Raid "${raid.name}" is already in progress (Raid ID: ${availability.activeRaidId || 'active'}). Resuming combat directly...`);
        await this.validator.clickQuestPlay(raid.questId);
        await logNormalDelay(1500, 0.15);

        // Acknowledge restart popup if present
        await this.page.evaluate(() => {
          const pop = document.querySelector('.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual') as HTMLElement;
          const okBtn = pop?.querySelector('.btn-usual-ok, .btn-resume') as HTMLElement;
          if (okBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(okBtn).trigger('tap');
            okBtn.click();
          }
        }).catch(() => null);

        await (this.workflow as any).waitForBattleToMount(12000);
        let combatOutcome = await this.combat.executeHostedCombat(raid, options.maxTurnsPerRaid, options);
        if (combatOutcome.yieldedToAssist && combatOutcome.activeRaidId) {
          combatOutcome = await this.interleaver.interleaveAssistWhileHostedRaidActive(
            raid,
            combatOutcome.activeRaidId,
            options
          );
        } else {
          await this.combat.confirmAndDismissBattleResult();
        }
        return this.createRecord(
          raid,
          combatOutcome.isVictoryConfirmed ? 'CLEARED' : 'FAILED',
          combatOutcome.turnsElapsed,
          combatOutcome.honorsEarned,
          Date.now() - t0,
          `Resumed in-progress raid: ${combatOutcome.message}`
        );
      }

      // 4. Click quest button to trigger treasure popup
      console.log(`[DailyHost] Clicking play for "${raid.name}" (${availability.remainingHostsToday} host(s) available today)...`);
      const playClicked = await this.validator.clickQuestPlay(raid.questId);
      if (!playClicked) {
        return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, 'Failed to click quest Play button.');
      }

      await logNormalDelay(1000, 0.15);

      // Check if clicking play immediately put the browser into battle or restart modal
      const curHashAfterClick = await this.page.evaluate(() => window.location.hash).catch(() => '');
      const isRestartModal = await this.page.evaluate(() => {
        const pop = document.querySelector('.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual') as HTMLElement;
        return pop && (pop.innerText.includes('in progress') || pop.innerText.includes('Resume Quests'));
      }).catch(() => false);

      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHashAfterClick) || isRestartModal) {
        if (isRestartModal) {
          console.log(`[DailyHost] ⚡ In-progress raid modal detected after clicking play. Resuming...`);
          await this.page.evaluate(() => {
            const pop = document.querySelector('.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual') as HTMLElement;
            const okBtn = pop?.querySelector('.btn-usual-ok, .btn-resume') as HTMLElement;
            if (okBtn) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(okBtn).trigger('tap');
              okBtn.click();
            }
          }).catch(() => null);
          await logNormalDelay(1500, 0.15);
          await (this.workflow as any).waitForBattleToMount(12000);
        }

        console.log(`[DailyHost] ⚔️ In-progress raid battle active. Engaging combat directly for "${raid.name}"...`);
        let combatOutcome = await this.combat.executeHostedCombat(raid, options.maxTurnsPerRaid, options);
        if (combatOutcome.yieldedToAssist && combatOutcome.activeRaidId) {
          combatOutcome = await this.interleaver.interleaveAssistWhileHostedRaidActive(
            raid,
            combatOutcome.activeRaidId,
            options
          );
        } else {
          await this.combat.confirmAndDismissBattleResult();
        }
        return this.createRecord(
          raid,
          combatOutcome.isVictoryConfirmed ? 'CLEARED' : 'FAILED',
          combatOutcome.turnsElapsed,
          combatOutcome.honorsEarned,
          Date.now() - t0,
          `Resumed in-progress raid: ${combatOutcome.message}`
        );
      }

      // Check if blocked by in-progress raid popup right after clicking play
      const activeOnPlay = await this.scanner.scanAndResumeActiveHostedRaid(false, options);
      if (activeOnPlay) {
        if (activeOnPlay.raid.id === raid.id || activeOnPlay.raid.name.toLowerCase().includes(raid.name.toLowerCase())) {
          return activeOnPlay;
        }
        console.log(`[DailyHost] ✅ In-progress raid "${activeOnPlay.raid.name}" cleared. Now hosting intended raid "${raid.name}"...`);
        await this.navigator.navigateToMultiList();
        return await this.hostSingleRaid(raid, options);
      }

      // Check if redirected to unclaimed battles
      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (curHash.includes('unclaimed')) {
        console.log('[DailyHost] Pending battles modal intercepted. Clearing and restarting quest...');
        await this.clearPendingBattlesIfNeeded();
        return await this.hostSingleRaid(raid, options);
      }

      // 5. Inspect treasure modal for material availability
      const treasureCheck = await this.validator.verifyTreasureRequirements();
      if (!treasureCheck.hasMaterials) {
        console.log(`[DailyHost] ⚠️ Skipping "${raid.name}": Insufficient host materials (${treasureCheck.reason}).`);
        await this.validator.dismissTreasureModal();
        return this.createRecord(raid, 'SKIPPED_NO_MATERIAL', 0, 0, Date.now() - t0, `Missing materials: ${treasureCheck.reason}`);
      }

      console.log(`[DailyHost] ✅ Host materials verified (${treasureCheck.reason}). Proceeding to supporter summon...`);
      const confirmedOffer = await this.validator.confirmTreasureOffer();
      if (!confirmedOffer) {
        return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, 'Failed to confirm host treasure offer.');
      }

      // 6. Supporter Summon Selection
      const supporterSelected = await this.launcher.selectSupporterSummon();
      if (!supporterSelected) {
        // Re-check if active raid modal intercepted
        const activeOnSummon = await this.scanner.scanAndResumeActiveHostedRaid(false, options);
        if (activeOnSummon) return activeOnSummon;
        return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, 'Supporter summon selection timed out.');
      }

      // 7. Party deck confirmation & Quest Start
      console.log('[DailyHost] Confirming party deck and launching battle...');
      const partyLaunched = await this.launcher.confirmPartyAndLaunchQuest();
      if (!partyLaunched) {
        const activeOnParty = await this.scanner.scanAndResumeActiveHostedRaid(false, options);
        if (activeOnParty) return activeOnParty;
        return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, 'Failed to confirm party and launch battle.');
      }

      // 8. Execute Smart Full Auto Combat + Request Backup to ALL
      let combatOutcome = await this.combat.executeHostedCombat(raid, options.maxTurnsPerRaid, options);

      // Check if combat yielded to background pub clear + assist farming
      if (combatOutcome.yieldedToAssist && combatOutcome.activeRaidId) {
        combatOutcome = await this.interleaver.interleaveAssistWhileHostedRaidActive(
          raid,
          combatOutcome.activeRaidId,
          options
        );
      } else {
        // 9. Confirm and acknowledge battle results
        await this.combat.confirmAndDismissBattleResult();
      }

      return this.createRecord(
        raid,
        combatOutcome.isVictoryConfirmed ? 'CLEARED' : 'FAILED',
        combatOutcome.turnsElapsed,
        combatOutcome.honorsEarned,
        Date.now() - t0,
        combatOutcome.message
      );

    } catch (err: any) {
      console.error(`[DailyHost] Error while hosting "${raid.name}":`, err.message);
      return this.createRecord(raid, 'FAILED', 0, 0, Date.now() - t0, err.message);
    }
  }

  /**
   * Helper to construct a standardized execution record with legacy compatibility aliases.
   */
  private createRecord(
    raid: DailyRaidHostDefinition,
    status: DailyRaidExecutionStatus,
    turnsElapsed: number,
    honorsEarned: number,
    durationMs: number,
    message: string
  ): DailyRaidExecutionRecord {
    const executedAt = new Date().toISOString();
    return {
      raid,
      status,
      turnsElapsed,
      honorsEarned,
      durationMs,
      message,
      executedAt,

      // Backward compatibility fields
      turns: turnsElapsed,
      honors: honorsEarned,
      timestamp: executedAt
    };
  }

  /**
   * Checks and clears any pending battles (#quest/assist/unclaimed/0/0) if present.
   */
  private async clearPendingBattlesIfNeeded(): Promise<void> {
    await (this.workflow as any).checkAndClearPendingBattles();
  }

  /**
   * Dismisses any active modal overlays, clears pending battles, and resets stage navigation.
   */
  private async sanitizeBrowserState(): Promise<void> {
    try {
      // 1. Dismiss any blocking dialogs or modal backdrops
      await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-usual .btn-usual-ok, .pop-usual .btn-usual-close, .btn-usual-ok, .btn-usual-cancel, #pop.popup-view-root, .btn-close') as HTMLElement;
        if (pop && pop.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(pop).trigger('tap');
          pop.click();
        }
      }).catch(() => null);

      await logNormalDelay(600, 0.1);

      // 2. Clear any lingering unclaimed battles if present
      await this.clearPendingBattlesIfNeeded();

      // 3. Reset stage modal navigator internal cache
      this.navigator.resetActiveStage();
    } catch {}
  }
}

/**
 * Standard enterprise naming alias.
 */
export const DailyHostOrchestrator = DailyHostEngine;
export type DailyHostOrchestrator = DailyHostEngine;

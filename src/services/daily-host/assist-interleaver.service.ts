// src/services/daily-host/assist-interleaver.service.ts
import { Page } from 'puppeteer-core';
import {
  IAssistInterleaver,
  IBackupBroadcastService,
  IHostedCombatRunner,
  IStageModalNavigator
} from '../../domain/daily-host/daily-host.interfaces.js';
import {
  DailyRaidHostDefinition,
  HostedCombatOutcome,
  DailyHostExecutionOptions
} from '../../domain/daily-host/daily-host.types.js';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import { UniversalWorkflowEngine } from '../../engines/universal-workflow.engine.js';
import { TemplateParser } from '../../templates/template-parser.js';
import { WorkflowTemplate } from '../../types/workflow.types.js';
import { logNormalDelay } from '../../human-motor.js';

/**
 * AssistInterleaverService:
 * Implements the Dual-Track Interleaved Execution System.
 *
 * In Granblue Fantasy, a player can maintain an active self-hosted raid in the background
 * while concurrently participating in up to 3 multiplayer backup/assist raids.
 *
 * When a hosted daily raid takes too long or frontline damage output degrades:
 * 1. Combat yields and ensures a public Backup Request is broadcasting to Raid Finders.
 * 2. AssistInterleaver transitions to assist farming (e.g. gb-farm, gb-pbhl, gb-akasha, gb-go).
 * 3. Periodically (every ~180s on the 3-minute backup cooldown), it inspects the hosted raid.
 * 4. Re-broadcasts backup requests to Everyone / Friends to accelerate pub clearance.
 * 5. When the boss reaches 0% HP, claims rewards, cleanly frees the slot, and returns to daily hosts.
 */
export class AssistInterleaverService implements IAssistInterleaver {
  private page: Page;
  private sentinel: SentinelWatchdog;
  private backupBroadcaster: IBackupBroadcastService;
  private combatRunner: IHostedCombatRunner;
  private navigator: IStageModalNavigator;
  private accountId: string;
  private stopRequested = false;

  constructor(
    page: Page,
    sentinel: SentinelWatchdog,
    backupBroadcaster: IBackupBroadcastService,
    combatRunner: IHostedCombatRunner,
    navigator: IStageModalNavigator,
    accountId = 'acc1'
  ) {
    this.page = page;
    this.sentinel = sentinel;
    this.backupBroadcaster = backupBroadcaster;
    this.combatRunner = combatRunner;
    this.navigator = navigator;
    this.accountId = accountId;
  }

  public updatePage(newPage: Page): void {
    this.page = newPage;
    this.backupBroadcaster.updatePage(newPage);
    this.combatRunner.updatePage(newPage);
    this.navigator.updatePage(newPage);
  }

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Coordinates assist/Gold Bar farming while periodically monitoring and maintaining the active hosted raid.
   */
  public async interleaveAssistWhileHostedRaidActive(
    raid: DailyRaidHostDefinition,
    hostedRaidId: string,
    options: DailyHostExecutionOptions
  ): Promise<HostedCombatOutcome> {
    const t0 = Date.now();
    const targetActivity = options.assistActivity || 'gb-farm';
    const recheckIntervalMs = options.hostedRaidRecheckIntervalMs || 180_000; // 3-minute cooldown
    const maxSafetyTimeoutMs = 15 * 60 * 1000; // 15 minute ceiling

    let assistTemplate: WorkflowTemplate;
    try {
      assistTemplate = TemplateParser.loadTemplate(targetActivity);
    } catch {
      console.warn(`[DailyHost:Interleaver] ⚠️ Could not load template "${targetActivity}", falling back to "gb-farm".`);
      assistTemplate = TemplateParser.loadTemplate('gb-farm');
    }

    console.log(`\n========================================================================`);
    console.log(`[DailyHost:Interleaver] 🚀 Commencing Assist Interleaving Routine`);
    console.log(`[DailyHost:Interleaver] Background Hosted Raid: "${raid.name}" (ID: ${hostedRaidId})`);
    console.log(`[DailyHost:Interleaver] Active Farming Target:  [${assistTemplate.name}]`);
    console.log(`[DailyHost:Interleaver] Re-check Interval:      ${Math.round(recheckIntervalMs / 1000)}s (3-min Backup Cooldown)`);
    console.log(`========================================================================\n`);

    let totalAssistRuns = 0;
    let lastHostedCheckAt = Date.now();

    while (!this.stopRequested && Date.now() - t0 < maxSafetyTimeoutMs) {
      // 1. Check if hosted raid concluded before starting new assist run
      const elapsedSinceCheck = Date.now() - lastHostedCheckAt;
      if (elapsedSinceCheck >= recheckIntervalMs || totalAssistRuns > 0) {
        const hostedStatus = await this.inspectAndMaintainHostedRaid(raid, hostedRaidId);
        lastHostedCheckAt = Date.now();

        if (hostedStatus.isVictoryConfirmed) {
          console.log(`\n========================================================================`);
          console.log(`[DailyHost:Interleaver] 🏆 Background Hosted Raid "${raid.name}" CLEARED by Pub!`);
          console.log(`[DailyHost:Interleaver] Completed ${totalAssistRuns} assist raid run(s) while waiting.`);
          console.log(`[DailyHost:Interleaver] Slot verified clean. Resuming remaining daily hosts...`);
          console.log(`========================================================================\n`);
          return hostedStatus;
        }
      }

      if (this.stopRequested) break;

      // 2. Execute 1 assist farming run
      try {
        console.log(`[DailyHost:Interleaver] ⚔️ [Assist Run ${totalAssistRuns + 1}] Running assist target: "${assistTemplate.name}"...`);
        const assistWorkflow = new UniversalWorkflowEngine(this.page, this.sentinel, assistTemplate, this.accountId);
        await assistWorkflow.ensureViewportAndMobile();

        await assistWorkflow.runLoop({
          runs: 1,
          autoReplenishAp: options.autoReplenishAp !== false,
          autoReplenishEp: true,
          logPath: options.logPath
        });

        totalAssistRuns++;
        console.log(`[DailyHost:Interleaver] ✅ [Assist Run ${totalAssistRuns}] Completed successfully.\n`);
      } catch (err: any) {
        console.warn(`[DailyHost:Interleaver] ⚠️ Notice during assist run: ${err.message}. Checking hosted raid status...`);
      }

      await logNormalDelay(1000, 0.15);
    }

    // Fallback: Final status resolution after timeout or stop request
    console.log(`[DailyHost:Interleaver] Performing final status check on hosted raid "${raid.name}"...`);
    const finalStatus = await this.inspectAndMaintainHostedRaid(raid, hostedRaidId);
    return finalStatus;
  }

  /**
   * Re-enters the active hosted raid:
   * 1. Inspects boss HP and victory status.
   * 2. If boss is defeated, acknowledges victory screen, collects loot, and frees the host slot.
   * 3. If boss is alive and 3-minute cooldown has expired, re-broadcasts backup request to Everyone & Friends.
   */
  private async inspectAndMaintainHostedRaid(
    raid: DailyRaidHostDefinition,
    hostedRaidId: string
  ): Promise<HostedCombatOutcome> {
    const t0 = Date.now();
    console.log(`[DailyHost:Interleaver] 🔍 Checking hosted raid status (#raid_multi/${hostedRaidId})...`);

    // Navigate to active raid battle
    await this.page.evaluate((id: string) => {
      const Game = (window as any).Game;
      if (Game?.router?.navigate) {
        Game.router.navigate('raid_multi/' + id, { trigger: true });
      } else {
        window.location.hash = '#raid_multi/' + id;
      }
    }, hostedRaidId).catch(() => null);

    await logNormalDelay(1500, 0.15);

    // Dismiss popRestartQuest if present
    await this.page.evaluate(() => {
      const pop = document.querySelector(
        '.popRestartQuest, .pop-usual.pop-show, #pop.popup-view-root, .pop-usual'
      ) as HTMLElement;
      const okBtn = pop?.querySelector('.btn-usual-ok, .btn-resume') as HTMLElement;
      if (okBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(1000, 0.15);

    // Read authoritative battle state
    const state = await this.combatRunner.getAuthoritativeBattleState();
    const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isFinished = state.isVictory || (state.bossHpPct <= 0 && state.isMounted) || curHash.includes('result');

    if (isFinished) {
      console.log(`[DailyHost:Interleaver] 🏆 Boss reached 0% HP! Confirming rewards and freeing raid slot...`);
      await this.combatRunner.confirmAndDismissBattleResult();

      return {
        isVictoryConfirmed: true,
        turnsElapsed: 0,
        honorsEarned: state.currentHonors,
        message: 'Victory confirmed via pub players during assist farming!',
        durationMs: Date.now() - t0
      };
    }

    console.log(
      `[DailyHost:Interleaver] ⏳ Hosted raid "${raid.name}" in progress (Boss HP: ${state.bossHpPct.toFixed(1)}% | Honors: ${state.currentHonors.toLocaleString()} pt).`
    );

    // Re-broadcast Backup Request if 3-minute cooldown expired
    if (await this.backupBroadcaster.canBroadcastBackup()) {
      console.log(
        `[DailyHost:Interleaver] 📢 3-minute backup cooldown expired! Re-broadcasting backup request to Everyone / Raid Finders...`
      );
      const rebroadcast = await this.backupBroadcaster.broadcastBackupRequestToAll();
      if (rebroadcast.broadcastSuccessful) {
        console.log(`[DailyHost:Interleaver] ✅ Backup request successfully re-sent to: ${rebroadcast.activeScopes.join(', ')}`);
      }
    }

    return {
      isVictoryConfirmed: false,
      turnsElapsed: 0,
      honorsEarned: state.currentHonors,
      message: `Hosted raid still in progress (Boss HP: ${state.bossHpPct.toFixed(1)}%)`,
      durationMs: Date.now() - t0
    };
  }
}

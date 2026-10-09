// src/services/scheduler/daily-routine.orchestrator.ts
import fs from 'fs';
import path from 'path';
import { CdpConnectionManager } from '../../cdp-connection.js';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import { UniversalWorkflowEngine } from '../../engines/universal-workflow.engine.js';
import { DailyHostEngine } from '../../engines/daily-host.engine.js';
import { TemplateParser } from '../../templates/template-parser.js';
import { AccountRegistry } from '../../auth/account-registry.js';
import { AccountAuthManager } from '../../auth/account-auth.manager.js';
import { AccountConfig } from '../../types/account.types.js';
import { DailyHostExecutionSummary, DailyHostExecutionOptions } from '../../domain/daily-host/daily-host.types.js';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { GoldBarTrackerService } from '../telemetry/gold-bar-tracker.service.js';

export interface DailyRoutineResult {
  account: string;
  success: boolean;
  startedAt: string;
  completedAt: string;
  proSkipsCleared: boolean;
  proSkipsDurationMs: number;
  hostSummary?: DailyHostExecutionSummary;
  error?: string;
  reportPath?: string;
}

export class DailyRoutineOrchestrator {
  private baseLogDir = path.resolve(process.cwd(), 'logs/daily-routine');

  constructor() {
    if (!fs.existsSync(this.baseLogDir)) {
      fs.mkdirSync(this.baseLogDir, { recursive: true });
    }
  }

  /**
   * Executes the full daily reset pipeline:
   * 1. Universal Pro Skips (`daily`)
   * 2. Daily Raid Hosting with Diagnostic Failure Retry (`daily:host`)
   * 3. Markdown Audit Persistence & Discord DM Broadcast
   */
  public async executeRoutine(
    account: AccountConfig,
    options: {
      isWindowed?: boolean;
      skipProSkips?: boolean;
      skipHosts?: boolean;
      hostOptions?: DailyHostExecutionOptions;
    } = {}
  ): Promise<DailyRoutineResult> {
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    const isHeadless = !options.isWindowed;

    console.log('\n========================================================================');
    console.log('       🌅 Granblue Fantasy - Autonomous Daily Reset Orchestrator         ');
    console.log('========================================================================');
    console.log(`Account:           ${account.name} (${account.id})`);
    console.log(`Server Time:       ${GoldBarTrackerService.formatJstTimestamp()}`);
    console.log(`GBF Server Day:    ${GoldBarTrackerService.getGbfDay()} (05:00 JST Reset)`);
    console.log(`Phase 1:           ${options.skipProSkips ? 'SKIPPED' : 'Universal Pro Skips (bun run daily)'}`);
    console.log(`Phase 2:           ${options.skipHosts ? 'SKIPPED' : 'Daily Raid Hosting & Self-Healing Retry (bun run daily:host)'}`);
    console.log(`Browser Mode:      ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
    console.log('========================================================================\n');

    const cdp = new CdpConnectionManager();
    let proSkipsCleared = false;
    let proSkipsDurationMs = 0;
    let hostSummary: DailyHostExecutionSummary | undefined;

    try {
      const conn = await cdp.connectWithRetry(6, 2000, isHeadless, {
        cdpPort: account.cdpPort,
        profileDir: account.profileDir,
        proxy: account.proxy
      });

      let activePage = conn.page;

      const profile = await AccountAuthManager.ensureAuthenticated(activePage, account);
      if (!profile) {
        throw new Error(`Account [${account.name}] could not be authenticated.`);
      }
      console.log(`[DailyRoutine] ✅ Verified In-Game Identity: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})\n`);

      const sentinel = new SentinelWatchdog(activePage);
      await sentinel.assertSafe();

      cdp.onReconnect((newPage) => {
        console.log(`[DailyRoutine] 🔄 Rebinding page after CDP reconnect for [${account.id}]...`);
        sentinel.updatePage(newPage);
        activePage = newPage;
      });

      // ======================================================================
      // PHASE 1: Universal Pro Skips (`daily`)
      // ======================================================================
      if (!options.skipProSkips) {
        console.log('------------------------------------------------------------------------');
        console.log('  ▶️ PHASE 1: Executing Daily Pro Skips (Favorites / Hard+ / Omega / Halo)');
        console.log('------------------------------------------------------------------------');
        const p1Start = Date.now();

        try {
          const dailyTemplate = TemplateParser.loadTemplate('daily-universal');
          const workflowEngine = new UniversalWorkflowEngine(activePage, sentinel, dailyTemplate, account.id);

          cdp.onReconnect((p) => workflowEngine.updatePage(p));

          const skipSummary = await workflowEngine.runLoop({
            runs: 1,
            autoReplenishAp: true,
            autoReplenishEp: true,
            logPath: `logs/workflow-${account.id}-daily-universal.md`
          });

          proSkipsCleared = skipSummary.totalRunsCompleted > 0;
          proSkipsDurationMs = Date.now() - p1Start;
          console.log(`[DailyRoutine] ✅ Phase 1: Pro Skips completed in ${(proSkipsDurationMs / 1000).toFixed(1)}s!\n`);
        } catch (skipErr: any) {
          console.warn(`[DailyRoutine] ⚠️ Phase 1 warning (Pro Skips): ${skipErr.message}. Continuing to Phase 2...`);
          proSkipsDurationMs = Date.now() - p1Start;
        }
      }

      // ======================================================================
      // PHASE 2: Daily Raid Hosting Suite with Critical Failure Retry (`daily:host`)
      // ======================================================================
      if (!options.skipHosts) {
        console.log('------------------------------------------------------------------------');
        console.log('  ▶️ PHASE 2: Executing Daily Raid Hosting & Self-Healing Retry Pass');
        console.log('------------------------------------------------------------------------');

        const hostEngine = new DailyHostEngine(activePage, sentinel, account.id);
        cdp.onReconnect((p) => hostEngine.updatePage(p));

        const hostOpts: DailyHostExecutionOptions = {
          categoryFilter: 'all',
          autoReplenishAp: true,
          maxTurnsPerRaid: 35,
          enableAssistInterleaving: true,
          autoRetryFailures: true,
          maxFailureRetries: 2,
          ...options.hostOptions
        };

        hostSummary = await hostEngine.runDailyHost(hostOpts);
        console.log(`[DailyRoutine] ✅ Phase 2: Daily Raid Hosting completed!\n`);
      }

      const completedAt = new Date().toISOString();
      const reportPath = this.persistRoutineReport(account, startedAt, completedAt, proSkipsCleared, proSkipsDurationMs, hostSummary);

      // ======================================================================
      // PHASE 3: Discord Executive Digest
      // ======================================================================
      await this.dispatchDiscordSummary(account, startedAt, completedAt, proSkipsCleared, hostSummary);

      await cdp.disconnect();

      return {
        account: account.name,
        success: true,
        startedAt,
        completedAt,
        proSkipsCleared,
        proSkipsDurationMs,
        hostSummary,
        reportPath
      };

    } catch (err: any) {
      console.error(`[DailyRoutine] ❌ Fatal error executing daily routine for [${account.name}]:`, err.message);
      try { await cdp.disconnect(); } catch {}

      const completedAt = new Date().toISOString();
      return {
        account: account.name,
        success: false,
        startedAt,
        completedAt,
        proSkipsCleared,
        proSkipsDurationMs,
        error: err.message
      };
    }
  }

  /**
   * Writes consolidated Markdown audit report to logs/daily-routine/
   */
  private persistRoutineReport(
    account: AccountConfig,
    startedAt: string,
    completedAt: string,
    proSkipsCleared: boolean,
    proSkipsDurationMs: number,
    hostSummary?: DailyHostExecutionSummary
  ): string {
    const gbfDay = GoldBarTrackerService.getGbfDay();
    const filePath = path.join(this.baseLogDir, `daily-routine-${account.id}-${gbfDay}.md`);

    const lines: string[] = [
      `# 🌅 Granblue Fantasy Daily Reset Routine Audit Report`,
      ``,
      `> - **Account:** \`${account.name} (${account.id})\``,
      `> - **GBF Server Day (05:00 JST Reset):** \`${gbfDay}\``,
      `> - **Execution Window:** \`${startedAt}\` → \`${completedAt}\``,
      `> - **Phase 1 (Pro Skips):** ${proSkipsCleared ? '✅ All Cleared' : '⚠️ Partial/Skipped'} (${(proSkipsDurationMs / 1000).toFixed(1)}s)`,
      `> - **Phase 2 (Raid Hosting):** ${hostSummary ? `✅ ${hostSummary.clearedCount}/${hostSummary.totalRaidsTargeted} Cleared` : 'Skipped'}`,
      `> - **Self-Healing Recoveries:** ${hostSummary?.retriedClearedCount ?? 0} raids recovered from transient errors 🛡️`,
      ``,
      `---`,
      ``,
      `## 🛡️ Hosted Raids Breakdown & Critical Analysis`,
      ``,
      `| Category | Raid Name | Outcome | Turns | Honors | Diagnostic Analysis / Notes |`,
      `| :--- | :--- | :---: | :---: | :---: | :--- |`
    ];

    if (hostSummary) {
      for (const r of hostSummary.executionRecords) {
        const icon = r.status === 'CLEARED' ? '✅ CLEARED' : r.status === 'SKIPPED_LIMIT' ? '⏭️ LIMIT REACHED' : r.status === 'SKIPPED_NO_MATERIAL' ? '⚠️ NO MATERIALS' : '❌ FAILED';
        lines.push(`| ${r.raid.category.toUpperCase()} | ${r.raid.name} | **${icon}** | ${r.turnsElapsed} | ${r.honorsEarned.toLocaleString()} pt | ${r.message} |`);
      }
    }

    lines.push(``);
    lines.push(`*Generated autonomously by Guranburuing Daily Reset Routine Orchestrator.*`);

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`[DailyRoutine] 📄 Executive daily report saved to: ${filePath}\n`);
    return filePath;
  }

  /**
   * Dispatches formatted Executive Daily Summary to Discord DM.
   */
  private async dispatchDiscordSummary(
    account: AccountConfig,
    startedAt: string,
    completedAt: string,
    proSkipsCleared: boolean,
    hostSummary?: DailyHostExecutionSummary
  ): Promise<void> {
    if (!discordDmRelay.isConfigured()) return;

    try {
      const gbfDay = GoldBarTrackerService.getGbfDay();
      const durationSec = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
      const durMinStr = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

      const lines: string[] = [
        '🌅 **GBF Daily Reset Routine Completed**',
        `• **Account**: **${account.name}** (\`${account.id}\`)`,
        `• **GBF Server Day**: \`${gbfDay}\` (05:00 JST Reset)`,
        `• **Duration**: \`${durMinStr}\``,
        `• **Pro Skips**: ${proSkipsCleared ? '✅ All Pro Skips Cleared' : '⚠️ Skips Completed with Warnings'}`
      ];

      if (hostSummary) {
        lines.push(
          `• **Raid Hosting**: **${hostSummary.clearedCount}/${hostSummary.totalRaidsTargeted} Cleared** ` +
          `(${hostSummary.skippedNoMaterialCount} no mats, ${hostSummary.skippedLimitCount} limit)`
        );

        if ((hostSummary.retriedClearedCount ?? 0) > 0) {
          lines.push(`• **Self-Healing**: 🛡️ **Recovered ${hostSummary.retriedClearedCount} raid(s)** after transient modal/network retry!`);
        }
      }

      lines.push('\n*Daily reset tasks verified & completed autonomously.*');

      await discordDmRelay.sendMessage(lines.join('\n'));
      console.log('[DailyRoutine] 📤 Discord executive summary dispatched to DM.');
    } catch (err: any) {
      console.warn(`[DailyRoutine] Could not send Discord summary: ${err.message}`);
    }
  }
}

export const dailyRoutineOrchestrator = new DailyRoutineOrchestrator();

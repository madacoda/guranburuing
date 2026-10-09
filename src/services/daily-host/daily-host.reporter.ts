// src/services/daily-host/daily-host.reporter.ts
import fs from 'fs';
import path from 'path';
import { IDailyHostReporter } from '../../domain/daily-host/daily-host.interfaces.js';
import { DailyHostExecutionSummary } from '../../domain/daily-host/daily-host.types.js';

export class DailyHostReporter implements IDailyHostReporter {
  /**
   * Outputs formatted console summary.
   */
  public renderConsoleSummary(summary: DailyHostExecutionSummary): void {
    console.log('\n========================================================================');
    console.log('             Granblue Fantasy Daily Host Routine Summary                 ');
    console.log('========================================================================');
    console.log(`Account:               ${summary.accountId}`);
    console.log(`Total Raids Target:    ${summary.totalRaidsTargeted}`);
    console.log(`Cleared (Victories):   ${summary.clearedCount}`);
    console.log(`Skipped (No Material): ${summary.skippedNoMaterialCount}`);
    console.log(`Skipped (Daily Limit): ${summary.skippedLimitCount}`);
    console.log(`Failed:                ${summary.failedCount}`);
    if ((summary.retriedCount ?? 0) > 0) {
      console.log(`Self-Healing Retries:  ${summary.retriedCount} attempt(s) (Recovered: ${summary.retriedClearedCount ?? 0} cleared) 🛡️`);
    }
    console.log('------------------------------------------------------------------------');

    for (const r of summary.executionRecords) {
      const icon =
        r.status === 'CLEARED'
          ? '✅'
          : r.status === 'SKIPPED_LIMIT'
          ? '⏭️'
          : r.status === 'SKIPPED_NO_MATERIAL'
          ? '⚠️'
          : '❌';

      const padCategory = `[${r.raid.category.toUpperCase().padEnd(6)}]`;
      const padName = r.raid.name.padEnd(36);
      const padStatus = r.status.padEnd(20);
      const honorsStr = r.honorsEarned > 0 ? `${r.honorsEarned.toLocaleString()} pt` : '0 pt';

      console.log(`${icon} ${padCategory} ${padName}: ${padStatus} (${r.turnsElapsed} turns, ${honorsStr}, ${r.message})`);
    }
    console.log('========================================================================\n');
  }

  /**
   * Formats and writes markdown report file to disk.
   */
  public persistMarkdownAuditReport(summary: DailyHostExecutionSummary, logPath?: string): string {
    const dateStr = summary.startedAt.split('T')[0];
    const targetDir = logPath || path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, `daily-host-${summary.accountId}-${dateStr}.md`);

    const lines: string[] = [
      `# Granblue Fantasy Daily Host Report`,
      ``,
      `- **Account:** \`${summary.accountId}\``,
      `- **Started At:** ${summary.startedAt}`,
      `- **Completed At:** ${summary.completedAt}`,
      `- **Total Raids Targeted:** ${summary.totalRaidsTargeted}`,
      `- **Cleared (Victories):** ${summary.clearedCount}`,
      `- **Skipped (No Material):** ${summary.skippedNoMaterialCount}`,
      `- **Skipped (Daily Limit):** ${summary.skippedLimitCount}`,
      `- **Failed:** ${summary.failedCount}`,
      `- **Self-Healing Retries:** ${summary.retriedCount ?? 0} attempts (Recovered: ${summary.retriedClearedCount ?? 0} cleared)`,
      ``,
      `## Detailed Raid Breakdown`,
      ``,
      `| Category | Raid Name | Status | Turns | Honors | Duration (s) | Notes |`,
      `| :--- | :--- | :--- | :---: | :---: | :---: | :--- |`
    ];

    for (const r of summary.executionRecords) {
      const durSec = (r.durationMs / 1000).toFixed(1);
      const honorsFormatted = r.honorsEarned.toLocaleString();
      lines.push(
        `| ${r.raid.category.toUpperCase()} | ${r.raid.name} | **${r.status}** | ${r.turnsElapsed} | ${honorsFormatted} | ${durSec}s | ${r.message} |`
      );
    }

    lines.push(``);
    lines.push(`*Generated autonomously by Guranburuing Daily Host Engine.*`);

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    console.log(`[DailyHost:Reporter] 📄 Detailed run report saved to: ${filePath}\n`);
    return filePath;
  }
}

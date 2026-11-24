// src/cli/audit-steps.ts
import * as fs from 'fs';
import * as path from 'path';
import { StepExecutionMonitorService } from '../engines/universal/step-execution-monitor.service.js';

function printUsage(): void {
  console.log('Usage:');
  console.log('  bun run step:audit                          # Audit latest persisted session runs (data/step-audit-ledger.json)');
  console.log('  bun run step:audit <workflow-filter>        # Filter persisted ledger by workflow or account name');
  console.log('  bun run step:audit --log <path-to-log.txt>  # Parse and audit a raw console log file containing [Monitor] lines');
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  const logIdx = args.findIndex(a => a === '--log' || a === '-l');
  if (logIdx !== -1 && args[logIdx + 1]) {
    const logPath = path.resolve(process.cwd(), args[logIdx + 1]);
    if (!fs.existsSync(logPath)) {
      console.error(`[StepAudit] ❌ Log file not found: ${logPath}`);
      process.exit(1);
    }
    const rawLog = fs.readFileSync(logPath, 'utf8');
    const receipts = StepExecutionMonitorService.parseMonitorLogText(rawLog);
    const hotspots = StepExecutionMonitorService.aggregateHotspots(receipts);
    const findings = StepExecutionMonitorService.diagnoseReceipts(receipts);
    console.log(
      StepExecutionMonitorService.formatAuditReportTable(
        hotspots,
        findings,
        `Step Failure & Bottleneck Audit (Log: ${path.basename(logPath)})`
      )
    );
    return;
  }

  const filter = args[0]?.toLowerCase().trim() || '';
  const ledgerPath = path.resolve(process.cwd(), 'data', 'step-audit-ledger.json');
  if (!fs.existsSync(ledgerPath)) {
    console.log(`[StepAudit] No persisted step audit ledger found at ${ledgerPath} yet.`);
    console.log('[StepAudit] Run any combat workflow or pass --log <logfile> to audit raw console logs.');
    return;
  }

  let ledger: Record<string, any> = {};
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch (err: any) {
    console.error(`[StepAudit] Failed to parse ${ledgerPath}: ${err.message}`);
    process.exit(1);
  }

  const normalizeTokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const filterTokens = normalizeTokens(filter);

  const entries = Object.values(ledger).filter((entry: any) => {
    if (filterTokens.length === 0) return true;
    const keyStr = `${entry?.templateName || ''} ${entry?.accountId || ''}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ');
    return filterTokens.every(tok => keyStr.includes(tok));
  });

  if (entries.length === 0) {
    console.log(`[StepAudit] No matching workflow entries found in ${ledgerPath}${filter ? ` for filter "${filter}"` : ''}.`);
    return;
  }

  for (const entry of entries) {
    const streakPart = entry.consecutiveCleanRuns !== undefined ? ` | Clean Streak: ${entry.consecutiveCleanRuns}` : '';
    const title = `${entry.templateName} [${entry.accountId}] | Runs: ${entry.totalRunsAudited}${streakPart} | Updated: ${entry.updatedAt}`;
    console.log(
      StepExecutionMonitorService.formatAuditReportTable(
        entry.hotspots || [],
        entry.latestFindings || [],
        title
      )
    );
    console.log('');
  }
}

main();

#!/usr/bin/env bun
// src/cli/run-siete-check.ts
import fs from 'fs';
import path from 'path';
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { SieteReadinessCheckerService } from '../services/combat/siete-readiness-checker.service.js';

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = args.find(a => a.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const isOffline = args.includes('--offline') || args.includes('--cached');
  const isWindowed = args.includes('--windowed');
  const isJson = args.includes('--json');
  const isMarkdown = args.includes('--markdown');
  const rosterFileArg = getFlagValue(args, '--roster');
  const archetypeArg = getFlagValue(args, '--archetype');

  const positionalArgs = args.filter(
    (a, idx) =>
      !a.startsWith('--') &&
      args[idx - 1] !== '--roster' &&
      args[idx - 1] !== '--archetype'
  );
  const accountId = positionalArgs[0] || 'acc1';

  const checker = new SieteReadinessCheckerService();

  // 1. Offline or explicit --roster file evaluation
  if (isOffline || rosterFileArg) {
    const defaultRosterPath = path.resolve(
      process.cwd(),
      'data/combat/siete-roster.example.json'
    );
    const targetPath = rosterFileArg
      ? path.resolve(process.cwd(), rosterFileArg)
      : defaultRosterPath;

    if (!fs.existsSync(targetPath)) {
      console.error(`[Siete Check] Roster file not found: ${targetPath}`);
      process.exit(1);
    }

    const roster = checker.loadRosterFromFile(targetPath);
    if (accountId) roster.accountId = accountId;
    const report = checker.evaluateRoster(roster, archetypeArg);
    checker.persistReportArtifacts(roster, report);

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else if (isMarkdown) {
      console.log(checker.formatMarkdownReport(report));
    } else {
      console.log(checker.formatConsoleReport(report));
    }
    process.exit(0);
  }

  // 2. Live CDP Scrape + Evaluation
  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[Siete Check] Account "${accountId}" not found in AccountRegistry.`);
    process.exit(1);
  }

  const cdp = new CdpConnectionManager();
  try {
    const { page } = await cdp.connectWithRetry(3, 1500, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir
    });

    const report = await checker.auditFromLiveCdpPage(
      page as any,
      account.id
    );

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else if (isMarkdown) {
      console.log(checker.formatMarkdownReport(report));
    } else {
      console.log(checker.formatConsoleReport(report));
    }

    await cdp.disconnect();
    process.exit(0);
  } catch (err: any) {
    console.warn(
      `[Siete Check] Live CDP unavailable (${err.message}); evaluating reference Fire roster (data/combat/siete-roster.example.json)...`
    );
    try {
      await cdp.disconnect();
    } catch {}

    const roster = checker.loadRosterFromFile('data/combat/siete-roster.example.json');
    roster.accountId = account.id;
    const report = checker.evaluateRoster(roster, archetypeArg);
    checker.persistReportArtifacts(roster, report);

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else if (isMarkdown) {
      console.log(checker.formatMarkdownReport(report));
    } else {
      console.log(checker.formatConsoleReport(report));
    }
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Siete Check Fatal Error]', err);
  process.exit(1);
});

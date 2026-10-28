#!/usr/bin/env bun
// src/cli/run-revans-check.ts
import fs from 'fs';
import path from 'path';
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { RevansReadinessCheckerService } from '../services/combat/revans-readiness-checker.service.js';
import { RevansRaidId } from '../domain/revans/index.js';

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  const prefix = `${flag}=`;
  const eqArg = args.find(a => a.startsWith(prefix));
  return eqArg ? eqArg.slice(prefix.length) : undefined;
}

const KNOWN_RAID_TOKENS = new Set([
  'all',
  'revans',
  'mugen',
  'diaspora',
  'siegfried',
  'sieg',
  'siete',
  'seofon',
  'cosmos',
  'agastia'
]);

async function main() {
  const args = process.argv.slice(2);
  const isOffline = args.includes('--offline') || args.includes('--cached');
  const isWindowed = args.includes('--windowed');
  const isJson = args.includes('--json');
  const isMarkdown = args.includes('--markdown');
  const rosterFileArg = getFlagValue(args, '--roster');
  const raidFlagArg = getFlagValue(args, '--raid');

  const positionalArgs = args.filter(
    (a, idx) =>
      !a.startsWith('--') &&
      args[idx - 1] !== '--roster' &&
      args[idx - 1] !== '--raid'
  );

  let raidToken = raidFlagArg || 'all';
  let accountId = 'acc1';

  for (const pos of positionalArgs) {
    const lower = pos.toLowerCase();
    if (KNOWN_RAID_TOKENS.has(lower)) {
      raidToken = lower;
    } else {
      accountId = pos;
    }
  }

  const targetRaid = RevansReadinessCheckerService.resolveRaidId(raidToken);
  const checker = new RevansReadinessCheckerService();

  const printOutput = (
    singleReport?: ReturnType<RevansReadinessCheckerService['evaluateSingleRaid']>,
    allReport?: ReturnType<RevansReadinessCheckerService['evaluateAllRaids']>
  ) => {
    if (singleReport) {
      if (isJson) {
        console.log(JSON.stringify(singleReport, null, 2));
      } else if (isMarkdown) {
        console.log(checker.formatSingleRaidMarkdownReport(singleReport));
      } else {
        console.log(checker.formatSingleRaidConsoleReport(singleReport));
      }
    } else if (allReport) {
      if (isJson) {
        console.log(JSON.stringify(allReport, null, 2));
      } else if (isMarkdown) {
        console.log(checker.formatAllRaidsMarkdownReport(allReport));
      } else {
        console.log(checker.formatAllRaidsConsoleReport(allReport));
      }
    }
  };

  // 1. Offline or explicit --roster file evaluation
  if (isOffline || rosterFileArg) {
    const defaultRosterPath = path.resolve(
      process.cwd(),
      'data/combat/revans-roster.example.json'
    );
    const targetPath = rosterFileArg
      ? path.resolve(process.cwd(), rosterFileArg)
      : defaultRosterPath;

    if (!fs.existsSync(targetPath)) {
      console.error(`[Revans Check] Roster file not found: ${targetPath}`);
      process.exit(1);
    }

    const multiRoster = checker.loadMultiElementRosterFromFile(targetPath);
    if (accountId) multiRoster.accountId = accountId;

    if (targetRaid === 'all') {
      const summary = checker.evaluateAllRaids(multiRoster);
      checker.persistAllRaidsArtifacts(multiRoster, summary);
      printOutput(undefined, summary);
    } else {
      const report = checker.evaluateSingleRaid(targetRaid as RevansRaidId, multiRoster);
      checker.persistSingleRaidArtifacts(report);
      printOutput(report, undefined);
    }
    process.exit(0);
  }

  // 2. Live CDP Scrape + Evaluation
  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[Revans Check] Account "${accountId}" not found in AccountRegistry.`);
    process.exit(1);
  }

  const cdp = new CdpConnectionManager();
  try {
    const { page } = await cdp.connectWithRetry(3, 1500, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir
    });

    if (targetRaid === 'all') {
      const summary = await checker.auditAllRaidsFromLiveCdpPage(page as any, account.id);
      printOutput(undefined, summary);
    } else {
      const report = await checker.auditRaidFromLiveCdpPage(
        page as any,
        targetRaid as RevansRaidId,
        account.id
      );
      printOutput(report, undefined);
    }

    await cdp.disconnect();
    process.exit(0);
  } catch (err: any) {
    console.warn(
      `[Revans Check] Live CDP unavailable (${err.message}); evaluating reference 6-element roster (data/combat/revans-roster.example.json)...`
    );
    try {
      await cdp.disconnect();
    } catch {}

    const multiRoster = checker.loadMultiElementRosterFromFile(
      'data/combat/revans-roster.example.json'
    );
    multiRoster.accountId = account.id;

    if (targetRaid === 'all') {
      const summary = checker.evaluateAllRaids(multiRoster);
      checker.persistAllRaidsArtifacts(multiRoster, summary);
      printOutput(undefined, summary);
    } else {
      const report = checker.evaluateSingleRaid(targetRaid as RevansRaidId, multiRoster);
      checker.persistSingleRaidArtifacts(report);
      printOutput(report, undefined);
    }
    process.exit(0);
  }
}

main().catch(err => {
  console.error('[Revans Check Fatal Error]', err);
  process.exit(1);
});

#!/usr/bin/env bun
// src/cli/run-siete-setup.ts
import fs from 'fs';
import path from 'path';
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { SieteArchetypeId } from '../domain/siete/index.js';
import { SieteAutoSetupService } from '../services/combat/siete-auto-setup.service.js';

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
  const isDryRun = args.includes('--dry-run') || args.includes('--dry');
  const isJson = args.includes('--json');
  const isWindowed = args.includes('--windowed');
  const noWorkflowSync = args.includes('--no-workflow-sync');
  const activateDeck = args.includes('--activate');
  const deckFlag = getFlagValue(args, '--deck') || getFlagValue(args, '--party');
  const archetypeFlag = getFlagValue(args, '--archetype') as SieteArchetypeId | undefined;

  const positionalArgs = args.filter(
    (a, idx) =>
      !a.startsWith('--') &&
      (idx === 0 || (args[idx - 1] !== '--deck' && args[idx - 1] !== '--party' && args[idx - 1] !== '--archetype'))
  );

  let accountId = 'acc1';
  let deckTargetInput: string = deckFlag || 'ex-a-3';

  if (positionalArgs.length >= 1) {
    const first = positionalArgs[0];
    if (AccountRegistry.getAccount(first) || first.startsWith('acc')) {
      accountId = first;
      if (positionalArgs.length >= 2 && !deckFlag) {
        deckTargetInput = positionalArgs.slice(1).join(' ');
      }
    } else if (!deckFlag) {
      deckTargetInput = positionalArgs.join(' ');
    }
  }

  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[SieteSetup] Account "${accountId}" not found in AccountRegistry.`);
    process.exit(1);
  }

  const cdp = new CdpConnectionManager();

  try {
    const { page } = await cdp.connectWithRetry(3, 1500, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir
    });
    const autoSetup = new SieteAutoSetupService();

    const result = await autoSetup.executeAutoSetup(page, {
      accountId,
      deckTarget: deckTargetInput,
      archetypeId: archetypeFlag,
      dryRun: isDryRun,
      syncWorkflow: !noWorkflowSync,
      activateDeck
    });

    // Save JSON report to logs/siete-auto-setup-report.json
    const logsDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(logsDir, 'siete-auto-setup-report.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf-8'
    );

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(autoSetup.formatConsoleSummary(result));
    }

    await cdp.disconnect();
    process.exit(result.allMutationsSucceeded ? 0 : 1);
  } catch (err: any) {
    console.error(`[SieteSetup] Fatal error: ${err?.message || err}`);
    await cdp.disconnect().catch(() => {});
    process.exit(1);
  }
}

main();

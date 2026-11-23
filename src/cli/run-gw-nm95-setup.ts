#!/usr/bin/env bun
// src/cli/run-gw-nm95-setup.ts
import fs from 'fs';
import path from 'path';
import { AccountRegistry } from '../auth/account-registry.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import {
  GwNm95DarkProfileId,
  GwNm95DarkSetupResult,
  GwNm95DarkSetupService
} from '../services/gw/gw-nm95-dark-setup.service.js';

function getFlagValue(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const eqArg = args.find(a => a.startsWith(prefix));
  if (eqArg) return eqArg.slice(prefix.length);
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) {
    return args[idx + 1];
  }
  return undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const isOffline = args.includes('--offline') || args.includes('--sim');
  const isApply = args.includes('--apply');
  const isDryRun = args.includes('--dry-run') || args.includes('--audit') || (!isOffline && !isApply);
  const isJson = args.includes('--json');
  const isWindowed = args.includes('--windowed') || args.includes('-w');
  const forceApply = args.includes('--force');
  const noTemplate = args.includes('--no-template');

  const profileRaw = (getFlagValue(args, '--profile') || 'auto').toLowerCase();
  const profile: GwNm95DarkProfileId | 'auto' =
    profileRaw === 'fast' || profileRaw === 'safe' || profileRaw === 'legacy' ? profileRaw : 'auto';

  const speedRaw = getFlagValue(args, '--speed')?.toLowerCase();
  const speedProfile: 'fast' | 'turbo' | undefined =
    speedRaw === 'fast' || speedRaw === 'turbo' ? speedRaw : undefined;

  const deckPriority = Number(getFlagValue(args, '--deck') || 133) || 133;
  const accountId =
    getFlagValue(args, '--account') ||
    args.find(a => /^acc\d+$/i.test(a)) ||
    'acc1';

  const saveReport = (result: GwNm95DarkSetupResult) => {
    const logsDir = path.resolve(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, 'gw-nm95-dark-setup-report.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf-8'
    );
  };

  if (isOffline) {
    const result = GwNm95DarkSetupService.runOfflineSimulation({
      accountId,
      deckPriority,
      profile,
      speedProfile
    });
    saveReport(result);
    console.log(isJson ? JSON.stringify(result, null, 2) : GwNm95DarkSetupService.formatReport(result));
    process.exit(0);
  }

  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[GwNm95Setup] Account "${accountId}" not found.`);
    process.exit(1);
  }

  const cdp = new CdpConnectionManager();
  try {
    const { page } = await cdp.connectWithRetry(3, 1500, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir,
      proxy: account.proxy
    });
    const service = new GwNm95DarkSetupService();
    const result = await service.executeSetup(page, {
      accountId,
      deckPriority,
      profile,
      speedProfile,
      dryRun: isDryRun && !isApply,
      syncTemplate: !noTemplate,
      force: forceApply
    });

    saveReport(result);
    console.log(isJson ? JSON.stringify(result, null, 2) : GwNm95DarkSetupService.formatReport(result));
    await cdp.disconnect();

    if (result.blockedByActiveWorkflow) {
      process.exit(2);
    }
    const allOk = result.subAuraMutations.every(m => !m.applied || m.success);
    process.exit(allOk ? 0 : 1);
  } catch (err: any) {
    console.error(`[GwNm95Setup] Fatal error: ${err?.message || err}`);
    await cdp.disconnect().catch(() => {});
    process.exit(1);
  }
}

main();

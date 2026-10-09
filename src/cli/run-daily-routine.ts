#!/usr/bin/env bun
// src/cli/run-daily-routine.ts
import { AccountRegistry } from '../auth/account-registry.js';
import { dailyRoutineOrchestrator } from '../services/scheduler/daily-routine.orchestrator.js';

async function main() {
  const args = process.argv.slice(2);
  const isWindowed = args.includes('--windowed');
  const skipProSkips = args.includes('--no-skips') || args.includes('--skip-pro');
  const skipHosts = args.includes('--no-hosts') || args.includes('--skip-hosts');

  // Identify account positional argument (e.g. 'acc1', 'acc2')
  const accountArg = args.find((a) => !a.startsWith('--'));
  const accountId = accountArg || 'acc1';

  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[Error] Account "${accountId}" not found in registry.`);
    process.exit(1);
  }

  const result = await dailyRoutineOrchestrator.executeRoutine(account, {
    isWindowed,
    skipProSkips,
    skipHosts
  });

  if (result.success) {
    console.log(`\n🎉 Daily Reset Routine completed successfully for [${account.name}]!`);
    process.exit(0);
  } else {
    console.error(`\n❌ Daily Reset Routine encountered errors:`, result.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});

#!/usr/bin/env bun
// src/cli/run-daily-scheduler.ts
import { dailyResetScheduler } from '../services/scheduler/daily-reset.scheduler.js';

async function main() {
  const args = process.argv.slice(2);
  const isWindowed = args.includes('--windowed');
  const skipProSkips = args.includes('--no-skips');
  const skipHosts = args.includes('--no-hosts');
  const triggerNow = args.includes('--now');

  let targetHourJst: number | undefined;
  const hourFlagIdx = args.findIndex((a) => a === '--hour' || a.startsWith('--hour='));
  if (hourFlagIdx !== -1) {
    const rawVal = args[hourFlagIdx].includes('=')
      ? args[hourFlagIdx].split('=')[1]
      : args[hourFlagIdx + 1];
    const parsed = Number(rawVal);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 23) {
      targetHourJst = parsed;
    }
  }

  const accountArg = args.find((a, idx) => !a.startsWith('--') && (hourFlagIdx === -1 || idx !== hourFlagIdx + 1 || args[hourFlagIdx].includes('=')));
  const accountId = accountArg || 'acc1';

  if (triggerNow) {
    console.log('[Scheduler CLI] --now flag detected. Executing routine immediately...');
    await dailyResetScheduler.triggerNow(undefined, {
      accountId,
      isWindowed,
      skipProSkips,
      skipHosts
    });
    return;
  }

  dailyResetScheduler.startDaemon({
    accountId,
    isWindowed,
    skipProSkips,
    skipHosts,
    targetHourJst
  });

  // Handle graceful termination
  process.on('SIGINT', () => {
    console.log('\n[Scheduler CLI] Received SIGINT. Shutting down gracefully...');
    dailyResetScheduler.stopDaemon();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Scheduler CLI] Received SIGTERM. Shutting down gracefully...');
    dailyResetScheduler.stopDaemon();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});

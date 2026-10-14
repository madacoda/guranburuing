#!/usr/bin/env bun
// src/cli/run-human-cadence.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { HumanCadenceOrchestrator } from '../services/behavior/human-cadence-orchestrator.service.js';

async function main() {
  const args = process.argv.slice(2);
  const isWindowed = args.includes('--windowed');

  // Parse custom parameters
  const cyclesArg = args.find(a => a.startsWith('--cycles='));
  const totalCycles = cyclesArg ? parseInt(cyclesArg.split('=')[1], 10) : 3;

  const gbArg = args.find(a => a.startsWith('--gb=') || a.startsWith('--gb-raids='));
  const gbRaidsPerCycle = gbArg ? parseInt(gbArg.split('=')[1], 10) : 18;

  const restArg = args.find(a => a.startsWith('--rest='));
  const minRestMinutes = restArg ? parseInt(restArg.split('=')[1], 10) : 5;

  const accountArg = args.find((a) => !a.startsWith('--'));
  const accountId = accountArg || 'acc1';

  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[Error] Account "${accountId}" not found in registry.`);
    process.exit(1);
  }

  console.log('========================================================================');
  console.log('       Granblue Fantasy - Human Behavioral Cadence Farming Loop         ');
  console.log('========================================================================');
  console.log(`Account:              ${account.name} (${account.id})`);
  console.log(`Total Cycles:         ${totalCycles}`);
  console.log(`GB Raids / Cycle:     ${gbRaidsPerCycle}`);
  console.log(`Interleaved Leech:    Active (2 - 4 dying raids per cycle)`);
  console.log(`Supply Auditing:      Active (#item checked every cycle)`);
  console.log(`Rest Interval:        ~${minRestMinutes}m - ${minRestMinutes + 7}m per cycle`);
  console.log('========================================================================\n');

  const cdp = new CdpConnectionManager();
  const { page } = await cdp.connectWithRetry(6, 2000, !isWindowed, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir
  });
  const orchestrator = new HumanCadenceOrchestrator(page);

  // Graceful termination
  const cleanup = async () => {
    console.log('\n[HumanCadence CLI] Termination signal received. Stopping gracefully...');
    orchestrator.requestStop();
    try { await cdp.disconnect(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    const summary = await orchestrator.runHumanCadenceLoop({
      totalCycles,
      gbRaidsPerCycle,
      minRestMinutes,
      autoMonthlyShop: true
    });

    console.log(`\n🎉 Human Cadence finished: ${summary.cyclesCompleted} cycles, ${summary.totalGbRaids} GB raids, ${summary.totalGoldBars} Gold Bars dropped.`);
    await cdp.disconnect();
    process.exit(0);
  } catch (err: any) {
    console.error(`\n❌ Error during human cadence run: ${err.message}`);
    try { await cdp.disconnect(); } catch {}
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});

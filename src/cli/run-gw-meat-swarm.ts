// src/cli/run-gw-meat-swarm.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { GwMeatLightEngine } from '../engines/gw-meat-light.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { AccountConfig, SwarmSummary } from '../types/account.types.js';
import { logNormalDelay } from '../human-motor.js';

console.log('========================================================================');
console.log('        Guild War (Unite and Fight) Swarm Meat Farm Runner              ');
console.log('                 (Parallel Multi-Account Headless)                      ');
console.log('========================================================================');

const args = process.argv.slice(2);
const numericArg = args.find(a => !a.startsWith('--') && !isNaN(Number(a)));
let runsPerAccount = Infinity;
if (numericArg) {
  runsPerAccount = Math.max(1, parseInt(numericArg, 10));
}

const enabledAccounts = AccountRegistry.getEnabledAccounts();

if (enabledAccounts.length === 0) {
  console.error('\n❌ No enabled accounts found in accounts.config.json!');
  console.log('👉 Please configure accounts in accounts.config.json and set "enabled": true.');
  process.exit(1);
}

console.log(`[Swarm] Enabled Accounts:     ${enabledAccounts.map(a => `[${a.name} (Port ${a.cdpPort})]`).join(', ')}`);
console.log(`[Swarm] Target Runs / Acct:   ${runsPerAccount === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runsPerAccount}`);
console.log(`[Swarm] Mode:                 100% Silent HEADLESS (--headless=new)`);
console.log(`[Swarm] Total Workers:        ${enabledAccounts.length} parallel instances`);
console.log('========================================================================\n');

// Graceful shutdown handling
let stopRequested = false;
const activeEngines: GwMeatLightEngine[] = [];

process.on('SIGINT', () => {
  if (stopRequested) {
    console.log('\n[Swarm] Force quitting immediately...');
    process.exit(1);
  }
  stopRequested = true;
  console.log('\n[Swarm] ⚠️ Ctrl+C detected. Stopping all worker accounts gracefully...');
  for (const eng of activeEngines) {
    eng.requestStop();
  }
});

interface WorkerResult {
  account: AccountConfig;
  totalRuns: number;
  totalMeat: number;
  durationMs: number;
  averageSec: number;
  logPath: string;
}

async function runWorker(account: AccountConfig, staggerDelayMs: number): Promise<WorkerResult> {
  const prefix = `[Swarm:${account.id}]`;
  const logPath = `logs/gw-meat-${account.id}.md`;

  if (staggerDelayMs > 0) {
    console.log(`${prefix} Staggering startup by ${(staggerDelayMs / 1000).toFixed(1)}s to desynchronize requests...`);
    await new Promise(r => setTimeout(r, staggerDelayMs));
  }

  const cdp = new CdpConnectionManager();
  const startTime = Date.now();

  try {
    console.log(`${prefix} Launching & connecting to Chrome (Port: ${account.cdpPort}, Profile: ${account.profileDir})...`);
    const conn = await cdp.connectWithRetry(6, 2000, true, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir,
      proxy: account.proxy
    });

    const page = conn.page;

    // Check & ensure authentication (0ms check if existing session valid)
    console.log(`${prefix} Verifying session authentication...`);
    const isAuthed = await AccountAuthManager.ensureAuthenticated(page, account);
    if (!isAuthed) {
      throw new Error(`Authentication failed for account [${account.name}].`);
    }

    const sentinel = new SentinelWatchdog(page);
    await sentinel.assertSafe();

    const engine = new GwMeatLightEngine(page, sentinel);
    activeEngines.push(engine);
    await engine.ensureViewportAndMobile();

    console.log(`${prefix} ✅ Worker active! Commencing Meat Farming Loop...`);

    const summary = await engine.runMeatLoop({
      runs: runsPerAccount,
      autoReplenishAp: true,
      logPath,
      onProgress: (res) => {
        console.log(`${prefix} Run ${res.runNumber} cleared in ${(res.durationMs / 1000).toFixed(1)}s | Total Meat: +4 | Honors: 126.120`);
      }
    });

    await cdp.disconnect();

    return {
      account,
      totalRuns: summary.totalRunsCompleted,
      totalMeat: summary.totalMeatGained,
      durationMs: summary.totalDurationMs,
      averageSec: summary.averageDurationSec,
      logPath
    };
  } catch (err: any) {
    console.error(`${prefix} ❌ Worker Error:`, err.message || err);
    try {
      await cdp.disconnect();
    } catch {}
    return {
      account,
      totalRuns: 0,
      totalMeat: 0,
      durationMs: Date.now() - startTime,
      averageSec: 0,
      logPath
    };
  }
}

async function main() {
  const swarmStartTime = Date.now();

  // Run all accounts concurrently, staggering startups by 2.5s to prevent network collision
  const workerPromises = enabledAccounts.map((acct, idx) => {
    return runWorker(acct, idx * 2500);
  });

  const results = await Promise.all(workerPromises);

  const totalDurationMs = Date.now() - swarmStartTime;
  const totalRuns = results.reduce((sum, r) => sum + r.totalRuns, 0);
  const totalMeat = results.reduce((sum, r) => sum + r.totalMeat, 0);

  console.log('\n========================================================================');
  console.log('             Guild War Multi-Account Swarm Session Summary              ');
  console.log('========================================================================');
  console.log(`Total Active Accounts:    ${enabledAccounts.length}`);
  console.log(`Total Battles Cleared:    ${totalRuns} (across all accounts)`);
  console.log(`Total Meat Accumulated:   ${totalMeat} chunks`);
  console.log(`Total Swarm Duration:     ${(totalDurationMs / 1000 / 60).toFixed(1)} minutes`);
  console.log('------------------------------------------------------------------------');
  console.log('Account Breakdown:');
  for (const r of results) {
    console.log(` • [${r.account.name}]: ${r.totalRuns} runs | ${r.totalMeat} meat | avg ${r.averageSec}s | Log: ${r.logPath}`);
  }
  console.log('========================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('[Swarm] Coordinator Error:', err);
  process.exit(1);
});

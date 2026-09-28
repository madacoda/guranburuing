// src/cli/run-gb-pbhl.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { PbhlEngine } from '../engines/pbhl.engine.js';

console.log('=====================================================');
console.log('       Granblue Fantasy - PBHL Gold Bar Hunter       ');
console.log('             (Proto Bahamut HL / gb-pbhl)            ');
console.log('=====================================================');

const runsArg = process.argv[2] || '';
const scoreArg = process.argv[3] || '1480000';

let runs = Infinity;
if (runsArg && !isNaN(Number(runsArg))) {
  runs = Math.max(1, parseInt(runsArg, 10));
}

const targetScore = parseInt(scoreArg, 10) || 1480000;

console.log(`[gb-pbhl] Runs Planned:    ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
console.log(`[gb-pbhl] Honor Threshold: ${targetScore.toLocaleString()} pt`);
console.log(`[gb-pbhl] Claim Interval:  Randomized 3 - 5 raids`);
console.log(`[gb-pbhl] Log Destination: C:\\laragon\\www\\gbf\\logs\\gb-pbhl.md`);

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;
let engine: PbhlEngine | null = null;

try {
  console.log('\n[gb-pbhl] Connecting to Chrome / Iron on port 9222...');
  const conn = await cdp.connectWithRetry();
  page = conn.page;

  console.log(`[gb-pbhl] Connected to: ${await page.title()} (${page.url()})`);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  engine = new PbhlEngine(page, sentinel);

  // Graceful SIGINT (Ctrl+C)
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      console.log('\n[gb-pbhl] Force quitting immediately...');
      process.exit(1);
    }
    sigintReceived = true;
    console.log('\n[gb-pbhl] ⚠️ Ctrl+C detected. Signaling engine to finish current raid and claim rewards...');
    if (engine) engine.requestStop();
  });

  const summary = await engine.runPbhlFarmingLoop({
    runs,
    targetScore,
    autoReplenishEp: true,
    logPath: 'logs/gb-pbhl.md'
  });

  console.log('\n=====================================================');
  console.log('              PBHL Farming Loop Summary              ');
  console.log('=====================================================');
  console.log(`Total Raids Completed:    ${summary.totalRunsCompleted}`);
  console.log(`Gold Bars Found:          ${summary.totalGoldBars}`);
  console.log(`Battles Without Gold Bar: ${summary.battlesWithoutGb}`);
  console.log(`Current Dry Streak:       ${summary.currentDryStreak} battles`);
  console.log(`Empirical Drop Rate:      ${summary.dropRatePct}`);
  console.log(`Total Elapsed Time:       ${(summary.durationMs / 1000 / 60).toFixed(1)} minutes`);
  console.log(`Drop Log Destination:     logs/gb-pbhl.md`);
  console.log('=====================================================\n');

  await cdp.disconnect();
  process.exit(0);
} catch (error: any) {
  if (error.message?.includes('CAPTCHA')) {
    console.log('\n\x07\x07\x07');
    console.log('============================================================');
    console.log(' 🚨 AUTOMATION PAUSED: GBF CAPTCHA / VERIFICATION DETECTED! ');
    console.log('============================================================');
    console.log(' 👉 Browser is focused on the verification challenge.');
    console.log(' 👉 Please complete the verification in your Iron browser.');
    console.log('============================================================\n');

    if (sentinel) {
      const solved = await sentinel.waitForUserToSolveCaptcha();
      if (solved) {
        console.log('🎉 Verification solved! You can now re-run gb-pbhl safely.');
      }
    }
  } else {
    console.error('\n❌ [gb-pbhl] Execution Error:', error.message || error);
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

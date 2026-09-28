// src/cli/run-gb-farm.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { FarmEngine } from '../engines/farm.engine.js';

console.log('========================================================================');
console.log('            Granblue Fantasy - Gold Bar Multi-Raid Rotator             ');
console.log('                   (PBHL + Akasha HL + Grand Order HL)                  ');
console.log('========================================================================');

const runsArg = process.argv[2] || '';

let runs = Infinity;
if (runsArg && !isNaN(Number(runsArg))) {
  runs = Math.max(1, parseInt(runsArg, 10));
}

console.log(`[gb-farm] Target Combined Runs: ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
console.log(`[gb-farm] Raid Rotation Pool:   PBHL (Slot 4) | Akasha (Slot 3) | GO HL (Slot 2)`);
console.log(`[gb-farm] Search Strategy:      Randomized slot check order, instant hand-off`);
console.log(`[gb-farm] Pending Claim Batch:  Randomized 3 - 5 raids`);
console.log(`[gb-farm] Dedicated Drop Logs:  logs/gb-pbhl.md | logs/gb-akasha.md | logs/gb-go.md`);

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;
let engine: FarmEngine | null = null;

try {
  console.log('\n[gb-farm] Connecting to Chrome / Iron on port 9222...');
  const conn = await cdp.connectWithRetry();
  page = conn.page;

  console.log(`[gb-farm] Connected to: ${await page.title()} (${page.url()})`);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  engine = new FarmEngine(page, sentinel);

  // Graceful SIGINT (Ctrl+C)
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      console.log('\n[gb-farm] Force quitting immediately...');
      process.exit(1);
    }
    sigintReceived = true;
    console.log('\n[gb-farm] ⚠️ Ctrl+C detected. Signaling engine to finish current raid and claim rewards...');
    if (engine) engine.requestStop();
  });

  const summary = await engine.runFarmLoop({
    runs,
    autoReplenishEp: true,
    pbhlTargetScore: 1480000,
    akashaTargetScore: 1560000,
    goTargetScore: 1480000
  });

  console.log('\n========================================================================');
  console.log('                     gb-farm Multi-Raid Session Summary                 ');
  console.log('========================================================================');
  console.log(`Total Raids Completed:      ${summary.totalRunsCompleted}`);
  console.log(`Total Gold Bars Dropped:    ${summary.totalGoldBars}`);
  console.log(`Total Session Elapsed Time: ${(summary.durationMs / 1000 / 60).toFixed(1)} minutes`);
  console.log('------------------------------------------------------------------------');
  console.log('Breakdown by Raid Type:');
  console.log(`  • Proto Bahamut HL (PBHL):`);
  console.log(`      - Completed this session: ${summary.raidBreakdown.PBHL.runs}`);
  console.log(`      - Historical Gold Bars:   ${summary.raidBreakdown.PBHL.goldBars}`);
  console.log(`      - Battles without GB:     ${summary.raidBreakdown.PBHL.battlesWithoutGb}`);
  console.log(`      - Current Dry Streak:     ${summary.raidBreakdown.PBHL.dryStreak} battles`);
  console.log(`      - Empirical Drop Rate:    ${summary.raidBreakdown.PBHL.dropRatePct}`);
  console.log(`      - Log File:               logs/gb-pbhl.md`);
  console.log(`  • Akasha HL:`);
  console.log(`      - Completed this session: ${summary.raidBreakdown.AKASHA.runs}`);
  console.log(`      - Historical Gold Bars:   ${summary.raidBreakdown.AKASHA.goldBars}`);
  console.log(`      - Battles without GB:     ${summary.raidBreakdown.AKASHA.battlesWithoutGb}`);
  console.log(`      - Current Dry Streak:     ${summary.raidBreakdown.AKASHA.dryStreak} battles`);
  console.log(`      - Empirical Drop Rate:    ${summary.raidBreakdown.AKASHA.dropRatePct}`);
  console.log(`      - Log File:               logs/gb-akasha.md`);
  console.log(`  • Grand Order HL (GO HL):`);
  console.log(`      - Completed this session: ${summary.raidBreakdown.GO.runs}`);
  console.log(`      - Historical Gold Bars:   ${summary.raidBreakdown.GO.goldBars}`);
  console.log(`      - Battles without GB:     ${summary.raidBreakdown.GO.battlesWithoutGb}`);
  console.log(`      - Current Dry Streak:     ${summary.raidBreakdown.GO.dryStreak} battles`);
  console.log(`      - Empirical Drop Rate:    ${summary.raidBreakdown.GO.dropRatePct}`);
  console.log(`      - Log File:               logs/gb-go.md`);
  console.log('========================================================================\n');

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
        console.log('🎉 Verification solved! You can now re-run gb-farm safely.');
      }
    }
  } else {
    console.error('\n❌ [gb-farm] Execution Error:', error.message || error);
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

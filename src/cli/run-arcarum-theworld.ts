// src/cli/run-arcarum-theworld.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { ArcarumTheWorldEngine } from '../engines/arcarum-theworld.engine.js';

console.log('========================================================================');
console.log('             Arcarum: The World Automated Battle Runner                 ');
console.log('             (Zone Mundus / Quest 819131 / arcarum-theworld)            ');
console.log('========================================================================');

const runsArg = process.argv[2] || '';
const modeArg = process.argv[3] || 'full_auto';

let runs = Infinity;
if (runsArg && !isNaN(Number(runsArg))) {
  runs = Math.max(1, parseInt(runsArg, 10));
}

const mode = (modeArg === 'manual_skills' ? 'manual_skills' : 'full_auto') as 'full_auto' | 'manual_skills';

console.log(`[arcarum-theworld] Target Runs:     ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
console.log(`[arcarum-theworld] Combat Mode:     ${mode === 'full_auto' ? 'Full Auto with Omen Counters' : 'Sequential Left-to-Right Skills'}`);
console.log(`[arcarum-theworld] Plain DMG Omen:  Beelzebub summon call (3M Plain DMG)`);
console.log(`[arcarum-theworld] Animation Skip:  Fast F5 reload on ~94% of turns (6% natural variance)`);
console.log(`[arcarum-theworld] Log Destination: logs/arcarum-theworld.md`);

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;
let engine: ArcarumTheWorldEngine | null = null;

try {
  console.log('\n[arcarum-theworld] Connecting to Chrome / Iron on port 9222...');
  const conn = await cdp.connectWithRetry();
  page = conn.page;

  console.log(`[arcarum-theworld] Connected to: ${await page.title()} (${page.url()})`);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  engine = new ArcarumTheWorldEngine(page, sentinel);

  // Graceful SIGINT (Ctrl+C)
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      console.log('\n[arcarum-theworld] Force quitting immediately...');
      process.exit(1);
    }
    sigintReceived = true;
    console.log('\n[arcarum-theworld] ⚠️ Ctrl+C detected. Finishing current battle and saving logs...');
    if (engine) engine.requestStop();
  });

  const summary = await engine.runTheWorldLoop({
    runs,
    autoReplenishAap: true,
    mode,
    logPath: 'logs/arcarum-theworld.md'
  });

  console.log('\n========================================================================');
  console.log('                  The World Battle Session Summary                      ');
  console.log('========================================================================');
  console.log(`Total Battles Completed:  ${summary.totalRunsCompleted}`);
  console.log(`Total Turns Issued:       ${summary.totalTurns}`);
  console.log(`Average Turns Per Battle: ${summary.averageTurnsPerRun}`);
  console.log(`Total Session Duration:   ${(summary.totalDurationMs / 1000 / 60).toFixed(1)} minutes`);
  console.log(`Battle Log Destination:   ${summary.logPath}`);
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
        console.log('🎉 Verification solved! You can now re-run arcarum-theworld safely.');
      }
    }
  } else {
    console.error('\n❌ [arcarum-theworld] Execution Error:', error.message || error);
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

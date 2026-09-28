// src/cli/run-rotb.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { RotbEngine } from '../engines/rotb.engine.js';

console.log('=====================================================');
console.log('     Granblue Fantasy - Rise of the Beasts Engine    ');
console.log('=====================================================');

const arg1 = (process.argv[2] || '').toLowerCase();
const arg2 = (process.argv[3] || '').toLowerCase();

// Determine mode: earth rotation vs pure baihu
const isEarthRotation = arg1 === 'earth' || arg1 === 'rotb_earth';
const countArg = isEarthRotation ? (arg2 || '1') : (arg1 || '30');

let limit = 1;
if (countArg === 'infinite' || countArg === 'inf' || countArg === 'loop') {
  limit = Infinity;
} else if (!isNaN(Number(countArg))) {
  limit = Math.max(1, parseInt(countArg, 10));
}

if (isEarthRotation) {
  console.log(`[RotbCLI] Mode: ROTB EARTH ROTATION (Baihu x9 -> Titan x1)`);
  console.log(`[RotbCLI] Cycles: ${limit === Infinity ? 'Infinite (Press Ctrl+C to stop)' : limit}`);
} else {
  console.log(`[RotbCLI] Mode: BAIHU EXTREME REPEAT`);
  console.log(`[RotbCLI] Repeat Count: ${limit === Infinity ? 'Infinite (Press Ctrl+C to stop)' : limit}`);
}
console.log(`[RotbCLI] Auto AP Replenish: ENABLED (Half-Elixir)`);

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;

try {
  console.log('[RotbCLI] Connecting to Chrome on port 9222...');
  const conn = await cdp.connectWithRetry();
  page = conn.page;

  console.log(`[RotbCLI] Connected to: ${await page.title()} (${page.url()})`);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  const rotbEngine = new RotbEngine(page, sentinel);

  // Graceful SIGINT (Ctrl+C) handling
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      console.log('\n[RotbCLI] Force quitting immediately...');
      process.exit(1);
    }
    sigintReceived = true;
    console.log('\n[RotbCLI] ⚠️ Interruption detected (Ctrl+C). Signaling engine to stop after current battle...');
    rotbEngine.requestStop();
  });

  if (isEarthRotation) {
    const summary = await rotbEngine.runRotbEarthLoop({
      cycles: limit,
      baihuPerCycle: 9,
      titanPerCycle: 1,
      autoReplenishAp: true,
      onProgress: (type, cycle, step, result) => {
        const icon = result.status === 'SUCCESS' ? '✅' : result.status === 'NOT_AVAILABLE' ? '⚠️' : '❌';
        console.log(`[RotbCLI] ${icon} [Cycle ${cycle}] ${type} #${step}: ${result.status} (${(result.durationMs / 1000).toFixed(1)}s) - ${result.message}`);
      }
    });

    console.log('\n=====================================================');
    console.log('             RotB Earth Rotation Summary             ');
    console.log('=====================================================');
    console.log(`✨ Cycles Processed    : ${summary.cyclesCompleted}`);
    console.log(`🐯 Baihu Extreme Clears : ${summary.totalBaihuClears}`);
    console.log(`⚡ Titan EX+ Clears     : ${summary.totalTitanClears}`);
    console.log(`⏱️  Total Time Elapsed   : ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`🏁 Final Exit Status    : ${summary.status}`);
    console.log('=====================================================\n');

  } else {
    const summary = await rotbEngine.runBaihuLoop({
      repeatCount: limit,
      autoReplenishAp: true,
      onProgress: (result) => {
        const icon = result.status === 'SUCCESS' ? '✅' : '❌';
        console.log(`[RotbCLI] ${icon} Round ${result.round}: ${result.status} (${(result.durationMs / 1000).toFixed(1)}s) - ${result.message}`);
      }
    });

    console.log('\n=====================================================');
    console.log('                 RotB Session Summary                ');
    console.log('=====================================================');
    console.log(`✨ Total Rounds Executed : ${summary.totalRounds}`);
    console.log(`✅ Successful Clears     : ${summary.successCount}`);
    console.log(`❌ Failed Clears         : ${summary.failedCount}`);
    console.log(`⏱️  Total Time Elapsed    : ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`🏁 Final Exit Status     : ${summary.status}`);
    console.log('=====================================================\n');
  }

  console.log('🎉 RotB routine complete! Safely returning to #mypage...');
  await page.evaluate(() => { window.location.hash = '#mypage'; }).catch(() => null);

  await cdp.disconnect();
  process.exit(0);

} catch (err: any) {
  if (err.message.includes('SENTINEL_HALT') || err.message.includes('Captcha') || err.message.includes('SENTINEL_LOCKED')) {
    console.log('\n============================================================');
    console.log(' 🚨 AUTOMATION PAUSED: GBF CAPTCHA / VERIFICATION DETECTED! ');
    console.log('============================================================');
    console.log(' 👉 Browser is focused on the verification challenge.');
    console.log(' 👉 Please complete the verification in your Iron browser.');
    console.log('============================================================\n');

    // Wait interactively for the user to solve it in the browser
    if (sentinel) {
      const solved = await sentinel.waitForUserToSolveCaptcha();
      if (solved) {
        console.log('🎉 Verification solved! You can now re-run the routine safely.');
      }
    }
  } else {
    console.error('\n🚨 [RotbCLI] Execution Failed:', err.message);

    // Return to #mypage only on normal errors, never when a captcha is showing
    if (sentinel && sentinel.isArmed) {
      try {
        await page.evaluate(() => { window.location.hash = '#mypage'; }).catch(() => null);
      } catch {}
    }
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

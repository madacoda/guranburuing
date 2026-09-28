// src/cli/run-pbhl.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { PbhlEngine } from '../engines/pbhl.engine.js';

console.log('=====================================================');
console.log('       Granblue Fantasy - Proto Bahamut HL Engine    ');
console.log('                 (PBHL / Tsuyo Baha)                 ');
console.log('=====================================================');

const targetArg = process.argv[2] || '';
const scoreArg = process.argv[3] || '1480000';
const targetScore = parseInt(scoreArg, 10) || 1480000;

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;

try {
  console.log('[PbhlCLI] Connecting to Chrome on port 9222...');
  const conn = await cdp.connectWithRetry();
  page = conn.page;

  console.log(`[PbhlCLI] Connected to: ${await page.title()} (${page.url()})`);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  let finalTarget = targetArg.trim();

  // If no target argument provided, check if current browser tab is already on a raid or supporter_raid
  if (!finalTarget) {
    const currentUrl = page.url();
    if (currentUrl.includes('supporter_raid') || currentUrl.includes('#quest/supporter_raid')) {
      finalTarget = currentUrl;
      console.log(`[PbhlCLI] Detected active supporter raid URL in browser: ${finalTarget}`);
    } else if (currentUrl.includes('#raid/')) {
      console.log(`[PbhlCLI] Active raid detected in browser! Proceeding directly with battle sequence...`);
      finalTarget = currentUrl;
    } else {
      console.log('\n[PbhlCLI] No raid target provided.');
      console.log('Usage:');
      console.log('  npm run pbhl <raidCodeOrUrl> [targetScore]');
      console.log('Examples:');
      console.log('  npm run pbhl https://game.granbluefantasy.jp/#quest/supporter_raid/46620968210/301061/1/2/0/7');
      console.log('  npm run pbhl 46620968210');
      console.log('  npm run pbhl 46620968210 1500000\n');
      process.exit(1);
    }
  }

  const engine = new PbhlEngine(page, sentinel);

  const result = await engine.runPbhl({
    raidTarget: finalTarget,
    targetScore,
    autoReplenishEp: true
  });

  console.log('\n=====================================================');
  console.log('                  PBHL Execution Summary             ');
  console.log('=====================================================');
  console.log(`Status:        ${result.status}`);
  console.log(`Final Honor:   ${result.finalScore.toLocaleString()} pt (Target: ${targetScore.toLocaleString()} pt)`);
  console.log(`Turns Elapsed: ${result.turnsElapsed}`);
  console.log(`Duration:      ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Message:       ${result.message}`);
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
        console.log('🎉 Verification solved! You can now re-run the PBHL routine safely.');
      }
    }
  } else {
    console.error('\n❌ [PbhlCLI] Unhandled error during PBHL execution:', error.message || error);
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

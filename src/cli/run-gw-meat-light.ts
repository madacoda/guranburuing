// src/cli/run-gw-meat-light.ts
import path from 'path';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { GwMeatLightEngine } from '../engines/gw-meat-light.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { AccountConfig } from '../types/account.types.js';

console.log('========================================================================');
console.log('       Guild War (Unite and Fight) Light Meat Farm Runner               ');
console.log('                     (September 2026 / Quest 947551)                    ');
console.log('========================================================================');

const args = process.argv.slice(2);
const isHeadless = args.includes('--headless') || process.env.HEADLESS === 'true' || process.env.HEADLESS === '1';
if (isHeadless) {
  process.env.HEADLESS = 'true';
}

// Check for --account <id> or -a <id>
const accountIndex = args.findIndex(a => a === '--account' || a === '-a');
const accountId = accountIndex !== -1 && args[accountIndex + 1] ? args[accountIndex + 1] : 'main';

const account: AccountConfig = AccountRegistry.getAccountById(accountId) || {
  id: 'main',
  name: 'Main Account',
  enabled: true,
  service: 'mobage',
  cdpPort: 9222,
  profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-iron-profile'),
  credentials: { email: '', password: '' },
  proxy: null
};

const numericArg = args.find(a => !a.startsWith('--') && !isNaN(Number(a)) && a !== accountId);
let runs = Infinity;
if (numericArg) {
  runs = Math.max(1, parseInt(numericArg, 10));
}

const logPath = account.id === 'main' ? 'logs/gw-meat-light.md' : `logs/gw-meat-${account.id}.md`;

console.log(`[gw-meat-light] Active Account:      [${account.name}] (${account.id})`);
console.log(`[gw-meat-light] Target Runs:         ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
console.log(`[gw-meat-light] Browser Mode:        ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Headful)'}`);
console.log(`[gw-meat-light] CDP Port:            ${account.cdpPort}`);
console.log(`[gw-meat-light] Profile Directory:   ${account.profileDir}`);
console.log(`[gw-meat-light] Supporter Priority:  Zeus >= 200 (250 top) > Lucifer >= 200 (250 top)`);
console.log(`[gw-meat-light] Combat Rotation:     Quick Call -> Attack -> Fast Bookmark Nav`);
console.log(`[gw-meat-light] Auto Half-Elixirs:   Enabled`);
console.log(`[gw-meat-light] Meat Log:            ${logPath}`);

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;
let engine: GwMeatLightEngine | null = null;

try {
  console.log(`\n[gw-meat-light] Connecting to Chrome / Iron on port ${account.cdpPort} (Headless: ${isHeadless})...`);
  const conn = await cdp.connectWithRetry(6, 2000, isHeadless, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir,
    proxy: account.proxy
  });
  page = conn.page;

  console.log(`[gw-meat-light] Connected to: ${await page.title()} (${page.url()})`);

  // Ensure authenticated session on-demand (lazy 0ms check, only logs in if expired)
  await AccountAuthManager.ensureAuthenticated(page, account);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  engine = new GwMeatLightEngine(page, sentinel);
  await engine.ensureViewportAndMobile();

  // Graceful shutdown on Ctrl+C
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      console.log('\n[gw-meat-light] Force quitting immediately...');
      process.exit(1);
    }
    sigintReceived = true;
    console.log('\n[gw-meat-light] ⚠️ Ctrl+C detected. Finishing current meat run and saving stats...');
    if (engine) engine.requestStop();
  });

  const summary = await engine.runMeatLoop({
    runs,
    autoReplenishAp: true,
    logPath
  });

  console.log('\n========================================================================');
  console.log('                  Guild War Meat Farm Session Summary                   ');
  console.log('========================================================================');
  console.log(`Total Battles Cleared:    ${summary.totalRunsCompleted}`);
  console.log(`Total Meat Accumulated:   ${summary.totalMeatGained} chunks`);
  console.log(`Average Time Per Run:     ${summary.averageDurationSec}s`);
  console.log(`Total Session Duration:   ${(summary.totalDurationMs / 1000 / 60).toFixed(1)} minutes`);
  console.log(`Meat Farming Log:         ${summary.logPath}`);
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
    console.log(' 👉 Please complete the verification in your browser.');
    console.log('============================================================\n');

    if (sentinel) {
      const solved = await sentinel.waitForUserToSolveCaptcha();
      if (solved) {
        console.log('🎉 Verification solved! You can resume gw-meat-light safely.');
      }
    }
  } else {
    console.error('\n❌ [gw-meat-light] Execution Error:', error.message || error);
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

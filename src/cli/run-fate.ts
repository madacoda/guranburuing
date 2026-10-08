// src/cli/run-fate.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { FateEngine } from '../engines/fate.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { AccountConfig } from '../types/account.types.js';

console.log('========================================================================');
console.log('       Granblue Fantasy - Autonomous Fate Episode Skip Engine           ');
console.log('========================================================================');

const args = process.argv.slice(2);

// Flags
const isWindowed = args.includes('--windowed');
const isHeadless = args.includes('--headless') ? true : (!isWindowed);

// Filter positional arguments
const positional = args.filter(a => !a.startsWith('--'));

let targetAccountId = 'acc1';
let targetCount = 5;

// Parse args: e.g. "acc1 10" or "10" or "acc1"
for (const p of positional) {
  if (/^\d+$/.test(p)) {
    targetCount = parseInt(p, 10);
  } else if (p.startsWith('acc') || /^[a-zA-Z0-9_-]+$/.test(p)) {
    targetAccountId = p;
  }
}

async function main() {
  const account = AccountRegistry.getAccountById(targetAccountId);
  if (!account) {
    console.error(`[FateCLI] ❌ Account "${targetAccountId}" not found in accounts.config.json.`);
    process.exit(1);
  }

  console.log(`Account:             ${account.name} (${account.id})`);
  console.log(`CDP Port:            ${account.cdpPort}`);
  console.log(`Profile Directory:   ${account.profileDir}`);
  console.log(`Target Episodes:     ${targetCount}`);
  console.log(`Browser Mode:        ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
  console.log('========================================================================\n');

  const cdp = new CdpConnectionManager();
  const sentinel = new SentinelWatchdog(null as any);

  let engine: FateEngine | null = null;
  let isExiting = false;

  const handleInterrupt = async () => {
    if (isExiting) return;
    isExiting = true;
    console.log('\n[FateCLI] ⚠️ Ctrl+C detected. Gracefully stopping active run...');
    if (engine) engine.requestStop();
    setTimeout(() => process.exit(0), 3000);
  };

  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleInterrupt);

  try {
    const { page } = await cdp.connectWithRetry(6, 1500, isHeadless, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir,
      proxy: account.proxy
    });
    sentinel.updatePage(page);

    // Verify authentication
    console.log(`[Auth] Verifying in-game identity on #profile for [${account.name}]...`);
    const profile = await AccountAuthManager.ensureAuthenticated(page, account);
    if (!profile) {
      console.warn('[Auth] Session check unverified. Navigating to in-game page...');
      await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
    } else {
      console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
    }

    engine = new FateEngine(page, sentinel);
    const summary = await engine.runFateEpisodes(targetCount);

    console.log(`[FateCLI] ✅ Fate automation finished with status: ${summary.status}`);
    process.exit(0);
  } catch (err: any) {
    console.error('[FateCLI] ❌ Fatal error in Fate automation:', err);
    process.exit(1);
  } finally {
    await cdp.disconnect().catch(() => null);
  }
}

main().catch(console.error);

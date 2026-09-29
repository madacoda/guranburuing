// src/cli/run-clear-event.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { EventEngine } from '../engines/event.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountConfig } from '../types/account.types.js';

console.log('========================================================================');
console.log('          Granblue Fantasy - Autonomous Event Clear Engine              ');
console.log('========================================================================');

const args = process.argv.slice(2);

// Parse flags and arguments
const isWindowed = args.includes('--windowed');
const isHeadless = args.includes('--headless') ? true : (!isWindowed);
const noElixir = args.includes('--no-elixir');

// Extract positional args
const positional = args.filter(a => !a.startsWith('--'));

let mode = (positional[0] || 'story').toLowerCase();
let targetEventId = positional[1] || '177';
let limitArg = positional[2] || '40';

// Allow flexible argument ordering: e.g. "bun run event 177 story" or "bun run event all 177"
if (/^\d+$/.test(positional[0])) {
  targetEventId = positional[0];
  mode = (positional[1] || 'story').toLowerCase();
  limitArg = positional[2] || '40';
}

// Account selection
let targetAccountId = 'acc1';
const accFlagIdx = args.findIndex(a => a === '--account' || a === '-a');
if (accFlagIdx !== -1 && args[accFlagIdx + 1]) {
  targetAccountId = args[accFlagIdx + 1];
}

const account: AccountConfig | undefined = AccountRegistry.getAccountById(targetAccountId) || AccountRegistry.loadAccounts()[0];

console.log(`Account:           ${account?.name || 'default'} (${account?.id || 'acc1'})`);
console.log(`Mode:              ${mode.toUpperCase()}`);
console.log(`Target Event ID:   treasureraid${targetEventId}`);
console.log(`Window Mode:       ${isWindowed ? 'HEADFUL (Windowed)' : 'HEADLESS'}`);
console.log(`Auto AP Restore:   ${!noElixir ? 'ENABLED (Half-Elixir)' : 'DISABLED'}`);
console.log('========================================================================\n');

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;

try {
  console.log(`Connecting to browser for account [${account?.id || 'acc1'}]...`);
  const conn = await cdp.connectWithRetry(6, 2000, isHeadless, {
    cdpPort: account?.cdpPort || 9222,
    profileDir: account?.profileDir,
    proxy: account?.proxy
  });

  page = conn.page;
  console.log(`Connected successfully: ${await page.title()} (${page.url()})\n`);

  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  const eventEngine = new EventEngine(page, sentinel);

  // Graceful SIGINT (Ctrl+C) handling
  let sigintReceived = false;
  process.on('SIGINT', () => {
    if (sigintReceived) {
      console.log('\n[EventCLI] Force quitting immediately...');
      process.exit(1);
    }
    sigintReceived = true;
    console.log('\n[EventCLI] ⚠️ Interruption detected (Ctrl+C). Signaling engine to stop after current step...');
    eventEngine.requestStop();
  });

  if (mode === 'all' || mode === 'full') {
    // Run complete event routine
    await eventEngine.runFullEventPipeline(targetEventId);
  } else if (mode === 'challenge') {
    // Challenge Quest only
    await eventEngine.runClearChallengeQuest(targetEventId);
  } else if (mode === 'maniac') {
    // Daily Maniac only
    await eventEngine.runClearDailyManiac(targetEventId);
  } else if (mode === 'nightmare' || mode === 'hell') {
    // Nightmare only
    await eventEngine.runCheckNightmare(targetEventId);
  } else if (mode === 'gacha' || mode === 'draw' || mode === 'box') {
    // Token drawbox only
    await eventEngine.runDrawTokenGacha(targetEventId);
  } else {
    // Default: Clear event story chapters & episodes
    const maxEpisodes = parseInt(limitArg, 10) || 40;
    const summary = await eventEngine.runClearEventStory({
      eventId: targetEventId,
      maxEpisodes,
      autoReplenishAp: !noElixir,
      onProgress: (p) => {
        const icon = p.status === 'SUCCESS' ? '✅' : '❌';
        console.log(`[EventCLI] ${icon} [Episode ${p.episodeNumber}] ${p.questName} (${p.type}): ${p.status} - ${p.message}`);
      }
    });

    console.log('\n========================================================================');
    console.log('                 Event Story Session Summary                            ');
    console.log('========================================================================');
    console.log(`Event ID:               treasureraid${summary.eventId}`);
    console.log(`Total Episodes Cleared: ${summary.episodesCleared}`);
    console.log(`Dialogue Cutscenes:     ${summary.cutscenesSkipped}`);
    console.log(`Combat Battles:         ${summary.storyBattlesCleared}`);
    console.log(`All Story Complete:     ${summary.allStoryCleared ? 'YES' : 'NO'}`);
    console.log(`Elapsed Time:           ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`Final Status:           ${summary.status}`);
    console.log('========================================================================\n');
  }

  console.log('Returning safely to event top page...');
  await page.evaluate((id: string) => {
    window.location.hash = `#event/treasureraid${id}`;
  }, targetEventId).catch(() => null);

  await cdp.disconnect();
  process.exit(0);

} catch (err: any) {
  if (err.message.includes('SENTINEL_HALT') || err.message.includes('Captcha') || err.message.includes('SENTINEL_LOCKED')) {
    console.log('\n============================================================');
    console.log(' 🚨 AUTOMATION PAUSED: GBF CAPTCHA / VERIFICATION DETECTED! ');
    console.log('============================================================');
    console.log(' 👉 Please complete the verification in your browser window.');
    console.log('============================================================\n');

    if (sentinel) {
      await sentinel.waitForUserToSolveCaptcha();
    }
  } else {
    console.error('\n🚨 [EventCLI] Execution Failed:', err.stack || err.message);
  }

  try {
    await cdp.disconnect();
  } catch {}
  process.exit(1);
}

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

const KNOWN_MODES = new Set([
  'story', 'challenge', 'maniac', 'nightmare', 'hell', 'skip',
  'missions', 'mission', 'gacha', 'draw', 'box', 'token', 'tokens',
  'sweep', 'solo', 'raid', 'quests', 'quest',
  'all', 'full', 'pipeline'
]);

const KNOWN_DIFFICULTIES = new Set(['vh', 'ex', 'ex_plus', 'maniac', 'hell', 'very_hard', 'extreme']);

let targetEventId: string | undefined = undefined;
let mode = 'story';
let difficultyArg = 'ex';
let limitArg: string | undefined = undefined;

for (const arg of positional) {
  const lower = arg.toLowerCase();
  if (KNOWN_MODES.has(lower) && mode === 'story') {
    mode = lower;
  } else if (KNOWN_DIFFICULTIES.has(lower)) {
    difficultyArg = lower === 'very_hard' ? 'vh' : lower === 'extreme' ? 'ex' : lower;
  } else if (/^(biography\d+|treasureraid\d+|https?:\/\/|#event\/)/i.test(arg)) {
    targetEventId = arg;
  } else if (/^\d+$/.test(arg)) {
    if (!targetEventId && mode === 'story') {
      targetEventId = arg;
    } else {
      limitArg = arg;
    }
  } else if (!targetEventId && !KNOWN_MODES.has(lower)) {
    targetEventId = arg;
  }
}

if (!limitArg) {
  if (mode === 'nightmare' || mode === 'hell' || mode === 'skip') {
    limitArg = '1000';
  } else if (mode === 'gacha' || mode === 'draw' || mode === 'box' || mode === 'token' || mode === 'tokens') {
    limitArg = '200';
  } else if (mode === 'raid') {
    limitArg = '5';
  } else if (mode === 'solo') {
    limitArg = '1';
  } else {
    limitArg = '40';
  }
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
console.log(`Target Specifier:  ${targetEventId || 'AUTO-DETECT'}`);
console.log(`Limit:             ${limitArg}`);
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
  const eventInfo = await eventEngine.resolveEventInfo(targetEventId);

  console.log(`Target Event:       ${eventInfo.name} (${eventInfo.url})`);
  console.log(`Event Type:         ${eventInfo.type.toUpperCase()}\n`);

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
    await eventEngine.runFullEventPipeline(eventInfo.id);
  } else if (mode === 'challenge') {
    // Challenge Quest only
    await eventEngine.runClearChallengeQuest(eventInfo.id);
  } else if (mode === 'maniac') {
    // Daily Maniac only
    if (eventInfo.type === 'collaboration' || eventInfo.type === 'biography' || eventInfo.id.startsWith('biography')) {
      await eventEngine.runClearCollaborationQuests({
        eventId: eventInfo.id,
        mode: 'maniac',
        autoReplenishAp: !noElixir,
        onProgress: (p) => {
          const icon = p.status === 'SUCCESS' ? '✅' : p.status === 'FAILED' ? '❌' : '👑';
          console.log(`[EventCLI] ${icon} [MANIAC] ${p.questName}: ${p.status} - ${p.message}`);
        }
      });
    } else {
      await eventEngine.runClearDailyManiac(eventInfo.id);
    }
  } else if (mode === 'nightmare' || mode === 'hell' || mode === 'skip') {
    // Nightmare / HELL loop
    if (eventInfo.type === 'collaboration' || eventInfo.type === 'biography' || eventInfo.id.startsWith('biography')) {
      await eventEngine.runClearCollaborationQuests({
        eventId: eventInfo.id,
        mode: 'hell',
        autoReplenishAp: !noElixir
      });
    } else {
      const maxBatches = parseInt(limitArg, 10) || 100;
      await eventEngine.runClearNightmareLoop(eventInfo.id, maxBatches);
    }
  } else if (mode === 'gacha' || mode === 'draw' || mode === 'box' || mode === 'token' || mode === 'tokens') {
    // Token drawbox loop
    const maxBoxes = parseInt(limitArg, 10) || 200;
    const summary = await eventEngine.runClearTokenGachaLoop(eventInfo.id, maxBoxes, (p) => {
      const icon = p.status === 'COMPLETED' ? '✅' : p.status === 'RESETTING' ? '🔄' : '🎁';
      console.log(`[EventCLI] ${icon} [Box #${p.boxNumber}] Cycle #${p.cycle}: ${p.status} - Remaining tokens: ${p.tokensRemaining?.toLocaleString() ?? 'Unknown'}`);
    });

    console.log('\n========================================================================');
    console.log('             Event Token Drawbox Session Summary                        ');
    console.log('========================================================================');
    console.log(`Event:                  ${eventInfo.name}`);
    console.log(`Boxes Cleared:          ${summary.boxesCleared}`);
    console.log(`Tokens Spent:           ${summary.tokensSpent.toLocaleString()}`);
    console.log(`Tokens Remaining:       ${summary.finalTokens?.toLocaleString() ?? 'Unknown'}`);
    console.log(`Elapsed Time:           ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`Final Status:           ${summary.status}`);
    console.log('========================================================================\n');
  } else if (mode === 'missions' || mode === 'mission') {
    // Daily event missions claim
    await eventEngine.runClaimDailyMissions(eventInfo.id);
  } else if (mode === 'sweep' || mode === 'quests' || mode === 'quest') {
    // First clear sweep of all event quests
    await eventEngine.runClearCollaborationQuests({
      eventId: eventInfo.id,
      mode: 'sweep',
      autoReplenishAp: !noElixir,
      onProgress: (p) => {
        const icon = p.status === 'SUCCESS' ? '✅' : p.status === 'FAILED' ? '❌' : '⚔️';
        console.log(`[EventCLI] ${icon} [${p.difficulty?.toUpperCase() || 'QUEST'}] ${p.questName}: ${p.status} - ${p.message}`);
      }
    });
  } else if (mode === 'solo') {
    // Farm solo collaboration quest
    const runs = parseInt(limitArg, 10) || 1;
    await eventEngine.runClearCollaborationQuests({
      eventId: eventInfo.id,
      mode: 'solo',
      difficulty: difficultyArg || 'ex',
      runs,
      autoReplenishAp: !noElixir,
      onProgress: (p) => {
        const icon = p.status === 'SUCCESS' ? '✅' : p.status === 'FAILED' ? '❌' : '⚔️';
        console.log(`[EventCLI] ${icon} [Run ${p.currentRun}/${p.totalRuns}] ${p.questName}: ${p.status} - ${p.message}`);
      }
    });
  } else if (mode === 'raid') {
    // Host collaboration multi raid
    const runs = parseInt(limitArg, 10) || 5;
    await eventEngine.runClearCollaborationQuests({
      eventId: eventInfo.id,
      mode: 'raid',
      difficulty: difficultyArg || 'vh',
      runs,
      autoReplenishAp: !noElixir,
      onProgress: (p) => {
        const icon = p.status === 'SUCCESS' ? '✅' : p.status === 'FAILED' ? '❌' : '🤝';
        console.log(`[EventCLI] ${icon} [Raid ${p.currentRun}/${p.totalRuns}] ${p.questName}: ${p.status} - ${p.message}`);
      }
    });
  } else {
    // Default: Clear event story chapters & episodes
    const maxEpisodes = parseInt(limitArg, 10) || 40;
    const summary = await eventEngine.runClearEventStory({
      eventId: eventInfo.id,
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
    console.log(`Event:                  ${eventInfo.name}`);
    console.log(`Total Episodes Cleared: ${summary.episodesCleared}`);
    console.log(`Dialogue Cutscenes:     ${summary.cutscenesSkipped}`);
    console.log(`Combat Battles:         ${summary.storyBattlesCleared}`);
    console.log(`All Story Complete:     ${summary.allStoryCleared ? 'YES' : 'NO'}`);
    console.log(`Elapsed Time:           ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`Final Status:           ${summary.status}`);
    console.log('========================================================================\n');
  }

  console.log('Returning safely to event top page...');
  await page.evaluate((destUrl: string) => {
    const hash = destUrl.substring(destUrl.indexOf('#'));
    window.location.hash = hash;
  }, eventInfo.url).catch(() => null);

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

// src/cli/run-dread-barrage.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { DreadBarrageEngine } from '../engines/dread-barrage.engine.js';
import {
  DREAD_BARRAGE_ITERATION_15,
  DreadBarrageCombatStrategy,
  DreadBarrageStarTier,
  normalizeDreadBarrageStarTier
} from '../events/dread-barrage.constants.js';

type DreadBarrageCliMode =
  | 'status'
  | 'raid'
  | 'unparalleled'
  | 'valiant'
  | 'missions'
  | 'rewards'
  | 'gacha'
  | 'all';

interface DreadBarrageCliOptions {
  accountId: string;
  mode: DreadBarrageCliMode;
  tier: DreadBarrageStarTier;
  runs: number;
  strategy?: DreadBarrageCombatStrategy;
  isWindowed: boolean;
  autoElixir: boolean;
  autoUnparalleled: boolean;
}

function parseCliArgs(): DreadBarrageCliOptions {
  const rawArgs = process.argv.slice(2);
  let accountId = 'acc1';
  let mode: DreadBarrageCliMode = 'raid';
  let tier: DreadBarrageStarTier = '2star';
  let runs = 100;
  let runsExplicit = false;
  let strategy: DreadBarrageCombatStrategy | undefined;

  const isWindowed = rawArgs.includes('--windowed') || rawArgs.includes('--headful');
  const autoElixir = !rawArgs.includes('--no-elixir');
  const autoUnparalleled = !rawArgs.includes('--no-unparalleled');

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const lower = arg.toLowerCase();

    if (lower === '--account' || lower === '-a') {
      if (rawArgs[i + 1]) accountId = rawArgs[++i];
      continue;
    }
    if (lower === '--runs' || lower === '-n') {
      if (rawArgs[i + 1]) {
        runs = Math.max(1, parseInt(rawArgs[++i], 10) || 100);
        runsExplicit = true;
      }
      continue;
    }
    if (lower === '--tier' || lower === '-t' || lower === '--diff' || lower === '-d') {
      if (rawArgs[i + 1]) {
        tier = normalizeDreadBarrageStarTier(rawArgs[++i]);
      }
      continue;
    }
    if (lower === '--strategy' || lower === '-s') {
      const next = (rawArgs[++i] || '').toLowerCase();
      if (next === 'otk_0b' || next === '0b') strategy = 'otk_0b';
      else if (next === 'otk_1t' || next === '1t') strategy = 'otk_1t';
      else if (next === 'smart_fa' || next === 'fa') strategy = 'smart_fa';
      continue;
    }
    if (lower.startsWith('--')) continue;

    if (/^acc\d+$/i.test(lower)) {
      accountId = lower;
    } else if (['status', 'info', 'audit'].includes(lower)) {
      mode = 'status';
    } else if (['1star', '2star', '3star', '4star', '5star', 'star1', 'star2', 'star3', 'star4', 'star5'].includes(lower)) {
      mode = 'raid';
      tier = normalizeDreadBarrageStarTier(lower);
    } else if (['unparalleled', 'strong', 'extra', 'uf'].includes(lower)) {
      mode = 'unparalleled';
    } else if (['valiant', 'special'].includes(lower)) {
      mode = 'valiant';
    } else if (['missions', 'mission', 'sweep'].includes(lower)) {
      mode = 'missions';
    } else if (['rewards', 'reward', 'claim'].includes(lower)) {
      mode = 'rewards';
    } else if (['gacha', 'tokens', 'token', 'box', 'draw'].includes(lower)) {
      mode = 'gacha';
    } else if (['all', 'full', 'pipeline'].includes(lower)) {
      mode = 'all';
    } else if (/^\d+$/.test(lower)) {
      runs = Math.max(1, parseInt(lower, 10));
      runsExplicit = true;
    }
  }

  if (!runsExplicit) {
    if (mode === 'gacha') runs = 100;
    else if (mode === 'unparalleled') runs = 2;
    else if (mode === 'all') runs = 50;
  }

  return {
    accountId,
    mode,
    tier,
    runs,
    strategy,
    isWindowed,
    autoElixir,
    autoUnparalleled
  };
}

function printLiveDashboard(state: NonNullable<Awaited<ReturnType<DreadBarrageEngine['fetchLiveState']>>>): void {
  console.log('\n========================================================================');
  console.log('              📊 DREAD BARRAGE LIVE TELEMETRY DASHBOARD                 ');
  console.log('========================================================================');
  console.log(`Event ID:             ${state.eventId} (teamforce)`);
  console.log(`Boss Element:         ${state.bossElement.toUpperCase()} (Advantage: ${state.advantageElement.toUpperCase()})`);
  console.log(`Individual Honors:    ${state.userHonors.toLocaleString()} pt`);
  console.log(`Crew Honors:          ${state.crewHonors.toLocaleString()} pt`);
  console.log(`Valor Badges (91001): ${state.valorBadges.toLocaleString()}`);
  console.log(`Certificates (10360): ${state.victoryCertificates.toLocaleString()}`);
  console.log(`Special Backup (1HKO):${state.isOneShotKillActive ? ' READY' : ' USED / INACTIVE'}`);
  console.log(`AP / EP Status:       ${state.currentAp}/${state.maxAp} AP | ${state.currentEp} EP`);
  console.log('------------------------------------------------------------------------');
  console.log('Standard Crew Raid Tiers (boss_list):');
  for (const b of state.bosses) {
    const statusStr = b.isOpen
      ? '🟢 OPEN'
      : `🔒 LOCKED (Need ${b.remainClearCountToUnlock ?? '?'} more ${b.prerequisiteQuestName || 'prev tier'})`;
    console.log(
      `  [${b.categorySymbol.padEnd(5)}] Quest ${b.questId} | ${b.questName.padEnd(24)} | ${String(b.apCost).padStart(2)} AP | Clears: ${String(b.clearCount).padStart(4)} | ${statusStr}`
    );
  }

  console.log('------------------------------------------------------------------------');
  console.log(`Spawned Unparalleled Foes (${state.unparalleledFoes.length}):`);
  if (state.unparalleledFoes.length === 0) {
    console.log('  (None currently spawned — clear ★–★★★★★ raids to trigger spawn)');
  } else {
    for (const u of state.unparalleledFoes) {
      console.log(`  🔥 Quest ${u.questId} | ${u.questName} (Lv${u.level}) | ${u.apCost} AP | Open: ${u.isOpen}`);
    }
  }

  console.log('------------------------------------------------------------------------');
  console.log(
    `Valiant Battle:       Term Started: ${state.valiantBattle.isTermStart ? 'YES' : 'NO'} | Crew Honor Requirement (${state.valiantBattle.requiredCrewHonors.toLocaleString()}): ${state.valiantBattle.isConditionCleared ? 'MET ✅' : 'NOT MET ❌'}`
  );
  console.log('------------------------------------------------------------------------');
  console.log('Event & Crew Missions:');
  for (const m of state.missions) {
    const badge = m.isAllComplete ? '✅ COMPLETE' : `⏳ ${m.progress}/${m.maxProgress} (Star ${m.star}/${m.maxStar})`;
    console.log(
      `  [${m.type.toUpperCase().padEnd(10)} #${m.missionId}] ${badge} — ${m.currentDescription} -> ${m.currentReward}`
    );
  }
  console.log('========================================================================\n');
}

async function main() {
  const opts = parseCliArgs();
  const raidDef = DREAD_BARRAGE_ITERATION_15.raids[opts.tier];

  console.log('\n========================================================================');
  console.log('       ⚔️  Granblue Fantasy — Autonomous Dread Barrage Engine           ');
  console.log('========================================================================');
  console.log(`Account:              ${opts.accountId}`);
  console.log(`Operation Mode:       ${opts.mode.toUpperCase()}`);
  if (opts.mode === 'raid' || opts.mode === 'all') {
    console.log(`Target Tier:          ${opts.tier.toUpperCase()} (${raidDef.categorySymbol} ${raidDef.bossName} | Quest ${raidDef.questId})`);
    console.log(`Target Runs:          ${opts.runs}`);
    console.log(`Combat Strategy:      ${(opts.strategy || raidDef.recommendedStrategy).toUpperCase()}`);
    console.log(`Intercept Unparall.:  ${opts.autoUnparalleled ? 'ENABLED' : 'DISABLED'}`);
  }
  console.log(`Auto AP Restore:      ${opts.autoElixir ? 'ENABLED (Half-Elixir)' : 'DISABLED'}`);
  console.log(`Browser Mode:         ${opts.isWindowed ? 'WINDOWED (Headful)' : 'HEADLESS'}`);
  console.log('========================================================================\n');

  const account = AccountRegistry.getAccountById(opts.accountId) || AccountRegistry.loadAccounts()[0];
  if (!account) {
    console.error(`[DreadBarrageCLI] Account "${opts.accountId}" not found in accounts.config.json.`);
    process.exit(1);
  }

  const cdp = new CdpConnectionManager();
  let engine: DreadBarrageEngine | null = null;
  let sentinel: SentinelWatchdog | null = null;

  let sigintCount = 0;
  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount > 1) {
      console.log('\n[DreadBarrageCLI] Force exiting immediately...');
      process.exit(1);
    }
    console.log('\n[DreadBarrageCLI] ⚠️ Ctrl+C received. Signaling engine to stop after current battle...');
    engine?.requestStop();
  });

  try {
    const conn = await cdp.connectWithRetry(6, 2000, !opts.isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir,
      proxy: account.proxy
    });

    const { page } = conn;
    sentinel = new SentinelWatchdog(page);
    await sentinel.assertSafe();

    const currentUrl = page.url();
    if (!currentUrl.includes('granbluefantasy.jp') || currentUrl.includes('#top') || currentUrl.includes('#login')) {
      await AccountAuthManager.ensureAuthenticated(page, account);
    }

    engine = new DreadBarrageEngine(page, sentinel);

    if (opts.mode === 'status') {
      const state = await engine.fetchLiveState();
      if (!state) {
        console.error('[DreadBarrageCLI] Failed to fetch live Dread Barrage state from /teamforce/top/content/index.');
      } else {
        printLiveDashboard(state);
      }
    } else if (opts.mode === 'raid') {
      const summary = await engine.runRaidLoop({
        tier: opts.tier,
        runs: opts.runs,
        strategy: opts.strategy,
        autoReplenishAp: opts.autoElixir,
        autoUnparalleled: opts.autoUnparalleled,
        onProgress: (p) => {
          console.log(
            `⚡ [${opts.accountId}] [Run ${p.run}/${p.totalRuns}] ${p.tier} ${p.questName} (${p.questId}) -> ${p.status} in ${(p.durationMs / 1000).toFixed(2)}s (~${p.tokensEstimated} tokens)`
          );
        }
      });

      console.log('\n========================================================================');
      console.log('                 Dread Barrage Raid Session Scorecard                   ');
      console.log('========================================================================');
      console.log(`Requested Tier:          ${summary.requestedTier.toUpperCase()}`);
      console.log(`Standard Raids Cleared:  ${summary.totalRunsCompleted}`);
      console.log(`Unparalleled Cleared:    ${summary.unparalleledFoesCleared}`);
      console.log(`Est. Tokens Farmed:      ~${summary.estimatedTokensEarned.toLocaleString()}`);
      console.log(`Est. Honors Earned:      ~${summary.estimatedHonorsEarned.toLocaleString()} pt`);
      console.log(`Total Duration:          ${(summary.totalDurationMs / 1000).toFixed(1)}s`);
      console.log(`Final Status:            ${summary.status}`);
      console.log('========================================================================\n');
    } else if (opts.mode === 'unparalleled') {
      await engine.runClearUnparalleledFoes({
        maxClears: opts.runs,
        autoReplenishAp: opts.autoElixir
      });
    } else if (opts.mode === 'valiant') {
      await engine.runClearValiantBattle({ autoReplenishAp: opts.autoElixir });
    } else if (opts.mode === 'missions') {
      await engine.runMissionSweep({ autoReplenishAp: opts.autoElixir });
      await engine.runClaimRewards();
    } else if (opts.mode === 'rewards') {
      await engine.runClaimRewards();
    } else if (opts.mode === 'gacha') {
      const gachaSummary = await engine.runClearTokenGacha({
        maxBoxes: opts.runs,
        onProgress: (p) => {
          console.log(
            `🎁 [Box #${p.boxNumber}] Action: ${p.action} | Draws: ${p.drawsExecuted} | Remaining Tokens: ${p.tokensRemaining?.toLocaleString() ?? 'Unknown'}`
          );
        }
      });

      console.log('\n========================================================================');
      console.log('               Dread Barrage Token Drawbox Scorecard                    ');
      console.log('========================================================================');
      console.log(`Status:                  ${gachaSummary.status}`);
      console.log(`Boxes Cleared:           ${gachaSummary.boxesCleared}`);
      console.log(`Draw Actions Executed:   ${gachaSummary.drawsExecuted}`);
      console.log(`Remaining Tokens:        ${gachaSummary.tokensRemaining?.toLocaleString() ?? 'Unknown'}`);
      console.log(`Elapsed Time:            ${(gachaSummary.totalDurationMs / 1000).toFixed(1)}s`);
      console.log('========================================================================\n');
    } else if (opts.mode === 'all') {
      await engine.runFullPipeline({
        tier: opts.tier,
        runs: opts.runs,
        sweepMissions: true,
        clearGacha: true,
        autoReplenishAp: opts.autoElixir
      });
    }
  } catch (err: any) {
    if (err.message?.includes('SENTINEL_HALT') || err.message?.includes('Captcha') || err.message?.includes('SENTINEL_LOCKED')) {
      console.log('\n============================================================');
      console.log(' 🚨 AUTOMATION PAUSED: GBF CAPTCHA / VERIFICATION DETECTED! ');
      console.log('============================================================');
      if (sentinel) {
        await sentinel.waitForUserToSolveCaptcha();
      }
    } else {
      console.error('\n🚨 [DreadBarrageCLI] Fatal Error:', err?.stack || err?.message || err);
      process.exit(1);
    }
  } finally {
    await cdp.disconnect().catch(() => null);
  }
}

main();

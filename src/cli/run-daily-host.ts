// src/cli/run-daily-host.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { DailyHostEngine, DAILY_HOST_CATALOG } from '../engines/daily-host.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { AccountConfig } from '../types/account.types.js';
import { DailyHostCategory, DailyHostOptions } from '../types/daily-host.types.js';

// Parse CLI Arguments
const rawArgs = process.argv.slice(2);
const isWindowed = rawArgs.includes('--windowed') || rawArgs.includes('-w');
const isAllAccounts = rawArgs.includes('--all-accounts') || rawArgs.includes('all-accounts');
const positionalArgs = rawArgs.filter(arg => !arg.startsWith('-'));

const registeredAccounts = AccountRegistry.loadAccounts();
const defaultAccount = registeredAccounts.find(a => a.enabled) || registeredAccounts[0];

let targetAccountStr = defaultAccount ? defaultAccount.id : 'acc1';
let categoryFilter: DailyHostCategory | 'all' = 'all';
let specificRaidId: string | undefined = undefined;

let assistActivity = 'gb-farm';
let enableAssist = true;
let maxCombatTurnsBeforeYield = 15;
let hostedRaidRecheckIntervalMs = 180_000;

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === '--no-assist') {
    enableAssist = false;
  } else if (arg === '--assist' && rawArgs[i + 1] && !rawArgs[i + 1].startsWith('-')) {
    assistActivity = rawArgs[++i];
  } else if (arg.startsWith('--assist=')) {
    assistActivity = arg.split('=')[1];
  } else if ((arg === '--max-turns' || arg === '--turns') && rawArgs[i + 1]) {
    maxCombatTurnsBeforeYield = parseInt(rawArgs[++i], 10) || 15;
  } else if (arg.startsWith('--max-turns=')) {
    maxCombatTurnsBeforeYield = parseInt(arg.split('=')[1], 10) || 15;
  } else if (arg === '--recheck-interval' && rawArgs[i + 1]) {
    hostedRaidRecheckIntervalMs = (parseInt(rawArgs[++i], 10) || 180) * 1000;
  } else if (arg.startsWith('--recheck-interval=')) {
    hostedRaidRecheckIntervalMs = (parseInt(arg.split('=')[1], 10) || 180) * 1000;
  }
}

for (const arg of positionalArgs) {
  const lower = arg.toLowerCase();
  if (['gb-farm', 'gb-akasha', 'gb-pbhl', 'gb-go'].includes(lower)) {
    assistActivity = lower;
  } else if (registeredAccounts.some(a => a.id.toLowerCase() === lower)) {
    targetAccountStr = registeredAccounts.find(a => a.id.toLowerCase() === lower)!.id;
  } else if (lower === 'hl' || lower === 'high' || lower === 'goldbrick') {
    categoryFilter = 'hl';
  } else if (lower === 'm3' || lower === 'magna3' || lower === 'omega3' || lower === 'magna') {
    categoryFilter = 'magna3';
  } else if (lower === 'dragons' || lower === 'six-dragons' || lower === 'six_dragons' || lower === 'dragon') {
    categoryFilter = 'dragons';
  } else if (lower === 'standard' || lower === 'normal') {
    categoryFilter = 'standard';
  } else if (lower === 'all' || lower === 'universal') {
    categoryFilter = 'all';
  } else if (DAILY_HOST_CATALOG.some(r => r.id.toLowerCase() === lower || r.name.toLowerCase().includes(lower))) {
    const match = DAILY_HOST_CATALOG.find(r => r.id.toLowerCase() === lower || r.name.toLowerCase().includes(lower));
    specificRaidId = match?.id;
  }
}

async function runDailyHostForAccount(account: AccountConfig, options: DailyHostOptions) {
  console.log('\n========================================================================');
  console.log('             Granblue Fantasy Daily Host Routine Runner                  ');
  console.log('========================================================================');
  console.log(`Account:             ${account.name} (${account.id})`);
  console.log(`CDP Port:            ${account.cdpPort}`);
  console.log(`Profile Directory:   ${account.profileDir}`);
  console.log(`Category Filter:     ${options.categoryFilter ? options.categoryFilter.toUpperCase() : 'ALL'}`);
  if (options.specificRaidId) {
    console.log(`Specific Raid:       ${options.specificRaidId}`);
  }
  console.log(`Dual-Track Assist:   ${options.enableAssistInterleaving !== false ? `ENABLED [Target: ${options.assistActivity || 'gb-farm'}]` : 'DISABLED'}`);
  console.log(`Recheck Interval:    ${Math.round((options.hostedRaidRecheckIntervalMs || 180000) / 1000)}s (3-min Backup Cooldown)`);
  console.log(`Browser Mode:        ${isWindowed ? 'WINDOWED' : 'HEADLESS (--headless=new)'}`);
  console.log('========================================================================\n');

  const cdp = new CdpConnectionManager();

  try {
    const conn = await cdp.connectWithRetry(6, 2000, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir,
      proxy: account.proxy
    });

    let activePage = conn.page;

    // Verify in-game authentication on #profile (handles automated/on-demand login if required)
    const profile = await AccountAuthManager.ensureAuthenticated(activePage, account);
    if (!profile) {
      throw new Error(`Account [${account.name}] could not be authenticated.`);
    }
    console.log(`[DailyHostCLI] ✅ Verified Player: "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);

    const sentinel = new SentinelWatchdog(activePage);
    await sentinel.assertSafe();

    const engine = new DailyHostEngine(activePage, sentinel, account.id);

    cdp.onReconnect((newPage) => {
      console.log(`[DailyHostCLI] 🔄 Rebinding page after CDP reconnect for [${account.id}]...`);
      sentinel.updatePage(newPage);
      engine.updatePage(newPage);
    });

    let sigintReceived = false;
    const sigintHandler = () => {
      if (sigintReceived) {
        console.log('\n[DailyHostCLI] Force quitting immediately...');
        process.exit(1);
      }
      sigintReceived = true;
      console.log('\n[DailyHostCLI] ⚠️ Graceful shutdown requested. Finishing active raid...');
      engine.requestStop();
    };
    process.on('SIGINT', sigintHandler);

    const summary = await engine.runDailyHost(options);

    process.removeListener('SIGINT', sigintHandler);
    await cdp.disconnect();
    return { account: account.name, success: true, summary };

  } catch (error: any) {
    console.error(`\n[DailyHostCLI] ❌ Fatal error on account [${account.name}]:`, error.message);
    try { await cdp.disconnect(); } catch {}
    return { account: account.name, success: false, error: error.message };
  }
}

async function main() {
  const options: DailyHostOptions = {
    categoryFilter,
    specificRaidId,
    autoReplenishAp: true,
    maxTurnsPerRaid: 35,
    enableAssistInterleaving: enableAssist,
    assistActivity,
    maxCombatTurnsBeforeYield,
    hostedRaidRecheckIntervalMs
  };

  if (isAllAccounts) {
    const enabledAccounts = registeredAccounts.filter(a => a.enabled);
    console.log(`[DailyHostCLI] 🌐 Executing Daily Host routine across ${enabledAccounts.length} enabled accounts...`);
    const allResults = [];
    for (const acc of enabledAccounts) {
      const res = await runDailyHostForAccount(acc, options);
      allResults.push(res);
    }
    console.log('\n========================================================================');
    console.log('                 Multi-Account Daily Host Run Summary                   ');
    console.log('========================================================================');
    for (const r of allResults) {
      const statusIcon = r.success ? '✅' : '❌';
      const stats = r.summary ? `${r.summary.cleared} cleared, ${r.summary.skippedNoMaterial} no mats, ${r.summary.skippedLimit} limit` : (r.error || 'Failed');
      console.log(`${statusIcon} ${r.account.padEnd(20)} : ${stats}`);
    }
    console.log('========================================================================\n');
  } else {
    const targetAccount = registeredAccounts.find(a => a.id.toLowerCase() === targetAccountStr.toLowerCase()) || defaultAccount;
    if (!targetAccount) {
      console.error(`[DailyHostCLI] Account "${targetAccountStr}" not found in configuration.`);
      process.exit(1);
    }
    const result = await runDailyHostForAccount(targetAccount, options);
    if (!result.success) {
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('[DailyHostCLI] Unhandled error:', err);
  process.exit(1);
});

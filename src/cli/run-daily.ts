// src/cli/run-daily.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { TemplateParser } from '../templates/template-parser.js';
import { AccountConfig } from '../types/account.types.js';

// Parse CLI Arguments
const rawArgs = process.argv.slice(2);
const isWindowed = rawArgs.includes('--windowed') || rawArgs.includes('-w');
const isAllAccounts = rawArgs.includes('--all-accounts') || rawArgs.includes('all-accounts');
const positionalArgs = rawArgs.filter(arg => !arg.startsWith('-'));

const registeredAccounts = AccountRegistry.loadAccounts();
const defaultAccount = registeredAccounts.find(a => a.enabled) || registeredAccounts[0];

let targetAccountStr = defaultAccount ? defaultAccount.id : 'acc1';
let templateName = 'daily-universal';
let runs = 1;

for (const arg of positionalArgs) {
  const lower = arg.toLowerCase();
  if (registeredAccounts.some(a => a.id.toLowerCase() === lower)) {
    targetAccountStr = registeredAccounts.find(a => a.id.toLowerCase() === lower)!.id;
  } else if (lower.includes('fav')) {
    templateName = 'daily-favorites';
  } else if (lower === 'universal' || lower === 'all') {
    templateName = 'daily-universal';
  } else if (!isNaN(Number(arg))) {
    runs = Math.max(1, parseInt(arg, 10));
  }
}

async function runDailyForAccount(account: AccountConfig, templateId: string, runCount: number) {
  console.log('\n========================================================================');
  console.log('            Granblue Fantasy Universal Daily Routine Runner              ');
  console.log('========================================================================');
  console.log(`Account:             ${account.name} (${account.id})`);
  console.log(`CDP Port:            ${account.cdpPort}`);
  console.log(`Profile Directory:   ${account.profileDir}`);
  console.log(`Routine Template:    ${templateId}`);
  console.log(`Target Runs:         ${runCount}`);
  console.log(`Browser Mode:        ${isWindowed ? 'WINDOWED' : 'HEADLESS (--headless=new)'}`);
  console.log('========================================================================\n');

  const template = TemplateParser.loadTemplate(templateId);
  const cdp = new CdpConnectionManager();

  try {
    const conn = await cdp.connectWithRetry(6, 2000, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir,
      proxy: account.proxy
    });

    let activePage = conn.page;
    const sentinel = new SentinelWatchdog(activePage);
    await sentinel.assertSafe();

    // Verify in-game authentication on #profile
    const profile = await AccountAuthManager.ensureAuthenticated(activePage, account);
    if (!profile) {
      throw new Error(`Account [${account.name}] could not be authenticated.`);
    }
    console.log(`[DailyCLI] ✅ Verified Player: "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);

    const engine = new UniversalWorkflowEngine(activePage, sentinel, template, account.id);

    cdp.onReconnect((newPage) => {
      console.log(`[DailyCLI] 🔄 Rebinding page after CDP reconnect for [${account.id}]...`);
      sentinel.updatePage(newPage);
      engine.updatePage(newPage);
    });

    let sigintReceived = false;
    const sigintHandler = () => {
      if (sigintReceived) {
        console.log('\n[DailyCLI] Force quitting immediately...');
        process.exit(1);
      }
      sigintReceived = true;
      console.log('\n[DailyCLI] ⚠️ Graceful shutdown requested. Completing active routine...');
      engine.requestStop();
    };
    process.on('SIGINT', sigintHandler);

    const summary = await engine.runLoop({
      runs: runCount,
      autoReplenishAp: template.autoElixir ?? true,
      autoReplenishEp: template.autoBerry ?? true,
      logPath: `logs/workflow-${account.id}-${templateId}.md`
    });

    process.removeListener('SIGINT', sigintHandler);
    await cdp.disconnect();
    return { account: account.name, success: true, summary };

  } catch (err: any) {
    console.error(`\n🚨 [DailyCLI] Execution Failed for [${account.name}]:`, err.message);
    await cdp.disconnect().catch(() => null);
    return { account: account.name, success: false, error: err.message };
  }
}

async function main() {
  const accountsToRun = isAllAccounts
    ? registeredAccounts.filter(a => a.enabled)
    : [registeredAccounts.find(a => a.id === targetAccountStr) || defaultAccount];

  if (!accountsToRun.length || !accountsToRun[0]) {
    console.error(`❌ No eligible account found for: ${targetAccountStr}`);
    process.exit(1);
  }

  const results = [];
  const t0 = Date.now();

  for (const acc of accountsToRun) {
    const res = await runDailyForAccount(acc, templateName, runs);
    results.push(res);
  }

  const totalTimeSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n========================================================================');
  console.log('                 Daily Routine Multi-Run Scorecard                      ');
  console.log('========================================================================');
  for (const r of results) {
    const statusIcon = r.success ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${statusIcon} | Account: ${r.account.padEnd(16)} | Result: ${r.success ? 'Completed' : r.error}`);
  }
  console.log('------------------------------------------------------------------------');
  console.log(`Total Accounts Processed: ${results.length} | Elapsed: ${totalTimeSec}s`);
  console.log('========================================================================\n');

  const anyFailed = results.some(r => !r.success);
  process.exit(anyFailed ? 1 : 0);
}

main().catch(err => {
  console.error('[DailyCLI] Fatal crash:', err);
  process.exit(1);
});

// src/cli/clear-unf-token.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { UnfGachaEngine } from '../engines/unf-gacha.engine.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountConfig } from '../types/account.types.js';

console.log('========================================================================');
console.log('       Granblue Fantasy - Unite & Fight Token Drawbox Clearer           ');
console.log('========================================================================');

const args = process.argv.slice(2);

// Parse flags and arguments
const isWindowed = !args.includes('--headless'); // Default windowed for live visual feedback
const isHeadless = !isWindowed;

// Extract max-boxes flag or positional
let maxBoxes = 200;
const maxBoxesIdx = args.findIndex(a => a === '--max-boxes' || a === '-m');
if (maxBoxesIdx !== -1 && args[maxBoxesIdx + 1]) {
  maxBoxes = parseInt(args[maxBoxesIdx + 1], 10) || 200;
}

// Extract event-id flag
let eventId = 'teamraid084';
const eventIdIdx = args.findIndex(a => a === '--event' || a === '-e');
if (eventIdIdx !== -1 && args[eventIdIdx + 1]) {
  eventId = args[eventIdIdx + 1];
}

// Account selection
let targetAccountId = 'acc1';
const accFlagIdx = args.findIndex(a => a === '--account' || a === '-a');
if (accFlagIdx !== -1 && args[accFlagIdx + 1]) {
  targetAccountId = args[accFlagIdx + 1];
} else {
  const positionalAcc = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a));
  if (positionalAcc) targetAccountId = positionalAcc;
}

const account: AccountConfig | undefined = AccountRegistry.getAccountById(targetAccountId) || AccountRegistry.loadAccounts()[0];

console.log(`Account:           ${account?.name || 'default'} (${account?.id || 'acc1'})`);
console.log(`Event ID:          ${eventId}`);
console.log(`Max Boxes:         ${maxBoxes}`);
console.log(`Window Mode:       ${isWindowed ? 'HEADFUL (Windowed)' : 'HEADLESS'}`);
console.log('========================================================================\n');

const cdp = new CdpConnectionManager();
let page: any = null;
let sentinel: SentinelWatchdog | null = null;
let engine: UnfGachaEngine | null = null;

const cleanExit = async () => {
  console.log('\n[UNF CLI] Gracefully shutting down token clearing...');
  if (engine) engine.requestStop();
  try { await cdp.disconnect(); } catch {}
  process.exit(0);
};

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);

try {
  console.log(`Connecting to browser for account [${account?.id || 'acc1'}]...`);
  const conn = await cdp.connectWithRetry(4, 2000, isHeadless, {
    cdpPort: account?.cdpPort || 9222,
    profileDir: account?.profileDir,
    proxy: account?.proxy
  });

  page = conn.page;
  sentinel = new SentinelWatchdog(page);
  await sentinel.assertSafe();

  engine = new UnfGachaEngine(page, sentinel);

  const result = await engine.clearTokens({
    eventId,
    maxBoxes,
    onProgress: (p) => {
      console.log(`[UNF Progress] Box #${p.boxNumber} | Total Cleared: ${p.boxesCleared} | Remaining Tokens: ${p.tokensRemaining?.toLocaleString() ?? 'Unknown'}`);
    }
  });

  console.log('\n========================================================================');
  console.log('                         UNF GACHA SCORECARD                            ');
  console.log('========================================================================');
  console.log(`Status:            ${result.status === 'COMPLETED' || result.status === 'DEPLETED' ? '✅ ' + result.status : '⚠️ ' + result.status}`);
  console.log(`Boxes Cleared:     ${result.boxesCleared}`);
  console.log(`Initial Tokens:    ${result.initialTokens?.toLocaleString() ?? 'Unknown'}`);
  console.log(`Final Tokens:      ${result.finalTokens?.toLocaleString() ?? 'Unknown'}`);
  console.log(`Tokens Spent:      ${result.tokensSpent.toLocaleString()}`);
  console.log(`Duration:          ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  console.log('========================================================================\n');

} catch (err: any) {
  console.error(`\n🚨 [UNF CLI] Execution Failed: ${err?.message || err}`);
  process.exit(1);
} finally {
  try { await cdp.disconnect(); } catch {}
}

// src/cli/run-leech.ts
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { TemplateParser } from '../templates/template-parser.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';

console.log('========================================================================');
console.log('         🌟 Granblue Fantasy - Leech & Fast Burst Automation Runner     ');
console.log('========================================================================');

/**
 * Resolves user-friendly raid shorthand into canonical leech template names.
 */
function resolveLeechTemplateName(input: string): string {
  const clean = input.toLowerCase().replace(/^(leech-|otkraid-)/, '').trim();

  // Magna 3 (Omega Rebirth) 6-Element Shorthand Map
  if (clean === 'colossus' || clean === 'colossus-ira' || clean === 'ira') {
    return 'leech-colossus-ira';
  }
  if (clean === 'tiamat' || clean === 'tiamat-aura' || clean === 'aura') {
    return 'leech-tiamat-aura';
  }
  if (clean === 'levi' || clean === 'leviathan' || clean === 'leviathan-mare' || clean === 'mare') {
    return 'leech-leviathan-mare';
  }
  if (clean === 'ygg' || clean === 'yggdrasil' || clean === 'yggdrasil-arbos' || clean === 'arbos') {
    return 'leech-yggdrasil-arbos';
  }
  if (clean === 'lumi' || clean === 'luminiera' || clean === 'chevalier' || clean === 'luminiera-credo' || clean === 'credo') {
    return 'leech-luminiera-credo';
  }
  if (clean === 'celeste' || clean === 'celeste-ater' || clean === 'ater') {
    return 'leech-celeste-ater';
  }

  // Fallback to direct name or leech prefix
  if (input.startsWith('leech-')) return input;
  if (input.startsWith('otkraid-')) return `leech-${input.slice(8)}`;
  return `leech-${input}`;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('-')));
  const isHeadless = !flags.has('--windowed') && !flags.has('--headful') && !flags.has('-w');
  const positionalArgs = args.filter(a => !a.startsWith('-'));

  const accounts = AccountRegistry.loadAccounts();
  if (accounts.length === 0) {
    console.error('❌ No accounts found in accounts.config.json. Run "bun run account:setup".');
    process.exit(1);
  }

  let targetAccountId = accounts[0].id;
  let targetTemplateName = 'leech-colossus-ira';
  let targetRuns = 100;

  // Named flag lookups
  const runsArgIdx = args.findIndex(a => a === '--runs' || a === '-r');
  if (runsArgIdx !== -1 && args[runsArgIdx + 1] && !isNaN(Number(args[runsArgIdx + 1]))) {
    targetRuns = parseInt(args[runsArgIdx + 1], 10);
  }

  const accArgIdx = args.findIndex(a => a === '--account' || a === '-a');
  if (accArgIdx !== -1 && args[accArgIdx + 1]) {
    targetAccountId = args[accArgIdx + 1].toLowerCase();
  }

  for (const pos of positionalArgs) {
    if (accounts.some(a => a.id.toLowerCase() === pos.toLowerCase())) {
      targetAccountId = pos.toLowerCase();
    } else if (!isNaN(Number(pos))) {
      targetRuns = parseInt(pos, 10);
    } else {
      targetTemplateName = resolveLeechTemplateName(pos);
    }
  }

  const account = AccountRegistry.getAccountById(targetAccountId) || accounts[0];
  const template = TemplateParser.loadTemplate(targetTemplateName);

  console.log(`• Account:          ${account.name} (${account.id})`);
  console.log(`• Target Raid:       ${template.name}`);
  console.log(`• Strategy:          Leech Fast Burst (${template.evaluatorStrategy || 'leech'})`);
  console.log(`• Target HP Filter:  HP <= ${template.maxHpPct ?? 20}%`);
  console.log(`• Players Filter:    Players >= ${template.minPlayers ?? 3} (fast clear guaranteed)`);
  console.log(`• Raid Finder Slot:  Slot ${template.raidSlot || (template.raidSlots ? template.raidSlots[0] : 1)} (#quest/assist)`);
  console.log(`• Primal Supporter:  ${template.supporterPriority?.join(', ') || 'Primal'}`);
  console.log(`• Target Runs:       ${targetRuns}`);
  console.log(`• Browser Mode:      ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
  console.log(`• Pending Recovery:  Auto-assist lingering raids on 3 active limit`);
  console.log('========================================================================\n');

  if (flags.has('--dry-run')) {
    console.log('Dry-run complete. Template structure and arguments are fully valid.\n');
    process.exit(0);
  }

  const cdpManager = new CdpConnectionManager();
  const { page } = await cdpManager.connectWithRetry(6, 2000, isHeadless, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir,
    proxy: account.proxy
  });

  const profile = await AccountAuthManager.ensureAuthenticated(page, account);
  if (!profile) {
    console.error(`[Leech] Account [${account.name}] could not be authenticated. Aborting.`);
    await cdpManager.disconnect();
    process.exit(1);
  }

  console.log(`[Leech] ✅ Verified In-Game Identity: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})\n`);

  const sentinel = new SentinelWatchdog(page);
  const engine = new UniversalWorkflowEngine(page, sentinel, template, account.id);
  await engine.ensureViewportAndMobile();

  cdpManager.onReconnect((newPage) => {
    sentinel.updatePage(newPage);
    engine.updatePage(newPage);
  });

  let isStopping = false;
  process.on('SIGINT', async () => {
    if (isStopping) {
      console.log('\n[Leech] Force quitting immediately...');
      process.exit(0);
    }
    isStopping = true;
    console.log('\n[Leech] ⚠️ Ctrl+C detected. Finishing current run and saving stats...');
    engine.requestStop();
  });

  try {
    await engine.runLoop({ runs: targetRuns });
  } finally {
    await cdpManager.disconnect();
  }
}

main().catch(err => {
  console.error('[Leech] Fatal error:', err);
  process.exit(1);
});

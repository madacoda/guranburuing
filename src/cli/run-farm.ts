// src/cli/run-farm.ts
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { TemplateParser } from '../templates/template-parser.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';

console.log('========================================================================');
console.log('       🌊 Granblue Fantasy - Adaptive Raid Farm Automation Runner       ');
console.log('========================================================================');

/**
 * Resolves user-friendly raid shorthand into canonical farm template names.
 */
export function resolveFarmTemplateName(input: string): string {
  const clean = input.toLowerCase().replace(/^(farm-|leech-|otkraid-|raid-)/, '').trim();

  // Magna 3 (Omega Rebirth) 6-Element Shorthand Map
  if (clean === 'levi' || clean === 'leviathan' || clean === 'leviathan-mare' || clean === 'mare') {
    return 'farm-leviathan-mare';
  }
  if (clean === 'colossus' || clean === 'colossus-ira' || clean === 'ira') {
    return 'farm-colossus-ira';
  }
  if (clean === 'tiamat' || clean === 'tiamat-aura' || clean === 'aura') {
    return 'farm-tiamat-aura';
  }
  if (clean === 'ygg' || clean === 'yggdrasil' || clean === 'yggdrasil-arbos' || clean === 'arbos') {
    return 'farm-yggdrasil-arbos';
  }
  if (clean === 'lumi' || clean === 'luminiera' || clean === 'chevalier' || clean === 'luminiera-credo' || clean === 'credo') {
    return 'farm-luminiera-credo';
  }
  if (clean === 'celeste' || clean === 'celeste-ater' || clean === 'ater') {
    return 'farm-celeste-ater';
  }
  if (clean === 'wilnas' || clean === 'wilnas-hl') {
    return 'raid-wilnas';
  }
  if (clean === 'fediel' || clean === 'fediel-hl') {
    return 'raid-fediel';
  }
  if (clean === 'theworld' || clean === 'world' || clean === 'the-world') {
    return 'raid-the-world';
  }
  if (clean === 'faahl' || clean === 'faa-hl' || clean === 'dark-rapture' || clean === 'lucilius') {
    return 'raid-dark-rapture-hard';
  }
  if (clean === 'belial' || clean === 'belial-hl' || clean === 'cunning' || clean === 'fallen-angel') {
    return 'raid-the-fallen-angel-of-cunning';
  }
  if (clean === 'bubz' || clean === 'bubz-hl' || clean === 'bubs' || clean === 'beelzebub' || clean === 'long-live-the-king') {
    return 'raid-long-live-the-king';
  }
  if (clean === 'lindwurm' || clean === 'lindwurm-hl' || clean === 'empyreal-ascension' || clean === 'empyreal' || clean === 'emperial-ascension' || clean === 'emperial') {
    return 'raid-empyreal-ascension';
  }

  // Fallback to direct name or farm prefix
  if (input.startsWith('farm-') || input.startsWith('raid-') || input.startsWith('leech-')) return input;
  return `farm-${input}`;
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
  let targetTemplateName = 'farm-leviathan-mare';
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
      targetTemplateName = resolveFarmTemplateName(pos);
    }
  }

  const account = AccountRegistry.getAccountById(targetAccountId) || accounts[0];
  let template;
  try {
    template = TemplateParser.loadTemplate(targetTemplateName);
  } catch {
    // If farm- template doesn't exist yet for another boss, fallback to leech or raid
    const fallbackLeech = targetTemplateName.replace(/^farm-/, 'leech-');
    try {
      template = TemplateParser.loadTemplate(fallbackLeech);
      console.log(`ℹ️ [Notice] Farm template "${targetTemplateName}" not found on disk; falling back to "${fallbackLeech}".`);
    } catch {
      template = TemplateParser.loadTemplate(targetTemplateName);
    }
  }

  console.log(`• Account:          ${account.name} (${account.id})`);
  console.log(`• Target Raid:       ${template.name}`);
  console.log(`• Strategy:          Adaptive Damage Farm (${template.evaluatorStrategy || 'farm'})`);
  console.log(`• Target HP Filter:  HP ${template.minHpPct ?? 1}% - ${template.maxHpPct ?? 95}% (broad damage window)`);
  console.log(`• Player Filter:     Most Joined (Players >= ${template.minPlayers ?? 2}, heavy score for 10-28 players)`);
  console.log(`• Adaptive Fallback: ${template.adaptive !== false ? 'ENABLED (Zero idle standby, joins best active raid)' : 'DISABLED'}`);
  console.log(`• Raid Finder Slot:  Slot ${template.raidSlot || (template.raidSlots ? template.raidSlots[0] : 1)} (#quest/assist)`);
  console.log(`• Supporter Summons: ${template.supporterPriority?.join(', ') || 'Primal / Magna'}`);
  console.log(`• Target Runs:       ${targetRuns}`);
  console.log(`• Browser Mode:      ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
  console.log(`• Clear Speed:       Prioritizes high player density + lowest HP for fastest reruns`);
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
    console.error(`[Farm] Account [${account.name}] could not be authenticated. Aborting.`);
    await cdpManager.disconnect();
    process.exit(1);
  }

  console.log(`[Farm] ✅ Verified In-Game Identity: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})\n`);

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
      console.log('\n[Farm] Force quitting immediately...');
      await cdpManager.standby().catch(() => null);
      process.exit(0);
    }
    isStopping = true;
    console.log('\n[Farm] ⚠️ Ctrl+C detected. Stopping workflow and placing browser in standby...');
    engine.requestStop();
    const forceTimer = setTimeout(async () => {
      console.log('[Farm] 💤 Closing GBF tab and entering browser standby mode (about:blank)...');
      await cdpManager.standby().catch(() => null);
      process.exit(0);
    }, 2500);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();
  });

  try {
    await engine.runLoop({ runs: targetRuns });
  } finally {
    console.log('[Farm] 💤 Closing GBF tab and entering browser standby mode (about:blank)...');
    await cdpManager.standby().catch(() => null);
  }
}

// Only execute when run directly from CLI
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch(err => {
    console.error('[Farm] Fatal error:', err);
    process.exit(1);
  });
}

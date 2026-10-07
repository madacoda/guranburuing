// src/cli/run-otkraid.ts
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { TemplateParser } from '../templates/template-parser.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';

console.log('========================================================================');
console.log('            OTK Raid Fast Burst & Leech Automation Runner              ');
console.log('========================================================================');

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
  let targetTemplateName = 'otkraid-colossus-ira';
  let targetRuns = 100;

  for (const pos of positionalArgs) {
    if (accounts.some(a => a.id.toLowerCase() === pos.toLowerCase())) {
      targetAccountId = pos.toLowerCase();
    } else if (!isNaN(Number(pos))) {
      targetRuns = parseInt(pos, 10);
    } else if (pos.toLowerCase().includes('colossus') || pos.toLowerCase() === 'colossus-ira') {
      targetTemplateName = 'otkraid-colossus-ira';
    } else {
      targetTemplateName = pos;
    }
  }

  const account = AccountRegistry.getAccountById(targetAccountId) || accounts[0];
  const template = TemplateParser.loadTemplate(targetTemplateName);

  console.log(`• Account:          ${account.name} (${account.id})`);
  console.log(`• Target Raid:       ${template.name}`);
  console.log(`• Strategy:          OTK Burst Leecher (${template.evaluatorStrategy || 'otk_burst'})`);
  console.log(`• Target HP Filter:  HP <= ${template.maxHpPct ?? 20}%`);
  console.log(`• Players Filter:    Players >= ${template.minPlayers ?? 3} (fast clear guaranteed)`);
  console.log(`• Raid Finder Slot:  Slot ${template.raidSlot || (template.raidSlots ? template.raidSlots[0] : 1)} (#quest/assist)`);
  console.log(`• Supporter Summon:  ${template.supporterPriority?.join(', ') || 'Varuna'}`);
  console.log(`• Target Runs:       ${targetRuns}`);
  console.log(`• Browser Mode:      ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
  console.log(`• Pending Recovery:  Auto-assist lingering raids on 3 active limit`);
  console.log('========================================================================\n');

  const cdpManager = new CdpConnectionManager();
  const { page } = await cdpManager.connectWithRetry(6, 2000, isHeadless, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir,
    proxy: account.proxy
  });

  const profile = await AccountAuthManager.ensureAuthenticated(page, account);
  if (!profile) {
    console.error(`[OTKRaid] Account [${account.name}] could not be authenticated. Aborting.`);
    await cdpManager.disconnect();
    process.exit(1);
  }

  console.log(`[OTKRaid] ✅ Verified In-Game Identity: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})\n`);

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
      console.log('\n[OTKRaid] Force quitting immediately...');
      process.exit(0);
    }
    isStopping = true;
    console.log('\n[OTKRaid] ⚠️ Ctrl+C detected. Finishing current run and saving stats...');
    engine.requestStop();
  });

  try {
    await engine.runLoop({ runs: targetRuns });
  } finally {
    await cdpManager.disconnect();
  }
}

main().catch(err => {
  console.error('[OTKRaid] Fatal error:', err);
  process.exit(1);
});

// src/cli/run-arcarum.ts
import readline from 'readline';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { TemplateParser } from '../templates/template-parser.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';
import {
  ArcarumPreset,
  ARCARUM_ALIASES,
  ARCARUM_FAYM_PRESETS,
  ARCARUM_GOLIATH_PRESETS,
  ARCARUM_KALENDAE_PRESETS,
  ARCARUM_JOCULATOR_PRESETS,
  ARCARUM_MUNDUS_PRESETS,
  ARCARUM_PRESETS,
  resolveArcarumPreset
} from '../domain/arcarum/arcarum.catalog.js';

export {
  type ArcarumPreset,
  ARCARUM_ALIASES,
  ARCARUM_FAYM_PRESETS,
  ARCARUM_GOLIATH_PRESETS,
  ARCARUM_KALENDAE_PRESETS,
  ARCARUM_JOCULATOR_PRESETS,
  ARCARUM_MUNDUS_PRESETS,
  ARCARUM_PRESETS,
  resolveArcarumPreset
};

function printHelp(): void {
  console.log(`
========================================================================
    Granblue Fantasy - Arcarum Replicard Sandbox Smart Controller
========================================================================
Usage:
  bun src/cli/run-arcarum.ts [account] [target] [runs] [options]

Zone Kalendae (Stage 6 / Here Might Be Swords) Targets:
  Boss & Defenders:
    stage6         - Universal Stage 6 Map Scanner & Auto-Defender Target
    xeno-ifrit     - Xeno Ifrit Militis (Fire Boss, 25 AAP)
                     Direct URL: #replicard/supporter/6/6/14/815131/25/0/25083

Zone Joculator (Stage 7 / Here Be Swords) Targets:
  Boss & Defenders:
    stage7         - Universal Stage 7 Map Scanner & Auto-Defender Target
    redemption     - Lady of Redemption (Justice Defender, Water, 30 AAP)
                     Direct URL: #replicard/supporter/7/7/7/816071/25
    xeno-cocytus   - Xeno Cocytus Militis (Water Boss, 25 AAP)
                     Direct URL: #replicard/supporter/7/7/15/816131/25/0/25083
  5-Gauge Mobs:
    maiden         - Maiden of the Depths (Water 5-Gauge, 20 AAP, spawns Redemption)
                     Direct URL: #replicard/supporter/7/7/7/816031/25

Zone Faym (Stage 3 / Here Be Staves) Targets:
  Boss & Defenders:
    paragon        - Lilywhite Paragon (The Moon Defender, Water Lv 100, 98M HP, 30 AAP)
                     Direct URL: #replicard/supporter/3/3/10/812111/25
  5-Gauge Mobs:
    fortress       - Faymian Fortress (The Moon 5-Gauge, Water Lv 90, 61.65M HP, 20 AAP)
                     Features 10-Hit Earth Barrier shredder mechanics

Zone Goliath (Stage 3 / Here Be Staves) Targets:
  Boss & Defenders:
    stage3         - Universal Stage 3 Map Scanner & Auto-Defender Target
    triune         - Goliath Triune (Zone Boss, Earth, 30 AAP + Rib/Organ/Core)
    avarice        - Avatar of Avarice (The Hanged Man Defender, Pink Sector)
    keeper         - Goliath Keeper (The Tower Defender, Green Sector)
    howler         - Frenzied Howler (Death Defender, Yellow Sector)
  5-Gauge Standard & Heralds:
    goliath-herald - Zone Goliath Heralds (+100% Sephira Gauge Boost for 60m)
    panther        - Earthshaking Panther (Green 5-Gauge, spawns Keeper)
    barbarian      - Bloodstained Barbarian (Pink 5-Gauge, spawns Avarice)
    despair        - Writhing Despair (Yellow 5-Gauge, spawns Howler)

Zone Mundus (Stage 10 / Genesis Creationis) Targets:
  Defenders & Bosses:
    ca-ong         - Ca Ong Militis (Water Defender, Div 10)
    prometheus     - Prometheus Militis (Fire Defender, Div 3)
    gilgamesh      - Gilgamesh Militis (Earth Defender, Div 7)
    morrigna       - Morrigna Militis (Wind Defender, Div 15)
    theworld       - The World (Zone Mundus Final Core Boss, Div 16)
    stage10        - Universal Stage 10 Map Scanner & Auto-Defender Target
  5-Gauge Standard Farm:
    steve          - Parasite Steve (Water, Div 9, spawns Ca Ong)
    tide-caller    - Tide Caller (Water, Div 10)
    fire-demon     - Earth-Shattering Fire Demon (Fire, Div 3, spawns Prometheus)
    elephant       - Elephant Stomping Ground (Earth, Div 7, spawns Gilgamesh)
    princess       - Princess of the Horde (Earth, Div 6)
    dragon-green   - Dragon in Glittering Green (Wind, Div 14, spawns Morrigna)
  3-Gauge Fast Burst & Heralds:
    pincers        - Hotheaded Pincers (Fire 3-bar, Div 2)
    winged-cat     - Winged Demon Cat (Wind 3-bar, Div 13)
    herald-water   - Herald of Water (Div 9)
    herald-earth   - Herald of Earth (Div 6)

Options:
  --windowed       Run with visible Chromium browser GUI
  --headless       Run headless (default)
  --dry-run        Validate template and print execution pipeline

Examples:
  bun src/cli/run-arcarum.ts acc1 stage3 500
  bun src/cli/run-arcarum.ts acc1 triune 50
  bun src/cli/run-arcarum.ts acc1 keeper 100
  bun src/cli/run-arcarum.ts acc1 ca-ong 100
========================================================================
`);
}

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.includes('list')) {
    printHelp();
    process.exit(0);
  }

  // 1. Account selection
  let accountId = 'acc1';
  let targetPresetOrTemplate = '';
  let targetRuns = 0;
  const isHeadless = !args.includes('--windowed');

  const filteredArgs = args.filter(a => !a.startsWith('--'));

  if (filteredArgs.length >= 1) {
    if (AccountRegistry.getAccountById(filteredArgs[0])) {
      accountId = filteredArgs[0];
      if (filteredArgs.length >= 2) targetPresetOrTemplate = filteredArgs[1];
      if (filteredArgs.length >= 3) targetRuns = parseInt(filteredArgs[2], 10);
    } else {
      // First arg might be preset
      targetPresetOrTemplate = filteredArgs[0];
      if (filteredArgs.length >= 2) targetRuns = parseInt(filteredArgs[1], 10);
    }
  }

  const account = AccountRegistry.getAccountById(accountId);
  if (!account) {
    console.error(`[ArcarumController] Account "${accountId}" not found in accounts.config.json.`);
    process.exit(1);
  }

  // 2. Preset Resolution
  let preset = resolveArcarumPreset(targetPresetOrTemplate);

  if (!preset && !targetPresetOrTemplate) {
    if (!process.stdin.isTTY) {
      preset = ARCARUM_PRESETS['stage3'];
    } else {
      console.log('\n========================================================================');
      console.log('       Select Arcarum Replicard Sandbox Target                          ');
      console.log('========================================================================');
      const keys = Object.keys(ARCARUM_PRESETS);
      keys.forEach((k, idx) => {
        const p = ARCARUM_PRESETS[k];
        console.log(`  [${idx + 1}] ${k.padEnd(16, ' ')} | ${p.name.padEnd(30, ' ')} | ${p.element.padEnd(6, ' ')} | ${p.type.padEnd(9, ' ')} | ${p.drops}`);
      });
      console.log('========================================================================');
      const selection = await promptUser('Choose target number [1]: ');
      const selIdx = parseInt(selection || '1', 10) - 1;
      const chosenKey = keys[selIdx] || 'stage3';
      preset = ARCARUM_PRESETS[chosenKey];
    }
  }

  const templateName = preset ? preset.templateId : targetPresetOrTemplate;
  const template = TemplateParser.loadTemplate(templateName);

  if (!targetRuns) {
    targetRuns = template.defaultRuns || (preset?.type === 'herald' ? 1 : 500);
  }

  // Dry Run check
  if (args.includes('--dry-run')) {
    console.log(`\n[ArcarumController] Dry run for: ${template.name}`);
    console.log(`Quest URL:   ${template.questUrl}`);
    console.log(`Speed:       ${template.speedProfile || 'fast'}`);
    console.log(`Steps:       ${template.steps.map(s => s.code || s.action).join(' -> ')}`);
    return;
  }

  console.log(`\n========================================================================`);
  console.log(`   Arcarum Zone Mundus Smart Full Auto Controller                     `);
  console.log(`========================================================================`);
  console.log(`Account:             ${account.name} (${account.id})`);
  console.log(`CDP Port:            ${account.cdpPort}`);
  console.log(`Target:              ${preset?.name || template.name}`);
  if (preset) {
    console.log(`Sector:              ${preset.sector} (Division ${preset.divisionId})`);
    console.log(`Element / Type:      ${preset.element} | ${preset.type.toUpperCase()}`);
    console.log(`AAP Cost / Drops:    ${preset.aapCost} AAP | ${preset.drops}`);
  }
  console.log(`Template:            ${templateName}`);
  console.log(`Runs:                ${targetRuns}`);
  console.log(`Browser Mode:        ${isHeadless ? 'HEADLESS (--headless=new)' : 'WINDOWED (Visible GUI)'}`);
  console.log(`========================================================================\n`);

  // Connect via CDP
  const cdpManager = new CdpConnectionManager();
  const { page } = await cdpManager.connectWithRetry(6, 2000, isHeadless, {
    cdpPort: account.cdpPort,
    profileDir: account.profileDir,
    proxy: account.proxy
  });

  // Verify authentication
  const profile = await AccountAuthManager.ensureAuthenticated(page, account);
  if (!profile) {
    console.error(`[ArcarumController] Account [${account.name}] could not be authenticated. Aborting.`);
    await cdpManager.disconnect();
    process.exit(1);
  }

  console.log(`[ArcarumController] ✅ Authenticated as player: "${profile.name}" (Rank ${profile.rank})\n`);

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
      console.log('\n[ArcarumController] Force quitting immediately...');
      process.exit(0);
    }
    isStopping = true;
    console.log('\n[ArcarumController] ⚠️ Ctrl+C detected. Finishing current run and saving stats...');
    engine.requestStop();
  });

  try {
    await engine.runLoop({ runs: targetRuns });
  } finally {
    await cdpManager.disconnect();
    process.exit(0);
  }
}

const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('run-arcarum.ts') ||
  process.argv[1].endsWith('run-arcarum.js') ||
  process.argv[1].includes('run-arcarum')
);

if (isDirectExecution) {
  main().catch(err => {
    console.error('[ArcarumController] Fatal error:', err);
    process.exit(1);
  });
}

// src/cli/run-arcarum.ts
import readline from 'readline';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { TemplateParser } from '../templates/template-parser.js';
import { UniversalWorkflowEngine } from '../engines/universal-workflow.engine.js';
import { WorkflowTemplate } from '../types/workflow.types.js';

export interface ArcarumPreset {
  id: string;
  name: string;
  templateId: string;
  sector: string;
  divisionId: number;
  questId: string;
  element: string;
  type: 'defender' | '5-gauge' | '3-gauge' | 'herald' | 'boss' | 'map';
  aapCost: number;
  drops: string;
}

export const ARCARUM_MUNDUS_PRESETS: Record<string, ArcarumPreset> = {
  // --- 1. Defenders & Core Boss ---
  'ca-ong': {
    id: 'ca-ong',
    name: 'Ca Ong Militis',
    templateId: 'arcarum-ca-ong-militis-smart',
    sector: 'Grotto of Solace: Midpoint',
    divisionId: 10,
    questId: '819151',
    element: 'Water',
    type: 'defender',
    aapCost: 30,
    drops: 'Glacial Rapier Militis, Water Luster, Pillar of Sea'
  },
  'prometheus': {
    id: 'prometheus',
    name: 'Prometheus Militis',
    templateId: 'arcarum-prometheus-militis-smart',
    sector: 'Serenity Ridge: Slopes',
    divisionId: 3,
    questId: '819141',
    element: 'Fire',
    type: 'defender',
    aapCost: 30,
    drops: 'Prominence Militis, Fire Luster, Pillar of Sun'
  },
  'gilgamesh': {
    id: 'gilgamesh',
    name: 'Gilgamesh Militis',
    templateId: 'arcarum-gilgamesh-militis-smart',
    sector: 'Southern Great Wastes',
    divisionId: 7,
    questId: '819161',
    element: 'Earth',
    type: 'defender',
    aapCost: 30,
    drops: 'Heavy Cane Militis, Earth Luster, Pillar of Land'
  },
  'morrigna': {
    id: 'morrigna',
    name: 'Morrigna Militis',
    templateId: 'arcarum-morrigna-militis-smart',
    sector: 'Desolate Ravine: The Crown',
    divisionId: 15,
    questId: '819171',
    element: 'Wind',
    type: 'defender',
    aapCost: 30,
    drops: 'Tempest Militis, Wind Luster, Pillar of Sky'
  },
  'theworld': {
    id: 'theworld',
    name: 'The World',
    templateId: 'arcarum-theworld-smart',
    sector: 'The New World (Center Core)',
    divisionId: 16,
    questId: '819131',
    element: 'All',
    type: 'boss',
    aapCost: 30,
    drops: 'World Idean, Mundus Lusters, New World Quartz'
  },
  'stage10': {
    id: 'stage10',
    name: 'Zone Mundus Universal Map',
    templateId: 'arcarum-stage-10-smart',
    sector: 'Zone Mundus Stage 10 Hub',
    divisionId: 10,
    questId: '',
    element: 'All',
    type: 'map',
    aapCost: 20,
    drops: 'Dynamic Division Scanner & Defender Auto-Target'
  },

  // --- 2. Primary 5-Gauge Farming Mobs ---
  'steve': {
    id: 'steve',
    name: 'Parasite Steve',
    templateId: 'arcarum-mundus-parasite-steve-smart',
    sector: 'Grotto of Solace: Entrance',
    divisionId: 9,
    questId: '819071',
    element: 'Water',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Ca Ong Militis, Water Sephira Box'
  },
  'tide-caller': {
    id: 'tide-caller',
    name: 'Tide Caller',
    templateId: 'arcarum-mundus-tide-caller-smart',
    sector: 'Grotto of Solace: Midpoint',
    divisionId: 10,
    questId: '819081',
    element: 'Water',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Water Sephira Box, Ca Ong Hell Gauge'
  },
  'fire-demon': {
    id: 'fire-demon',
    name: 'Earth-Shattering Fire Demon',
    templateId: 'arcarum-mundus-fire-demon-smart',
    sector: 'Serenity Ridge: Slopes',
    divisionId: 3,
    questId: '819021',
    element: 'Fire',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Prometheus Militis, Fire Sephira Box'
  },
  'elephant': {
    id: 'elephant',
    name: 'Elephant Stomping Ground',
    templateId: 'arcarum-mundus-elephant-smart',
    sector: 'Southern Great Wastes',
    divisionId: 7,
    questId: '819051',
    element: 'Earth',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Gilgamesh Militis, Earth Sephira Box'
  },
  'princess': {
    id: 'princess',
    name: 'Princess of the Horde',
    templateId: 'arcarum-mundus-princess-horde-smart',
    sector: 'Eastern Great Wastes',
    divisionId: 6,
    questId: '819041',
    element: 'Earth',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Earth Sephira Box, Gilgamesh Hell Gauge'
  },
  'dragon-green': {
    id: 'dragon-green',
    name: 'Dragon in Glittering Green',
    templateId: 'arcarum-mundus-dragon-green-smart',
    sector: 'Desolate Ravine: The Belly',
    divisionId: 14,
    questId: '819111',
    element: 'Wind',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Morrigna Militis, Wind Sephira Box'
  },

  // --- 3. Fast 3-Gauge Burst Quests ---
  'pincers': {
    id: 'pincers',
    name: 'Hotheaded Pincers',
    templateId: 'arcarum-mundus-pincers-smart',
    sector: 'Serenity Ridge: Foothills',
    divisionId: 2,
    questId: '819011',
    element: 'Fire',
    type: '3-gauge',
    aapCost: 20,
    drops: '3-bar low HP fast burst, Sephira materials'
  },
  'winged-cat': {
    id: 'winged-cat',
    name: 'Winged Demon Cat',
    templateId: 'arcarum-mundus-winged-cat-smart',
    sector: 'Desolate Ravine: The Toes',
    divisionId: 13,
    questId: '819101',
    element: 'Wind',
    type: '3-gauge',
    aapCost: 20,
    drops: '3-bar low HP fast burst, Sephira materials'
  },

  // --- 4. Sephira Heralds (+100% Boost) ---
  'herald-water': {
    id: 'herald-water',
    name: 'Herald of Water',
    templateId: 'arcarum-mundus-herald-water-smart',
    sector: 'Grotto of Solace: Entrance',
    divisionId: 9,
    questId: '819191',
    element: 'Fire',
    type: 'herald',
    aapCost: 20,
    drops: '+100% Sephira Gauge Boost for 60 Minutes'
  },
  'herald-earth': {
    id: 'herald-earth',
    name: 'Herald of Earth',
    templateId: 'arcarum-mundus-herald-earth-smart',
    sector: 'Eastern Great Wastes',
    divisionId: 6,
    questId: '819201',
    element: 'Fire',
    type: 'herald',
    aapCost: 20,
    drops: '+100% Sephira Gauge Boost for 60 Minutes'
  },

  // --- 5. Off-Element 5-Gauge Quests ---
  'voltage-rock': {
    id: 'voltage-rock',
    name: 'High-Voltage Rock',
    templateId: 'arcarum-mundus-voltage-rock-smart',
    sector: 'Serenity Ridge: Peaks',
    divisionId: 4,
    questId: '819031',
    element: 'Light',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Light Sephira Box, Fire Defender Hell Gauge'
  },
  'love-meeeee': {
    id: 'love-meeeee',
    name: 'Love Meeee',
    templateId: 'arcarum-mundus-love-meeeee-smart',
    sector: 'Western Great Wastes',
    divisionId: 8,
    questId: '819061',
    element: 'Dark',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Dark Sephira Box, Earth Defender Hell Gauge'
  },
  'dragon-princess': {
    id: 'dragon-princess',
    name: 'Proud War Princess of Dragons',
    templateId: 'arcarum-mundus-dragon-princess-smart',
    sector: 'Grotto of Solace: Depths',
    divisionId: 11,
    questId: '819091',
    element: 'Dark',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Dark Sephira Box, Water Defender Hell Gauge'
  },
  'wild-hunt': {
    id: 'wild-hunt',
    name: 'Goddess of the Wild Hunt',
    templateId: 'arcarum-mundus-wild-hunt-smart',
    sector: 'Desolate Ravine: The Crown',
    divisionId: 15,
    questId: '819121',
    element: 'Light',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Light Sephira Box, Wind Defender Hell Gauge'
  }
};

// Aliases
export const ARCARUM_ALIASES: Record<string, string> = {
  'caong': 'ca-ong',
  'world': 'theworld',
  'mundus': 'stage10',
  'parasite-steve': 'steve',
  'green-dragon': 'dragon-green',
  'cat': 'winged-cat',
  'rock': 'voltage-rock',
  'love-mee': 'love-meeeee',
  'loveme': 'love-meeeee'
};

function printHelp(): void {
  console.log(`
========================================================================
    Granblue Fantasy - Arcarum Zone Mundus (Stage 10) Smart Controller
========================================================================
Usage:
  bun src/cli/run-arcarum.ts [account] [target] [runs] [options]

Target Presets:
  Defenders & Bosses:
    ca-ong         - Ca Ong Militis (Water Defender, Div 10)
    prometheus     - Prometheus Militis (Fire Defender, Div 3)
    gilgamesh      - Gilgamesh Militis (Earth Defender, Div 7)
    morrigna       - Morrigna Militis (Wind Defender, Div 15)
    theworld       - The World (Zone Mundus Final Core Boss, Div 16)
    stage10        - Universal Stage 10 Map Scanner & Auto-Defender Target

  5-Gauge Standard Farm (Boxes & Defender Gauge):
    steve          - Parasite Steve (Water, Div 9, spawns Ca Ong)
    tide-caller    - Tide Caller (Water, Div 10)
    fire-demon     - Earth-Shattering Fire Demon (Fire, Div 3, spawns Prometheus)
    elephant       - Elephant Stomping Ground (Earth, Div 7, spawns Gilgamesh)
    princess       - Princess of the Horde (Earth, Div 6)
    dragon-green   - Dragon in Glittering Green (Wind, Div 14, spawns Morrigna)

  3-Gauge Fast Burst Farm:
    pincers        - Hotheaded Pincers (Fire 3-bar, Div 2)
    winged-cat     - Winged Demon Cat (Wind 3-bar, Div 13)

  Sephira Heralds (+100% Boost for 60m):
    herald-water   - Herald of Water (Div 9)
    herald-earth   - Herald of Earth (Div 6)

  Off-Element 5-Gauge Mobs:
    voltage-rock   - High-Voltage Rock (Light, Div 4)
    love-meeeee    - Love Meeee (Dark, Div 8)
    dragon-princess- Proud War Princess of Dragons (Dark, Div 11)
    wild-hunt      - Goddess of the Wild Hunt (Light, Div 15)

Options:
  --windowed       Run with visible Chromium browser GUI
  --headless       Run headless (default)
  --dry-run        Validate template and print execution pipeline

Examples:
  bun src/cli/run-arcarum.ts acc1 ca-ong 100
  bun src/cli/run-arcarum.ts acc1 steve 200
  bun src/cli/run-arcarum.ts acc1 theworld 50 --windowed
  bun src/cli/run-arcarum.ts acc1 stage10 500
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
  let resolvedPresetKey = targetPresetOrTemplate.toLowerCase();
  if (ARCARUM_ALIASES[resolvedPresetKey]) {
    resolvedPresetKey = ARCARUM_ALIASES[resolvedPresetKey];
  }

  let preset = ARCARUM_MUNDUS_PRESETS[resolvedPresetKey];

  if (!preset && !targetPresetOrTemplate) {
    if (!process.stdin.isTTY) {
      preset = ARCARUM_MUNDUS_PRESETS['ca-ong'];
    } else {
      console.log('\n========================================================================');
      console.log('       Select Arcarum Zone Mundus (Stage 10) Target                     ');
      console.log('========================================================================');
      const keys = Object.keys(ARCARUM_MUNDUS_PRESETS);
      keys.forEach((k, idx) => {
        const p = ARCARUM_MUNDUS_PRESETS[k];
        console.log(`  [${idx + 1}] ${k.padEnd(16, ' ')} | ${p.name.padEnd(30, ' ')} | ${p.element.padEnd(6, ' ')} | ${p.type.padEnd(9, ' ')} | ${p.drops}`);
      });
      console.log('========================================================================');
      const selection = await promptUser('Choose target number [1]: ');
      const selIdx = parseInt(selection || '1', 10) - 1;
      const chosenKey = keys[selIdx] || 'ca-ong';
      preset = ARCARUM_MUNDUS_PRESETS[chosenKey];
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
  const { browser, page } = await cdpManager.connectWithRetry(6, 2000, isHeadless, {
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

main().catch(err => {
  console.error('[ArcarumController] Fatal error:', err);
  process.exit(1);
});

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

// ============================================================================
// Zone Goliath (Stage 3 / Here Be Staves) Authoritative Presets
// ============================================================================
export const ARCARUM_GOLIATH_PRESETS: Record<string, ArcarumPreset> = {
  // --- 1. Zone Boss & Defenders ---
  'stage3': {
    id: 'stage3',
    name: 'Zone Goliath Universal Map',
    templateId: 'arcarum-stage-3-smart',
    sector: 'Zone Goliath Stage 3 Hub',
    divisionId: 3,
    questId: '',
    element: 'Earth',
    type: 'map',
    aapCost: 20,
    drops: 'Dynamic Sector Scanner & Defender Auto-Target'
  },
  'triune': {
    id: 'triune',
    name: 'Goliath Triune',
    templateId: 'arcarum-goliath-triune-smart',
    sector: 'Zone Goliath Core (The Triune)',
    divisionId: 3,
    questId: '',
    element: 'Earth',
    type: 'boss',
    aapCost: 30,
    drops: 'Tower / Hanged Man / Death Ideans, Earthborne Astra, Quartz'
  },
  'avarice': {
    id: 'avarice',
    name: 'Avatar of Avarice (The Hanged Man)',
    templateId: 'arcarum-avatar-of-avarice-smart',
    sector: 'Pink Sector (The Hanged Man)',
    divisionId: 3,
    questId: '',
    element: 'Earth',
    type: 'defender',
    aapCost: 30,
    drops: 'Goliath Organ, Earthborne Astra, Hanged Man Idean'
  },
  'keeper': {
    id: 'keeper',
    name: 'Goliath Keeper (The Tower)',
    templateId: 'arcarum-goliath-keeper-smart',
    sector: 'Green Sector (The Tower)',
    divisionId: 3,
    questId: '',
    element: 'Earth',
    type: 'defender',
    aapCost: 30,
    drops: 'Goliath Rib, Earthborne Astra, Tower Idean'
  },
  'howler': {
    id: 'howler',
    name: 'Frenzied Howler (Death)',
    templateId: 'arcarum-frenzied-howler-smart',
    sector: 'Yellow Sector (Death)',
    divisionId: 3,
    questId: '',
    element: 'Dark',
    type: 'defender',
    aapCost: 30,
    drops: 'Goliath Core, Darkborne Astra, Death Idean'
  },

  // --- 2. Sephira Heralds (+100% Boost) ---
  'goliath-herald': {
    id: 'goliath-herald',
    name: 'Zone Goliath Sephira Heralds',
    templateId: 'arcarum-goliath-herald-smart',
    sector: 'Zone Goliath Dynamic Heralds',
    divisionId: 3,
    questId: '',
    element: 'All',
    type: 'herald',
    aapCost: 20,
    drops: '+100% Sephira Gauge Boost for 60 Minutes'
  },

  // --- 3. Standard 5-Gauge Farming Targets ---
  'panther': {
    id: 'panther',
    name: 'Earthshaking Panther',
    templateId: 'arcarum-goliath-panther-smart',
    sector: 'Green Sector (The Tower)',
    divisionId: 3,
    questId: '',
    element: 'Earth',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Goliath Keeper, Earth Sephira Box'
  },
  'barbarian': {
    id: 'barbarian',
    name: 'Bloodstained Barbarian',
    templateId: 'arcarum-goliath-barbarian-smart',
    sector: 'Pink Sector (The Hanged Man)',
    divisionId: 3,
    questId: '',
    element: 'Earth',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Avatar of Avarice, Earth Sephira Box'
  },
  'despair': {
    id: 'despair',
    name: 'Writhing Despair',
    templateId: 'arcarum-goliath-despair-smart',
    sector: 'Yellow Sector (Death)',
    divisionId: 3,
    questId: '',
    element: 'Dark',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Frenzied Howler, Dark Sephira Box'
  }
};

// ============================================================================
// Zone Faym (Stage 3 / Here Be Staves) Authoritative Presets
// ============================================================================
export const ARCARUM_FAYM_PRESETS: Record<string, ArcarumPreset> = {
  'paragon': {
    id: 'paragon',
    name: 'Lilywhite Paragon (The Moon Defender)',
    templateId: 'arcarum-lilywhite-paragon-smart',
    sector: 'Zone Faym: Green Sector (The Moon / Div 10)',
    divisionId: 10,
    questId: '812111',
    element: 'Water',
    type: 'defender',
    aapCost: 30,
    drops: 'Faym Rib, Moon Idean, Aquaborne Astra, Moon Veritas, Sephira Emerald weapons'
  },
  'fortress': {
    id: 'fortress',
    name: 'Faymian Fortress (The Moon 5-Gauge)',
    templateId: 'arcarum-faymian-fortress-smart',
    sector: 'Zone Faym: Green Sector (The Moon / Div 10)',
    divisionId: 10,
    questId: '',
    element: 'Water',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Lilywhite Paragon, Moon Sephira Box, 10-Hit Barrier Buster'
  }
};

// ============================================================================
// Zone Joculator (Stage 7 / Here Be Swords / Flumen Glacialis) Presets
// ============================================================================
export const ARCARUM_JOCULATOR_PRESETS: Record<string, ArcarumPreset> = {
  'stage7': {
    id: 'stage7',
    name: 'Zone Joculator Universal Map',
    templateId: 'arcarum-stage-7-smart',
    sector: 'Zone Joculator Stage 7 Hub (Flumen Glacialis)',
    divisionId: 7,
    questId: '',
    element: 'Earth',
    type: 'map',
    aapCost: 20,
    drops: 'Dynamic Sector Scanner & Defender Auto-Target'
  },
  'redemption': {
    id: 'redemption',
    name: 'Lady of Redemption (Justice Defender)',
    templateId: 'arcarum-lady-of-redemption-smart',
    sector: 'Arctic Plains: Flumen Glacialis (Stage 7 / Div 7)',
    divisionId: 7,
    questId: '816071',
    element: 'Water',
    type: 'defender',
    aapCost: 30,
    drops: 'Joculator materials, Justice Idean, Aquaborne Astra, Justice Veritas, Sephira weapons'
  },
  'maiden': {
    id: 'maiden',
    name: 'Maiden of the Depths (5-Gauge)',
    templateId: 'arcarum-maiden-of-the-depths-smart',
    sector: 'Arctic Plains: Flumen Glacialis (Stage 7 / Div 7)',
    divisionId: 7,
    questId: '816031',
    element: 'Water',
    type: '5-gauge',
    aapCost: 20,
    drops: 'Spawns Lady of Redemption, Water Sephira Box, Defender Hell Gauge'
  }
};

// Merged authoritative preset registry
export const ARCARUM_PRESETS: Record<string, ArcarumPreset> = {
  ...ARCARUM_MUNDUS_PRESETS,
  ...ARCARUM_GOLIATH_PRESETS,
  ...ARCARUM_FAYM_PRESETS,
  ...ARCARUM_JOCULATOR_PRESETS
};

// Aliases
export const ARCARUM_ALIASES: Record<string, string> = {
  // Stage 10 (Zone Mundus)
  'caong': 'ca-ong',
  'world': 'theworld',
  'mundus': 'stage10',
  'parasite-steve': 'steve',
  'green-dragon': 'dragon-green',
  'cat': 'winged-cat',
  'rock': 'voltage-rock',
  'love-mee': 'love-meeeee',
  'loveme': 'love-meeeee',

  // Stage 3 (Zone Goliath)
  'goliath': 'stage3',
  'stage-3': 'stage3',
  'goliath-triune': 'triune',
  'goliath_triune': 'triune',
  'avatar-of-avarice': 'avarice',
  'avatar': 'avarice',
  'goliath-keeper': 'keeper',
  'frenzied-howler': 'howler',
  'goliath-heralds': 'goliath-herald',
  'earthshaking-panther': 'panther',
  'bloodstained-barbarian': 'barbarian',
  'writhing-despair': 'despair',

  // Stage 3 (Zone Faym - Lilywhite Paragon & Faymian Fortress)
  'lilywhite': 'paragon',
  'lilywhite-paragon': 'paragon',
  'lilywhite_paragon': 'paragon',
  'faymian-fortress': 'fortress',
  'faymian_fortress': 'fortress',
  'faymian': 'fortress',
  'faym-fortress': 'fortress',

  // Stage 7 (Zone Joculator - Lady of Redemption & Maiden of the Depths)
  'joculator': 'stage7',
  'stage-7': 'stage7',
  'lady': 'redemption',
  'lady-of-redemption': 'redemption',
  'lady_of_redemption': 'redemption',
  'redemption-defender': 'redemption',
  'maiden-of-the-depths': 'maiden',
  'maiden_of_the_depths': 'maiden',
  'maiden-depths': 'maiden'
};

function printHelp(): void {
  console.log(`
========================================================================
    Granblue Fantasy - Arcarum Replicard Sandbox Smart Controller
========================================================================
Usage:
  bun src/cli/run-arcarum.ts [account] [target] [runs] [options]

Zone Joculator (Stage 7 / Here Be Swords) Targets:
  Boss & Defenders:
    stage7         - Universal Stage 7 Map Scanner & Auto-Defender Target
    redemption     - Lady of Redemption (Justice Defender, Water, 30 AAP)
                     Direct URL: #replicard/supporter/7/7/7/816071/25
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
  let resolvedPresetKey = targetPresetOrTemplate.toLowerCase();
  if (ARCARUM_ALIASES[resolvedPresetKey]) {
    resolvedPresetKey = ARCARUM_ALIASES[resolvedPresetKey];
  }

  let preset = ARCARUM_PRESETS[resolvedPresetKey];

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

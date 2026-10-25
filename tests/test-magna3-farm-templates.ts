// tests/test-magna3-farm-templates.ts
import assert from 'assert';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { resolveFarmTemplateName } from '../src/cli/run-farm.js';
import { resolveSearchRaid } from '../src/domain/assist/search-raid.catalog.js';

console.log('========================================================================');
console.log('   🌟 Magna 3 (Omega Rebirth) All-Element Farm Templates Test Suite     ');
console.log('========================================================================\n');

const MAGNA3_FARM_CONFIGS = [
  {
    templateName: 'farm-celeste-ater',
    bossName: 'Celeste Ater',
    element: 'Light',
    expectedQuestId: '305621',
    shorthands: ['celeste', 'celeste-ater', 'ater'],
    aliases: ['farm:celeste', 'farm-celeste', 'farm:ater', 'farm-ater'],
    supporters: ['Zeus', 'Lucifer']
  },
  {
    templateName: 'farm-colossus-ira',
    bossName: 'Colossus Ira',
    element: 'Water',
    expectedQuestId: '305611',
    shorthands: ['colossus', 'colossus-ira', 'ira'],
    aliases: ['farm:colossus', 'farm-colossus', 'farm:ira', 'farm-ira'],
    supporters: ['Varuna', 'Leviathan']
  },
  {
    templateName: 'farm-tiamat-aura',
    bossName: 'Tiamat Aura',
    element: 'Fire',
    expectedQuestId: '305601',
    shorthands: ['tiamat', 'tiamat-aura', 'aura'],
    aliases: ['farm:tiamat', 'farm-tiamat', 'farm:aura', 'farm-aura'],
    supporters: ['Agni', 'Colossus']
  },
  {
    templateName: 'farm-yggdrasil-arbos',
    bossName: 'Yggdrasil Arbos',
    element: 'Wind',
    expectedQuestId: '305641',
    shorthands: ['ygg', 'yggdrasil', 'yggdrasil-arbos', 'arbos'],
    aliases: ['farm:yggdrasil', 'farm-yggdrasil', 'farm:ygg', 'farm-ygg', 'farm:arbos', 'farm-arbos'],
    supporters: ['Zephyrus', 'Tiamat']
  },
  {
    templateName: 'farm-luminiera-credo',
    bossName: 'Luminiera Credo',
    element: 'Dark',
    expectedQuestId: '305591',
    shorthands: ['lumi', 'luminiera', 'luminiera-credo', 'credo'],
    aliases: ['farm:luminiera', 'farm-luminiera', 'farm:lumi', 'farm-lumi', 'farm:credo', 'farm-credo'],
    supporters: ['Hades', 'Bahamut', 'Celeste']
  },
  {
    templateName: 'farm-leviathan-mare',
    bossName: 'Leviathan Mare',
    element: 'Earth',
    expectedQuestId: '305631',
    shorthands: ['levi', 'leviathan', 'leviathan-mare', 'mare'],
    aliases: ['farm:leviathan', 'farm-leviathan', 'farm:levi', 'farm-levi'],
    supporters: ['Titan', 'Yggdrasil']
  }
];

// 1. Template Loading & Schema Validation
console.log('--- 1. Validating All 6 Magna 3 Farm Templates (Schema & Standards) ---');

const VALID_STEP_CODES = new Set([
  'wait_element', 'reload', 'quick_call', 'skill', 'summon', 'attack', 'confirm_result', 'wait_random'
]);

for (const cfg of MAGNA3_FARM_CONFIGS) {
  console.log(`Checking template: ${cfg.templateName}.json...`);
  const tmpl = TemplateParser.loadTemplate(cfg.templateName);
  assert(tmpl, `Template ${cfg.templateName} must load successfully`);

  const validation = validateWorkflowTemplate(tmpl);
  assert(validation.valid, `${cfg.templateName} schema validation failed: ${validation.errors?.join(', ')}`);

  assert.strictEqual(tmpl.evaluatorStrategy, 'farm', `${cfg.templateName} must use strategy "farm"`);
  assert.strictEqual(tmpl.adaptive, true, `${cfg.templateName} must have adaptive: true`);
  assert.strictEqual(tmpl.raidSlot, 1, `${cfg.templateName} must have raidSlot: 1`);
  assert.strictEqual(tmpl.autoSetRaid, true, `${cfg.templateName} must have autoSetRaid: true`);
  assert.strictEqual(tmpl.targetEnemy, cfg.bossName, `${cfg.templateName} targetEnemy must be ${cfg.bossName}`);
  assert.strictEqual(tmpl.element, cfg.element, `${cfg.templateName} counter element must be ${cfg.element}`);
  assert.strictEqual(tmpl.minHpPct, 1, `${cfg.templateName} minHpPct must be 1`);
  assert.strictEqual(tmpl.maxHpPct, 95, `${cfg.templateName} maxHpPct must be 95`);
  assert.strictEqual(tmpl.minPlayers, 2, `${cfg.templateName} minPlayers must be 2`);
  assert(tmpl.steps.length >= 5, `${cfg.templateName} must have comprehensive combat steps`);

  for (const step of tmpl.steps) {
    assert(VALID_STEP_CODES.has(step.code), `${cfg.templateName} has unknown step code: ${step.code}`);
  }

  // Check supporter priority
  for (const supp of cfg.supporters) {
    assert(
      tmpl.supporterPriority?.some(s => s.toLowerCase().includes(supp.toLowerCase())),
      `${cfg.templateName} must include ${supp} in supporterPriority`
    );
  }

  console.log(`  ✅ [PASS] ${cfg.templateName}.json (${cfg.bossName} | ${cfg.element}) is 100% compliant`);
}

// 2. Search Raid Catalog Auto-Configuration Check
console.log('\n--- 2. Verifying Search Raid Catalog Resolution for Finder Slot 1 ---');

for (const cfg of MAGNA3_FARM_CONFIGS) {
  const tmpl = TemplateParser.loadTemplate(cfg.templateName);
  const resolved = resolveSearchRaid({
    questId: tmpl.targetRaidQuestId || tmpl.questId,
    targetEnemy: tmpl.targetEnemy,
    name: tmpl.name,
    description: tmpl.description
  });

  assert(resolved !== null, `${cfg.templateName} must resolve to a valid raid in search-raid catalog`);
  assert.strictEqual(
    resolved?.questId,
    cfg.expectedQuestId,
    `${cfg.templateName} must resolve to questId ${cfg.expectedQuestId}, got ${resolved?.questId}`
  );
  console.log(`  ✅ [PASS] ${cfg.bossName} -> Resolved Quest ID: ${resolved?.questId} (${resolved?.name})`);
}

// 3. CLI Shorthand Resolution via resolveFarmTemplateName
console.log('\n--- 3. Testing CLI Shorthand Resolution (run-farm.ts) ---');

for (const cfg of MAGNA3_FARM_CONFIGS) {
  for (const short of cfg.shorthands) {
    const resolvedName = resolveFarmTemplateName(short);
    assert.strictEqual(
      resolvedName,
      cfg.templateName,
      `Shorthand "${short}" must resolve to "${cfg.templateName}", got "${resolvedName}"`
    );
  }
  console.log(`  ✅ [PASS] Shorthands [${cfg.shorthands.join(', ')}] -> "${cfg.templateName}"`);
}

// 4. Canonical Alias Resolution in TemplateParser
console.log('\n--- 4. Testing Canonical Aliases via TemplateParser.loadTemplate ---');

for (const cfg of MAGNA3_FARM_CONFIGS) {
  const baseTmpl = TemplateParser.loadTemplate(cfg.templateName);
  for (const alias of cfg.aliases) {
    const loaded = TemplateParser.loadTemplate(alias);
    assert(loaded, `TemplateParser must resolve alias "${alias}"`);
    assert.strictEqual(
      loaded.name,
      baseTmpl.name,
      `Alias "${alias}" must load template "${baseTmpl.name}", got "${loaded.name}"`
    );
  }
  console.log(`  ✅ [PASS] Aliases [${cfg.aliases.join(', ')}] -> successfully resolved`);
}

console.log('\n========================================================================');
console.log('   🎉 ALL 6 MAGNA 3 FARM TEMPLATES & ALIASES VERIFIED (100% SUCCESS)    ');
console.log('========================================================================\n');

// tests/test-finder-slot-configurator.ts
import assert from 'assert';
import {
  SEARCH_RAID_CATALOG,
  resolveSearchRaid
} from '../src/domain/assist/search-raid.catalog.js';
import { WorkflowTemplateSchema } from '../src/templates/template-schema.js';
import { parseShorthandDsl } from '../src/templates/dsl-compiler.js';
import { serializeToDsl } from '../src/templates/dsl-serializer.js';
import { FinderSlotConfiguratorService } from '../src/services/navigation/finder-slot-configurator.service.js';

console.log('========================================================================');
console.log('     Finder Slot Configurator & Auto Set Raid Test Suite               ');
console.log('========================================================================\n');

// ---------------------------------------------------------------------------
// 1. Search Raid Catalog Integrity Tests
// ---------------------------------------------------------------------------
console.log('--- 1. Testing Search Raid Catalog Integrity ---');
assert(Array.isArray(SEARCH_RAID_CATALOG), 'SEARCH_RAID_CATALOG must be an array');
assert(SEARCH_RAID_CATALOG.length >= 20, `Catalog must contain all major HL raids (found: ${SEARCH_RAID_CATALOG.length})`);

for (const raid of SEARCH_RAID_CATALOG) {
  assert(typeof raid.questId === 'string' && /^\d+$/.test(raid.questId), `Raid ${raid.name} must have numeric questId string`);
  assert(typeof raid.stageId === 'string' && /^\d+$/.test(raid.stageId), `Raid ${raid.name} must have numeric stageId string`);
  assert(typeof raid.stageType === 'string' && ['1', '2', '4'].includes(raid.stageType), `Raid ${raid.name} stageType must be 1, 2, or 4`);
  assert(typeof raid.name === 'string' && raid.name.length > 0, `Raid must have non-empty name`);
  assert(Array.isArray(raid.aliases) && raid.aliases.length > 0, `Raid ${raid.name} must have aliases`);
}

const bubz = SEARCH_RAID_CATALOG.find(r => r.questId === '305181');
assert(!!bubz, 'Long Live the King / Beelzebub must exist in catalog');
assert(bubz?.stageId === '12071', 'Beelzebub stageId must be 12071');
assert(bubz?.stageType === '2', 'Beelzebub stageType must be 2 (HL)');
assert(bubz?.name === 'Long Live the King', 'Beelzebub raid name must be Long Live the King');

const leviathan = SEARCH_RAID_CATALOG.find(r => r.questId === '305631');
assert(!!leviathan, 'Leviathan Mare must exist in catalog');
assert(leviathan?.stageId === '12042', 'Leviathan Mare stageId must be 12042 (Magna 3)');
assert(leviathan?.stageType === '2', 'Leviathan Mare stageType must be 2 (HL)');

const pbhl = SEARCH_RAID_CATALOG.find(r => r.questId === '301061');
assert(!!pbhl, 'PBHL must exist in catalog');
assert(pbhl?.stageId === '12061', 'PBHL stageId must be 12061');

const akasha = SEARCH_RAID_CATALOG.find(r => r.questId === '303251');
assert(!!akasha, 'Akasha must exist in catalog');
assert(akasha?.stageId === '12061', 'Akasha stageId must be 12061');

console.log('  ✅ [PASS] Catalog integrity verified: all entries conform to SearchRaidDefinition schema.');

// ---------------------------------------------------------------------------
// 2. Query Resolver Tests
// ---------------------------------------------------------------------------
console.log('\n--- 2. Testing resolveSearchRaid Resolver Logic ---');

// 2a. Direct questId resolution
const byQuestId = resolveSearchRaid({ questId: '305181' });
assert.strictEqual(byQuestId?.name, 'Long Live the King', 'Resolves by exact questId 305181');

// 2b. Name resolution
const byName = resolveSearchRaid({ name: 'Raid - Long Live the King' });
assert.strictEqual(byName?.questId, '305181', 'Resolves by template name containing "Long Live the King"');

// 2c. TargetEnemy resolution
const byEnemy = resolveSearchRaid({ targetEnemy: 'Long Live the King' });
assert.strictEqual(byEnemy?.questId, '305181', 'Resolves by targetEnemy "Long Live the King"');

// 2d. Common alias resolution (bubz, beelzebub)
const byBubz = resolveSearchRaid({ targetEnemy: 'bubz' });
assert.strictEqual(byBubz?.questId, '305181', 'Resolves by alias "bubz"');

const byBeelzebub = resolveSearchRaid({ targetEnemy: 'Beelzebub' });
assert.strictEqual(byBeelzebub?.questId, '305181', 'Resolves by alias "Beelzebub"');

// 2e. Leviathan Mare resolution
const byLeviathan = resolveSearchRaid({ targetEnemy: 'Leviathan Mare' });
assert.strictEqual(byLeviathan?.questId, '305631', 'Resolves Leviathan Mare to questId 305631');
assert.strictEqual(byLeviathan?.stageId, '12042', 'Resolves Leviathan Mare stageId 12042');

// 2f. Description fallback resolution
const byDesc = resolveSearchRaid({ description: 'Fast burst farmer for Beelzebub HL' });
assert.strictEqual(byDesc?.questId, '305181', 'Resolves via description matching "Beelzebub"');

// 2g. Unresolved query returns null
const notFound = resolveSearchRaid({ targetEnemy: 'non_existent_fake_enemy_xyz' });
assert.strictEqual(notFound, null, 'Returns null for unknown raid queries');

// 2h. String argument resolution
const stringQuery = resolveSearchRaid('belial');
assert.strictEqual(stringQuery?.questId, '305281', 'Resolves plain string query "belial"');

// 2i. Verify all 13 Tab 1 assist templates have autoSetRaid: true and resolve correctly
const tab1AssistTemplates = [
  'farm-leviathan-mare.json',
  'leech-celeste-ater.json',
  'leech-colossus-ira.json',
  'leech-leviathan-mare.json',
  'leech-luminiera-credo.json',
  'leech-tiamat-aura.json',
  'leech-yggdrasil-arbos.json',
  'raid-dark-rapture-hard.json',
  'raid-fediel.json',
  'raid-long-live-the-king.json',
  'raid-the-fallen-angel-of-cunning.json',
  'raid-the-world.json',
  'raid-wilnas.json'
];

for (const tmplFile of tab1AssistTemplates) {
  const content = JSON.parse(await import('fs').then(m => m.readFileSync(`templates/${tmplFile}`, 'utf8')));
  assert.strictEqual(content.raidSlot, 1, `${tmplFile} must have raidSlot: 1`);
  assert.strictEqual(content.autoSetRaid, true, `${tmplFile} must have autoSetRaid: true`);
  const resolved = resolveSearchRaid({
    questId: content.targetRaidQuestId || content.questId,
    targetEnemy: content.targetEnemy,
    name: content.name,
    description: content.description
  });
  assert(resolved !== null, `${tmplFile} must resolve to a valid catalog raid`);
  assert(typeof resolved?.questId === 'string', `${tmplFile} must have a valid resolved questId`);
}

console.log('  ✅ [PASS] resolveSearchRaid verified: questId, name, targetEnemy, aliases, string queries, and all 13 Tab 1 templates.');

// ---------------------------------------------------------------------------
// 3. Workflow Template Schema Validation with autoSetRaid
// ---------------------------------------------------------------------------
console.log('\n--- 3. Testing Template Schema Validation for autoSetRaid ---');

const validTemplateData = {
  name: 'Raid - Long Live the King',
  questUrl: 'https://game.granbluefantasy.jp/#quest/assist',
  mode: 'assist',
  targetEnemy: 'Long Live the King',
  raidSlot: 1,
  autoSetRaid: true,
  autoSetRaidSlot: 1,
  targetRaidQuestId: '305181',
  steps: [{ code: 'attack' }]
};

const parsed = WorkflowTemplateSchema.parse(validTemplateData);
assert.strictEqual(parsed.autoSetRaid, true, 'autoSetRaid parsed as boolean true');
assert.strictEqual(parsed.autoSetRaidSlot, 1, 'autoSetRaidSlot parsed as 1');
assert.strictEqual(parsed.targetRaidQuestId, '305181', 'targetRaidQuestId parsed as string');

// Reject invalid slot
let invalidSlotRejected = false;
try {
  WorkflowTemplateSchema.parse({
    ...validTemplateData,
    autoSetRaidSlot: 5
  });
} catch {
  invalidSlotRejected = true;
}
assert(invalidSlotRejected, 'Schema must reject autoSetRaidSlot > 4');

// Reject non-boolean autoSetRaid
let invalidBoolRejected = false;
try {
  WorkflowTemplateSchema.parse({
    ...validTemplateData,
    autoSetRaid: 'yes' as any
  });
} catch {
  invalidBoolRejected = true;
}
assert(invalidBoolRejected, 'Schema must reject non-boolean autoSetRaid');

console.log('  ✅ [PASS] Schema validation passed: autoSetRaid, autoSetRaidSlot, and targetRaidQuestId validated cleanly.');

// ---------------------------------------------------------------------------
// 4. DSL Round-Trip Compilation & Serialization
// ---------------------------------------------------------------------------
console.log('\n--- 4. Testing DSL Round-Trip Compilation & Serialization ---');

const dslText = `
Name: Raid - Long Live the King
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Slot: 1
Auto Set Raid: true
Auto Set Raid Slot: 1
Target Raid Quest ID: 305181
Target Enemy: Long Live the King
---
attack
`;

const compiled = parseShorthandDsl(dslText, 'Raid - Long Live the King');
assert.strictEqual(compiled.autoSetRaid, true, 'DSL compiler parsed Auto Set Raid: true');
assert.strictEqual(compiled.autoSetRaidSlot, 1, 'DSL compiler parsed Auto Set Raid Slot: 1');
assert.strictEqual(compiled.targetRaidQuestId, '305181', 'DSL compiler parsed Target Raid Quest ID: 305181');

const serialized = serializeToDsl(compiled);
assert(serialized.includes('Auto Set Raid: true'), 'DSL serializer output contains Auto Set Raid: true');
assert(serialized.includes('Auto Set Raid Slot: 1'), 'DSL serializer output contains Auto Set Raid Slot: 1');
assert(serialized.includes('Target Raid Quest ID: 305181'), 'DSL serializer output contains Target Raid Quest ID: 305181');

console.log('  ✅ [PASS] DSL round-trip verified: compilation and serialization retain autoSetRaid parameters.');

// ---------------------------------------------------------------------------
// 5. FinderSlotConfiguratorService Logic & Cache Tests
// ---------------------------------------------------------------------------
console.log('\n--- 5. Testing FinderSlotConfiguratorService Cache & Pre-Check ---');

const configurator = new FinderSlotConfiguratorService();
assert(typeof configurator.ensureSlotConfigured === 'function', 'ensureSlotConfigured must be a function');
assert(typeof configurator.getSlotConfiguredQuestId === 'function', 'getSlotConfiguredQuestId must be a function');
assert(typeof configurator.resetVerificationCache === 'function', 'resetVerificationCache must be a function');

// Mock page object with pre-configured slot thumbnail
let evalCalls = 0;
const mockPageMatch: any = {
  evaluate: async (fn: any, ...args: any[]) => {
    evalCalls++;
    if (typeof fn === 'function') {
      const fnStr = fn.toString();
      if (fnStr.includes('window.location.hash')) return '#quest/assist';
      if (fnStr.includes('classList.contains')) return true;
      if (fnStr.includes('prt-search-switch-display')) {
        // Return matching Bubz thumbnail
        return '305181';
      }
    }
    return null;
  },
  waitForSelector: async () => ({}),
  waitForFunction: async () => ({})
};

(async () => {
  const isMatch = await configurator.ensureSlotConfigured(mockPageMatch, {
    slot: 1,
    targetRaid: bubz!
  });
  assert(isMatch, 'Pre-check must succeed when thumbnail already matches');

  // Second call must hit memory cache without querying DOM
  const evalCallsBefore = evalCalls;
  const isCached = await configurator.ensureSlotConfigured(mockPageMatch, {
    slot: 1,
    targetRaid: bubz!
  });
  assert(isCached, 'Must succeed from cache');
  assert.strictEqual(evalCalls, evalCallsBefore, 'Zero DOM evaluations when hitting verification cache');

  console.log('  ✅ [PASS] FinderSlotConfiguratorService fast-path pre-check and memory cache verified.');

  console.log('\n========================================================================');
  console.log('  🎉 ALL FINDER SLOT CONFIGURATOR TESTS PASSED WITH 100% SUCCESS        ');
  console.log('========================================================================\n');
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

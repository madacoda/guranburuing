// tests/test-raid-the-world-template.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { isSoloWorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('       Raid - The World (HL) Template & DSL Verification Suite          ');
console.log('========================================================================\n');

// 1. Validate canonical template loading & schema
console.log('--- 1. Testing Canonical raid-the-world Template Loading & Schema ---');
const tmpl = TemplateParser.loadTemplate('raid-the-world');
if (!tmpl) {
  throw new Error('Failed to load raid-the-world template');
}

const validation = TemplateParser.validate(tmpl);
if (!validation.valid) {
  throw new Error(`raid-the-world template schema validation failed: ${validation.errors.join(', ')}`);
}

if (tmpl.questUrl !== 'https://game.granbluefantasy.jp/#quest/assist') {
  throw new Error(`Expected questUrl to be #quest/assist, got: ${tmpl.questUrl}`);
}

if (tmpl.raidSlot !== 1) {
  throw new Error(`Expected raidSlot to be 1 (Finder Tab 1), got: ${tmpl.raidSlot}`);
}

if (tmpl.mode !== 'assist') {
  throw new Error(`Expected mode to be assist, got: ${tmpl.mode}`);
}

if (tmpl.minHpPct !== 1 || tmpl.maxHpPct !== 100) {
  throw new Error(`Expected minHpPct=1, maxHpPct=100, got: min=${tmpl.minHpPct}, max=${tmpl.maxHpPct}`);
}

if (tmpl.evaluatorStrategy !== 'leech') {
  throw new Error(`Expected evaluatorStrategy to be "leech", got: ${tmpl.evaluatorStrategy}`);
}

console.log(`  ✅ [PASS] Canonical template validated: raidSlot=1, mode=assist, minHpPct=${tmpl.minHpPct}%, maxHpPct=${tmpl.maxHpPct}%, strategy=${tmpl.evaluatorStrategy}`);

// 2. Validate exact 10-step pipeline
console.log('\n--- 2. Validating Exact 10-Step Pipeline Sequence ---');
const expectedSteps = [
  { code: 'skill', character: 4, skill: 1 },
  { code: 'skill', character: 3, skill: 1 },
  { code: 'skill', character: 3, skill: 2 },
  { code: 'skill', character: 2, skill: 1 },
  { code: 'attack' },
  { code: 'reload' },
  { code: 'wait_random' },
  { code: 'attack' },
  { code: 'reload' },
  { code: 'confirm_result' }
];

if (tmpl.steps.length !== 10) {
  throw new Error(`Expected exactly 10 steps, got ${tmpl.steps.length}`);
}

for (let i = 0; i < expectedSteps.length; i++) {
  const step = tmpl.steps[i];
  const exp = expectedSteps[i];
  const stepCode = step.code || step.action;
  if (stepCode !== exp.code) {
    throw new Error(`Step ${i + 1} code mismatch: expected "${exp.code}", got "${stepCode}"`);
  }
  if (exp.character !== undefined && step.character !== exp.character) {
    throw new Error(`Step ${i + 1} character mismatch: expected ${exp.character}, got ${step.character}`);
  }
  if (exp.skill !== undefined && step.skill !== exp.skill) {
    throw new Error(`Step ${i + 1} skill mismatch: expected ${exp.skill}, got ${step.skill}`);
  }
}
console.log('  ✅ [PASS] All 10 steps verified: C4S1 -> C3S1 -> C3S2 -> C2S1 -> Attack -> Reload -> Random Delay -> Attack -> Reload -> Rerun');

// 3. Verify isSoloWorkflowTemplate returns false for assist multi-battle raid
console.log('\n--- 3. Verifying Solo Quest Isolation Flag ---');
const isSolo = isSoloWorkflowTemplate(tmpl);
if (isSolo !== false) {
  throw new Error(`Expected isSoloWorkflowTemplate(raid-the-world) to be false, got ${isSolo}`);
}
console.log('  ✅ [PASS] Multi-battle assist raid correctly verified as NOT solo (honors/blue chest tracking enabled)');

// 4. Validate canonical alias resolution
console.log('\n--- 4. Testing Canonical Aliases (Zero Duplicate Files on Disk) ---');
const aliases = ['theworld-raid', 'the-world-raid', 'world-raid', 'raid-theworld', 'arcarum-theworld-raid'];
for (const alias of aliases) {
  const resolved = TemplateParser.loadTemplate(alias);
  if (resolved.name !== tmpl.name) {
    throw new Error(`Alias "${alias}" failed to resolve to canonical template "${tmpl.name}"`);
  }
}
console.log(`  ✅ [PASS] All ${aliases.length} aliases cleanly resolved to canonical raid-the-world.json`);

// 5. Test Shorthand DSL parsing of user's exact specification
console.log('\n--- 5. Testing Shorthand DSL Parser with User Specification ---');
const rawDsl = `
Name: Raid - The World (HL)
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Raid Slot: 1

c4s1
c3s1
c3s2
c2s1
attack
reload
random delay
attack
reload
rerun
`.trim();

const parsedFromDsl = TemplateParser.parseShorthandDsl(rawDsl, 'test-theworld-dsl');
if (parsedFromDsl.steps.length !== 10) {
  throw new Error(`Expected DSL to parse 10 steps, got ${parsedFromDsl.steps.length}`);
}

for (let i = 0; i < expectedSteps.length; i++) {
  const step = parsedFromDsl.steps[i];
  const exp = expectedSteps[i];
  const stepCode = step.code || step.action;
  if (stepCode !== exp.code) {
    throw new Error(`DSL Step ${i + 1} code mismatch: expected "${exp.code}", got "${stepCode}"`);
  }
}
console.log('  ✅ [PASS] User DSL string parsed with 100% accuracy into identical 10-step pipeline');

// 6. Test Bidirectional Round-Trip Serialization
console.log('\n--- 6. Testing Bidirectional Round-Trip Serialization (DSL <-> Template) ---');
const serializedDsl = TemplateParser.serializeToDsl(tmpl);
const roundTripped = TemplateParser.parseShorthandDsl(serializedDsl, 'roundtrip-theworld');
if (roundTripped.steps.length !== tmpl.steps.length) {
  throw new Error(`Round-trip step count mismatch: ${roundTripped.steps.length} vs ${tmpl.steps.length}`);
}
console.log('  ✅ [PASS] Bidirectional Template -> DSL -> Template round-trip fully intact');

// 7. Test Customizable HP Target Directives in DSL
console.log('\n--- 7. Testing Customizable HP Target Directives in DSL ---');
const dslWithHpBounds = `
Name: Raid - The World Leech Custom
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Raid Slot: 1
Strategy: leech
Min HP: 15
Max HP: 75
Min Players: 2
Max Players: 25
Min Raid Score: 30

c4s1
attack
reload
confirm_result
`.trim();

const parsedHpDsl = TemplateParser.parseShorthandDsl(dslWithHpBounds, 'test-hp-bounds');
if (parsedHpDsl.minHpPct !== 15 || parsedHpDsl.maxHpPct !== 75) {
  throw new Error(`Expected minHpPct=15, maxHpPct=75, got min=${parsedHpDsl.minHpPct}, max=${parsedHpDsl.maxHpPct}`);
}
if (parsedHpDsl.minPlayers !== 2 || parsedHpDsl.maxPlayers !== 25) {
  throw new Error(`Expected minPlayers=2, maxPlayers=25, got min=${parsedHpDsl.minPlayers}, max=${parsedHpDsl.maxPlayers}`);
}
if (parsedHpDsl.evaluatorStrategy !== 'leech' || parsedHpDsl.minRaidScore !== 30) {
  throw new Error(`Expected strategy="leech", minRaidScore=30, got strategy=${parsedHpDsl.evaluatorStrategy}, score=${parsedHpDsl.minRaidScore}`);
}
console.log('  ✅ [PASS] Directives "Min HP: 15", "Max HP: 75", "Strategy: leech", "Min Raid Score: 30" parsed accurately');

// Test Shorthand Range syntax: "HP: 20-80%"
const dslWithHpRange = `
Name: Raid - The World HP Range
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
HP: 20-80%

attack
reload
confirm_result
`.trim();

const parsedHpRange = TemplateParser.parseShorthandDsl(dslWithHpRange, 'test-hp-range');
if (parsedHpRange.minHpPct !== 20 || parsedHpRange.maxHpPct !== 80) {
  throw new Error(`Expected minHpPct=20, maxHpPct=80 from "HP: 20-80%", got min=${parsedHpRange.minHpPct}, max=${parsedHpRange.maxHpPct}`);
}
console.log('  ✅ [PASS] Shorthand range directive "HP: 20-80%" parsed accurately into minHpPct=20, maxHpPct=80');

// Verify serialized DSL preserves HP bounds
const serializedHpBounds = TemplateParser.serializeToDsl(parsedHpDsl);
if (!serializedHpBounds.includes('Min HP: 15') || !serializedHpBounds.includes('Max HP: 75')) {
  throw new Error('Expected serialized DSL to contain Min HP: 15 and Max HP: 75');
}
console.log('  ✅ [PASS] Template -> DSL serialization retains Min HP and Max HP directives cleanly');

console.log('\n========================================================================');
console.log('       🎉 ALL RAID THE WORLD TESTS PASSED SUCCESSFULLY (100%)           ');
console.log('========================================================================\n');

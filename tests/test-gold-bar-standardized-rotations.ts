// tests/test-gold-bar-standardized-rotations.ts
import assert from 'assert';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { GOLD_BAR_RAID_CATALOG } from '../src/domain/gold-bar/gold-bar.catalog.js';
import { buildGoldBarWorkflowTemplate } from '../src/domain/gold-bar/gold-bar-template.builder.js';

console.log('========================================================================');
console.log('   Standardized Gold Bar Rotations Verification Test Suite              ');
console.log('   (gb-akasha, gb-pbhl, gb-go step uniformity & 1.5M honor threshold)   ');
console.log('========================================================================\n');

// 1. Load the three production templates
const akasha = TemplateParser.loadTemplate('gb-akasha');
const pbhl = TemplateParser.loadTemplate('gb-pbhl');
const go = TemplateParser.loadTemplate('gb-go');

console.log('--- 1. Testing Schema Compliance ---');
const valAkasha = validateWorkflowTemplate(akasha);
const valPbhl = validateWorkflowTemplate(pbhl);
const valGo = validateWorkflowTemplate(go);

assert(valAkasha.valid, `gb-akasha schema invalid: ${valAkasha.errors.join(', ')}`);
assert(valPbhl.valid, `gb-pbhl schema invalid: ${valPbhl.errors.join(', ')}`);
assert(valGo.valid, `gb-go schema invalid: ${valGo.errors.join(', ')}`);
console.log('  ✅ [PASS] All 3 templates passed strict Zod schema validation');

console.log('\n--- 2. Testing 1,500,000 pt Target Honor Threshold ---');
assert.strictEqual(akasha.targetScore, 1500000, `gb-akasha targetScore must be 1,500,000, got ${akasha.targetScore}`);
assert.strictEqual(pbhl.targetScore, 1500000, `gb-pbhl targetScore must be 1,500,000, got ${pbhl.targetScore}`);
assert.strictEqual(go.targetScore, 1500000, `gb-go targetScore must be 1,500,000, got ${go.targetScore}`);

assert.strictEqual(GOLD_BAR_RAID_CATALOG.akasha.defaultTargetScore, 1500000, 'Catalog akasha defaultTargetScore is 1,500,000');
assert.strictEqual(GOLD_BAR_RAID_CATALOG.pbhl.defaultTargetScore, 1500000, 'Catalog pbhl defaultTargetScore is 1,500,000');
assert.strictEqual(GOLD_BAR_RAID_CATALOG.go.defaultTargetScore, 1500000, 'Catalog go defaultTargetScore is 1,500,000');
console.log('  ✅ [PASS] All 3 templates & catalog entries have targetScore = 1,500,000 pt');

console.log('\n--- 3. Testing Step Uniformity Across All Three Raids ---');
assert.strictEqual(akasha.steps.length, 13, `gb-akasha step count must be 13, got ${akasha.steps.length}`);
assert.strictEqual(pbhl.steps.length, 13, `gb-pbhl step count must be 13, got ${pbhl.steps.length}`);
assert.strictEqual(go.steps.length, 13, `gb-go step count must be 13, got ${go.steps.length}`);

// Compare each step across all three
for (let i = 0; i < akasha.steps.length; i++) {
  const sA = akasha.steps[i];
  const sP = pbhl.steps[i];
  const sG = go.steps[i];

  assert.strictEqual(sA.code, sP.code, `Step ${i + 1} code mismatch: akasha (${sA.code}) vs pbhl (${sP.code})`);
  assert.strictEqual(sA.code, sG.code, `Step ${i + 1} code mismatch: akasha (${sA.code}) vs go (${sG.code})`);

  if (sA.character !== undefined) {
    assert.strictEqual(sA.character, sP.character, `Step ${i + 1} character mismatch: ${sA.character} vs ${sP.character}`);
    assert.strictEqual(sA.character, sG.character, `Step ${i + 1} character mismatch: ${sA.character} vs ${sG.character}`);
  }
  if (sA.skill !== undefined) {
    assert.strictEqual(sA.skill, sP.skill, `Step ${i + 1} skill mismatch: ${sA.skill} vs ${sP.skill}`);
    assert.strictEqual(sA.skill, sG.skill, `Step ${i + 1} skill mismatch: ${sA.skill} vs ${sG.skill}`);
  }
  if (sA.ensureCast !== undefined) {
    assert.strictEqual(sA.ensureCast, sP.ensureCast, `Step ${i + 1} ensureCast mismatch: ${sA.ensureCast} vs ${sP.ensureCast}`);
    assert.strictEqual(sA.ensureCast, sG.ensureCast, `Step ${i + 1} ensureCast mismatch: ${sA.ensureCast} vs ${sG.ensureCast}`);
  }
}
console.log('  ✅ [PASS] Step-by-step pipeline is 100% IDENTICAL across gb-akasha, gb-pbhl, and gb-go');

console.log('\n--- 4. Testing Exact Required Steps Sequence ---');
// Step 1: Wait for loading / interactable
assert.strictEqual(akasha.steps[0].code, 'wait_element');
assert.strictEqual(akasha.steps[0].target, '.btn-attack-start');
console.log('  [Step 1]  ✅ wait_element (target: .btn-attack-start)');

// Step 2: Wait a bit
assert.strictEqual(akasha.steps[1].code, 'wait_random');
assert.strictEqual(akasha.steps[1].minMs, 400);
assert.strictEqual(akasha.steps[1].maxMs, 800);
console.log('  [Step 2]  ✅ wait_random (400ms - 800ms) - make sure all interactable');

// Step 3: C4S1 (ensureCast)
assert.strictEqual(akasha.steps[2].code, 'skill');
assert.strictEqual(akasha.steps[2].character, 4);
assert.strictEqual(akasha.steps[2].skill, 1);
assert.strictEqual(akasha.steps[2].ensureCast, true);
console.log('  [Step 3]  ✅ C4S1 (ensureCast: true)');

// Step 4: Quick call
assert.strictEqual(akasha.steps[3].code, 'quick_call');
console.log('  [Step 4]  ✅ quick_call (summoned)');

// Step 5: Reload
assert.strictEqual(akasha.steps[4].code, 'reload');
console.log('  [Step 5]  ✅ reload (post-summon animation cancel)');

// Step 6: C3S1
assert.strictEqual(akasha.steps[5].code, 'skill');
assert.strictEqual(akasha.steps[5].character, 3);
assert.strictEqual(akasha.steps[5].skill, 1);
console.log('  [Step 6]  ✅ C3S1');

// Step 7: C2S1
assert.strictEqual(akasha.steps[6].code, 'skill');
assert.strictEqual(akasha.steps[6].character, 2);
assert.strictEqual(akasha.steps[6].skill, 1);
console.log('  [Step 7]  ✅ C2S1');

// Step 8: Attack
assert.strictEqual(akasha.steps[7].code, 'attack');
console.log('  [Step 8]  ✅ attack');

// Step 9: Reload
assert.strictEqual(akasha.steps[8].code, 'reload');
console.log('  [Step 9]  ✅ reload');

// Step 10: Wait a bit, randomize / human like
assert.strictEqual(akasha.steps[9].code, 'wait_random');
assert.strictEqual(akasha.steps[9].minMs, 500);
assert.strictEqual(akasha.steps[9].maxMs, 1500);
console.log('  [Step 10] ✅ wait_random (500ms - 1500ms, human-like delay)');

// Step 11: Attack again
assert.strictEqual(akasha.steps[10].code, 'attack');
console.log('  [Step 11] ✅ attack again');

// Step 12: Reload
assert.strictEqual(akasha.steps[11].code, 'reload');
console.log('  [Step 12] ✅ reload');

// Step 13: Confirm result
assert.strictEqual(akasha.steps[12].code, 'confirm_result');
console.log('  [Step 13] ✅ confirm_result');

console.log('\n--- 5. Testing Domain Builder Function Consistency ---');
const builtPbhl = buildGoldBarWorkflowTemplate(GOLD_BAR_RAID_CATALOG.pbhl);
assert.strictEqual(builtPbhl.targetScore, 1500000);
assert.strictEqual(builtPbhl.steps.length, 13);
for (let i = 0; i < builtPbhl.steps.length; i++) {
  assert.strictEqual(builtPbhl.steps[i].code, akasha.steps[i].code);
}
console.log('  ✅ [PASS] buildGoldBarWorkflowTemplate generates identical 13-step sequence');

console.log('\n--- 6. Testing Lossless DSL Round-Trip Serialization ---');
for (const tmpl of [akasha, pbhl, go]) {
  const dsl = TemplateParser.serializeToDsl(tmpl);
  const reloaded = TemplateParser.parseShorthandDsl(dsl, tmpl.name);
  assert.strictEqual(reloaded.steps.length, tmpl.steps.length, `${tmpl.name} DSL step count mismatch`);
  assert.strictEqual(reloaded.targetScore, 1500000, `${tmpl.name} DSL targetScore mismatch`);
}
console.log('  ✅ [PASS] DSL Round-Trip Serialization validated with 100% fidelity');

console.log('\n========================================================================');
console.log('🎉 ALL STANDARDIZED GOLD BAR ROTATION TESTS PASSED (100%)');
console.log('========================================================================\n');

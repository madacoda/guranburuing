// tests/test-shiny-slime-search.ts
import assert from 'assert';
import fs from 'fs';
import { WorkflowTemplateSchema, validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { TemplateParser } from '../src/templates/template-parser.js';
import { parseShorthandDsl } from '../src/templates/dsl-compiler.js';
import { serializeToDsl } from '../src/templates/dsl-serializer.js';

console.log('========================================================================');
console.log('     Shiny Slime Search (Very Hard) Workflow Test Suite                ');
console.log('========================================================================\n');

// ---------------------------------------------------------------------------
// 1. Template Schema & Integrity Tests
// ---------------------------------------------------------------------------
console.log('--- 1. Testing Shiny Slime Search Template Schema Integrity ---');
const templateRaw = JSON.parse(fs.readFileSync('templates/shiny-slime-search.json', 'utf8'));

const validation = validateWorkflowTemplate(templateRaw);
assert(validation.valid, `Template must be schema-valid: ${validation.errors.join(', ')}`);
assert.strictEqual(validation.warnings.length, 0, `Template must produce zero warnings: ${validation.warnings.join(', ')}`);

assert.strictEqual(templateRaw.questId, '400151', 'Quest ID must be 400151 (Very Hard)');
assert(templateRaw.questUrl.includes('400151/4'), 'Quest URL must target #quest/supporter/400151/4');
assert.strictEqual(templateRaw.steps.length, 6, 'Must contain exact 6 combat steps');

// Verify steps match the exact user rotation
assert.strictEqual(templateRaw.steps[0].code, 'quick_call', 'Step 1 must be quick_call');
assert.strictEqual(templateRaw.steps[1].code, 'back', 'Step 2 must be back');
assert(templateRaw.steps[2].code === 'wait_wave' || templateRaw.steps[2].code === 'wait_random', 'Step 3 must be wait_wave or wait_random');
assert.strictEqual(templateRaw.steps[3].code, 'skill', 'Step 4 must be skill');
assert.strictEqual(templateRaw.steps[3].character, 4, 'Step 4 must target character 4 (Threo)');
assert.strictEqual(templateRaw.steps[3].skill, 3, 'Step 4 must target skill 3');
assert.strictEqual(templateRaw.steps[4].code, 'reload', 'Step 5 must be reload');
assert.strictEqual(templateRaw.steps[5].code, 'confirm_result', 'Step 6 must be confirm_result');

assert(templateRaw.supporterPriority.includes('Kaguya'), 'Supporter priority must include Kaguya for EXP/drop rate');
assert.strictEqual(templateRaw.autoElixir, true, 'Auto elixir must be enabled for solo slime blasting');

console.log('  ✅ [PASS] Template schema and 6-step combat rotation verified.');

// ---------------------------------------------------------------------------
// 2. Canonical Alias Resolution Tests
// ---------------------------------------------------------------------------
console.log('\n--- 2. Testing Canonical Alias Resolution ---');
const aliases = [
  'slime',
  'slime-vh',
  'shiny-slime',
  'shiny-slime-vh',
  'shiny-slime-search',
  'shiny-slime-search-vh',
  'quest-shiny-slime-search',
  'quest-slime'
];

for (const alias of aliases) {
  const loaded = TemplateParser.loadTemplate(alias);
  assert.strictEqual(loaded.questId, '400151', `Alias "${alias}" must load 400151 Shiny Slime template`);
  assert.strictEqual(loaded.steps.length, 6, `Alias "${alias}" must load 6-step pipeline`);
}
console.log(`  ✅ [PASS] All ${aliases.length} canonical aliases resolve to shiny-slime-search.`);

// ---------------------------------------------------------------------------
// 3. User DSL Compilation & Back Button Parser Tests
// ---------------------------------------------------------------------------
console.log('\n--- 3. Testing User Shorthand DSL Compilation ---');

const userDsl = `
Name: Shiny Slime Search! (Very Hard)
Quest: https://game.granbluefantasy.jp/#quest/supporter/400151/4
Speed: turbo
Runs: 100
Supporters: Kaguya, Nobiyo, White Rabbit, Black Rabbit, Hades
---
quick call
click back button
random wait
c3s3
reload
rerun
`;

const compiled = parseShorthandDsl(userDsl, 'Shiny Slime Search');
assert.strictEqual(compiled.steps.length, 6, 'DSL compilation must produce exact 6 steps');
assert.strictEqual(compiled.steps[0].code, 'quick_call', 'DSL step 1 must compile "quick call" to quick_call');
assert.strictEqual(compiled.steps[1].code, 'back', 'DSL step 2 must compile "click back button" to back');
assert.strictEqual(compiled.steps[2].code, 'wait_random', 'DSL step 3 must compile "random wait" to wait_random');
assert.strictEqual(compiled.steps[3].code, 'skill', 'DSL step 4 must compile "c3s3" to skill');
assert.strictEqual(compiled.steps[3].character, 3, 'DSL step 4 character must be 3');
assert.strictEqual(compiled.steps[3].skill, 3, 'DSL step 4 skill must be 3');
assert.strictEqual(compiled.steps[4].code, 'reload', 'DSL step 5 must compile "reload" to reload');
assert.strictEqual(compiled.steps[5].code, 'confirm_result', 'DSL step 6 must compile "rerun" to confirm_result');

console.log('  ✅ [PASS] Shorthand DSL compilation of exact user prompt verified.');

// ---------------------------------------------------------------------------
// 4. DSL Serialization & Round-Trip Tests
// ---------------------------------------------------------------------------
console.log('\n--- 4. Testing DSL Serialization Round-Trip ---');

const serialized = serializeToDsl(compiled);
assert(serialized.includes('quick_call') || serialized.includes('quick'), 'Serialized output includes quick_call');
assert(serialized.includes('click back button'), 'Serialized output includes "click back button"');
assert(serialized.includes('c3s3'), 'Serialized output includes c3s3');

const recompiled = parseShorthandDsl(serialized, 'Recompiled Slime');
assert.strictEqual(recompiled.steps.length, 6, 'Round-trip recompiled template must retain 6 steps');
assert.strictEqual(recompiled.steps[1].code, 'back', 'Round-trip retained back action');

console.log('  ✅ [PASS] DSL serialization and round-trip consistency verified.');

// ---------------------------------------------------------------------------
// 5. Multi-Wave & Solo Quest Integrity Tests
// ---------------------------------------------------------------------------
console.log('\n--- 5. Testing Multi-Wave & Solo Quest Integrity ---');
import { isSoloWorkflowTemplate } from '../src/types/workflow.types.js';
assert.strictEqual(isSoloWorkflowTemplate(templateRaw), true, 'Shiny Slime Search must be recognized as a solo quest');
assert.strictEqual(templateRaw.waves, 2, 'Template must declare waves: 2');
assert.strictEqual(templateRaw.isSolo, true, 'Template must declare isSolo: true');
console.log('  ✅ [PASS] Solo quest classification and multi-wave declaration verified.');

console.log('\n========================================================================');
console.log('  🎉 ALL SHINY SLIME SEARCH TESTS PASSED WITH 100% SUCCESS              ');
console.log('========================================================================\n');

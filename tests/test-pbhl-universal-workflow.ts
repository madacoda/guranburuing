// tests/test-pbhl-universal-workflow.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';

console.log('========================================================================');
console.log('       Proto Bahamut HL (PBHL) Universal Workflow Test Suite            ');
console.log('========================================================================\n');

// 1. Verify gb-pbhl template loading and structure
console.log('--- 1. Testing Production "gb-pbhl" Template ---');
const pbhlTemplate = TemplateParser.loadTemplate('gb-pbhl');
console.log(`Loaded template: "${pbhlTemplate.name}"`);
console.log(`Target Score:    ${pbhlTemplate.targetScore?.toLocaleString()} pt`);
console.log(`Raid Slot:       ${pbhlTemplate.raidSlot}`);
console.log(`Log Path:        ${pbhlTemplate.logPath}`);
console.log(`Supporters:      [${pbhlTemplate.supporterPriority?.join(', ')}]`);
console.log(`Total Steps:     ${pbhlTemplate.steps.length}`);

// 1. Verify schema & structural format validity
const valPbhl = validateWorkflowTemplate(pbhlTemplate);
if (!valPbhl.valid) {
  throw new Error(`gb-pbhl failed schema validation: ${valPbhl.errors.join(', ')}`);
}

if (!Array.isArray(pbhlTemplate.steps) || pbhlTemplate.steps.length === 0) {
  throw new Error('Expected non-empty steps array in gb-pbhl');
}

const validCodes = new Set([
  'skill', 'attack', 'summon', 'quick_call', 'reload', 'tap_ready',
  'smart_full_auto', 'repeat', 'confirm_result', 'wait', 'wait_network',
  'exit_if_score', 'condition', 'heal', 'revive', 'wait_element', 'wait_random'
]);

for (const step of pbhlTemplate.steps) {
  if (!validCodes.has(step.code)) {
    throw new Error(`Unrecognized step code: "${step.code}" in gb-pbhl`);
  }
}

console.log(`✅ [PASS] "gb-pbhl" template schema & ${pbhlTemplate.steps.length} customizable steps verified!`);

// 2. Verify gb-pbhl-universal format
console.log('\n--- 2. Testing "gb-pbhl-universal" Template ---');
const universalTemplate = TemplateParser.loadTemplate('gb-pbhl-universal');
const valUniversal = validateWorkflowTemplate(universalTemplate);
if (!valUniversal.valid) {
  throw new Error(`gb-pbhl-universal failed schema validation: ${valUniversal.errors.join(', ')}`);
}
if (!Array.isArray(universalTemplate.steps) || universalTemplate.steps.length === 0) {
  throw new Error('Expected non-empty steps array in gb-pbhl-universal');
}
console.log(`✅ [PASS] "gb-pbhl-universal" schema validated with ${universalTemplate.steps.length} customizable steps!`);

// 3. Test natural language / shorthand DSL parsing of user request with honor guard
console.log('\n--- 3. Testing Natural Language Shorthand DSL Parsing ---');
const rawUserDsl = `
Name: User Request PBHL Test
Quest: https://game.granbluefantasy.jp/#quest/assist
Slots: 4
TargetScore: 1500000
LogPath: logs/gb-pbhl.md
Supporters: Agni, Bahamut
---
char 4 skill 3
reload
tap the ready
reload 
tap the ready"
reload 
tap the ready
reload 
tap the ready
reload
tap the ready
summon number 2
reload
tap the ready
repeat 15 {
  exit_if_score 1500000
  reload
  tap the ready
}
done
---
`;

const parsedUserDsl = TemplateParser.parseShorthandDsl(rawUserDsl, 'user-request-test');
const userValidation = validateWorkflowTemplate(parsedUserDsl);
if (!userValidation.valid) {
  throw new Error(`Parsed user DSL failed schema validation: ${userValidation.errors.join(', ')}`);
}

console.log(`Successfully compiled raw user DSL into ${parsedUserDsl.steps.length} steps.`);
if (parsedUserDsl.steps.length !== 16) {
  throw new Error(`Expected 16 steps from parsed user DSL, got ${parsedUserDsl.steps.length}`);
}
if (parsedUserDsl.steps[0].character !== 4 || parsedUserDsl.steps[0].skill !== 3) {
  throw new Error(`Expected step 1 char 4 skill 3`);
}
if (parsedUserDsl.steps[1].code !== 'reload') {
  throw new Error(`Expected step 2 reload`);
}
if (parsedUserDsl.steps[2].code !== 'tap_ready') {
  throw new Error(`Expected step 3 tap_ready from tap the ready`);
}
if (parsedUserDsl.steps[4].code !== 'tap_ready') {
  throw new Error(`Expected step 5 tap_ready from tap the ready"`);
}
if (parsedUserDsl.steps[6].code !== 'tap_ready') {
  throw new Error(`Expected step 7 tap_ready from tap the ready`);
}
if (parsedUserDsl.steps[8].code !== 'tap_ready') {
  throw new Error(`Expected step 9 tap_ready from tap the ready`);
}
if (parsedUserDsl.steps[9].code !== 'reload') {
  throw new Error(`Expected step 10 reload`);
}
if (parsedUserDsl.steps[10].code !== 'tap_ready') {
  throw new Error(`Expected step 11 tap_ready from tap the ready`);
}
if (parsedUserDsl.steps[11].code !== 'summon' || parsedUserDsl.steps[11].slot !== 2) {
  throw new Error(`Expected step 12 summon slot 2 from summon number 2`);
}
if (parsedUserDsl.steps[13].code !== 'tap_ready') {
  throw new Error(`Expected step 14 tap_ready from tap the ready`);
}
if (parsedUserDsl.steps[14].code !== 'repeat') {
  throw new Error(`Expected step 15 repeat honor guard`);
}
if (parsedUserDsl.steps[15].code !== 'confirm_result') {
  throw new Error(`Expected step 16 confirm_result from done`);
}

console.log('✅ [PASS] Raw user DSL syntax parsed and validated flawlessly!');

// 4. Test DSL round-trip serialization
console.log('\n--- 4. Testing DSL Round-Trip Serialization ---');
const dslSerialized = TemplateParser.serializeToDsl(pbhlTemplate);
const reloaded = TemplateParser.parseShorthandDsl(dslSerialized, 'round-trip-test');
const reloadedValidation = validateWorkflowTemplate(reloaded);
if (!reloadedValidation.valid) {
  throw new Error(`Round-trip DSL failed schema validation: ${reloadedValidation.errors.join(', ')}`);
}
if (reloaded.steps.length !== pbhlTemplate.steps.length) {
  throw new Error(`Round-trip step count mismatch: expected ${pbhlTemplate.steps.length}, got ${reloaded.steps.length}`);
}
console.log('✅ [PASS] DSL Round-trip serialization verified!');

console.log('\n========================================================================');
console.log('🎉 ALL PBHL UNIVERSAL WORKFLOW UNIT TESTS PASSED (100%)');
console.log('========================================================================\n');

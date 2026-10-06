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

if (pbhlTemplate.targetScore !== 1500000) {
  throw new Error(`Expected targetScore 1500000, got ${pbhlTemplate.targetScore}`);
}
if (pbhlTemplate.raidSlot !== 4) {
  throw new Error(`Expected raidSlot 4, got ${pbhlTemplate.raidSlot}`);
}
if (pbhlTemplate.logPath !== 'logs/gb-pbhl.md') {
  throw new Error(`Expected logPath 'logs/gb-pbhl.md', got ${pbhlTemplate.logPath}`);
}
if (!pbhlTemplate.supporterPriority?.includes('Agni')) {
  throw new Error(`Expected supporterPriority to include 'Agni', got ${pbhlTemplate.supporterPriority}`);
}

// Verify step pipeline
const steps = pbhlTemplate.steps;
if (steps.length !== 16) {
  throw new Error(`Expected exactly 16 steps, got ${steps.length}`);
}
if (steps[0].code !== 'skill' || steps[0].character !== 4 || steps[0].skill !== 3) {
  throw new Error(`Expected step 1 to be C4S3, got ${JSON.stringify(steps[0])}`);
}
if (steps[1].code !== 'reload') {
  throw new Error(`Expected step 2 to be reload, got ${JSON.stringify(steps[1])}`);
}
if (steps[2].code !== 'tap_ready') {
  throw new Error(`Expected step 3 to be tap_ready, got ${JSON.stringify(steps[2])}`);
}
if (steps[3].code !== 'reload') {
  throw new Error(`Expected step 4 to be reload, got ${JSON.stringify(steps[3])}`);
}
if (steps[4].code !== 'tap_ready') {
  throw new Error(`Expected step 5 to be tap_ready, got ${JSON.stringify(steps[4])}`);
}
if (steps[5].code !== 'reload') {
  throw new Error(`Expected step 6 to be reload, got ${JSON.stringify(steps[5])}`);
}
if (steps[6].code !== 'tap_ready') {
  throw new Error(`Expected step 7 to be tap_ready, got ${JSON.stringify(steps[6])}`);
}
if (steps[7].code !== 'reload') {
  throw new Error(`Expected step 8 to be reload, got ${JSON.stringify(steps[7])}`);
}
if (steps[8].code !== 'tap_ready') {
  throw new Error(`Expected step 9 to be tap_ready, got ${JSON.stringify(steps[8])}`);
}
if (steps[9].code !== 'reload') {
  throw new Error(`Expected step 10 to be reload, got ${JSON.stringify(steps[9])}`);
}
if (steps[10].code !== 'tap_ready') {
  throw new Error(`Expected step 11 to be tap_ready, got ${JSON.stringify(steps[10])}`);
}
if (steps[11].code !== 'summon' || steps[11].slot !== 2) {
  throw new Error(`Expected step 12 to be summon slot 2, got ${JSON.stringify(steps[11])}`);
}
if (steps[12].code !== 'reload') {
  throw new Error(`Expected step 13 to be reload, got ${JSON.stringify(steps[12])}`);
}
if (steps[13].code !== 'tap_ready') {
  throw new Error(`Expected step 14 to be tap_ready, got ${JSON.stringify(steps[13])}`);
}
if (steps[14].code !== 'repeat' || !steps[14].subSteps || steps[14].subSteps.length !== 3) {
  throw new Error(`Expected step 15 to be repeat honor guard block, got ${JSON.stringify(steps[14])}`);
}
if (steps[14].subSteps[0].code !== 'exit_if_score' || steps[14].subSteps[0].targetScore !== 1500000) {
  throw new Error(`Expected repeat block to have exit_if_score 1500000, got ${JSON.stringify(steps[14].subSteps[0])}`);
}
if (steps[15].code !== 'confirm_result') {
  throw new Error(`Expected step 16 to be confirm_result, got ${JSON.stringify(steps[15])}`);
}

console.log('✅ [PASS] "gb-pbhl" template steps verified 100% compliant!');

// 2. Verify gb-pbhl-universal alias
console.log('\n--- 2. Testing "gb-pbhl-universal" Template ---');
const universalTemplate = TemplateParser.loadTemplate('gb-pbhl-universal');
if (universalTemplate.steps.length !== pbhlTemplate.steps.length) {
  throw new Error(`Expected gb-pbhl-universal to have ${pbhlTemplate.steps.length} steps, got ${universalTemplate.steps.length}`);
}
console.log('✅ [PASS] "gb-pbhl-universal" matches primary template!');

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

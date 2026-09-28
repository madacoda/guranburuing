// tests/test-template-parser-advanced.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('       Advanced DSL Lexer, Compiler, & Serialization Test Suite         ');
console.log('========================================================================\n');

// 1. Comprehensive DSL text covering all advanced dialect features
const advancedDsl = `
# Multi-Raid PBHL High Performance Workflow
Name: PBHL Burst Rotator
Description: Auto-switches targets, triggers Nier buff, casts Death, loops 2 attacks, and exits on blue chest
Quest: https://game.granbluefantasy.jp/#quest/assist
Speed: turbo
Runs: 75
Supporters: Hades, Bahamut, Zeus
Slots: 4, 3
TargetScore: 1480000
Elixir: false
Berry: true
BatchClaim: 3 to 5

---
quick_call
reload
c4s1
c4s2 on 2
summon 3
reload
c2s1
target 1
heal green
backup_request

# Repeat block with attacks and reloads
repeat 2 {
  attack
  reload
}

# Inline repeat
repeat 2: attack -> reload

exit_if_score 1480000
confirm_result
---
`;

console.log('--- 1. Testing Advanced DSL Parsing ---');
const parsed = TemplateParser.parseShorthandDsl(advancedDsl, 'test-advanced');

console.log(`Parsed Template: "${parsed.name}"`);
console.log(`Quest URL:       ${parsed.questUrl}`);
console.log(`Speed Profile:   ${parsed.speedProfile}`);
console.log(`Runs:            ${parsed.defaultRuns}`);
console.log(`Target Score:    ${parsed.targetScore}`);
console.log(`Raid Slots:      [${parsed.raidSlots?.join(', ')}]`);
console.log(`Supporters:      [${parsed.supporterPriority?.join(', ')}]`);
console.log(`Batch Claim:     ${parsed.minBatchClaim} - ${parsed.maxBatchClaim}`);
console.log(`Total Steps:     ${parsed.steps.length}`);

// Verify metadata
if (parsed.name !== 'PBHL Burst Rotator') throw new Error(`Expected name 'PBHL Burst Rotator', got '${parsed.name}'`);
if (parsed.speedProfile !== 'turbo') throw new Error(`Expected speed 'turbo', got '${parsed.speedProfile}'`);
if (parsed.defaultRuns !== 75) throw new Error(`Expected runs 75, got ${parsed.defaultRuns}`);
if (parsed.targetScore !== 1480000) throw new Error(`Expected targetScore 1480000, got ${parsed.targetScore}`);
if (parsed.autoElixir !== false || parsed.autoBerry !== true) throw new Error('Elixir/Berry flag mismatch');
if (parsed.minBatchClaim !== 3 || parsed.maxBatchClaim !== 5) throw new Error('BatchClaim mismatch');

// Verify steps
const stepActions = parsed.steps.map(s => s.code);
console.log('Step Action Pipeline:', stepActions.join(' -> '));

const expectedActions = [
  'quick_call',
  'reload',
  'skill',
  'skill',
  'summon',
  'reload',
  'skill',
  'target_enemy',
  'heal',
  'backup_request',
  'repeat',
  'repeat',
  'exit_if_score',
  'confirm_result'
];

if (stepActions.length !== expectedActions.length) {
  throw new Error(`Step count mismatch: expected ${expectedActions.length}, got ${stepActions.length}`);
}

for (let i = 0; i < expectedActions.length; i++) {
  if (stepActions[i] !== expectedActions[i]) {
    throw new Error(`Step ${i + 1} action mismatch: expected '${expectedActions[i]}', got '${stepActions[i]}'`);
  }
}

// Verify targeted skill: c4s2 on 2
const targetedSkill = parsed.steps[3];
if (targetedSkill.character !== 4 || targetedSkill.skill !== 2 || targetedSkill.targetCharacter !== 2) {
  throw new Error(`Targeted skill mismatch: char=${targetedSkill.character}, skill=${targetedSkill.skill}, target=${targetedSkill.targetCharacter}`);
}
console.log('  ✅ [PASS] Targeted skill (c4s2 on 2) parsed with character: 4, skill: 2, targetCharacter: 2');

// Verify multi-line repeat block
const multiLineRepeat = parsed.steps[10];
if (multiLineRepeat.code !== 'repeat' || multiLineRepeat.repeatCount !== 2 || multiLineRepeat.subSteps?.length !== 2) {
  throw new Error('Multi-line repeat block failed to parse subSteps');
}
console.log('  ✅ [PASS] Multi-line repeat block parsed with 2 subSteps (attack, reload)');

// Verify inline repeat block
const inlineRepeat = parsed.steps[11];
if (inlineRepeat.code !== 'repeat' || inlineRepeat.repeatCount !== 2 || inlineRepeat.subSteps?.length !== 2) {
  throw new Error('Inline repeat block failed to parse subSteps');
}
console.log('  ✅ [PASS] Inline repeat block (repeat 2: attack -> reload) parsed with 2 subSteps');

// Verify target_enemy, heal, backup_request, exit_if_score
if (parsed.steps[7].enemyIndex !== 1) throw new Error('target_enemy index mismatch');
if (parsed.steps[8].potionType !== 'green') throw new Error('heal potionType mismatch');
if (parsed.steps[12].targetScore !== 1480000) throw new Error('exit_if_score targetScore mismatch');
console.log('  ✅ [PASS] target_enemy, heal, backup_request, and exit_if_score parsed cleanly');

console.log('\n--- 2. Testing Bidirectional Round-Trip Serialization (DSL <-> JSON) ---');
// 2a. Template -> DSL
const generatedDsl = TemplateParser.serializeToDsl(parsed);
console.log('Generated DSL (first 10 lines):');
console.log(generatedDsl.split('\n').slice(0, 10).join('\n'));

// 2b. Re-parse generated DSL
const reParsedFromDsl = TemplateParser.parseShorthandDsl(generatedDsl, 're-parsed');
if (reParsedFromDsl.steps.length !== parsed.steps.length) {
  throw new Error(`Round-trip DSL step count mismatch: ${reParsedFromDsl.steps.length} vs ${parsed.steps.length}`);
}
console.log('  ✅ [PASS] Template -> DSL -> Template round-trip retained identical step count');

// 2c. Template -> JSON -> Template
const jsonStr = TemplateParser.serializeToJson(parsed, true);
const parsedFromJson = JSON.parse(jsonStr);
const validatedFromJson = TemplateParser.validate(parsedFromJson);
if (!validatedFromJson.valid || !validatedFromJson.template) {
  throw new Error(`JSON serialization failed schema validation: ${validatedFromJson.errors.join(', ')}`);
}
if (validatedFromJson.template.steps.length !== parsed.steps.length) {
  throw new Error(`Round-trip JSON step count mismatch: ${validatedFromJson.template.steps.length} vs ${parsed.steps.length}`);
}
console.log('  ✅ [PASS] Template -> JSON -> Template round-trip passed strict schema validation');

console.log('\n--- 3. Testing Routine Mode & Universal Daily DSL Compilation ---');
const routineDsl = `
Name: Universal Routine Test
Description: Tests do_until_finish, loop_while, and story skip in routine mode
Mode: routine
Quest: https://game.granbluefantasy.jp/#quest/extra
Speed: fast
Runs: 1
Elixir: true

---
navigate https://game.granbluefantasy.jp/#quest/extra
do_until_finish daily_magna_pro
do_until_finish [data-quest-id='305021'] {
  click [data-quest-id='305021']
  dismiss_popups
}
loop_while .btn-fate-entry {
  skip_story_scene
}
dismiss_popups
---
`;

const parsedRoutine = TemplateParser.parseShorthandDsl(routineDsl, 'routine-test');
if (parsedRoutine.mode !== 'routine') throw new Error('Expected mode routine');
if (parsedRoutine.steps.length !== 5) throw new Error(`Expected 5 steps, got ${parsedRoutine.steps.length}`);
if (parsedRoutine.steps[1].code !== 'do_until_finish' || parsedRoutine.steps[1].tag !== 'daily_magna_pro') {
  throw new Error('do_until_finish single-line parsing failed');
}
if (parsedRoutine.steps[2].code !== 'do_until_finish' || parsedRoutine.steps[2].subSteps?.length !== 2) {
  throw new Error('do_until_finish block parsing failed');
}
if (parsedRoutine.steps[3].code !== 'loop_while' || parsedRoutine.steps[3].subSteps?.[0].code !== 'skip_story_scene') {
  throw new Error('loop_while block parsing failed');
}
console.log('  ✅ [PASS] Routine DSL parsed with single-line and block do_until_finish & loop_while');

// Round-trip DSL
const routineDslSerialized = TemplateParser.serializeToDsl(parsedRoutine);
const reParsedRoutine = TemplateParser.parseShorthandDsl(routineDslSerialized, 'routine-reparsed');
if (reParsedRoutine.steps.length !== parsedRoutine.steps.length) {
  throw new Error(`Round-trip routine DSL mismatch: ${reParsedRoutine.steps.length} vs ${parsedRoutine.steps.length}`);
}
console.log('  ✅ [PASS] Routine DSL round-trip serialization retained identical structure');

console.log('\n========================================================================');
console.log('     🎉 ALL ADVANCED DSL COMPILER & ROUND-TRIP TESTS PASSED (100%)       ');
console.log('========================================================================\n');

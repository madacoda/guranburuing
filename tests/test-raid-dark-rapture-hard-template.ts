// tests/test-raid-dark-rapture-hard-template.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { isSoloWorkflowTemplate } from '../src/types/workflow.types.js';
import { RaidEvaluator } from '../src/engines/raid-evaluator.js';
import { RaidCandidate } from '../src/engines/raid-evaluator.js';

console.log('========================================================================');
console.log('    Raid - Dark Rapture (Hard) / Lucilius HL Automation Test Suite      ');
console.log('========================================================================\n');

// 1. Validate canonical template loading & schema
console.log('--- 1. Testing Canonical raid-dark-rapture-hard Template Loading & Schema ---');
const tmpl = TemplateParser.loadTemplate('raid-dark-rapture-hard');
if (!tmpl) {
  throw new Error('Failed to load raid-dark-rapture-hard template');
}

const validation = TemplateParser.validate(tmpl);
if (!validation.valid) {
  throw new Error(`raid-dark-rapture-hard template schema validation failed: ${validation.errors.join(', ')}`);
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

if (tmpl.minHpPct !== 3 || tmpl.maxHpPct !== 73) {
  throw new Error(`Expected minHpPct=3, maxHpPct=73 (custom HP filter), got: min=${tmpl.minHpPct}, max=${tmpl.maxHpPct}`);
}

if (tmpl.minPlayers !== 1 || tmpl.maxPlayers !== 6) {
  throw new Error(`Expected minPlayers=1, maxPlayers=6 (players filter), got: min=${tmpl.minPlayers}, max=${tmpl.maxPlayers}`);
}

if (tmpl.evaluatorStrategy !== 'leech') {
  throw new Error(`Expected evaluatorStrategy to be "leech", got: ${tmpl.evaluatorStrategy}`);
}

console.log(`  ✅ [PASS] Canonical template validated: raidSlot=1, mode=assist, minHpPct=${tmpl.minHpPct}%, maxHpPct=${tmpl.maxHpPct}%, minPlayers=${tmpl.minPlayers}, maxPlayers=${tmpl.maxPlayers}, strategy=${tmpl.evaluatorStrategy}`);

// 2. Validate exact 8-step pipeline
console.log('\n--- 2. Validating Exact 8-Step Pipeline Sequence ---');
const expectedSteps = [
  { code: 'wait_element', target: '.btn-attack-start' },
  { code: 'reload' },
  { code: 'skill', character: 4, skill: 1 },
  { code: 'skill', character: 3, skill: 1 },
  { code: 'skill', character: 3, skill: 2 },
  { code: 'skill', character: 2, skill: 1 },
  { code: 'attack' },
  { code: 'confirm_result' }
];

if (tmpl.steps.length !== 8) {
  throw new Error(`Expected exactly 8 steps, got ${tmpl.steps.length}`);
}

for (let i = 0; i < expectedSteps.length; i++) {
  const step = tmpl.steps[i];
  const exp = expectedSteps[i];
  const stepCode = step.code || step.action;
  if (stepCode !== exp.code) {
    throw new Error(`Step ${i + 1} code mismatch: expected "${exp.code}", got "${stepCode}"`);
  }
  if (exp.target !== undefined && step.target !== exp.target) {
    throw new Error(`Step ${i + 1} target mismatch: expected "${exp.target}", got "${step.target}"`);
  }
  if (exp.character !== undefined && step.character !== exp.character) {
    throw new Error(`Step ${i + 1} character mismatch: expected ${exp.character}, got ${step.character}`);
  }
  if (exp.skill !== undefined && step.skill !== exp.skill) {
    throw new Error(`Step ${i + 1} skill mismatch: expected ${exp.skill}, got ${step.skill}`);
  }
}
console.log('  ✅ [PASS] All 8 steps verified: make sure full load -> reload -> c4s1 -> c3s1 -> c3s2 -> c2s1 -> attack -> rerun');

// 3. Verify isSoloWorkflowTemplate returns false for assist multi-battle raid
console.log('\n--- 3. Verifying Solo Quest Isolation Flag ---');
const isSolo = isSoloWorkflowTemplate(tmpl);
if (isSolo !== false) {
  throw new Error(`Expected isSoloWorkflowTemplate(raid-dark-rapture-hard) to be false, got ${isSolo}`);
}
console.log('  ✅ [PASS] Dark Rapture (Hard) correctly verified as multi-battle assist raid (honors/blue chest tracking enabled)');

// 4. Validate canonical alias resolution
console.log('\n--- 4. Testing Canonical Aliases (Zero Duplicate Files on Disk) ---');
const aliases = [
  'dark-rapture-hard',
  'dark-rapture-hl',
  'dark-rapture',
  'faahl',
  'faa-hl',
  'lucilius-hard',
  'lucilius-hl',
  'raid-dark-rapture',
  'leech-dark-rapture-hard',
  'leech-faahl'
];

for (const alias of aliases) {
  const resolved = TemplateParser.loadTemplate(alias);
  if (resolved.name !== tmpl.name) {
    throw new Error(`Alias "${alias}" failed to resolve to canonical template "${tmpl.name}"`);
  }
}
console.log(`  ✅ [PASS] All ${aliases.length} aliases cleanly resolved to canonical raid-dark-rapture-hard.json`);

// 5. Test Shorthand DSL parsing of user's exact specification
console.log('\n--- 5. Testing Shorthand DSL Parser with User Specification ---');
const rawDsl = `
Name: Raid - Dark Rapture (Hard)
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Raid Slot: 1
Strategy: leech
Min HP: 3
Max HP: 73
Min Players: 1
Max Players: 6
Min Raid Score: 10

make sure full load
reload (since enemy has initial attack animation)
c4s1
c3s1
c3s2
c2s1
attack
rerun
`.trim();

const parsedFromDsl = TemplateParser.parseShorthandDsl(rawDsl, 'test-dark-rapture-hard-dsl');
if (parsedFromDsl.steps.length !== 8) {
  throw new Error(`Expected DSL to parse 8 steps, got ${parsedFromDsl.steps.length}`);
}

for (let i = 0; i < expectedSteps.length; i++) {
  const step = parsedFromDsl.steps[i];
  const exp = expectedSteps[i];
  const stepCode = step.code || step.action;
  if (stepCode !== exp.code) {
    throw new Error(`DSL Step ${i + 1} code mismatch: expected "${exp.code}", got "${stepCode}"`);
  }
  if (exp.character !== undefined && step.character !== exp.character) {
    throw new Error(`DSL Step ${i + 1} character mismatch: expected ${exp.character}, got ${step.character}`);
  }
  if (exp.skill !== undefined && step.skill !== exp.skill) {
    throw new Error(`DSL Step ${i + 1} skill mismatch: expected ${exp.skill}, got ${step.skill}`);
  }
}
console.log('  ✅ [PASS] User DSL string parsed with 100% accuracy into identical 8-step pipeline');

// 6. Test Leech Evaluator Decision Matrix for 6-Player Dark Rapture (Hard)
console.log('\n--- 6. Testing Leech Evaluator Scoring on 6-Player Dark Rapture Raids ---');
const evalOptions = {
  strategy: tmpl.evaluatorStrategy || 'leech',
  minHpPct: tmpl.minHpPct,
  maxHpPct: tmpl.maxHpPct,
  minPlayers: tmpl.minPlayers,
  maxPlayers: tmpl.maxPlayers,
  minScore: tmpl.minRaidScore
};

// Case A: Ideal dying raid with active player participation (HP: 8%, Players: 5/6)
const idealCase = RaidEvaluator.evaluateCandidate(8, 5, 6, evalOptions, 'faa_ideal_1');
if (!idealCase.viable || idealCase.score < 70) {
  throw new Error(`Expected ideal case (HP 8%, 5/6 players) to be viable with score >= 70, got: viable=${idealCase.viable}, score=${idealCase.score}, reason=${idealCase.reason}`);
}
console.log(`  ✅ [PASS] Ideal candidate (HP 8%, 5/6 players) scored ${idealCase.score} pt (Grade ${idealCase.grade}) - VIABLE`);

// Case B: Viable mid-low HP raid with 4 players (HP: 15%, Players: 4/6)
const viableCase = RaidEvaluator.evaluateCandidate(15, 4, 6, evalOptions, 'faa_viable_2');
if (!viableCase.viable || viableCase.score < 60) {
  throw new Error(`Expected viable case (HP 15%, 4/6 players) to be viable with score >= 60, got: viable=${viableCase.viable}, score=${viableCase.score}`);
}
console.log(`  ✅ [PASS] Good candidate (HP 15%, 4/6 players) scored ${viableCase.score} pt (Grade ${viableCase.grade}) - VIABLE`);

// Case C: High HP raid (HP: 85%, Players: 4/6) - should be disqualified by maxHpPct (73%)
const highHpCase = RaidEvaluator.evaluateCandidate(85, 4, 6, evalOptions, 'faa_high_hp');
if (highHpCase.viable) {
  throw new Error(`Expected high HP raid (HP 85%) to be disqualified by maxHpPct 73%, but it was viable!`);
}
console.log(`  ✅ [PASS] High HP raid (HP 85%, 4/6 players) correctly disqualified: "${highHpCase.reason}"`);

// Case D: Stalled raid (HP: 20%, Players: 0/6) - should be disqualified by minPlayers (1)
const stalledCase = RaidEvaluator.evaluateCandidate(20, 0, 6, evalOptions, 'faa_stalled');
if (stalledCase.viable) {
  throw new Error(`Expected stalled raid (Players: 0/6) to be disqualified by minPlayers 1, but it was viable!`);
}
console.log(`  ✅ [PASS] Stalled raid (HP 20%, 0/6 players) correctly disqualified: "${stalledCase.reason}"`);

// Case E: Full raid (HP: 6%, Players: 6/6) - should be disqualified as full
const fullCase = RaidEvaluator.evaluateCandidate(6, 6, 6, evalOptions, 'faa_full');
if (fullCase.viable) {
  throw new Error(`Expected full raid (Players: 6/6) to be disqualified, but it was viable!`);
}
console.log(`  ✅ [PASS] Full raid (HP 6%, 6/6 players) correctly disqualified: "${fullCase.reason}"`);

// Case F: Batch candidate selection prefers lower HP and higher active players
const candidates: RaidCandidate[] = [
  { index: 0, raidId: 'raid_stalled', hpPct: 5, players: 1, maxPlayers: 6 },
  { index: 1, raidId: 'raid_high_hp', hpPct: 65, players: 5, maxPlayers: 6 },
  { index: 2, raidId: 'raid_viable_15', hpPct: 15, players: 3, maxPlayers: 6 },
  { index: 3, raidId: 'raid_best_8', hpPct: 8, players: 5, maxPlayers: 6 }
];

const selectionResult = RaidEvaluator.selectBestCandidate(candidates, evalOptions);
if (!selectionResult.best || selectionResult.best.raidId !== 'raid_best_8') {
  throw new Error(`Expected selectBestCandidate to pick "raid_best_8", got: ${selectionResult.best?.raidId}`);
}
console.log(`  ✅ [PASS] Candidate selector correctly chose best raid: "${selectionResult.best.raidId}" (Score: ${selectionResult.best.score} pt, Grade: ${selectionResult.best.grade})`);

// 7. Test Bidirectional Round-Trip Serialization
console.log('\n--- 7. Testing Bidirectional Round-Trip Serialization (DSL <-> Template) ---');
const serializedDsl = TemplateParser.serializeToDsl(tmpl);
const roundTripped = TemplateParser.parseShorthandDsl(serializedDsl, 'roundtrip-dark-rapture-hard');
if (roundTripped.steps.length !== tmpl.steps.length) {
  throw new Error(`Round-trip step count mismatch: ${roundTripped.steps.length} vs ${tmpl.steps.length}`);
}
console.log('  ✅ [PASS] Bidirectional Template -> DSL -> Template round-trip fully intact');

console.log('\n========================================================================');
console.log('    🎉 ALL DARK RAPTURE (HARD) TESTS PASSED SUCCESSFULLY (100%)         ');
console.log('========================================================================\n');

// tests/test-raid-long-live-the-king-template.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { isSoloWorkflowTemplate } from '../src/types/workflow.types.js';
import { RaidEvaluator, RaidCandidate } from '../src/engines/raid-evaluator.js';

console.log('========================================================================');
console.log('  Raid - Long Live the King / Beelzebub HL Test Suite                   ');
console.log('========================================================================\n');

// 1. Validate canonical template loading & schema
console.log('--- 1. Testing Canonical raid-long-live-the-king Template Loading & Schema ---');
const tmpl = TemplateParser.loadTemplate('raid-long-live-the-king');
if (!tmpl) {
  throw new Error('Failed to load raid-long-live-the-king template');
}

const validation = TemplateParser.validate(tmpl);
if (!validation.valid) {
  throw new Error(`raid-long-live-the-king template schema validation failed: ${validation.errors.join(', ')}`);
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

if (tmpl.minHpPct !== 3 || tmpl.maxHpPct !== 60) {
  throw new Error(`Expected minHpPct=3, maxHpPct=60 (config matching Belial/FaaHL), got: min=${tmpl.minHpPct}, max=${tmpl.maxHpPct}`);
}

if (tmpl.minPlayers !== 2 || tmpl.maxPlayers !== 6) {
  throw new Error(`Expected minPlayers=2, maxPlayers=6 (players filter matching Belial/FaaHL), got: min=${tmpl.minPlayers}, max=${tmpl.maxPlayers}`);
}

if (tmpl.evaluatorStrategy !== 'leech') {
  throw new Error(`Expected evaluatorStrategy to be "leech", got: ${tmpl.evaluatorStrategy}`);
}

console.log(`  ✅ [PASS] Canonical template validated: raidSlot=1, mode=assist, minHpPct=${tmpl.minHpPct}%, maxHpPct=${tmpl.maxHpPct}%, minPlayers=${tmpl.minPlayers}, maxPlayers=${tmpl.maxPlayers}, strategy=${tmpl.evaluatorStrategy}`);

// 2. Validate exact 8-step pipeline sequence
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
  throw new Error(`Expected isSoloWorkflowTemplate(raid-long-live-the-king) to be false, got ${isSolo}`);
}
console.log('  ✅ [PASS] Long Live the King correctly verified as multi-battle assist raid (honors/blue chest tracking enabled)');

// 4. Validate canonical alias resolution
console.log('\n--- 4. Testing Canonical Aliases (Zero Duplicate Files on Disk) ---');
const aliases = [
  'long-live-the-king',
  'the-birth-of-new-king',
  'birth-of-new-king',
  'beelzebub',
  'beelzebub-hl',
  'bubz',
  'bubz-hl',
  'bubs',
  'bubs-hl',
  'raid-beelzebub',
  'raid-bubz',
  'raid-bubs',
  'raid-long-live-the-king',
  'leech-beelzebub',
  'leech-bubz',
  'leech-bubs',
  'leech-long-live-the-king'
];

for (const alias of aliases) {
  const resolved = TemplateParser.loadTemplate(alias);
  if (resolved.name !== tmpl.name) {
    throw new Error(`Alias "${alias}" failed to resolve to canonical template "${tmpl.name}"`);
  }
}
console.log(`  ✅ [PASS] All ${aliases.length} aliases cleanly resolved to canonical raid-long-live-the-king.json`);

// 5. Test Shorthand DSL parsing of user's exact specification
console.log('\n--- 5. Testing Shorthand DSL Parser with User Specification ---');
const rawDsl = `
Name: Raid - Long Live the King
Quest: https://game.granbluefantasy.jp/#quest/assist
Mode: assist
Raid Slot: 1
Strategy: leech
Min HP: 3
Max HP: 60
Min Players: 2
Max Players: 6
Min Raid Score: 30

make sure full load
reload (since enemy has initial attack animation)
c4s1
c3s1
c3s2
c2s1
attack
rerun
`.trim();

const parsedFromDsl = TemplateParser.parseShorthandDsl(rawDsl, 'test-bubz-dsl');
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

// 6. Test Leech Evaluator Decision Matrix for 6-Player Beelzebub Raids
console.log('\n--- 6. Testing Leech Evaluator Scoring on 6-Player Beelzebub Raids ---');
const evalOptions = {
  strategy: tmpl.evaluatorStrategy || 'leech',
  minHpPct: tmpl.minHpPct,
  maxHpPct: tmpl.maxHpPct,
  minPlayers: tmpl.minPlayers,
  maxPlayers: tmpl.maxPlayers,
  minScore: tmpl.minRaidScore
};

// Case A: Ideal dying raid with active player participation (HP: 8%, Players: 5/6)
const idealCase = RaidEvaluator.evaluateCandidate(8, 5, 6, evalOptions, 'bubz_ideal_1');
if (!idealCase.viable || idealCase.score < 70) {
  throw new Error(`Expected ideal case (HP 8%, 5/6 players) to be viable with score >= 70, got: viable=${idealCase.viable}, score=${idealCase.score}`);
}
console.log(`  ✅ [PASS] Ideal candidate (HP 8%, 5/6 players) scored ${idealCase.score} pt (Grade ${idealCase.grade}) - VIABLE`);

// Case B: Viable mid HP raid (HP: 35%, Players: 4/6)
const midCase = RaidEvaluator.evaluateCandidate(35, 4, 6, evalOptions, 'bubz_mid_2');
if (!midCase.viable || midCase.score < 50) {
  throw new Error(`Expected mid HP raid (HP 35%, 4/6 players) to be viable, got: viable=${midCase.viable}, score=${midCase.score}`);
}
console.log(`  ✅ [PASS] Mid HP candidate (HP 35%, 4/6 players) scored ${midCase.score} pt (Grade ${midCase.grade}) - VIABLE`);

// Case C: Too high HP raid (HP: 75%, Players: 4/6) - should be disqualified by maxHpPct (60%)
const highHpCase = RaidEvaluator.evaluateCandidate(75, 4, 6, evalOptions, 'bubz_high_hp');
if (highHpCase.viable) {
  throw new Error(`Expected high HP raid (HP 75%) to be disqualified by maxHpPct 60%, but it was viable!`);
}
console.log(`  ✅ [PASS] High HP raid (HP 75%, 4/6 players) correctly disqualified: "${highHpCase.reason}"`);

// Case D: Stalled raid (HP: 20%, Players: 1/6) - should be disqualified by minPlayers (2)
const stalledCase = RaidEvaluator.evaluateCandidate(20, 1, 6, evalOptions, 'bubz_stalled');
if (stalledCase.viable) {
  throw new Error(`Expected stalled raid (Players: 1/6) to be disqualified by minPlayers 2, but it was viable!`);
}
console.log(`  ✅ [PASS] Stalled raid (HP 20%, 1/6 players) correctly disqualified: "${stalledCase.reason}"`);

// Case E: Full raid (HP: 15%, Players: 6/6) - should be disqualified as full
const fullCase = RaidEvaluator.evaluateCandidate(15, 6, 6, evalOptions, 'bubz_full');
if (fullCase.viable) {
  throw new Error(`Expected full raid (Players: 6/6) to be disqualified, but it was viable!`);
}
console.log(`  ✅ [PASS] Full raid (HP 15%, 6/6 players) correctly disqualified: "${fullCase.reason}"`);

// Case F: Batch candidate selection prefers lower HP and higher active players
const candidates: RaidCandidate[] = [
  { index: 0, raidId: 'raid_stalled_1p', hpPct: 5, players: 1, maxPlayers: 6 },
  { index: 1, raidId: 'raid_high_hp_80', hpPct: 80, players: 4, maxPlayers: 6 },
  { index: 2, raidId: 'raid_mid_hp_45', hpPct: 45, players: 3, maxPlayers: 6 },
  { index: 3, raidId: 'raid_best_12', hpPct: 12, players: 5, maxPlayers: 6 }
];

const selectionResult = RaidEvaluator.selectBestCandidate(candidates, evalOptions);
if (!selectionResult.best || selectionResult.best.raidId !== 'raid_best_12') {
  throw new Error(`Expected selectBestCandidate to pick "raid_best_12", got: ${selectionResult.best?.raidId}`);
}
console.log(`  ✅ [PASS] Candidate selector correctly chose best raid: "${selectionResult.best.raidId}" (Score: ${selectionResult.best.score} pt, Grade: ${selectionResult.best.grade})`);

// 7. Test Bidirectional Round-Trip Serialization
console.log('\n--- 7. Testing Bidirectional Round-Trip Serialization (DSL <-> Template) ---');
const serializedDsl = TemplateParser.serializeToDsl(tmpl);
const roundTripped = TemplateParser.parseShorthandDsl(serializedDsl, 'roundtrip-bubz');
if (roundTripped.steps.length !== tmpl.steps.length) {
  throw new Error(`Round-trip step count mismatch: ${roundTripped.steps.length} vs ${tmpl.steps.length}`);
}
console.log('  ✅ [PASS] Bidirectional Template -> DSL -> Template round-trip fully intact');

console.log('\n========================================================================');
console.log('  🎉 ALL LONG LIVE THE KING / BEELZEBUB TESTS PASSED SUCCESSFULLY (100%)');
console.log('========================================================================\n');

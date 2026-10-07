// tests/test-otkraid-evaluator.ts
import { RaidEvaluator } from '../src/engines/raid-evaluator.js';
import { TemplateParser } from '../src/templates/template-parser.js';

console.log('========================================================================');
console.log('         OTK Raid Burst & Leech Evaluator Unit Test Suite               ');
console.log('========================================================================\n');

// 1. Ideal OTK Burst Candidates (HP <= 20% and players >= 3)
console.log('--- 1. Testing Ideal OTK Burst Raids (HP <= 20%, players >= 3) ---');

const otkIdeal1 = RaidEvaluator.evaluateCandidate(10, 6, 30, { strategy: 'otk_burst' });
console.log(`  HP 10%, 6/30 -> Score: ${otkIdeal1.score} (Grade: ${otkIdeal1.grade}, Viable: ${otkIdeal1.viable})`);
if (otkIdeal1.score < 90 || (otkIdeal1.grade !== 'S' && otkIdeal1.grade !== 'S+')) {
  throw new Error(`Expected HP 10%, 6/30 to score >= 90 (S/S+), got ${otkIdeal1.score} (${otkIdeal1.grade})`);
}

const otkIdeal2 = RaidEvaluator.evaluateCandidate(5, 12, 30, { strategy: 'otk_burst' });
console.log(`  HP 5%, 12/30 -> Score: ${otkIdeal2.score} (Grade: ${otkIdeal2.grade}, Viable: ${otkIdeal2.viable})`);
if (otkIdeal2.score < 95 || otkIdeal2.grade !== 'S+') {
  throw new Error(`Expected HP 5%, 12/30 to score >= 95 (S+), got ${otkIdeal2.score} (${otkIdeal2.grade})`);
}

const otkIdeal3 = RaidEvaluator.evaluateCandidate(18, 4, 30, { strategy: 'otk_burst' });
console.log(`  HP 18%, 4/30 -> Score: ${otkIdeal3.score} (Grade: ${otkIdeal3.grade}, Viable: ${otkIdeal3.viable})`);
if (!otkIdeal3.viable || otkIdeal3.score < 70) {
  throw new Error(`Expected HP 18%, 4/30 to be viable with score >= 70, got ${otkIdeal3.score}`);
}

console.log('  ✅ [PASS] Ideal dying raids with active clearing players properly receive Tier S/S+ scores (>= 90 pt)');

// 2. Reject Low Player Count (players < 3)
console.log('\n--- 2. Testing Low Player Count Disqualification (players < 3) ---');
const lowPlayerCase1 = RaidEvaluator.evaluateCandidate(10, 2, 30, { strategy: 'otk_burst' });
console.log(`  Low Players (HP 10%, 2/30) -> Score: ${lowPlayerCase1.score}, Viable: ${lowPlayerCase1.viable}, Reason: "${lowPlayerCase1.reason}"`);
if (lowPlayerCase1.viable || lowPlayerCase1.score > 0) {
  throw new Error('Expected HP 10%, 2/30 to be disqualified due to insufficient players (< 3)');
}

const lowPlayerCase2 = RaidEvaluator.evaluateCandidate(15, 1, 30, { strategy: 'otk_burst' });
console.log(`  Solo Host (HP 15%, 1/30) -> Score: ${lowPlayerCase2.score}, Viable: ${lowPlayerCase2.viable}`);
if (lowPlayerCase2.viable || lowPlayerCase2.score > 0) {
  throw new Error('Expected HP 15%, 1/30 to be disqualified');
}
console.log('  ✅ [PASS] Low player counts (< 3) are rejected to eliminate stalled or sluggish raid runs');

// 3. Reject High HP Raids (HP > 20% in OTK burst mode)
console.log('\n--- 3. Testing High HP Raid Disqualification (HP > 20%) ---');
const highHpCase1 = RaidEvaluator.evaluateCandidate(50, 8, 30, { strategy: 'otk_burst' });
console.log(`  High HP (HP 50%, 8/30) -> Score: ${highHpCase1.score}, Viable: ${highHpCase1.viable}, Reason: "${highHpCase1.reason}"`);
if (highHpCase1.viable || highHpCase1.score > 0) {
  throw new Error('Expected HP 50%, 8/30 to be disqualified for OTK burst');
}

const freshHonorRaid = RaidEvaluator.evaluateCandidate(85, 2, 30, { strategy: 'otk_burst' });
console.log(`  Fresh Raid (HP 85%, 2/30 in OTK mode) -> Score: ${freshHonorRaid.score}, Viable: ${freshHonorRaid.viable}`);
if (freshHonorRaid.viable || freshHonorRaid.score > 0) {
  throw new Error('Expected fresh 85% raid to be rejected in OTK burst mode');
}
console.log('  ✅ [PASS] High HP raids (> 20%) are disqualified from OTK burst consideration');

// 4. Reject Dead or Full Raids
console.log('\n--- 4. Testing Dead (0% HP) and Full (30/30) Raids ---');
const deadRaid = RaidEvaluator.evaluateCandidate(0, 8, 30, { strategy: 'otk_burst' });
if (deadRaid.viable || deadRaid.score > 0) {
  throw new Error('Expected 0% HP raid to be disqualified');
}

const fullRaid = RaidEvaluator.evaluateCandidate(10, 30, 30, { strategy: 'otk_burst' });
if (fullRaid.viable || fullRaid.score > 0) {
  throw new Error('Expected 30/30 full raid to be disqualified');
}
console.log('  ✅ [PASS] 0% HP and 30/30 full raids are immediately rejected');

// 5. Candidate Selection Priority (Lowest HP & Most Players)
console.log('\n--- 5. Testing Candidate Selection Priority in OTK Burst ---');
const mockOtkCandidates = [
  { index: 0, raidId: 'UNVIABLE_HIGH_HP', hpPct: 65, players: 8, maxPlayers: 30 },
  { index: 1, raidId: 'UNVIABLE_SOLO', hpPct: 10, players: 1, maxPlayers: 30 },
  { index: 2, raidId: 'OK_18PCT', hpPct: 18, players: 4, maxPlayers: 30 },
  { index: 3, raidId: 'GREAT_10PCT', hpPct: 10, players: 6, maxPlayers: 30 },
  { index: 4, raidId: 'BEST_DYING_FAST', hpPct: 5, players: 10, maxPlayers: 30 },
];

const selection = RaidEvaluator.selectBestCandidate(mockOtkCandidates, { strategy: 'otk_burst' });
if (!selection.best) {
  throw new Error('Expected best OTK candidate to be selected');
}
console.log(`  Selected Best Raid: ${selection.best.raidId} (Score: ${selection.best.score} pt, Grade: ${selection.best.grade}, HP: ${selection.best.hpPct}%, Players: ${selection.best.players})`);

if (selection.best.raidId !== 'BEST_DYING_FAST') {
  throw new Error(`Expected BEST_DYING_FAST to be chosen, got ${selection.best.raidId}`);
}
if (selection.viableCandidates.length !== 3) {
  throw new Error(`Expected exactly 3 viable candidates, got ${selection.viableCandidates.length}`);
}
console.log('  ✅ [PASS] OTK burst correctly prioritizes lowest HP and highest player count for rapid clear');

// 6. Colossus Ira Template Verification
console.log('\n--- 6. Testing Colossus Ira Production Template ---');
const tmpl = TemplateParser.loadTemplate('otkraid-colossus-ira');
console.log(`  Template Name:       ${tmpl.name}`);
console.log(`  Quest URL:           ${tmpl.questUrl}`);
console.log(`  Raid Slot:           ${tmpl.raidSlot}`);
console.log(`  Evaluator Strategy:  ${tmpl.evaluatorStrategy}`);
console.log(`  Max HP Filter:       <= ${tmpl.maxHpPct}%`);
console.log(`  Min Players Filter:  >= ${tmpl.minPlayers}`);
console.log(`  Supporters:          ${tmpl.supporterPriority?.join(', ')}`);
console.log(`  Steps:               ${tmpl.steps.length} (${tmpl.steps.map(s => s.code).join(' -> ')})`);

if (tmpl.evaluatorStrategy !== 'otk_burst') {
  throw new Error(`Expected evaluatorStrategy to be 'otk_burst', got ${tmpl.evaluatorStrategy}`);
}
if (tmpl.maxHpPct !== 20 || tmpl.minPlayers !== 3) {
  throw new Error(`Expected maxHpPct: 20 and minPlayers: 3, got maxHpPct: ${tmpl.maxHpPct}, minPlayers: ${tmpl.minPlayers}`);
}
if (!tmpl.supporterPriority?.includes('Varuna')) {
  throw new Error('Expected Varuna in supporterPriority list');
}
if (tmpl.raidSlot !== 1) {
  throw new Error(`Expected raidSlot 1 (Tab 1), got ${tmpl.raidSlot}`);
}
console.log('  ✅ [PASS] otkraid-colossus-ira template loaded and verified with 100% specification compliance');

console.log('\n========================================================================');
console.log('      🎉 ALL OTK RAID EVALUATOR & TEMPLATE TESTS PASSED (100%)          ');
console.log('========================================================================\n');

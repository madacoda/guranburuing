// tests/test-raid-evaluator-score.ts
import { RaidEvaluator } from '../src/engines/raid-evaluator.js';

console.log('========================================================================');
console.log('            Raid Evaluator & Score System Unit Test Suite               ');
console.log('========================================================================\n');

// Test 1: Ideal Raid (HP > 85%, players <= 2)
console.log('--- 1. Testing Ideal Raid Scoring (HP > 85%, players <= 2) ---');
const ideal1 = RaidEvaluator.evaluateCandidate(100, 1, 30);
console.log(`  HP 100%, 1/30 -> Score: ${ideal1.score} (Grade: ${ideal1.grade}, Viable: ${ideal1.viable})`);
if (ideal1.score < 95 || ideal1.grade !== 'S+') {
  throw new Error(`Expected HP 100%, 1/30 to score >= 95 (S+), got ${ideal1.score} (${ideal1.grade})`);
}

const ideal2 = RaidEvaluator.evaluateCandidate(86, 2, 30);
console.log(`  HP 86%, 2/30 -> Score: ${ideal2.score} (Grade: ${ideal2.grade}, Viable: ${ideal2.viable})`);
if (ideal2.score < 90 || (ideal2.grade !== 'S' && ideal2.grade !== 'S+')) {
  throw new Error(`Expected HP 86%, 2/30 to score >= 90 (S/S+), got ${ideal2.score} (${ideal2.grade})`);
}
console.log('  ✅ [PASS] Ideal candidates (HP > 85%, players <= 2) properly receive Tier S/S+ scores (>= 90 pt)');

// Test 2: Gradual Score Decrease
console.log('\n--- 2. Testing Gradual Score Decrease ---');
const raidA = RaidEvaluator.evaluateCandidate(80, 3, 30); // Grade A
const raidB = RaidEvaluator.evaluateCandidate(70, 4, 30); // Grade B
const raidC = RaidEvaluator.evaluateCandidate(50, 5, 30); // Grade C/B
console.log(`  HP 80%, 3/30 -> Score: ${raidA.score} (Grade: ${raidA.grade})`);
console.log(`  HP 70%, 4/30 -> Score: ${raidB.score} (Grade: ${raidB.grade})`);
console.log(`  HP 50%, 5/30 -> Score: ${raidC.score} (Grade: ${raidC.grade})`);

if (!(ideal2.score > raidA.score && raidA.score > raidB.score && raidB.score > raidC.score)) {
  throw new Error(`Expected monotonically decreasing scores: ${ideal2.score} > ${raidA.score} > ${raidB.score} > ${raidC.score}`);
}
console.log('  ✅ [PASS] Scores decrease gradually and predictably as HP decreases and player count increases');

// Test 3: Doomed Raid Rejection (HP < 30% and joined raid is 9)
console.log('\n--- 3. Testing Doomed Raid Disqualification ---');
const doomedUserCase = RaidEvaluator.evaluateCandidate(28, 9, 30);
console.log(`  User Case (HP 28%, 9/30) -> Score: ${doomedUserCase.score}, Viable: ${doomedUserCase.viable}, Reason: "${doomedUserCase.reason}"`);
if (doomedUserCase.viable || doomedUserCase.score > 0) {
  throw new Error(`Expected HP 28%, 9/30 to be completely disqualified (score 0, viable false), got ${doomedUserCase.score}`);
}

const doomedLowHp = RaidEvaluator.evaluateCandidate(5, 9, 30);
console.log(`  Run 8 Case (HP 5%, 9/30) -> Score: ${doomedLowHp.score}, Viable: ${doomedLowHp.viable}`);
if (doomedLowHp.viable || doomedLowHp.score > 0) {
  throw new Error(`Expected HP 5%, 9/30 to be disqualified, got ${doomedLowHp.score}`);
}

const doomedEnded = RaidEvaluator.evaluateCandidate(14, 13, 30);
console.log(`  Run 15 Case (HP 14%, 13/30) -> Score: ${doomedEnded.score}, Viable: ${doomedEnded.viable}`);
if (doomedEnded.viable || doomedEnded.score > 0) {
  throw new Error(`Expected HP 14%, 13/30 to be disqualified, got ${doomedEnded.score}`);
}
console.log('  ✅ [PASS] Low HP and high player count raids are immediately disqualified (viable: false)');

// Test 4: Blacklisted Raid ID
console.log('\n--- 4. Testing Blacklisted Raid IDs ---');
const blacklisted = RaidEvaluator.evaluateCandidate(95, 1, 30, { deadRaidIds: ['46968474756'] }, '46968474756');
if (blacklisted.viable || blacklisted.score > 0) {
  throw new Error('Expected blacklisted raid ID to have score 0 and viable false');
}
console.log('  ✅ [PASS] Blacklisted raid IDs are immediately rejected');

// Test 5: Candidate Selection Logic
console.log('\n--- 5. Testing selectBestCandidate Selection Priority ---');
const mockCandidates = [
  { index: 0, raidId: 'DEAD_LOW_HP', hpPct: 5, players: 9, maxPlayers: 30 },
  { index: 1, raidId: 'BAD_BURN_RATE', hpPct: 25, players: 9, maxPlayers: 30 },
  { index: 2, raidId: 'DECENT_MID_HP', hpPct: 65, players: 4, maxPlayers: 30 },
  { index: 3, raidId: 'PERFECT_FRESH', hpPct: 92, players: 2, maxPlayers: 30 },
  { index: 4, raidId: 'GOOD_HIGH_HP', hpPct: 78, players: 2, maxPlayers: 30 },
];

const selection = RaidEvaluator.selectBestCandidate(mockCandidates);
if (!selection.best) {
  throw new Error('Expected a best candidate to be selected');
}
console.log(`  Selected Best Raid: ${selection.best.raidId} with score ${selection.best.score} pt (Grade: ${selection.best.grade})`);
if (selection.best.raidId !== 'PERFECT_FRESH') {
  throw new Error(`Expected PERFECT_FRESH to be chosen, got ${selection.best.raidId}`);
}
if (selection.viableCandidates.length !== 3) {
  throw new Error(`Expected exactly 3 viable candidates, got ${selection.viableCandidates.length}`);
}
if (selection.nonViableCandidates.length !== 2) {
  throw new Error(`Expected exactly 2 non-viable candidates, got ${selection.nonViableCandidates.length}`);
}
console.log('  ✅ [PASS] selectBestCandidate accurately filters out unviable raids and prioritizes the highest scoring raid');

// Test 6: All Raids Unviable (Return null to trigger wait & refresh)
console.log('\n--- 6. Testing All Raids Unviable -> Wait & Refresh Trigger ---');
const allBadCandidates = [
  { index: 0, raidId: 'DEAD1', hpPct: 5, players: 9, maxPlayers: 30 },
  { index: 1, raidId: 'DEAD2', hpPct: 15, players: 12, maxPlayers: 30 },
  { index: 2, raidId: 'DEAD3', hpPct: 28, players: 9, maxPlayers: 30 },
];
const allBadSelection = RaidEvaluator.selectBestCandidate(allBadCandidates);
if (allBadSelection.best !== null) {
  throw new Error(`Expected null when all candidates are unviable, got ${allBadSelection.best?.raidId}`);
}
console.log('  ✅ [PASS] Returns null when all candidate raids are unviable, safely triggering search wait/refresh');

// Test 7: Customizable Min & Max HP Target Boundaries (Honor Strategy)
console.log('\n--- 7. Testing Customizable Min & Max HP Targets (Honor Strategy) ---');
const honorCustomMax = RaidEvaluator.evaluateCandidate(85, 2, 30, { maxHpPct: 70 });
console.log(`  HP 85%, maxHpPct=70 -> Viable: ${honorCustomMax.viable}, Reason: "${honorCustomMax.reason}"`);
if (honorCustomMax.viable || !honorCustomMax.reason.includes('above maximum threshold')) {
  throw new Error('Expected HP 85% to be disqualified when maxHpPct is 70% in honor strategy');
}

const honorCustomMin = RaidEvaluator.evaluateCandidate(40, 2, 30, { minHpPct: 50 });
console.log(`  HP 40%, minHpPct=50 -> Viable: ${honorCustomMin.viable}, Reason: "${honorCustomMin.reason}"`);
if (honorCustomMin.viable || !honorCustomMin.reason.includes('below minimum threshold')) {
  throw new Error('Expected HP 40% to be disqualified when minHpPct is 50% in honor strategy');
}

const honorCustomPass = RaidEvaluator.evaluateCandidate(60, 2, 30, { minHpPct: 50, maxHpPct: 70 });
console.log(`  HP 60%, minHpPct=50, maxHpPct=70 -> Score: ${honorCustomPass.score}, Viable: ${honorCustomPass.viable}`);
if (!honorCustomPass.viable) {
  throw new Error('Expected HP 60% to be viable within [50%, 70%] range in honor strategy');
}
console.log('  ✅ [PASS] Honor strategy strictly honors custom minHpPct and maxHpPct boundaries');

// Test 8: Customizable Min & Max HP Target Boundaries (Leech Strategy)
console.log('\n--- 8. Testing Customizable Min & Max HP Targets (Leech Strategy) ---');
const leechCustomMax = RaidEvaluator.evaluateCandidate(65, 5, 30, { strategy: 'leech', maxHpPct: 50 });
console.log(`  Leech HP 65%, maxHpPct=50 -> Viable: ${leechCustomMax.viable}, Reason: "${leechCustomMax.reason}"`);
if (leechCustomMax.viable || !leechCustomMax.reason.includes('exceeds maximum threshold')) {
  throw new Error('Expected Leech HP 65% to be disqualified when maxHpPct is 50%');
}

const leechCustomMin = RaidEvaluator.evaluateCandidate(10, 5, 30, { strategy: 'leech', minHpPct: 20 });
console.log(`  Leech HP 10%, minHpPct=20 -> Viable: ${leechCustomMin.viable}, Reason: "${leechCustomMin.reason}"`);
if (leechCustomMin.viable || !leechCustomMin.reason.includes('below minimum')) {
  throw new Error('Expected Leech HP 10% to be disqualified when minHpPct is 20%');
}

const leechCustomWide = RaidEvaluator.evaluateCandidate(50, 5, 30, { strategy: 'leech', minHpPct: 10, maxHpPct: 80, minPlayers: 3, minScore: 0 });
console.log(`  Leech HP 50%, minHpPct=10, maxHpPct=80 -> Score: ${leechCustomWide.score}, Viable: ${leechCustomWide.viable}`);
if (!leechCustomWide.viable || leechCustomWide.score <= 0) {
  throw new Error('Expected Leech HP 50% to be viable within customized [10%, 80%] range');
}
console.log('  ✅ [PASS] Leech strategy strictly honors custom minHpPct and maxHpPct boundaries with smooth scoring');

console.log('\n========================================================================');
console.log('      🎉 ALL RAID EVALUATOR SCORE TESTS PASSED (100%)                   ');
console.log('========================================================================\n');


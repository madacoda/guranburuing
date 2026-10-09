// tests/test-leech-evaluator.ts
import { RaidEvaluator } from '../src/engines/raid-evaluator.js';
import { TemplateParser } from '../src/templates/template-parser.js';

console.log('========================================================================');
console.log('        🌟 Magna 3 Leech Evaluator & 6-Element Unit Test Suite          ');
console.log('========================================================================\n');

// 1. Ideal Leech Candidates (HP <= 20% and players >= 3)
console.log('--- 1. Testing Ideal Leech Raids (HP <= 20%, players >= 3) with strategy="leech" ---');

const leechIdeal1 = RaidEvaluator.evaluateCandidate(10, 6, 30, { strategy: 'leech' });
console.log(`  HP 10%, 6/30 -> Score: ${leechIdeal1.score} (Grade: ${leechIdeal1.grade}, Viable: ${leechIdeal1.viable})`);
if (leechIdeal1.score < 90 || (leechIdeal1.grade !== 'S' && leechIdeal1.grade !== 'S+')) {
  throw new Error(`Expected HP 10%, 6/30 to score >= 90 (S/S+), got ${leechIdeal1.score} (${leechIdeal1.grade})`);
}

const leechIdeal2 = RaidEvaluator.evaluateCandidate(5, 12, 30, { strategy: 'leech' });
console.log(`  HP 5%, 12/30 -> Score: ${leechIdeal2.score} (Grade: ${leechIdeal2.grade}, Viable: ${leechIdeal2.viable})`);
if (leechIdeal2.score < 95 || leechIdeal2.grade !== 'S+') {
  throw new Error(`Expected HP 5%, 12/30 to score >= 95 (S+), got ${leechIdeal2.score} (${leechIdeal2.grade})`);
}

const leechIdeal3 = RaidEvaluator.evaluateCandidate(18, 4, 30, { strategy: 'leech' });
console.log(`  HP 18%, 4/30 -> Score: ${leechIdeal3.score} (Grade: ${leechIdeal3.grade}, Viable: ${leechIdeal3.viable})`);
if (!leechIdeal3.viable || leechIdeal3.score < 70) {
  throw new Error(`Expected HP 18%, 4/30 to be viable with score >= 70, got ${leechIdeal3.score}`);
}

console.log('  ✅ [PASS] Ideal dying raids with active clearing players properly receive Tier S/S+ scores (>= 90 pt)');

// 2. Reject Low Player Count (players < 3)
console.log('\n--- 2. Testing Low Player Count Disqualification (players < 3) ---');
const lowPlayerCase1 = RaidEvaluator.evaluateCandidate(10, 2, 30, { strategy: 'leech' });
console.log(`  Low Players (HP 10%, 2/30) -> Score: ${lowPlayerCase1.score}, Viable: ${lowPlayerCase1.viable}, Reason: "${lowPlayerCase1.reason}"`);
if (lowPlayerCase1.viable || lowPlayerCase1.score > 0) {
  throw new Error('Expected HP 10%, 2/30 to be disqualified due to insufficient players (< 3)');
}

const lowPlayerCase2 = RaidEvaluator.evaluateCandidate(15, 1, 30, { strategy: 'leech' });
console.log(`  Solo Host (HP 15%, 1/30) -> Score: ${lowPlayerCase2.score}, Viable: ${lowPlayerCase2.viable}`);
if (lowPlayerCase2.viable || lowPlayerCase2.score > 0) {
  throw new Error('Expected HP 15%, 1/30 to be disqualified');
}
console.log('  ✅ [PASS] Low player counts (< 3) are rejected to eliminate stalled or sluggish raid runs');

// 3. Reject High HP Raids (HP > 20% in Leech mode)
console.log('\n--- 3. Testing High HP Raid Disqualification (HP > 20%) ---');
const highHpCase1 = RaidEvaluator.evaluateCandidate(50, 8, 30, { strategy: 'leech' });
console.log(`  High HP (HP 50%, 8/30) -> Score: ${highHpCase1.score}, Viable: ${highHpCase1.viable}, Reason: "${highHpCase1.reason}"`);
if (highHpCase1.viable || highHpCase1.score > 0) {
  throw new Error('Expected HP 50%, 8/30 to be disqualified for leech');
}

const freshHonorRaid = RaidEvaluator.evaluateCandidate(85, 2, 30, { strategy: 'leech' });
console.log(`  Fresh Raid (HP 85%, 2/30 in Leech mode) -> Score: ${freshHonorRaid.score}, Viable: ${freshHonorRaid.viable}`);
if (freshHonorRaid.viable || freshHonorRaid.score > 0) {
  throw new Error('Expected fresh 85% raid to be rejected in leech mode');
}
console.log('  ✅ [PASS] High HP raids (> 20%) are disqualified from leech consideration');

// 4. Candidate Selection Priority (Lowest HP & Most Players)
console.log('\n--- 4. Testing Candidate Selection Priority in Leech ---');
const mockLeechCandidates = [
  { index: 0, raidId: 'UNVIABLE_HIGH_HP', hpPct: 65, players: 8, maxPlayers: 30 },
  { index: 1, raidId: 'UNVIABLE_SOLO', hpPct: 10, players: 1, maxPlayers: 30 },
  { index: 2, raidId: 'OK_18PCT', hpPct: 18, players: 4, maxPlayers: 30 },
  { index: 3, raidId: 'GREAT_10PCT', hpPct: 10, players: 6, maxPlayers: 30 },
  { index: 4, raidId: 'BEST_DYING_FAST', hpPct: 5, players: 10, maxPlayers: 30 },
];

const selection = RaidEvaluator.selectBestCandidate(mockLeechCandidates, { strategy: 'leech' });
if (!selection.best) {
  throw new Error('Expected best Leech candidate to be selected');
}
console.log(`  Selected Best Raid: ${selection.best.raidId} (Score: ${selection.best.score} pt, Grade: ${selection.best.grade}, HP: ${selection.best.hpPct}%, Players: ${selection.best.players})`);

if (selection.best.raidId !== 'BEST_DYING_FAST') {
  throw new Error(`Expected BEST_DYING_FAST to be chosen, got ${selection.best.raidId}`);
}
if (selection.viableCandidates.length !== 3) {
  throw new Error(`Expected exactly 3 viable candidates, got ${selection.viableCandidates.length}`);
}
console.log('  ✅ [PASS] Leech strategy correctly prioritizes lowest HP and highest player count for rapid clear');

// 5. Verification of All 6 Magna 3 Leech Templates & Primal Summons
console.log('\n--- 5. Testing All 6 Magna 3 Leech Templates (Primal Summons) ---');

const m3LeechConfig = [
  {
    templateName: 'leech-colossus-ira',
    bossName: 'Colossus Ira (Fire)',
    expectedPrimal: 'Varuna',
    expectedStrategy: 'leech'
  },
  {
    templateName: 'leech-tiamat-aura',
    bossName: 'Tiamat Aura (Wind)',
    expectedPrimal: 'Agni',
    expectedStrategy: 'leech'
  },
  {
    templateName: 'leech-leviathan-mare',
    bossName: 'Leviathan Mare (Water)',
    expectedPrimal: 'Titan',
    expectedStrategy: 'leech'
  },
  {
    templateName: 'leech-yggdrasil-arbos',
    bossName: 'Yggdrasil Arbos (Earth)',
    expectedPrimal: 'Zephyrus',
    expectedStrategy: 'leech'
  },
  {
    templateName: 'leech-luminiera-credo',
    bossName: 'Luminiera Credo (Light)',
    expectedPrimal: 'Hades',
    expectedStrategy: 'leech'
  },
  {
    templateName: 'leech-celeste-ater',
    bossName: 'Celeste Ater (Dark)',
    expectedPrimal: 'Zeus',
    expectedStrategy: 'leech'
  }
];

for (const cfg of m3LeechConfig) {
  console.log(`\n• Inspecting ${cfg.templateName} [Boss: ${cfg.bossName}]:`);
  const tmpl = TemplateParser.loadTemplate(cfg.templateName);

  console.log(`  - Name:               ${tmpl.name}`);
  console.log(`  - Strategy:           ${tmpl.evaluatorStrategy}`);
  console.log(`  - Supporter Priority: ${tmpl.supporterPriority?.join(', ')}`);
  console.log(`  - HP / Player Filter: HP <= ${tmpl.maxHpPct}%, Players >= ${tmpl.minPlayers}`);
  console.log(`  - Speed & Automation: Speed: ${tmpl.speedProfile}, Auto-Berry: ${tmpl.autoBerry}, Human: ${tmpl.humanMotor}`);
  console.log(`  - Pipeline Steps (${tmpl.steps.length}): ${tmpl.steps.map(s => s.code).join(' -> ')}`);

  if (tmpl.evaluatorStrategy !== cfg.expectedStrategy) {
    throw new Error(`Expected evaluatorStrategy "${cfg.expectedStrategy}", got "${tmpl.evaluatorStrategy}"`);
  }
  if (!tmpl.supporterPriority || tmpl.supporterPriority.length !== 1 || tmpl.supporterPriority[0] !== cfg.expectedPrimal) {
    throw new Error(`Expected supporterPriority to strictly be ["${cfg.expectedPrimal}"], got ${JSON.stringify(tmpl.supporterPriority)}`);
  }
  if (tmpl.maxHpPct !== 20 || tmpl.minPlayers !== 3) {
    throw new Error(`Expected maxHpPct: 20 and minPlayers: 3, got maxHpPct: ${tmpl.maxHpPct}, minPlayers: ${tmpl.minPlayers}`);
  }
  if (tmpl.raidSlot !== 1) {
    throw new Error(`Expected raidSlot 1, got ${tmpl.raidSlot}`);
  }
  if (!tmpl.autoBerry) {
    throw new Error(`Expected autoBerry: true`);
  }
  if (tmpl.steps.length < 4 || tmpl.steps[0].code !== 'quick_call' || tmpl.steps[2].code !== 'attack') {
    throw new Error(`Unexpected step pipeline for leech template`);
  }

  console.log(`  ✅ [PASS] ${cfg.templateName} verified with 100% compliance!`);
}

// 6. Backward-Compatibility Alias Resolution
console.log('\n--- 6. Testing Backwards-Compatibility Alias Resolution ---');
const legacyColossus = TemplateParser.loadTemplate('otkraid-colossus-ira');
if (legacyColossus.name !== 'Leech Raid - Colossus Ira (Fast Leech)' || legacyColossus.supporterPriority?.[0] !== 'Varuna') {
  throw new Error('Expected "otkraid-colossus-ira" to resolve cleanly to "leech-colossus-ira"');
}
console.log(`  "otkraid-colossus-ira" resolved -> "${legacyColossus.name}" (Supporter: ${legacyColossus.supporterPriority?.[0]})`);

const legacyTiamat = TemplateParser.loadTemplate('otkraid-tiamat-aura');
if (legacyTiamat.name !== 'Leech Raid - Tiamat Aura (Fast Leech)' || legacyTiamat.supporterPriority?.[0] !== 'Agni') {
  throw new Error('Expected "otkraid-tiamat-aura" to resolve cleanly to "leech-tiamat-aura"');
}
console.log(`  "otkraid-tiamat-aura" resolved -> "${legacyTiamat.name}" (Supporter: ${legacyTiamat.supporterPriority?.[0]})`);

console.log('  ✅ [PASS] Legacy otkraid-* identifiers dynamically map to leech-* templates');

console.log('\n========================================================================');
console.log('   🎉 ALL MAGNA 3 LEECH EVALUATOR & TEMPLATE TESTS PASSED (100%)       ');
console.log('========================================================================\n');

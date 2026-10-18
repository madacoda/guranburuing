// tests/test-farm-evaluator.ts
import assert from 'assert';
import { RaidEvaluator } from '../src/engines/raid-evaluator.js';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { resolveFarmTemplateName } from '../src/cli/run-farm.js';

console.log('========================================================================');
console.log('   🌟 Leviathan Mare Farm Evaluator & Adaptive Strategy Test Suite      ');
console.log('========================================================================\n');

// 1. Ideal Farm Candidates (Broad HP window + High Player Density)
console.log('--- 1. Testing Ideal Farm Raids (High Players & Low-to-Mid HP) with strategy="farm" ---');

const farmIdeal1 = RaidEvaluator.evaluateCandidate(10, 15, 30, { strategy: 'farm' });
console.log(`  HP 10%, 15/30 -> Score: ${farmIdeal1.score} (Grade: ${farmIdeal1.grade}, Viable: ${farmIdeal1.viable})`);
assert(farmIdeal1.viable, 'HP 10%, 15/30 must be viable in farm mode');
assert(farmIdeal1.score >= 90, `Expected score >= 90 (Grade S/S+), got ${farmIdeal1.score}`);
assert(farmIdeal1.grade === 'S' || farmIdeal1.grade === 'S+', `Expected S or S+, got ${farmIdeal1.grade}`);

const farmIdeal2 = RaidEvaluator.evaluateCandidate(40, 20, 30, { strategy: 'farm' });
console.log(`  HP 40%, 20/30 -> Score: ${farmIdeal2.score} (Grade: ${farmIdeal2.grade}, Viable: ${farmIdeal2.viable})`);
assert(farmIdeal2.viable, 'HP 40%, 20/30 must be viable in farm mode');
assert(farmIdeal2.score >= 80, `Expected score >= 80, got ${farmIdeal2.score}`);
assert(farmIdeal2.grade === 'A' || farmIdeal2.grade === 'S' || farmIdeal2.grade === 'S+', `Expected A/S/S+, got ${farmIdeal2.grade}`);

const farmIdeal3 = RaidEvaluator.evaluateCandidate(60, 25, 30, { strategy: 'farm' });
console.log(`  HP 60%, 25/30 -> Score: ${farmIdeal3.score} (Grade: ${farmIdeal3.grade}, Viable: ${farmIdeal3.viable})`);
assert(farmIdeal3.viable, 'HP 60%, 25/30 must be viable in farm mode (many players ensure fast melt)');
assert(farmIdeal3.score >= 70, `Expected score >= 70, got ${farmIdeal3.score}`);

console.log('  ✅ [PASS] Highly-joined raids across 10%-60% HP receive Tier A/S/S+ scores (fast clear guaranteed)\n');

// 2. Player Count Sensitivity ("Most Joined" Factor)
console.log('--- 2. Testing Player Count Sensitivity & Disqualification ---');

const swarmRaid = RaidEvaluator.evaluateCandidate(50, 20, 30, { strategy: 'farm' });
const fewPlayerRaid = RaidEvaluator.evaluateCandidate(50, 2, 30, { strategy: 'farm' });
console.log(`  Swarm Raid (HP 50%, 20/30) -> Score: ${swarmRaid.score} pt (Grade ${swarmRaid.grade})`);
console.log(`  Few Players (HP 50%, 2/30)  -> Score: ${fewPlayerRaid.score} pt (Grade ${fewPlayerRaid.grade})`);
assert(swarmRaid.score > fewPlayerRaid.score + 30, 'Swarm raid must score significantly higher than few players raid');

const soloRaid = RaidEvaluator.evaluateCandidate(50, 1, 30, { strategy: 'farm' });
console.log(`  Solo Host   (HP 50%, 1/30)  -> Viable: ${soloRaid.viable}, Reason: "${soloRaid.reason}"`);
assert(!soloRaid.viable, 'Solo host at 50% HP must be disqualified (risk of stalled raid)');

console.log('  ✅ [PASS] Player count strongly drives score; solo sluggish raids are disqualified\n');

// 3. Lowest HP Consideration Among Joined Raids
console.log('--- 3. Testing Lowest HP Consideration Among Raids with Equal Players ---');

const lowHpRaid = RaidEvaluator.evaluateCandidate(15, 12, 30, { strategy: 'farm' });
const midHpRaid = RaidEvaluator.evaluateCandidate(45, 12, 30, { strategy: 'farm' });
const highHpRaid = RaidEvaluator.evaluateCandidate(80, 12, 30, { strategy: 'farm' });

console.log(`  HP 15%, 12/30 -> Score: ${lowHpRaid.score} pt`);
console.log(`  HP 45%, 12/30 -> Score: ${midHpRaid.score} pt`);
console.log(`  HP 80%, 12/30 -> Score: ${highHpRaid.score} pt`);

assert(lowHpRaid.score > midHpRaid.score, 'Lower HP must score higher to ensure faster raid clear');
assert(midHpRaid.score > highHpRaid.score, 'Mid HP must score higher than high HP');

console.log('  ✅ [PASS] Lower HP cleanly yields higher score for faster clear turnaround\n');

// 4. Adaptive Candidate Selection (Preventing Idle Standby)
console.log('--- 4. Testing Adaptive Candidate Degradation (Zero Standby Idle) ---');

const moderateRaids = [
  { index: 0, raidId: 'RAID_MID_PLAYERS', hpPct: 65, players: 12, maxPlayers: 30 },
  { index: 1, raidId: 'RAID_MOST_JOINED', hpPct: 55, players: 22, maxPlayers: 30 },
  { index: 2, raidId: 'RAID_FEW_PLAYERS', hpPct: 20, players: 2, maxPlayers: 30 },
];

// If strict minScore is 85 (Grade S+ / S required)
const strictSelection = RaidEvaluator.selectBestCandidate(moderateRaids, {
  strategy: 'farm',
  minScore: 85,
  adaptive: false
});
assert.strictEqual(strictSelection.best, null, 'Without adaptive, strict minScore 85 should return null');
console.log('  Without adaptive (minScore: 85): 0 candidates viable (would enter 60s-300s standby)');

// With adaptive: true, it gracefully selects the best most-joined candidate!
const adaptiveSelection = RaidEvaluator.selectBestCandidate(moderateRaids, {
  strategy: 'farm',
  minScore: 85,
  adaptive: true
});

assert(adaptiveSelection.best !== null, 'With adaptive: true, best candidate must NOT be null');
console.log(`  With adaptive: true -> Selected Raid: ${adaptiveSelection.best.raidId} (${adaptiveSelection.best.players}/30 players, HP ${adaptiveSelection.best.hpPct}%)`);
console.log(`  Selection Reason: "${adaptiveSelection.best.reason}"`);

assert.strictEqual(
  adaptiveSelection.best.raidId,
  'RAID_MOST_JOINED',
  'Adaptive fallback must select the most-joined active raid (22 players) to prevent idle waiting'
);
assert(adaptiveSelection.best.viable, 'Adaptively selected candidate must be marked viable');

console.log('  ✅ [PASS] Adaptive candidate degradation picks the most-joined raid, eliminating idle standby\n');

// 5. Sorting Behavior for Farm Strategy
console.log('--- 5. Testing Candidate Selection Priority in Farm ---');

const mixedCandidates = [
  { index: 0, raidId: 'SLUGGISH_SOLO', hpPct: 75, players: 1, maxPlayers: 30 },
  { index: 1, raidId: 'ACTIVE_18P_40HP', hpPct: 40, players: 18, maxPlayers: 30 },
  { index: 2, raidId: 'SWARM_24P_50HP', hpPct: 50, players: 24, maxPlayers: 30 },
  { index: 3, raidId: 'LOWHP_5P_15HP', hpPct: 15, players: 5, maxPlayers: 30 },
];

const farmSelection = RaidEvaluator.selectBestCandidate(mixedCandidates, { strategy: 'farm' });
assert(farmSelection.best !== null, 'Expected best farm candidate to be chosen');
console.log(`  Best Candidate Selected: ${farmSelection.best.raidId} (Score: ${farmSelection.best.score} pt, Grade: ${farmSelection.best.grade})`);

// Active 18p/40hp or Swarm 24p/50hp should beat solo or low player raids
assert(
  farmSelection.best.raidId === 'ACTIVE_18P_40HP' || farmSelection.best.raidId === 'SWARM_24P_50HP',
  `Expected high-player active raid, got ${farmSelection.best.raidId}`
);

console.log('  ✅ [PASS] Farm sorting prioritizes high player density and clear speed\n');

// 6. Template Validation & Structure
console.log('--- 6. Verifying farm-leviathan-mare.json Template ---');

const farmLeviTemplate = TemplateParser.loadTemplate('farm-leviathan-mare');
assert(farmLeviTemplate, 'Template farm-leviathan-mare must load successfully');

console.log(`  Name:               ${farmLeviTemplate.name}`);
console.log(`  Strategy:           ${farmLeviTemplate.evaluatorStrategy}`);
console.log(`  Adaptive:           ${farmLeviTemplate.adaptive}`);
console.log(`  Supporter Priority: ${farmLeviTemplate.supporterPriority?.join(', ')}`);
console.log(`  Target Boss:        ${farmLeviTemplate.targetEnemy} (${farmLeviTemplate.element})`);
console.log(`  HP Range:           ${farmLeviTemplate.minHpPct}% to ${farmLeviTemplate.maxHpPct}%`);
console.log(`  Players Filter:     >= ${farmLeviTemplate.minPlayers} players`);
console.log(`  Pipeline Steps:     ${farmLeviTemplate.steps.length} steps`);

const validation = validateWorkflowTemplate(farmLeviTemplate);
assert(validation.valid, `farm-leviathan-mare schema validation failed: ${validation.errors.join(', ')}`);
assert.strictEqual(farmLeviTemplate.evaluatorStrategy, 'farm', 'evaluatorStrategy must be "farm"');
assert.strictEqual(farmLeviTemplate.adaptive, true, 'adaptive must be true');
assert.strictEqual(farmLeviTemplate.element, 'Earth', 'element must be "Earth"');
assert.strictEqual(farmLeviTemplate.targetEnemy, 'Leviathan Mare', 'targetEnemy must be "Leviathan Mare"');

const validCodes = new Set([
  'wait_element', 'reload', 'skill', 'summon', 'attack', 'confirm_result'
]);
for (const step of farmLeviTemplate.steps) {
  assert(validCodes.has(step.code), `Unexpected step code: ${step.code}`);
}

console.log('  ✅ [PASS] farm-leviathan-mare.json schema and pipeline 100% compliant\n');

// 7. Shorthand & Canonical Alias Resolution
console.log('--- 7. Testing CLI Shorthand & Canonical Alias Resolution ---');

assert.strictEqual(resolveFarmTemplateName('levi'), 'farm-leviathan-mare');
assert.strictEqual(resolveFarmTemplateName('leviathan'), 'farm-leviathan-mare');
assert.strictEqual(resolveFarmTemplateName('mare'), 'farm-leviathan-mare');
assert.strictEqual(resolveFarmTemplateName('leviathan-mare'), 'farm-leviathan-mare');
console.log('  resolveFarmTemplateName("levi") -> "farm-leviathan-mare"');

const aliasLoaded = TemplateParser.loadTemplate('farm-leviathan');
assert(aliasLoaded, 'TemplateParser must resolve canonical alias "farm-leviathan"');
assert.strictEqual(aliasLoaded.name, farmLeviTemplate.name, 'Canonical alias must match template');

const aliasLoaded2 = TemplateParser.loadTemplate('farm-levi');
assert(aliasLoaded2, 'TemplateParser must resolve canonical alias "farm-levi"');

console.log('  TemplateParser.loadTemplate("farm-leviathan") -> successfully resolved');
console.log('  TemplateParser.loadTemplate("farm-levi")      -> successfully resolved');

console.log('\n========================================================================');
console.log('   🎉 ALL LEVIATHAN FARM EVALUATOR & ADAPTIVE TESTS PASSED (100%)       ');
console.log('========================================================================\n');

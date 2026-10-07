// tests/test-raid-evaluator-parallel.ts
import {
  RaidEvaluator,
  RaidEvaluationCache,
  RaidDisqualificationReason,
  RaidCandidate,
  RaidEvaluationOptions
} from '../src/engines/raid-evaluator.js';

console.log('========================================================================');
console.log('     Raid Evaluator Parallel & High-Performance Unit Test Suite         ');
console.log('========================================================================\n');

// 1. Test checkConditionsParallel (Parallel Condition Checking)
console.log('--- 1. Testing checkConditionsParallel (Multi-Condition Concurrency) ---');
const testCandidate: RaidCandidate = {
  index: 0,
  raidId: 'raid_parallel_1',
  hpPct: 15,
  players: 6,
  maxPlayers: 30
};

const condHp = async (c: RaidCandidate) => c.hpPct <= 20;
const condPlayers = async (c: RaidCandidate) => c.players >= 3;
const condAsyncApi = async (c: RaidCandidate) => {
  await new Promise(r => setTimeout(r, 5)); // simulated async check
  return c.maxPlayers === 30;
};

const checkSuccess = await RaidEvaluator.checkConditionsParallel(testCandidate, [condHp, condPlayers, condAsyncApi]);
if (!checkSuccess.passed || checkSuccess.results.length !== 3 || !checkSuccess.results.every(Boolean)) {
  throw new Error('Expected all 3 parallel conditions to pass');
}
console.log('  ✅ [PASS] 3 independent conditions evaluated concurrently and passed');

// Failing condition test
const condFailing = async () => false;
const checkFailure = await RaidEvaluator.checkConditionsParallel(testCandidate, [condHp, condFailing, condPlayers]);
if (checkFailure.passed || checkFailure.failedIndex !== 1) {
  throw new Error(`Expected condition #1 to fail, got passed: ${checkFailure.passed}, failedIndex: ${checkFailure.failedIndex}`);
}
console.log('  ✅ [PASS] Failed condition properly flagged with exact index in parallel execution');

// 2. Test evaluateCandidatesParallel (Batch Parallel Evaluation)
console.log('\n--- 2. Testing evaluateCandidatesParallel with Concurrency Chunking ---');
const mockBatch: RaidCandidate[] = [
  { index: 0, raidId: 'batch_1', hpPct: 8, players: 8, maxPlayers: 30 },
  { index: 1, raidId: 'batch_2', hpPct: 5, players: 14, maxPlayers: 30 },
  { index: 2, raidId: 'batch_3', hpPct: 90, players: 1, maxPlayers: 30 },
  { index: 3, raidId: 'batch_4', hpPct: 50, players: 8, maxPlayers: 30 },
  { index: 4, raidId: 'batch_5', hpPct: 12, players: 4, maxPlayers: 30 },
];

const parallelEvaluated = await RaidEvaluator.evaluateCandidatesParallel(
  mockBatch,
  { strategy: 'otk_burst' },
  { concurrency: 2 } // test chunking
);

if (parallelEvaluated.length !== 5) {
  throw new Error(`Expected 5 evaluated candidates, got ${parallelEvaluated.length}`);
}
if (!parallelEvaluated[0].viable || !parallelEvaluated[1].viable || parallelEvaluated[2].viable) {
  throw new Error('OTK viability mismatch in parallel candidate evaluation');
}
console.log('  ✅ [PASS] Chunked parallel batch evaluation accurately evaluated all candidates');

// 3. Test selectBestCandidateParallel
console.log('\n--- 3. Testing selectBestCandidateParallel (Parallel Selection & Sort) ---');
const parallelSelection = await RaidEvaluator.selectBestCandidateParallel(
  mockBatch,
  { strategy: 'otk_burst' }
);

if (!parallelSelection.best || parallelSelection.best.raidId !== 'batch_2') {
  throw new Error(`Expected batch_2 to be selected as best OTK candidate, got ${parallelSelection.best?.raidId}`);
}
if (parallelSelection.viableCandidates.length !== 3) {
  throw new Error(`Expected 3 viable candidates, got ${parallelSelection.viableCandidates.length}`);
}
console.log(`  Selected Best: ${parallelSelection.best.raidId} with score ${parallelSelection.best.score} pt (Grade ${parallelSelection.best.grade})`);
console.log('  ✅ [PASS] selectBestCandidateParallel correctly ranked candidates in parallel');

// 4. Test evaluateMultiSlotParallel (Multi-Assist Tabs Concurrency)
console.log('\n--- 4. Testing evaluateMultiSlotParallel (Assist Tabs 1-4 Concurrency) ---');
const assistSlots: Record<number, RaidCandidate[]> = {
  1: [ // Colossus Ira (OTK Burst)
    { index: 0, raidId: 'colossus_slow', hpPct: 60, players: 2, maxPlayers: 30 },
    { index: 1, raidId: 'colossus_fast', hpPct: 6, players: 10, maxPlayers: 30 }
  ],
  2: [ // Grand Order (Honor)
    { index: 0, raidId: 'go_fresh', hpPct: 95, players: 1, maxPlayers: 30 }
  ],
  3: [ // Akasha (Honor)
    { index: 0, raidId: 'akasha_mid', hpPct: 70, players: 4, maxPlayers: 30 }
  ],
  4: [ // PBHL (Honor)
    { index: 0, raidId: 'pbhl_fresh', hpPct: 99, players: 1, maxPlayers: 30 }
  ]
};

const multiSlotOptions: Record<number, RaidEvaluationOptions> = {
  1: { strategy: 'otk_burst', maxHpPct: 20, minPlayers: 3 },
  2: { strategy: 'honor' },
  3: { strategy: 'honor' },
  4: { strategy: 'honor' }
};

const multiSlotResult = await RaidEvaluator.evaluateMultiSlotParallel(assistSlots, multiSlotOptions);

console.log('  Slot 1 Best:', multiSlotResult.slotResults[1]?.best?.raidId);
console.log('  Slot 2 Best:', multiSlotResult.slotResults[2]?.best?.raidId);
console.log('  Slot 3 Best:', multiSlotResult.slotResults[3]?.best?.raidId);
console.log('  Slot 4 Best:', multiSlotResult.slotResults[4]?.best?.raidId);
console.log(`  Global Best: Slot ${multiSlotResult.globalBest?.slot} -> ${multiSlotResult.globalBest?.raidId} (${multiSlotResult.globalBest?.score} pt)`);

if (multiSlotResult.slotResults[1]?.best?.raidId !== 'colossus_fast') {
  throw new Error('Expected Slot 1 best to be colossus_fast');
}
if (multiSlotResult.slotResults[4]?.best?.raidId !== 'pbhl_fresh') {
  throw new Error('Expected Slot 4 best to be pbhl_fresh');
}
if (!multiSlotResult.globalBest) {
  throw new Error('Expected global best candidate across all slots');
}
console.log('  ✅ [PASS] evaluateMultiSlotParallel concurrently evaluated 4 assist slots and resolved slot + global best');

// 5. Test Disqualification Bitmask Flags
console.log('\n--- 5. Testing Disqualification Bitmask Flags (RaidDisqualificationReason) ---');
const blacklistedRes = RaidEvaluator.evaluateCandidate(90, 1, 30, { deadRaidIds: ['dead_123'] }, 'dead_123');
if (!(blacklistedRes.details.flags! & RaidDisqualificationReason.BLACKLISTED)) {
  throw new Error('Expected BLACKLISTED bitmask flag to be set');
}

const fullRes = RaidEvaluator.evaluateCandidate(10, 30, 30, { strategy: 'otk_burst' });
if (!(fullRes.details.flags! & RaidDisqualificationReason.FULL)) {
  throw new Error('Expected FULL bitmask flag to be set');
}

const lowHpRes = RaidEvaluator.evaluateCandidate(10, 2, 30); // in honor mode, minHp is 25
if (!(lowHpRes.details.flags! & RaidDisqualificationReason.HP_BELOW_MIN)) {
  throw new Error('Expected HP_BELOW_MIN bitmask flag to be set');
}

console.log('  Blacklisted Flags:', blacklistedRes.details.flagsSummary);
console.log('  Full Flags:       ', fullRes.details.flagsSummary);
console.log('  Low HP Flags:     ', lowHpRes.details.flagsSummary);
console.log('  ✅ [PASS] Disqualification bitmask flags accurately assigned for ultra-fast filtering');

// 6. Test In-Memory LRU Evaluation Cache
console.log('\n--- 6. Testing In-Memory LRU Evaluation Cache (RaidEvaluationCache) ---');
RaidEvaluator.clearCache();
if (RaidEvaluator.getCacheStats().size !== 0) {
  throw new Error('Expected cache size to be 0 after clear');
}

// First call: Populates cache
const eval1 = RaidEvaluator.evaluateCandidate(85, 2, 30, { useCache: true }, 'cache_raid_1');
if (RaidEvaluator.getCacheStats().size !== 1) {
  throw new Error(`Expected cache size to be 1, got ${RaidEvaluator.getCacheStats().size}`);
}

// Second call: Hits cache (exact instance reference returned)
const eval2 = RaidEvaluator.evaluateCandidate(85, 2, 30, { useCache: true }, 'cache_raid_1');
if (eval1 !== eval2) {
  throw new Error('Expected identical object reference from cache hit');
}
console.log(`  Cache Size: ${RaidEvaluator.getCacheStats().size}/${RaidEvaluator.getCacheStats().maxEntries}`);
console.log('  ✅ [PASS] Memoization cache successfully serves identical candidate evaluations in O(1) time');

// 7. Test NormalizeDeadIds with Map, Set, and Array
console.log('\n--- 7. Testing normalizeDeadIds Flexibility (Map, Set, Array) ---');
const mapIds = new Map<string, number>([['m1', 1], ['m2', 2]]);
const setIds = new Set<string>(['s1', 's2']);
const arrIds = ['a1', 'a2'];

const normMap = RaidEvaluator.normalizeDeadIds(mapIds);
const normSet = RaidEvaluator.normalizeDeadIds(setIds);
const normArr = RaidEvaluator.normalizeDeadIds(arrIds);

if (!normMap.has('m1') || !normSet.has('s1') || !normArr.has('a1')) {
  throw new Error('Expected all normalized dead ID collections to contain test keys');
}
console.log('  ✅ [PASS] normalizeDeadIds transparently handles Map, Set, and Array inputs with zero friction');

console.log('\n========================================================================');
console.log('   🎉 ALL RAID EVALUATOR PARALLEL TESTS PASSED (100% GOLD STANDARD)     ');
console.log('========================================================================\n');

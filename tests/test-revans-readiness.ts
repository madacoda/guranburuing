// tests/test-revans-readiness.ts
import assert from 'assert';
import {
  ALL_REVANS_RAID_IDS,
  RevansReadinessCheckerService
} from '../src/services/combat/revans-readiness-checker.service.js';

async function runTests() {
  console.log('=== Running Universal Revans Series (Impossible) Lv275 Readiness Tests ===');

  const checker = new RevansReadinessCheckerService();
  const catalog = checker.getCatalog();

  // 1. Catalog completeness across all 6 Revans raids
  assert.strictEqual(
    ALL_REVANS_RAID_IDS.length,
    6,
    'Must cover all 6 Revans Series Lv275 raids'
  );

  const expectedMeta: Record<
    string,
    { questId: string; stageId: string; bossEl: string; advEl: string }
  > = {
    mugen: { questId: '305381', stageId: '12069', bossEl: 'fire', advEl: 'water' },
    diaspora: { questId: '305391', stageId: '12070', bossEl: 'water', advEl: 'earth' },
    siegfried: { questId: '305401', stageId: '12071', bossEl: 'earth', advEl: 'wind' },
    siete: { questId: '305411', stageId: '12072', bossEl: 'wind', advEl: 'fire' },
    cosmos: { questId: '305421', stageId: '12073', bossEl: 'light', advEl: 'dark' },
    agastia: { questId: '305431', stageId: '12074', bossEl: 'dark', advEl: 'light' }
  };

  for (const raidId of ALL_REVANS_RAID_IDS) {
    const entry = catalog.raids[raidId];
    assert.ok(entry, `Catalog entry missing for ${raidId}`);
    assert.strictEqual(entry.questId, expectedMeta[raidId].questId);
    assert.strictEqual(entry.stageId, expectedMeta[raidId].stageId);
    assert.strictEqual(entry.bossElement, expectedMeta[raidId].bossEl);
    assert.strictEqual(entry.advantageousElement, expectedMeta[raidId].advEl);
    assert.strictEqual(entry.blueChestTargetHonors, 4000000);
    assert.ok(entry.characterRegistry.length >= 5);
    assert.ok(entry.weaponRegistry.length >= 4);
    assert.ok(entry.summonRegistry.length >= 3);
    assert.ok(entry.archetypes.length >= 1);
  }
  console.log('  [PASS] All 6 Revans catalog entries verified (Quest IDs 305381..305431, Stage IDs 12069..12074).');

  // 2. Alias resolution
  assert.strictEqual(RevansReadinessCheckerService.resolveRaidId('agastia'), 'agastia');
  assert.strictEqual(RevansReadinessCheckerService.resolveRaidId('MUGEN'), 'mugen');
  assert.strictEqual(RevansReadinessCheckerService.resolveRaidId('seofon'), 'siete');
  assert.strictEqual(RevansReadinessCheckerService.resolveRaidId('sieg'), 'siegfried');
  assert.strictEqual(RevansReadinessCheckerService.resolveRaidId('all'), 'all');
  console.log('  [PASS] Raid alias resolution verified.');

  // 3. Evaluate reference 6-element roster (acc1 snapshot)
  const multiRoster = checker.loadMultiElementRosterFromFile(
    'data/combat/revans-roster.example.json'
  );
  const summary = checker.evaluateAllRaids(multiRoster);

  assert.strictEqual(summary.totalRaidsEvaluated, 6);
  assert.strictEqual(
    summary.readyRaidsCount,
    6,
    'Reference acc1 6-element roster should be 4M Blue Chest ready across all 6 Revans raids'
  );

  for (const raidId of ALL_REVANS_RAID_IDS) {
    const r = summary.raidReports[raidId];
    assert.ok(
      r.overallReadinessScore >= 90,
      `Expected ${raidId} readiness score >= 90 on acc1 roster, got ${r.overallReadinessScore}`
    );
    assert.ok(
      r.overallGrade === 'SSS' || r.overallGrade === 'SS',
      `Expected ${raidId} grade SSS or SS, got ${r.overallGrade}`
    );
    assert.strictEqual(r.allCriticalGatesPassed, true);
    assert.strictEqual(r.readyFor4MBlueChest, true);
  }
  console.log(
    `  [PASS] Full 6-raid evaluation passed (6/6 Ready, Average Score: ${summary.averageReadinessScore}/100).`
  );

  // 4. Hard-Gate failure test (under-HP Mugen Water party)
  const lowHpRoster = JSON.parse(JSON.stringify(multiRoster));
  lowHpRoster.elements.water.estimatedPartyHp = 42000; // Below Mugen's 60,000 HP gate
  const lowHpMugenReport = checker.evaluateSingleRaid('mugen', lowHpRoster);
  assert.strictEqual(lowHpMugenReport.allCriticalGatesPassed, false);
  assert.strictEqual(lowHpMugenReport.overallGrade, 'NOT_READY');
  assert.strictEqual(lowHpMugenReport.readyFor4MBlueChest, false);
  console.log('  [PASS] Hard-gate blocker enforcement verified (under-HP Mugen Water party -> NOT_READY).');

  // 5. Console & Markdown formatting
  const consoleMatrix = checker.formatAllRaidsConsoleReport(summary);
  assert.ok(consoleMatrix.includes('UNIVERSAL REVANS SERIES (IMPOSSIBLE) Lv275 READINESS MATRIX'));
  assert.ok(consoleMatrix.includes('Mugen (Impossible)'));
  assert.ok(consoleMatrix.includes('Agastia (Impossible)'));

  const agastiaMd = checker.formatSingleRaidMarkdownReport(summary.raidReports.agastia);
  assert.ok(agastiaMd.includes('# Revans Readiness Report: Agastia (Impossible)'));
  assert.ok(agastiaMd.includes('Exadeath Cannon'));
  console.log('  [PASS] Console & Markdown formatters verified.');

  console.log('=== All Revans Readiness Tests Passed! ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

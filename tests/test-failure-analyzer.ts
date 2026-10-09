// tests/test-failure-analyzer.ts
import { FailureAnalyzerService } from '../src/services/daily-host/failure-analyzer.service.js';
import { DailyRaidExecutionRecord, DailyRaidDefinition } from '../src/domain/daily-host/daily-host.types.js';

function createMockRaid(name: string): DailyRaidDefinition {
  return {
    id: 'test-raid',
    name,
    category: 'hl',
    stageQuestId: '30001',
    element: 'fire',
    difficulty: 'Extreme',
    defaultTurnLimit: 20
  };
}

function createMockRecord(status: any, message: string, turnsElapsed = 0, honorsEarned = 0): DailyRaidExecutionRecord {
  return {
    raid: createMockRaid('Tiamat Omega HL'),
    status,
    message,
    turnsElapsed,
    honorsEarned,
    durationMs: 5000,
    timestamp: new Date().toISOString()
  };
}

async function runTests() {
  console.log('🧪 Starting Failure Analyzer Service Test Suite...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      process.exitCode = 1;
    }
  }

  // 1. Success case
  {
    const record = createMockRecord('CLEARED', 'Successfully cleared in 3 turns', 3, 450000);
    const diag = FailureAnalyzerService.diagnose(record);
    assert(!diag.isRetriable, 'Cleared raid is NOT marked retriable');
  }

  // 2. Daily limit exhausted
  {
    const record = createMockRecord('SKIPPED_LIMIT', 'Daily host limit reached for Tiamat Omega HL (0 remaining)');
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'DAILY_LIMIT_EXHAUSTED', 'Identifies DAILY_LIMIT_EXHAUSTED');
    assert(!diag.isRetriable, 'Daily limit exhaustion is NOT retriable');
  }

  // 3. Genuine Material Shortage (Verified via in-game check)
  {
    const record = createMockRecord('SKIPPED_NO_MATERIAL', 'Insufficient host materials for Lucilius HL (Held: 0, Required: 1)');
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'GENUINE_MATERIAL_DEFICIT', 'Identifies GENUINE_MATERIAL_DEFICIT');
    assert(!diag.isRetriable, 'CRITICAL: Genuine material shortage MUST NOT be retried');
  }

  // 4. Modal / Dialog Obstruction
  {
    const record = createMockRecord('FAILED', 'Could not open Stage modal for quest 30001 after 15000ms');
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'MODAL_OBSTRUCTION', 'Identifies MODAL_OBSTRUCTION');
    assert(diag.isRetriable, 'Modal obstruction is safely retriable with DOM sanitation');
  }

  // 5. Supporter Summon Timeout
  {
    const record = createMockRecord('FAILED', 'Supporter summon selection timed out or failed to load');
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'SUPPORTER_TIMEOUT', 'Identifies SUPPORTER_TIMEOUT');
    assert(diag.isRetriable, 'Supporter summon timeout is retriable');
  }

  // 6. Party Confirmation Timeout
  {
    const record = createMockRecord('FAILED', 'Failed to confirm party and launch battle deck');
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'PARTY_CONFIRM_TIMEOUT', 'Identifies PARTY_CONFIRM_TIMEOUT');
    assert(diag.isRetriable, 'Party confirmation timeout is retriable');
  }

  // 7. Network / Navigation Timeout
  {
    const record = createMockRecord('FAILED', 'Navigation timeout waiting for multi list');
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'NETWORK_TRANSIENT', 'Identifies NETWORK_TRANSIENT');
    assert(diag.isRetriable, 'Network timeout is retriable');
  }

  // 8. Combat Defeat / Wipeout
  {
    const record = createMockRecord('FAILED', 'Combat concluded without victory confirmation', 12, 120000);
    const diag = FailureAnalyzerService.diagnose(record);
    assert(diag.category === 'COMBAT_WIPEOUT', 'Identifies COMBAT_WIPEOUT');
    assert(diag.isRetriable, 'Combat defeat is retriable with backup assist');
  }

  // 9. Aggregated Diagnostic Report
  {
    const records = [
      createMockRecord('CLEARED', 'Cleared', 2, 300000),
      createMockRecord('SKIPPED_NO_MATERIAL', 'Held: 0, Required: 1'),
      createMockRecord('SKIPPED_LIMIT', '0 remaining'),
      createMockRecord('FAILED', 'Could not open Stage modal'),
      createMockRecord('FAILED', 'Navigation timeout')
    ];
    const report = FailureAnalyzerService.generateDiagnosticReport(records);
    assert(report.totalRaids === 5, 'Report total raids matches (5)');
    assert(report.clearedCount === 1, 'Report cleared count matches (1)');
    assert(report.skippedMaterialCount === 1, 'Report skipped material matches (1)');
    assert(report.skippedLimitCount === 1, 'Report skipped limit matches (1)');
    assert(report.retriableCount === 2, 'Report retriable count matches (2 retriable failures)');
  }

  console.log(`\nFailure Analyzer Tests: ${passed}/${total} passed.\n`);
  if (passed !== total) {
    throw new Error(`Failure Analyzer tests failed: ${passed}/${total}`);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

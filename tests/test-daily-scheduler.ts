// tests/test-daily-scheduler.ts
import { getNextDailyResetJst, formatCountdown, dailyResetScheduler } from '../src/services/scheduler/daily-reset.scheduler.js';

async function runTests() {
  console.log('🧪 Starting Daily Reset Scheduler Test Suite...\n');
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

  // 1. Reference time BEFORE 05:00:15 JST today
  // 2026-10-08 03:00:00 JST (which is 2026-10-07 18:00:00 UTC)
  {
    const refDate = new Date('2026-10-07T18:00:00.000Z');
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate);
    // Target should be 2026-10-08 05:00:15 JST -> 2026-10-07 20:00:15 UTC
    const expectedUtc = new Date('2026-10-07T20:00:15.000Z');
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Calculates correct reset on same JST calendar day');
    assert(msRemaining === (2 * 3600 + 15) * 1000, 'Calculates exact 2h 15s remaining');
  }

  // 2. Reference time AFTER 05:00:15 JST today
  // 2026-10-08 07:00:00 JST (which is 2026-10-07 22:00:00 UTC)
  {
    const refDate = new Date('2026-10-07T22:00:00.000Z');
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate);
    // Target should be tomorrow 2026-10-09 05:00:15 JST -> 2026-10-08 20:00:15 UTC
    const expectedUtc = new Date('2026-10-08T20:00:15.000Z');
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Advances to tomorrow 05:00:15 JST if past today reset');
    assert(msRemaining === (22 * 3600 + 15) * 1000, 'Calculates exact 22h 15s remaining');
  }

  // 3. Exactly at 05:00:15 JST boundary
  // 2026-10-08 05:00:15 JST (2026-10-07 20:00:15 UTC)
  {
    const refDate = new Date('2026-10-07T20:00:15.000Z');
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate);
    // Boundary rule: at or past target rolls over to next reset
    const expectedUtc = new Date('2026-10-08T20:00:15.000Z');
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Rolls over to next day when reference is at reset boundary');
    assert(msRemaining === 24 * 3600 * 1000, 'Calculates exact 24h remaining at boundary');
  }

  // 4. Test formatCountdown helper
  {
    assert(formatCountdown(3600 * 1000) === '1h 0m 0s', 'Formats 1h correctly');
    assert(formatCountdown((2 * 3600 + 15 * 60 + 42) * 1000) === '2h 15m 42s', 'Formats multi-hour countdown');
    assert(formatCountdown(45 * 1000) === '45s', 'Formats seconds only');
    assert(formatCountdown(0) === '0s (Reset imminent)', 'Formats zero remaining as imminent');
  }

  // 5. Test Scheduler getScheduleInfo()
  {
    const info = dailyResetScheduler.getScheduleInfo(15);
    assert(info.nextResetDate instanceof Date, 'Returns valid Date object');
    assert(info.nextResetJstString.includes('JST'), 'Contains JST timezone suffix');
    assert(info.msRemaining > 0, 'msRemaining is positive for future reset');
    assert(typeof info.formattedCountdown === 'string', 'Formatted countdown is string');
  }

  console.log(`\nDaily Reset Scheduler Tests: ${passed}/${total} passed.\n`);
  if (passed !== total) {
    throw new Error(`Daily Reset Scheduler tests failed: ${passed}/${total}`);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

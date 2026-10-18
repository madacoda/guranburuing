// tests/test-daily-scheduler.ts
import {
  getNextDailyResetJst,
  formatCountdown,
  dailyResetScheduler,
  DEFAULT_SCHEDULER_HOUR_JST
} from '../src/services/scheduler/daily-reset.scheduler.js';

async function runTests() {
  console.log('🧪 Starting Daily Peak-Hour Scheduler Test Suite...\n');
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

  // 0. Verify default peak Golden Time constant is 21:00 JST (19:00 WIB)
  {
    assert(DEFAULT_SCHEDULER_HOUR_JST === 21, 'Default scheduler hour is 21:00 JST (19:00 WIB Peak Golden Time)');
  }

  // 1. Reference time BEFORE 21:00:15 JST today
  // 2026-10-08 19:00:00 JST (which is 2026-10-08 10:00:00 UTC / 17:00:00 WIB)
  {
    const refDate = new Date('2026-10-08T10:00:00.000Z');
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate);
    // Target should be 2026-10-08 21:00:15 JST -> 2026-10-08 12:00:15 UTC
    const expectedUtc = new Date('2026-10-08T12:00:15.000Z');
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Calculates correct 21:00:15 JST schedule on same JST calendar day');
    assert(msRemaining === (2 * 3600 + 15) * 1000, 'Calculates exact 2h 15s remaining until 21:00:15 JST');
  }

  // 2. Reference time AFTER 21:00:15 JST today
  // 2026-10-08 23:00:00 JST (which is 2026-10-08 14:00:00 UTC / 21:00:00 WIB)
  {
    const refDate = new Date('2026-10-08T14:00:00.000Z');
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate);
    // Target should be tomorrow 2026-10-09 21:00:15 JST -> 2026-10-09 12:00:15 UTC
    const expectedUtc = new Date('2026-10-09T12:00:15.000Z');
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Advances to tomorrow 21:00:15 JST if past today peak schedule');
    assert(msRemaining === (22 * 3600 + 15) * 1000, 'Calculates exact 22h 15s remaining');
  }

  // 3. Exactly at 21:00:15 JST boundary
  // 2026-10-08 21:00:15 JST (2026-10-08 12:00:15 UTC)
  {
    const refDate = new Date('2026-10-08T12:00:15.000Z');
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate);
    // Boundary rule: at or past target rolls over to next day
    const expectedUtc = new Date('2026-10-09T12:00:15.000Z');
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Rolls over to next day when reference is at 21:00:15 JST boundary');
    assert(msRemaining === 24 * 3600 * 1000, 'Calculates exact 24h remaining at boundary');
  }

  // 4. Custom targetHourJst override (e.g. 05:00:15 JST server reset)
  {
    const refDate = new Date('2026-10-07T18:00:00.000Z'); // 03:00:00 JST
    const { nextResetDate, msRemaining } = getNextDailyResetJst(15, refDate, 5);
    const expectedUtc = new Date('2026-10-07T20:00:15.000Z'); // 05:00:15 JST
    assert(nextResetDate.toISOString() === expectedUtc.toISOString(), 'Supports custom targetHourJst override (05:00:15 JST)');
    assert(msRemaining === (2 * 3600 + 15) * 1000, 'Calculates exact 2h 15s remaining for custom hour');
  }

  // 5. Test formatCountdown helper
  {
    assert(formatCountdown(3600 * 1000) === '1h 0m 0s', 'Formats 1h correctly');
    assert(formatCountdown((2 * 3600 + 15 * 60 + 42) * 1000) === '2h 15m 42s', 'Formats multi-hour countdown');
    assert(formatCountdown(45 * 1000) === '45s', 'Formats seconds only');
    assert(formatCountdown(0) === '0s (Reset imminent)', 'Formats zero remaining as imminent');
  }

  // 6. Test Scheduler getScheduleInfo()
  {
    const info = dailyResetScheduler.getScheduleInfo(15);
    assert(info.nextResetDate instanceof Date, 'Returns valid Date object');
    assert(info.targetHourJst === 21, 'getScheduleInfo defaults to targetHourJst = 21 (21:00 JST)');
    assert(info.nextResetJstString.includes('21:00:15 JST'), 'Contains 21:00:15 JST timezone suffix');
    assert(info.nextResetWibString.includes('19:00:15 WIB'), 'Contains 19:00:15 WIB timezone suffix');
    assert(info.msRemaining > 0, 'msRemaining is positive for future schedule');
    assert(typeof info.formattedCountdown === 'string', 'Formatted countdown is string');
  }

  console.log(`\nDaily Peak-Hour Scheduler Tests: ${passed}/${total} passed.\n`);
  if (passed !== total) {
    throw new Error(`Daily Peak-Hour Scheduler tests failed: ${passed}/${total}`);
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

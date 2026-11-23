// tests/test-human-motor.ts
import {
  sampleGaussian,
  sampleTargetCoordinate,
  sampleHumanDelayMs,
  sampleHumanSpamCadence,
  moveMouseSmoothly,
  evaluateCubicBezier,
  getFatigueState,
  getFatigueLevel,
  setFatigueLevel,
  resetFatigue,
  recordRunCompletedForFatigue,
  applyPassiveIdleRecovery,
  getSpeedProfile,
  setSpeedProfile,
} from '../src/human-motor.js';

console.log('--- Testing Human Motor Simulation Math ---');

// 1. Test Gaussian distribution
const samples = Array.from({ length: 1000 }, () => sampleGaussian(500, 50));
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
console.log(`Gaussian Mean (Target: 500): ${mean.toFixed(2)}`);
if (Math.abs(mean - 500) > 10) {
  throw new Error(`Gaussian mean out of expected bounds: ${mean}`);
}

// 2. Test Spatial Clamping
const box = { x: 100, y: 100, width: 200, height: 60 };
for (let i = 0; i < 1000; i++) {
  const pt = sampleTargetCoordinate(box);
  if (pt.x < box.x || pt.x > box.x + box.width || pt.y < box.y || pt.y > box.y + box.height) {
    throw new Error(`Spatial clamp failed: point (${pt.x}, ${pt.y}) outside box.`);
  }
}
console.log('Spatial Coordinate Jitter Test: PASSED (100% bounds preserved across 1000 samples)');

// 3. Test Cubic Bezier Interpolation
const p0 = { x: 0, y: 0 };
const p1 = { x: 10, y: 20 };
const p2 = { x: 30, y: 40 };
const p3 = { x: 50, y: 50 };

const start = evaluateCubicBezier(p0, p1, p2, p3, 0);
const mid = evaluateCubicBezier(p0, p1, p2, p3, 0.5);
const end = evaluateCubicBezier(p0, p1, p2, p3, 1);

console.log('Bezier Start (Target: 0, 0):', start);
console.log('Bezier Mid (t=0.5):', mid);
console.log('Bezier End (Target: 50, 50):', end);

if (start.x !== 0 || start.y !== 0 || end.x !== 50 || end.y !== 50) {
  throw new Error('Bezier interpolation endpoints failed boundary check.');
}

// 4. Test Subtle Long-Run Fatigue Curve, Micro-Break Trigger, and Idle Recovery
console.log('\n--- Testing Subtle Human Motor Fatigue & Micro-Break Recovery ---');
resetFatigue(1.0);
if (getFatigueLevel() !== 0 || getFatigueState().continuousRunsWithoutBreak !== 0) {
  throw new Error('Expected fatigue to start at 0 after full reset.');
}

// Flow state: first 10 runs should keep fatigue very subtle (<= 0.05)
let nowSim = Date.now();
for (let r = 1; r <= 10; r++) {
  nowSim += 15000; // 15s per run (no long idle break)
  recordRunCompletedForFatigue(nowSim);
}
const flowFatigue = getFatigueState().fatigueLevel;
console.log(`Flow State Fatigue after 10 runs: ${flowFatigue.toFixed(4)} (expected <= 0.05)`);
if (flowFatigue > 0.05 || flowFatigue <= 0) {
  throw new Error(`Expected subtle flow state fatigue in (0, 0.05], got ${flowFatigue}`);
}

// Long continuous run without break: runs 11..40 should accumulate fatigue and trigger micro-break
let microBreakTriggered = false;
for (let r = 11; r <= 40; r++) {
  nowSim += 15000;
  const res = recordRunCompletedForFatigue(nowSim);
  if (res.shouldTakeMicroBreak) {
    microBreakTriggered = true;
    break;
  }
}
const peakFatigue = getFatigueState().fatigueLevel;
console.log(`Long-Run Fatigue at Micro-Break Trigger: ${peakFatigue.toFixed(4)} (runs=${getFatigueState().continuousRunsWithoutBreak})`);
if (!microBreakTriggered || peakFatigue < 0.25) {
  throw new Error(`Expected micro-break to trigger after long continuous run streak, got triggered=${microBreakTriggered}, fatigue=${peakFatigue}`);
}

// Simulate micro-break clearing ~70% of fatigue and resetting continuous run streak
resetFatigue(0.70);
const postBreakState = getFatigueState();
console.log(`Post-Micro-Break Fatigue: ${postBreakState.fatigueLevel.toFixed(4)} (continuousRuns=${postBreakState.continuousRunsWithoutBreak})`);
if (postBreakState.continuousRunsWithoutBreak !== 0 || postBreakState.fatigueLevel >= peakFatigue * 0.35) {
  throw new Error(`Expected micro-break to clear ~70% fatigue and reset continuousRuns, got ${JSON.stringify(postBreakState)}`);
}

// Simulate passive idle recovery (e.g. 3 minutes idle between raids)
setFatigueLevel(0.50);
const afterIdleMs = Date.now() + 180 * 1000;
applyPassiveIdleRecovery(afterIdleMs);
const recoveredFatigue = getFatigueState().fatigueLevel;
console.log(`After 3m Passive Idle Recovery: ${recoveredFatigue.toFixed(4)} (from 0.50)`);
if (recoveredFatigue >= 0.10) {
  throw new Error(`Expected 3m passive idle to recover most fatigue, got ${recoveredFatigue}`);
}

// Verify spatial clamping still 100% holds under maximum fatigue (1.0)
setFatigueLevel(1.0);
for (let i = 0; i < 500; i++) {
  const pt = sampleTargetCoordinate(box);
  if (pt.x < box.x + 3 || pt.x > box.x + box.width - 3 || pt.y < box.y + 3 || pt.y > box.y + box.height - 3) {
    throw new Error(`Fatigued spatial clamp failed: point (${pt.x}, ${pt.y}) outside 3px inner padding.`);
  }
}
resetFatigue(1.0);
console.log('Fatigue Curve, Micro-Break Reset, & Idle Decay Test: PASSED');

// 5. Test Non-Uniform Human Delay & Natural Spam Cadence + Turbo Micro-Bezier
console.log('\n--- Testing Non-Uniform Spam Cadence & Turbo Micro-Bezier Trajectory ---');
const origProfile = getSpeedProfile();
try {
  setSpeedProfile('turbo');

  const sampledDelays: number[] = [];
  for (let i = 0; i < 40; i++) {
    const val = sampleHumanDelayMs(300, 0.30, { minMs: 150, maxMs: 550 });
    if (val < 150 || val > 550) {
      throw new Error(`sampleHumanDelayMs out of bounds [150, 550]: ${val}`);
    }
    sampledDelays.push(val);
  }
  const uniqueDelays = new Set(sampledDelays).size;
  if (uniqueDelays < 10) {
    throw new Error(`Expected non-metronomic delay variance (>=10 unique values), got ${uniqueDelays}`);
  }

  const c1Turbo = sampleHumanSpamCadence(1, true);
  if (c1Turbo.preRetryGapMs !== 0 || c1Turbo.verifyWindowMs < 360 || c1Turbo.verifyWindowMs > 740) {
    throw new Error(`Unexpected attempt-1 turbo cadence: ${JSON.stringify(c1Turbo)}`);
  }

  const turboGaps: number[] = [];
  const turboWindows: number[] = [];
  const fastGaps: number[] = [];
  const fastWindows: number[] = [];
  for (let i = 0; i < 30; i++) {
    const attemptNum = 2 + (i % 3);
    const tc = sampleHumanSpamCadence(attemptNum, true);
    if (tc.preRetryGapMs < 24 || tc.preRetryGapMs > 130 || tc.verifyWindowMs < 175 || tc.verifyWindowMs > 540) {
      throw new Error(`Turbo spam cadence out of bounds: ${JSON.stringify(tc)}`);
    }
    turboGaps.push(tc.preRetryGapMs);
    turboWindows.push(tc.verifyWindowMs);

    const fc = sampleHumanSpamCadence(attemptNum, false);
    if (fc.preRetryGapMs < 60 || fc.preRetryGapMs > 245 || fc.verifyWindowMs < 280 || fc.verifyWindowMs > 820) {
      throw new Error(`Fast spam cadence out of bounds: ${JSON.stringify(fc)}`);
    }
    fastGaps.push(fc.preRetryGapMs);
    fastWindows.push(fc.verifyWindowMs);
  }

  if (
    new Set(turboGaps).size < 8 ||
    new Set(turboWindows).size < 8 ||
    new Set(fastGaps).size < 8 ||
    new Set(fastWindows).size < 8
  ) {
    throw new Error('Expected natural variance (>=8 unique values) in human spam cadence');
  }

  // Verify moveMouseSmoothly in turbo uses micro-Bezier (>=2 steps across 200px)
  const recordedMoves: { x: number; y: number }[] = [];
  const mockCursorPage = {
    mouse: {
      move: async (x: number, y: number) => {
        recordedMoves.push({ x, y });
      }
    }
  } as any;

  await moveMouseSmoothly(mockCursorPage, { x: 100, y: 100 });
  recordedMoves.length = 0;
  await moveMouseSmoothly(mockCursorPage, { x: 300, y: 150 });
  if (recordedMoves.length < 2) {
    throw new Error(`Expected >=2 micro-Bezier moves in turbo across 206px, got ${recordedMoves.length}`);
  }
  const lastMove = recordedMoves[recordedMoves.length - 1];
  if (Math.hypot(lastMove.x - 300, lastMove.y - 150) > 1e-6) {
    throw new Error(`Expected final micro-Bezier point at (300, 150), got (${lastMove.x}, ${lastMove.y})`);
  }
  console.log(`Non-Uniform Spam Cadence (unique=${uniqueDelays}/40) & Turbo Micro-Bezier (${recordedMoves.length} steps): PASSED`);
} finally {
  setSpeedProfile(origProfile);
  resetFatigue(1.0);
}

console.log('\n✅ Task 02 Human Motor Simulation Tests: ALL PASSED!');

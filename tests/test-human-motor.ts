// tests/test-human-motor.ts
import {
  sampleGaussian,
  sampleTargetCoordinate,
  evaluateCubicBezier,
  getFatigueState,
  getFatigueLevel,
  setFatigueLevel,
  resetFatigue,
  recordRunCompletedForFatigue,
  applyPassiveIdleRecovery,
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

console.log('\n✅ Task 02 Human Motor Simulation Tests: ALL PASSED!');

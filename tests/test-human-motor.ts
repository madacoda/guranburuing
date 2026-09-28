// tests/test-human-motor.ts
import { sampleGaussian, sampleTargetCoordinate, evaluateCubicBezier } from '../src/human-motor.js';

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

console.log('\n✅ Task 02 Human Motor Simulation Tests: ALL PASSED!');

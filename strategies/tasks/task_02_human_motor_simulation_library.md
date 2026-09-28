# Task 02: Biologically Plausible Human Motor Simulation Library

## 1. Task Objective
Implement the mathematical motor kinematics library `src/human-motor.ts` derived from [Principle 08](file:///c:/laragon/www/gbf/strategies/principles/08_human_simulation_mathematics.md). 

The library replaces all robotic cursor teleportation, fixed sleep timers, and centered clicks with **continuous cubic Bézier trajectories**, **scroll-into-view safety**, **persistent cursor tracking**, **2D Gaussian coordinate jitter**, and **log-normal latency distributions** to guarantee high behavioral entropy against Cygames server-side telemetry.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── src/
│   └── human-motor.ts             # Motor control, Bézier paths, Gaussian sampling
└── tests/
    └── test-human-motor.ts        # Kinematics and statistical validation tests
```

---

## 3. Implementation Code: `src/human-motor.ts`

```typescript
// src/human-motor.ts
import { Page, ElementHandle } from 'puppeteer-core';

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Persistent cursor tracker to avoid instantaneous teleports between clicks
let currentCursorPos: Point = { x: 240, y: 480 };

/**
 * Generates a standard normal random variable Z ~ N(0, 1) using the Box-Muller transform.
 */
export function sampleGaussian(mean = 0, stdDev = 1): number {
  const u1 = Math.max(1e-7, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

/**
 * Log-Normal delay generator simulating human neuromuscular reaction time.
 * @param medianMs The median delay time in milliseconds.
 * @param shape The shape parameter sigma (typically 0.25 - 0.35).
 */
export async function logNormalDelay(medianMs: number, shape = 0.28): Promise<void> {
  const mu = Math.log(medianMs);
  let duration = Math.exp(sampleGaussian(mu, shape));

  // 5% chance of micro-hesitation (mimics a player reading notifications/looking at art)
  if (Math.random() < 0.05) {
    duration += Math.exp(sampleGaussian(Math.log(2200), 0.25));
  }

  await new Promise(resolve => setTimeout(resolve, Math.max(40, duration)));
}

/**
 * Evaluates a cubic Bézier curve at parameter t in [0, 1].
 */
export function evaluateCubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Generates a continuous, smooth, curved human-like cursor trajectory from the current cursor position.
 */
export async function moveMouseSmoothly(page: Page, target: Point): Promise<void> {
  const start = { ...currentCursorPos };
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 4) {
    await page.mouse.move(target.x, target.y);
    currentCursorPos = { ...target };
    return;
  }

  // Unit perpendicular vector for arm/wrist arc simulation
  const perp = { x: -dy / distance, y: dx / distance };
  const curvature = sampleGaussian(0, distance * 0.16);

  const p1: Point = {
    x: start.x + dx * 0.32 + perp.x * curvature,
    y: start.y + dy * 0.32 + perp.y * curvature,
  };

  const p2: Point = {
    x: start.x + dx * 0.72 + perp.x * curvature * 0.6,
    y: start.y + dy * 0.72 + perp.y * curvature * 0.6,
  };

  // Steps scaled via Fitts's Law approximation
  const steps = Math.max(12, Math.min(35, Math.floor(distance / 22)));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Ease-in, ease-out timing curve (smooth acceleration and deceleration)
    const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const pt = evaluateCubicBezier(start, p1, p2, target, Math.min(1, Math.max(0, easedT)));

    await page.mouse.move(pt.x, pt.y);
    await new Promise(r => setTimeout(r, Math.max(6, sampleGaussian(11, 2))));
  }

  // Update persistent cursor position
  currentCursorPos = { ...target };
}

/**
 * Samples a natural click coordinate within the inner 60% of an element using a 2D Gaussian.
 */
export function sampleTargetCoordinate(box: BoundingBox): Point {
  const sigmaX = box.width / 6;
  const sigmaY = box.height / 6;

  const rawX = box.x + box.width / 2 + sampleGaussian(0, sigmaX);
  const rawY = box.y + box.height / 2 + sampleGaussian(0, sigmaY);

  // Strictly clamp inside inner boundaries (leaving 4px padding)
  const clampedX = Math.max(box.x + 4, Math.min(box.x + box.width - 4, rawX));
  const clampedY = Math.max(box.y + 4, Math.min(box.y + box.height - 4, rawY));

  return { x: clampedX, y: clampedY };
}

/**
 * Dispatches a complete human-mimetic click on an ElementHandle or CSS selector.
 * Guarantees element is scrolled into view before bounding box calculation.
 */
export async function humanizedClick(page: Page, element: ElementHandle | string): Promise<void> {
  const el = typeof element === 'string'
    ? await page.waitForSelector(element, { visible: true, timeout: 15000 })
    : element;

  if (!el) {
    throw new Error(`Target element not found: ${element}`);
  }

  // 1. Scroll into view if offscreen (vital for long lists / island overviews)
  await el.evaluate((node: any) => {
    node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  });
  await logNormalDelay(180, 0.15);

  // 2. Compute freshly updated bounding box
  const box = await el.boundingBox();
  if (!box) {
    throw new Error('Could not calculate element bounding box after scrolling into view.');
  }

  const targetPoint = sampleTargetCoordinate(box);

  // 3. Move cursor smoothly along Bézier curve
  await moveMouseSmoothly(page, targetPoint);

  // 4. Pre-click neuromuscular delay
  await logNormalDelay(140, 0.2);

  // 5. Physical switch depression
  await page.mouse.down();
  await logNormalDelay(68, 0.15); // Switch depression latency (~50-85ms)
  await page.mouse.up();

  // 6. Post-click recovery pause
  await logNormalDelay(130, 0.2);
}

/**
 * Simulates human typing with variable inter-key latency.
 */
export async function humanizedType(page: Page, selector: string, text: string): Promise<void> {
  await humanizedClick(page, selector);
  await logNormalDelay(250, 0.2);

  for (const char of text) {
    await page.keyboard.type(char);
    // Natural typing interval: 65ms - 130ms per keystroke
    await logNormalDelay(95, 0.22);
  }
}
```

---

## 4. Verification & Testing Protocol

Create `tests/test-human-motor.ts`:
```typescript
import { sampleGaussian, sampleTargetCoordinate, evaluateCubicBezier } from '../src/human-motor.js';

console.log('--- Testing Human Motor Simulation Math ---');

// 1. Test Gaussian distribution
const samples = Array.from({ length: 1000 }, () => sampleGaussian(500, 50));
const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
console.log(`Gaussian Mean (Target: 500): ${mean.toFixed(2)}`);

// 2. Test Spatial Clamping
const box = { x: 100, y: 100, width: 200, height: 60 };
for (let i = 0; i < 100; i++) {
  const pt = sampleTargetCoordinate(box);
  if (pt.x < box.x || pt.x > box.x + box.width || pt.y < box.y || pt.y > box.y + box.height) {
    throw new Error(`Spatial clamp failed: point (${pt.x}, ${pt.y}) outside box.`);
  }
}
console.log('Spatial Coordinate Jitter Test: PASSED (100% bounds preserved)');
```

Run test via:
```powershell
npx tsx tests/test-human-motor.ts
```

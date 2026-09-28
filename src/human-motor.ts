// src/human-motor.ts
import { Page, ElementHandle } from 'puppeteer-core';
import { config } from './config.js';

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

export type SpeedProfile = 'stealth' | 'fast' | 'turbo';

let currentSpeedProfile: SpeedProfile = (config.SPEED_PROFILE as SpeedProfile) || 'fast';

export function setSpeedProfile(profile: SpeedProfile): void {
  console.log(`[HumanMotor] Speed profile switched to: ${profile.toUpperCase()}`);
  currentSpeedProfile = profile;
}

export function getSpeedProfile(): SpeedProfile {
  return currentSpeedProfile;
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
 * Automatically scales based on the active SpeedProfile.
 * @param medianMs The baseline median delay time in milliseconds.
 * @param shape The shape parameter sigma (typically 0.20 - 0.35).
 */
export async function logNormalDelay(medianMs: number, shape = 0.28): Promise<void> {
  let effectiveMedian = medianMs;
  let allowHesitation = false;

  if (currentSpeedProfile === 'turbo') {
    effectiveMedian = Math.max(15, medianMs * 0.25);
  } else if (currentSpeedProfile === 'fast') {
    // Fast human racer: maintain ~75% of human baseline
    effectiveMedian = Math.max(35, medianMs * 0.75);
    allowHesitation = Math.random() < 0.03;
  } else {
    // Stealth profile: retain full delay and 5% hesitation probability
    allowHesitation = Math.random() < 0.05;
  }

  const mu = Math.log(effectiveMedian);
  let duration = Math.exp(sampleGaussian(mu, shape));

  // Occasional natural human hesitation (mimics a player checking raid HP/chat/art)
  if (allowHesitation) {
    duration += Math.exp(sampleGaussian(Math.log(1400), 0.30));
  }

  const minDelay = currentSpeedProfile === 'turbo' ? 10 : (currentSpeedProfile === 'fast' ? 25 : 45);
  await new Promise(resolve => setTimeout(resolve, Math.max(minDelay, duration)));
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
 * Generates a continuous cursor trajectory scaled to the speed profile.
 */
export async function moveMouseSmoothly(page: Page, target: Point): Promise<void> {
  const start = { ...currentCursorPos };
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 4 || currentSpeedProfile === 'turbo') {
    await page.mouse.move(target.x, target.y);
    currentCursorPos = { ...target };
    return;
  }

  // Unit perpendicular vector for arm/wrist arc simulation
  const perp = { x: -dy / distance, y: dx / distance };
  const curvature = sampleGaussian(0, distance * 0.12);

  const p1: Point = {
    x: start.x + dx * 0.32 + perp.x * curvature,
    y: start.y + dy * 0.32 + perp.y * curvature,
  };

  const p2: Point = {
    x: start.x + dx * 0.72 + perp.x * curvature * 0.6,
    y: start.y + dy * 0.72 + perp.y * curvature * 0.6,
  };

  // Steps scaled via speed profile
  const steps = currentSpeedProfile === 'fast'
    ? Math.max(3, Math.min(8, Math.floor(distance / 70)))
    : Math.max(5, Math.min(14, Math.floor(distance / 45)));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const pt = evaluateCubicBezier(start, p1, p2, target, Math.min(1, Math.max(0, easedT)));

    await page.mouse.move(pt.x, pt.y);
    const stepDelay = currentSpeedProfile === 'stealth'
      ? Math.max(3, sampleGaussian(5, 1.2))
      : (currentSpeedProfile === 'fast' ? Math.max(1, sampleGaussian(2.5, 0.7)) : 0);
    if (stepDelay > 0) {
      await new Promise(r => setTimeout(r, stepDelay));
    }
  }

  currentCursorPos = { ...target };
}

/**
 * Samples a natural click coordinate within the inner 60% of an element using a 2D Gaussian.
 */
export interface HumanClickOptions {
  allowMultiClick?: boolean;
  multiClickChance?: number;
  maxClicks?: number;
}

/**
 * Asynchronously waits for a randomized duration bounded between minMs and maxMs,
 * with Log-Normal distribution within that window to emulate human behavioral variance.
 */
export async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const low = Math.min(minMs, maxMs);
  const high = Math.max(minMs, maxMs);
  const mid = (low + high) / 2;
  const range = high - low;

  const offset = sampleGaussian(0, range / 5);
  const sampled = Math.max(low, Math.min(high, mid + offset));

  let duration = sampled;
  if (currentSpeedProfile === 'turbo') {
    duration = Math.max(low * 0.3, sampled * 0.4);
  } else if (currentSpeedProfile === 'fast') {
    duration = Math.max(low * 0.75, sampled * 0.85);
  }

  if (Math.random() < 0.02 && currentSpeedProfile !== 'turbo') {
    duration += 350 + Math.random() * 450;
  }

  await new Promise(resolve => setTimeout(resolve, Math.round(duration)));
}

/**
 * Emulates human cognitive reaction latency upon seeing a UI update or button unlock.
 * Samples from a Log-Normal distribution (typical human eye-to-hand reaction: 240ms - 480ms).
 */
export async function humanReactionDelay(baseMs = 320, shape = 0.22): Promise<void> {
  await logNormalDelay(baseMs, shape);
}

/**
 * Samples a natural click coordinate within the inner portion of an element using a 2D Gaussian.
 */
export function sampleTargetCoordinate(box: BoundingBox): Point {
  const sigmaX = box.width / 5.5;
  const sigmaY = box.height / 5.5;

  const rawX = box.x + box.width / 2 + sampleGaussian(0, sigmaX);
  const rawY = box.y + box.height / 2 + sampleGaussian(0, sigmaY);

  // Strictly clamp inside inner boundaries (leaving 3px padding)
  const clampedX = Math.max(box.x + 3, Math.min(box.x + box.width - 3, rawX));
  const clampedY = Math.max(box.y + 3, Math.min(box.y + box.height - 3, rawY));

  return { x: clampedX, y: clampedY };
}

/**
 * Dispatches an adaptive human-mimetic click with profile-tuned latency.
 * Guarantees element is scrolled into view before bounding box calculation.
 * Supports natural rapid multi-clicks (e.g. spamming skills/attack).
 */
export async function humanizedClick(
  page: Page,
  element: ElementHandle | string,
  options?: HumanClickOptions
): Promise<void> {
  const el = typeof element === 'string'
    ? await page.waitForSelector(element, { visible: true, timeout: 15000 })
    : element;

  if (!el) {
    throw new Error(`Target element not found: ${element}`);
  }

  // 1. Scroll into view if offscreen
  await el.evaluate((node: any) => {
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    }
  }).catch(() => null);

  if (currentSpeedProfile === 'stealth') {
    await logNormalDelay(60, 0.15);
  }

  // 2. Compute freshly updated bounding box
  const box = await el.boundingBox();
  if (!box) {
    // Fallback trigger for dynamic Zepto/Backbone modal overlays without layout rects
    await el.evaluate((node: any) => {
      if (node) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(node).trigger('tap');
        if (typeof node.click === 'function') node.click();
      }
    }).catch(() => null);
    await logNormalDelay(currentSpeedProfile === 'fast' ? 40 : 60, 0.15);
    return;
  }

  const targetPoint = sampleTargetCoordinate(box);

  // 3. Move cursor
  await moveMouseSmoothly(page, targetPoint);

  // 4. Pre-click delay (neuromuscular preparation / hover before depressing switch)
  const preClickMs = currentSpeedProfile === 'turbo' ? 15 : (currentSpeedProfile === 'fast' ? 45 : 75);
  await logNormalDelay(preClickMs, 0.18);

  // 5. Determine click count (single vs rapid multi-tap)
  const allowMulti = options?.allowMultiClick ?? false;
  const multiChance = options?.multiClickChance ?? 0.35;
  const maxClicks = options?.maxClicks ?? (Math.random() < 0.25 ? 3 : 2);
  const clickCount = (allowMulti && Math.random() < multiChance) ? maxClicks : 1;

  for (let c = 0; c < clickCount; c++) {
    if (c > 0) {
      // Rapid tap inter-click delay (65ms - 120ms)
      await logNormalDelay(65 + Math.random() * 55, 0.18);
      // Small jitter in coordinate for the 2nd/3rd tap
      const jitterPoint = {
        x: Math.max(box.x + 3, Math.min(box.x + box.width - 3, targetPoint.x + (Math.random() * 6 - 3))),
        y: Math.max(box.y + 3, Math.min(box.y + box.height - 3, targetPoint.y + (Math.random() * 6 - 3)))
      };
      await page.mouse.move(jitterPoint.x, jitterPoint.y);
      currentCursorPos = jitterPoint;
    }

    // Physical click actuation (realistic microswitch hold duration: 40ms - 75ms)
    await page.mouse.down();
    const holdMs = currentSpeedProfile === 'turbo' ? 20 : (currentSpeedProfile === 'fast' ? 45 : 70);
    await logNormalDelay(holdMs, 0.18);
    await page.mouse.up();

    // Failsafe trigger for Zepto/Backbone mobile web controls
    await el.evaluate((node: any) => {
      if (node) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(node).trigger('tap');
        if (typeof node.click === 'function') node.click();
      }
    }).catch(() => null);
  }

  // 6. Post-click pause
  if (currentSpeedProfile !== 'turbo') {
    const postClickMs = currentSpeedProfile === 'fast' ? 45 : 75;
    await logNormalDelay(postClickMs, 0.18);
  }
}

/**
 * Simulates human typing with variable inter-key latency tuned to speed profile.
 */
export async function humanizedType(page: Page, selector: string, text: string): Promise<void> {
  await humanizedClick(page, selector);
  await logNormalDelay(currentSpeedProfile === 'turbo' ? 40 : (currentSpeedProfile === 'fast' ? 100 : 250), 0.2);

  for (const char of text) {
    await page.keyboard.type(char);
    const keyDelay = currentSpeedProfile === 'turbo' ? 15 : (currentSpeedProfile === 'fast' ? 35 : 95);
    await logNormalDelay(keyDelay, 0.2);
  }
}

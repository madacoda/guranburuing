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

// Per-page cursor tracker to prevent multi-account swarms from clobbering each other's trajectory state
const cursorPosByPage = new WeakMap<object, Point>();
let fallbackCursorPos: Point = { x: 240, y: 480 };

function getPageCursorPos(page: Page | null | undefined): Point {
  if (page && typeof page === 'object') {
    return cursorPosByPage.get(page) || { x: 240, y: 480 };
  }
  return fallbackCursorPos;
}

function setPageCursorPos(page: Page | null | undefined, pos: Point): void {
  if (page && typeof page === 'object') {
    cursorPosByPage.set(page, pos);
  }
  fallbackCursorPos = pos;
}

// Cached spare normal variate from Box-Muller transform to halve transcendental math overhead
let hasSpareGaussian = false;
let spareGaussian = 0;

/**
 * Generates a standard normal random variable Z ~ N(0, 1) using the Box-Muller transform
 * with spare variate caching.
 */
export function sampleGaussian(mean = 0, stdDev = 1): number {
  if (hasSpareGaussian) {
    hasSpareGaussian = false;
    return mean + spareGaussian * stdDev;
  }
  const u1 = Math.max(1e-7, Math.random());
  const u2 = Math.random();
  const mag = Math.sqrt(-2.0 * Math.log(u1));
  const angle = 2.0 * Math.PI * u2;
  const z0 = mag * Math.cos(angle);
  spareGaussian = mag * Math.sin(angle);
  hasSpareGaussian = true;
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

  if (config.isProduction) {
    // Production VPS: trimmed delays to capitalize on low-latency Tokyo ping
    effectiveMedian = Math.max(10, medianMs * 0.20);
    allowHesitation = false;
  } else if (currentSpeedProfile === 'turbo') {
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

  const minDelay = config.isProduction ? 8 : (currentSpeedProfile === 'turbo' ? 10 : (currentSpeedProfile === 'fast' ? 25 : 45));
  await new Promise(resolve => setTimeout(resolve, Math.max(minDelay, duration)));
}

export interface InterRunDelayOptions {
  speedProfile?: SpeedProfile;
  customDelayMs?: number | [number, number];
  humanMotor?: boolean;
}

/**
 * Computes and executes an organic, biomechanically randomized pause between workflow runs.
 * Applies Gaussian log-normal jitter and occasional natural human hesitation to mirror authentic player pacing.
 * Returns the exact millisecond duration waited.
 */
export async function interRunHumanDelay(options: InterRunDelayOptions = {}): Promise<number> {
  const profile = options.speedProfile || getSpeedProfile() || 'fast';
  const humanMotor = options.humanMotor !== false;

  if (!humanMotor) {
    const minDelay = config.isProduction ? 50 : 150;
    await new Promise(r => setTimeout(r, minDelay));
    return minDelay;
  }

  // 1. Explicit custom override: [min, max] range or number
  if (options.customDelayMs !== undefined) {
    if (Array.isArray(options.customDelayMs)) {
      const [minMs, maxMs] = options.customDelayMs;
      const low = Math.min(minMs, maxMs);
      const high = Math.max(minMs, maxMs);
      const span = high - low;
      const jittered = Math.max(low, Math.min(high, low + span * 0.5 + sampleGaussian(0, span * 0.18)));
      const duration = Math.round(jittered);
      console.log(`[HumanMotor] 🎲 Natural inter-run delay: ${duration}ms (explicit range [${low}, ${high}]ms)...`);
      await new Promise(r => setTimeout(r, duration));
      return duration;
    } else if (typeof options.customDelayMs === 'number' && options.customDelayMs > 0) {
      const base = options.customDelayMs;
      const jittered = Math.max(Math.round(base * 0.5), Math.round(base + sampleGaussian(0, base * 0.12)));
      console.log(`[HumanMotor] 🎲 Natural inter-run delay: ${jittered}ms (target ${base}ms with Gaussian jitter)...`);
      await new Promise(r => setTimeout(r, jittered));
      return jittered;
    }
  }

  // 2. Default profile-tuned Gaussian log-normal distribution
  let baselineMedian = 1600;
  let shape = 0.24;
  let hesitationChance = 0.035;
  let hesitationMedian = 1400;

  if (profile === 'turbo') {
    baselineMedian = 750;
    shape = 0.20;
    hesitationChance = 0.01;
    hesitationMedian = 500;
  } else if (profile === 'stealth') {
    baselineMedian = 3200;
    shape = 0.30;
    hesitationChance = 0.07;
    hesitationMedian = 2500;
  }

  if (config.isProduction) {
    baselineMedian = Math.max(250, baselineMedian * 0.25);
    hesitationChance = 0;
  }

  const mu = Math.log(baselineMedian);
  let duration = Math.exp(sampleGaussian(mu, shape));

  if (Math.random() < hesitationChance) {
    const hesitation = Math.exp(sampleGaussian(Math.log(hesitationMedian), 0.28));
    duration += hesitation;
  }

  const minFloor = profile === 'turbo' ? 400 : (profile === 'fast' ? 950 : 1800);
  const maxCeil = profile === 'turbo' ? 1400 : (profile === 'fast' ? 3800 : 8000);
  const finalDuration = Math.round(Math.max(minFloor, Math.min(maxCeil, duration)));

  console.log(`[HumanMotor] 🎲 Natural inter-run pause: ${finalDuration}ms (${profile.toUpperCase()} profile, Gaussian jitter)...`);
  await new Promise(r => setTimeout(r, finalDuration));
  return finalDuration;
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
  const start = { ...getPageCursorPos(page) };
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 4 || currentSpeedProfile === 'turbo') {
    await page.mouse.move(target.x, target.y);
    setPageCursorPos(page, { ...target });
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

  if (typeof page.mouse?.move !== 'function') {
    setPageCursorPos(page, { ...target });
    return;
  }

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

  setPageCursorPos(page, { ...target });
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

  // Production VPS / DOM Mode Fast-Path:
  // Single atomic CDP round-trip for scrollIntoView + Zepto tap/DOM click without layout rect round-trips
  if (config.isProduction || config.EXECUTION_MODE === 'dom') {
    await el.evaluate((node: any) => {
      if (node) {
        if (typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
        }
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(node).trigger('tap');
        if (typeof node.click === 'function') node.click();
      }
    }).catch(() => null);

    const microJitter = 10 + Math.random() * 15;
    await new Promise(r => setTimeout(r, microJitter));
    return;
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
      if (typeof page.mouse?.move === 'function') {
        await page.mouse.move(jitterPoint.x, jitterPoint.y);
      }
      setPageCursorPos(page, jitterPoint);
    }

    // Physical click actuation (realistic microswitch hold duration: 40ms - 75ms)
    if (typeof page.mouse?.down === 'function') await page.mouse.down();
    const holdMs = currentSpeedProfile === 'turbo' ? 20 : (currentSpeedProfile === 'fast' ? 45 : 70);
    await logNormalDelay(holdMs, 0.18);
    if (typeof page.mouse?.up === 'function') await page.mouse.up();

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

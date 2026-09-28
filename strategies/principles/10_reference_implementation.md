# Principle 10: Complete Reference Implementation & Codebase Architecture

## 1. Executive Summary

This document provides a production-grade, modular reference implementation in **TypeScript** using **`puppeteer-core`** and **Fastify**. 

The code strictly enforces the architectural principles established in this repository: **zero-trust authentication**, **fail-safe Sentinel CAPTCHA freeze**, **biologically plausible human motor simulation**, and **idempotent state machine transitions**.

---

## 2. Directory & Module Architecture

```
gbf-controller/
├── src/
│   ├── config.ts              # Configuration, credentials, port bindings
│   ├── cdp-connection.ts      # Chrome DevTools Protocol session manager
│   ├── human-motor.ts         # Bézier trajectories, Gaussian jitter, log-normal delays
│   ├── sentinel-watchdog.ts   # CAPTCHA detection and emergency freeze engine
│   ├── alert-relay.ts         # Telegram / Discord webhook push notification service
│   ├── engines/
│   │   ├── pro-skip.engine.ts # Daily Pro Skip automation state machine
│   │   └── raid.engine.ts     # Raid joiner and Full Auto combat lifecycle
│   ├── gateway/
│   │   ├── server.ts          # Fastify HTTP & WebSocket server
│   │   └── screencast.ts      # Low-latency WebP viewport streamer
│   └── index.ts               # Application entrypoint & orchestrator
├── package.json
└── tsconfig.json
```

---

## 3. Core Source Code Modules

### 3.1 `src/human-motor.ts`: Biologically Plausible Motor Simulation

```typescript
import { Page, ElementHandle } from 'puppeteer-core';

interface Point {
  x: number;
  y: number;
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Box-Muller transform for standard normal distribution N(0, 1)
export function sampleGaussian(mean = 0, stdDev = 1): number {
  const u1 = Math.max(1e-6, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

// Log-normal delay generator
export async function logNormalDelay(medianMs: number, shape = 0.3): Promise<void> {
  const mu = Math.log(medianMs);
  const duration = Math.max(50, Math.exp(sampleGaussian(mu, shape)));
  await new Promise(resolve => setTimeout(resolve, duration));
}

// Cubic Bézier Point Interpolation
function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const cx = 3 * (p1.x - p0.x);
  const bx = 3 * (p2.x - p1.x) - cx;
  const ax = p3.x - p0.x - cx - bx;

  const cy = 3 * (p1.y - p0.y);
  const by = 3 * (p2.y - p1.y) - cy;
  const ay = p3.y - p0.y - cy - by;

  const tSquared = t * t;
  const tCubed = tSquared * t;

  return {
    x: ax * tCubed + bx * tSquared + cx * t + p0.x,
    y: ay * tCubed + by * tSquared + cy * t + p0.y
  };
}

// Dispatch smooth curved cursor trajectory
export async function moveMouseSmoothly(page: Page, target: Point): Promise<void> {
  // Read current position via page context or fallback
  const start: Point = { x: sampleGaussian(200, 50), y: sampleGaussian(200, 50) };
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);

  // Perpendicular control point offset
  const normPerp = { x: -dy / distance, y: dx / distance };
  const offset = sampleGaussian(0, distance * 0.2);

  const p1: Point = {
    x: start.x + dx * 0.3 + normPerp.x * offset,
    y: start.y + dy * 0.3 + normPerp.y * offset
  };
  const p2: Point = {
    x: start.x + dx * 0.7 + normPerp.x * offset * 0.6,
    y: start.y + dy * 0.7 + normPerp.y * offset * 0.6
  };

  const steps = Math.max(10, Math.min(30, Math.floor(distance / 25)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const pt = cubicBezier(start, p1, p2, target, t);
    await page.mouse.move(pt.x, pt.y);
    await new Promise(r => setTimeout(r, Math.max(5, sampleGaussian(15, 3))));
  }
}

// High-level humanized click
export async function humanizedClick(page: Page, element: ElementHandle | string): Promise<void> {
  const el = typeof element === 'string'
    ? await page.waitForSelector(element, { visible: true, timeout: 12000 })
    : element;

  if (!el) throw new Error(`Element not found for click: ${element}`);

  const box = await el.boundingBox();
  if (!box) throw new Error('Failed to compute element bounding box.');

  // Sample within safe inner 60% with Gaussian jitter
  const targetX = Math.max(box.x + 3, Math.min(box.x + box.width - 3, box.x + box.width / 2 + sampleGaussian(0, box.width * 0.15)));
  const targetY = Math.max(box.y + 3, Math.min(box.y + box.height - 3, box.y + box.height / 2 + sampleGaussian(0, box.height * 0.15)));

  await moveMouseSmoothly(page, { x: targetX, y: targetY });
  await logNormalDelay(180, 0.2);
  await page.mouse.down();
  await logNormalDelay(75, 0.15); // Natural mechanical switch depression time
  await page.mouse.up();
}
```

---

### 3.2 `src/sentinel-watchdog.ts`: Verification Watchdog & Alert Engine

```typescript
import { Page } from 'puppeteer-core';

export interface AlertTransport {
  sendEmergencyAlert(message: string, screenshotBuffer: Buffer): Promise<void>;
}

export class SentinelWatchdog {
  private isLocked = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private page: Page,
    private transport: AlertTransport
  ) {}

  public async inspectForVerification(): Promise<boolean> {
    const captchaSelectors = [
      '.prt-popup-body .img-verification',
      '.pop-usual.verification',
      'div[class*="verification"]'
    ];

    for (const selector of captchaSelectors) {
      const match = await this.page.$(selector);
      if (match) {
        return true;
      }
    }
    return false;
  }

  public async assertSafe(): Promise<void> {
    if (this.isLocked) {
      throw new Error('SENTINEL_LOCKED: Automation halted due to active CAPTCHA.');
    }

    const hasCaptcha = await this.inspectForVerification();
    if (hasCaptcha) {
      this.isLocked = true;
      console.error('[Sentinel] CRITICAL ALERT: Verification popup encountered!');
      
      const screenshot = (await this.page.screenshot({ type: 'png' })) as Buffer;
      await this.transport.sendEmergencyAlert(
        '🚨 CRITICAL: Granblue Fantasy Verification CAPTCHA Detected! Automation has been FROZEN.',
        screenshot
      );

      throw new Error('SENTINEL_HALT: Verification detected. Automation frozen.');
    }
  }

  public unlock(): void {
    this.isLocked = false;
    console.log('[Sentinel] Security lock cleared by user.');
  }

  public get isArmedAndSafe(): boolean {
    return !this.isLocked;
  }
}
```

---

### 3.3 `src/engines/pro-skip.engine.ts`: Daily Pro Skip Automation

```typescript
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog';
import { humanizedClick, logNormalDelay } from '../human-motor';

export class ProSkipEngine {
  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  public async executeMagnaPro(): Promise<{ success: boolean; message: string }> {
    await this.sentinel.assertSafe();

    // 1. Navigate to island overview
    await this.page.evaluate(() => { window.location.hash = '#quest/extra'; });
    await logNormalDelay(1400, 0.25);
    await this.sentinel.assertSafe();

    // 2. Wait for list container
    await this.page.waitForSelector('.prt-extra-list, .prt-island-list', { visible: true, timeout: 15000 });

    // 3. Locate Pro Skip Button
    const skipBtn = await this.page.$('.btn-pro-skip, div[data-location-href*="pro_skip"]');
    if (!skipBtn) {
      return { success: false, message: 'Pro Skip element not found on page.' };
    }

    // Check if already completed (0/1 attempts)
    const isCompleted = await this.page.evaluate(
      el => el.classList.contains('disable') || el.classList.contains('is-completed'),
      skipBtn
    );

    if (isCompleted) {
      return { success: true, message: 'Magna Pro is already completed for today (0/1).' };
    }

    // 4. Click Pro Skip
    await humanizedClick(this.page, skipBtn);
    await logNormalDelay(600, 0.2);
    await this.sentinel.assertSafe();

    // 5. Confirm Modal Dialogue (.pop-usual .btn-usual-ok)
    const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 10000 });
    await logNormalDelay(400, 0.15);
    await humanizedClick(this.page, confirmBtn);
    await this.sentinel.assertSafe();

    // 6. Dismiss Reward Summary Modal
    const dismissBtn = await this.page.waitForSelector(
      '.pop-usual .btn-usual-ok, .pop-usual .btn-usual-cancel, .btn-result-close',
      { visible: true, timeout: 15000 }
    );
    await logNormalDelay(800, 0.2);
    await humanizedClick(this.page, dismissBtn);

    // Return to #mypage
    await this.page.evaluate(() => { window.location.hash = '#mypage'; });
    await logNormalDelay(1200, 0.2);

    return { success: true, message: 'Magna Pro Skip successfully executed and rewards claimed.' };
  }
}
```

---

### 3.4 `src/engines/raid.engine.ts`: Raid Joiner & Full Auto

```typescript
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog';
import { humanizedClick, logNormalDelay, sampleGaussian } from '../human-motor';

export class RaidEngine {
  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  public async joinRaid(raidCode: string, preferredSummon = 'Omega'): Promise<{ success: boolean; message: string }> {
    await this.sentinel.assertSafe();

    // 1. Navigate to Assist
    await this.page.evaluate(() => { window.location.hash = '#quest/assist'; });
    await logNormalDelay(1200, 0.25);
    await this.sentinel.assertSafe();

    // 2. Switch to "Enter ID" tab
    const enterIdTab = await this.page.waitForSelector('.tab-enter-id, div[data-tab="enter_id"]', { visible: true, timeout: 10000 });
    await humanizedClick(this.page, enterIdTab);
    await logNormalDelay(600, 0.2);

    // 3. Focus and type raid code with natural key delays
    const inputField = await this.page.waitForSelector('input.frm-raid-id', { visible: true, timeout: 10000 });
    await humanizedClick(this.page, inputField);
    
    // Clear existing text
    await this.page.keyboard.down('Control');
    await this.page.keyboard.press('A');
    await this.page.keyboard.up('Control');
    await this.page.keyboard.press('Backspace');

    for (const char of raidCode.toUpperCase()) {
      await this.page.keyboard.type(char);
      await new Promise(r => setTimeout(r, Math.max(30, sampleGaussian(75, 15))));
    }

    await logNormalDelay(350, 0.2);

    // 4. Click Join / Submit
    const submitBtn = await this.page.waitForSelector('.btn-post-key', { visible: true, timeout: 10000 });
    await humanizedClick(this.page, submitBtn);
    await logNormalDelay(1500, 0.3);
    await this.sentinel.assertSafe();

    // Check for error modals (Raid dead / full)
    const errorPopup = await this.page.$('.pop-usual');
    if (errorPopup) {
      const errorText = await this.page.evaluate(el => el.textContent || '', errorPopup);
      if (errorText.includes('ended') || errorText.includes('終了') || errorText.includes('participants')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { success: false, message: `Failed to join raid: ${errorText.trim()}` };
      }
    }

    // 5. Select Supporter Summon
    await this.page.waitForSelector('.prt-supporter-list', { visible: true, timeout: 12000 });
    const summonCard = await this.page.$('.prt-supporter-list .btn-supporter');
    if (summonCard) {
      await humanizedClick(this.page, summonCard);
    }
    await logNormalDelay(1800, 0.3);
    await this.sentinel.assertSafe();

    // 6. Wait for Combat Canvas & Activate Full Auto
    await this.page.waitForSelector('.btn-attack', { visible: true, timeout: 25000 });
    const fullAutoBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto', { visible: true, timeout: 10000 });
    
    const isAlreadyActive = await this.page.evaluate(el => el.classList.contains('active'), fullAutoBtn);
    if (!isAlreadyActive) {
      await humanizedClick(this.page, fullAutoBtn);
      console.log('[RaidEngine] Full Auto engaged.');
    }

    return { success: true, message: `Successfully joined raid ${raidCode} and activated Full Auto.` };
  }
}
```

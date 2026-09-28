# Task 03: Sentinel Watchdog & Emergency Alert Relay

## 1. Task Objective
Implement the immutable safety layer: `src/sentinel-watchdog.ts` and `src/alert-relay.ts`. 

The Sentinel Watchdog is responsible for detecting Cygames' visual verification CAPTCHAs (`.img-verification`, `.pop-usual.verification`) in real time, **immediately freezing all automation**, capturing a high-resolution screenshot, and broadcasting an emergency push notification to the user's mobile device via Telegram Bot API and Discord Webhooks with rate-limiting and execution context safety.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── src/
│   ├── alert-relay.ts             # Multi-channel push notification service
│   └── sentinel-watchdog.ts       # Verification detector & emergency freeze engine
└── tests/
    └── test-sentinel-alert.ts     # Mock test for alert dispatching
```

---

## 3. Implementation Code

### 3.1 `src/alert-relay.ts`: Multi-Channel Push Notification Service

```typescript
// src/alert-relay.ts
import { config } from './config.js';

export class AlertRelay {
  private lastAlertTimestamp = 0;
  private readonly ALERT_COOLDOWN_MS = 60000; // 1-minute deduplication window

  /**
   * Broadcasts an emergency alert with an attached screenshot to configured channels.
   */
  public async sendEmergencyAlert(message: string, screenshotBuffer: Buffer): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTimestamp < this.ALERT_COOLDOWN_MS) {
      console.warn('[AlertRelay] Alert throttled to prevent spamming webhooks.');
      return;
    }
    this.lastAlertTimestamp = now;

    console.error(`[AlertRelay] 🚨 ${message}`);
    const promises: Promise<void>[] = [];

    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
      promises.push(this.sendTelegramPhoto(message, screenshotBuffer));
    }

    if (config.DISCORD_WEBHOOK_URL) {
      promises.push(this.sendDiscordWebhook(message, screenshotBuffer));
    }

    // Audible terminal bell
    process.stdout.write('\x07\x07\x07');

    await Promise.allSettled(promises);
  }

  private async sendTelegramPhoto(caption: string, imageBuffer: Buffer): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendPhoto`;
      const formData = new FormData();
      formData.append('chat_id', config.TELEGRAM_CHAT_ID!);
      formData.append('caption', caption);
      formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'verification.png');

      const res = await fetch(url, { method: 'POST', body: formData });
      if (!res.ok) {
        console.error(`[AlertRelay] Telegram dispatch failed with status: ${res.status}`);
      } else {
        console.log('[AlertRelay] Telegram photo alert sent successfully.');
      }
    } catch (err: any) {
      console.error('[AlertRelay] Telegram send error:', err.message);
    }
  }

  private async sendDiscordWebhook(content: string, imageBuffer: Buffer): Promise<void> {
    try {
      const formData = new FormData();
      formData.append('content', `🚨 **URGENT: Granblue Fantasy Verification Triggered!**\n${content}`);
      formData.append('file', new Blob([imageBuffer], { type: 'image/png' }), 'captcha.png');

      const res = await fetch(config.DISCORD_WEBHOOK_URL!, { method: 'POST', body: formData });
      if (!res.ok) {
        console.error(`[AlertRelay] Discord webhook failed with status: ${res.status}`);
      } else {
        console.log('[AlertRelay] Discord webhook alert sent successfully.');
      }
    } catch (err: any) {
      console.error('[AlertRelay] Discord send error:', err.message);
    }
  }
}
```

---

### 3.2 `src/sentinel-watchdog.ts`: Verification Watchdog & Hard Lock

```typescript
// src/sentinel-watchdog.ts
import { Page } from 'puppeteer-core';
import { AlertRelay } from './alert-relay.js';

export class SentinelWatchdog {
  private isLocked = false;
  private alertRelay: AlertRelay;

  private readonly CAPTCHA_SELECTORS = [
    '.prt-popup-body .img-verification',
    '.pop-usual.verification',
    'div[class*="verification"]',
    'div[id*="verification"]',
    '.cnt-verification'
  ];

  constructor(
    private page: Page,
    alertRelay?: AlertRelay
  ) {
    this.alertRelay = alertRelay || new AlertRelay();
  }

  /**
   * Scans the active page for any visual verification modal with context destruction protection.
   */
  public async inspectForVerification(): Promise<boolean> {
    try {
      for (const selector of this.CAPTCHA_SELECTORS) {
        const match = await this.page.$(selector);
        if (match) {
          // Double-check visibility
          const isVisible = await this.page.evaluate(el => {
            const style = window.getComputedStyle(el);
            return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          }, match).catch(() => false);

          if (isVisible) return true;
        }
      }
    } catch (e: any) {
      // Catch transient "Execution context was destroyed" during page transitions
      return false;
    }
    return false;
  }

  /**
   * Evaluates safety invariant. Must be called before EVERY click and navigation.
   * Throws an error to immediately abort execution if verification is present or locked.
   */
  public async assertSafe(): Promise<void> {
    if (this.isLocked) {
      throw new Error('SENTINEL_LOCKED: Automation frozen awaiting human manual resolution.');
    }

    const hasCaptcha = await this.inspectForVerification();
    if (hasCaptcha) {
      this.isLocked = true;
      console.error('[Sentinel] 🚨 CRITICAL: Visual verification challenge detected!');

      try {
        const screenshot = (await this.page.screenshot({ type: 'png' })) as Buffer;
        await this.alertRelay.sendEmergencyAlert(
          'Verification CAPTCHA detected on desktop! Automation has been HARD-FROZEN. Please solve the puzzle in your browser.',
          screenshot
        );
      } catch (err: any) {
        console.error('[Sentinel] Failed to capture screenshot:', err.message);
      }

      throw new Error('SENTINEL_HALT: Captcha detected. Execution terminated.');
    }
  }

  /**
   * Clears the lock after the user manually solves the challenge.
   */
  public unlock(): void {
    this.isLocked = false;
    console.log('[Sentinel] Lock released. Automation re-armed.');
  }

  public get isArmed(): boolean {
    return !this.isLocked;
  }
}
```

---

## 4. Verification & Testing Protocol

Create `tests/test-sentinel-alert.ts`:
```typescript
import { AlertRelay } from '../src/alert-relay.js';

console.log('--- Testing Alert Relay Dispatch ---');
const relay = new AlertRelay();

// Create a dummy 1x1 pixel PNG buffer for testing
const dummyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

await relay.sendEmergencyAlert('Test alert from GBF Sentinel Watchdog verification test.', dummyPng);
console.log('Alert Relay test completed.');
```

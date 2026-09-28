# Principle 05: Technical Implementation Roadmap & Execution Plan

## 1. Executive Summary

This roadmap provides a phased, battle-tested engineering blueprint for developing the Granblue Fantasy remote controller and automation system. The implementation emphasizes **modularity**, **zero-trust authentication**, **fail-safe human-in-the-loop triggers**, and **low-latency mobile synchronization**.

---

## 2. Technology Stack & Architectural Justification

| Architectural Layer | Selected Technology | Technical Justification |
| :--- | :--- | :--- |
| **Language & Runtime** | **Node.js (v20+) or Bun** + **TypeScript** | Async/await primitives for state machines, high-throughput non-blocking WebSocket I/O, strict type safety. |
| **Browser Driver** | **`puppeteer-core`** | Attaches via Chrome DevTools Protocol (`browserURL: 'http://127.0.0.1:9222'`). Zero browser binaries to download, zero driver signature footprints. |
| **Gateway Web Framework** | **Fastify** or **Hono** + `ws` | Industry-leading HTTP/WebSocket benchmark performance, built-in schema validation, minimal memory footprint. |
| **Remote Companion UI** | **Vanilla HTML5 + Modern CSS + JS** | Responsive PWA, instant mobile render without complex bundle overhead. |
| **Alert Transport** | **Telegram Bot API** & **Discord Webhook** | Zero-cost, instantaneous push notifications with multi-part image attachments delivered directly to smartphones. |
| **Process Daemon** | **PM2** or **NSSM (Non-Sucking Service Manager)** | Auto-restarts daemon on crash, manages background Windows service lifecycle. |

---

## 3. Phased Implementation Roadmap

```
+-----------------------------------------------------------------------------------------+
|                                   Engineering Timeline                                  |
+-----------------------------------------------------------------------------------------+

 Phase 1: CDP Foundation & Profile Attachment
   [x] Windows Chrome startup script with remote debugging port 9222.
   [x] CDP connection discovery and active tab binding (`puppeteer-core`).
   [x] Session persistence validation without re-login.

 Phase 2: Safety Sentinel & Human Motor Simulation Engine
   [x] Real-time DOM verification detector (`.img-verification`).
   [x] Telegram / Discord emergency alert relay with snapshot attachment.
   [x] 2D Gaussian spatial jitter & cubic Bézier mouse movement engine.
   [x] Log-normal latency generator for delays.

 Phase 3: Daily Pro Skip Orchestration
   [x] Navigation and DOM readiness hooks for `#quest/extra` and `#quest/island`.
   [x] Pro Skip button availability and state evaluation (0/1 check).
   [x] AP balance verification and automated Half-Elixir replenishment.
   [x] Modal confirmation and loot screen dismissal.

 Phase 4: Raid Joining & Combat Lifecycle
   [x] Navigation to `#quest/assist/enter_id` and raid code injection.
   [x] Supporter summon selection with priority matching (Omega/Optimus).
   [x] Combat initialization detection (`#raid` / `#multiraid`).
   [x] Full Auto engagement (`.btn-auto` / `.btn-ability-auto`).
   [x] Combat monitoring loop (Boss HP polling, turn counters, victory screen).

 Phase 5: Remote Gateway & Mobile Companion Dashboard
   [x] Fastify WebSocket server with Bearer token authentication.
   [x] Real-time telemetry broadcasting (AP, EP, Current Route, Combat State).
   [x] Low-latency WebP screencast streamer (2-3 FPS adaptive).
   [x] Mobile responsive PWA with one-touch triggers and emergency stop.
```

---

## 4. Phase-by-Phase Technical Specifications & Blueprints

### Phase 1: Chrome Launch Script & CDP Binding

Create a dedicated Windows launch script: `launch-gbf-chrome.ps1`
```powershell
# launch-gbf-chrome.ps1
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$userDataDir = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$targetUrl = "https://game.granbluefantasy.jp/#mypage"

# Launch Chrome with DevTools Protocol enabled on loopback
Start-Process -FilePath $chromePath -ArgumentList @(
    "--remote-debugging-port=9222",
    "--user-data-dir=`"$userDataDir`"",
    "--no-first-run",
    "--no-default-browser-check",
    "`"$targetUrl`""
)
```

TypeScript CDP connection manager:
```typescript
import puppeteer, { Browser, Page } from 'puppeteer-core';

export async function connectToGBF(): Promise<{ browser: Browser; page: Page }> {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null
  });

  const pages = await browser.pages();
  const gbfPage = pages.find(p => p.url().includes('granbluefantasy.jp'));

  if (!gbfPage) {
    throw new Error('Granblue Fantasy tab not found in active browser instance.');
  }

  // Set standard mobile-friendly viewport emulation if desired, or leave native
  console.log(`[CDP] Attached to GBF Page: ${await gbfPage.title()}`);
  return { browser, page: gbfPage };
}
```

---

### Phase 2: Safety Sentinel & Behavioral Motor Simulation

```typescript
// sentinel.ts
import { Page } from 'puppeteer-core';

export class SentinelWatchdog {
  private isLocked = false;

  constructor(
    private page: Page,
    private onAlert: (screenshot: Buffer) => Promise<void>
  ) {}

  public async assertSafe(): Promise<void> {
    if (this.isLocked) {
      throw new Error('SENTINEL_LOCKED: Manual resolution required.');
    }

    const verification = await this.page.$(
      '.prt-popup-body .img-verification, .pop-usual.verification, div[class*="verification"]'
    );

    if (verification) {
      this.isLocked = true;
      console.error('CRITICAL: Verification CAPTCHA detected! Freezing all input.');
      const screenshot = await this.page.screenshot({ type: 'png' });
      await this.onAlert(screenshot);
      throw new Error('SENTINEL_ALERT: Captcha detected. Awaiting human solve.');
    }
  }

  public unlock(): void {
    this.isLocked = false;
    console.log('[Sentinel] Manually unlocked by user.');
  }
}
```

---

### Phase 3: Pro Skip Execution Blueprint

```typescript
// pro-skip.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from './sentinel';
import { humanizedClick, randomGaussianDelay } from './human-input';

export async function executeMagnaProSkip(page: Page, sentinel: SentinelWatchdog): Promise<boolean> {
  await sentinel.assertSafe();

  // 1. Navigate to island overview
  await page.evaluate(() => { window.location.hash = '#quest/extra'; });
  await randomGaussianDelay(1200, 200);
  await sentinel.assertSafe();

  // 2. Wait for extra list container
  await page.waitForSelector('.prt-extra-list, .prt-island-list', { visible: true, timeout: 15000 });

  // 3. Find Magna Pro button
  const proSkipBtn = await page.$('.btn-pro-skip, div[data-location-href*="pro_skip"]');
  if (!proSkipBtn) {
    console.log('[ProSkip] Pro Skip button not present. Quests may already be cleared.');
    return false;
  }

  // Check if disabled
  const isDisabled = await page.evaluate(el => el.classList.contains('disable') || el.classList.contains('is-completed'), proSkipBtn);
  if (isDisabled) {
    console.log('[ProSkip] Magna Pro already cleared today (0/1).');
    return false;
  }

  // 4. Click Pro Skip
  await humanizedClick(page, proSkipBtn);
  await sentinel.assertSafe();

  // 5. Handle Confirmation Modal
  const okBtn = await page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 10000 });
  await randomGaussianDelay(600, 100);
  await humanizedClick(page, okBtn);
  await sentinel.assertSafe();

  // 6. Dismiss Reward Summary Modal
  const dismissBtn = await page.waitForSelector('.pop-usual .btn-usual-ok, .pop-usual .btn-usual-cancel', { visible: true, timeout: 15000 });
  await randomGaussianDelay(800, 150);
  await humanizedClick(page, dismissBtn);

  console.log('[ProSkip] Magna Pro successfully executed.');
  return true;
}
```

---

## 5. Deployment & Production Operations

### PM2 Process Manager Configuration
Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [
    {
      name: 'gbf-remote-gateway',
      script: './dist/server.js',
      cwd: 'C:/laragon/www/gbf',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        AUTH_TOKEN: 'your-secure-random-bearer-token'
      }
    }
  ]
};
```

Run via PowerShell:
```powershell
pm2 start ecosystem.config.js
pm2 save
```

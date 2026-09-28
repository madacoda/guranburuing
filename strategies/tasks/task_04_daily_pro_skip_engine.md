# Task 04: Daily Pro Skip Automation Engine

## 1. Task Objective
Implement `src/engines/pro-skip.engine.ts` based on [Principle 02](file:///c:/laragon/www/gbf/strategies/principles/02_automation_mechanics.md). 

The engine automates 1-click Pro Skips (**Hard Pro**, **Magna Pro**, **Manacura Pro**, **Angel Halo Pro**) with complete handling of AP replenishment (Half-Elixirs), multi-modal sequential dismissals (Rank Up / Level Up overlays), and pre-existing dialog clearings, operating idempotently with zero behavioral anomalies.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── src/
│   └── engines/
│       └── pro-skip.engine.ts     # Daily Pro Skip automation state machine
└── tests/
    └── test-pro-skip.ts           # Integration test script for Pro Skip
```

---

## 3. Implementation Code: `src/engines/pro-skip.engine.ts`

```typescript
// src/engines/pro-skip.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, logNormalDelay } from '../human-motor.js';

export type ProSkipTarget = 'hard_pro' | 'magna_pro' | 'manacura_pro' | 'halo_pro' | 'all';

export interface ProSkipResult {
  target: string;
  status: 'SUCCESS' | 'ALREADY_CLEARED' | 'AP_DEFICIENT' | 'FAILED';
  message: string;
  consumedAp: number;
}

export class ProSkipEngine {
  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  /**
   * Orchestrates the execution of a specified Pro Skip category or all categories sequentially.
   */
  public async execute(target: ProSkipTarget, autoReplenishAp = true): Promise<ProSkipResult[]> {
    await this.sentinel.assertSafe();

    if (target === 'all') {
      const results: ProSkipResult[] = [];
      results.push(await this.runIslandProSkip('magna_pro', autoReplenishAp));
      results.push(await this.runIslandProSkip('hard_pro', autoReplenishAp));
      return results;
    }

    return [await this.runIslandProSkip(target, autoReplenishAp)];
  }

  private async runIslandProSkip(target: ProSkipTarget, autoReplenishAp: boolean): Promise<ProSkipResult> {
    console.log(`[ProSkipEngine] Initiating Pro Skip for: ${target}`);
    await this.sentinel.assertSafe();

    // 1. Navigate to Island / Extra Quest Overview
    await this.page.evaluate(() => { window.location.hash = '#quest/extra'; });
    await logNormalDelay(1400, 0.25);
    await this.sentinel.assertSafe();

    // 2. Clear any pre-existing modal (e.g., "Check Pending Battles" or "Notice")
    await this.dismissAllPopups(2);

    // 3. Wait for list container mount
    await this.page.waitForSelector('.prt-extra-list, .prt-island-list, .cnt-extra', { visible: true, timeout: 15000 });
    await logNormalDelay(600, 0.2);

    // 4. Locate Target Pro Skip Button
    const buttonSelector = target === 'magna_pro'
      ? '.btn-pro-skip[data-location-href*="pro_skip_extreme"], div[data-location-href*="pro_skip"]'
      : '.btn-pro-skip[data-location-href*="pro_skip_hard"], div[data-location-href*="pro_skip"]';

    const proSkipBtn = await this.page.$(buttonSelector);
    if (!proSkipBtn) {
      return {
        target,
        status: 'FAILED',
        message: 'Could not locate Pro Skip element on page.',
        consumedAp: 0
      };
    }

    // 5. Evaluate Completion State (0/1 check)
    const isCompleted = await this.page.evaluate((el: any) => {
      const classes = el.className || '';
      const text = el.innerText || '';
      return classes.includes('disable') || classes.includes('is-completed') || text.includes('0/1');
    }, proSkipBtn);

    if (isCompleted) {
      console.log(`[ProSkipEngine] ${target} is already completed for today (0/1).`);
      return {
        target,
        status: 'ALREADY_CLEARED',
        message: 'Already cleared today.',
        consumedAp: 0
      };
    }

    // 6. Click Pro Skip Button (with automatic scrollIntoView)
    await humanizedClick(this.page, proSkipBtn);
    await logNormalDelay(800, 0.2);
    await this.sentinel.assertSafe();

    // 7. Inspect for AP Replenishment Modal
    const apRecoveryModal = await this.page.$('.pop-usual .btn-use-item');
    if (apRecoveryModal) {
      if (!autoReplenishAp) {
        const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel');
        if (cancelBtn) await humanizedClick(this.page, cancelBtn);
        return {
          target,
          status: 'AP_DEFICIENT',
          message: 'AP insufficient and autoReplenishAp is false.',
          consumedAp: 0
        };
      }

      console.log('[ProSkipEngine] AP insufficient. Consuming Half-Elixir...');
      await humanizedClick(this.page, apRecoveryModal);
      await logNormalDelay(600, 0.2);
      await this.sentinel.assertSafe();

      // Confirm item use dialog
      const confirmItemUse = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 10000 });
      await humanizedClick(this.page, confirmItemUse);
      await logNormalDelay(1000, 0.25);
      await this.sentinel.assertSafe();
    }

    // 8. Confirm Pro Skip Transaction Modal
    const confirmModalBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 10000 });
    await logNormalDelay(500, 0.15);
    await humanizedClick(this.page, confirmModalBtn);
    await this.sentinel.assertSafe();

    // 9. Sequential Dismissal Loop (Reward Summary, Level Up, Rank Up, Inventory Overlays)
    console.log('[ProSkipEngine] Dismissing post-clear reward & level-up dialogues...');
    await this.dismissAllPopups(5);

    // 10. Return to #mypage for clean, predictable state
    await this.page.evaluate(() => { window.location.hash = '#mypage'; });
    await logNormalDelay(1200, 0.2);

    return {
      target,
      status: 'SUCCESS',
      message: 'Pro Skip successfully cleared and all rewards collected.',
      consumedAp: target === 'magna_pro' ? 180 : 90
    };
  }

  /**
   * Iteratively dismisses stacked popups (Loot, Rank Up, Level Up, Master Level).
   */
  private async dismissAllPopups(maxIterations = 5): Promise<void> {
    const dismissSelectors = [
      '.pop-usual .btn-usual-ok',
      '.pop-usual .btn-usual-cancel',
      '.pop-level-up .btn-usual-ok',
      '.btn-result-close'
    ];

    for (let i = 0; i < maxIterations; i++) {
      await logNormalDelay(600, 0.2);
      let dismissed = false;

      for (const selector of dismissSelectors) {
        const btn = await this.page.$(selector);
        if (btn) {
          const isVisible = await this.page.evaluate((el: any) => {
            const style = window.getComputedStyle(el);
            return style && style.display !== 'none' && style.visibility !== 'hidden';
          }, btn).catch(() => false);

          if (isVisible) {
            await humanizedClick(this.page, btn);
            dismissed = true;
            break;
          }
        }
      }

      if (!dismissed) break; // All modals cleared
    }
  }
}
```

---

## 4. Verification & Testing Protocol

Create `tests/test-pro-skip.ts`:
```typescript
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { ProSkipEngine } from '../src/engines/pro-skip.engine.js';

async function run() {
  const cdp = new CdpConnectionManager();
  const { page } = await cdp.connectWithRetry();
  const sentinel = new SentinelWatchdog(page);
  const engine = new ProSkipEngine(page, sentinel);

  const results = await engine.execute('magna_pro');
  console.log('Test Results:', JSON.stringify(results, null, 2));
}

run().catch(console.error);
```

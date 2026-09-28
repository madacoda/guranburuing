# Task 05: Raid Joiner & Full Auto Combat Engine

## 1. Task Objective
Implement `src/engines/raid.engine.ts` based on [Principle 02](file:///c:/laragon/www/gbf/strategies/principles/02_automation_mechanics.md) and [Principle 06](file:///c:/laragon/www/gbf/strategies/principles/06_combat_engine_v1_v2.md). 

The engine automates joining raids using 8-character backup codes, handles edge-case popups (dead raids, full rooms, pending battle limits, party wipeout), selects supporter summons across elemental tabs, engages native Full Auto, and incorporates an **anti-hang auto-refresh watchdog**.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── src/
│   └── engines/
│       └── raid.engine.ts         # Raid joiner and Full Auto combat lifecycle
└── tests/
    └── test-raid-engine.ts        # Test runner for raid joining
```

---

## 3. Implementation Code: `src/engines/raid.engine.ts`

```typescript
// src/engines/raid.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, humanizedType, logNormalDelay } from '../human-motor.js';

export interface RaidJoinOptions {
  raidCode: string;
  element?: number; // 1: Fire, 2: Water, 3: Earth, 4: Wind, 5: Light, 6: Dark, 7: Misc
  preferredSummon?: string;
  enableFullAuto?: boolean;
  autoReplenishEp?: boolean;
}

export interface RaidCombatResult {
  status: 'SUCCESS' | 'RAID_EXPIRED' | 'ROOM_FULL' | 'PENDING_LIMIT' | 'EP_DEFICIENT' | 'PARTY_WIPED' | 'FAILED';
  raidCode: string;
  turnsElapsed?: number;
  message: string;
}

export class RaidEngine {
  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  /**
   * Joins a raid by code, selects supporter summon, and engages Full Auto.
   */
  public async joinAndFight(options: RaidJoinOptions): Promise<RaidCombatResult> {
    const {
      raidCode,
      element = 1,
      preferredSummon = 'Omega',
      enableFullAuto = true,
      autoReplenishEp = true
    } = options;

    console.log(`[RaidEngine] Joining raid with code: ${raidCode}`);
    await this.sentinel.assertSafe();

    // 1. Navigate to Raid Assist Overview
    await this.page.evaluate(() => { window.location.hash = '#quest/assist'; });
    await logNormalDelay(1200, 0.25);
    await this.sentinel.assertSafe();

    // 2. Switch to "Enter ID" tab
    const enterIdTab = await this.page.waitForSelector('.tab-enter-id, div[data-tab="enter_id"]', { visible: true, timeout: 10000 });
    await humanizedClick(this.page, enterIdTab);
    await logNormalDelay(600, 0.2);
    await this.sentinel.assertSafe();

    // 3. Clear and Type Raid Code
    const inputSelector = 'input.frm-raid-id';
    await humanizedClick(this.page, inputSelector);
    
    // Select all existing text and delete
    await this.page.keyboard.down('Control');
    await this.page.keyboard.press('A');
    await this.page.keyboard.up('Control');
    await this.page.keyboard.press('Backspace');

    await humanizedType(this.page, inputSelector, raidCode.trim().toUpperCase());
    await logNormalDelay(350, 0.2);

    // 4. Click Join / Submit Button (.btn-post-key)
    const submitBtn = await this.page.waitForSelector('.btn-post-key', { visible: true, timeout: 10000 });
    await humanizedClick(this.page, submitBtn);
    await logNormalDelay(1500, 0.3);
    await this.sentinel.assertSafe();

    // 5. Inspect for Join Exceptions (Raid dead, room full, pending limit, EP modal)
    const modal = await this.page.$('.pop-usual');
    if (modal) {
      const modalText = await this.page.evaluate((el: any) => el.innerText || '', modal);

      // Check if pending battles limit reached
      if (modalText.includes('pending') || modalText.includes('未確認')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { status: 'PENDING_LIMIT', raidCode, message: 'Unclaimed pending battles limit reached (max 5).' };
      }

      // Check if raid ended
      if (modalText.includes('ended') || modalText.includes('終了')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { status: 'RAID_EXPIRED', raidCode, message: 'This battle has already ended.' };
      }

      // Check if room full
      if (modalText.includes('participants') || modalText.includes('参戦人数')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { status: 'ROOM_FULL', raidCode, message: 'Maximum participants limit reached.' };
      }

      // Check if EP recovery modal
      const useItemBtn = await this.page.$('.pop-usual .btn-use-item');
      if (useItemBtn) {
        if (!autoReplenishEp) {
          const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel');
          if (cancelBtn) await humanizedClick(this.page, cancelBtn);
          return { status: 'EP_DEFICIENT', raidCode, message: 'EP is insufficient.' };
        }

        console.log('[RaidEngine] EP depleted. Consuming Soul Berry...');
        await humanizedClick(this.page, useItemBtn);
        await logNormalDelay(600, 0.2);
        const confirmUse = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 10000 });
        await humanizedClick(this.page, confirmUse);
        await logNormalDelay(1200, 0.25);
        await this.sentinel.assertSafe();
      }
    }

    // 6. Select Supporter Summon (#quest/supporter/...)
    await this.page.waitForSelector('.prt-supporter-list', { visible: true, timeout: 15000 });
    await logNormalDelay(600, 0.2);

    // Switch to target elemental tab if needed
    if (element >= 1 && element <= 7) {
      const elementTab = await this.page.$(`.btn-supporter-element[data-element="${element}"]`);
      if (elementTab) {
        await humanizedClick(this.page, elementTab);
        await logNormalDelay(500, 0.15);
      }
    }

    // Pick top matching summon card
    const summonCard = await this.page.$('.prt-supporter-list .btn-supporter');
    if (summonCard) {
      await humanizedClick(this.page, summonCard);
    }
    await logNormalDelay(1800, 0.3);
    await this.sentinel.assertSafe();

    // 7. Wait for Combat Engine Mount (.btn-attack)
    await this.page.waitForSelector('.btn-attack', { visible: true, timeout: 30000 });
    console.log('[RaidEngine] Combat stage loaded successfully.');

    // 8. Engage Full Auto
    if (enableFullAuto) {
      await this.ensureFullAutoEngaged();
    }

    // 9. Monitor Combat Loop with Anti-Hang Auto-Refresh
    return await this.monitorCombatUntilVictory(raidCode, enableFullAuto);
  }

  private async ensureFullAutoEngaged(): Promise<void> {
    await logNormalDelay(600, 0.2);
    const fullAutoBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto', { visible: true, timeout: 10000 });
    const isActive = await this.page.evaluate((el: any) => el.classList.contains('active'), fullAutoBtn);
    
    if (!isActive) {
      await humanizedClick(this.page, fullAutoBtn);
      console.log('[RaidEngine] Full Auto engaged.');
    }
  }

  private async monitorCombatUntilVictory(raidCode: string, enableFullAuto: boolean): Promise<RaidCombatResult> {
    console.log('[RaidEngine] Monitoring combat loop...');
    const maxDurationMs = 15 * 60 * 1000; // 15-minute watchdog limit
    const startTime = Date.now();
    let lastActivityTime = Date.now();

    while (Date.now() - startTime < maxDurationMs) {
      await this.sentinel.assertSafe();

      // Check for navigation to Result screen
      const currentUrl = this.page.url();
      if (currentUrl.includes('#result_multi') || currentUrl.includes('#result')) {
        console.log('[RaidEngine] Victory detected! Processing result screen...');
        await logNormalDelay(1500, 0.25);

        // Dismiss completion dialogs
        const closeBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close');
        if (closeBtn) await humanizedClick(this.page, closeBtn);

        return {
          status: 'SUCCESS',
          raidCode,
          message: 'Raid completed successfully.'
        };
      }

      // Check for party wipeout modal ("All party members have fallen")
      const wipeoutModal = await this.page.$('.pop-usual');
      if (wipeoutModal) {
        const text = await this.page.evaluate((el: any) => el.innerText || '', wipeoutModal);
        if (text.includes('fallen') || text.includes('全滅') || text.includes('elixir')) {
          console.warn('[RaidEngine] Party wiped out in combat.');
          const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel, .pop-usual .btn-usual-ok');
          if (cancelBtn) await humanizedClick(this.page, cancelBtn);
          return { status: 'PARTY_WIPED', raidCode, message: 'All party members were defeated.' };
        }
      }

      // Check for raid finished popup inside raid canvas (.pop-raid-result)
      const raidResultPopup = await this.page.$('.pop-raid-result .btn-usual-ok');
      if (raidResultPopup) {
        console.log('[RaidEngine] Raid outcome popup detected. Dismissing...');
        await humanizedClick(this.page, raidResultPopup);
        lastActivityTime = Date.now();
      }

      // Anti-Hang Desync Watchdog (Refresh after 60s of complete stagnation)
      if (Date.now() - lastActivityTime > 60000) {
        console.warn('[RaidEngine] Combat turn stagnant for >60s. Refreshing page to resolve desync...');
        await this.page.evaluate(() => location.reload());
        await this.page.waitForSelector('.btn-attack', { visible: true, timeout: 25000 });
        if (enableFullAuto) {
          await this.ensureFullAutoEngaged();
        }
        lastActivityTime = Date.now();
      }

      await logNormalDelay(2500, 0.2);
    }

    return {
      status: 'FAILED',
      raidCode,
      message: 'Raid watchdog timed out after 15 minutes.'
    };
  }
}
```

---

## 4. Verification & Testing Protocol

Create `tests/test-raid-engine.ts`:
```typescript
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { RaidEngine } from '../src/engines/raid.engine.js';

async function testJoin() {
  const cdp = new CdpConnectionManager();
  const { page } = await cdp.connectWithRetry();
  const sentinel = new SentinelWatchdog(page);
  const raidEngine = new RaidEngine(page, sentinel);

  // Test with dummy/sample raid code
  const result = await raidEngine.joinAndFight({ raidCode: '1A2B3C4D', element: 4 }); // Wind element
  console.log('Raid Result:', result);
}

testJoin().catch(console.error);
```

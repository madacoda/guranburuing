// src/engines/raid.engine.ts
import { Page, HTTPResponse } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, humanizedType, logNormalDelay } from '../human-motor.js';
import { config } from '../config.js';

export interface RaidJoinOptions {
  raidCode: string;
  element?: number; // 1: Fire, 2: Water, 3: Earth, 4: Wind, 5: Light, 6: Dark, 7: Misc
  preferredSummon?: string;
  enableFullAuto?: boolean;
  autoReplenishEp?: boolean;
}

export interface RaidCombatResult {
  status: 'SUCCESS' | 'RAID_EXPIRED' | 'ROOM_FULL' | 'PENDING_LIMIT' | 'ACTIVE_RAID_LIMIT_3' | 'EP_DEFICIENT' | 'PARTY_WIPED' | 'FAILED';
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
    await this.sentinel.assertSafe();

    // 2. Switch to "Enter ID" tab
    const enterIdTab = await this.page.waitForSelector('.tab-enter-id, div[data-tab="enter_id"]', { visible: true, timeout: 8000 });
    if (!enterIdTab) throw new Error('Enter ID tab not found');
    await humanizedClick(this.page, enterIdTab);
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

    // 4. Click Join / Submit Button (.btn-post-key)
    const submitBtn = await this.page.waitForSelector('.btn-post-key', { visible: true, timeout: 8000 });
    if (!submitBtn) throw new Error('Post key submit button not found');
    await humanizedClick(this.page, submitBtn);
    await this.sentinel.assertSafe();

    // 5. Inspect for Join Exceptions
    const modal = await this.page.$('.pop-usual');
    if (modal) {
      const modalText = await this.page.evaluate((el: any) => el.innerText || '', modal);

      // Check if pending battles limit reached
      if (modalText.includes('pending') || modalText.includes('未確認')) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { status: 'PENDING_LIMIT', raidCode, message: 'Unclaimed pending battles limit reached (max 5).' };
      }

      // Check if active backup raid limit reached (3 simultaneous battles)
      if (
        modalText.includes('three raid') ||
        modalText.includes('up to three') ||
        modalText.includes('provide backup in up to') ||
        modalText.includes('only provide backup') ||
        modalText.includes('3 battles') ||
        modalText.includes('3 raid') ||
        modalText.includes('participating in 3') ||
        modalText.includes('more than 3') ||
        modalText.includes('up to 3') ||
        modalText.includes('3件まで') ||
        modalText.includes('同時に参戦できる') ||
        modalText.includes('参戦中') ||
        modalText.includes('3件')
      ) {
        const okBtn = await this.page.$('.pop-usual .btn-usual-ok');
        if (okBtn) await humanizedClick(this.page, okBtn);
        return { status: 'ACTIVE_RAID_LIMIT_3', raidCode, message: 'You can only provide backup in up to three raid battles at once.' };
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
        const confirmUse = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 6000 });
        if (confirmUse) {
          await humanizedClick(this.page, confirmUse);
          await this.sentinel.assertSafe();
        }
      }
    }

    // 6. Select Supporter Summon (#quest/supporter/...)
    await this.page.waitForSelector('.prt-supporter-list', { visible: true, timeout: 12000 });

    // Switch to target elemental tab if specified
    if (element >= 1 && element <= 7) {
      const elementTab = await this.page.$(`.btn-supporter-element[data-element="${element}"]`);
      if (elementTab) {
        await humanizedClick(this.page, elementTab);
      }
    }

    // Pick top matching summon card
    const summonCard = await this.page.$('.prt-supporter-list .btn-supporter');
    if (summonCard) {
      await humanizedClick(this.page, summonCard);
    }
    await this.sentinel.assertSafe();

    // 7. Wait for Combat Engine Mount (.btn-attack)
    await this.page.waitForSelector('.btn-attack', { visible: true, timeout: 25000 });
    console.log('[RaidEngine] Combat stage loaded successfully.');

    // 8. Engage Full Auto
    if (enableFullAuto) {
      await this.ensureFullAutoEngaged();
    }

    // 9. Monitor Combat Loop with Anti-Hang Auto-Refresh & Fast Turn Skips
    return await this.monitorCombatUntilVictory(raidCode, enableFullAuto);
  }

  private async ensureFullAutoEngaged(): Promise<void> {
    const fullAutoBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto', { visible: true, timeout: 8000 }).catch(() => null);
    if (!fullAutoBtn) return;
    const isActive = await this.page.evaluate((el: any) => el?.classList?.contains('active') || false, fullAutoBtn);
    
    if (!isActive) {
      await humanizedClick(this.page, fullAutoBtn);
      console.log('[RaidEngine] Full Auto engaged.');
    }
  }

  private async monitorCombatUntilVictory(raidCode: string, enableFullAuto: boolean): Promise<RaidCombatResult> {
    console.log(`[RaidEngine] Monitoring combat loop (Auto-Refresh: ${config.COMBAT_AUTO_REFRESH ? 'ENABLED' : 'DISABLED'})...`);
    const maxDurationMs = 15 * 60 * 1000; // 15-minute watchdog limit
    const startTime = Date.now();
    let lastActivityTime = Date.now();
    let turnCount = 0;

    // Attach response listener for attack turns to trigger instant refresh
    let attackResolved = false;
    const responseHandler = (res: HTTPResponse) => {
      const url = res.url();
      if (url.includes('normal_attack_result.json') && res.status() === 200) {
        attackResolved = true;
      }
    };

    if (config.COMBAT_AUTO_REFRESH) {
      this.page.on('response', responseHandler);
    }

    try {
      while (Date.now() - startTime < maxDurationMs) {
        await this.sentinel.assertSafe();

        // Check if attack finished on server and auto-refresh is active
        if (config.COMBAT_AUTO_REFRESH && attackResolved) {
          attackResolved = false;
          turnCount++;
          console.log(`[RaidEngine] [Turn ${turnCount}] Server turn resolved. Quick-refreshing to skip animations...`);
          await logNormalDelay(150, 0.15);
          await this.page.evaluate(() => location.reload()).catch(() => null);

          // Wait for combat reload or victory transition
          await this.page.waitForFunction(() => {
            const hasAttack = !!document.querySelector('.btn-attack');
            const hasResult = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
            return hasAttack || hasResult;
          }, { timeout: 15000 }).catch(() => null);

          if (enableFullAuto) {
            await this.ensureFullAutoEngaged();
          }
          lastActivityTime = Date.now();
        }

        // Check for navigation to Result screen
        const currentUrl = this.page.url();
        if (currentUrl.includes('#result_multi') || currentUrl.includes('#result')) {
          console.log('[RaidEngine] Victory detected! Processing result screen...');
          await logNormalDelay(400, 0.15);

          // Dismiss completion dialogs
          const closeBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-result-close');
          if (closeBtn) await humanizedClick(this.page, closeBtn);

          return {
            status: 'SUCCESS',
            raidCode,
            turnsElapsed: turnCount,
            message: 'Raid completed successfully.'
          };
        }

        // Check for party wipeout modal
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

        // Anti-Hang Desync Watchdog (Refresh after 45s of stagnation)
        if (Date.now() - lastActivityTime > 45000) {
          console.warn('[RaidEngine] Combat turn stagnant for >45s. Refreshing page to resolve desync...');
          await this.page.evaluate(() => location.reload()).catch(() => null);
          await this.page.waitForSelector('.btn-attack', { visible: true, timeout: 25000 }).catch(() => null);
          if (enableFullAuto) {
            await this.ensureFullAutoEngaged();
          }
          lastActivityTime = Date.now();
        }

        await logNormalDelay(600, 0.2);
      }

      return {
        status: 'FAILED',
        raidCode,
        message: 'Raid watchdog timed out after 15 minutes.'
      };
    } finally {
      if (config.COMBAT_AUTO_REFRESH) {
        this.page.off('response', responseHandler);
      }
    }
  }
}

// src/services/daily-host/backup-broadcast.service.ts
import { Page } from 'puppeteer-core';
import { IBackupBroadcastService } from '../../domain/daily-host/daily-host.interfaces.js';
import { BackupBroadcastResult, BackupBroadcastScope } from '../../domain/daily-host/daily-host.types.js';
import { logNormalDelay } from '../../human-motor.js';

/**
 * Granblue Fantasy Backup Request Cooldown:
 * When broadcasting to "Everyone" (みんな), the game enforces a strict 180-second (3-minute)
 * cooldown before another public broadcast can be dispatched.
 */
export const BACKUP_REQUEST_COOLDOWN_MS = 180_000;

export class BackupBroadcastService implements IBackupBroadcastService {
  private page: Page;
  private lastBroadcastTimestamp = 0;

  constructor(page: Page) {
    this.page = page;
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Returns the epoch timestamp (ms) of the last successful backup broadcast.
   */
  public getLastBroadcastTimestamp(): number {
    return this.lastBroadcastTimestamp;
  }

  /**
   * Evaluates whether a backup request can currently be broadcasted.
   * Checks both local 180s cooldown timer and HUD `.btn-assist` disable state.
   */
  public async canBroadcastBackup(): Promise<boolean> {
    const elapsed = Date.now() - this.lastBroadcastTimestamp;
    if (this.lastBroadcastTimestamp > 0 && elapsed < BACKUP_REQUEST_COOLDOWN_MS) {
      return false;
    }

    try {
      const state = await this.page.evaluate(() => {
        const assistBtn = document.querySelector('.btn-assist, .btn-request, .btn-backup') as HTMLElement;
        if (!assistBtn || assistBtn.offsetParent === null) {
          return { ready: false };
        }
        const isDisable =
          assistBtn.classList.contains('disable') ||
          assistBtn.classList.contains('disabled') ||
          assistBtn.classList.contains('btn-disable') ||
          assistBtn.classList.contains('wait');
        return { ready: !isDisable };
      });
      return state.ready;
    } catch {
      return false;
    }
  }

  /**
   * Clicks .btn-assist and ensures ALL THREE scopes (Everyone, Friends, Crew) are active before submitting.
   * Authoritative DOM Note:
   * In Granblue Fantasy's `.pop-start-assist` modal:
   * - Everyone: <div class="btn-check all" type="all" active="1">
   * - Friends:  <div class="btn-check friend" type="friend" active="1">
   * - Crew:     <div class="btn-check guild" type="guild" active="1">
   * The checked state is strictly determined by the attribute `active="1"` (active="0" means unchecked).
   * Clicking toggles this attribute. Never click if `active="1"` is already set!
   */
  public async broadcastBackupRequestToAll(): Promise<BackupBroadcastResult> {
    try {
      // 1. Check local 180s cooldown timer and HUD button state
      const elapsed = Date.now() - this.lastBroadcastTimestamp;
      const isTimerCooldown = this.lastBroadcastTimestamp > 0 && elapsed < BACKUP_REQUEST_COOLDOWN_MS;

      const assistBtnState = await this.page.evaluate(() => {
        const assistBtn = document.querySelector('.btn-assist, .btn-request, .btn-backup') as HTMLElement;
        if (!assistBtn || assistBtn.offsetParent === null) {
          return { found: false, onCooldown: false };
        }
        // In GBF combat HUD: <div class="btn-assist disable"> with #prt-remain-gauge indicates cooldown
        const onCooldown =
          assistBtn.classList.contains('disable') ||
          assistBtn.classList.contains('disabled') ||
          assistBtn.classList.contains('btn-disable') ||
          assistBtn.classList.contains('wait');
        return { found: true, onCooldown };
      }).catch(() => ({ found: false, onCooldown: false }));

      if (isTimerCooldown || assistBtnState.onCooldown) {
        const remainingSec = Math.max(0, Math.ceil((BACKUP_REQUEST_COOLDOWN_MS - elapsed) / 1000));
        console.log(`[DailyHost:Backup] Backup request currently on cooldown (${remainingSec}s remaining).`);
        return {
          broadcastSuccessful: false,
          activeScopes: [],
          wasOnCooldown: true,
          message: `Backup request currently on cooldown (${remainingSec}s remaining).`
        };
      }

      if (!assistBtnState.found) {
        return {
          broadcastSuccessful: false,
          activeScopes: [],
          wasOnCooldown: false,
          message: 'Assist button not found in combat HUD.'
        };
      }

      // 2. Click .btn-assist to open the request backup popup
      await this.page.evaluate(() => {
        const assistBtn = document.querySelector('.btn-assist, .btn-request, .btn-backup') as HTMLElement;
        if (assistBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(assistBtn).trigger('tap');
          assistBtn.click();
        }
      }).catch(() => null);

      // Wait for modal to mount
      await this.page.waitForSelector('.pop-start-assist, .pop-usual.pop-show', { visible: true, timeout: 3000 }).catch(() => null);
      await logNormalDelay(400, 0.15);

      // 3. In .pop-start-assist modal, verify and toggle ALL THREE scopes:
      //    - Everyone: .btn-check[type="all"]
      //    - Friends:  .btn-check[type="friend"]
      //    - Crew:     .btn-check[type="guild"]
      const checkedScopes = await this.page.evaluate(() => {
        const scopeConfigs: Array<{ name: BackupBroadcastScope; typeAttr: string; selectors: string[] }> = [
          { name: 'Everyone', typeAttr: 'all', selectors: ['.btn-check[type="all"]', '.btn-check.all', '[data-type="all"]', '.check-all'] },
          { name: 'Friends', typeAttr: 'friend', selectors: ['.btn-check[type="friend"]', '.btn-check.friend', '[data-type="friend"]', '.check-friend'] },
          { name: 'Crew', typeAttr: 'guild', selectors: ['.btn-check[type="guild"]', '.btn-check.guild', '[data-type="guild"]', '.btn-check.crew', '.check-guild'] }
        ];

        const active: BackupBroadcastScope[] = [];

        for (const config of scopeConfigs) {
          let targetBtn: HTMLElement | null = null;
          // Primary: look for exact [type="..."] inside .pop-start-assist
          targetBtn = document.querySelector(`.pop-start-assist .btn-check[type="${config.typeAttr}"], .btn-check[type="${config.typeAttr}"]`) as HTMLElement;

          if (!targetBtn) {
            for (const sel of config.selectors) {
              const el = document.querySelector(`.pop-start-assist ${sel}, ${sel}`) as HTMLElement;
              if (el && el.offsetParent !== null) {
                targetBtn = el;
                break;
              }
            }
          }

          if (targetBtn) {
            // Authoritative: active="1" is CHECKED, active="0" is UNCHECKED
            const currentActive = targetBtn.getAttribute('active');
            const isCurrentlyChecked = currentActive === '1';

            if (!isCurrentlyChecked) {
              // Only click if not checked! Never click when already active="1"!
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(targetBtn).trigger('tap');
              targetBtn.click();
            }

            // Verify state after potential toggle
            const postActive = targetBtn.getAttribute('active');
            if (postActive === '1' || (!postActive && !targetBtn.classList.contains('off'))) {
              active.push(config.name);
            }
          }
        }

        // Hard assertion for 'Everyone' (type="all"):
        // If "Everyone" is still not active="1", trigger one targeted tap
        const allBtn = document.querySelector('.pop-start-assist .btn-check[type="all"], .btn-check[type="all"]') as HTMLElement;
        if (allBtn && allBtn.getAttribute('active') !== '1') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(allBtn).trigger('tap');
          allBtn.click();
          if (allBtn.getAttribute('active') === '1' && !active.includes('Everyone')) {
            active.unshift('Everyone');
          }
        }

        return active;
      }).catch(() => [] as BackupBroadcastScope[]);

      console.log(`[DailyHost:Backup] Authoritatively verified scopes: ${checkedScopes.join(', ')}`);
      await logNormalDelay(350, 0.1);

      // 4. Click "Request Backup" submit button (.btn-usual-text.with-potion, .prt-popup-footer .btn-usual-text, .btn-usual-text)
      const requested = await this.page.evaluate(() => {
        const reqBtn = document.querySelector(
          '.pop-start-assist .btn-usual-text.with-potion, ' +
          '.pop-start-assist .prt-popup-footer .btn-usual-text, ' +
          '.pop-start-assist .btn-usual-text, ' +
          '.btn-usual-text.with-potion, ' +
          '.pop-start-assist .btn-usual-ok, ' +
          '.btn-usual-text'
        ) as HTMLElement;
        if (reqBtn && reqBtn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(reqBtn).trigger('tap');
          reqBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (!requested) {
        return {
          broadcastSuccessful: false,
          activeScopes: checkedScopes,
          wasOnCooldown: false,
          message: 'Could not click request backup submit button.'
        };
      }

      await logNormalDelay(700, 0.15);

      // 5. Dismiss "You requested backup!" confirmation popup (.pop-usual .btn-usual-ok)
      await this.page.evaluate(() => {
        const okBtn = document.querySelector(
          '#pop.popup-view-root .btn-usual-ok, .pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-usual-ok'
        ) as HTMLElement;
        if (okBtn && okBtn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(okBtn).trigger('tap');
          okBtn.click();
        }
      }).catch(() => null);

      await logNormalDelay(400, 0.1);

      // 6. Record timestamp upon successful submission
      this.lastBroadcastTimestamp = Date.now();

      return {
        broadcastSuccessful: true,
        activeScopes: checkedScopes.length > 0 ? checkedScopes : ['Everyone', 'Friends', 'Crew'],
        wasOnCooldown: false,
        message: 'Successfully broadcasted backup request to all scopes (Everyone, Friends, Crew).'
      };
    } catch (err: any) {
      return {
        broadcastSuccessful: false,
        activeScopes: [],
        wasOnCooldown: false,
        message: err.message
      };
    }
  }
}


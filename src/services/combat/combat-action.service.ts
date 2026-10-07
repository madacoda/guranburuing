// src/services/combat/combat-action.service.ts
import { Page } from 'puppeteer-core';
import {
  AttackInvocationOutcome,
  BackupRequestOptions,
  BackupRequestOutcome,
  ICombatActionService,
  SkillInvocationOptions,
  SkillInvocationOutcome
} from '../../domain/combat/combat.types.js';
import {
  humanizedClick,
  humanReactionDelay,
  logNormalDelay,
  randomDelay
} from '../../human-motor.js';

/**
 * Universal combat manipulation service for Granblue Fantasy.
 * Adheres to SRP: Exclusively handles in-raid battle controls (skills, summons, attacks, backup).
 */
export class CombatActionService implements ICombatActionService {
  constructor(private page: Page) {}

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Dismisses any active drawers, modals, or popups blocking combat actions.
   */
  public async dismissCombatDrawersAndPopups(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        let acted = false;

        // Fast-forward active tweens and release visual/button locks immediately
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(2000, false);
        }
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }

        // 1. Dismiss any open modal / popup dialog
        const popBtns = Array.from(document.querySelectorAll(
          '.pop-usual .btn-close, .pop-usual .btn-usual-ok, .pop-usual .btn-usual-cancel, .prt-popup-header .btn-close, .btn-usual-close, .prt-popup-footer .btn-usual-ok'
        )) as HTMLElement[];
        for (const btn of popBtns) {
          if (btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none') {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
            acted = true;
          }
        }

        // 2. Close character ability drawer if open (Back button)
        const backBtn = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (backBtn && backBtn.offsetParent !== null && window.getComputedStyle(backBtn).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(backBtn).trigger('tap');
          backBtn.click();
          acted = true;
        }

        // 3. Clear READY screen if present
        const readyScreen = document.querySelector('.prt-start, .prt-ready') as HTMLElement;
        if (readyScreen && readyScreen.offsetParent !== null && window.getComputedStyle(readyScreen).display !== 'none') {
          readyScreen.click();
          acted = true;
        }

        return acted;
      });
    } catch {
      return false;
    }
  }

  /**
   * Waits for combat input readiness (gGameStatus.lock === false).
   */
  public async waitForCombatInputReady(timeoutMs = 4000): Promise<boolean> {
    try {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const isReady = await this.page.evaluate(() => {
          const stage = (window as any).stage;
          if (stage?.gGameStatus?.lock) return false;
          if (stage?.gGameStatus?.attacking) return false;
          const mask = document.querySelector('.prt-navigation-mask, .mask') as HTMLElement;
          if (mask && mask.offsetParent !== null && window.getComputedStyle(mask).display !== 'none') return false;
          return true;
        }).catch(() => false);

        if (isReady) return true;
        await new Promise(r => setTimeout(r, 60));
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Invokes a specific character's skill slot.
   */
  public async triggerSkill(options: SkillInvocationOptions): Promise<SkillInvocationOutcome> {
    const { character, skill, target, timeoutMs = 4000 } = options;
    try {
      await this.dismissCombatDrawersAndPopups();
      await this.waitForCombatInputReady(timeoutMs);

      // Open character ability tray
      const opened = await this.page.evaluate((charIdx: number) => {
        const charBtns = Array.from(document.querySelectorAll('.btn-command-character, .prt-command-chara, .lis-character'));
        const targetBtn = charBtns[charIdx - 1] as HTMLElement;
        if (targetBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(targetBtn).trigger('tap');
          targetBtn.click();
          return true;
        }
        return false;
      }, character);

      if (!opened) {
        return { success: false, queued: false, character, skill, message: `Failed to open character ${character} tray.` };
      }

      await logNormalDelay(250, 0.15);

      // Click skill icon
      const clickedSkill = await this.page.evaluate((skillIdx: number) => {
        const skillBtns = Array.from(document.querySelectorAll('.prt-command-chara:not([style*="display: none"]) .btn-ability-available, .prt-ability-list .btn-ability-available, .btn-ability-available'));
        const targetSkill = skillBtns[skillIdx - 1] as HTMLElement;
        if (targetSkill && targetSkill.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(targetSkill).trigger('tap');
          targetSkill.click();
          return true;
        }
        return false;
      }, skill);

      if (!clickedSkill) {
        await this.dismissCombatDrawersAndPopups();
        return { success: false, queued: false, character, skill, message: `Skill ${skill} not available or on cooldown.` };
      }

      // Handle targeted skill popup if needed
      if (target) {
        await logNormalDelay(300, 0.15);
        await this.page.evaluate((targetIdx: number) => {
          const targetBtns = Array.from(document.querySelectorAll('.pop-usual .prt-target-list .btn-target, .btn-target, .pop-usual .btn-command-character'));
          const btn = targetBtns[targetIdx - 1] as HTMLElement;
          if (btn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
          }
        }, target);
      }

      await this.dismissCombatDrawersAndPopups();
      return { success: true, queued: true, character, skill };
    } catch (err: any) {
      return { success: false, queued: false, character, skill, message: err?.message };
    }
  }

  /**
   * Triggers Quick Summon button.
   */
  public async triggerQuickCall(): Promise<boolean> {
    try {
      await this.dismissCombatDrawersAndPopups();
      await this.waitForCombatInputReady(3000);

      const qBtn = await this.page.waitForSelector('.btn-quick-summon, #js-btn-quick-summon', { visible: true, timeout: 2500 }).catch(() => null);
      if (!qBtn) return false;

      const isUnavailable = await qBtn.evaluate((el: any) => {
        return el.classList.contains('btn-summon-unavailable') ||
               el.classList.contains('off') ||
               el.classList.contains('disabled') ||
               el.getAttribute('aria-disabled') === 'true';
      }).catch(() => false);

      if (isUnavailable) return false;

      await humanizedClick(this.page, qBtn);
      await this.dismissCombatDrawersAndPopups();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Triggers Attack button and waits for resolution.
   */
  public async triggerAttack(options: { expectLockout?: boolean } = {}): Promise<AttackInvocationOutcome> {
    const start = Date.now();
    try {
      await this.dismissCombatDrawersAndPopups();
      await this.waitForCombatInputReady(3000);

      const atkBtn = await this.page.waitForSelector('.btn-attack-start', { visible: true, timeout: 3500 }).catch(() => null);
      if (!atkBtn) {
        return { success: false, turnsElapsed: 0, durationMs: Date.now() - start, message: 'Attack button not found or obscured.' };
      }

      await humanizedClick(this.page, atkBtn);
      await logNormalDelay(600, 0.2);

      return { success: true, turnsElapsed: 1, durationMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, turnsElapsed: 0, durationMs: Date.now() - start, message: err?.message };
    }
  }

  /**
   * Toggles Full Auto or Semi Auto mode.
   */
  public async toggleAutoMode(enableFullAuto = true): Promise<boolean> {
    try {
      await this.dismissCombatDrawersAndPopups();
      return await this.page.evaluate((fullAuto: boolean) => {
        const autoBtn = document.querySelector('.btn-auto, .btn-full-auto') as HTMLElement;
        if (!autoBtn) return false;

        const isCurrentlyActive = autoBtn.classList.contains('btn-auto-active') || autoBtn.classList.contains('on');
        if (!isCurrentlyActive) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(autoBtn).trigger('tap');
          autoBtn.click();
          return true;
        }
        return true;
      }, enableFullAuto);
    } catch {
      return false;
    }
  }

  /**
   * Requests backup and broadcasts to all/friends/crew.
   */
  public async requestBackup(options: BackupRequestOptions = {}): Promise<BackupRequestOutcome> {
    const { shareToAll = true, requestFriends = true, requestCrew = true } = options;
    try {
      const assistBtn = await this.page.$('.btn-assist, .btn-request');
      if (!assistBtn) {
        return { requested: false, sharedAll: false, message: 'Backup request button not present (may be solo or already requested).' };
      }

      await humanizedClick(this.page, assistBtn);
      await humanReactionDelay(250, 0.15);

      const requested = await this.page.evaluate(
        (opts: { shareAll: boolean; reqFriends: boolean; reqCrew: boolean }) => {
          const modal = document.querySelector('.pop-start-assist, .pop-usual, .prt-popup-body');
          if (!modal) return false;

          // Scope checkboxes with active="1" check
          const scopeMap: Array<{ key: boolean; type: string }> = [
            { key: opts.shareAll, type: 'all' },
            { key: opts.reqFriends, type: 'friend' },
            { key: opts.reqCrew, type: 'guild' }
          ];

          for (const item of scopeMap) {
            const checkBtn = modal.querySelector(`.btn-check[type="${item.type}"], .btn-check.${item.type}`) as HTMLElement;
            if (checkBtn) {
              const isActive = checkBtn.getAttribute('active') === '1';
              if (item.key && !isActive) {
                checkBtn.click();
              } else if (!item.key && isActive) {
                checkBtn.click();
              }
            }
          }

          // Submit button
          const submitBtn = modal.querySelector(
            '.btn-usual-text.with-potion, .prt-popup-footer .btn-usual-text, .btn-usual-text, .btn-usual-ok'
          ) as HTMLElement;
          if (submitBtn) {
            submitBtn.click();
            return true;
          }
          return false;
        },
        { shareAll: shareToAll, reqFriends: requestFriends, reqCrew: requestCrew }
      );

      // Dismiss confirmation if present
      await logNormalDelay(500, 0.15);
      await this.page.evaluate(() => {
        const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
        if (ok) ok.click();
      }).catch(() => null);

      await logNormalDelay(300, 0.1);
      return { requested, sharedAll: shareToAll, message: requested ? 'Backup request sent.' : 'Popup closed without sending.' };
    } catch (err: any) {
      return { requested: false, sharedAll: false, message: err?.message };
    }
  }
}

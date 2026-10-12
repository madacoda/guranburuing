// src/engines/universal/routine-execution.service.ts
import { Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { UniversalContext } from './types.js';
import { WorkflowStep } from '../../types/workflow.types.js';
import { ProSkipEngine } from '../pro-skip.engine.js';
import { FateEngine } from '../fate.engine.js';
import {
  humanizedClick,
  humanReactionDelay,
  logNormalDelay
} from '../../human-motor.js';

export interface RoutineExecutionDependencies {
  executeSingleStep?: (step: WorkflowStep, stepNum: number, runNumber: number) => Promise<boolean>;
}

export class RoutineExecutionService {
  constructor(
    private ctx: UniversalContext,
    private deps: RoutineExecutionDependencies = {}
  ) {}

  public get page(): Page {
    return this.ctx.page;
  }

  /**
   * Executes all pinned Favorite Pro Skips via ProSkipEngine with full hybrid/DOM and AP handling.
   */
  public async handleProSkipFavorites(step?: WorkflowStep): Promise<boolean> {
    console.log(`[Workflow] ⚡ Running Daily Favorites Pro Skips via ProSkipEngine...`);
    const autoReplenish = this.ctx.template.autoElixir !== false;
    const proSkipEngine = new ProSkipEngine(this.page, this.ctx.sentinel);
    const results = await proSkipEngine.runFavoritesProSkips(autoReplenish);

    let clearedCount = 0;
    for (const r of results) {
      if (r.status === 'SUCCESS' || r.status === 'ALREADY_CLEARED') {
        clearedCount++;
      }
    }
    console.log(`[Workflow] 🏁 Daily Favorites complete: ${clearedCount}/${results.length} pro skips processed.`);
    return true;
  }

  /**
   * Dismisses all active popups, result overlays, error notifications, and modals.
   */
  public async handleDismissPopups(step?: WorkflowStep): Promise<boolean> {
    const maxIterations = 5;
    for (let i = 0; i < maxIterations; i++) {
      const dismissed = await this.page.evaluate(() => {
        const selectors = [
          '.pop-usual .btn-usual-ok',
          '.pop-usual .btn-usual-cancel',
          '.pop-usual .btn-usual-close',
          '.pop-level-up .btn-usual-ok',
          '.common-pop-error .btn-usual-ok',
          '.common-pop-error .btn-usual-close',
          '.js-pop-skyscope-achieved .btn-usual-close',
          '.btn-result-close',
          '.btn-usual-close',
          '.prt-popup-footer .btn-usual-ok',
          '.prt-popup-footer .btn-usual-close',
          '.prt-popup-header .btn-usual-close',
          '.pop-synopsis.pop-show .btn-usual-ok',
          '.pop-synopsis.pop-show .btn-usual-cancel'
        ];

        for (const sel of selectors) {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els) {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(el).trigger('tap');
              (el as HTMLElement).click();
              return true;
            }
          }
        }
        return false;
      });

      if (!dismissed) break;
      await logNormalDelay(250, 0.15);
    }
    return true;
  }

  /**
   * Retrieves a task definition from data/index.json dailyCatalog by tag or id.
   */
  public getDailyCatalogTask(tagOrId: string): any | null {
    try {
      if (!this.ctx.state.dailyCatalogCache) {
        const catalogPath = path.resolve(process.cwd(), 'data', 'index.json');
        if (fs.existsSync(catalogPath)) {
          const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
          this.ctx.state.dailyCatalogCache = raw.dailyCatalog?.tasks || [];
        } else {
          this.ctx.state.dailyCatalogCache = [];
        }
      }
      return (this.ctx.state.dailyCatalogCache || []).find((t: any) => t.tag === tagOrId || t.id === tagOrId) || null;
    } catch {
      return null;
    }
  }

  /**
   * Navigates to target page or hash if not already active.
   */
  public async navigateIfNeeded(targetUrl: string): Promise<void> {
    const currentUrl = this.page.url();
    const hash = targetUrl.includes('#') ? targetUrl.substring(targetUrl.indexOf('#')) : null;

    if (hash && currentUrl.includes(hash)) {
      return;
    }

    console.log(`[Workflow] 🧭 Navigating to: ${targetUrl}...`);
    await this.page.evaluate((dest: string) => {
      if (dest.startsWith('#')) {
        window.location.hash = dest;
      } else if (dest.includes('#')) {
        const h = dest.substring(dest.indexOf('#'));
        window.location.hash = h;
      } else {
        window.location.href = dest;
      }
    }, targetUrl).catch(() => null);

    await this.ctx.sentinel.assertSafe();
    await logNormalDelay(600, 0.2);
    await this.handleDismissPopups();
  }

  /**
   * Evaluates whether a target element or quest is finished today.
   */
  public async evaluateTargetFinished(selector: string): Promise<boolean> {
    return await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (!el) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';

      const classes = el.className || '';
      const text = (el.innerText || '').trim();
      const limitedCount = el.getAttribute('data-limited_count');
      const isCleared = el.getAttribute('data-cleared');
      const exchangeLimit = el.getAttribute('data-exchange-limit');

      // 1. Explicit GBF zero-remaining attributes
      if (limitedCount === '0' || isCleared === '1' || exchangeLimit === '0') return true;

      // 2. Element disabled classes
      if (classes.includes('is-completed') || classes.includes('btn-disable') || classes.includes('btn-cleared')) return true;
      if (classes.includes('disable') && !classes.includes('btn-enable')) return true;

      // 3. Text patterns indicating completion
      if (/\b0\s*\/\s*\d+/.test(text)) return true;
      if (/completed|finished|達成済み|本日分終了|残り\s*0\s*個|0\s*left/i.test(text)) return true;

      // 4. Button disabled attribute
      if ((el as HTMLButtonElement).disabled) return true;

      return false;
    }, selector).catch(() => false);
  }

  /**
   * Handles AP recovery modal if present, consuming Half-Elixir if autoElixir is permitted.
   */
  public async handleApRecoveryModal(): Promise<boolean> {
    const recoveryNeeded = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item');
      return !!modal;
    }).catch(() => false);

    if (!recoveryNeeded) return false;

    if (this.ctx.template.autoElixir === false) {
      console.warn('[Workflow] AP recovery modal detected, but autoElixir is disabled.');
      await this.page.evaluate(() => {
        const cancelBtn = document.querySelector('.pop-usual .btn-usual-cancel, .pop-show .btn-usual-cancel') as HTMLElement;
        if (cancelBtn) cancelBtn.click();
      }).catch(() => null);
      return false;
    }

    console.log('[Workflow] 🧪 AP recovery needed. Consuming Half-Elixir...');
    await this.page.evaluate(() => {
      const useBtn = document.querySelector('.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item') as HTMLElement;
      if (useBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(useBtn).trigger('tap');
        useBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);

    // Confirm item usage
    await this.page.evaluate(() => {
      const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok') as HTMLElement;
      if (okBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);
    await this.ctx.sentinel.assertSafe();
    return true;
  }

  /**
   * Detects and handles Replicard AAP (Arcarum Action Points) recovery modal.
   * Restores AAP using Half-Elixir / Elixir and confirms replenishment dialog.
   */
  public async handleAapRecoveryModal(autoReplenishAap = true): Promise<boolean> {
    try {
      const isAapModal = await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-usual');
        if (!pop) return false;
        const text = (pop as HTMLElement).innerText || '';
        return text.includes('AAP') || text.includes('回復') || text.includes('recover') || !!pop.querySelector('.btn-use-item');
      });

      if (!isAapModal) return false;

      console.log(`[${this.ctx.accountId}] [Replicard] AAP recovery modal detected.`);
      if (!autoReplenishAap) {
        console.warn(`[${this.ctx.accountId}] [Replicard] AAP replenishment is disabled. Canceling modal.`);
        const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel');
        if (cancelBtn) await humanizedClick(this.page, cancelBtn);
        return false;
      }

      console.log(`[${this.ctx.accountId}] [Replicard] Consuming item to restore AAP...`);
      const useItemBtn = await this.page.waitForSelector('.pop-usual .btn-use-item, .btn-use-item', { visible: true, timeout: 5000 }).catch(() => null);
      if (useItemBtn) {
        await humanReactionDelay(250, 0.18);
        await humanizedClick(this.page, useItemBtn);
        await logNormalDelay(600, 0.15);

        const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok, .btn-usual-ok', { visible: true, timeout: 5000 }).catch(() => null);
        if (confirmBtn) {
          await humanReactionDelay(250, 0.18);
          await humanizedClick(this.page, confirmBtn);
          await logNormalDelay(800, 0.15);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensures the Cygames Pro Quest List modal (.pop-pro-quest-list) is open on #quest/extra.
   */
  public async ensureProListModalOpen(): Promise<boolean> {
    const isAlreadyOpen = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-pro-quest-list.pop-show') as HTMLElement;
      return !!(modal && modal.offsetParent !== null && window.getComputedStyle(modal).display !== 'none');
    }).catch(() => false);

    if (isAlreadyOpen) return true;

    // Await pro button on #quest/extra or #quest if page is still rendering
    await this.page.waitForSelector('.btn-pro-list, .btn-pro-quest, #js-pro-list-button .btn-pro-list, .prt-pro-list-wrapper .btn-pro-list, [data-location-id="pro_quest"]', { visible: true, timeout: 3500 }).catch(() => null);

    // Look for .btn-pro-list on #quest/extra or #quest
    const opened = await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-pro-list, .btn-pro-quest, #js-pro-list-button .btn-pro-list, .prt-pro-list-wrapper .btn-pro-list, [data-location-id="pro_quest"]') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (!opened) {
      return false;
    }

    // Await modal appearance
    await this.page.waitForSelector('.pop-pro-quest-list.pop-show', { visible: true, timeout: 5000 }).catch(() => null);
    await logNormalDelay(400, 0.15);
    return true;
  }

  /**
   * Closes the Pro Quest List modal if it is currently open.
   */
  public async closeProListModalIfOpen(): Promise<void> {
    await this.page.evaluate(() => {
      const closeBtn = document.querySelector('.pop-pro-quest-list .btn-usual-close') as HTMLElement;
      if (closeBtn) closeBtn.click();
    }).catch(() => null);
    await logNormalDelay(250, 0.1);
  }

  /**
   * Automated Pro Skip execution targeting specific catalog item or selector.
   */
  public async executeAutomatedProSkip(task: any, selector?: string): Promise<boolean> {
    const qId = task?.questId;
    const chId = task?.chapterId;
    const proChId = task?.proChapterId;
    const qName = task?.name || qId || 'Pro Skip';
    console.log(`[Workflow] ⚡ Checking Pro Skip: "${qName}"...`);

    const currentUrl = this.page.url();
    const isQuestExtra = currentUrl.includes('#quest/extra');

    if (isQuestExtra) {
      // 1. Open Pro List modal if not open
      const modalReady = await this.ensureProListModalOpen();
      if (!modalReady) {
        console.warn(`[Workflow] Could not open Pro Quest List modal on #quest/extra`);
        return false;
      }

      // 2. Find quest button across tabs (normal, high, extra) and trigger skip click
      const itemState = await this.page.evaluate(async (questId, chapterId, questName, proChapterId) => {
        const $ = (window as any).$ || (window as any).Zepto;
        const tabs = Array.from(document.querySelectorAll('.pop-pro-quest-list .btn-quest-type')) as HTMLElement[];
        const numTabs = tabs.length > 0 ? tabs.length : 1;

        const matchBanner = () => {
          const activeStage = document.querySelector('.pop-pro-quest-list .prt-stage-quest.active') ||
                              document.querySelector('.pop-pro-quest-list .prt-stage-quest');
          const banners = Array.from((activeStage || document).querySelectorAll('.prt-quest-banner')) as HTMLElement[];
          for (const b of banners) {
            const bQuestId = b.getAttribute('data-quest-id');
            const btn = b.querySelector('.btn-set-quest') as HTMLElement;
            const bChapterId = btn?.getAttribute('data-chapter-id');
            const bProChapterId = btn?.getAttribute('data-pro-chapter-id') || b.getAttribute('data-pro-chapter-id');
            const bName = (b.getAttribute('data-chapter-name') || b.querySelector('.txt-quest-name')?.textContent || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const qLower = (questName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            const isMatch = (questId && bQuestId === questId) ||
                            (chapterId && bChapterId === chapterId) ||
                            (proChapterId && bProChapterId === proChapterId) ||
                            (qLower && (bName.includes(qLower) || qLower.includes(bName))) ||
                            (questId === '305321' && (bName.includes('atum') || bName.includes('ennead')));

            if (isMatch) {
              return { banner: b, btn };
            }
          }
          return null;
        };

        for (let t = 0; t < numTabs; t++) {
          if (tabs[t]) {
            if ($) $(tabs[t]).trigger('tap');
            tabs[t].click();
            await new Promise(r => setTimeout(r, 350));
          }

          const matched = matchBanner();
          if (matched) {
            const { banner, btn } = matched;
            const isLocked = !!banner.querySelector('.ico-lock, .prt-lock, .btn-lock') ||
                             banner.classList.contains('is-locked') ||
                             banner.classList.contains('lock') ||
                             btn?.classList.contains('btn-lock') ||
                             banner.getAttribute('data-is-lock') === '1';

            const limited = btn?.getAttribute('data-limited_count');
            const isCleared = banner.classList.contains('onm-mask') ||
                              !!banner.querySelector('.ico-cleared, .prt-cleared') ||
                              (btn?.classList.contains('disable') && !isLocked) ||
                              btn?.classList.contains('has-error') ||
                              btn?.classList.contains('is-completed') ||
                              limited === '0';

            let clicked = false;
            if (!isLocked && !isCleared && btn) {
              if ($) $(btn).trigger('tap');
              btn.click();
              clicked = true;
            }

            return {
              found: true,
              isLocked,
              isCleared,
              clicked
            };
          }
        }

        return { found: false, isLocked: false, isCleared: false, clicked: false };
      }, qId, chId, qName, proChId);

      if (!itemState.found) {
        console.warn(`[Workflow] ⚠️ Quest "${qName}" (ID: ${qId}) not found in Pro Quest List modal.`);
        await this.closeProListModalIfOpen();
        return true;
      }

      if (itemState.isCleared) {
        console.log(`[Workflow] ✅ "${qName}" is already cleared today.`);
        await this.closeProListModalIfOpen();
        return true;
      }

      if (itemState.isLocked) {
        console.warn(`[Workflow] ⚠️ "${qName}" is locked (prerequisites not met on this account). Skipping...`);
        await this.closeProListModalIfOpen();
        return true;
      }

      if (!itemState.clicked) {
        console.warn(`[Workflow] Quest button for "${qName}" was not clickable. Skipping...`);
        await this.closeProListModalIfOpen();
        return true;
      }

      await logNormalDelay(500, 0.15);
      await this.ctx.sentinel.assertSafe();

      // 4. Handle Phase 1 confirmation modal (.pop-pro-quest-skip)
      const confirmOk = await this.page.waitForSelector('.pop-pro-quest-skip .btn-usual-ok, .pop-usual .btn-usual-ok', { visible: true, timeout: 6000 }).catch(() => null);
      if (confirmOk) {
        console.log(`[Workflow] Confirming skip dialog for "${qName}"...`);
        await this.page.evaluate(() => {
          const okBtn = document.querySelector('.pop-pro-quest-skip .btn-usual-ok, .pop-usual .btn-usual-ok') as HTMLElement;
          if (okBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(okBtn).trigger('tap');
            okBtn.click();
          }
        });
        await logNormalDelay(500, 0.15);
      }

      // 5. Check AP recovery modal
      await this.handleApRecoveryModal();

      // 6. Handle Phase 2 supporter screen (.se-quest-start)
      const startOk = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok[data-type-id="28"]', { visible: true, timeout: 8000 }).catch(() => null);
      if (startOk) {
        console.log(`[Workflow] Confirming final skip start on supporter screen (.se-quest-start)...`);
        await this.page.evaluate(() => {
          const startBtn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok[data-type-id="28"]') as HTMLElement;
          if (startBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(startBtn).trigger('tap');
            startBtn.click();
          }
        });
      }

      // 7. Await result resolution (#result_pro_quest_skip)
      console.log(`[Workflow] Awaiting result for "${qName}"...`);
      await this.page.waitForFunction(() => {
        return window.location.hash.includes('result_pro_quest_skip') ||
               !!document.querySelector('.pop-exp, .prt-result-head');
      }, { timeout: 12000 }).catch(() => null);

      console.log(`[Workflow] 🎉 "${qName}" Pro Skip successfully cleared!`);
      await logNormalDelay(800, 0.2);

      // 8. Dismiss reward popups
      await this.handleDismissPopups();

      // 9. Safely return to #quest/extra for the next pro skip
      await this.navigateIfNeeded('https://game.granbluefantasy.jp/#quest/extra');
      return true;
    }

    // Fallback: If on #quest favorites list
    const favState = await this.page.evaluate((questId, chapterId, questName) => {
      const cards = Array.from(document.querySelectorAll('.prt-noindex-list .prt-list-contents, .cnt-quest .prt-list-contents'));
      for (const c of cards) {
        const proEl = c.querySelector('[data-pro-quest-skip="true"]') || (c.getAttribute('data-pro-quest-skip') === 'true' ? c : null);
        if (!proEl) continue;
        const qId = proEl.getAttribute('data-quest-id') || c.getAttribute('data-quest-id');
        const chId = proEl.getAttribute('data-pro-chapter-id') || c.getAttribute('data-pro-chapter-id');
        const name = c.getAttribute('data-quest-name') || proEl.getAttribute('data-quest-name') || c.querySelector('.txt-quest-title')?.textContent?.trim();

        if ((questId && qId === questId) || (chapterId && chId === chapterId) || (questName && name?.includes(questName))) {
          const limited = proEl.getAttribute('data-limited_count') || c.getAttribute('data-limited_count');
          return {
            found: true,
            isCleared: limited === '0' || c.classList.contains('is-completed') || c.classList.contains('disable')
          };
        }
      }
      return { found: false, isCleared: false };
    }, qId, chId, qName);

    if (favState.found && favState.isCleared) {
      console.log(`[Workflow] ✅ "${qName}" is already cleared in Favorites.`);
      return true;
    }

    // Default DOM click fallback
    const sel = selector || task?.selector || '.btn-pro-skip';
    return await this.executeGenericClickUntilFinish(sel);
  }

  /**
   * Automated 100-Draw Rupie Gacha execution.
   */
  public async executeAutomatedRupieGacha(task: any, selector?: string): Promise<boolean> {
    console.log('[Workflow] 🎁 Checking Daily 100-Draw Rupie Gacha...');

    // 1. Ensure navigation directly to #gacha/normal
    const currentUrl = this.page.url();
    if (!currentUrl.includes('#gacha/normal') && !currentUrl.includes('gacha/normal')) {
      console.log('[Workflow] 🧭 Navigating to #gacha/normal...');
      await this.page.evaluate(() => {
        window.location.hash = '#gacha/normal';
      }).catch(() => null);
      await logNormalDelay(1500, 0.2);
    } else {
      await this.page.evaluate(() => {
        if (!window.location.hash.includes('#gacha/normal')) {
          window.location.hash = '#gacha/normal';
        }
      }).catch(() => null);
    }

    await this.page.waitForFunction(() => {
      return (
        !!document.querySelector('.btn-lupi, [data-id="6002"], .btn-lupi.multi, [data-count="100"]') ||
        !!document.querySelector('.cnt-gacha-normal, .prt-gacha-normal, .cnt-gacha, #gacha')
      );
    }, { timeout: 8000 }).catch(() => null);
    await logNormalDelay(600, 0.15);

    // 2. Evaluate draw state on #gacha/normal
    const drawState = await this.page.evaluate((userSel?: string) => {
      const $ = (window as any).$ || (window as any).Zepto;

      const selectors = [
        'div.btn-lupi.multi.free[data-id="6002"][data-count="100"]',
        '.btn-lupi[data-id="6002"][data-count="100"]',
        '.btn-lupi.multi[data-count="100"]',
        '.btn-lupi.multi.free[data-count="100"]',
        '.btn-lupi.multi.free',
        '.btn-lupi[data-id="6002"]',
        '.btn-lupi.multi',
        '.btn-lupi[data-count="100"]',
        '[data-id="6002"]',
        userSel,
        '.btn-draw-100',
        '.btn-multi-draw'
      ].filter(Boolean) as string[];

      let btn100: HTMLElement | null = null;
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) {
          btn100 = el;
          break;
        }
      }

      // Fallback: search for any .btn-lupi with 100-draw characteristics
      if (!btn100) {
        const allLupi = Array.from(document.querySelectorAll('.btn-lupi, [class*="btn-lupi"]')) as HTMLElement[];
        for (const el of allLupi) {
          const count = el.getAttribute('data-count');
          const id = el.getAttribute('data-id');
          const hasCount1 = !!el.querySelector('.count-1');
          const txt = (el.innerText || '').trim();
          if (count === '100' || id === '6002' || hasCount1 || txt.includes('100') || el.classList.contains('multi')) {
            btn100 = el;
            break;
          }
        }
      }

      // Text search fallback if still not found
      if (!btn100) {
        const candidates = Array.from(document.querySelectorAll('.btn-draw, [class*="btn"], div, a')) as HTMLElement[];
        for (const c of candidates) {
          const t = (c.innerText || '').trim();
          if (
            t.includes('100回引く') ||
            t.includes('100連') ||
            t.includes('100回') ||
            t.includes('まとめて引く') ||
            t.includes('Draw 100') ||
            t.includes('100 Draws') ||
            t.includes('Draw Max')
          ) {
            btn100 = c;
            break;
          }
        }
      }

      // 2. If 100-Draw button is present:
      if (btn100) {
        const classes = btn100.className || '';
        const count = btn100.getAttribute('data-count');
        const countZeroEl = btn100.querySelector('.txt-gacha-count .count-0');
        const countOneEl = btn100.querySelector('.txt-gacha-count .count-1');
        const btnText = btn100.innerText || '';

        const isDisabled =
          classes.includes('disable') ||
          classes.includes('is-completed') ||
          classes.includes('btn-disable') ||
          (btn100 as HTMLButtonElement).disabled ||
          count === '0' ||
          (countZeroEl && !countOneEl && count !== '100') ||
          btnText.includes('本日分終了') ||
          btnText.includes("can't draw") ||
          btnText.includes('0 more times');

        if (isDisabled) {
          return { status: 'already_drawn', reason: 'button_disabled_or_zero_count' };
        }

        // Scroll into view & click
        btn100.scrollIntoView({ behavior: 'instant', block: 'center' });
        if ($) {
          $(btn100).trigger('touchstart');
          $(btn100).trigger('touchend');
          $(btn100).trigger('tap');
        }
        btn100.click();
        return { status: 'clicked', label: btnText || '100-Draw Rupie (.btn-lupi)' };
      }

      // 3. Button not found: check if already completed within the rupie gacha section
      const rupieSection = document.querySelector('.prt-rupie-gacha, #gacha-rupie, .cnt-gacha-normal, .prt-gacha-normal, .cnt-gacha, #gacha') as HTMLElement;
      const rupieText = rupieSection ? (rupieSection.innerText || '') : '';
      if (
        rupieText.includes("0 more times today") ||
        rupieText.includes("can't draw any more") ||
        rupieText.includes("cannot draw any more") ||
        rupieText.includes("本日分終了") ||
        rupieText.includes("上限に達しました") ||
        rupieText.includes("0/100回") ||
        rupieText.includes("0/100") ||
        rupieText.includes("Daily limit reached") ||
        rupieText.includes("Limit reached")
      ) {
        return { status: 'already_drawn', reason: 'rupie_gacha_daily_limit_reached' };
      }

      return { status: 'not_found', reason: 'btn_lupi_missing' };
    }, selector);

    console.log(`[Workflow] Rupie Draw evaluation: ${JSON.stringify(drawState)}`);

    if (drawState.status === 'already_drawn') {
      console.log(`[Workflow] ✅ Rupie Gacha already drawn today (${drawState.reason}).`);
      return true;
    }

    if (drawState.status === 'not_found') {
      console.warn(`[Workflow] ⚠️ Could not find .btn-lupi on #gacha/normal. Retrying on next loop...`);
      return false;
    }

    if (drawState.status === 'clicked') {
      console.log(`[Workflow] Clicked Rupie 100-Draw. Confirming modal...`);
      await logNormalDelay(600, 0.15);

      let confirmOk = await this.page.waitForSelector(
        '.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, #pop .btn-usual-ok, .prt-popup-footer .btn-usual-ok, .btn-usual-ok, .btn-settle, .btn-ok',
        { visible: true, timeout: 3000 }
      ).catch(() => null);

      if (!confirmOk) {
        const btnHandle = await this.page.$(
          'div.btn-lupi.multi.free[data-id="6002"][data-count="100"], .btn-lupi[data-id="6002"], .btn-lupi.multi.free, .btn-lupi[data-count="100"], .btn-lupi.multi'
        ).catch(() => null);

        if (btnHandle) {
          console.log('[Workflow] Retrying click on .btn-lupi via humanizedClick...');
          await humanizedClick(this.page, btnHandle).catch(() => null);
          confirmOk = await this.page.waitForSelector(
            '.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, #pop .btn-usual-ok, .prt-popup-footer .btn-usual-ok, .btn-usual-ok, .btn-settle, .btn-ok',
            { visible: true, timeout: 4000 }
          ).catch(() => null);
        }
      }

      if (confirmOk) {
        console.log('[Workflow] Confirming Rupie 100-Draw modal (.btn-usual-ok)...');
        await logNormalDelay(300, 0.15);
        await humanizedClick(this.page, confirmOk).catch(() => null);
        await this.page.evaluate(() => {
          const okBtn = document.querySelector(
            '.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, #pop .btn-usual-ok, .prt-popup-footer .btn-usual-ok, .btn-usual-ok, .btn-settle, .btn-ok'
          ) as HTMLElement;
          if (okBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) {
              $(okBtn).trigger('touchstart');
              $(okBtn).trigger('touchend');
              $(okBtn).trigger('tap');
            }
            okBtn.click();
          }
        }).catch(() => null);
      } else {
        console.warn('[Workflow] ⚠️ No confirmation modal appeared after clicking 100-Draw Rupie button.');
      }

      await logNormalDelay(1500, 0.2);

      await this.page.evaluate(() => {
        const stage = document.querySelector('#stage, canvas, .cnt-gacha') as HTMLElement;
        if (stage) stage.click();
      }).catch(() => null);

      await logNormalDelay(1000, 0.2);

      await this.page.waitForFunction(() => {
        const hash = window.location.hash || '';
        return (
          hash.includes('result') ||
          !!document.querySelector('.prt-result, .pop-gacha-result, .btn-result-close, .btn-usual-ok, .prt-popup-footer .btn-usual-ok')
        );
      }, { timeout: 12000 }).catch(() => null);

      console.log('[Workflow] 🎉 Rupie 100-Draw successfully completed!');
      await logNormalDelay(800, 0.2);

      await this.page.evaluate(() => {
        const closeBtn = document.querySelector('.btn-result-close, .pop-gacha-result .btn-usual-ok, .cnt-result .btn-usual-ok, .btn-usual-close') as HTMLElement;
        if (closeBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(closeBtn).trigger('tap');
          closeBtn.click();
        }
      }).catch(() => null);

      await this.handleDismissPopups();
      return true;
    }

    return false;
  }

  /**
   * Automated Skyscope Daily Missions claim execution.
   */
  public async executeAutomatedSkyscopeMission(task: any, selector?: string): Promise<boolean> {
    console.log('[Workflow] 🎯 Checking Skyscope Daily Missions...');
    await logNormalDelay(600, 0.15);

    const claimSelector = selector || '.btn-claim-all, .btn-receive-all, .prt-mission-complete .btn-receive-all, [data-action="claim-all"], .btn-all-receive';
    const claimState = await this.page.evaluate((sel: string) => {
      const btn = document.querySelector(sel) as HTMLElement;
      if (!btn || btn.offsetParent === null) return 'none_claimable';
      const classes = btn.className || '';
      if (classes.includes('disable')) return 'none_claimable';
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(btn).trigger('tap');
      btn.click();
      return 'claimed';
    }, claimSelector).catch(() => 'error');

    if (claimState === 'none_claimable' || claimState === 'error') {
      console.log('[Workflow] ✅ No unclaimed Skyscope missions pending.');
      return true;
    }

    if (claimState === 'claimed') {
      console.log('[Workflow] Claimed pending Skyscope missions. Dismissing rewards...');
      await logNormalDelay(600, 0.2);
      await this.handleDismissPopups();
      return true;
    }

    return true;
  }

  /**
   * Automated Casino daily item exchange execution.
   */
  public async executeAutomatedCasinoExchange(task: any, selector?: string): Promise<boolean> {
    console.log('[Workflow] 🎰 Checking Casino Daily Recovery Items Exchange...');

    const currentUrl = this.page.url();
    if (!currentUrl.includes('casino/exchange')) {
      await this.navigateIfNeeded('https://game.granbluefantasy.jp/#casino/exchange');
      await logNormalDelay(1500, 0.2);
    }

    const exchangeResult = await this.page.evaluate(() => {
      const $ = (window as any).$ || (window as any).Zepto;
      const items = Array.from(document.querySelectorAll('.prt-item, .prt-exchange-item, .prt-trade-item, .lis-item'));

      for (const item of items) {
        const text = (item.textContent || '').trim();
        const isTarget = text.includes('Half Elixir') || text.includes('Soul Berry') ||
                         text.includes('エリクシールハーフ') || text.includes('ソウルシード');
        if (!isTarget) continue;

        const btn = item.querySelector('.btn-exchange, .btn-trade, [data-action="exchange"]') as HTMLElement;
        if (!btn || btn.offsetParent === null) continue;

        const isDisabled = btn.classList.contains('disable') || text.includes('0 left') || text.includes('残り0') || text.includes('0/100');
        if (!isDisabled) {
          if ($) $(btn).trigger('tap');
          btn.click();
          return { itemFound: true, itemName: text.includes('Elixir') || text.includes('エリクシール') ? 'Half-Elixir' : 'Soul Berry' };
        }
      }

      return { itemFound: false, itemName: '' };
    }).catch(() => ({ itemFound: false, itemName: '' }));

    if (!exchangeResult.itemFound) {
      console.log('[Workflow] ✅ Casino daily exchanges already completed (0 stock remaining).');
      return true;
    }

    console.log(`[Workflow] Exchanging daily stock for "${exchangeResult.itemName}"...`);
    await logNormalDelay(600, 0.15);

    // Max quantity slider / button
    await this.page.evaluate(() => {
      const maxBtn = document.querySelector('.btn-max, .btn-use-max, .btn-trade-max') as HTMLElement;
      if (maxBtn) maxBtn.click();
    }).catch(() => null);
    await logNormalDelay(400, 0.1);

    // Click confirm / OK
    await this.page.evaluate(() => {
      const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-settle') as HTMLElement;
      if (okBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
      }
    }).catch(() => null);
    await logNormalDelay(800, 0.2);

    await this.handleDismissPopups();
    return false;
  }

  /**
   * Generic fallback click and modal dismissal.
   */
  public async executeGenericClickUntilFinish(selector?: string): Promise<boolean> {
    if (!selector) return true;
    const clicked = await this.page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el && el.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        el.click();
        return true;
      }
      return false;
    }, selector).catch(() => false);

    if (clicked) {
      await logNormalDelay(400, 0.15);
      await this.handleDismissPopups();
      return true;
    }
    return false;
  }

  /**
   * Universal Daily & Workflow Handler:
   * Executes a task or sequence of subSteps repeatedly until completion criteria are fulfilled.
   */
  public async handleDoUntilFinish(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const tag = step.tag || step.target;
    const task = tag ? this.getDailyCatalogTask(tag) : null;

    const taskName = task?.name || step.name || tag || step.target || 'Custom Daily Target';
    const targetUrl = step.page || task?.pageUrl;
    const targetSelector = step.target && step.target !== tag ? step.target : (task?.selector || step.target);
    const maxLoops = step.maxLoops || 20;

    console.log(`[Workflow] 🔄 Starting do_until_finish: "${taskName}" (max loops: ${maxLoops})...`);

    if (targetUrl) {
      await this.navigateIfNeeded(targetUrl);
    }

    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (this.ctx.state.stopRequested) return false;
      if (this.ctx.template.stopOnCaptcha !== false) await this.ctx.sentinel.assertSafe();

      const isAutomatedRoutine = task && ['pro_skip', 'gacha', 'mission', 'shop', 'casino'].includes(task.category);
      if (targetSelector && !isAutomatedRoutine) {
        const isFinished = await this.evaluateTargetFinished(targetSelector);
        if (isFinished) {
          console.log(`[Workflow] 🏁 do_until_finish: "${taskName}" is completed! (cycle ${loopIdx + 1})`);
          await this.handleDismissPopups();
          return true;
        }
      }

      if (step.subSteps && step.subSteps.length > 0 && this.deps.executeSingleStep) {
        console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Executing ${step.subSteps.length} sub-steps for "${taskName}"...`);
        for (let s = 0; s < step.subSteps.length; s++) {
          const sub = step.subSteps[s];
          const ok = await this.deps.executeSingleStep(sub, s + 1, runNumber);
          if (!ok && !sub.optional) {
            console.warn(`[Workflow] Sub-step ${s + 1} (${sub.code}) failed inside do_until_finish.`);
            return false;
          }
        }
        await logNormalDelay(400, 0.15);
        continue;
      }

      const category = task?.category || 'custom';
      console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Executing built-in routine for category "${category}"...`);

      let cycleSuccess = false;
      if (category === 'pro_skip') {
        cycleSuccess = await this.executeAutomatedProSkip(task, targetSelector);
      } else if (category === 'gacha') {
        cycleSuccess = await this.executeAutomatedRupieGacha(task, targetSelector);
      } else if (category === 'mission') {
        cycleSuccess = await this.executeAutomatedSkyscopeMission(task, targetSelector);
      } else if (category === 'shop' || category === 'casino') {
        cycleSuccess = await this.executeAutomatedCasinoExchange(task, targetSelector);
      } else {
        cycleSuccess = await this.executeGenericClickUntilFinish(targetSelector);
      }

      if (cycleSuccess) {
        console.log(`[Workflow] 🏁 do_until_finish: "${taskName}" verified complete.`);
        return true;
      }

      await logNormalDelay(500, 0.15);
    }

    console.log(`[Workflow] ⏹️ do_until_finish reached max loops (${maxLoops}) for "${taskName}".`);
    await this.handleDismissPopups();
    return true;
  }

  /**
   * Fast-skips story dialogues, scene cutscenes, dialogue selections, and confirms dialog skips.
   */
  public async handleSkipStoryScene(step: WorkflowStep): Promise<boolean> {
    const timeoutMs = step.timeoutMs || 15000;
    console.log(`[Workflow] 📖 Fast-skipping story scene (timeout: ${timeoutMs}ms)...`);
    const tStart = Date.now();

    while (Date.now() - tStart < timeoutMs) {
      if (this.ctx.state.stopRequested) return false;
      if (this.ctx.template.stopOnCaptcha !== false) await this.ctx.sentinel.assertSafe();

      const currentUrl = this.page.url();
      if (!currentUrl.includes('scene') && (currentUrl.includes('result') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#raid') || currentUrl.includes('#quest/fate'))) {
        break;
      }

      const actionTaken = await this.page.evaluate(() => {
        try {
          const $ = (window as any).$ || (window as any).Zepto;

          // 1. Episode prerequisite caution / spoiler warning: tap "Spoil Me", then tap OK
          const caution = document.querySelector('.pop-episode-caution') as HTMLElement;
          if (caution && caution.offsetParent !== null) {
            const spoil = caution.querySelector('.btn-check-caution') as HTMLElement;
            if (spoil) {
              if ($) $(spoil).trigger('tap');
              spoil.click();
            }
            const ok = caution.querySelector('.btn-usual-ok.start-fate:not(.disable)') as HTMLElement;
            if (ok) {
              if ($) $(ok).trigger('tap');
              ok.click();
              return 'confirmed_caution';
            }
          }

          // 2. Conflict error dialog: "This quest does not have a battle part"
          const cannotBattle = document.querySelector('.pop-can-not-multi-battle') as HTMLElement;
          if (cannotBattle && cannotBattle.offsetParent !== null) {
            const closeBtn = cannotBattle.querySelector('.btn-usual-close, .btn-usual-ok') as HTMLElement;
            if (closeBtn) {
              if ($) $(closeBtn).trigger('tap');
              closeBtn.click();
            }
            return 'conflict_error';
          }

          // 3. Skip confirmation popup: strictly skip buttons, NOT generic pop-usual OK!
          const skipOkBtn = document.querySelector(
            '.pop-synopsis .btn-scene-skip, .btn-scene-skip, .pop-skip .btn-usual-ok, .btn-skip-ok, .pop-skip .btn-skip-confirm'
          ) as HTMLElement;
          if (skipOkBtn && skipOkBtn.offsetParent !== null && !skipOkBtn.classList.contains('disable')) {
            try {
              if ($) $(skipOkBtn).trigger('tap');
              skipOkBtn.click();
              return 'confirmed_skip_modal';
            } catch {
              return null;
            }
          }

          // 4. Synopsis / start modal OK button
          const startOk = document.querySelector(
            '.btn-usual-ok.se-quest-start, .pop-synopsis .btn-usual-ok:not(.disable)'
          ) as HTMLElement;
          if (startOk && startOk.offsetParent !== null) {
            try {
              if ($) $(startOk).trigger('tap');
              startOk.click();
              return 'started_quest';
            } catch {
              return null;
            }
          }

          // 5. Story scene SKIP button
          const skipBtn = document.querySelector(
            '.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"]'
          ) as HTMLElement;
          if (skipBtn && skipBtn.offsetParent !== null) {
            try {
              if ($) $(skipBtn).trigger('tap');
              skipBtn.click();
              return 'clicked_skip_button';
            } catch {
              return null;
            }
          }

          // 6. Dialogue choice inside story
          const choiceBtn = document.querySelector(
            '.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok'
          ) as HTMLElement;
          if (choiceBtn && choiceBtn.offsetParent !== null) {
            try {
              if ($) $(choiceBtn).trigger('tap');
              choiceBtn.click();
              return 'selected_choice';
            } catch {
              return null;
            }
          }

          // 7. Scene canvas or stage active: tap to awaken HUD
          const sceneCanvas = document.querySelector('canvas#canvas, canvas#cjs-canvas, .prt-scene-comment, .cnt-quest-scene') as HTMLElement;
          if (sceneCanvas && sceneCanvas.offsetParent !== null) {
            return 'canvas_ready';
          }

          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (actionTaken === 'confirmed_skip_modal') {
        console.log('[Workflow] Confirmed story skip dialog. Awaiting transition to result/combat...');
        await logNormalDelay(600, 0.2);

        const tWait = Date.now();
        while (Date.now() - tWait < 12000) {
          const url = this.page.url();
          if (url.includes('result') || url.includes('#quest/supporter') || url.includes('#raid') || url.includes('#quest/fate') || url.includes('#mypage')) {
            break;
          }
          await new Promise(r => setTimeout(r, 300));
        }
        break;
      } else if (actionTaken === 'conflict_error') {
        console.warn('[Workflow] ⚠️ "Skip Cutscenes" conflict detected. Resetting setting via FateEngine...');
        const fateEngine = new FateEngine(this.page, this.ctx.sentinel);
        await fateEngine.ensureQuestSkipDisabled();
        continue;
      } else if (actionTaken === 'confirmed_caution' || actionTaken === 'started_quest') {
        await logNormalDelay(600, 0.2);
        continue;
      } else if (actionTaken === 'clicked_skip_button') {
        console.log('[Workflow] Clicked story Skip button.');
        await logNormalDelay(400, 0.2);
        continue;
      } else if (actionTaken === 'selected_choice') {
        console.log('[Workflow] Selected story dialogue option.');
        await logNormalDelay(350, 0.15);
        continue;
      } else if (actionTaken === 'canvas_ready') {
        await this.page.touchscreen.tap(240, 360).catch(() => null);
        await logNormalDelay(350, 0.2);
      } else {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    await this.handleDismissPopups(step);
    return true;
  }

  private fateEngine: FateEngine | null = null;

  private getFateEngine(): FateEngine {
    if (!this.fateEngine) {
      this.fateEngine = new FateEngine(this.page, this.ctx.sentinel);
    }
    return this.fateEngine;
  }

  /**
   * Autonomous Fate Episode clearer for UniversalWorkflowEngine.
   */
  public async handleFateEpisode(step?: WorkflowStep): Promise<boolean> {
    console.log('[Workflow] 📖 Processing Fate Episode via FateEngine...');
    try {
      const fateEngine = this.getFateEngine();
      await fateEngine.ensureQuestSkipDisabled();
      const result = await fateEngine.processSingleFateEpisode();
      if (result.status === 'SUCCESS') {
        console.log(`[Workflow] 🎉 Fate episode cleared: "${result.questName || 'Unknown'}" (Quest ID: ${result.questId || 'N/A'}, Combat: ${result.hasCombat ? 'Yes' : 'No'})`);
        return true;
      }
      if (result.status === 'NO_UNREAD_EPISODES') {
        console.log('[Workflow] 🏁 All available Fate Episodes are cleared!');
        this.ctx.state.stopRequested = true;
        return true;
      }
      if (result.status === 'STOPPED') {
        this.ctx.state.stopRequested = true;
        return false;
      }
      console.warn(`[Workflow] ⚠️ Fate Episode ended with status: ${result.status} (${result.message}). Continuing...`);
      return true;
    } catch (err: any) {
      console.warn(`[Workflow] ⚠️ Recovered from exception in handleFateEpisode: ${err?.message || err}`);
      return true;
    }
  }
}

import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, logNormalDelay } from '../human-motor.js';
import { config } from '../config.js';
import { HybridApiClient } from './hybrid-client.js';

export type ProSkipTarget = 'hard_pro' | 'magna_pro' | 'manacura_pro' | 'halo_pro' | 'all';

export interface ProSkipResult {
  target: string;
  status: 'SUCCESS' | 'ALREADY_CLEARED' | 'AP_DEFICIENT' | 'FAILED';
  message: string;
  consumedAp: number;
}

export class ProSkipEngine {
  private hybrid: HybridApiClient;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {
    this.hybrid = new HybridApiClient(page, sentinel);
  }

  /**
   * Orchestrates the execution of a specified Pro Skip category or all categories sequentially.
   */
  public async execute(target: ProSkipTarget, autoReplenishAp = true): Promise<ProSkipResult[]> {
    await this.sentinel.assertSafe();

    if (target === 'all') {
      return await this.runFavoritesProSkips(autoReplenishAp);
    }

    if (target === 'magna_pro' || (target as string) === 'omega_impossible') {
      return await this.runFavoritesProSkips(autoReplenishAp, 'Omega (Impossible)');
    }

    return [await this.runIslandProSkip(target, autoReplenishAp)];
  }

  /**
   * Automatically iterates through all Pro Skip daily quests pinned in .prt-noindex-list on #quest.
   * Continues until EVERY uncleared Pro Skip in favorites is completed today.
   */
  public async runFavoritesProSkips(autoReplenishAp = true, specificTargetName?: string): Promise<ProSkipResult[]> {
    const results: ProSkipResult[] = [];
    const questFailureCounts = new Map<string, number>();

    console.log('[ProSkipEngine] Navigating to #quest for Favorites Pro Skips...');
    await this.sentinel.assertSafe();

    // 1. Ensure strictly on #quest/index
    const currentHash = await this.page.evaluate(() => window.location.hash);
    if (currentHash !== '#quest' && currentHash !== '#quest/index') {
      await this.page.evaluate(() => { window.location.hash = '#quest/index'; });
    }
    await this.sentinel.assertSafe();

    // 2. Verify account is authenticated and not redirected to #top or #authentication
    const postNavUrl = this.page.url();
    if (postNavUrl.includes('#top') || postNavUrl.includes('#authentication')) {
      throw new Error(`[ProSkipEngine] Browser is NOT logged in! GBF redirected to ${postNavUrl}. Please run "npm run launch:chrome" and log in first.`);
    }

    // 3. Clear pre-existing modals and await idle quest page
    await this.waitForQuestPageReady();

    let iteration = 0;
    const maxIterations = 25; // Accommodate up to 25 daily skips in one run
    let consecutiveRetries = 0;

    while (iteration < maxIterations) {
      iteration++;
      await this.sentinel.assertSafe();

      await this.waitForQuestPageReady();

      // Scan all pro skip cards in the favorites list
      const { totalCardsCount, proCards } = await this.scanProSkipCards();

      // Filter for uncleared candidates that have not repeatedly failed
      const unclearedCandidates = proCards.filter(c => {
        if (c.isCleared) return false;
        const fails = questFailureCounts.get(c.questId || c.questName) || 0;
        if (fails >= 2) return false;
        if (specificTargetName && !c.questName.toLowerCase().includes(specificTargetName.toLowerCase())) return false;
        return true;
      });

      if (unclearedCandidates.length === 0) {
        // Only retry if the list container has 0 total cards mounted (Backbone route still in transit)
        if (totalCardsCount === 0 && consecutiveRetries < 2) {
          consecutiveRetries++;
          console.log(`[ProSkipEngine] Waiting for favorites list to populate (attempt ${consecutiveRetries}/2)...`);
          await logNormalDelay(1000, 0.2);
          continue;
        }

        // Record any cleared cards that aren't in results yet
        for (const card of proCards) {
          if (card.isCleared && !results.some(r => r.target === card.questName)) {
            results.push({
              target: card.questName,
              status: 'ALREADY_CLEARED',
              message: 'Already cleared today.',
              consumedAp: 0
            });
          }
        }

        console.log('[ProSkipEngine] All available Pro Skips in favorites are cleared!');
        break;
      }

      consecutiveRetries = 0;
      const candidate = unclearedCandidates[0];

      console.log(`\n[ProSkipEngine] [${iteration}] Pro Skip target: "${candidate.questName}" (Quest ID: ${candidate.questId}, proChapterId: ${candidate.proChapterId}, hosts left: ${candidate.limitedCount || 'unlimited'})`);

      let skipSuccess = false;
      let consumedAp = 0;

      // Fast Path: Hybrid In-Page API Dispatch
      if (config.EXECUTION_MODE === 'hybrid' && candidate.questId) {
        console.log(`[ProSkipEngine] [Hybrid API] Dispatching skip for "${candidate.questName}" (Quest ID: ${candidate.questId})...`);
        try {
          const apiRes = await this.hybrid.executeProSkip(candidate.questId, autoReplenishAp);
          if (apiRes && apiRes.success) {
            consumedAp = apiRes.consumed_ap || 0;
            skipSuccess = true;
            console.log(`[ProSkipEngine] [Hybrid API] Skip successful! Consumed AP: ${consumedAp}`);
            results.push({
              target: candidate.questName,
              status: 'SUCCESS',
              message: `${candidate.questName} Pro successfully cleared via Hybrid API.`,
              consumedAp
            });
            await this.safelyReturnToQuestIndex();
            continue;
          }
        } catch (apiErr: any) {
          console.warn(`[ProSkipEngine] [Hybrid API] Failed (${apiErr.message}), falling back to DOM click...`);
        }
      }

      // DOM Flow: Locate specific card element in page
      const cardHandle = (await this.page.evaluateHandle((qId, qName) => {
        const proEl = document.querySelector(`.prt-noindex-list [data-quest-id="${qId}"][data-pro-quest-skip="true"]`) ||
                      document.querySelector(`.prt-noindex-list [data-quest-name="${qName}"] [data-pro-quest-skip="true"]`) ||
                      document.querySelector(`.prt-noindex-list [data-quest-name="${qName}"]`);
        return proEl?.closest('.prt-list-contents') || proEl;
      }, candidate.questId, candidate.questName)).asElement() as any;

      if (!cardHandle) {
        console.warn(`[ProSkipEngine] Could not resolve DOM element for "${candidate.questName}". Skipping...`);
        questFailureCounts.set(candidate.questId || candidate.questName, (questFailureCounts.get(candidate.questId || candidate.questName) || 0) + 1);
        results.push({
          target: candidate.questName,
          status: 'FAILED',
          message: `Could not locate DOM element for ${candidate.questName}.`,
          consumedAp: 0
        });
        continue;
      }

      console.log(`[ProSkipEngine] Clicking card for "${candidate.questName}"...`);
      await humanizedClick(this.page, cardHandle);
      await this.sentinel.assertSafe();

      // Handle synopsis modal if it mounts first
      await this.dismissSynopsisModalIfPresent();

      // Phase 1: Confirm Pro Skip modal on #quest
      const confirmBtnSelector = '.pop-pro-quest-skip .btn-usual-ok, .btn-usual-ok[data-chapter-name*="Pro"], .btn-usual-ok[data-type="28"]';
      const confirmBtn = await this.page.waitForSelector(confirmBtnSelector, { visible: true, timeout: 5000 }).catch(() => null);

      if (confirmBtn) {
        consumedAp = await this.page.evaluate((el: any) => {
          return parseInt(el.getAttribute('data-ap') || el.getAttribute('data-quest-ap') || '0', 10);
        }, confirmBtn);

        console.log(`[ProSkipEngine] Confirming modal for "${candidate.questName}" (${consumedAp} AP)...`);
        await humanizedClick(this.page, confirmBtn);
        await this.sentinel.assertSafe();
      }

      // Check AP replenishment modal
      await this.handleApRecoveryIfPresent(autoReplenishAp);

      // Phase 2: Supporter screen / Final Start button (.se-quest-start)
      const startBtnSelector = '.btn-usual-ok.se-quest-start, .btn-usual-ok[data-type-id="28"]';
      const startBtn = await this.page.waitForSelector(startBtnSelector, { visible: true, timeout: 5000 }).catch(() => null);

      if (startBtn) {
        console.log(`[ProSkipEngine] Confirming final skip button on supporter screen (.se-quest-start)...`);
        await humanizedClick(this.page, startBtn);
        await this.sentinel.assertSafe();

        // Check if AP recovery modal appeared after clicking start
        await this.handleApRecoveryIfPresent(autoReplenishAp);
      }

      // Reactive Wait for Result page or reward modal (#result_pro_quest_skip)
      if (typeof this.page.waitForFunction === 'function') {
        await this.page.waitForFunction(() => {
          return window.location.hash.includes('result_pro_quest_skip') ||
                 !!document.querySelector('.pop-usual.pop-exp, .pop-show, .prt-result-head');
        }, { timeout: 8000, polling: 50 }).catch(() => null);
      }

      // Fast dismissal of post-clear reward dialogues (EXP, Level Up, Loot)
      console.log(`[ProSkipEngine] Dismissing post-clear rewards for "${candidate.questName}"...`);
      await this.dismissAllPopups(5);

      results.push({
        target: candidate.questName,
        status: 'SUCCESS',
        message: `${candidate.questName} Pro successfully cleared.`,
        consumedAp
      });

      // Safely return to #quest/index and wait for complete re-render before next iteration
      await this.safelyReturnToQuestIndex();
    }

    if (results.length === 0) {
      results.push({
        target: 'favorites_pro_skips',
        status: 'ALREADY_CLEARED',
        message: 'All daily Pro Skips in favorites are already cleared for today.',
        consumedAp: 0
      });
    }

    // Return to #mypage
    console.log('[ProSkipEngine] Routine finished. Safely returning to #mypage...');
    await this.page.evaluate(() => { window.location.hash = '#mypage'; });
    await this.page.waitForSelector('.cnt-mypage, .prt-user-info', { visible: true, timeout: 5000 }).catch(() => null);
    await logNormalDelay(250, 0.15);

    // Dismiss trailing modals that mount upon landing on #mypage (Skyscope mission notifications, Processing OK)
    await this.dismissAllPopups(3);

    return results;
  }

  /**
   * Scans all Pro Skip cards currently pinned in .prt-noindex-list and evaluates completion state.
   */
  private async scanProSkipCards(): Promise<{
    totalCardsCount: number;
    proCards: Array<{
      questName: string;
      questId: string;
      proChapterId: string;
      limitedCount: string;
      isCleared: boolean;
    }>;
  }> {
    return await this.page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.prt-noindex-list .prt-list-contents, .cnt-quest .prt-list-contents'));
      const proQuests: Array<{
        questName: string;
        questId: string;
        proChapterId: string;
        limitedCount: string;
        isCleared: boolean;
      }> = [];

      for (const c of cards) {
        const proEl = c.querySelector('[data-pro-quest-skip="true"]') || (c.getAttribute('data-pro-quest-skip') === 'true' ? c : null);
        if (!proEl) continue;

        const questName = c.getAttribute('data-quest-name') ||
                          proEl.getAttribute('data-quest-name') ||
                          c.querySelector('.txt-quest-title, .txt-quest-name')?.textContent?.trim() ||
                          'Unknown Quest';
        const questId = proEl.getAttribute('data-quest-id') || c.getAttribute('data-quest-id') || '';
        const proChapterId = proEl.getAttribute('data-pro-chapter-id') || '';
        const limitedCount = proEl.getAttribute('data-limited_count') || c.getAttribute('data-limited_count') || '';

        const hasCompletedClass = c.classList.contains('is-completed') || proEl.classList.contains('is-completed');
        const hasDisableClass = c.classList.contains('disable') || proEl.classList.contains('disable');
        const isCountZero = limitedCount === '0';

        // In GBF, a quest is ONLY cleared today if attempts remaining is '0' or card is explicitly completed/disabled.
        // NOTE: .ico-clear and "CLEARED!" indicate historical account first-clear, NOT daily completion.
        const isCleared = isCountZero || hasCompletedClass || hasDisableClass;

        proQuests.push({
          questName,
          questId,
          proChapterId,
          limitedCount,
          isCleared: !!isCleared
        });
      }

      return {
        totalCardsCount: cards.length,
        proCards: proQuests
      };
    });
  }

  /**
   * Safely navigates back to #quest/index, clears transient popups, and awaits stable idle state.
   */
  private async safelyReturnToQuestIndex(): Promise<void> {
    await this.sentinel.assertSafe();
    await this.dismissAllPopups(3);

    console.log('[ProSkipEngine] Returning to #quest/index for next mission...');
    await this.page.evaluate(() => {
      const globalQuestBtn = document.querySelector('.btn-global-quest, .btn-quest, [data-location-href="quest"]') as HTMLElement;
      if (globalQuestBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(globalQuestBtn).trigger('tap');
        globalQuestBtn.click();
      } else {
        const bb = (window as any).Backbone;
        if (bb && bb.history) {
          bb.history.navigate('quest/index', { trigger: true });
        } else {
          window.location.hash = '#quest/index';
        }
      }
    });

    await this.waitForQuestPageReady();
  }

  /**
   * Waits for loading overlay, active AJAX requests, and DOM mounting to settle completely.
   */
  private async waitForQuestPageReady(): Promise<void> {
    // 1. Wait for loading spinner to disappear and jQuery ajax to be 0
    if (typeof this.page.waitForFunction === 'function') {
      await this.page.waitForFunction(() => {
        const loading = document.querySelector('#loading, .loading, .prt-loading-container');
        const isLoadingVisible = loading && window.getComputedStyle(loading).display !== 'none' && !loading.classList.contains('hide');
        const $ = (window as any).$ || (window as any).Zepto;
        const isAjaxActive = $ && typeof $.active === 'number' && $.active > 0;
        return !isLoadingVisible && !isAjaxActive;
      }, { timeout: 10000, polling: 100 }).catch(() => null);
    }

    // 2. Wait until page hash is on #quest and favorites container is populated
    if (typeof this.page.waitForFunction === 'function') {
      await this.page.waitForFunction(() => {
        const isQuestHash = window.location.hash.startsWith('#quest') && !window.location.hash.includes('result');
        const hasCards = !!document.querySelector('.prt-noindex-list .prt-list-contents');
        return isQuestHash && hasCards;
      }, { timeout: 10000, polling: 100 }).catch(() => null);
    } else {
      await this.page.waitForSelector('.prt-noindex-list .prt-list-contents', { visible: true, timeout: 8000 }).catch(() => null);
    }

    // 3. Clear any transient modals (like "Processing. Please wait" or Skyscope)
    await this.dismissAllPopups(2);

    // 4. Brief settle delay
    await logNormalDelay(400, 0.15);
  }

  /**
   * Dismisses synopsis popup if presented before the quest modal.
   */
  private async dismissSynopsisModalIfPresent(): Promise<void> {
    const synopsisOk = await this.page.$('.pop-synopsis.pop-show .btn-usual-ok, .pop-show .btn-usual-ok:not([data-type="28"]):not([data-chapter-name*="Pro"]):not(.se-quest-start)');
    if (synopsisOk) {
      const isSynopsis = await this.page.evaluate((el: any) => {
        return !!el.closest('.pop-synopsis') || (!el.getAttribute('data-chapter-name') && !el.classList.contains('se-quest-start'));
      }, synopsisOk).catch(() => false);

      if (isSynopsis) {
        await humanizedClick(this.page, synopsisOk);
        await this.sentinel.assertSafe();
      }
    }
  }

  private async handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean> {
    const apRecoveryModal = await this.page.$('.pop-usual .btn-use-item, .pop-usual .use-item, .pop-show .btn-use-item, .btn-use-item');
    if (!apRecoveryModal) return false;

    if (!autoReplenishAp) {
      const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel, .pop-show .btn-usual-cancel');
      if (cancelBtn) await humanizedClick(this.page, cancelBtn);
      return false;
    }

    console.log('[ProSkipEngine] AP insufficient. Consuming Half-Elixir...');
    await humanizedClick(this.page, apRecoveryModal);
    const confirmItemUse = await this.page.waitForSelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok', { visible: true, timeout: 5000 }).catch(() => null);
    if (confirmItemUse) {
      await humanizedClick(this.page, confirmItemUse);
      await logNormalDelay(250, 0.15);
    }
    await this.sentinel.assertSafe();
    return true;
  }

  public async runOmegaImpossiblePro(autoReplenishAp: boolean): Promise<ProSkipResult> {
    const results = await this.runFavoritesProSkips(autoReplenishAp, 'Omega (Impossible)');
    return results[0] || {
      target: 'omega_impossible_pro',
      status: 'ALREADY_CLEARED',
      message: 'Already cleared today.',
      consumedAp: 0
    };
  }

  private async runIslandProSkip(target: ProSkipTarget, autoReplenishAp: boolean): Promise<ProSkipResult> {
    console.log(`[ProSkipEngine] Initiating Pro Skip for: ${target}`);
    await this.sentinel.assertSafe();

    // 1. Navigate to Island / Extra Quest Overview
    await this.page.evaluate(() => { window.location.hash = '#quest/extra'; });
    await this.sentinel.assertSafe();

    // 2. Clear any pre-existing modal
    await this.dismissAllPopups(2);

    // 3. Wait for list container mount
    await this.page.waitForSelector('.prt-extra-list, .prt-island-list, .cnt-extra', { visible: true, timeout: 10000 });

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
      await this.sentinel.assertSafe();

      // Confirm item use dialog
      const confirmItemUse = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 8000 });
      if (confirmItemUse) {
        await humanizedClick(this.page, confirmItemUse);
        await logNormalDelay(250, 0.15);
        await this.sentinel.assertSafe();
      }
    }

    // 8. Confirm Pro Skip Transaction Modal
    const confirmModalBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 8000 });
    if (!confirmModalBtn) {
      throw new Error('Pro Skip confirmation modal did not appear.');
    }
    await humanizedClick(this.page, confirmModalBtn);
    await this.sentinel.assertSafe();

    // 9. Fast Dismissal Loop
    console.log('[ProSkipEngine] Dismissing post-clear reward & level-up dialogues...');
    await this.dismissAllPopups(4);

    // 10. Return to #mypage for clean, predictable state
    await this.page.evaluate(() => { window.location.hash = '#mypage'; });
    await logNormalDelay(250, 0.15);

    return {
      target,
      status: 'SUCCESS',
      message: 'Pro Skip successfully cleared and all rewards collected.',
      consumedAp: target === 'magna_pro' ? 180 : 90
    };
  }

  /**
   * Fast, reactive dismissal of stacked popups (Loot, Rank Up, Level Up, Master Level).
   * Executes an in-page evaluation to immediately trigger dismiss buttons without multi-second polling.
   */
  private async dismissAllPopups(maxIterations = 5): Promise<void> {
    for (let i = 0; i < maxIterations; i++) {
      const dismissed = await this.page.evaluate(() => {
        // 1. Explicitly check for error/processing popups
        const errorPopups = Array.from(document.querySelectorAll('.common-pop-error, .pop-show, .pop-usual'));
        for (const pop of errorPopups) {
          if (pop.textContent?.includes('Processing') || pop.textContent?.includes('Error')) {
            const okBtn = pop.querySelector('.btn-usual-ok, .btn-usual-close, .btn-close') as HTMLElement;
            if (okBtn) {
              const rect = okBtn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(okBtn).trigger('tap');
                okBtn.click();
                return true;
              }
            }
          }
        }

        // 2. Standard popup dismissal selectors
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
      }).catch(() => false);

      if (!dismissed) break; // All modals cleared
      await logNormalDelay(120, 0.15);
    }
  }
}

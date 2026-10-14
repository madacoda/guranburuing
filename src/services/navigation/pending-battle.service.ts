// src/services/navigation/pending-battle.service.ts
import { Page } from 'puppeteer-core';
import { IPendingBattleService, PendingBattleResolution } from '../../domain/navigation/navigation.types.js';
import { logNormalDelay } from '../../human-motor.js';
import { config } from '../../config.js';

/**
 * Universal service for detecting, inspecting, and claiming pending / unclaimed battles.
 * Adheres to SRP: Exclusively manages pending battle reconciliation.
 */
export class PendingBattleService implements IPendingBattleService {
  constructor(private page: Page) {}

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Inspects current DOM for pending battle limit modals (e.g. 3-raid backup limit or 5-battle cap)
   * and clears all unclaimed battles if detected.
   */
  public async checkAndClearPendingBattles(targetUrlAfterClean = 'https://game.granbluefantasy.jp/#quest/assist'): Promise<PendingBattleResolution> {
    const isLimitActive = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
      if (!modal || (modal as HTMLElement).offsetParent === null) return false;
      const text = ((modal as HTMLElement).innerText || '').toLowerCase();
      const rawText = (modal as HTMLElement).innerText || '';
      return (
        text.includes('three raid') ||
        text.includes('up to three') ||
        text.includes('provide backup in up to') ||
        text.includes('only provide backup') ||
        text.includes('pending') ||
        text.includes('unclaimed') ||
        rawText.includes('未確認') ||
        text.includes('five or more') ||
        text.includes('3 battles') ||
        text.includes('3 raid') ||
        text.includes('participating in 3') ||
        text.includes('more than 3') ||
        text.includes('up to 3') ||
        rawText.includes('3件まで') ||
        rawText.includes('同時に参戦できる') ||
        rawText.includes('参戦中') ||
        rawText.includes('3件') ||
        rawText.includes('5件')
      );
    }).catch(() => false);

    if (!isLimitActive) {
      return {
        hasPendingBattles: false,
        unclaimedCount: 0,
        clearedCount: 0,
        goldBarDetected: false,
        blueChestDetected: false,
        message: 'No pending battle limit modal present.'
      };
    }

    console.log('[PendingBattleService] 🛡️ Raid backup limit modal detected. Resolving unclaimed battles...');
    // Dismiss limit warning popup
    await this.page.evaluate(() => {
      const ok = document.querySelector('.pop-usual .btn-usual-ok, #pop .btn-usual-ok, .btn-usual-close') as HTMLElement;
      if (ok) ok.click();
    }).catch(() => null);

    await logNormalDelay(400, 0.1);
    return await this.claimAllUnclaimedBattles(targetUrlAfterClean);
  }

  /**
   * Inspects count of pending battles from DOM or API.
   */
  public async inspectUnclaimedCount(): Promise<number> {
    return await this.page.evaluate(() => {
      const countEl = document.querySelector('.txt-unclaimed-count, .prt-unclaimed-count, [data-unclaimed-count]');
      if (countEl?.textContent) {
        const parsed = parseInt(countEl.textContent.trim(), 10);
        if (!isNaN(parsed)) return parsed;
      }
      return 0;
    }).catch(() => 0);
  }

  /**
   * Navigates to #quest/assist/unclaimed/0/0 and claims all loot.
   */
  public async claimAllUnclaimedBattles(returnUrl: string): Promise<PendingBattleResolution> {
    console.log('[PendingBattleService] Checking and claiming ALL unclaimed battles (#quest/assist/unclaimed/0/0)...');

    await this.page.evaluate(() => {
      const Game = (window as any).Game;
      if (Game?.router?.navigate) {
        Game.router.navigate('quest/assist/unclaimed/0/0', { trigger: true });
      } else {
        window.location.hash = '#quest/assist/unclaimed/0/0';
      }
    }).catch(() => null);

    // Reactive wait for unclaimed cards or assist screen to mount
    await this.waitForConditionOrTimeout(async () => {
      return await this.page.evaluate(() => {
        return !!document.querySelector('.btn-unclaimed, .btn-reward-check, .btn-claim, .prt-lead-unclaimed, .cnt-quest-assist');
      }).catch(() => false);
    }, config.isProduction ? 800 : 1800, config.isProduction ? 35 : 75);

    let clearedCount = 0;
    let goldBarDetected = false;
    let blueChestDetected = false;

    // Loop through claiming cards
    const maxPasses = 10;
    for (let pass = 0; pass < maxPasses; pass++) {
      const hasUnclaimed = await this.page.evaluate(() => {
        const cards = document.querySelectorAll(
          '.btn-unclaimed, .btn-reward-check, .btn-claim, [data-location-href*="result"]'
        );
        return cards.length > 0;
      }).catch(() => false);

      if (!hasUnclaimed) break;

      // Click first unclaimed battle card
      await this.page.evaluate(() => {
        const card = document.querySelector(
          '.btn-unclaimed, .btn-reward-check, .btn-claim, [data-location-href*="result"]'
        ) as HTMLElement;
        if (card) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(card).trigger('tap');
          card.click();
        }
      }).catch(() => null);

      // Reactive wait for result modal or blue chest / loot roll
      await this.waitForConditionOrTimeout(async () => {
        return await this.page.evaluate(() => {
          return !!document.querySelector('.pop-usual, .btn-usual-ok, .prt-blue-chest, [data-item-id]');
        }).catch(() => false);
      }, config.isProduction ? 800 : 1500, config.isProduction ? 35 : 75);

      // Check if reward result screen reached
      const resultData = await this.page.evaluate(() => {
        const resultRoot = document.querySelector('#cnt-result, .cnt-result, .prt-result-cnt, .pop-raid-result') as HTMLElement | null;
        const text = (resultRoot ? resultRoot.innerText : document.body.innerText) || '';
        const candidates = Array.from(document.querySelectorAll(
          '[data-key="17_20004"], img[src*="/item/evolution/"][src*="20004."], .lis-treasure.btn-treasure-item[data-item-id="20004"], #cnt-result [data-item-id="20004"]:not(.prt-treasure-wrapper), .cnt-result [data-item-id="20004"]:not(.prt-treasure-wrapper)'
        ));
        const hasDomGoldBar = candidates.some(el => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.closest('#submenu, .cnt-treasure-footer, .prt-treasure-wrapper')) return false;
          return htmlEl.offsetParent !== null;
        });
        const hasGoldBar = /\b(?:Gold\s+Brick|Gold\s+Bar)\b/i.test(text) || text.includes('ヒヒイロカネ') || hasDomGoldBar;
        const hasBlueChest = !!document.querySelector('.prt-blue-chest, .ico-blue-chest, .ico-treasure-11-mini, [data-box-type="11"]');
        return { hasGoldBar, hasBlueChest };
      }).catch(() => ({ hasGoldBar: false, hasBlueChest: false }));

      if (resultData.hasGoldBar) goldBarDetected = true;
      if (resultData.hasBlueChest) blueChestDetected = true;

      clearedCount++;

      // Dismiss reward popup and return to unclaimed list
      await this.page.evaluate(() => {
        const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
        if (ok) ok.click();
        const Game = (window as any).Game;
        if (Game?.router?.navigate) {
          Game.router.navigate('quest/assist/unclaimed/0/0', { trigger: true });
        } else {
          window.location.hash = '#quest/assist/unclaimed/0/0';
        }
      }).catch(() => null);

      await logNormalDelay(config.isProduction ? 150 : 600, 0.15);
    }

    // Clean return to target URL
    console.log(`[PendingBattleService] Clean return to: ${returnUrl}`);
    const targetHash = returnUrl.includes('#') ? returnUrl.split('#')[1] : returnUrl;
    await this.page.evaluate((url: string) => {
      const hash = url.includes('#') ? url.split('#')[1] : url;
      const Game = (window as any).Game;
      if (Game?.router?.navigate) {
        Game.router.navigate(hash, { trigger: true });
      } else {
        window.location.href = url;
      }
    }, returnUrl).catch(() => null);

    // Reactive return wait
    await this.waitForConditionOrTimeout(async () => {
      return await this.page.evaluate((target: string) => {
        return window.location.href.includes(target) || !!document.querySelector('.cnt-quest, .prt-command, .btn-attack-start');
      }, targetHash).catch(() => false);
    }, config.isProduction ? 700 : 1200, config.isProduction ? 35 : 75);

    return {
      hasPendingBattles: clearedCount > 0,
      unclaimedCount: clearedCount,
      clearedCount,
      goldBarDetected,
      blueChestDetected,
      message: clearedCount > 0 ? `Successfully cleared ${clearedCount} pending battle(s).` : 'No pending battles found.'
    };
  }

  private async waitForConditionOrTimeout(
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    pollMs = 50
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate().catch(() => false)) return true;
      await new Promise(r => setTimeout(r, pollMs));
    }
    return false;
  }
}

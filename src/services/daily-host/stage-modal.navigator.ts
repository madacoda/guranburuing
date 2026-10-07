// src/services/daily-host/stage-modal.navigator.ts
import { Page } from 'puppeteer-core';
import { IStageModalNavigator } from '../../domain/daily-host/daily-host.interfaces.js';
import { logNormalDelay } from '../../human-motor.js';

export class StageModalNavigator implements IStageModalNavigator {
  private page: Page;
  private activeStageId: string | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  public resetActiveStage(): void {
    this.activeStageId = null;
  }

  public getActiveStageId(): string | null {
    return this.activeStageId;
  }

  /**
   * Navigates to #quest/multi/0 and ensures the "Impossible" tab is active.
   */
  public async navigateToMultiList(): Promise<void> {
    this.activeStageId = null;

    // Ensure any open stage modals are dismissed first
    await this.closeStageCategoryModal();

    const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isAlreadyOnMulti0 = curHash === '#quest/multi/0' || curHash === '#quest/multi';

    if (!isAlreadyOnMulti0) {
      console.log('[DailyHost:Nav] 🧭 Navigating to Raid List (https://game.granbluefantasy.jp/#quest/multi/0)...');
      await this.page.evaluate(() => {
        const Game = (window as any).Game;
        if (Game && Game.router) {
          Game.router.navigate('quest/multi/0', { trigger: true });
        } else {
          window.location.hash = '#quest/multi/0';
        }
      }).catch(() => null);

      await logNormalDelay(1500, 0.15);
    }

    // Ensure "Impossible" tab (data-stage-type="high") is active
    await this.page.evaluate(() => {
      const highBtn = document.querySelector('.btn-stage-type[data-stage-type="high"]') as HTMLElement;
      if (highBtn && !highBtn.classList.contains('active')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) {
          $(highBtn).trigger('tap');
          $(highBtn).trigger('click');
        }
        highBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(600, 0.15);
  }

  /**
   * Opens the stage modal (e.g. 12061 for HL, 12042 for Magna 3, 12051 for Dragons).
   */
  public async openStageCategoryModal(stageId: string): Promise<boolean> {
    // Ensure we are on #quest/multi/0 with the high-level tab active
    const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (!curHash.includes('quest/multi')) {
      await this.navigateToMultiList();
    }

    // Check if the modal is currently open and displays quest banners
    const modalState = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-stage-detail.pop-show, .pop-usual.pop-show') as HTMLElement;
      if (!modal || modal.offsetParent === null) return null;
      const banners = modal.querySelectorAll('.prt-stage-quest .prt-quest-banner, .prt-quest-banner, [data-quest-id]');
      return { isOpen: true, questCount: banners.length };
    }).catch(() => null);

    if (modalState && modalState.isOpen && this.activeStageId === stageId && modalState.questCount > 0) {
      return true;
    }

    // If another stage modal is open, dismiss it first cleanly
    if (modalState && modalState.isOpen) {
      await this.closeStageCategoryModal();
    }

    // Ensure the appropriate tab (Standard 'normal' for 11xxx, Impossible 'high' for 12xxx, 'calamitous' for 13xxx) is active
    const targetTabType = stageId.startsWith('11') ? 'normal' : stageId.startsWith('13') ? 'calamitous' : 'high';
    await this.page.evaluate((tabType: string) => {
      const tabBtn = document.querySelector(`.btn-stage-type[data-stage-type="${tabType}"]`) as HTMLElement;
      if (tabBtn && !tabBtn.classList.contains('active')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) {
          $(tabBtn).trigger('tap');
          $(tabBtn).trigger('click');
        }
        tabBtn.click();
      }
    }, targetTabType).catch(() => null);
    await logNormalDelay(400, 0.1);

    console.log(`[DailyHost:Nav] Opening Stage card [${stageId}] (Tab: ${targetTabType})...`);
    const tCardStart = Date.now();
    let clicked = false;
    while (Date.now() - tCardStart < 4000) {
      clicked = await this.page.evaluate((sId: string) => {
        const card = document.querySelector(`.btn-stage-detail[data-stage-id="${sId}"]`) as HTMLElement;
        if (card && card.offsetParent !== null) {
          card.scrollIntoView({ block: 'center', behavior: 'instant' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(card).trigger('tap');
            $(card).trigger('click');
          }
          card.click();
          return true;
        }
        return false;
      }, stageId).catch(() => false);

      if (clicked) break;
      await logNormalDelay(250, 0.1);
    }

    if (!clicked) {
      console.warn(`[DailyHost:Nav] Stage card [${stageId}] not found on page after wait.`);
      return false;
    }

    // Wait up to 3500ms for modal / quest banners to mount
    const tWait = Date.now();
    let modalMounted = false;
    while (Date.now() - tWait < 3500) {
      modalMounted = await this.page.evaluate(() => {
        const modal = document.querySelector('.pop-stage-detail.pop-show, .pop-usual.pop-show') as HTMLElement;
        if (!modal || modal.offsetParent === null) return false;
        const banners = modal.querySelectorAll('.prt-stage-quest .prt-quest-banner, .prt-quest-banner, [data-quest-id]');
        return banners.length > 0;
      }).catch(() => false);
      if (modalMounted) break;
      await logNormalDelay(250, 0.1);
    }

    if (!modalMounted) {
      console.warn(`[DailyHost:Nav] Modal for Stage [${stageId}] did not mount in time.`);
      return false;
    }

    this.activeStageId = stageId;
    return true;
  }

  /**
   * Closes the active stage modal cleanly using .btn-usual-close.
   */
  public async closeStageCategoryModal(): Promise<void> {
    await this.page.evaluate(() => {
      const close = document.querySelector(
        '.pop-stage-detail .btn-usual-close, .pop-usual .btn-usual-close, .btn-usual-close, .pop-stage-detail .btn-close, .pop-usual .btn-close, .btn-close'
      ) as HTMLElement;
      if (close) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) {
          $(close).trigger('tap');
          $(close).trigger('click');
        }
        close.click();
      }
    }).catch(() => null);

    this.activeStageId = null;
    await logNormalDelay(400, 0.1);

    // Wait briefly up to 1500ms for modal DOM to dismiss
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) {
      const isStillOpen = await this.page.evaluate(() => {
        const modal = document.querySelector('.pop-stage-detail.pop-show, .pop-usual.pop-show') as HTMLElement;
        return modal && modal.offsetParent !== null;
      }).catch(() => false);
      if (!isStillOpen) break;
      await logNormalDelay(150, 0.05);
    }
  }
}

// src/services/daily-host/host-precondition.validator.ts
import { Page } from 'puppeteer-core';
import { IHostPreconditionValidator } from '../../domain/daily-host/daily-host.interfaces.js';
import { HostPreconditionCheck } from '../../domain/daily-host/daily-host.types.js';
import { logNormalDelay } from '../../human-motor.js';

export class HostPreconditionValidator implements IHostPreconditionValidator {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Inspects if the target quest exists in the open modal and determines remaining daily host limits.
   */
  public async inspectQuestAvailability(questId: string): Promise<HostPreconditionCheck> {
    const t0 = Date.now();
    while (Date.now() - t0 < 3500) {
      const status = await this.page.evaluate((qId: string) => {
        const banner = document.querySelector(
          `.prt-stage-quest .prt-quest-banner[data-quest-id="${qId}"], .prt-quest-banner[data-quest-id="${qId}"], [data-quest-id="${qId}"]`
        ) as HTMLElement;

        if (!banner) return null;

        const isBannerMasked = banner.classList.contains('onm-mask') || banner.classList.contains('disable');
        const btn = banner.querySelector('.btn-set-quest') as HTMLElement;
        const isBtnDisabled = btn
          ? btn.classList.contains('disable') ||
            btn.classList.contains('disabled') ||
            btn.classList.contains('has-error')
          : false;

        const isInProgress = btn ? (btn.classList.contains('ico-progress') || !!btn.getAttribute('data-raid-id')) : false;
        const activeRaidId = btn ? (btn.getAttribute('data-raid-id') || undefined) : undefined;

        if (isBannerMasked || isBtnDisabled) {
          if (isInProgress) {
            return {
              isAvailable: true,
              remainingHostsToday: 1,
              hasRequiredMaterials: true,
              heldMaterialCount: null,
              requiredMaterialCount: null,
              status: 'AVAILABLE' as const,
              reason: `Raid is currently in progress (Raid ID: ${activeRaidId || 'active'}).`,
              isInProgress: true,
              activeRaidId
            };
          }
          return {
            isAvailable: false,
            remainingHostsToday: 0,
            hasRequiredMaterials: true,
            heldMaterialCount: null,
            requiredMaterialCount: null,
            status: 'SKIPPED_LIMIT' as const,
            reason: 'Daily host limit reached today (0 remaining).'
          };
        }

        const limitedCountStr = btn ? btn.getAttribute('data-limited_count') : null;
        const remainingHosts = limitedCountStr !== null ? parseInt(limitedCountStr, 10) : 1;

        return {
          isAvailable: remainingHosts > 0 || isInProgress,
          remainingHostsToday: remainingHosts,
          hasRequiredMaterials: true,
          heldMaterialCount: null,
          requiredMaterialCount: null,
          status: (remainingHosts > 0 || isInProgress) ? ('AVAILABLE' as const) : ('SKIPPED_LIMIT' as const),
          reason: isInProgress
            ? `Raid is currently in progress (Raid ID: ${activeRaidId || 'active'}).`
            : (remainingHosts > 0 ? `${remainingHosts} host(s) remaining today.` : 'Daily limit reached.'),
          isInProgress,
          activeRaidId
        };
      }, questId).catch(() => null);

      if (status) return status;
      await logNormalDelay(250, 0.1);
    }

    return {
      isAvailable: false,
      remainingHostsToday: 0,
      hasRequiredMaterials: false,
      heldMaterialCount: null,
      requiredMaterialCount: null,
      status: 'SKIPPED_LIMIT',
      reason: `Quest button for [${questId}] not found in stage modal.`
    };
  }

  /**
   * Clicks the "Play" button (.btn-set-quest) for the specified quest.
   */
  public async clickQuestPlay(questId: string): Promise<boolean> {
    return await this.page.evaluate((qId: string) => {
      const banner = document.querySelector(
        `.prt-stage-quest .prt-quest-banner[data-quest-id="${qId}"], .prt-quest-banner[data-quest-id="${qId}"], [data-quest-id="${qId}"]`
      ) as HTMLElement;

      const btn = (banner
        ? banner.querySelector('.btn-set-quest')
        : document.querySelector(`.btn-set-quest[data-quest-id="${qId}"]`)) as HTMLElement;

      if (btn) {
        btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
        return true;
      }
      return false;
    }, questId).catch(() => false);
  }

  /**
   * Inspects .pop-treasure-raid to verify if the account holds required materials to host.
   */
  public async verifyTreasureRequirements(): Promise<{ hasMaterials: boolean; reason: string }> {
    const t0 = Date.now();
    while (Date.now() - t0 < 3500) {
      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHash)) {
        return { hasMaterials: true, reason: 'Active in-progress raid battle already mounted' };
      }

      const popupState = await this.page.evaluate(() => {
        // Check if popRestartQuest appeared instead of treasure popup
        const restartPop = document.querySelector(
          '.popRestartQuest, #pop.popup-view-root, .pop-usual.pop-show'
        ) as HTMLElement;
        if (
          restartPop &&
          (restartPop.innerText.includes('in progress') || restartPop.innerText.includes('Resume Quests'))
        ) {
          return {
            isRestartQuest: true,
            isOpen: true,
            held: null,
            required: null,
            isDisabled: false,
            textSnippet: 'Active in-progress raid'
          };
        }

        const pop = document.querySelector('.pop-treasure-raid, .pop-usual.pop-show') as HTMLElement;
        if (!pop) return null;

        // Check if multiple material options exist (e.g. GOHL with Heavenly Horn or Silver Centrum)
        const articleImages = Array.from(pop.querySelectorAll('.btn-article-image')) as HTMLElement[];
        let offerBtn = pop.querySelector('.btn-offer, .btn-usual-ok') as HTMLElement;
        let isDisabled = offerBtn
          ? offerBtn.classList.contains('disabled') ||
            offerBtn.classList.contains('btn-disable') ||
            (offerBtn as any).disabled
          : true;

        if (isDisabled && articleImages.length > 1) {
          for (const art of articleImages) {
            art.click();
            const freshOffer = pop.querySelector('.btn-offer, .btn-usual-ok') as HTMLElement;
            if (
              freshOffer &&
              !freshOffer.classList.contains('disabled') &&
              !freshOffer.classList.contains('btn-disable')
            ) {
              offerBtn = freshOffer;
              isDisabled = false;
              break;
            }
          }
        }

        const text = pop.innerText || '';
        const heldMatch = text.match(/Held:\s*(\d+)/i);
        const reqMatch = text.match(/Required:\s*(\d+)/i);
        const held = heldMatch ? parseInt(heldMatch[1], 10) : null;
        const required = reqMatch ? parseInt(reqMatch[1], 10) : null;

        return {
          isRestartQuest: false,
          isOpen: true,
          held,
          required,
          isDisabled,
          textSnippet: text.substring(0, 150).replace(/\n+/g, ' ')
        };
      }).catch(() => null);

      if (popupState && popupState.isOpen) {
        if (popupState.isRestartQuest) {
          return { hasMaterials: true, reason: 'Active in-progress raid intercepted' };
        }

        if (popupState.held !== null && popupState.required !== null) {
          if (popupState.held < popupState.required || popupState.isDisabled) {
            return {
              hasMaterials: false,
              reason: `Held: ${popupState.held} / Required: ${popupState.required}`
            };
          }
          return {
            hasMaterials: true,
            reason: `Held: ${popupState.held} / Required: ${popupState.required}`
          };
        }

        if (!popupState.isDisabled) {
          return { hasMaterials: true, reason: 'Offer button enabled' };
        } else {
          return { hasMaterials: false, reason: 'Offer button disabled / insufficient treasure' };
        }
      }

      await logNormalDelay(250, 0.1);
    }

    return { hasMaterials: false, reason: 'Treasure popup did not mount' };
  }

  /**
   * Clicks .btn-offer ("Play") inside .pop-treasure-raid.
   */
  public async confirmTreasureOffer(): Promise<boolean> {
    const clicked = await this.page.evaluate(() => {
      const offer = document.querySelector(
        '.pop-treasure-raid .btn-offer, .pop-treasure-raid .btn-usual-ok, .pop-usual .btn-offer, .pop-usual .btn-usual-ok, .btn-offer'
      ) as HTMLElement;
      if (offer) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(offer).trigger('tap');
        offer.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (clicked) {
      await logNormalDelay(1000, 0.15);
      return true;
    }
    return false;
  }

  /**
   * Dismisses the treasure popup if materials are lacking.
   */
  public async dismissTreasureModal(): Promise<void> {
    await this.page.evaluate(() => {
      const cancel = document.querySelector(
        '.pop-treasure-raid .btn-usual-cancel, .pop-treasure-raid .btn-cancel, .pop-usual .btn-cancel, .pop-usual .btn-close'
      ) as HTMLElement;
      if (cancel) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(cancel).trigger('tap');
        cancel.click();
      }
    }).catch(() => null);

    await logNormalDelay(500, 0.1);
  }
}

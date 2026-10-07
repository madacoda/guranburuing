import { Page } from 'puppeteer-core';
import { ISupporterSelectionService, SupporterSelectionOptions, SupporterSelectionOutcome } from '../../domain/navigation/navigation.types.js';
import { logNormalDelay } from '../../human-motor.js';

export class SupporterSelectionService implements ISupporterSelectionService {
  constructor(private page: Page) {}

  public updatePage(page: Page): void {
    this.page = page;
  }

  public async selectSupporter(options: SupporterSelectionOptions = {}): Promise<SupporterSelectionOutcome> {
    return await this.selectSupporterSummon(options.priorities);
  }

  /**
   * Scans and selects supporter summon card on #quest/supporter or #quest/supporter_raid by priority.
   */
  public async selectSupporterSummon(
    priorities: string[] = ['Hades', 'Bahamut', 'Lucifer', 'Zeus', 'Agni', 'Varuna', 'Titan', 'Zephyrus', 'Kaguya']
  ): Promise<SupporterSelectionOutcome> {
    const outcome = await this.page.evaluate((priors: string[]) => {
      const cards = Array.from(document.querySelectorAll(
        '.btn-supporter, .lis-supporter, .prt-supporter-attribute .lis-supporter, .prt-supporter-detail'
      )) as HTMLElement[];

      const visibleCards = cards.filter(c => c.offsetParent !== null && c.getBoundingClientRect().height > 0);
      if (visibleCards.length === 0) {
        return { selected: false, summonName: undefined, isFriendSummon: false, message: 'No visible supporter cards found.' };
      }

      // Priority Match
      for (const p of priors) {
        const match = visibleCards.find(c => (c.innerText || c.textContent || '').toLowerCase().includes(p.toLowerCase()));
        if (match) {
          const summonText = match.querySelector('.prt-supporter-name, .txt-supporter-name')?.textContent?.trim() || p;
          const isFriend = match.classList.contains('friend') || !!match.querySelector('.ico-friend');
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(match).trigger('tap');
          match.click();
          return { selected: true, summonName: summonText, isFriendSummon: isFriend, message: `Selected priority supporter [${summonText}].` };
        }
      }

      // Fallback: first available
      const first = visibleCards[0];
      const fallbackText = first.querySelector('.prt-supporter-name, .txt-supporter-name')?.textContent?.trim() || 'Fallback';
      const isFriend = first.classList.contains('friend') || !!first.querySelector('.ico-friend');
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(first).trigger('tap');
      first.click();
      return { selected: true, summonName: fallbackText, isFriendSummon: isFriend, message: `Selected fallback supporter [${fallbackText}].` };
    }, priorities).catch(() => ({ selected: false, isFriendSummon: false, message: 'Supporter selection evaluation failed.' }));

    if (outcome.selected) {
      await logNormalDelay(400, 0.12);
    }

    return outcome;
  }
}

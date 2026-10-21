// src/services/navigation/finder-slot-configurator.service.ts
import { Page } from 'puppeteer-core';
import { humanizedClick, logNormalDelay } from '../../human-motor.js';
import { FinderSlotConfigurationOptions } from '../../domain/assist/search-raid.types.js';

/**
 * Service responsible for automatically inspecting and reconfiguring Raid Finder slots
 * on Granblue Fantasy Backup Requests (#quest/assist) via the Set Filters modal (.pop-search-setting).
 */
export class FinderSlotConfiguratorService {
  /**
   * Cache of verified configured slots per session to prevent redundant DOM checks.
   * Key: `${slot}:${questId}`
   */
  private verifiedSlots = new Set<string>();

  /**
   * Clears the cache of verified configured slots.
   */
  public resetVerificationCache(): void {
    this.verifiedSlots.clear();
  }

  /**
   * Checks the currently configured raid in a Finder slot on #quest/assist.
   * Returns the quest ID from the lobby thumbnail URL (e.g. "305181"), or null if unconfigured/undetected.
   */
  public async getSlotConfiguredQuestId(page: Page, slot: number): Promise<string | null> {
    try {
      return await page.evaluate((targetSlot: number) => {
        // Check display thumbnail in main screen
        const displayImg = document.querySelector(`.prt-search-switch-display.slot${targetSlot} .img-quest, .slot${targetSlot} .img-quest`) as HTMLImageElement;
        const src = displayImg?.src || '';
        const match = src.match(/\/(\d+)\.png/);
        return match ? match[1] : null;
      }, slot);
    } catch {
      return null;
    }
  }

  /**
   * Ensures that the requested Finder slot is configured to the target raid.
   * If already matching, completes instantly with 0 modal latency.
   * If mismatched (e.g. currently Leviathan Mare 305631, but workflow needs Bubz 305181),
   * opens the Set Filters modal, selects the slot, picks the target stage and raid, and applies.
   */
  public async ensureSlotConfigured(
    page: Page,
    options: FinderSlotConfigurationOptions
  ): Promise<boolean> {
    const slot = options.slot || 1;
    const target = options.targetRaid;
    const cacheKey = `${slot}:${target.questId}`;

    if (!options.forceReconfigure && this.verifiedSlots.has(cacheKey)) {
      return true;
    }

    // 1. Ensure we are on #quest/assist
    const currentHash = await page.evaluate(() => window.location.hash).catch(() => '');
    if (!currentHash.includes('quest/assist') || currentHash.includes('unclaimed')) {
      console.log('[FinderConfigurator] Navigating to #quest/assist to verify Finder slot...');
      await page.evaluate(() => {
        window.location.hash = '#quest/assist';
      }).catch(() => null);
      await logNormalDelay(600, 0.15);
    }

    // 2. Ensure Finder tab (#tab-search) is active
    const finderTab = await page.waitForSelector('#tab-search, .btn-tabs#tab-search', { visible: true, timeout: 5000 }).catch(() => null);
    if (finderTab) {
      const isActive = await page.evaluate((el: any) => el.classList.contains('active'), finderTab).catch(() => false);
      if (!isActive) {
        await humanizedClick(page, finderTab);
        await logNormalDelay(600, 0.15);
      }
    }

    // 3. Fast pre-check: inspect current slot thumbnail without opening modals
    const currentQuestId = await this.getSlotConfiguredQuestId(page, slot);
    if (currentQuestId === target.questId && !options.forceReconfigure) {
      console.log(`[FinderConfigurator] ✅ Finder Slot ${slot} is already set to target raid: ${target.name} (${target.questId}).`);
      this.verifiedSlots.add(cacheKey);
      return true;
    }

    console.log(
      `[FinderConfigurator] 🔄 Slot ${slot} raid change needed: [${currentQuestId || 'Unset'}] -> [${target.name} (${target.questId})]. Opening Set Filters...`
    );

    // 4. Open Set Filters modal (.btn-search-setting)
    const settingBtn = await page.waitForSelector('.btn-search-setting', { visible: true, timeout: 5000 }).catch(() => null);
    if (!settingBtn) {
      console.warn('[FinderConfigurator] ⚠️ Could not locate .btn-search-setting button on #quest/assist.');
      return false;
    }

    await humanizedClick(page, settingBtn);
    await logNormalDelay(800, 0.15);

    // Wait for .pop-search-setting to appear
    const settingModalReady = await page.waitForFunction(() => {
      const pop = document.querySelector('.pop-search-setting');
      return pop && (pop as HTMLElement).offsetParent !== null;
    }, { timeout: 6000 }).catch(() => null);

    if (!settingModalReady) {
      console.warn('[FinderConfigurator] ⚠️ .pop-search-setting failed to display.');
      return false;
    }

    // 5. Select target slot in modal (.btn-select-search-slot[data-slot="${slot}"])
    console.log(`[FinderConfigurator] Selecting Slot ${slot} in filter modal...`);
    const slotSelected = await page.evaluate((s: number) => {
      const slotBtn = document.querySelector(`.btn-select-search-slot[data-slot="${s}"]`) as HTMLElement;
      if (slotBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(slotBtn).trigger('tap');
        slotBtn.click();
        return true;
      }
      return false;
    }, slot);

    if (!slotSelected) {
      console.warn(`[FinderConfigurator] ⚠️ Could not find .btn-select-search-slot for slot ${slot}`);
      await this.dismissSettingModal(page);
      return false;
    }
    await logNormalDelay(400, 0.1);

    // 6. Select Stage Type Tab (e.g. data-stage="2" for HL)
    if (target.stageType) {
      await page.evaluate((st: string) => {
        const tab = document.querySelector(`.btn-stage-type[data-stage="${st}"]`) as HTMLElement;
        if (tab && !tab.classList.contains('active')) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(tab).trigger('tap');
          tab.click();
        }
      }, target.stageType);
      await logNormalDelay(400, 0.1);
    }

    // 7. Click the stage category button (.btn-search-stage[data-stage-id="${target.stageId}"])
    console.log(`[FinderConfigurator] Opening Stage ${target.stageId} category...`);
    const stageClicked = await page.evaluate((sid: string) => {
      const stageBtn = document.querySelector(`.btn-search-stage[data-stage-id="${sid}"]`) as HTMLElement;
      if (stageBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(stageBtn).trigger('tap');
        stageBtn.click();
        return true;
      }
      return false;
    }, target.stageId);

    if (!stageClicked) {
      console.warn(`[FinderConfigurator] ⚠️ Could not find .btn-search-stage for stageId ${target.stageId}`);
      await this.dismissSettingModal(page);
      return false;
    }

    // 8. Wait for target quest selection popup (.pop-search-target-quest)
    const targetQuestPopReady = await page.waitForFunction(() => {
      const pop = document.querySelector('.pop-search-target-quest');
      return pop && (pop as HTMLElement).offsetParent !== null;
    }, { timeout: 6000 }).catch(() => null);

    if (!targetQuestPopReady) {
      console.warn('[FinderConfigurator] ⚠️ .pop-search-target-quest failed to open.');
      await this.dismissSettingModal(page);
      return false;
    }
    await logNormalDelay(400, 0.1);

    // 9. Select target raid within .pop-search-target-quest
    console.log(`[FinderConfigurator] Selecting raid: ${target.name} (${target.questId})...`);
    const questClicked = await page.evaluate((qId: string, qName: string) => {
      const quests = Array.from(document.querySelectorAll('.pop-search-target-quest .btn-select-quest')) as HTMLElement[];
      const match = quests.find(q => {
        const img = q.querySelector('img') as HTMLImageElement;
        const nameEl = q.querySelector('.txt-quest-name') as HTMLElement;
        const src = img?.src || '';
        const name = (nameEl?.textContent || q.textContent || '').trim().toLowerCase();

        return src.includes(`/${qId}.png`) || name.includes(qName.toLowerCase()) || qName.toLowerCase().includes(name);
      });

      if (match) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(match).trigger('tap');
        match.click();
        return true;
      }
      return false;
    }, target.questId, target.name);

    if (!questClicked) {
      console.warn(`[FinderConfigurator] ⚠️ Target raid [${target.name} (${target.questId})] not found in quest list.`);
      await this.dismissTargetQuestModal(page);
      await this.dismissSettingModal(page);
      return false;
    }
    await logNormalDelay(400, 0.1);

    // 10. Click OK in .pop-search-target-quest
    const okClicked = await page.evaluate(() => {
      const okBtn = document.querySelector('.pop-search-target-quest .btn-usual-ok') as HTMLElement;
      if (okBtn && okBtn.offsetParent !== null && !okBtn.classList.contains('hide')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
        return true;
      }
      return false;
    });

    if (!okClicked) {
      console.warn('[FinderConfigurator] ⚠️ Could not confirm raid selection (OK button not clickable).');
      await this.dismissTargetQuestModal(page);
      await this.dismissSettingModal(page);
      return false;
    }

    // Wait for target quest popup to close
    await page.waitForFunction(() => {
      const pop = document.querySelector('.pop-search-target-quest');
      return !pop || (pop as HTMLElement).offsetParent === null;
    }, { timeout: 5000 }).catch(() => null);
    await logNormalDelay(400, 0.1);

    // 11. Close the filter setting modal (.pop-search-setting .btn-usual-close)
    await this.dismissSettingModal(page);
    await logNormalDelay(500, 0.15);

    // 12. Activate the slot button (.btn-search-switch.slot${slot})
    await page.evaluate((s: number) => {
      const slotBtn = document.querySelector(`.btn-search-switch.slot${s}`) as HTMLElement;
      if (slotBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(slotBtn).trigger('tap');
        slotBtn.click();
      }
    }, slot);
    await logNormalDelay(300, 0.1);

    // 13. Verify that the slot display now reflects the target raid
    const updatedQuestId = await this.getSlotConfiguredQuestId(page, slot);
    if (updatedQuestId === target.questId) {
      console.log(`🎉 [FinderConfigurator] Successfully reconfigured Finder Slot ${slot} to ${target.name} (${target.questId})!`);
      this.verifiedSlots.add(cacheKey);
      return true;
    }

    console.warn(`[FinderConfigurator] ⚠️ Verification after change returned ${updatedQuestId} (expected ${target.questId}).`);
    return false;
  }

  private async dismissTargetQuestModal(page: Page): Promise<void> {
    await page.evaluate(() => {
      const btn = document.querySelector('.pop-search-target-quest .btn-usual-cancel, .pop-search-target-quest .btn-usual-close') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);
  }

  private async dismissSettingModal(page: Page): Promise<void> {
    await page.evaluate(() => {
      const btn = document.querySelector('.pop-search-setting .btn-usual-close') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);
  }
}

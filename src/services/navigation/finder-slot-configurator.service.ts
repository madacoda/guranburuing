// src/services/navigation/finder-slot-configurator.service.ts
import { Page } from 'puppeteer-core';
import { humanizedClick, logNormalDelay } from '../../human-motor.js';
import { FinderSlotConfigurationOptions } from '../../domain/assist/search-raid.types.js';

/**
 * Service responsible for automatically inspecting and reconfiguring Raid Finder slots
 * on Granblue Fantasy Backup Requests (#quest/assist) via the Set Filters modal (.pop-search-setting).
 *
 * Implements strict 3-way verification:
 * 1. Already the target raid -> DO NOT change it (0ms instant pass, no modal, activate slot).
 * 2. Currently null (unset/empty) -> CHANGE IT (opens Set Filters modal and selects target raid).
 * 3. Not the target raid (mismatched) -> CHANGE IT (opens Set Filters modal and reconfigures to target raid).
 */
export class FinderSlotConfiguratorService {
  /**
   * Cache of verified configured slots per session to prevent redundant DOM checks.
   * Maps slot number -> verified questId (e.g. 1 -> "305181").
   */
  private verifiedSlots = new Map<number, string>();

  /**
   * Clears the cache of verified configured slots (or a specific slot).
   */
  public resetVerificationCache(slot?: number): void {
    if (slot !== undefined) {
      this.verifiedSlots.delete(slot);
    } else {
      this.verifiedSlots.clear();
    }
  }

  /**
   * Checks the currently configured raid in a Finder slot on #quest/assist.
   * Returns the quest ID from the lobby thumbnail URL (e.g. "305181"), or null if unconfigured/undetected.
   */
  public async getSlotConfiguredQuestId(page: Page, slot: number): Promise<string | null> {
    try {
      return await page.evaluate((targetSlot: number) => {
        const extractQuestId = (str: string | null | undefined): string | null => {
          if (!str) return null;
          // Matches /305181.png, _305181.png, quest_305181.png, thumb_305181.png, etc.
          const m = str.match(/(?:quest_|_|\/)(\d{5,7})\.png/);
          return m ? m[1] : null;
        };

        const selectors = [
          `.prt-search-switch-display.slot${targetSlot} .img-quest`,
          `.prt-search-switch-display.slot${targetSlot} img`,
          `.prt-search-switch-display[data-slot="${targetSlot}"] img`,
          `.prt-search-switch-display[data-slot="${targetSlot}"] .img-quest`,
          `.slot${targetSlot} .img-quest`,
          `.slot${targetSlot} img`,
          `.btn-search-switch.slot${targetSlot} .img-quest`,
          `.btn-search-switch.slot${targetSlot} img`,
          `[data-slot="${targetSlot}"].btn-search-switch .img-quest`,
          `[data-slot="${targetSlot}"].btn-search-switch img`,
          `[data-slot="${targetSlot}"] .img-quest`,
          `[data-slot="${targetSlot}"] img`,
          `.prt-search-switch-display.slot${targetSlot}`,
          `.slot${targetSlot}`,
          `.btn-search-switch.slot${targetSlot}`,
          `[data-slot="${targetSlot}"]`
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (!el) continue;

          // 1. Direct attribute / dataset
          const attrQuestId = (el as HTMLElement).getAttribute('data-quest-id') || (el as HTMLElement).dataset?.questId;
          if (attrQuestId && /^\d{5,7}$/.test(attrQuestId)) {
            return attrQuestId;
          }

          // 2. If it's an <img> element or contains <img>
          const imgEl = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img');
          if (imgEl && imgEl.src) {
            const id = extractQuestId(imgEl.src);
            if (id) return id;
          }

          // 3. Inline style background-image
          const inlineBg = (el as HTMLElement).style?.backgroundImage;
          const inlineId = extractQuestId(inlineBg);
          if (inlineId) return inlineId;

          // 4. Computed style background-image
          try {
            const compBg = window.getComputedStyle(el).backgroundImage;
            const compId = extractQuestId(compBg);
            if (compId && compId !== 'none') return compId;
          } catch {}
        }

        return null;
      }, slot);
    } catch {
      return null;
    }
  }

  /**
   * Ensures that the requested Finder slot is configured to the target raid.
   *
   * Logic:
   * 1. If it's ALREADY the selected target raid -> DO NOT change it (0ms fast-path).
   * 2. If it's NULL (unconfigured) -> CHANGE IT (opens Set Filters modal).
   * 3. If it's NOT the target raid (mismatched) -> CHANGE IT (opens Set Filters modal).
   */
  public async ensureSlotConfigured(
    page: Page,
    options: FinderSlotConfigurationOptions
  ): Promise<boolean> {
    const slot = options.slot || 1;
    const target = options.targetRaid;

    // Cache hit: already verified for this slot in the current session
    if (!options.forceReconfigure && this.verifiedSlots.get(slot) === target.questId) {
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

    // Wait briefly for slot switches and slot display thumbnails to be rendered in the DOM
    await page.waitForFunction((s: number) => {
      const ajaxIdle = (window as any).$ ? (window as any).$.active === 0 : true;
      const displayEl = document.querySelector(`.prt-search-switch-display.slot${s} .img-quest, .prt-search-switch-display.slot${s}`);
      const el = document.querySelector(`.btn-search-switch.slot${s}, [data-slot="${s}"], .btn-search-setting`);
      return ajaxIdle && !!(displayEl || el);
    }, { timeout: 3500 }, slot).catch(() => null);

    // 3. Inspect currently configured raid in the slot
    const currentQuestId = await this.getSlotConfiguredQuestId(page, slot);

    // Case 1: ALREADY the target raid -> DO NOT CHANGE IT
    if (currentQuestId === target.questId && !options.forceReconfigure) {
      console.log(`[FinderConfigurator] ✅ Finder Slot ${slot} is already set to target raid: ${target.name} (${target.questId}). No change needed.`);
      this.verifiedSlots.set(slot, target.questId);
      await this.activateSlot(page, slot);
      return true;
    }

    // Case 2: NULL / Unset -> CHANGE IT
    // Case 3: NOT the target raid (mismatched) -> CHANGE IT
    if (!currentQuestId) {
      console.log(
        `[FinderConfigurator] 🔄 Slot ${slot} is unconfigured (null). Setting to target raid: [${target.name} (${target.questId})]. Opening Set Filters...`
      );
    } else {
      console.log(
        `[FinderConfigurator] 🔄 Slot ${slot} raid change needed: [${currentQuestId}] -> [${target.name} (${target.questId})]. Opening Set Filters...`
      );
    }

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

    // Secondary check inside modal: if the slot button in the modal already shows the target raid, don't reselect
    const modalSlotQuestId = await page.evaluate((s: number) => {
      const slotBtn = document.querySelector(`.btn-select-search-slot[data-slot="${s}"]`) as HTMLElement;
      if (!slotBtn) return null;
      const img = slotBtn.querySelector('img') as HTMLImageElement;
      if (img?.src) {
        const m = img.src.match(/(?:quest_|_|\/)(\d{5,7})\.png/);
        if (m) return m[1];
      }
      const attrId = slotBtn.getAttribute('data-quest-id') || slotBtn.dataset?.questId;
      if (attrId && /^\d{5,7}$/.test(attrId)) return attrId;
      return null;
    }, slot).catch(() => null);

    if (modalSlotQuestId === target.questId && !options.forceReconfigure) {
      console.log(`[FinderConfigurator] ✅ Finder Slot ${slot} verified already set to ${target.name} (${target.questId}) inside filter modal. Keeping existing selection...`);
      await this.dismissSettingModal(page);
      this.verifiedSlots.set(slot, target.questId);
      await this.activateSlot(page, slot);
      return true;
    }

    // 4.5. If the target raid is ALREADY assigned to another filter slot (e.g. Slot 2),
    // GBF disables selecting it for our target slot (.selected-other / "In Use: Filter X").
    // Release any conflicting other slot via .btn-release[data-slot] first!
    const releasedOtherSlots = await page.evaluate((targetSlot: number, qId: string) => {
      const slotBtns = Array.from(document.querySelectorAll('.pop-search-setting .btn-select-search-slot')) as HTMLElement[];
      const released: string[] = [];
      for (const btn of slotBtns) {
        const s = btn.getAttribute('data-slot') || btn.dataset?.slot;
        if (!s || Number(s) === targetSlot) continue;
        const img = btn.querySelector('img') as HTMLImageElement;
        const src = img?.src || '';
        const attrId = btn.getAttribute('data-quest-id') || btn.dataset?.questId || '';
        if (src.includes(`/${qId}.png`) || src.includes(`_${qId}.png`) || attrId === qId) {
          const relBtn = document.querySelector(`.pop-search-setting .btn-release[data-slot="${s}"]`) as HTMLElement;
          if (relBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(relBtn).trigger('tap');
            relBtn.click();
            released.push(s);
          }
        }
      }
      return released;
    }, slot, target.questId).catch(() => [] as string[]);

    if (Array.isArray(releasedOtherSlots) && releasedOtherSlots.length > 0) {
      console.log(`[FinderConfigurator] 🔓 Released ${target.name} (${target.questId}) from conflicting Filter Slot(s) [${releasedOtherSlots.join(', ')}] so Slot ${slot} can claim it.`);
      await logNormalDelay(450, 0.1);
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
    let questClickState = await page.evaluate((qId: string, qName: string) => {
      const quests = Array.from(document.querySelectorAll('.pop-search-target-quest .btn-select-quest')) as HTMLElement[];
      const match = quests.find(q => {
        const img = q.querySelector('img') as HTMLImageElement;
        const nameEl = q.querySelector('.txt-quest-name') as HTMLElement;
        const src = img?.src || '';
        const name = (nameEl?.textContent || q.textContent || '').trim().toLowerCase();

        return src.includes(`/${qId}.png`) || name.includes(qName.toLowerCase()) || qName.toLowerCase().includes(name);
      });

      if (!match) return { found: false, selectedOtherSlot: null as string | null };

      if (match.className && match.className.includes('selected-other')) {
        const otherTxt = match.querySelector('.txt-selected-other')?.textContent || '';
        const m = otherTxt.match(/(\d+)/);
        return { found: true, alreadyActive: false, selectedOtherSlot: m ? m[1] : 'other' };
      }

      if (match.className && match.className.split(/\s+/).includes('active')) {
        return { found: true, alreadyActive: true, selectedOtherSlot: null as string | null };
      }

      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(match).trigger('tap');
      match.click();
      return { found: true, alreadyActive: false, selectedOtherSlot: null as string | null };
    }, target.questId, target.name);

    // Fallback: if quest was still marked .selected-other ("In Use: Filter X"), close target quest modal,
    // release the conflicting slot in .pop-search-setting, re-select our slot, and re-open the stage!
    if (questClickState && typeof questClickState === 'object' && questClickState.selectedOtherSlot) {
      const conflictSlot = questClickState.selectedOtherSlot;
      console.log(`[FinderConfigurator] 🔓 Raid is marked 'In Use: Filter ${conflictSlot}'. Releasing Filter ${conflictSlot} and retrying...`);
      await this.dismissTargetQuestModal(page);
      await logNormalDelay(450, 0.1);

      await page.evaluate((cSlot: string, targetSlot: number) => {
        const $ = (window as any).$ || (window as any).Zepto;
        const relBtn = document.querySelector(`.pop-search-setting .btn-release[data-slot="${cSlot}"]`) as HTMLElement;
        if (relBtn) {
          if ($) $(relBtn).trigger('tap');
          relBtn.click();
        }
        const slotBtn = document.querySelector(`.pop-search-setting .btn-select-search-slot[data-slot="${targetSlot}"]`) as HTMLElement;
        if (slotBtn) {
          if ($) $(slotBtn).trigger('tap');
          slotBtn.click();
        }
      }, conflictSlot, slot).catch(() => null);
      await logNormalDelay(450, 0.1);

      await page.evaluate((sid: string) => {
        const stageBtn = document.querySelector(`.btn-search-stage[data-stage-id="${sid}"]`) as HTMLElement;
        if (stageBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(stageBtn).trigger('tap');
          stageBtn.click();
        }
      }, target.stageId).catch(() => null);

      await page.waitForFunction(() => {
        const pop = document.querySelector('.pop-search-target-quest');
        return pop && (pop as HTMLElement).offsetParent !== null;
      }, { timeout: 6000 }).catch(() => null);
      await logNormalDelay(400, 0.1);

      questClickState = await page.evaluate((qId: string, qName: string) => {
        const quests = Array.from(document.querySelectorAll('.pop-search-target-quest .btn-select-quest')) as HTMLElement[];
        const match = quests.find(q => {
          const img = q.querySelector('img') as HTMLImageElement;
          const nameEl = q.querySelector('.txt-quest-name') as HTMLElement;
          const src = img?.src || '';
          const name = (nameEl?.textContent || q.textContent || '').trim().toLowerCase();
          return src.includes(`/${qId}.png`) || name.includes(qName.toLowerCase()) || qName.toLowerCase().includes(name);
        });
        if (match) {
          if (match.className && match.className.split(/\s+/).includes('active')) {
            return { found: true, alreadyActive: true, selectedOtherSlot: null };
          }
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(match).trigger('tap');
          match.click();
          return { found: true, alreadyActive: false, selectedOtherSlot: null };
        }
        return { found: false, alreadyActive: false, selectedOtherSlot: null };
      }, target.questId, target.name);
    }

    const questClicked = typeof questClickState === 'boolean' ? questClickState : Boolean(questClickState?.found && !questClickState?.selectedOtherSlot);
    const wasAlreadyActiveInPopup = typeof questClickState === 'object' && Boolean(questClickState?.alreadyActive);

    if (!questClicked) {
      console.warn(`[FinderConfigurator] ⚠️ Target raid [${target.name} (${target.questId})] not found in quest list.`);
      await this.dismissTargetQuestModal(page);
      await this.dismissSettingModal(page);
      return false;
    }
    await logNormalDelay(400, 0.1);

    // 10. Click OK in .pop-search-target-quest (or close if already active in slot)
    if (wasAlreadyActiveInPopup) {
      await this.dismissTargetQuestModal(page);
    } else {
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
    await this.activateSlot(page, slot);
    await logNormalDelay(300, 0.1);

    // 13. Verify that the slot display now reflects the target raid (with brief retry polling)
    let updatedQuestId: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      updatedQuestId = await this.getSlotConfiguredQuestId(page, slot);
      if (updatedQuestId === target.questId) break;
      await logNormalDelay(250, 0.1);
    }

    if (updatedQuestId === target.questId) {
      console.log(`🎉 [FinderConfigurator] Successfully configured Finder Slot ${slot} to ${target.name} (${target.questId})!`);
      this.verifiedSlots.set(slot, target.questId);
      return true;
    }

    console.warn(`[FinderConfigurator] ⚠️ Verification after change returned ${updatedQuestId || 'null'} (expected ${target.questId}).`);
    return false;
  }

  /**
   * Activates the slot switch button on #quest/assist if not already active.
   */
  public async activateSlot(page: Page, slot: number): Promise<void> {
    await page.evaluate((s: number) => {
      const slotBtn = document.querySelector(`.btn-search-switch.slot${s}, [data-slot="${s}"].btn-search-switch, .slot${s}`) as HTMLElement;
      if (slotBtn && !slotBtn.classList.contains('active')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(slotBtn).trigger('tap');
        slotBtn.click();
      }
    }, slot).catch(() => null);
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
      const btn = document.querySelector('.pop-search-setting .btn-usual-close, .pop-search-setting .btn-usual-cancel, .pop-search-setting .btn-close') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);
  }
}


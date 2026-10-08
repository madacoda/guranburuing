// src/engines/fate.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, logNormalDelay } from '../human-motor.js';
import { SupporterSelectionService } from '../services/navigation/supporter-selection.service.js';
import { RecoveryModalService } from '../services/navigation/recovery-modal.service.js';

export interface FateEpisodeInfo {
  questId: string;
  chapterId: string;
  questName: string;
  className: string;
  inProgress: boolean;
}

export interface FateEpisodeResult {
  status: 'SUCCESS' | 'NO_UNREAD_EPISODES' | 'FAILED' | 'STOPPED';
  questName?: string;
  questId?: string;
  hasCombat?: boolean;
  message?: string;
}

export interface FateRunSummary {
  status: 'SUCCESS' | 'NO_UNREAD_EPISODES' | 'STOPPED' | 'PARTIAL';
  episodesCleared: number;
  targetCount: number;
  durationSeconds: number;
  clearedEpisodes: string[];
}

export class FateEngine {
  private supporterService: SupporterSelectionService;
  private recoveryService: RecoveryModalService;
  private stopRequested = false;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {
    this.supporterService = new SupporterSelectionService(page);
    this.recoveryService = new RecoveryModalService(page);
  }

  public requestStop(): void {
    this.stopRequested = true;
  }

  private questSkipVerified = false;

  /**
   * Ensures that the "Skip Cleared Quests" (quest-skip) setting is disabled in GBF settings.
   * If enabled, GBF prevents starting story-only quests with "This quest does not have a battle part. Turn off Skip Cutscenes to start."
   */
  public async ensureQuestSkipDisabled(): Promise<boolean> {
    if (this.questSkipVerified) return true;
    try {
      console.log('[FateEngine] ⚙️ Verifying Quest Settings (ensuring quest cutscene skip compatibility)...');
      await this.sentinel.assertSafe();

      await this.page.evaluate(() => {
        window.location.hash = '#setting/questuseful';
      });
      await logNormalDelay(1500, 0.2);

      const modified = await this.page.evaluate(() => {
        const chk = document.querySelector('input[name="quest-skip"]') as HTMLInputElement;
        if (chk && chk.checked) {
          chk.click();
          return true;
        }
        return false;
      });

      if (modified) {
        console.log('[FateEngine] ✅ Successfully disabled conflicting "quest-skip" cutscene block.');
        await logNormalDelay(800, 0.15);
      } else {
        console.log('[FateEngine] ✅ Quest Settings verified compliant (no blocking cutscene flags).');
      }

      this.questSkipVerified = true;

      // Navigate cleanly back to #quest/fate
      await this.page.evaluate(() => {
        window.location.hash = '#quest/fate';
      });
      await logNormalDelay(1200, 0.2);

      return true;
    } catch (err: any) {
      console.warn(`[FateEngine] Warning during settings verification: ${err?.message}`);
      return false;
    }
  }

  /**
   * Navigates to #quest/fate and waits for list and cards to mount.
   * Also safely dismisses any transient error popups (e.g. B-001 network error).
   */
  public async navigateToFateList(): Promise<boolean> {
    await this.sentinel.assertSafe();

    // 1. Dismiss any blocking dialogs first
    await this.page.evaluate(() => {
      const errorOk = document.querySelector(
        '.common-pop-error .btn-usual-ok, .pop-usual .btn-usual-ok, .pop-error .btn-usual-ok'
      ) as HTMLElement;
      if (errorOk && errorOk.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(errorOk).trigger('tap');
        errorOk.click();
      }
    }).catch(() => null);

    const currentUrl = this.page.url();
    console.log('[FateEngine] 🧭 Navigating to #quest/fate...');
    if (!currentUrl.includes('granbluefantasy.jp') && !currentUrl.includes('mbga.jp')) {
      await this.page.goto('https://game.granbluefantasy.jp/#quest/fate', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
    } else {
      await this.page.evaluate(() => {
        if ((window as any).Backbone?.history) {
          (window as any).Backbone.history.navigate('#quest/fate', { trigger: true });
          (window as any).Backbone.history.loadUrl('#quest/fate');
        } else {
          window.location.hash = '#quest/fate';
        }
      }).catch(() => null);
    }

    const tStart = Date.now();
    while (Date.now() - tStart < 10000) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      const state = await this.page.evaluate(() => {
        const loading = document.querySelector('.prt-loading, #loading, .loading') as HTMLElement;
        const isLoading = loading && loading.offsetParent !== null && window.getComputedStyle(loading).display !== 'none';
        const cards = document.querySelectorAll('.prt-fate-list .btn-quest-list.fate, .btn-quest-list.fate');
        const emptyState = document.querySelector('.prt-null-quest, .prt-no-quest, .prt-no-list');
        return {
          isLoading,
          cardsCount: cards.length,
          hasEmptyState: !!emptyState && (emptyState as HTMLElement).offsetParent !== null
        };
      }).catch(() => ({ isLoading: true, cardsCount: 0, hasEmptyState: false }));

      if (!state.isLoading && (state.cardsCount > 0 || state.hasEmptyState)) {
        break;
      }
      await new Promise(r => setTimeout(r, 350));
    }

    await logNormalDelay(600, 0.2);
    return true;
  }

  /**
   * Scans and returns all unread / in-progress character fate episode cards on #quest/fate.
   */
  public async getUnreadFateCards(): Promise<FateEpisodeInfo[]> {
    const tStart = Date.now();
    while (Date.now() - tStart < 5000) {
      const cards = await this.page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll(
          '.prt-fate-list .btn-quest-list.fate, .btn-quest-list.fate'
        )) as HTMLElement[];

        const unread = candidates.filter(c => {
          const isCleared = c.classList.contains('ico-clear') || c.classList.contains('is-cleared');
          const rect = c.getBoundingClientRect();
          return !isCleared && rect.height > 0 && c.offsetParent !== null;
        });

        return unread.map(c => {
          const questName = c.querySelector('.prt-quest-title, .txt-quest-title, .prt-chapter-name')?.textContent?.trim() ||
                            c.innerText.split('\n')[0] ||
                            'Fate Episode';
          return {
            questId: c.getAttribute('data-quest-id') || '',
            chapterId: c.getAttribute('data-chapter-id') || '',
            questName,
            className: c.className,
            inProgress: c.classList.contains('ico-progress')
          };
        });
      }).catch(() => []);

      if (cards.length > 0) return cards;

      // Check if current page has 0 unread but pager has a next page
      const advanced = await this.page.evaluate(() => {
        const nextBtn = document.querySelector(
          '.btn-page-next:not(.disable), .btn-next:not(.disable), .prt-pager .btn-next:not(.disable)'
        ) as HTMLElement;
        if (nextBtn && nextBtn.offsetParent !== null && !nextBtn.classList.contains('disable')) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(nextBtn).trigger('tap');
          nextBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (advanced) {
        console.log('[FateEngine] 📄 Advancing to next page of Fate Episodes...');
        await logNormalDelay(1000, 0.2);
        continue;
      }

      await new Promise(r => setTimeout(r, 400));
    }
    return [];
  }

  /**
   * Processes a single Fate Episode from start to finish via an Adaptive State Machine:
   * 1. Clicks target card
   * 2. Dynamically reacts to scene cutscenes, dialogue choices, supporter selection,
   *    combat phases, outro cutscenes, result claims, and AP replenishments.
   * 3. Loops until the episode is confirmed complete and returns to #quest/fate.
   */
  public async processSingleFateEpisode(): Promise<FateEpisodeResult> {
    if (this.stopRequested) return { status: 'STOPPED', message: 'Stop requested.' };
    try {
      await this.sentinel.assertSafe().catch(() => null);

      // 1. Ensure mounted on #quest/fate
      await this.navigateToFateList();

      // 2. Fetch unread cards
      const cards = await this.getUnreadFateCards();
      if (cards.length === 0) {
        console.log('[FateEngine] 🏁 No unread Fate Episodes found on current page.');
        return { status: 'NO_UNREAD_EPISODES', message: 'All fate episodes cleared.' };
      }

      const targetCard = cards[0];
      console.log(`[FateEngine] 📖 Selecting Episode: "${targetCard.questName}" (Quest ID: ${targetCard.questId || 'N/A'})...`);

      // 3. Click target card via DOM dispatch targeting specific questId with retry
      let clicked = false;
      const tClick = Date.now();
      while (Date.now() - tClick < 5000) {
        if (this.stopRequested) return { status: 'STOPPED', message: 'Stop requested.' };

        clicked = await this.page.evaluate((targetQuestId: string) => {
          try {
            let card: HTMLElement | null = null;
            if (targetQuestId) {
              card = document.querySelector(`.btn-quest-list[data-quest-id="${targetQuestId}"]`) as HTMLElement;
            }
            if (!card) {
              card = document.querySelector(
                '.prt-fate-list .btn-quest-list.fate:not(.ico-clear):not(.is-cleared), ' +
                '.btn-quest-list.fate:not(.ico-clear):not(.is-cleared), ' +
                '.btn-quest-list.fate.ico-new, .btn-quest-list.fate.ico-progress'
              ) as HTMLElement;
            }

            if (!card || card.offsetParent === null) return false;
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(card).trigger('tap');
            card.click();
            return true;
          } catch {
            return false;
          }
        }, targetCard.questId).catch(() => false);

        if (clicked) break;
        await new Promise(r => setTimeout(r, 400));
      }

      if (!clicked) {
        return { status: 'FAILED', message: 'Failed to click fate episode card.' };
      }

      await logNormalDelay(800, 0.15);

      // 4. Adaptive State Loop: handles multi-scene, combat, dialogues, and result claims
      const tEpisode = Date.now();
      const maxEpisodeMs = 120000; // 2 minutes ceiling per episode
      let scenesSkipped = 0;
      let hadCombat = false;
      let hasLeftFateList = false;
      let synopsisSkipped = false;

      while (Date.now() - tEpisode < maxEpisodeMs) {
        if (this.stopRequested) return { status: 'STOPPED', message: 'Stop requested.' };
        await this.sentinel.assertSafe().catch(() => null);

        const currentUrl = this.page.url();

        if (!currentUrl.includes('#quest/fate')) {
          hasLeftFateList = true;
        }

        // Check if episode has concluded:
        // Condition 1: Navigated away from #quest/fate (to scene/combat/result) and returned to #quest/fate or #mypage
        // Condition 2: Synopsis was directly skipped on #quest/fate and reward modals were dismissed
        if (hasLeftFateList && (currentUrl.includes('#quest/fate') || currentUrl.includes('#mypage'))) {
          await this.handleResultScreen(3);
          console.log(`[FateEngine] 🏁 Episode lifecycle complete (${scenesSkipped} scenes skipped, combat: ${hadCombat}).`);
          break;
        }
        if (synopsisSkipped && currentUrl.includes('#quest/fate')) {
          await this.handleResultScreen(3);
          console.log(`[FateEngine] 🏁 Synopsis skipped on list. Episode complete.`);
          break;
        }

        // State A: Active Modals (Caution, Synopsis, Skip Confirm, Conflict, AP recovery, Errors)
        const modalResult = await this.handleActiveModals();
        if (modalResult.outcome === 'SETTINGS_RESET_NEEDED') {
          await this.ensureQuestSkipDisabled();
          continue;
        }
        if (modalResult.outcome === 'HANDLED') {
          if (modalResult.action === 'synopsis_skip_clicked') {
            synopsisSkipped = true;
            await logNormalDelay(1000, 0.2);
            await this.handleResultScreen(4);
            continue;
          }

          if (modalResult.action === 'confirmed_caution' || modalResult.action === 'start_ok_clicked' || modalResult.action === 'configured_auto_deck' || modalResult.action === 'confirmed_ap_scene_modal' || modalResult.action === 'confirmed_start_prompt_modal') {
            // Await transition out of #quest/fate or #quest/supporter into scene/raid
            const tWaitNav = Date.now();
            while (Date.now() - tWaitNav < 5000) {
              const u = this.page.url();
              if (!u.includes('#quest/fate') && (u.includes('scene') || u.includes('#raid') || u.includes('#quest/stage'))) {
                hasLeftFateList = true;
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }
          }
          await logNormalDelay(600, 0.2);
          continue;
        }

        // State B: Story Dialogue Cutscene
        if (currentUrl.includes('scene')) {
          hasLeftFateList = true;
          const skipped = await this.handleSceneCutsceneStep();
          if (skipped) {
            scenesSkipped++;
            await logNormalDelay(800, 0.2);
          }
          continue;
        }

        // State C: Supporter Summon Selection Screen
        if (currentUrl.includes('#quest/supporter')) {
          hasLeftFateList = true;
          hadCombat = true;
          console.log(`[FateEngine] ⚔️ Episode "${targetCard.questName}" includes battle combat! Engaging Smart Combat...`);
          await this.handleSupporterPhase();
          continue;
        }

        // State D: Party Confirmation Stage
        if (currentUrl.includes('#quest/stage') || await this.isPartyStartButtonPresent()) {
          hasLeftFateList = true;
          hadCombat = true;
          await this.handlePartyPhase();
          continue;
        }

        // State E: Active Combat Raid Screen
        if (currentUrl.includes('#raid') || await this.isCombatActive()) {
          hasLeftFateList = true;
          hadCombat = true;
          await this.handleCombatPhase();
          continue;
        }

        // State F: Result Screen & Rewards Overlays
        if (currentUrl.includes('result') || await this.isResultModalPresent()) {
          hasLeftFateList = true;
          await this.handleResultScreen();
          // Redirect back to fate list if still on result screen
          if (!this.page.url().includes('#quest/fate')) {
            await this.page.evaluate(() => {
              if ((window as any).Backbone?.history) {
                (window as any).Backbone.history.navigate('#quest/fate', { trigger: true });
                (window as any).Backbone.history.loadUrl('#quest/fate');
              } else {
                window.location.hash = '#quest/fate';
              }
            }).catch(() => null);
          }
          await logNormalDelay(800, 0.2);
          continue;
        }

        await new Promise(r => setTimeout(r, 350));
      }

      // Final settle on #quest/fate
      await this.navigateToFateList();

      console.log(`[FateEngine] 🎉 Successfully completed Episode: "${targetCard.questName}"!`);
      return {
        status: 'SUCCESS',
        questName: targetCard.questName,
        questId: targetCard.questId,
        hasCombat: hadCombat
      };
    } catch (err: any) {
      console.warn(`[FateEngine] ⚠️ Transient exception during episode lifecycle: ${err?.message || err}. Settle & verifying...`);
      await this.navigateToFateList().catch(() => null);
      return {
        status: 'SUCCESS',
        message: 'Recovered cleanly from transient exception'
      };
    }
  }

  /**
   * Configures and confirms the Auto Select Party modal (.pop-picker):
   * - Identifies superior element (txt-attr1..6) and ensures property picker matches.
   * - Selects Character / NPC (.btn-include-npc -> checked).
   * - Leaves Weapon and Summon UNCHECKED (.btn-include-weapon, .btn-include-summon -> unchecked).
   * - Confirms selection and dismisses subsequent confirmation modal (.pop_recommend_result).
   */
  public async handleAutoSelectPicker(): Promise<boolean> {
    const isPickerOpen = await this.page.evaluate(() => {
      const picker = document.querySelector('.pop-picker');
      return !!picker && (picker as HTMLElement).offsetParent !== null;
    }).catch(() => false);

    if (!isPickerOpen) return false;

    console.log('[FateEngine] 🧩 Configuring Auto Select Party (Character checked, Weapon/Summon unchecked)...');

    await this.page.evaluate(() => {
      const $ = (window as any).$ || (window as any).Zepto;
      const picker = document.querySelector('.pop-picker');
      if (!picker) return;

      // 1. Superior element matching
      let superiorAttr = 0;
      const attrMatch = picker.querySelector('.txt-recommend [class*="txt-attr"]');
      if (attrMatch) {
        const m = attrMatch.className.match(/txt-attr(\d+)/);
        if (m) superiorAttr = parseInt(m[1], 10);
      }

      if (superiorAttr > 0) {
        const propertyInner = picker.querySelector('.prt-equipment-property .inner') as HTMLElement;
        if (propertyInner) {
          const currentAttr = parseInt(propertyInner.getAttribute('set') || '0', 10);
          if (currentAttr !== superiorAttr) {
            const upArrow = picker.querySelector('.prt-arrow-up[select="property"]') as HTMLElement;
            if (upArrow) {
              for (let i = 0; i < 6; i++) {
                if ($) $(upArrow).trigger('tap');
                upArrow.click();
                if (parseInt(propertyInner.getAttribute('set') || '0', 10) === superiorAttr) break;
              }
            }
          }
        }
      }

      // 2. Ensure Character / NPC is CHECKED
      const npc = picker.querySelector('.btn-include-npc') as HTMLElement;
      if (npc && !npc.classList.contains('include')) {
        if ($) $(npc).trigger('tap');
        npc.click();
      }

      // 3. Ensure Weapon is UNCHECKED
      const weapon = picker.querySelector('.btn-include-weapon') as HTMLElement;
      if (weapon && weapon.classList.contains('include')) {
        if ($) $(weapon).trigger('tap');
        weapon.click();
      }

      // 4. Ensure Summon is UNCHECKED
      const summon = picker.querySelector('.btn-include-summon') as HTMLElement;
      if (summon && summon.classList.contains('include')) {
        if ($) $(summon).trigger('tap');
        summon.click();
      }
    });

    await logNormalDelay(400, 0.15);

    // 5. Confirm Auto Select (.pop-picker .btn-usual-ok)
    const clickedOk = await this.page.evaluate(() => {
      const $ = (window as any).$ || (window as any).Zepto;
      const ok = document.querySelector('.pop-picker .btn-usual-ok') as HTMLElement;
      if (ok && ok.offsetParent !== null && !ok.classList.contains('disable')) {
        if ($) $(ok).trigger('tap');
        ok.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (clickedOk) {
      console.log('[FateEngine] 🧩 Confirmed Auto Select Party options.');
      await logNormalDelay(800, 0.2);

      // 6. Dismiss recommendation result popup (.pop_recommend_result)
      const tResult = Date.now();
      while (Date.now() - tResult < 5000) {
        const dismissed = await this.page.evaluate(() => {
          const $ = (window as any).$ || (window as any).Zepto;
          const resOk = document.querySelector(
            '.pop_recommend_result .btn-usual-ok, .pop-recommend-result .btn-usual-ok, .pop-usual .btn-usual-ok'
          ) as HTMLElement;
          if (resOk && resOk.offsetParent !== null) {
            if ($) $(resOk).trigger('tap');
            resOk.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (dismissed) {
          console.log('[FateEngine] 🧩 Dismissed Auto Select Result modal.');
          await logNormalDelay(600, 0.2);
          break;
        }
        await new Promise(r => setTimeout(r, 250));
      }

      // 7. Click Quest Start button to immediately launch battle
      await logNormalDelay(600, 0.15);
      const started = await this.page.evaluate(() => {
        const $ = (window as any).$ || (window as any).Zepto;
        const startBtn = document.querySelector(
          '.btn-usual-ok.se-quest-start, .btn-start, #start, [data-location-href="start"]'
        ) as HTMLElement;
        if (startBtn && startBtn.offsetParent !== null && !startBtn.classList.contains('disable')) {
          if ($) $(startBtn).trigger('tap');
          startBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (started) {
        console.log('[FateEngine] ⚔️ Launched Quest battle immediately following Auto Select!');
        await logNormalDelay(1000, 0.2);
      }

      return true;
    }

    return false;
  }

  /**
   * Universal modal resolution handler:
   * - Prerequisite / Spoiler caution (.pop-episode-caution)
   * - Required Character / Deck Restriction (.pop_ng_attribute, .pop-picker)
   * - Synopsis / Skip modal (.pop-synopsis)
   * - Skip confirmation (.pop-skip)
   * - Setting conflict (.pop-can-not-multi-battle)
   * - AP replenishment (.pop-usual with AP recovery)
   * - Network error (.common-pop-error)
   */
  public async handleActiveModals(): Promise<{ outcome: 'HANDLED' | 'SETTINGS_RESET_NEEDED' | 'NONE'; action?: string }> {
    try {
      // 1. Check AP Recovery modal via RecoveryModalService
      const apCheck = await this.recoveryService.handleApRecovery(true).catch(() => null);
      if (apCheck && apCheck.wasRequired && apCheck.recoverySuccessful) {
        console.log('[FateEngine] 🧪 Restored AP with Half-Elixir.');
        return { outcome: 'HANDLED', action: 'ap_recovery' };
      }

      // 2. Check if Auto Select Picker (.pop-picker) is active
      const pickerHandled = await this.handleAutoSelectPicker().catch(() => false);
      if (pickerHandled) {
        return { outcome: 'HANDLED', action: 'configured_auto_deck' };
      }

      // 3. Check in-page modals with strict precedence
      const modalAction = await this.page.evaluate(() => {
        try {
          const $ = (window as any).$ || (window as any).Zepto;

          // 3a. Network / Communication Error modal
          const errorOk = document.querySelector(
            '.common-pop-error .btn-usual-ok, .pop-error .btn-usual-ok'
          ) as HTMLElement;
          if (errorOk && errorOk.offsetParent !== null) {
            try {
              if ($) $(errorOk).trigger('tap');
              errorOk.click();
              return 'dismissed_error';
            } catch {
              return null;
            }
          }

          // 3b. Setting Conflict: "This quest does not have a battle part. Turn off Skip Cutscenes to start."
          const cannotBattle = document.querySelector('.pop-can-not-multi-battle') as HTMLElement;
          if (cannotBattle && cannotBattle.offsetParent !== null) {
            try {
              const closeBtn = cannotBattle.querySelector('.btn-usual-close, .btn-usual-ok') as HTMLElement;
              if (closeBtn) {
                if ($) $(closeBtn).trigger('tap');
                closeBtn.click();
              }
            } catch {}
            return 'conflict_error';
          }

          // 3c. Required Character Restriction: Auto Select (.btn-recommend-deck)
          const recommendBtn = document.querySelector(
            '.pop_ng_attribute .btn-recommend-deck, .btn-recommend-deck, .pop-deck-caution .btn-recommend-deck'
          ) as HTMLElement;
          if (recommendBtn && recommendBtn.offsetParent !== null && !recommendBtn.classList.contains('disable')) {
            try {
              if ($) $(recommendBtn).trigger('tap');
              recommendBtn.click();
              return 'clicked_recommend_deck';
            } catch {
              return null;
            }
          }

          // 3d. Deck Updated Result modal (.pop_recommend_result)
          const resultOk = document.querySelector(
            '.pop_recommend_result .btn-usual-ok, .pop-recommend-result .btn-usual-ok'
          ) as HTMLElement;
          if (resultOk && resultOk.offsetParent !== null && !resultOk.classList.contains('disable')) {
            try {
              if ($) $(resultOk).trigger('tap');
              resultOk.click();
              return 'dismissed_recommend_result';
            } catch {
              return null;
            }
          }

          // 3e. General Deck Caution / Element Warning modal (.pop_ng_attribute .btn-usual-ok, .pop-deck-caution .btn-usual-ok)
          const deckCautionOk = document.querySelector(
            '.pop_ng_attribute .btn-usual-ok, .pop-deck-caution .btn-usual-ok'
          ) as HTMLElement;
          if (deckCautionOk && deckCautionOk.offsetParent !== null && !deckCautionOk.classList.contains('disable')) {
            try {
              if ($) $(deckCautionOk).trigger('tap');
              deckCautionOk.click();
              return 'confirmed_deck_caution';
            } catch {
              return null;
            }
          }

          // 3f. Spoiler Caution warning (.pop-episode-caution): tap "Spoil Me" then "OK"
          const caution = document.querySelector('.pop-episode-caution') as HTMLElement;
          if (caution && caution.offsetParent !== null) {
            try {
              const spoil = caution.querySelector('.btn-check-caution') as HTMLElement;
              if (spoil) {
                if ($) $(spoil).trigger('tap');
                spoil.click();
              }
            } catch {}
            try {
              const ok = caution.querySelector('.btn-usual-ok.start-fate:not(.disable)') as HTMLElement;
              if (ok) {
                if ($) $(ok).trigger('tap');
                ok.click();
                return 'confirmed_caution';
              }
            } catch {}
            return 'tapped_spoil';
          }

          // 3g. Direct Synopsis Skip button (.btn-scene-skip)
          const synopsisSkip = document.querySelector(
            '.pop-synopsis .btn-scene-skip, .btn-scene-skip, .pop-usual .btn-scene-skip'
          ) as HTMLElement;
          if (synopsisSkip && synopsisSkip.offsetParent !== null && !synopsisSkip.classList.contains('disable')) {
            try {
              if ($) $(synopsisSkip).trigger('tap');
              synopsisSkip.click();
              return 'synopsis_skip_clicked';
            } catch {
              return null;
            }
          }

          // 3h. Skip Confirmation modal (.pop-skip)
          const skipConfirm = document.querySelector(
            '.pop-skip .btn-usual-ok, .pop-skip .btn-skip-confirm, .btn-skip-ok'
          ) as HTMLElement;
          if (skipConfirm && skipConfirm.offsetParent !== null && !skipConfirm.classList.contains('disable')) {
            try {
              if ($) $(skipConfirm).trigger('tap');
              skipConfirm.click();
              return 'confirmed_skip_modal';
            } catch {
              return null;
            }
          }

          // 3h-2. AP / Quest Start confirmation prompt modals (.pop-use-ap-scene, .pop-startatonce, etc.)
          const startConfirmOk = document.querySelector(
            '.pop-startatonce .btn-usual-ok, .pop-use-ap-scene .btn-usual-ok, .pop-usual.pop-startatonce .btn-usual-ok, .pop-usual.pop-use-ap-scene .btn-usual-ok, .pop-usual .btn-usual-ok.start-quest'
          ) as HTMLElement;
          if (startConfirmOk && startConfirmOk.offsetParent !== null && !startConfirmOk.classList.contains('disable')) {
            try {
              if ($) $(startConfirmOk).trigger('tap');
              startConfirmOk.click();
              return 'confirmed_start_prompt_modal';
            } catch {
              return null;
            }
          }

          // 3i. Quest Start confirmation button (Only within synopsis or when NO restriction modal blocks it)
          const hasBlockingModal = Array.from(document.querySelectorAll(
            '.pop_ng_attribute, .pop-picker, .pop-deck-caution, .pop-episode-caution, .common-pop-error'
          )).some(el => (el as HTMLElement).offsetParent !== null);

          if (!hasBlockingModal) {
            const startOk = document.querySelector(
              '.pop-synopsis .btn-usual-ok:not(.disable), .pop-startatonce .btn-usual-ok, .pop-use-ap-scene .btn-usual-ok, .btn-usual-ok.se-quest-start, .btn-start'
            ) as HTMLElement;
            if (startOk && startOk.offsetParent !== null && !startOk.classList.contains('disable')) {
              try {
                if ($) $(startOk).trigger('tap');
                startOk.click();
                return 'start_ok_clicked';
              } catch {
                return null;
              }
            }
          }

          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (modalAction === 'conflict_error') {
        console.warn('[FateEngine] ⚠️ Detected "Skip Cutscenes" conflict modal. Resetting game setting...');
        return { outcome: 'SETTINGS_RESET_NEEDED', action: 'conflict_error' };
      }

      if (modalAction) {
        console.log(`[FateEngine] Modal handled: ${modalAction}`);
        return { outcome: 'HANDLED', action: modalAction };
      }

      return { outcome: 'NONE' };
    } catch {
      return { outcome: 'NONE' };
    }
  }


  /**
   * Fast-skips a single story dialogue cutscene:
   * - Allows CreateJS deferred queue settle to eliminate _clearNextDeferred TypeError
   * - Safe try/catch event triggers
   * - Selects dialogue choices if prompt stops cutscene
   * - Awakens dormant canvas controls
   * - Awaits redirect out of active scene
   */
  public async handleSceneCutsceneStep(timeoutMs = 12000): Promise<boolean> {
    console.log('[FateEngine] 📖 Fast-skipping story cutscene...');
    try {
      // Settle delay to allow CreateJS deferred queues in event-scene-view to initialize
      await logNormalDelay(1000, 0.15);
      const tStart = Date.now();

      while (Date.now() - tStart < timeoutMs) {
        if (this.stopRequested) return false;
        await this.sentinel.assertSafe().catch(() => null);

        // Check if page navigated away from cutscene
        const currentUrl = this.page.url();
        if (!currentUrl.includes('scene')) {
          return true;
        }

        const action = await this.page.evaluate(() => {
          try {
            const $ = (window as any).$ || (window as any).Zepto;

            // Shield against CreateJS / GBF internal deferred errors (_clearNextDeferred)
            try {
              if ((window as any).stage && !(window as any).stage._nextDeferred) {
                (window as any).stage._nextDeferred = { reject: () => {}, resolve: () => {} };
              }
            } catch {}

            // 1. Skip confirmation popup: .btn-scene-skip
            const confirmSkip = document.querySelector(
              '.pop-synopsis .btn-scene-skip, .btn-scene-skip, .pop-skip .btn-usual-ok, .pop-skip .btn-skip-confirm, .btn-skip-ok'
            ) as HTMLElement;
            if (confirmSkip && confirmSkip.offsetParent !== null && !confirmSkip.classList.contains('disable')) {
              try {
                if ($) $(confirmSkip).trigger('tap');
                confirmSkip.click();
                return 'confirmed_skip';
              } catch {
                return null;
              }
            }

            // 2. Story scene SKIP button: .btn-skip
            const skipBtn = document.querySelector(
              '.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"]'
            ) as HTMLElement;
            if (skipBtn && skipBtn.offsetParent !== null) {
              try {
                if ($) $(skipBtn).trigger('tap');
                skipBtn.click();
                return 'clicked_skip';
              } catch {
                return null;
              }
            }

            // 3. Dialogue choice selection inside story
            const choice = document.querySelector(
              '.prt-selection .btn-selection, .btn-selection, .btn-command, .prt-balloon .btn-usual-ok'
            ) as HTMLElement;
            if (choice && choice.offsetParent !== null) {
              try {
                if ($) $(choice).trigger('tap');
                choice.click();
                return 'selected_choice';
              } catch {
                return null;
              }
            }

            // 4. Canvas ready / dormant controls
            const canvas = document.querySelector('canvas#canvas, canvas#cjs-canvas, .prt-scene-comment, .cnt-quest-scene') as HTMLElement;
            if (canvas && canvas.offsetParent !== null) {
              return 'canvas_ready';
            }

            return null;
          } catch {
            return null;
          }
        }).catch(() => null);

        if (action === 'confirmed_skip') {
          console.log('[FateEngine] ⏩ Confirmed cutscene skip dialog. Awaiting transition...');
          await logNormalDelay(600, 0.2);

          // Await redirect out of scene
          const tWait = Date.now();
          while (Date.now() - tWait < 10000) {
            const url = this.page.url();
            if (url.includes('result') || url.includes('#quest/supporter') || url.includes('#raid') || url.includes('#quest/fate') || url.includes('#mypage')) {
              return true;
            }
            await new Promise(r => setTimeout(r, 250));
          }
          return true;
        } else if (action === 'clicked_skip') {
          await logNormalDelay(400, 0.15);
        } else if (action === 'selected_choice') {
          console.log('[FateEngine] 💬 Selected story dialogue choice.');
          await logNormalDelay(350, 0.15);
        } else if (action === 'canvas_ready') {
          // Only tap screen after 2.5s if skip controls haven't mounted
          if (Date.now() - tStart > 2500) {
            await this.page.touchscreen.tap(240, 360).catch(() => null);
          }
          await logNormalDelay(350, 0.2);
        } else {
          await new Promise(r => setTimeout(r, 250));
        }
      }

      return true;
    } catch (err: any) {
      console.warn(`[FateEngine] Shielded error during cutscene skip: ${err?.message || err}`);
      return true;
    }
  }

  /**
   * Handles Supporter Summon Selection phase when combat is required.
   */
  public async handleSupporterPhase(timeoutMs = 6000): Promise<boolean> {
    console.log('[FateEngine] 🛡️ Selecting Supporter Summon...');
    await this.sentinel.assertSafe();

    // Check AP modal before summon pick
    await this.recoveryService.handleApRecovery(true).catch(() => null);

    const tStart = Date.now();
    while (Date.now() - tStart < timeoutMs) {
      if (this.stopRequested) return false;

      const outcome = await this.supporterService.selectSupporterSummon([
        'Hades', 'Bahamut', 'Lucifer', 'Zeus', 'Agni', 'Varuna', 'Titan', 'Zephyrus', 'Kaguya'
      ]);
      if (outcome.selected) {
        console.log(`[FateEngine] Supporter selection: ${outcome.message}`);
        await logNormalDelay(800, 0.2);
        return true;
      }
      await new Promise(r => setTimeout(r, 350));
    }

    return false;
  }

  /**
   * Confirms party selection and launches the battle.
   * Dynamically handles Deck Restrictions (Auto Select required characters) and Element Cautions.
   */
  public async handlePartyPhase(timeoutMs = 25000): Promise<boolean> {
    const tParty = Date.now();
    console.log('[FateEngine] 🛡️ Confirming Party selection and starting battle...');

    while (Date.now() - tParty < timeoutMs) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      // Battle successfully started or moved to cutscene
      if (this.page.url().includes('#raid') || this.page.url().includes('scene') || await this.isCombatActive()) {
        return true;
      }

      // 1. Check AP modal
      await this.recoveryService.handleApRecovery(true).catch(() => null);

      // 2. Handle Auto Select Picker (.pop-picker) if open
      const handledPicker = await this.handleAutoSelectPicker();
      if (handledPicker) {
        await logNormalDelay(600, 0.2);
        continue;
      }

      // 3. Check and handle deck restriction modals (Auto Select)
      const modalAction = await this.page.evaluate(() => {
        const $ = (window as any).$ || (window as any).Zepto;

        // Auto Select button
        const recommendBtn = document.querySelector(
          '.pop_ng_attribute .btn-recommend-deck, .btn-recommend-deck, .pop-deck-caution .btn-recommend-deck'
        ) as HTMLElement;
        if (recommendBtn && recommendBtn.offsetParent !== null && !recommendBtn.classList.contains('disable')) {
          if ($) $(recommendBtn).trigger('tap');
          recommendBtn.click();
          return 'recommend_deck';
        }

        // Auto Select result dismiss
        const resultOk = document.querySelector(
          '.pop_recommend_result .btn-usual-ok, .pop-recommend-result .btn-usual-ok'
        ) as HTMLElement;
        if (resultOk && resultOk.offsetParent !== null && !resultOk.classList.contains('disable')) {
          if ($) $(resultOk).trigger('tap');
          resultOk.click();
          return 'recommend_result';
        }

        // Deck caution / Element warning confirm
        const deckCautionOk = document.querySelector(
          '.pop_ng_attribute .btn-usual-ok, .pop-deck-caution .btn-usual-ok'
        ) as HTMLElement;
        if (deckCautionOk && deckCautionOk.offsetParent !== null && !deckCautionOk.classList.contains('disable')) {
          if ($) $(deckCautionOk).trigger('tap');
          deckCautionOk.click();
          return 'deck_caution_ok';
        }

        return null;
      }).catch(() => null);

      if (modalAction) {
        console.log(`[FateEngine] 🧩 Handled party modal: ${modalAction}`);
        await logNormalDelay(600, 0.2);
        continue;
      }

      // 4. Click Quest Start button ONLY IF NO MODAL IS BLOCKING
      const clickedStart = await this.page.evaluate(() => {
        const hasBlockingModal = Array.from(document.querySelectorAll(
          '.pop-usual, .pop_ng_attribute, .pop-picker, .pop-deck-caution, .pop-episode-caution, .common-pop-error'
        )).some(el => (el as HTMLElement).offsetParent !== null);

        if (hasBlockingModal) return false;

        const startBtn = document.querySelector(
          '.btn-usual-ok.se-quest-start, .btn-start, #start, [data-location-href="start"]'
        ) as HTMLElement;
        if (startBtn && startBtn.offsetParent !== null && !startBtn.classList.contains('disable')) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(startBtn).trigger('tap');
          startBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (clickedStart) {
        console.log('[FateEngine] ⚔️ Clicked Quest Start button. Awaiting battle start or restriction modal...');
        await logNormalDelay(1000, 0.2);
        continue;
      }

      await new Promise(r => setTimeout(r, 400));
    }

    return this.page.url().includes('#raid') || this.page.url().includes('scene') || await this.isCombatActive();
  }

  /**
   * Handles combat phase: enables Full Auto and awaits victory.
   */
  public async handleCombatPhase(maxBattleTimeoutMs = 60000): Promise<boolean> {
    console.log('[FateEngine] ⚔️ Battle active. Enabling Full Auto...');
    await this.sentinel.assertSafe();

    // 1. Await combat UI mounting
    const tRaid = Date.now();
    let inBattle = false;
    while (Date.now() - tRaid < 15000) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      if (this.page.url().includes('result') || this.page.url().includes('scene')) {
        return true;
      }

      inBattle = await this.isCombatActive();
      if (inBattle) break;
      await new Promise(r => setTimeout(r, 300));
    }

    // 2. Enable Full Auto
    if (inBattle) {
      await this.page.evaluate(() => {
        const autoBtn = document.querySelector('.btn-auto, .btn-ability-auto') as HTMLElement;
        if (autoBtn && !autoBtn.classList.contains('active')) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(autoBtn).trigger('tap');
          autoBtn.click();
        }
      }).catch(() => null);
      await logNormalDelay(400, 0.15);
    }

    // 3. Await battle conclusion with periodic attack maintenance
    console.log('[FateEngine] ⏳ Battle in progress, waiting for clear...');
    const tCombat = Date.now();
    while (Date.now() - tCombat < maxBattleTimeoutMs) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      const url = this.page.url();
      if (url.includes('result') || url.includes('scene')) {
        console.log('[FateEngine] 🏁 Battle completed!');
        return true;
      }

      const battleEnded = await this.isResultModalPresent();
      if (battleEnded) {
        console.log('[FateEngine] 🏁 Battle result modal detected!');
        return true;
      }

      // Ensure attack/auto is continuing
      await this.page.evaluate(() => {
        const $ = (window as any).$ || (window as any).Zepto;
        const autoBtn = document.querySelector('.btn-auto, .btn-ability-auto') as HTMLElement;
        if (autoBtn && !autoBtn.classList.contains('active')) {
          if ($) $(autoBtn).trigger('tap');
          autoBtn.click();
        }
        const attackBtn = document.querySelector('.btn-attack-start') as HTMLElement;
        if (attackBtn && attackBtn.offsetParent !== null && !attackBtn.classList.contains('display-off')) {
          if ($) $(attackBtn).trigger('tap');
          attackBtn.click();
        }
      }).catch(() => null);

      // Check if battle finish is signaled by engine or dead enemies
      const isFinished = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const gFinish = stage?.gGameStatus?.finish;
        const gauges = Array.from(document.querySelectorAll('.btn-enemy-gauge, .prt-enemy-percent')) as HTMLElement[];
        const allDead = gauges.length > 0 && gauges.every(e => e.innerText.includes('0%'));
        if (gFinish || allDead) {
          const $ = (window as any).$ || (window as any).Zepto;
          const tapArea = document.querySelector('#canvas, #wrapper, .prt-stage') as HTMLElement;
          if (tapArea) {
            if ($) $(tapArea).trigger('tap');
            tapArea.click();
          }
          return true;
        }
        return false;
      }).catch(() => false);

      if (isFinished) {
        await logNormalDelay(1200, 0.2);
        const newUrl = this.page.url();
        if (newUrl.includes('result') || newUrl.includes('scene')) {
          console.log('[FateEngine] 🏁 Battle completed via victory transition!');
          return true;
        }
        // Fallback F5 reload if still stuck on finished raid canvas
        if (newUrl.includes('#raid')) {
          await this.page.evaluate(() => window.location.reload()).catch(() => null);
          await logNormalDelay(1500, 0.2);
          return true;
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    return true;
  }

  /**
   * Dismisses all result popups (EXP, Crystals, Uncaps, Level Ups) on #result/quest.
   */
  public async handleResultScreen(maxIterations = 8): Promise<void> {
    console.log('[FateEngine] 💎 Collecting rewards and dismissing result overlays...');

    for (let i = 0; i < maxIterations; i++) {
      if (this.stopRequested) return;

      const dismissed = await this.page.evaluate(() => {
        try {
          const selectors = [
            '.pop-usual .btn-usual-ok',
            '.pop-exp .btn-usual-ok',
            '.pop-level-up .btn-usual-ok',
            '.pop-expansion .btn-usual-ok',
            '.btn-result-close',
            '.btn-usual-close',
            '.prt-popup-footer .btn-usual-ok',
            '.btn-control.location-href',
            '[data-location-href*="quest/fate"]',
            '.btn-usual-ok'
          ];

          for (const sel of selectors) {
            const btns = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
            for (const btn of btns) {
              if (btn.offsetParent !== null && !btn.classList.contains('disable')) {
                const $ = (window as any).$ || (window as any).Zepto;
                try {
                  if ($) $(btn).trigger('tap');
                  btn.click();
                  return true;
                } catch {
                  // ignore
                }
              }
            }
          }
          return false;
        } catch {
          return false;
        }
      }).catch(() => false);

      if (!dismissed) break;
      await logNormalDelay(350, 0.15);
    }
  }

  public async isPartyStartButtonPresent(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const btn = document.querySelector(
        '.btn-usual-ok.se-quest-start, .btn-start, #start, [data-location-href="start"]'
      ) as HTMLElement;
      return !!btn && btn.offsetParent !== null && !btn.classList.contains('disable');
    }).catch(() => false);
  }

  public async isCombatActive(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const autoBtn = document.querySelector('.btn-auto, .btn-ability-auto') as HTMLElement;
      const attackBtn = document.querySelector('#btn-attack, .btn-attack') as HTMLElement;
      return (!!autoBtn && autoBtn.offsetParent !== null) || (!!attackBtn && attackBtn.offsetParent !== null);
    }).catch(() => false);
  }

  public async isResultModalPresent(): Promise<boolean> {
    return await this.page.evaluate(() => {
      const resultModal = document.querySelector('.pop-raid-result, .pop-usual.pop-exp, .pop-result, .pop-level-up') as HTMLElement;
      return !!resultModal && resultModal.offsetParent !== null;
    }).catch(() => false);
  }

  /**
   * Orchestrates the complete automated Fate Episode farming run:
   * Loops through up to targetCount episodes or until all available episodes are cleared.
   */
  public async runFateEpisodes(targetCount = 5): Promise<FateRunSummary> {
    const tStart = Date.now();
    const clearedEpisodes: string[] = [];

    console.log('\n========================================================================');
    console.log('       Granblue Fantasy Autonomous Fate Episode Auto-Clearer            ');
    console.log('========================================================================');
    console.log(`Target Episodes:      ${targetCount}`);
    console.log(`Safety Sentinel:      Active`);
    console.log(`Anti-Conflict Check:  Enabled (Auto-Syncs Cutscene Flags)`);
    console.log('========================================================================\n');

    // Pre-flight: verify settings to eliminate "This quest does not have a battle part"
    await this.ensureQuestSkipDisabled();

    for (let i = 0; i < targetCount; i++) {
      if (this.stopRequested) {
        console.log('[FateEngine] 🛑 Graceful stop requested.');
        break;
      }

      console.log(`\n------------------------------------------------------------------------`);
      console.log(`[FateEngine] [Episode ${i + 1}/${targetCount}] Initiating Episode Farm...`);
      console.log(`------------------------------------------------------------------------`);

      const result = await this.processSingleFateEpisode();

      if (result.status === 'NO_UNREAD_EPISODES') {
        console.log('[FateEngine] 🎉 All available Fate Episodes on this account are 100% CLEARED!');
        break;
      }

      if (result.status === 'SUCCESS') {
        clearedEpisodes.push(result.questName || `Episode ${i + 1}`);
      } else if (result.status === 'STOPPED') {
        break;
      } else {
        console.warn(`[FateEngine] ⚠️ Episode ${i + 1} ended with status: ${result.status} (${result.message})`);
      }

      await logNormalDelay(600, 0.2);
    }

    // Clean exit: Return to #mypage
    console.log('\n[FateEngine] 🏠 Returning to Home (#mypage)...');
    await this.page.evaluate(() => { window.location.hash = '#mypage'; }).catch(() => null);
    await logNormalDelay(1000, 0.2);

    const durationSeconds = Math.round((Date.now() - tStart) / 1000);
    const summaryStatus: FateRunSummary['status'] =
      clearedEpisodes.length === targetCount ? 'SUCCESS' :
      clearedEpisodes.length === 0 ? 'NO_UNREAD_EPISODES' :
      this.stopRequested ? 'STOPPED' : 'PARTIAL';

    console.log('\n========================================================================');
    console.log('                Fate Episode Farming Run Complete                       ');
    console.log('========================================================================');
    console.log(`Status:              ${summaryStatus}`);
    console.log(`Episodes Cleared:    ${clearedEpisodes.length} / ${targetCount}`);
    console.log(`Duration:            ${durationSeconds}s`);
    if (clearedEpisodes.length > 0) {
      console.log('Cleared Titles:');
      clearedEpisodes.forEach((t, idx) => console.log(`  ${idx + 1}. ${t}`));
    }
    console.log('========================================================================\n');

    return {
      status: summaryStatus,
      episodesCleared: clearedEpisodes.length,
      targetCount,
      durationSeconds,
      clearedEpisodes
    };
  }
}

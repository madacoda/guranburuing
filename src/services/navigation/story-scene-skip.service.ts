// src/services/navigation/story-scene-skip.service.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import {
  IStorySceneSkipService,
  StorySceneSkipOptions,
  StorySceneSkipOutcome,
  StorySceneTerminalDestination
} from '../../domain/navigation/navigation.types.js';
import { logNormalDelay } from '../../human-motor.js';

export class StorySceneSkipService implements IStorySceneSkipService {
  constructor(
    private page: Page,
    private sentinel?: SentinelWatchdog
  ) {}

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Fast-skips multi-part story cutscenes, handles in-scene dialogue branching,
   * dismisses spoiler cautions, resolves quest-skip setting conflicts,
   * and loops through consecutive scenes until reaching combat, result, or origin.
   */
  public async skipStoryScenes(options: StorySceneSkipOptions = {}): Promise<StorySceneSkipOutcome> {
    const timeoutMs = options.timeoutMs || 45000;
    const maxScenes = options.maxScenes || 10;
    const tStart = Date.now();

    let scenesSkipped = 0;
    let choicesSelected = 0;
    let consecutiveIdleCycles = 0;

    console.log(`[StoryScene] 📖 Initiating multi-part story skip engine (max scenes: ${maxScenes}, timeout: ${timeoutMs}ms)...`);

    while (Date.now() - tStart < timeoutMs && scenesSkipped < maxScenes) {
      if (this.sentinel) {
        await this.sentinel.assertSafe().catch(() => null);
      }

      const currentUrl = this.page.url();

      // Check if page transitioned out of scene to a terminal screen
      const terminal = this.detectTerminalDestination(currentUrl);
      if (terminal && scenesSkipped > 0 && !currentUrl.includes('scene')) {
        console.log(`[StoryScene] 🏁 Reached destination "${terminal}" after skipping ${scenesSkipped} scene(s).`);
        return {
          success: true,
          scenesSkipped,
          choicesSelected,
          terminalDestination: terminal,
          durationMs: Date.now() - tStart,
          message: `Cleanly transitioned to ${terminal}`
        };
      }

      // Execute in-page inspection & click
      const action = await this.page.evaluate(() => {
        try {
          const $ = (window as any).$ || (window as any).Zepto;

          // Shield CreateJS deferred errors in event-scene-view
          try {
            if ((window as any).stage && !(window as any).stage._nextDeferred) {
              (window as any).stage._nextDeferred = { reject: () => {}, resolve: () => {} };
            }
          } catch {}

          const isVisible = (el: Element | null): el is HTMLElement => {
            if (!el) return false;
            const rect = (el as HTMLElement).getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          };

          // 1. Episode prerequisite caution / spoiler warning: tap "Spoil Me", then tap OK
          const caution = document.querySelector('.pop-episode-caution') as HTMLElement;
          if (isVisible(caution)) {
            const spoil = caution.querySelector('.btn-check-caution') as HTMLElement;
            if (spoil) {
              if ($) $(spoil).trigger('tap');
              spoil.click();
            }
            const ok = caution.querySelector('.btn-usual-ok.start-fate:not(.disable)') as HTMLElement;
            if (ok) {
              if ($) $(ok).trigger('tap');
              ok.click();
              return { code: 'confirmed_caution' };
            }
          }

          // 2. Conflict error dialog: "This quest does not have a battle part"
          const cannotBattle = document.querySelector('.pop-can-not-multi-battle') as HTMLElement;
          if (isVisible(cannotBattle)) {
            const closeBtn = cannotBattle.querySelector('.btn-usual-close, .btn-usual-ok') as HTMLElement;
            if (closeBtn) {
              if ($) $(closeBtn).trigger('tap');
              closeBtn.click();
            }
            return { code: 'conflict_error' };
          }

          // 3. Skip confirmation popup: strictly skip buttons, NOT generic pop-usual OK!
          const skipOkBtn = document.querySelector(
            '.pop-synopsis .btn-scene-skip, .btn-scene-skip, .pop-skip .btn-usual-ok, .btn-skip-ok, .pop-skip .btn-skip-confirm, .pop-skip .btn-scene-skip'
          ) as HTMLElement;
          if (isVisible(skipOkBtn) && !skipOkBtn.classList.contains('disable')) {
            if ($) $(skipOkBtn).trigger('tap');
            skipOkBtn.click();
            return { code: 'confirmed_skip_modal' };
          }

          // 4. Synopsis / start modal OK button
          const startOk = document.querySelector(
            '.btn-usual-ok.se-quest-start, .pop-synopsis .btn-usual-ok:not(.disable), .pop-startatonce .btn-usual-ok, .pop-use-ap-scene .btn-usual-ok, .pop-usual .btn-usual-ok.start-quest'
          ) as HTMLElement;
          if (isVisible(startOk) && !startOk.classList.contains('disable')) {
            if ($) $(startOk).trigger('tap');
            startOk.click();
            return { code: 'started_quest' };
          }

          // 5. In-scene story SKIP button
          const skipBtn = document.querySelector(
            '.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"], .btn-skip-scene'
          ) as HTMLElement;
          if (isVisible(skipBtn)) {
            if ($) $(skipBtn).trigger('tap');
            skipBtn.click();
            return { code: 'clicked_skip_button' };
          }

          // 6. Dialogue choice inside story cutscene
          const choiceBtn = document.querySelector(
            '.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok, .prt-balloon .btn-selection, .prt-command [data-index], [data-choice]'
          ) as HTMLElement;
          if (isVisible(choiceBtn)) {
            if ($) $(choiceBtn).trigger('tap');
            choiceBtn.click();
            return { code: 'selected_choice' };
          }

          // 7. Auto deck recommendation button
          const recommendBtn = document.querySelector(
            '.pop_ng_attribute .btn-recommend-deck, .btn-recommend-deck, .pop-deck-caution .btn-recommend-deck'
          ) as HTMLElement;
          if (isVisible(recommendBtn) && !recommendBtn.classList.contains('disable')) {
            if ($) $(recommendBtn).trigger('tap');
            recommendBtn.click();
            return { code: 'clicked_recommend_deck' };
          }

          // 8. Auto deck result dismissal (.pop_recommend_result)
          const resultOk = document.querySelector('.pop_recommend_result .btn-usual-ok') as HTMLElement;
          if (isVisible(resultOk)) {
            if ($) $(resultOk).trigger('tap');
            resultOk.click();
            return { code: 'dismissed_recommend_result' };
          }

          // 9. Scene canvas / stage active
          const sceneCanvas = document.querySelector('canvas#canvas, canvas#cjs-canvas, .prt-scene-comment, .cnt-quest-scene') as HTMLElement;
          if (isVisible(sceneCanvas)) {
            return { code: 'canvas_ready' };
          }

          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (action?.code === 'confirmed_skip_modal') {
        scenesSkipped++;
        consecutiveIdleCycles = 0;
        console.log(`[StoryScene] ⏩ Cutscene part ${scenesSkipped}/${maxScenes} skipped. Awaiting next scene or destination...`);
        options.onSceneSkipped?.(scenesSkipped, this.page.url());
        await logNormalDelay(500, 0.15);

        // Smart transitional wait: sub-second polling for next scene controls or combat/result exit
        const tWait = Date.now();
        let transitionedToNextScene = false;

        while (Date.now() - tWait < 4000) {
          const u = this.page.url();
          const dest = this.detectTerminalDestination(u);
          if (dest && !u.includes('scene')) {
            console.log(`[StoryScene] 🎯 Transitioned to terminal destination: ${dest}`);
            return {
              success: true,
              scenesSkipped,
              choicesSelected,
              terminalDestination: dest,
              durationMs: Date.now() - tStart,
              message: `Cleanly transitioned to ${dest}`
            };
          }

          // Check if new scene controls or dialogue choices have mounted
          const hasNewSceneControls = await this.page.evaluate(() => {
            const isVisible = (el: Element | null): el is HTMLElement => {
              if (!el) return false;
              const rect = (el as HTMLElement).getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const skip = document.querySelector('.btn-skip:not(.btn-scene-skip), [data-action="skip"], .pop-synopsis .btn-scene-skip');
            const choice = document.querySelector('.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok');
            return isVisible(skip) || isVisible(choice);
          }).catch(() => false);

          if (hasNewSceneControls) {
            transitionedToNextScene = true;
            console.log(`[StoryScene] 🔄 Detected subsequent cutscene part (${scenesSkipped + 1}). Fast-skipping...`);
            break;
          }

          await new Promise(r => setTimeout(r, 150));
        }

        if (!transitionedToNextScene && !this.page.url().includes('scene')) {
          const finalDest = this.detectTerminalDestination(this.page.url()) || 'result';
          return {
            success: true,
            scenesSkipped,
            choicesSelected,
            terminalDestination: finalDest,
            durationMs: Date.now() - tStart
          };
        }

        continue;
      } else if (action?.code === 'conflict_error') {
        console.warn('[StoryScene] ⚠️ Cutscene setting conflict detected. Auto-resetting "quest-skip" setting...');
        await this.resetQuestSkipSettings();
        continue;
      } else if (action?.code === 'confirmed_caution' || action?.code === 'started_quest') {
        consecutiveIdleCycles = 0;
        await logNormalDelay(600, 0.2);
        continue;
      } else if (action?.code === 'clicked_skip_button') {
        consecutiveIdleCycles = 0;
        await logNormalDelay(350, 0.15);
        continue;
      } else if (action?.code === 'selected_choice') {
        choicesSelected++;
        consecutiveIdleCycles = 0;
        console.log(`[StoryScene] 💬 Selected dialogue branch choice #${choicesSelected}.`);
        await logNormalDelay(350, 0.15);
        continue;
      } else if (action?.code === 'clicked_recommend_deck' || action?.code === 'dismissed_recommend_result') {
        consecutiveIdleCycles = 0;
        await logNormalDelay(500, 0.15);
        continue;
      } else if (action?.code === 'canvas_ready') {
        consecutiveIdleCycles++;
        if (consecutiveIdleCycles >= 4) {
          // Tap center screen to awaken dormant HUD controls
          await this.page.touchscreen.tap(240, 360).catch(() => null);
          consecutiveIdleCycles = 0;
        }
        await logNormalDelay(350, 0.15);
      } else {
        consecutiveIdleCycles++;
        // If not in a scene and has been idle, check destination
        if (!currentUrl.includes('scene')) {
          const dest = this.detectTerminalDestination(currentUrl);
          if (dest) {
            return {
              success: true,
              scenesSkipped,
              choicesSelected,
              terminalDestination: dest,
              durationMs: Date.now() - tStart
            };
          }
        }
        await new Promise(r => setTimeout(r, 250));
      }
    }

    const finalDest = this.detectTerminalDestination(this.page.url()) || 'timeout';
    return {
      success: scenesSkipped > 0 || finalDest !== 'timeout',
      scenesSkipped,
      choicesSelected,
      terminalDestination: finalDest,
      durationMs: Date.now() - tStart,
      message: scenesSkipped > 0 ? `Skipped ${scenesSkipped} scenes` : 'Story scene skipper timed out'
    };
  }

  /**
   * Fast-skips a single story scene cutscene (convenience wrapper).
   */
  public async skipSingleCutscene(timeoutMs = 15000): Promise<boolean> {
    const outcome = await this.skipStoryScenes({ timeoutMs, maxScenes: 1 });
    return outcome.success;
  }

  /**
   * Automatically disables the conflicting "Skip Cutscenes" (quest-skip) setting in GBF settings.
   */
  public async resetQuestSkipSettings(): Promise<boolean> {
    try {
      console.log('[StoryScene] ⚙️ Navigating to #setting/questuseful to disable quest cutscene skip conflict...');
      const originUrl = this.page.url();

      await this.page.evaluate(() => {
        window.location.hash = '#setting/questuseful';
      });
      await logNormalDelay(1200, 0.2);

      const modified = await this.page.evaluate(() => {
        const chk = document.querySelector('input[name="quest-skip"]') as HTMLInputElement;
        if (chk && chk.checked) {
          chk.click();
          return true;
        }
        return false;
      });

      if (modified) {
        console.log('[StoryScene] ✅ Conflicting "quest-skip" setting unchecked successfully.');
        await logNormalDelay(600, 0.15);
      }

      // Return to original location
      if (originUrl && originUrl.includes('granbluefantasy.jp')) {
        const hash = originUrl.includes('#') ? originUrl.substring(originUrl.indexOf('#')) : '#quest/fate';
        await this.page.evaluate((h) => { window.location.hash = h; }, hash);
        await logNormalDelay(1000, 0.2);
      }

      return true;
    } catch (err: any) {
      console.warn(`[StoryScene] Warning during quest skip setting reset: ${err?.message}`);
      return false;
    }
  }

  /**
   * Categorizes the current URL into a destination state.
   */
  public detectTerminalDestination(url: string): StorySceneTerminalDestination | null {
    if (url.includes('#quest/supporter') || url.includes('#quest/stage') || url.includes('#raid') || url.includes('#battle')) {
      return 'combat';
    }
    if (url.includes('result') || url.includes('#result/')) {
      return 'result';
    }
    if (url.includes('#quest/fate')) {
      return 'fate_list';
    }
    if (url.includes('#event/')) {
      return 'event_home';
    }
    if (url.includes('#mypage')) {
      return 'mypage';
    }
    return null;
  }
}

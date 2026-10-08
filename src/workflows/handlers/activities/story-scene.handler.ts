// src/workflows/handlers/activities/story-scene.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { logNormalDelay } from '../../../human-motor.js';

export class StorySceneStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['skip_story_scene', 'auto_fate_episode'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template, state, services } = context;
    const timeoutMs = step.timeoutMs || 15000;
    const tStart = Date.now();

    while (Date.now() - tStart < timeoutMs) {
      if (state.stopRequested) {
        return { success: false, actionCode: 'skip_story_scene', durationMs: 0, message: 'Stop requested.' };
      }
      if (template.stopOnCaptcha !== false) {
        await services.sentinel.assertSafe();
      }

      const currentUrl = page.url();
      if (!currentUrl.includes('scene') && (currentUrl.includes('result') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#raid') || currentUrl.includes('#quest/fate'))) {
        break;
      }

      const actionTaken = await page.evaluate(() => {
        const $ = (window as any).$ || (window as any).Zepto;

        // 1. Episode prerequisite caution / spoiler warning (.pop-episode-caution): tap "Spoil Me", then tap OK
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
          if ($) $(skipOkBtn).trigger('tap');
          skipOkBtn.click();
          return 'confirmed_skip_modal';
        }

        // 4. Synopsis / start modal OK button
        const startOk = document.querySelector(
          '.btn-usual-ok.se-quest-start, .pop-synopsis .btn-usual-ok:not(.disable)'
        ) as HTMLElement;
        if (startOk && startOk.offsetParent !== null) {
          if ($) $(startOk).trigger('tap');
          startOk.click();
          return 'started_quest';
        }

        // 5. Story scene SKIP button: ".btn-skip", ".prt-scene-setting .btn-skip", "[data-action='skip']"
        const skipBtn = document.querySelector(
          '.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"]'
        ) as HTMLElement;
        if (skipBtn && skipBtn.offsetParent !== null) {
          if ($) $(skipBtn).trigger('tap');
          skipBtn.click();
          return 'clicked_skip_button';
        }

        // 6. Dialogue choice inside story: ".prt-selection .btn-selection", ".btn-command"
        const choiceBtn = document.querySelector(
          '.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok'
        ) as HTMLElement;
        if (choiceBtn && choiceBtn.offsetParent !== null) {
          if ($) $(choiceBtn).trigger('tap');
          choiceBtn.click();
          return 'selected_choice';
        }

        // 7. Scene canvas or stage active: tap to awaken HUD
        const sceneCanvas = document.querySelector('canvas#canvas, canvas#cjs-canvas, .prt-scene-comment, .cnt-quest-scene') as HTMLElement;
        if (sceneCanvas && sceneCanvas.offsetParent !== null) {
          return 'canvas_ready';
        }

        return null;
      });

      if (actionTaken === 'confirmed_skip_modal') {
        await logNormalDelay(600, 0.2);
        // Wait for redirect out of scene
        const tWait = Date.now();
        while (Date.now() - tWait < 12000) {
          const url = page.url();
          if (url.includes('result') || url.includes('#quest/supporter') || url.includes('#raid') || url.includes('#quest/fate') || url.includes('#mypage')) {
            break;
          }
          await new Promise(r => setTimeout(r, 300));
        }
        break;
      } else if (actionTaken === 'conflict_error') {
        await page.evaluate(() => {
          window.location.hash = '#setting/questuseful';
        });
        await logNormalDelay(1200, 0.2);
        await page.evaluate(() => {
          const chk = document.querySelector('input[name="quest-skip"]') as HTMLInputElement;
          if (chk && chk.checked) chk.click();
        });
        await logNormalDelay(800, 0.2);
        await page.evaluate(() => {
          window.location.hash = '#quest/fate';
        });
        await logNormalDelay(1500, 0.2);
        continue;
      } else if (actionTaken === 'confirmed_caution' || actionTaken === 'started_quest') {
        await logNormalDelay(600, 0.2);
        continue;
      } else if (actionTaken === 'clicked_skip_button') {
        await logNormalDelay(400, 0.2);
      } else if (actionTaken === 'selected_choice') {
        await logNormalDelay(350, 0.15);
      } else if (actionTaken === 'canvas_ready') {
        await page.touchscreen.tap(240, 360).catch(() => null);
        await logNormalDelay(350, 0.2);
      } else {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return { success: true, actionCode: 'skip_story_scene', durationMs: Date.now() - tStart };
  }
}

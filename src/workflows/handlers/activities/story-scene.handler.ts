// src/workflows/handlers/activities/story-scene.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { logNormalDelay } from '../../../human-motor.js';

export class StorySceneStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['skip_story_scene'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template, state, services } = context;
    const timeoutMs = step.timeoutMs || 10000;
    const tStart = Date.now();

    while (Date.now() - tStart < timeoutMs) {
      if (state.stopRequested) {
        return { success: false, actionCode: 'skip_story_scene', durationMs: 0, message: 'Stop requested.' };
      }
      if (template.stopOnCaptcha !== false) {
        await services.sentinel.assertSafe();
      }

      const currentUrl = page.url();
      if (currentUrl.includes('result') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#raid')) {
        break;
      }

      const actionTaken = await page.evaluate(() => {
        const $ = (window as any).$ || (window as any).Zepto;

        // Skip confirmation popup
        const skipOkBtn = document.querySelector('.pop-skip .btn-usual-ok, .btn-skip-ok, .pop-skip .btn-skip-confirm, .pop-usual .btn-usual-ok, .btn-scene-skip, .pop-synopsis .btn-scene-skip, .pop-usual .btn-scene-skip') as HTMLElement;
        if (skipOkBtn && skipOkBtn.offsetParent !== null) {
          if ($) $(skipOkBtn).trigger('tap');
          skipOkBtn.click();
          return 'confirmed_skip_modal';
        }

        // Story scene SKIP button
        const skipBtn = document.querySelector('.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"]') as HTMLElement;
        if (skipBtn && skipBtn.offsetParent !== null) {
          if ($) $(skipBtn).trigger('tap');
          skipBtn.click();
          return 'clicked_skip_button';
        }

        // Dialogue choice
        const choiceBtn = document.querySelector('.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok') as HTMLElement;
        if (choiceBtn && choiceBtn.offsetParent !== null) {
          if ($) $(choiceBtn).trigger('tap');
          choiceBtn.click();
          return 'selected_choice';
        }

        const sceneCanvas = document.querySelector('canvas#canvas, canvas#cjs-canvas, .prt-scene-comment, .cnt-quest-scene') as HTMLElement;
        if (sceneCanvas && sceneCanvas.offsetParent !== null) {
          return 'canvas_ready';
        }

        return null;
      });

      if (actionTaken === 'confirmed_skip_modal') {
        await logNormalDelay(600, 0.2);
        break;
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

    return { success: true, actionCode: 'skip_story_scene', durationMs: 0 };
  }
}

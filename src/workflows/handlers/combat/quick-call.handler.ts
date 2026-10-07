// src/workflows/handlers/combat/quick-call.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { humanizedClick } from '../../../human-motor.js';

export class QuickCallStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['quick_call'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template } = context;
    const isTurbo = template.speedProfile === 'turbo';

    await context.services.combat.waitForCombatInputReady(isTurbo ? 600 : 4000);
    const qBtn = await page.waitForSelector('.btn-quick-summon, #js-btn-quick-summon', { visible: true, timeout: 2500 }).catch(() => null);

    if (qBtn) {
      const isUnavailable = await qBtn.evaluate((el: any) => {
        return el.classList.contains('btn-summon-unavailable') ||
               el.classList.contains('off') ||
               el.classList.contains('disabled') ||
               el.getAttribute('aria-disabled') === 'true' ||
               el.style.opacity === '0.5';
      }).catch(() => false);

      if (isUnavailable) {
        return { success: true, actionCode: 'quick_call', durationMs: 0, message: 'Quick Summon already invoked or on cooldown.' };
      }

      const netPromise = new Promise<boolean>((resolve) => {
        const handler = (res: any) => {
          try {
            if (res.url().includes(step.waitForNetwork || 'summon_result.json')) {
              page.off('response', handler);
              resolve(true);
            }
          } catch {
            // ignore
          }
        };
        page.on('response', handler);
        setTimeout(() => {
          page.off('response', handler);
          resolve(false);
        }, 3500);
      });

      await humanizedClick(page, qBtn);
      await qBtn.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
      }).catch(() => null);
      await netPromise;

      // Fast-forward animation and clear locks
      await page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) cjs.Tween.tick(3000, false);
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }
      }).catch(() => null);

      await context.services.combat.waitForCombatInputReady(isTurbo ? 400 : 3000);
      return { success: true, actionCode: 'quick_call', durationMs: 0 };
    }

    return {
      success: step.optional ? true : false,
      actionCode: 'quick_call',
      durationMs: 0,
      message: step.optional ? 'Quick call button not found, skipped.' : 'Quick call button not found.'
    };
  }
}

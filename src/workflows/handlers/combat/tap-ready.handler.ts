// src/workflows/handlers/combat/tap-ready.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class TapReadyStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['tap_ready'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, services } = context;
    const dismissed = await page.evaluate(() => {
      const readyEl = document.querySelector('.prt-ready, #ready') as HTMLElement;
      if (readyEl && readyEl.offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none') {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(readyEl).trigger('tap');
        readyEl.click();
        return true;
      }
      return false;
    }).catch(() => false);

    await page.touchscreen.tap(240, 260).catch(() => null);

    if (services.combat?.triggerAttack) {
      const outcome = await services.combat.triggerAttack({ expectLockout: false }).catch(() => null);
      return {
        success: outcome?.success ?? true,
        actionCode: 'tap_ready',
        durationMs: outcome?.durationMs ?? 0,
        message: outcome?.message
      };
    }

    return { success: true, actionCode: 'tap_ready', durationMs: 0 };
  }
}

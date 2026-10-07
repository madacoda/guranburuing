// src/workflows/handlers/activities/loop-control.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { logNormalDelay } from '../../../human-motor.js';

export class LoopControlStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['loop_while', 'loop_until', 'do_until_finish'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const action = step.code || 'loop_while';
    const { page, template, state, services } = context;
    const selector = step.target || step.conditionElement || '';
    const maxLoops = step.maxLoops || 50;

    if (!selector || !step.subSteps || step.subSteps.length === 0) {
      return { success: true, actionCode: action, durationMs: 0 };
    }

    if (action === 'loop_while') {
      for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
        if (state.stopRequested) break;
        if (template.stopOnCaptcha !== false) await services.sentinel.assertSafe();

        const exists = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }, selector).catch(() => false);

        if (!exists) break;

        for (let s = 0; s < step.subSteps.length; s++) {
          const ok = await context.executeStep(step.subSteps[s], s + 1, 1);
          if (!ok && !step.subSteps[s].optional) return { success: false, actionCode: 'loop_while', durationMs: 0 };
        }
        await logNormalDelay(300, 0.15);
      }
      return { success: true, actionCode: 'loop_while', durationMs: 0 };
    }

    if (action === 'loop_until') {
      for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
        if (state.stopRequested) break;
        if (template.stopOnCaptcha !== false) await services.sentinel.assertSafe();

        const exists = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }, selector).catch(() => false);

        if (exists) break;

        for (let s = 0; s < step.subSteps.length; s++) {
          const ok = await context.executeStep(step.subSteps[s], s + 1, 1);
          if (!ok && !step.subSteps[s].optional) return { success: false, actionCode: 'loop_until', durationMs: 0 };
        }
        await logNormalDelay(300, 0.15);
      }
      return { success: true, actionCode: 'loop_until', durationMs: 0 };
    }

    // do_until_finish
    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (state.stopRequested) break;
      for (let s = 0; s < step.subSteps.length; s++) {
        await context.executeStep(step.subSteps[s], s + 1, 1);
      }
      await logNormalDelay(300, 0.15);
    }
    return { success: true, actionCode: 'do_until_finish', durationMs: 0 };
  }
}

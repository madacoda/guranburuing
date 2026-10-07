// src/workflows/handlers/combat/auto.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class AutoStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['auto', 'guard'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page } = context;
    const action = step.code || 'auto';

    if (action === 'guard') {
      const guardActivated = await page.evaluate(() => {
        const guardBtns = Array.from(document.querySelectorAll('.btn-guard')) as HTMLElement[];
        for (const btn of guardBtns) {
          if (btn.offsetParent !== null) {
            btn.click();
          }
        }
        return guardBtns.length > 0;
      }).catch(() => false);

      return { success: guardActivated, actionCode: 'guard', durationMs: 0 };
    }

    const mode = step.mode || 'full';
    const autoOk = await context.services.combat.toggleAutoMode(mode === 'full');
    return { success: autoOk, actionCode: 'auto', durationMs: 0 };
  }
}

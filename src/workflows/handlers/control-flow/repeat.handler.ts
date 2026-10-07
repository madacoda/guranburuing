// src/workflows/handlers/control-flow/repeat.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class RepeatStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['repeat'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    if (!step.subSteps || step.subSteps.length === 0) {
      return { success: true, actionCode: 'repeat', durationMs: 0 };
    }

    const count = step.repeatCount || 1;
    const { template, state } = context;

    for (let r = 0; r < count; r++) {
      if (state.stopRequested) {
        return { success: false, actionCode: 'repeat', durationMs: 0, message: 'Stop requested.' };
      }

      if (template.stopOnCaptcha !== false) {
        await context.services.sentinel.assertSafe();
      }

      if (template.targetScore && state.currentScore >= template.targetScore) {
        return { success: true, actionCode: 'repeat', durationMs: 0, shouldExitEarly: true, message: 'Target score reached.' };
      }

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];

        if (sub.code === 'exit_if_score' || sub.action === 'exit_if_score') {
          const threshold = sub.targetScore || template.targetScore || 1480000;
          if (state.currentScore >= threshold) {
            return { success: true, actionCode: 'repeat', durationMs: 0, shouldExitEarly: true, message: 'Exit if score reached.' };
          }
          continue;
        }

        const ok = await context.executeStep(sub, s + 1, 1);
        if (!ok && !sub.optional) {
          return { success: false, actionCode: 'repeat', durationMs: 0, message: `SubStep ${sub.code} failed in repeat block.` };
        }
      }
    }

    return { success: true, actionCode: 'repeat', durationMs: 0 };
  }
}

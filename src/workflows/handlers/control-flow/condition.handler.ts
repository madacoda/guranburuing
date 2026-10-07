// src/workflows/handlers/control-flow/condition.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class ConditionStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['condition', 'wait_turn'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const action = step.code || 'condition';
    const { state } = context;

    if (action === 'wait_turn') {
      const targetTurn = (step as any).turn || step.condition?.value || 2;
      const start = Date.now();
      while (Date.now() - start < 15000) {
        if (state.stopRequested) break;
        if (state.currentTurn >= targetTurn) {
          return { success: true, actionCode: 'wait_turn', durationMs: 0 };
        }
        await new Promise(r => setTimeout(r, 200));
      }
      return { success: state.currentTurn >= targetTurn, actionCode: 'wait_turn', durationMs: 0 };
    }

    // Standard condition block
    const condition = step.condition;
    if (!condition) {
      return { success: true, actionCode: 'condition', durationMs: 0 };
    }

    let isMet = false;
    if (condition.type === 'score_at_least') {
      isMet = state.currentScore >= condition.value;
    } else if (condition.type === 'turn_at_least') {
      isMet = state.currentTurn >= condition.value;
    }

    if (isMet && step.subSteps && step.subSteps.length > 0) {
      for (let i = 0; i < step.subSteps.length; i++) {
        const sub = step.subSteps[i];
        const ok = await context.executeStep(sub, i + 1, 1);
        if (!ok && !sub.optional) {
          return { success: false, actionCode: 'condition', durationMs: 0 };
        }
      }
    }

    return { success: true, actionCode: 'condition', durationMs: 0 };
  }
}

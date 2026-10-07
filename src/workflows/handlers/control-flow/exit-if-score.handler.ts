// src/workflows/handlers/control-flow/exit-if-score.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class ExitIfScoreStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['exit_if_score'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const target = step.targetScore || context.template.targetScore || 1480000;
    const current = context.state.currentScore;

    if (current >= target) {
      return {
        success: true,
        actionCode: 'exit_if_score',
        durationMs: 0,
        shouldExitEarly: true,
        message: `Target score met: ${current.toLocaleString()} >= ${target.toLocaleString()} pt`
      };
    }

    return {
      success: true,
      actionCode: 'exit_if_score',
      durationMs: 0,
      shouldExitEarly: false,
      message: `Score ${current.toLocaleString()} < ${target.toLocaleString()} pt; continuing.`
    };
  }
}

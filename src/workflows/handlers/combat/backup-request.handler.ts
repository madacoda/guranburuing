// src/workflows/handlers/combat/backup-request.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class BackupRequestStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['backup_request'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const outcome = await context.services.combat.requestBackup({ shareToAll: true, requestFriends: true, requestCrew: true });
    return {
      success: outcome.requested || Boolean(step.optional),
      actionCode: 'backup_request',
      durationMs: 0,
      message: outcome.message
    };
  }
}

// src/workflows/handlers/activities/pro-skip.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { ProSkipEngine } from '../../../engines/pro-skip.engine.js';

export class ProSkipStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['pro_skip_favorites'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template, services } = context;
    const autoReplenish = template.autoElixir !== false;
    const proSkipEngine = new ProSkipEngine(page, services.sentinel);
    const results = await proSkipEngine.runFavoritesProSkips(autoReplenish);

    const clearedCount = results.filter(r => r.status === 'SUCCESS' || r.status === 'ALREADY_CLEARED').length;
    return {
      success: true,
      actionCode: 'pro_skip_favorites',
      durationMs: 0,
      message: `Processed ${clearedCount}/${results.length} favorite Pro Skips.`
    };
  }
}

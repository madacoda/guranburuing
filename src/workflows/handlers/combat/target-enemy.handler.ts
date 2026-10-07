// src/workflows/handlers/combat/target-enemy.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class TargetEnemyStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['target_enemy'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page } = context;
    const enemyIdx = (step.enemyIndex || 1) - 1;

    const clicked = await page.evaluate((idx: number) => {
      const enemies = Array.from(document.querySelectorAll('.btn-target, .lis-enemy, .prt-target-area .btn-enemy')) as HTMLElement[];
      const target = enemies[idx];
      if (target && target.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(target).trigger('tap');
        target.click();
        return true;
      }
      return false;
    }, enemyIdx).catch(() => false);

    return {
      success: clicked || Boolean(step.optional),
      actionCode: 'target_enemy',
      durationMs: 0
    };
  }
}

// src/workflows/handlers/combat/heal.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { humanizedClick, logNormalDelay } from '../../../human-motor.js';

export class HealStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['heal'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page } = context;
    const pType = step.potionType || 'green';

    // 1. Open potion drawer
    const healMenuBtn = await page.waitForSelector('.btn-temporary, .btn-heal', { visible: true, timeout: 2500 }).catch(() => null);
    if (!healMenuBtn) {
      return { success: false, actionCode: 'heal', durationMs: 0, message: 'Potion menu button not found.' };
    }

    await humanizedClick(page, healMenuBtn);
    await logNormalDelay(200, 0.1);

    // 2. Select potion type
    const itemSelector = pType === 'green'
      ? '.lis-item[item-id="1"], .btn-item-small'
      : pType === 'blue'
      ? '.lis-item[item-id="2"], .btn-item-all'
      : '.lis-item[item-id="3"], .btn-item-elixir';

    const potionBtn = await page.waitForSelector(itemSelector, { visible: true, timeout: 2500 }).catch(() => null);
    if (potionBtn) {
      await humanizedClick(page, potionBtn);
      const okBtn = await page.waitForSelector('.btn-usual-ok.btn-item-use, .btn-usual-ok.se-use', { visible: true, timeout: 1500 }).catch(() => null);
      if (okBtn) await humanizedClick(page, okBtn);
      await logNormalDelay(250, 0.1);
      return { success: true, actionCode: 'heal', durationMs: 0 };
    }

    return { success: false, actionCode: 'heal', durationMs: 0, message: `Potion of type ${pType} not found.` };
  }
}

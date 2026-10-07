// src/workflows/handlers/timing/wait.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { logNormalDelay, randomDelay } from '../../../human-motor.js';

export class WaitStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = [
    'wait',
    'wait_random',
    'wait_randomize',
    'wait_network',
    'wait_element',
    'eval'
  ];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const action = step.code || 'wait';
    const { page } = context;

    if (action === 'wait') {
      const ms = step.ms || (step as any).duration || 1000;
      await new Promise(r => setTimeout(r, ms));
      return { success: true, actionCode: 'wait', durationMs: ms };
    }

    if (action === 'wait_random' || action === 'wait_randomize') {
      const min = step.minMs || 500;
      const max = step.maxMs || 1500;
      await randomDelay(min, max);
      return { success: true, actionCode: action, durationMs: 0 };
    }

    if (action === 'wait_element') {
      const sel = step.target || (step as any).selector || '';
      if (!sel) return { success: true, actionCode: 'wait_element', durationMs: 0 };
      const el = await page.waitForSelector(sel, { visible: true, timeout: step.timeoutMs || 5000 }).catch(() => null);
      return { success: !!el || Boolean(step.optional), actionCode: 'wait_element', durationMs: 0 };
    }

    if (action === 'wait_network') {
      const targetUrl = step.target || step.waitForNetwork || '';
      if (!targetUrl) return { success: true, actionCode: 'wait_network', durationMs: 0 };
      const resolved = await new Promise<boolean>((resolve) => {
        const handler = (res: any) => {
          try {
            if (res.url().includes(targetUrl)) {
              page.off('response', handler);
              resolve(true);
            }
          } catch {
            // ignore
          }
        };
        page.on('response', handler);
        setTimeout(() => {
          page.off('response', handler);
          resolve(false);
        }, step.timeoutMs || 5000);
      });
      return { success: resolved || Boolean(step.optional), actionCode: 'wait_network', durationMs: 0 };
    }

    if (action === 'eval') {
      const script = step.script || step.target || '';
      if (script) {
        await page.evaluate((code: string) => {
          try {
            eval(code);
          } catch {}
        }, script).catch(() => null);
      }
      return { success: true, actionCode: 'eval', durationMs: 0 };
    }

    return { success: true, actionCode: action, durationMs: 0 };
  }
}

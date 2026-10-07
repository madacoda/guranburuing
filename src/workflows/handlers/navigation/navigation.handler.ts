// src/workflows/handlers/navigation/navigation.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { humanizedClick, logNormalDelay } from '../../../human-motor.js';

export class NavigationStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = [
    'navigate',
    'click',
    'touch_tap',
    'confirm_result',
    'dismiss_popups'
  ];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const action = step.code || 'navigate';
    const { page } = context;

    if (action === 'navigate') {
      const url = step.target || step.page || '';
      if (!url) return { success: true, actionCode: 'navigate', durationMs: 0 };

      if (url.startsWith('#')) {
        await page.evaluate((hash: string) => {
          window.location.hash = hash;
        }, url).catch(() => null);
      } else {
        await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);
      }
      await logNormalDelay(400, 0.15);
      return { success: true, actionCode: 'navigate', durationMs: 0 };
    }

    if (action === 'click' || action === 'touch_tap') {
      const sel = step.target || '';
      if (!sel) return { success: true, actionCode: action, durationMs: 0 };

      const el = await page.waitForSelector(sel, { visible: true, timeout: step.timeoutMs || 3000 }).catch(() => null);
      if (el) {
        await humanizedClick(page, el);
        return { success: true, actionCode: action, durationMs: 0 };
      }
      return { success: Boolean(step.optional), actionCode: action, durationMs: 0, message: `Selector "${sel}" not found.` };
    }

    if (action === 'dismiss_popups') {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll(
          '.pop-usual .btn-usual-ok, .pop-usual .btn-close, .btn-usual-close, .prt-popup-header .btn-close'
        )) as HTMLElement[];
        for (const b of btns) {
          if (b.offsetParent !== null) {
            b.click();
          }
        }
      }).catch(() => null);
      return { success: true, actionCode: 'dismiss_popups', durationMs: 0 };
    }

    if (action === 'confirm_result') {
      // 1. Inspect DOM for Gold Bar / Blue Chest drops
      const lootOutcome = await context.services.loot.inspectDomRewards();
      if (lootOutcome.hasGoldBar) {
        context.state.totalGoldBarsAccumulated++;
      }
      if (lootOutcome.hasBlueChest) {
        context.state.totalBlueChestsAccumulated++;
      }

      // 2. Dismiss result dialogs
      await page.evaluate(() => {
        const okBtns = Array.from(document.querySelectorAll(
          '.btn-usual-ok, .btn-settle, .btn-usual-close, .pop-raid-result .btn-usual-ok, .btn-result-close, .btn-control.location-href'
        )) as HTMLElement[];
        for (const btn of okBtns) {
          if (btn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
          }
        }
      }).catch(() => null);

      await logNormalDelay(300, 0.1);
      return { success: true, actionCode: 'confirm_result', durationMs: 0 };
    }

    return { success: true, actionCode: action, durationMs: 0 };
  }
}

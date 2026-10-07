// src/workflows/handlers/combat/attack.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { humanizedClick, sampleGaussian } from '../../../human-motor.js';

export class AttackStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['attack'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template, state } = context;
    const isTurbo = template.speedProfile === 'turbo';
    const targetNet = step.waitForNetwork || 'normal_attack_result.json';
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (state.stopRequested) {
        return { success: false, actionCode: 'attack', durationMs: 0, message: 'Stop requested.' };
      }

      // 1. Proactively dismiss open drawers/popups
      await context.services.combat.dismissCombatDrawersAndPopups();

      // 2. Wait for readiness
      await context.services.combat.waitForCombatInputReady(isTurbo ? 500 : 3000);

      // 3. Locate active attack button
      let atkBtn = await page.waitForFunction(() => {
        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          back.click();
        }
        const el = document.querySelector('.btn-attack-start') as HTMLElement;
        if (!el) return false;
        const isDisplayOn = (el.classList.contains('display-on') || !el.classList.contains('display-off')) && !el.classList.contains('lock');
        return isDisplayOn && el.offsetWidth > 0;
      }, { timeout: isTurbo ? 1000 : 2500 }).then(() => page.$('.btn-attack-start.display-on, .btn-attack-start')).catch(() => null);

      if (!atkBtn) {
        await context.services.combat.dismissCombatDrawersAndPopups();
        atkBtn = await page.$('.btn-attack-start.display-on, .btn-attack-start');
      }

      // 4. Arm network promise
      const netPromise = new Promise<boolean>((resolve) => {
        const handler = (res: any) => {
          try {
            if (res.url().includes(targetNet)) {
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
        }, isTurbo ? 3500 : 5000);
      });

      // 5. Click attack button
      let tapped = false;
      if (atkBtn) {
        const box = await atkBtn.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          const tapX = Math.round(box.x + box.width / 2 + (isTurbo ? 0 : sampleGaussian(0, 3)));
          const tapY = Math.round(box.y + box.height / 2 + (isTurbo ? 0 : sampleGaussian(0, 2)));
          await page.touchscreen.tap(tapX, tapY).catch(() => null);
          await page.mouse.click(tapX, tapY).catch(() => null);
          tapped = true;
        } else {
          await humanizedClick(page, atkBtn);
          tapped = true;
        }

        await atkBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          el.click();
        }).catch(() => null);
        tapped = true;
      }

      if (!tapped) {
        const vp = (page.viewport && page.viewport()) || { width: 480, height: 960 };
        const atkX = Math.round(vp.width * 0.75);
        const atkY = Math.round(vp.height * 0.46);
        await page.touchscreen.tap(atkX, atkY).catch(() => null);
        await page.mouse.click(atkX, atkY).catch(() => null);
      }

      // 6. Await network resolution
      const resolved = await netPromise;
      if (resolved) {
        return { success: true, actionCode: 'attack', durationMs: 0 };
      }

      // Check if turn already advanced
      const clientState = await page.evaluate((prevTurn: number) => {
        const stage = (window as any).stage;
        const currentTurn = stage?.gGameStatus?.turn;
        const isAttacking = stage?.gGameStatus?.attacking || stage?.gGameStatus?.lock;
        return { currentTurn, isAttacking };
      }, state.currentTurn).catch(() => ({ currentTurn: undefined, isAttacking: false }));

      if (clientState.isAttacking || (clientState.currentTurn && clientState.currentTurn > state.currentTurn)) {
        return { success: true, actionCode: 'attack', durationMs: 0 };
      }
    }

    return { success: false, actionCode: 'attack', durationMs: 0, message: 'Attack unacknowledged after retries.' };
  }
}

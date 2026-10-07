// src/workflows/handlers/combat/reload.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { logNormalDelay } from '../../../human-motor.js';

export class ReloadStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['reload', 'f5'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template } = context;
    const isTurbo = template.speedProfile === 'turbo';

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
      page.evaluate(() => location.reload()).catch(() => null)
    ]);

    if (!isTurbo) await logNormalDelay(100, 0.1);

    // Fast-forward CreateJS and dismiss dialogs
    await page.evaluate(() => {
      const cjs = (window as any).createjs;
      if (cjs?.Ticker) {
        cjs.Ticker.framerate = 120;
      }
      if (cjs?.Tween?.tick) {
        cjs.Tween.tick(3000, false);
      }
      const stage = (window as any).stage;
      if (stage?.gGameStatus) {
        stage.gGameStatus.lock = false;
        stage.gGameStatus.btn_lock = false;
        stage.gGameStatus.animation = false;
      }
      // Clear processing turn modal if present
      const ok = document.querySelector('.pop-usual .btn-usual-ok, #pop .btn-usual-ok') as HTMLElement;
      if (ok) ok.click();
    }).catch(() => null);

    await context.services.combat.dismissCombatDrawersAndPopups();
    return { success: true, actionCode: step.code || 'reload', durationMs: 0 };
  }
}

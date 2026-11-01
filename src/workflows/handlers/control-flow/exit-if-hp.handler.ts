// src/workflows/handlers/control-flow/exit-if-hp.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';

export class ExitIfHpStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['exit_if_hp'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const threshold = step.targetHpPct ?? step.targetHp ?? context.template.exitIfHpPct ?? 12;

    let hpPct = 100;
    let isDefeated = false;

    if (context.page) {
      try {
        const info = await context.page.evaluate(() => {
          const stage = (window as any).stage;
          const pJsn = stage?.pJsnData;
          const gStatus = stage?.gGameStatus;
          const rawBoss = gStatus?.boss?.param || gStatus?.boss || stage?.gEnemyStatus || pJsn?.boss?.param || pJsn?.boss;
          const bosses = Array.isArray(rawBoss) ? rawBoss : (rawBoss?.param && Array.isArray(rawBoss.param) ? rawBoss.param : Object.values(rawBoss || {}));

          if (bosses.length > 0) {
            const b = bosses.find((item: any) => item && item.hp !== undefined && Number(item.hp) > 0) || bosses[0];
            if (b) {
              const maxHp = parseInt(String(b.hpmax || 0), 10);
              const curHp = parseInt(String(b.hp || 0), 10);
              const gauge = document.querySelector('.prt-boss-gauge .prt-hp-gauge-inner, .prt-gauge-hp-inner') as HTMLElement;
              const gaugePct = gauge ? parseFloat(gauge.style.width || '100') : 100;

              let pct = 100;
              if (!isNaN(maxHp) && maxHp > 0 && !isNaN(curHp)) {
                pct = (Math.max(curHp, 0) / maxHp) * 100;
              } else if (!isNaN(gaugePct)) {
                pct = gaugePct;
              }

              const allDef = bosses.every((item: any) => !item || item.hp === undefined || Number(item.hp) <= 0 || item.alive === 0);
              return { hpPct: pct, isDefeated: allDef || pct <= 0 || b.alive === 0 };
            }
          }

          const gauge = document.querySelector('.prt-boss-gauge .prt-hp-gauge-inner, .prt-gauge-hp-inner') as HTMLElement;
          if (gauge) {
            const widthStr = gauge.style.width || '100%';
            return { hpPct: parseFloat(widthStr) || 100, isDefeated: false };
          }
          return null;
        });

        if (info) {
          hpPct = info.hpPct;
          isDefeated = info.isDefeated;
        }
      } catch {
        // Fallback safely if DOM evaluation is unavailable
      }
    }

    if (isDefeated || hpPct <= threshold) {
      return {
        success: true,
        actionCode: 'exit_if_hp',
        durationMs: 0,
        shouldExitEarly: true,
        message: `Boss HP threshold met: ${hpPct.toFixed(1)}% <= ${threshold}%. Honors will not count past cutoff; exiting combat early.`
      };
    }

    return {
      success: true,
      actionCode: 'exit_if_hp',
      durationMs: 0,
      shouldExitEarly: false,
      message: `Boss HP ${hpPct.toFixed(1)}% > ${threshold}%; continuing combat.`
    };
  }
}

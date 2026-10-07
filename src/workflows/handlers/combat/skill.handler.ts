// src/workflows/handlers/combat/skill.handler.ts
import { WorkflowActionType, WorkflowStep } from '../../../types/workflow.types.js';
import {
  IStepHandler,
  StepExecutionResult,
  WorkflowExecutionContext
} from '../../context/workflow-context.types.js';
import { humanizedClick, logNormalDelay } from '../../../human-motor.js';

export class SkillStepHandler implements IStepHandler {
  public readonly supportedActions: WorkflowActionType[] = ['skill'];

  public async execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult> {
    const { page, template } = context;
    const char = step.character || 1;
    const skill = step.skill || 1;
    const isTurbo = template.speedProfile === 'turbo';
    const skillSelector = `.ability-character-num-${char}-${skill}`;

    // 1. Proactively clear overlays if skill not visible
    let isVisible = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
    }, skillSelector).catch(() => false);

    if (!isVisible) {
      await context.services.combat.dismissCombatDrawersAndPopups();
    }

    // 2. Wait for combat state readiness
    await context.services.combat.waitForCombatInputReady(isTurbo ? 2000 : 5000);

    // 3. Open character ability tray if not visible
    if (!isVisible) {
      isVisible = await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
      }, skillSelector).catch(() => false);
    }

    if (!isVisible) {
      const charIdx = char - 1;
      const charSelector = `.lis-character${charIdx}.btn-command-character, .lis-character${charIdx}`;
      const charBtn = await page.waitForSelector(charSelector, { visible: true, timeout: 3500 }).catch(() => null);

      if (charBtn) {
        await humanizedClick(page, charBtn);
        await charBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(el).trigger('tap');
            $(el).trigger('click');
          }
          el.click();
        }).catch(() => null);
        if (!isTurbo) await logNormalDelay(150, 0.12);
      }

      isVisible = await page.waitForFunction((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        return !!el && el.offsetWidth > 0 && window.getComputedStyle(el).display !== 'none';
      }, { timeout: 2500 }, skillSelector).then(() => true).catch(() => false);
    }

    // 4. Locate skill button handle
    const skillBtn = await page.waitForSelector(skillSelector, { visible: true, timeout: 3000 }).catch(() => null);
    if (!skillBtn) {
      if (step.optional) {
        return { success: true, actionCode: 'skill', durationMs: 0, message: `Optional skill C${char}S${skill} not found, skipped.` };
      }
      return { success: false, actionCode: 'skill', durationMs: 0, message: `Skill C${char}S${skill} not visible.` };
    }

    // 5. Check if on cooldown
    const isUnavailable = await page.evaluate((el: any) => {
      return el.classList.contains('btn-ability-unavailable') ||
             el.classList.contains('disabled') ||
             el.classList.contains('empty');
    }, skillBtn).catch(() => false);

    if (isUnavailable) {
      return { success: true, actionCode: 'skill', durationMs: 0, message: `Skill C${char}S${skill} is on cooldown.` };
    }

    // 6. Arm network response listener
    const netPromise = new Promise<boolean>((resolve) => {
      const handler = (res: any) => {
        try {
          if (res.url().includes('ability_result.json')) {
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
      }, 3500);
    });

    // 7. Click skill button
    await humanizedClick(page, skillBtn);
    await skillBtn.evaluate((el: any) => {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(el).trigger('tap');
    }).catch(() => null);

    // Confirm dialog if active in settings
    const confirmBtn = await page.waitForSelector('.btn-usual-ok.btn-ability-use, .pop-usual .btn-usual-ok, .btn-usual-ok.se-ability-use', {
      visible: true,
      timeout: 350
    }).catch(() => null);
    if (confirmBtn) {
      await humanizedClick(page, confirmBtn);
      await confirmBtn.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
      }).catch(() => null);
    }

    // 8. Targeted skill support
    if (step.targetCharacter) {
      const targetIdx = step.targetCharacter - 1;
      const targetSelector = `.pop-usual .lis-character${targetIdx}.btn-command-character, .lis-character${targetIdx}.btn-command-character.front-member, .prt-popup-body .lis-character${targetIdx}, .pop-usual .lis-character${targetIdx}`;
      const targetEl = await page.waitForSelector(targetSelector, { visible: true, timeout: 5000 }).catch(() => null);
      if (targetEl) {
        await humanizedClick(page, targetEl);
        await targetEl.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
        }).catch(() => null);
      }
    }

    // 9. Await server response
    await netPromise;

    // Fast-bypass tween animation and unlock
    await page.evaluate(() => {
      const cjs = (window as any).createjs;
      if (cjs?.Tween?.tick) cjs.Tween.tick(3000, false);
      const stage = (window as any).stage;
      if (stage?.gGameStatus) {
        stage.gGameStatus.lock = false;
        stage.gGameStatus.btn_lock = false;
        stage.gGameStatus.animation = false;
      }
    }).catch(() => null);

    await context.services.combat.dismissCombatDrawersAndPopups();
    return { success: true, actionCode: 'skill', durationMs: 0 };
  }
}

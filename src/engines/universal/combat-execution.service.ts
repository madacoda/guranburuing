// src/engines/universal/combat-execution.service.ts
import { Page } from 'puppeteer-core';
import { UniversalContext } from './types.js';
import { CombatResolutionService } from './combat-resolution.service.js';
import { StepExecutionMonitorService } from './step-execution-monitor.service.js';
import { WorkflowStep, isSoloWorkflowTemplate } from '../../types/workflow.types.js';
import { config } from '../../config.js';
import {
  humanizedClick,
  humanReactionDelay,
  randomDelay,
  logNormalDelay,
  sampleGaussian,
  moveMouseSmoothly,
  getSpeedProfile
} from '../../human-motor.js';

export interface CombatExecutionDependencies {
  combatResolution: CombatResolutionService;
  stepMonitor?: StepExecutionMonitorService;
  executeSingleStep?: (step: WorkflowStep, stepNum: number, runNumber: number) => Promise<boolean>;
  isManualWorkflow?: () => boolean;
}

export class CombatExecutionService {
  public readonly stepMonitor: StepExecutionMonitorService;

  constructor(
    private ctx: UniversalContext,
    private deps: CombatExecutionDependencies
  ) {
    this.stepMonitor = deps.stepMonitor || new StepExecutionMonitorService(ctx);
  }

  public get page(): Page {
    return this.ctx.page;
  }

  public isManualWorkflow(): boolean {
    if (this.deps.isManualWorkflow) return this.deps.isManualWorkflow();
    const mode = this.ctx.template.mode as string | undefined;
    if (mode === 'auto' || mode === 'smart_auto') return false;

    const hasAuto = this.ctx.template.steps?.some(s =>
      s.code === 'auto' || s.action === 'auto' ||
      s.code === 'smart_full_auto' || s.action === 'smart_full_auto' ||
      s.code === 'tap_ready' || s.action === 'tap_ready'
    );
    if (hasAuto) return false;

    const hasManualSteps = this.ctx.template.steps?.some(s =>
      s.code === 'skill' || s.action === 'skill' ||
      s.code === 'attack' || s.action === 'attack' ||
      s.code === 'summon' || s.action === 'summon' ||
      s.code === 'quick_call' || s.action === 'quick_call' ||
      s.code === 'wait_element' || s.action === 'wait_element'
    );
    if (hasManualSteps) return true;

    if (mode === 'single' || mode === 'multi' || mode === 'routine' || mode === 'combat' || mode === 'manual') return true;
    if (mode === 'assist') return false;

    return this.ctx.template.isSolo === true;
  }

  /**
   * Executes a repeat block of subSteps.
   */
  public async handleRepeat(step: WorkflowStep, runNumber: number): Promise<boolean> {
    if (!step.subSteps || step.subSteps.length === 0) return true;
    const count = step.repeatCount || 1;

    for (let r = 0; r < count; r++) {
      if (this.ctx.state.stopRequested) return false;
      if (this.ctx.template.stopOnCaptcha !== false) await this.ctx.sentinel.assertSafe();

      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Run ${runNumber}] Battle concluded during repeat block loop ${r + 1}/${count}. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt.`);
        return true;
      }

      if (this.isSoloQuest()) {
        const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
        if (enemy?.isDefeated || enemy?.currentHp === 0 || (await this.deps.combatResolution.isBattleEnded())) {
          console.log(`[Run ${runNumber}] 🏁 Solo Boss Defeated during repeat loop. Exiting repeat block early.`);
          return true;
        }
      }

      // Check targetScore honorGuard before starting iteration
      if (this.ctx.template.honorGuard !== false && this.ctx.template.targetScore && this.ctx.state.currentScore >= this.ctx.template.targetScore) {
        console.log(`[Run ${runNumber}] Target score already reached (${this.ctx.state.currentScore.toLocaleString()} >= ${this.ctx.template.targetScore.toLocaleString()} pt). Exiting repeat block.`);
        return true;
      }

      console.log(`[Run ${runNumber}] Repeat loop ${r + 1}/${count}...`);

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];
        if (this.ctx.state.stopRequested) return false;

        const subAction = sub.code || sub.action;

        // Honor exit_if_score directly within repeat loop to break out of repeat block immediately
        if (subAction === 'exit_if_score') {
          if (this.isSoloQuest()) {
            const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
            if (enemy?.isDefeated || enemy?.currentHp === 0 || (await this.deps.combatResolution.isBattleEnded())) {
              console.log(`[Run ${runNumber}] 🏁 Solo Boss Defeated (evaluated at exit_if_score). Exiting repeat block early.`);
              return true;
            }
            continue;
          }
          await this.deps.combatResolution.syncCurrentHonors();
          const threshold = sub.targetScore || this.ctx.template.targetScore || 1480000;
          if (this.ctx.state.currentScore >= threshold) {
            console.log(`[Run ${runNumber}] Honor threshold met (${this.ctx.state.currentScore.toLocaleString()} >= ${threshold.toLocaleString()} pt). Exiting combat pipeline early.`);
            (this.ctx.state as any).targetScoreMet = true;
            return true;
          }
          continue;
        }

        if (subAction === 'exit_if_dead') {
          const isDead = await this.handleExitIfDead();
          if (isDead) return true;
          continue;
        }

        if (subAction === 'exit_if_hp') {
          const isBelow = await this.handleExitIfHp(sub);
          if (isBelow) return true;
          continue;
        }

        // Suppress attacks if targetScore has already been met
        if ((subAction === 'attack' || subAction === 'tap_ready') &&
            this.ctx.template.honorGuard !== false &&
            this.ctx.template.targetScore &&
            this.ctx.state.currentScore >= this.ctx.template.targetScore) {
          console.log(`[Run ${runNumber}] Target score already satisfied (${this.ctx.state.currentScore.toLocaleString()} >= ${this.ctx.template.targetScore.toLocaleString()} pt). Suppressing attack in repeat block.`);
          return true;
        }

        let ok = false;
        if (this.deps.executeSingleStep) {
          ok = await this.deps.executeSingleStep(sub, s + 1, runNumber);
        } else {
          ok = await this.executeFallbackSubStep(sub);
        }

        if (!ok && !sub.optional) {
          if (await this.deps.combatResolution.isBattleEnded()) {
            await this.deps.combatResolution.syncCurrentHonors();
            return true;
          }
          console.warn(`[Run ${runNumber}] Sub-step ${s + 1} (${sub.code}) failed inside repeat.`);
          return false;
        }
      }
    }

    return true;
  }

  public isSoloQuest(): boolean {
    return isSoloWorkflowTemplate(this.ctx?.template);
  }

  private async executeFallbackSubStep(step: WorkflowStep): Promise<boolean> {
    const code = step.code || step.action;
    switch (code) {
      case 'attack': return await this.handleAttack(step);
      case 'reload': case 'f5': return await this.handleReload(step);
      case 'tap_ready': return await this.handleTapReady(step);
      case 'skill': return await this.handleSkill(step);
      case 'summon': return await this.handleSummon(step);
      case 'quick_call': return await this.handleQuickCall(step);
      case 'log_enemy_hp':
        await this.deps.combatResolution.getAndLogEnemyHp(step.name || 'Manual Log');
        return true;
      case 'exit_if_dead':
        return await this.handleExitIfDead();
      case 'exit_if_hp':
        return await this.handleExitIfHp(step);
      case 'wait':
        await new Promise(r => setTimeout(r, step.ms || 500));
        return true;
      case 'wait_random':
      case 'wait_randomize':
        {
          const min = step.minMs || 500;
          const max = step.maxMs || 1500;
          const delay = Math.floor(Math.random() * (max - min + 1)) + min;
          console.log(`[Combat] ⏳ Random delay: ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          return true;
        }
      case 'wait_element':
        if (step.target) {
          await this.page.waitForSelector(step.target, { visible: true, timeout: step.timeoutMs || 5000 }).catch(() => null);
        }
        return true;
      case 'wait_network':
        if (step.waitForNetwork) {
          await this.deps.combatResolution.waitForNetworkResponse(step.waitForNetwork, step.timeoutMs || 5000);
        }
        return true;
      case 'wait_wave':
      case 'wait_for_wave':
        return await this.handleWaitWave(step);
      default: return true;
    }
  }

  /**
   * Evaluates early exit condition based on current honors (or boss remaining HP in solo quests).
   */
  public async handleExitIfScore(step: WorkflowStep): Promise<boolean> {
    if (this.isSoloQuest()) {
      const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
      if (enemy?.isDefeated || enemy?.currentHp === 0 || (await this.deps.combatResolution.isBattleEnded())) {
        console.log(`[Combat:Solo] Boss defeated. Exiting combat early.`);
        return true;
      }
      return true;
    }
    await this.deps.combatResolution.syncCurrentHonors();
    const threshold = step.targetScore || this.ctx.template.targetScore || 1480000;
    if (this.ctx.state.currentScore >= threshold) {
      console.log(`[Combat] Honor threshold met (${this.ctx.state.currentScore.toLocaleString()} >= ${threshold.toLocaleString()} pt). Exiting combat.`);
      return true;
    }
    return true;
  }

  public async handleExitIfDead(): Promise<boolean> {
    const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
    const isDead = enemy?.isDefeated || enemy?.currentHp === 0 || (await this.deps.combatResolution.isBattleEnded());
    if (isDead) {
      console.log('[Combat:Enemy] 🏁 Enemy defeated. Exiting combat early.');
    }
    return isDead;
  }

  public async handleExitIfHp(step: WorkflowStep): Promise<boolean> {
    const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
    const threshold = step.targetHpPct ?? step.targetHp ?? 0;
    const isBelow = !!enemy && (enemy.isDefeated || enemy.hpPct <= threshold);
    if (isBelow) {
      console.log(`[Combat:Enemy] 🎯 Enemy HP threshold met (${enemy?.hpPct.toFixed(1)}% <= ${threshold}%). Exiting combat early.`);
    }
    return isBelow;
  }

  /**
   * Waits until the combat turn counter reaches targetTurn.
   */
  public async handleWaitTurn(step: WorkflowStep): Promise<boolean> {
    const targetTurn = step.condition?.value || 2;
    const start = Date.now();
    while (Date.now() - start < (step.timeoutMs || 10000)) {
      if (this.ctx.state.stopRequested) return false;
      if (await this.deps.combatResolution.isBattleEnded()) return true;
      if (this.ctx.state.currentTurn >= targetTurn) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  /**
   * Waits for a specific wave (e.g. Wave 2) to mount, clears any TAP READY overlays,
   * and verifies that all frontline characters are visible and fully loaded.
   */
  public async handleWaitWave(step: WorkflowStep): Promise<boolean> {
    const targetWave = step.wave || step.waitForWave || (step.condition?.value ? Number(step.condition.value) : 2);
    const timeoutMs = step.timeoutMs || 10000;
    console.log(`[Combat] 🌊 Waiting for Wave ${targetWave} (screen ${targetWave}/${targetWave}) & all characters to full load...`);

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.ctx.state.stopRequested) return false;

      // Check if battle concluded (e.g. boss defeated)
      const isDefeated = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        return stage?.gGameStatus?.win || stage?.pJsnData?.is_clear || !!document.querySelector('.pop-raid-result, .prt-result-head');
      }).catch(() => false);
      if (isDefeated) return true;

      // Dismiss any "TAP READY" or ready overlay, and re-trigger footer back if waiting for wave transition
      await this.page.evaluate((elapsed: number) => {
        const readyEl = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready, #ready, .prt-start, .btn-attack-ready, .prt-canvas-mask') as HTMLElement;
        if (readyEl && readyEl.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(readyEl).trigger('touchstart');
            $(readyEl).trigger('touchend');
            $(readyEl).trigger('tap');
            $(readyEl).trigger('click');
          }
          readyEl.click();
        }

        // Re-dispatch footer back if client was locked during initial attempt
        if (elapsed > 1200 && elapsed % 1200 < 150) {
          const footerBack = document.querySelector('.btn-treasure-footer-back, .btn-footer-back') as HTMLElement;
          if (footerBack) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) {
              $(footerBack).trigger('touchstart');
              $(footerBack).trigger('touchend');
              $(footerBack).trigger('tap');
            }
            footerBack.dispatchEvent(new CustomEvent('tap', { bubbles: true, cancelable: true }));
            footerBack.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            if (typeof footerBack.click === 'function') footerBack.click();
          }
        }
      }, Date.now() - start).catch(() => null);

      const waveState = await this.page.evaluate((tgt: number) => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;

        // 1. Wave counter from game state
        let currentWave = 1;
        if (pJsn?.battle) {
          if (typeof pJsn.battle === 'object') {
            currentWave = Number(pJsn.battle.count ?? pJsn.battle.current ?? 1);
          } else {
            currentWave = Number(pJsn.battle);
          }
        } else if (gStatus?.battle) {
          if (typeof gStatus.battle === 'object') {
            currentWave = Number(gStatus.battle.count ?? gStatus.battle.current ?? 1);
          } else {
            currentWave = Number(gStatus.battle);
          }
        } else if (gStatus?.wave) {
          currentWave = Number(gStatus.wave);
        }

        // 2. Wave counter from DOM
        let domWave = 0;
        const battleNumEl = document.querySelector('.prt-battle-num, .prt-turn-info .prt-battle-num');
        if (battleNumEl) {
          const m = (battleNumEl.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
          if (m) domWave = parseInt(m[1], 10);
        }

        // 3. Screen text fallback for "2/2" or "2 / 2"
        let screenWave = 0;
        const bodyText = document.body ? (document.body.innerText || '') : '';
        if (/(?:wave|battle)?\s*2\s*\/\s*2/i.test(bodyText)) {
          screenWave = 2;
        }

        const effectiveWave = Math.max(currentWave, domWave, screenWave);

        // Check frontline character button visibility (all 4 characters 0 to 3)
        // Must select the character buttons (.lis-character0..3), NOT ability drawers (.prt-command-chara)
        const charElements = [0, 1, 2, 3].map(idx => {
          const el = document.querySelector(
            `.lis-character${idx}.btn-command-character, ` +
            `.lis-character${idx}, ` +
            `[pos="${idx}"].btn-command-character`
          ) as HTMLElement;
          return !!(el && el.offsetParent !== null && !el.classList.contains('invisible'));
        });
        const allCharsVisible = charElements.filter(Boolean).length >= 4;

        // Character 4 (Threo / Sarasa) specifically
        const char4El = document.querySelector(
          `.lis-character3.btn-command-character, ` +
          `.lis-character3, ` +
          `[pos="3"].btn-command-character`
        ) as HTMLElement;
        const char4Ready = !!(char4El && char4El.offsetParent !== null && !char4El.classList.contains('invisible'));

        if (effectiveWave >= tgt && char4Ready && gStatus) {
          gStatus.lock = false;
          gStatus.btn_lock = false;
          gStatus.animation = false;
        }

        const isLocked = gStatus ? (Boolean(gStatus.lock) || Boolean(gStatus.animation)) : false;
        const hasAttackBtn = !!document.querySelector('.btn-attack-start.display-on, .btn-attack-start');

        return {
          currentWave: effectiveWave,
          allCharsVisible,
          char4Ready,
          isLocked,
          hasAttackBtn,
          ready: effectiveWave >= tgt && (char4Ready || allCharsVisible)
        };
      }, targetWave).catch(() => ({ currentWave: 1, allCharsVisible: false, char4Ready: false, isLocked: true, hasAttackBtn: false, ready: false }));

      if (waveState.ready) {
        console.log(`[Combat] 🌊 Wave ${waveState.currentWave} active and character 4 / frontline fully loaded.`);
        await new Promise(r => setTimeout(r, 200));
        return true;
      }

      await new Promise(r => setTimeout(r, 100));
    }

    console.warn(`[Combat] ⚠️ Timed out waiting for Wave ${targetWave} after ${timeoutMs}ms.`);
    return false;
  }

  /**
   * Selects an enemy target index (1, 2, or 3).
   */
  public async handleTargetEnemy(step: WorkflowStep): Promise<boolean> {
    const enemyIdx = step.enemyIndex || 1;
    const selector = `.lis-enemy[pos="${enemyIdx - 1}"], .btn-enemy-${enemyIdx}, .prt-targeting[pos="${enemyIdx - 1}"]`;

    const enemyEl = await this.page.waitForSelector(selector, { visible: true, timeout: 3000 }).catch(() => null);
    if (enemyEl) {
      await humanizedClick(this.page, enemyEl);
      await logNormalDelay(150, 0.1);
      return true;
    }
    return false;
  }

  /**
   * Uses temporary potion (Green, Blue, or Elixir).
   */
  public async handleHeal(step: WorkflowStep): Promise<boolean> {
    const pType = step.potionType || 'green';
    await this.deps.combatResolution.dismissCombatDrawersAndPopups();

    const partyCheck = await this.page.evaluate(() => {
      const stage = (window as any).stage;
      const rawPlayers = stage?.gGameStatus?.player?.param || stage?.pJsnData?.player?.param;
      const players = Array.isArray(rawPlayers) ? rawPlayers : (rawPlayers ? Object.values(rawPlayers) : []);
      const frontline = players.slice(0, 4).filter((p: any) => p && Number(p.hp) > 0 && p.alive !== 0);
      if (frontline.length === 0) return { shouldHeal: false, reason: 'no_alive_frontline' };

      for (const p of frontline as any[]) {
        const debuffs = p?.condition?.debuff || [];
        const hasZombie = Array.isArray(debuffs) && debuffs.some((d: any) => {
          const st = String(d?.status || '');
          const nm = String(d?.name || '').toLowerCase();
          return st === '1263' || st === '1397' || nm.includes('zombi') || nm.includes('ゾンビ');
        });
        if (hasZombie) return { shouldHeal: false, reason: 'zombified' };
      }

      const minRatio = Math.min(...frontline.map((p: any) => {
        const max = Number(p.hpmax) || 1;
        return Number(p.hp) / max;
      }));
      if (minRatio >= 0.90) return { shouldHeal: false, reason: 'healthy' };
      return { shouldHeal: true, reason: 'damaged' };
    }).catch(() => ({ shouldHeal: true, reason: 'unknown' }));

    if (!partyCheck.shouldHeal) {
      console.log(`[Combat] Skipping ${pType} potion (${partyCheck.reason}).`);
      return true;
    }

    const tempTrayBtn = await this.page.$('.btn-temporary, .btn-item');
    if (tempTrayBtn) {
      await tempTrayBtn.evaluate((el: any) => {
        const pop = document.querySelector('.pop-temporary-item, .pop-usual.pop-show, .lis-item') as HTMLElement;
        if (pop && pop.offsetParent !== null) return;
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        else el.click();
      }).catch(() => null);
      await humanReactionDelay(180, 0.1);
    }

    const itemSelector = pType === 'green'
      ? '.lis-item.item-small:not(.disable), .lis-item[item-id="1"]:not(.disable), .btn-temporary-small:not(.disable), .btn-item-small:not(.disable)'
      : pType === 'blue'
      ? '.lis-item.item-large:not(.disable), .lis-item[item-id="2"]:not(.disable), .btn-temporary-large:not(.disable), .btn-item-all:not(.disable)'
      : '.lis-item[item-id="3"]:not(.disable), .btn-item-elixir:not(.disable)';

    const potionBtn = await this.page.waitForSelector(itemSelector, { visible: true, timeout: 1500 }).catch(() => null);
    if (potionBtn) {
      await potionBtn.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        else el.click();
      }).catch(() => null);
      await humanReactionDelay(150, 0.1);
      const okBtn = await this.page.waitForSelector('.btn-usual-ok.btn-item-use, .btn-usual-ok.se-use, #pop .btn-usual-ok, .pop-temporary-item .btn-usual-ok', { visible: true, timeout: 1200 }).catch(() => null);
      if (okBtn) {
        await okBtn.evaluate((el: any) => {
          if (el.offsetParent === null) return;
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          else el.click();
        }).catch(() => null);
      }
      await logNormalDelay(250, 0.1);
      await this.deps.combatResolution.dismissCombatDrawersAndPopups();
      return true;
    }

    await this.deps.combatResolution.dismissCombatDrawersAndPopups();
    return step.optional ? true : false;
  }

  /**
   * Sends a backup request to everyone in multi-raids.
   */
  public async handleBackupRequest(): Promise<boolean> {
    const assistBtn = await this.page.$('.btn-assist, .btn-request');
    if (assistBtn) {
      await humanizedClick(this.page, assistBtn);
      await humanReactionDelay(150, 0.1);

      const requestAllBtn = await this.page.waitForSelector('.btn-assist-all, .btn-usual-ok', { visible: true, timeout: 2000 }).catch(() => null);
      if (requestAllBtn) {
        await humanizedClick(this.page, requestAllBtn);
        await logNormalDelay(200, 0.1);
        return true;
      }
    }
    return false;
  }

  /**
   * Triggers a character skill (Character 1-4, Skill 1-4) with state-aware tray handling.
   */
  /**
   * Executes a character skill step (C{char}S{skill}).
   * Ensures the target character's ability drawer is open, waits for ongoing animations or dynamic
   * skill unlocks (e.g. Relic Buster C1S1 -> C1S2 x3), presses the skill button cleanly, verifies
   * placement in GBF's Ability Queue (.prt-ability-rail) or active cast state, and awaits server
   * confirmation (ability_result.json) without corrupting stage.gGameStatus.lock.
   */
  public async handleSkill(step: WorkflowStep): Promise<boolean> {
    (this.ctx.state as any).lastAttackReloadedAt = 0;
    const stepStart = Date.now();
    const runNum = (this.ctx.state.totalCompletedRuns || 0) + 1;
    const stepNum = this.ctx.state.activeStepNum || 1;
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const isManual = this.isManualWorkflow();
    const char = step.character || 1;
    const skill = step.skill || 1;

    if (isManual) {
      await this.deps.combatResolution.cancelFullAutoAndActionQueue();
    }

    // 0. Wave gating: if step requires a specific wave, wait until that wave mounts
    const targetWave = step.waitForWave ?? (step as any).wave;
    if (targetWave && targetWave > 1) {
      await this.deps.combatResolution.waitForWave(targetWave, isTurbo ? 6000 : 10000);
    }

    const preState = await this.stepMonitor.captureCombatSnapshot({ character: char, skill });

    if (await this.deps.combatResolution.isBattleEnded()) {
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: preState.abilityName,
        status: 'SKIPPED_BATTLE_ENDED',
        verified: true,
        attempts: 1,
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        reason: 'Battle concluded prior to skill cast'
      });
      return true;
    }

    // 1. Unified Drawer Open & Skill Readiness Poll Loop
    // Do NOT skip skills before the drawer is open or while a previous skill animation is still unlocking/resetting the button!
    const readinessTimeoutMs = isTurbo ? 6000 : 10000;
    const readinessStart = Date.now();
    let lastBackTapAt = 0;
    let lastOpenTapAt = 0;
    let idleCooldownSince = 0;
    let skillDisplayName = preState.abilityName || '';
    let baselineRailCount = 0;
    let isSkillReadyToPress = false;
    const cooldownGraceMs = step.ensureCast ? (isTurbo ? 450 : 750) : (isTurbo ? 250 : 450);

    while (Date.now() - readinessStart < readinessTimeoutMs) {
      if (this.ctx.state.stopRequested) return false;

      const now = Date.now();
      const canTapBack = now - lastBackTapAt >= (isTurbo ? 180 : 250);
      const canTapOpen = now - lastOpenTapAt >= (isTurbo ? 220 : 300);

      const pollState = await this.page.evaluate(
        (cNum: number, sNum: number, allowBackTap: boolean, allowOpenTap: boolean) => {
          const cjs = (window as any).createjs;
          if (cjs?.Tween?.tick) {
            cjs.Tween.tick(1200, false);
          }

          const stage = (window as any).stage;
          const gStatus = stage?.gGameStatus;
          const pJsn = stage?.pJsnData;
          const charPos = cNum - 1;

          // Check if battle ended
          const firstBoss = pJsn?.boss?.param?.[0] || gStatus?.boss?.param?.[0];
          const bossDead = firstBoss && firstBoss.hp !== undefined && Number(firstBoss.hp) <= 0;
          if (gStatus?.win || gStatus?.lose || pJsn?.is_clear || pJsn?.finish || pJsn?.is_defeat || bossDead) {
            return { status: 'battle_ended', name: '', recast: '', railCount: 0 };
          }

          // Check if frontline slot charPos is KO'd or empty
          const rawPlayers = gStatus?.player?.param || pJsn?.player?.param;
          const players = Array.isArray(rawPlayers) ? rawPlayers : (rawPlayers ? Object.values(rawPlayers) : []);
          if (players.length > 0) {
            const p = players[charPos] as any;
            if (!p || Number(p.hp) <= 0 || p.alive === 0) {
              return { status: 'ko', name: p?.name || '', recast: 'KO', railCount: 0 };
            }
          }
          const charPortraitEl = document.querySelector(`.lis-character${charPos}`) as HTMLElement | null;
          if (charPortraitEl && (charPortraitEl.classList?.contains('blank') || charPortraitEl.classList?.contains('empty'))) {
            return { status: 'ko', name: '', recast: 'empty', railCount: 0 };
          }

          const isVisible = (el: HTMLElement | null | undefined) =>
            !!(el && el.offsetParent !== null && (el.offsetWidth === undefined || el.offsetWidth > 0) && window.getComputedStyle(el).display !== 'none');

          const $ = (window as any).$ || (window as any).Zepto;
          const triggerTap = (el: HTMLElement) => {
            if ($) {
              $(el).trigger('tap');
            } else if (typeof el.click === 'function') {
              el.click();
            }
          };

          // Dismiss any stray non-target popup if open
          const strayCloseBtns = Array.from(
            document.querySelectorAll('.pop-usual .btn-usual-cancel, .pop-usual .btn-usual-close, .prt-popup-header .btn-close')
          ) as HTMLElement[];
          for (const btn of strayCloseBtns) {
            if (isVisible(btn)) {
              triggerTap(btn);
            }
          }

          // Check if Character cNum's ability drawer is currently open
          const slotIdx = sNum - 1;
          const specificBtn = (
            document.querySelector(`.ability-character-num-${cNum}-${sNum}`) ||
            document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability[pos="${slotIdx}"]`) ||
            document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability:nth-child(${sNum})`)
          ) as HTMLElement | null;
          const charDrawer = document.querySelector(`.prt-command-chara.chara${cNum}`) as HTMLElement | null;
          const drawerOpen = isVisible(specificBtn) || isVisible(charDrawer);

          if (!drawerOpen) {
            // Check if another character's drawer or summon tray is open (indicated by .btn-command-back.display-on)
            const backBtn = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement | null;
            const otherDrawerOpen = Array.from(document.querySelectorAll('.prt-command-chara, .prt-command-summon.summon-on')).some(
              el => !el.classList?.contains(`chara${cNum}`) && isVisible(el as HTMLElement)
            );

            if ((otherDrawerOpen || isVisible(backBtn)) && backBtn && isVisible(backBtn)) {
              if (allowBackTap) {
                triggerTap(backBtn);
                return { status: 'tapped_back', name: '', recast: '', railCount: 0 };
              }
              return { status: 'waiting_back', name: '', recast: '', railCount: 0 };
            }

            // Main command HUD: tap Character cNum's portrait to open its ability drawer
            const charBtn = document.querySelector(
              `.lis-character${charPos}.btn-command-character, .lis-character${charPos}, .prt-command-top .btn-command-character[pos="${charPos}"], .btn-command-character[pos="${charPos}"]`
            ) as HTMLElement | null;
            if (charBtn && isVisible(charBtn)) {
              if (allowOpenTap) {
                triggerTap(charBtn);
                return { status: 'tapped_open', name: '', recast: '', railCount: 0 };
              }
              return { status: 'waiting_open', name: '', recast: '', railCount: 0 };
            }

            return { status: 'waiting_hud', name: '', recast: '', railCount: 0 };
          }

          // Drawer is open! Inspect Ability Queue (.prt-ability-rail) and skill readiness
          const railDomItems = document.querySelectorAll('.prt-ability-rail .lis-ability, .prt-ability-rail .ico-ability, .prt-ability-rail [ability-id]');
          const queueArr = Array.isArray(gStatus?.ability_queue)
            ? gStatus.ability_queue
            : (Array.isArray(stage?.gAbilityQueue) ? stage.gAbilityQueue : []);
          const railCount = Math.max(railDomItems ? railDomItems.length : 0, queueArr.length);

          // GBF's Ability Queue (.prt-ability-rail) holds at most 4 queued skills at a time
          if (railCount >= 4) {
            return { status: 'rail_full', name: '', recast: '', railCount };
          }

          const abilityMap = pJsn?.ability || {};
          let charObj = abilityMap[String(cNum)] || abilityMap[String(charPos)];
          if (!charObj) {
            charObj = Object.values(abilityMap).find((o: any) => Number(o?.pos) === charPos);
          }
          const ab = charObj?.list ? charObj.list[String(sNum)] : undefined;
          const abilityData = Array.isArray(ab) ? ab[0] : ab;
          const pJsnName = abilityData?.['ability-name'] || '';
          const pJsnRecast = abilityData?.['ability-recast'] !== undefined ? String(abilityData['ability-recast']) : '';
          const pJsnReqMet = abilityData ? abilityData['requirement_result_flag'] !== false : true;

          const domEl = specificBtn;
          if (!domEl) {
            return { status: 'waiting_button', name: pJsnName, recast: pJsnRecast, railCount };
          }

          const container = ((typeof domEl.closest === 'function' ? domEl.closest('.lis-ability') : null) || domEl) as HTMLElement;
          const getAttr = (el: any, attr: string) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null);
          const querySub = (el: any, sel: string) => (el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null);

          const recastAttr =
            getAttr(container, 'ability-recast') ||
            getAttr(domEl, 'ability-recast') ||
            getAttr(querySub(container, '[ability-recast]'), 'ability-recast') ||
            pJsnRecast ||
            '';
          const abilityName =
            getAttr(container, 'ability-name') ||
            getAttr(domEl, 'ability-name') ||
            getAttr(querySub(container, '[ability-name]'), 'ability-name') ||
            pJsnName;

          const hasUnavailableClass =
            Boolean(container.classList?.contains('btn-ability-unavailable')) ||
            Boolean(container.classList?.contains('btn-ability-off')) ||
            Boolean(container.classList?.contains('tmp-unusable')) ||
            Boolean(container.classList?.contains('empty')) ||
            Boolean(container.classList?.contains('disabled')) ||
            Boolean(domEl.classList?.contains('btn-ability-unavailable')) ||
            Boolean(domEl.classList?.contains('btn-ability-off')) ||
            Boolean(domEl.classList?.contains('tmp-unusable')) ||
            Boolean(querySub(container, '.btn-ability-unavailable, .btn-ability-off, .tmp-unusable'));

          const hasAvailableClass =
            Boolean(container.classList?.contains('btn-ability-available')) ||
            Boolean(domEl.classList?.contains('btn-ability-available')) ||
            Boolean(querySub(container, '.btn-ability-available'));

          const hasPositiveRecast = recastAttr !== '' && recastAttr !== '0' && Number(recastAttr) > 0;
          const isMockDom = domEl.offsetWidth === undefined;
          const isReady = !hasUnavailableClass && !hasPositiveRecast && (hasAvailableClass || isMockDom);

          if (isReady) {
            return { status: 'ready', name: abilityName, recast: '0', railCount };
          }

          const isBusyAnimating = Boolean(
            gStatus?.lock ||
            gStatus?.btn_lock ||
            gStatus?.attacking ||
            gStatus?.ability_turn ||
            railCount > 0 ||
            (pJsnRecast === '0' && pJsnReqMet && !hasPositiveRecast)
          );

          if (isBusyAnimating || !hasPositiveRecast) {
            return { status: 'waiting_unlock', name: abilityName, recast: recastAttr || '0', railCount };
          }

          return { status: 'idle_cooldown', name: abilityName, recast: recastAttr || 'unavailable', railCount };
        },
        char,
        skill,
        canTapBack,
        canTapOpen
      ).catch(() => ({ status: 'error', name: '', recast: '', railCount: 0 }));

      if (pollState.name) {
        skillDisplayName = pollState.name;
      }

      if (pollState.status === 'battle_ended') {
        this.stepMonitor.recordStepReceipt({
          runNumber: runNum,
          stepNumber: stepNum,
          step,
          dynamicName: skillDisplayName,
          status: 'SKIPPED_BATTLE_ENDED',
          verified: true,
          attempts: 1,
          durationMs: Date.now() - stepStart,
          preState,
          networkConfirmed: false,
          stateMutated: false,
          reason: 'Battle ended while opening drawer'
        });
        return true;
      }

      if (pollState.status === 'ko') {
        console.log(`[Combat] Character C${char} is KO'd or slot empty. Skipping C${char}S${skill}.`);
        this.stepMonitor.recordStepReceipt({
          runNumber: runNum,
          stepNumber: stepNum,
          step,
          dynamicName: skillDisplayName,
          status: 'SKIPPED_KO',
          verified: true,
          attempts: 1,
          durationMs: Date.now() - stepStart,
          preState,
          networkConfirmed: false,
          stateMutated: false,
          reason: `Character C${char} KO or slot empty`
        });
        return true;
      }

      if (pollState.status === 'tapped_back') {
        lastBackTapAt = Date.now();
        idleCooldownSince = 0;
      } else if (pollState.status === 'tapped_open') {
        lastOpenTapAt = Date.now();
        idleCooldownSince = 0;
      } else if (pollState.status === 'ready') {
        baselineRailCount = pollState.railCount;
        isSkillReadyToPress = true;
        break;
      } else if (pollState.status === 'idle_cooldown') {
        if (idleCooldownSince === 0) {
          idleCooldownSince = Date.now();
        } else if (Date.now() - idleCooldownSince >= cooldownGraceMs) {
          console.log(`[Combat] Skill C${char}S${skill}${skillDisplayName ? ` ("${skillDisplayName}")` : ''} is on cooldown (${pollState.recast} turns left). Skipping.`);
          this.stepMonitor.recordStepReceipt({
            runNumber: runNum,
            stepNumber: stepNum,
            step,
            dynamicName: skillDisplayName,
            status: 'SKIPPED_COOLDOWN',
            verified: true,
            attempts: 1,
            durationMs: Date.now() - stepStart,
            preState,
            networkConfirmed: false,
            stateMutated: false,
            recastTransition: `${pollState.recast}->${pollState.recast}`,
            reason: `Skill on cooldown (${pollState.recast} turns left)`
          });
          return true;
        }
      } else {
        idleCooldownSince = 0;
      }

      await new Promise(r => setTimeout(r, isTurbo ? 35 : 55));
    }

    if (!isSkillReadyToPress) {
      console.warn(`[Combat] Timed out waiting for C${char}S${skill} drawer/button readiness after ${readinessTimeoutMs}ms.`);
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: skillDisplayName,
        status: step.optional ? 'SKIPPED_OPTIONAL' : 'FAILED_TIMEOUT',
        verified: Boolean(step.optional),
        attempts: 1,
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        reason: `Timed out waiting for drawer/button readiness (${readinessTimeoutMs}ms)`
      });
      return step.optional ? true : false;
    }

    // 2. Closed-Loop Enforced Skill Press + Target Selection + Queue (.prt-ability-rail) & Cast (ability_result.json) Verification
    const targetNet = step.waitForNetwork || 'ability_result.json';
    let netResolved = false;
    let netJson: any = null;
    let netPopupLockout = false;
    let netPromise: Promise<{ resolved: boolean; json: any | null; isPopupLockout?: boolean }>;

    const armNetworkListener = (timeoutMs: number) => {
      netPopupLockout = false;
      netPromise = this.deps.combatResolution
        .waitForNetworkResponseAndPayload(targetNet, timeoutMs)
        .then(res => {
          if (res.isPopupLockout) {
            netPopupLockout = true;
          } else if (res.resolved) {
            netResolved = true;
            netJson = res.json;
          }
          return res;
        });
    };

    armNetworkListener(isTurbo ? 7500 : 12000);

    const maxPressAttempts = step.retries || (step.ensureCast ? 4 : 3);
    let pressConfirmedInQueueOrCast = false;
    let totalAttemptsUsed = 0;
    let lastAbilityId = preState.abilityId || '';

    for (let pressAttempt = 1; pressAttempt <= maxPressAttempts; pressAttempt++) {
      if (this.ctx.state.stopRequested) return false;
      if (netResolved) {
        pressConfirmedInQueueOrCast = true;
        break;
      }

      totalAttemptsUsed = pressAttempt;

      // If previous attempt encountered a server lockout popup, dismiss it and re-arm network listener
      if (netPopupLockout) {
        console.log(`[Enforcer] 🔄 Server lockout popup intercepted on C${char}S${skill} (attempt ${pressAttempt}); dismissing & re-arming...`);
        await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
        await new Promise(r => setTimeout(r, isTurbo ? 120 : 220));
        armNetworkListener(isTurbo ? 7500 : 12000);
      }

      // Ensure C{char}'s drawer is still open before pressing on retry attempts
      if (pressAttempt > 1) {
        await this.page.evaluate((cNum: number, sNum: number) => {
          const isVisible = (el: HTMLElement | null | undefined) =>
            !!(el && el.offsetParent !== null && (el.offsetWidth === undefined || el.offsetWidth > 0) && window.getComputedStyle(el).display !== 'none');
          const specificBtn = document.querySelector(`.ability-character-num-${cNum}-${sNum}`) as HTMLElement | null;
          if (isVisible(specificBtn)) return;
          const charPos = cNum - 1;
          const charBtn = document.querySelector(`.lis-character${charPos}.btn-command-character, .lis-character${charPos}`) as HTMLElement | null;
          if (charBtn && isVisible(charBtn)) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(charBtn).trigger('tap');
            else charBtn.click();
          }
        }, char, skill).catch(() => null);
        await new Promise(r => setTimeout(r, isTurbo ? 80 : 140));
      }

      // Dispatch a SINGLE clean tap on the skill button (avoiding multi-tap bubbling spam)
      const pressResult = await this.page.evaluate((cNum: number, sNum: number) => {
        const slotIdx = sNum - 1;
        const specificEl = document.querySelector(`.ability-character-num-${cNum}-${sNum}`) as HTMLElement | null;
        const listEl = (
          document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability[pos="${slotIdx}"]`) ||
          document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability:nth-child(${sNum})`)
        ) as HTMLElement | null;
        const rawTarget = specificEl || listEl;
        if (!rawTarget || rawTarget.offsetParent === null) return { clicked: false, abilityId: '' };

        const container = ((typeof rawTarget.closest === 'function' ? rawTarget.closest('.lis-ability') : null) || rawTarget) as HTMLElement;
        const subAvail = typeof container.querySelector === 'function' ? (container.querySelector('.btn-ability-available') as HTMLElement | null) : null;
        const btn = subAvail || container;
        const abilityId =
          (typeof container.getAttribute === 'function' ? container.getAttribute('ability-id') : null) ||
          (typeof rawTarget.getAttribute === 'function' ? rawTarget.getAttribute('ability-id') : null) ||
          '';

        const $ = (window as any).$ || (window as any).Zepto;
        if ($) {
          $(btn).trigger('tap');
        } else if (typeof btn.click === 'function') {
          btn.click();
        }
        return { clicked: true, abilityId: abilityId || '' };
      }, char, skill).catch(() => ({ clicked: false, abilityId: '' }));

      if (pressResult.abilityId) {
        lastAbilityId = pressResult.abilityId;
      }

      if (!pressResult.clicked) {
        const fallbackHandle = await this.page.$(`.ability-character-num-${char}-${skill}, .prt-command-chara.chara${char} .prt-ability-list .lis-ability[pos="${skill - 1}"]`).catch(() => null);
        if (fallbackHandle) {
          await humanizedClick(this.page, fallbackHandle).catch(() => null);
        }
      }

      // Handle ability confirmation modal if Skill Confirmation popup is enabled in GBF settings
      await this.page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.btn-ability-use, .btn-usual-ok.se-ability-use') as HTMLElement | null;
        if (ok && ok.offsetParent !== null && window.getComputedStyle(ok).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          else ok.click();
        }
      }).catch(() => null);

      // Handle single-target character selection modal (e.g. C2S1 -> C1) strictly inside the popup container
      if (step.targetCharacter) {
        const targetIdx = step.targetCharacter - 1;
        const popupStart = Date.now();
        const popupDeadline = popupStart + (isTurbo ? 1800 : 2800);
        let targetSelected = false;
        let retappedSkillForPopup = false;

        while (Date.now() < popupDeadline && !netResolved) {
          const shouldRetapSkill = !retappedSkillForPopup && (Date.now() - popupStart >= (isTurbo ? 450 : 700));
          targetSelected = await this.page.evaluate((cNum: number, sNum: number, tIdx: number, retapSkill: boolean) => {
            const cjs = (window as any).createjs;
            if (cjs?.Tween?.tick) cjs.Tween.tick(800, false);

            const popups = Array.from(
              document.querySelectorAll('.pop-usual, .pop-select-member, .prt-popup-body, .pop-target, #pop')
            ) as HTMLElement[];
            for (const pop of popups) {
              if (!pop || pop.offsetParent === null || (pop.offsetWidth !== undefined && pop.offsetWidth <= 0) || window.getComputedStyle(pop).display === 'none') {
                continue;
              }
              const targetChar = (
                pop.querySelector(`.lis-character${tIdx}`) ||
                pop.querySelector(`.btn-command-character[pos="${tIdx}"]`) ||
                pop.querySelector(`[pos="${tIdx}"]`)
              ) as HTMLElement | null;
              if (targetChar && targetChar.offsetParent !== null) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) {
                  $(targetChar).trigger('tap');
                } else if (typeof targetChar.click === 'function') {
                  targetChar.click();
                }
                return true;
              }
            }

            if (retapSkill) {
              const specificEl = document.querySelector(`.ability-character-num-${cNum}-${sNum}`) as HTMLElement | null;
              if (specificEl && specificEl.offsetParent !== null) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(specificEl).trigger('tap');
                else specificEl.click();
              }
            }
            return false;
          }, char, skill, targetIdx, shouldRetapSkill).catch(() => false);

          if (shouldRetapSkill) {
            retappedSkillForPopup = true;
          }

          if (targetSelected) {
            await new Promise(r => setTimeout(r, isTurbo ? 60 : 110));
            break;
          }
          await new Promise(r => setTimeout(r, 45));
        }
      }

      // Poll up to 650ms to confirm the skill is listed in the Ability Queue (.prt-ability-rail) or actively casting
      const verifyDeadline = Date.now() + (isTurbo ? 450 : 650);
      while (Date.now() < verifyDeadline) {
        if (netResolved) {
          pressConfirmedInQueueOrCast = true;
          break;
        }
        if (netPopupLockout) {
          break;
        }

        const queueCheck = await this.page.evaluate(
          (cNum: number, sNum: number, prevRailCount: number, abId: string) => {
            const cjs = (window as any).createjs;
            if (cjs?.Tween?.tick) cjs.Tween.tick(800, false);

            const stage = (window as any).stage;
            const gStatus = stage?.gGameStatus;

            // 1. Check Ability Queue (.prt-ability-rail / stage.gGameStatus.ability_queue)
            const railDomItems = Array.from(
              document.querySelectorAll('.prt-ability-rail .lis-ability, .prt-ability-rail .ico-ability, .prt-ability-rail [ability-id]')
            ) as HTMLElement[];
            const queueArr = Array.isArray(gStatus?.ability_queue)
              ? gStatus.ability_queue
              : (Array.isArray(stage?.gAbilityQueue) ? stage.gAbilityQueue : []);
            const currentRailCount = Math.max(railDomItems.length, queueArr.length);
            const inRailById = Boolean(
              abId &&
              (railDomItems.some(el => typeof el.getAttribute === 'function' && el.getAttribute('ability-id') === abId) ||
               queueArr.some((item: any) => String(item?.ability_id || item?.id || '') === abId))
            );
            const railIncreased = currentRailCount > prevRailCount;

            // 2. Check if the skill button transitioned to .tmp-unusable / .btn-ability-unavailable / recast > 0
            const slotIdx = sNum - 1;
            const domEl = (
              document.querySelector(`.ability-character-num-${cNum}-${sNum}`) ||
              document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability[pos="${slotIdx}"]`)
            ) as HTMLElement | null;
            let buttonMarkedUsedOrQueued = false;
            if (domEl) {
              const container = ((typeof domEl.closest === 'function' ? domEl.closest('.lis-ability') : null) || domEl) as HTMLElement;
              const getAttr = (el: any, attr: string) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null);
              const querySub = (el: any, sel: string) => (el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null);
              const recastAttr =
                getAttr(container, 'ability-recast') ||
                getAttr(domEl, 'ability-recast') ||
                getAttr(querySub(container, '[ability-recast]'), 'ability-recast') ||
                '';
              buttonMarkedUsedOrQueued =
                Boolean(container.classList?.contains('tmp-unusable')) ||
                Boolean(container.classList?.contains('btn-ability-unavailable')) ||
                Boolean(domEl.classList?.contains('tmp-unusable')) ||
                Boolean(domEl.classList?.contains('btn-ability-unavailable')) ||
                Boolean(querySub(container, '.tmp-unusable, .btn-ability-unavailable')) ||
                (recastAttr !== '' && recastAttr !== '0');
            }

            return {
              confirmed: inRailById || railIncreased || buttonMarkedUsedOrQueued,
              inRail: inRailById || railIncreased,
              currentRailCount
            };
          },
          char,
          skill,
          baselineRailCount,
          lastAbilityId
        ).catch(() => ({ confirmed: false, inRail: false, currentRailCount: 0 }));

        if (queueCheck.confirmed) {
          pressConfirmedInQueueOrCast = true;
          break;
        }

        await new Promise(r => setTimeout(r, 45));
      }

      if ((pressConfirmedInQueueOrCast || netResolved) && !netPopupLockout) {
        break;
      }

      console.warn(`[Combat] Skill C${char}S${skill} press attempt ${pressAttempt}/${maxPressAttempts} not yet confirmed in queue; re-pressing...`);
    }

    // 3. Await this skill's ability_result.json (or authoritative in-game state mutation) while ticking CreateJS animations
    let lastReTapAt = Date.now();
    const waitNetStart = Date.now();
    const maxNetWaitMs = isTurbo ? 7500 : 12000;
    let stateMutatedToCooldown = false;

    while (!netResolved && Date.now() - waitNetStart < maxNetWaitMs) {
      if (this.ctx.state.stopRequested) return false;
      if (await this.deps.combatResolution.isBattleEnded()) {
        this.stepMonitor.recordStepReceipt({
          runNumber: runNum,
          stepNumber: stepNum,
          step,
          dynamicName: skillDisplayName,
          status: 'SKIPPED_BATTLE_ENDED',
          verified: true,
          attempts: Math.max(1, totalAttemptsUsed),
          durationMs: Date.now() - stepStart,
          preState,
          networkConfirmed: false,
          stateMutated: true,
          reason: 'Battle concluded during skill resolution'
        });
        return true;
      }

      // If a server lockout popup interrupted the skill cast, dismiss it, re-arm listener, and force an immediate re-tap
      if (netPopupLockout) {
        console.log(`[Enforcer] 🔄 Server lockout popup detected while awaiting C${char}S${skill}; dismissing & re-casting...`);
        await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
        await new Promise(r => setTimeout(r, isTurbo ? 100 : 180));
        armNetworkListener(Math.max(2500, maxNetWaitMs - (Date.now() - waitNetStart)));
        lastReTapAt = 0;
        totalAttemptsUsed++;
      }

      const needsReTap = Date.now() - lastReTapAt >= 1200;
      const tickState = await this.page.evaluate(
        (cNum: number, sNum: number, tChar: number | undefined, allowReTap: boolean) => {
          const cjs = (window as any).createjs;
          if (cjs?.Tween?.tick) {
            cjs.Tween.tick(1500, false);
          }

          const $ = (window as any).$ || (window as any).Zepto;
          const triggerTap = (el: HTMLElement) => {
            if ($) $(el).trigger('tap');
            else if (typeof el.click === 'function') el.click();
          };

          // If target selection popup is still open for a targeted skill, tap the target character
          if (tChar) {
            const tIdx = tChar - 1;
            const popups = Array.from(
              document.querySelectorAll('.pop-usual, .pop-select-member, .prt-popup-body, .pop-target, #pop')
            ) as HTMLElement[];
            for (const pop of popups) {
              if (!pop || pop.offsetParent === null || (pop.offsetWidth !== undefined && pop.offsetWidth <= 0) || window.getComputedStyle(pop).display === 'none') {
                continue;
              }
              const targetEl = (
                pop.querySelector(`.lis-character${tIdx}`) ||
                pop.querySelector(`.btn-command-character[pos="${tIdx}"]`) ||
                pop.querySelector(`[pos="${tIdx}"]`)
              ) as HTMLElement | null;
              if (targetEl && targetEl.offsetParent !== null) {
                triggerTap(targetEl);
                return { reTapped: true, transitionedToCooldown: false };
              }
            }
          }

          const stage = (window as any).stage;
          const gStatus = stage?.gGameStatus;
          const pJsn = stage?.pJsnData;
          const railItems = document.querySelectorAll('.prt-ability-rail .lis-ability, .prt-ability-rail .ico-ability, .prt-ability-rail [ability-id]');
          const queueArr = Array.isArray(gStatus?.ability_queue) ? gStatus.ability_queue : [];
          const railCount = Math.max(railItems ? railItems.length : 0, queueArr.length);

          // Check if the skill's recast in pJsnData or DOM has already transitioned from 0 -> >0
          const charPos = cNum - 1;
          const abilityMap = pJsn?.ability || {};
          let charObj = abilityMap[String(cNum)] || abilityMap[String(charPos)];
          if (!charObj) {
            charObj = Object.values(abilityMap).find((o: any) => Number(o?.pos) === charPos);
          }
          const ab = charObj?.list ? charObj.list[String(sNum)] : undefined;
          const abilityData = Array.isArray(ab) ? ab[0] : ab;
          const pJsnRecast = abilityData?.['ability-recast'] !== undefined ? String(abilityData['ability-recast']) : '';

          const domEl = document.querySelector(`.ability-character-num-${cNum}-${sNum}`) as HTMLElement | null;
          let domRecast = '';
          if (domEl) {
            const container = ((typeof domEl.closest === 'function' ? domEl.closest('.lis-ability') : null) || domEl) as HTMLElement;
            const getAttr = (el: any, attr: string) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null);
            const querySub = (el: any, sel: string) => (el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null);
            domRecast =
              getAttr(container, 'ability-recast') ||
              getAttr(domEl, 'ability-recast') ||
              getAttr(querySub(container, '[ability-recast]'), 'ability-recast') ||
              '';
          }

          const effectiveRecast = domRecast || pJsnRecast;
          if (
            railCount === 0 &&
            !gStatus?.lock &&
            !gStatus?.btn_lock &&
            effectiveRecast !== '' &&
            effectiveRecast !== '0' &&
            Number(effectiveRecast) > 0
          ) {
            return { reTapped: false, transitionedToCooldown: true };
          }

          // If the ability queue drained completely and the skill button is still .btn-ability-available, re-tap it
          if (allowReTap && railCount === 0 && !gStatus?.lock && !gStatus?.btn_lock) {
            if (domEl && domEl.offsetParent !== null) {
              const container = ((typeof domEl.closest === 'function' ? domEl.closest('.lis-ability') : null) || domEl) as HTMLElement;
              const isAvail =
                Boolean(container.classList?.contains('btn-ability-available')) &&
                !container.classList?.contains('btn-ability-unavailable') &&
                !container.classList?.contains('tmp-unusable');
              if (isAvail) {
                const subAvail = typeof container.querySelector === 'function' ? (container.querySelector('.btn-ability-available') as HTMLElement | null) : null;
                triggerTap(subAvail || container);
                return { reTapped: true, transitionedToCooldown: false };
              }
            }
          }

          return { reTapped: false, transitionedToCooldown: false };
        },
        char,
        skill,
        step.targetCharacter,
        needsReTap
      ).catch(() => ({ reTapped: false, transitionedToCooldown: false }));

      if (tickState.transitionedToCooldown) {
        stateMutatedToCooldown = true;
        break;
      }

      if (tickState.reTapped) {
        lastReTapAt = Date.now();
        totalAttemptsUsed++;
      }

      if (netResolved) break;
      await new Promise(r => setTimeout(r, isTurbo ? 40 : 65));
    }

    const netRes = netResolved
      ? { resolved: true, json: netJson }
      : stateMutatedToCooldown
      ? { resolved: false, json: null }
      : await netPromise!;

    if (netRes.resolved || stateMutatedToCooldown) {
      let skillDmg = 0;
      let skillHonors = 0;
      if (netRes.json) {
        skillDmg = CombatResolutionService.extractTurnDamage(netRes.json);
        if (skillDmg > 0 && !this.isSoloQuest()) {
          skillHonors = Math.floor(skillDmg / 100);
          this.ctx.state.currentScore += skillHonors;
        }
      }

      console.log(
        `[Combat] ⚡ Cast Skill C${char}S${skill}${step.targetCharacter ? ` -> C${step.targetCharacter}` : ''}${skillDisplayName ? ` ("${skillDisplayName}")` : ''}${step.ensureCast ? ' (Verified)' : ''}`
      );

      // 4. Advance CreateJS tweens naturally (WITHOUT forcing stage.gGameStatus.lock = false)
      // so chained animations (e.g. C1S1 Engage unlocking C1S2, or C1S2 Blitz Raid attack) settle cleanly.
      const hasAttackScenario = Array.isArray(netRes.json?.scenario) && netRes.json.scenario.some((ev: any) => ev && ev.cmd === 'attack');
      const settleTimeoutMs = (hasAttackScenario || (step.delayAfterMs && step.delayAfterMs >= 1000))
        ? (isTurbo ? 2200 : 3500)
        : (isTurbo ? 600 : 1200);
      const settleStart = Date.now();

      while (Date.now() - settleStart < settleTimeoutMs) {
        const settled = await this.page.evaluate(() => {
          const cjs = (window as any).createjs;
          if (cjs?.Tween?.tick) {
            cjs.Tween.tick(1500, false);
          }
          const stage = (window as any).stage;
          const pJsn = stage?.pJsnData;
          const gStatus = stage?.gGameStatus;
          const isDefeated = gStatus?.win || pJsn?.is_clear || pJsn?.finish;
          const firstBoss = pJsn?.boss?.param?.[0] || gStatus?.boss?.param?.[0];
          const bossDead = firstBoss && firstBoss.hp !== undefined && Number(firstBoss.hp) <= 0;
          const inputUnlocked = !gStatus?.lock && !gStatus?.btn_lock && !gStatus?.attacking && !gStatus?.ability_turn;
          return Boolean(isDefeated || bossDead || inputUnlocked);
        }).catch(() => true);

        if (settled) break;
        await new Promise(r => setTimeout(r, 45));
      }

      const postState = await this.stepMonitor.captureCombatSnapshot({ character: char, skill });
      const recastBefore = preState.recast || '0';
      const recastAfter = postState.recast || (stateMutatedToCooldown ? 'cd' : '0');

      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: skillDisplayName || postState.abilityName,
        status: netRes.resolved ? 'CONFIRMED_NETWORK' : 'CONFIRMED_STATE_MUTATION',
        verified: true,
        attempts: Math.max(1, totalAttemptsUsed),
        durationMs: Date.now() - stepStart,
        damageDealt: skillDmg,
        honorsGained: skillHonors,
        preState,
        postState,
        networkConfirmed: netRes.resolved,
        stateMutated: recastAfter !== recastBefore || stateMutatedToCooldown || skillDmg > 0,
        recastTransition: `${recastBefore}->${recastAfter}`
      });

      await this.deps.combatResolution.getAndLogEnemyHp(`C${char}S${skill} Cast`);
      return true;
    }

    if (step.optional) {
      console.log(`[Combat] Optional skill C${char}S${skill} skipped.`);
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: skillDisplayName,
        status: 'SKIPPED_OPTIONAL',
        verified: true,
        attempts: Math.max(1, totalAttemptsUsed),
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        reason: 'Optional skill unconfirmed after timeout'
      });
      return true;
    }

    console.warn(`[Combat] ❌ Skill C${char}S${skill} failed to confirm ability_result.json within timeout.`);
    this.stepMonitor.recordStepReceipt({
      runNumber: runNum,
      stepNumber: stepNum,
      step,
      dynamicName: skillDisplayName,
      status: 'FAILED_TIMEOUT',
      verified: false,
      attempts: Math.max(1, totalAttemptsUsed),
      durationMs: Date.now() - stepStart,
      preState,
      networkConfirmed: false,
      stateMutated: false,
      reason: 'Failed to confirm ability_result.json or cooldown state mutation'
    });
    return false;
  }

  /**
   * Uses a summon card from the summon tray.
   */
  public async handleSummon(step: WorkflowStep): Promise<boolean> {
    const stepStart = Date.now();
    const runNum = (this.ctx.state.totalCompletedRuns || 0) + 1;
    const stepNum = this.ctx.state.activeStepNum || 1;
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    let slot = (step as any).summonSlot || step.slot || 1;
    const targetName = ((step as any).summonName || '').toLowerCase().trim();

    // 1. Dismiss any open ability drawers or popups so summon controls are active
    await this.deps.combatResolution.dismissCombatDrawersAndPopups();
    await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 800 : 2500);
    const preState = await this.stepMonitor.captureCombatSnapshot({ summonSlot: slot });

    if (await this.deps.combatResolution.isBattleEnded()) {
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: preState.abilityName,
        status: 'SKIPPED_BATTLE_ENDED',
        verified: true,
        attempts: 1,
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        reason: 'Battle ended prior to summon invocation'
      });
      return true;
    }

    // Fast O(1) JavaScript game state & DOM inspection for summon readiness
    const jsSummonCheck = await this.page.evaluate((targetSlot: number, targetNameStr: string) => {
      const stage = (window as any).stage;
      const gStatus = stage?.gGameStatus;
      if (gStatus && (gStatus.summon_enable === 0 || gStatus.summon_enable === false)) {
        return { found: true, isReady: false, recast: 'turn_limit', name: '', resolvedSlot: targetSlot };
      }
      const summonBtn = document.querySelector('.btn-command-summon') as HTMLElement;
      if (summonBtn && summonBtn.classList.contains(' summon-off')) {
        return { found: true, isReady: false, recast: 'turn_limit', name: '', resolvedSlot: targetSlot };
      }
      const rawSummons = gStatus?.summon || stage?.pJsnData?.summon;
      let resolvedSlot = targetSlot;
      if (rawSummons) {
        const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);
        if (targetNameStr) {
          const matchIdx = summonsList.findIndex((s: any) => {
            if (!s) return false;
            const name = String(s.name || '').toLowerCase();
            const id = String(s.id || '');
            return name.includes(targetNameStr) || id.includes(targetNameStr);
          });
          if (matchIdx !== -1) resolvedSlot = matchIdx + 1;
        }

        const sIdx = resolvedSlot - 1;
        const s: any = (resolvedSlot === 6 && (gStatus?.supporter || stage?.pJsnData?.supporter))
          ? (gStatus?.supporter || stage?.pJsnData?.supporter)
          : (summonsList.find((item: any) => Number(item?.pos) === resolvedSlot) || summonsList[sIdx]);
        if (s) {
          const recast = String(s.recast ?? '');
          const isReady = (recast === '0' || recast === '') && s.available_flag !== 0 && s.available_flag !== false;
          return { found: true, isReady, recast, name: s.name || '', resolvedSlot };
        }
      }

      // Fallback O(1) DOM attribute check (works even while summon tray is closed; GBF .lis-summon uses 1-based pos="1..6")
      const domEl = (document.querySelector(`.lis-summon[pos="${resolvedSlot}"]`) || document.querySelector(`.lis-summon:nth-child(${resolvedSlot})`)) as HTMLElement;
      if (domEl) {
        const recastAttr = domEl.getAttribute('summon-recast') || domEl.getAttribute('recast') || '';
        const summonName = domEl.getAttribute('summon-name') || '';
        const isUnavailable =
          domEl.classList.contains('btn-summon-unavailable') ||
          domEl.classList.contains('off') ||
          domEl.classList.contains('disabled') ||
          (recastAttr !== '' && recastAttr !== '0');
        const isAvailable = domEl.classList.contains('btn-summon-available') || domEl.classList.contains('on');
        if (isUnavailable && !isAvailable) {
          return { found: true, isReady: false, recast: recastAttr || 'unavailable', name: summonName, resolvedSlot };
        }
      }

      return { found: false, isReady: null, recast: '', name: '', resolvedSlot: targetSlot };
    }, slot, targetName).catch(() => ({ found: false, isReady: null, recast: '', name: '', resolvedSlot: slot }));

    if (jsSummonCheck.resolvedSlot && jsSummonCheck.resolvedSlot !== slot) {
      slot = jsSummonCheck.resolvedSlot;
      console.log(`[Workflow] Resolved summon "${targetName}" to slot ${slot}`);
    }

    const summonDisplayName = jsSummonCheck.name || preState.abilityName || '';

    if (jsSummonCheck.found && jsSummonCheck.isReady === false) {
      console.log(`[Combat] Summon slot ${slot}${summonDisplayName ? ` ("${summonDisplayName}")` : ''} is on cooldown (${jsSummonCheck.recast} turns left). Skipping.`);
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: summonDisplayName,
        status: 'SKIPPED_COOLDOWN',
        verified: true,
        attempts: 1,
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        recastTransition: `${jsSummonCheck.recast}->${jsSummonCheck.recast}`,
        reason: `Summon on cooldown (${jsSummonCheck.recast} turns left)`
      });
      return true;
    }

    const maxSummonAttempts = step.retries || (step.ensureCast ? 3 : 2);
    for (let summonAttempt = 1; summonAttempt <= maxSummonAttempts; summonAttempt++) {
      if (this.ctx.state.stopRequested) return false;

      if (summonAttempt > 1) {
        await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
        await this.deps.combatResolution.dismissCombatDrawersAndPopups();
      }

      // 2. Open summon tray if not already open
      let isSummonOpen = await this.page.evaluate((targetSlot: number) => {
        const slotEl = (document.querySelector(`.lis-summon[pos="${targetSlot}"]`) || document.querySelector('.lis-summon')) as HTMLElement;
        const tray = document.querySelector('.prt-command-summon') as HTMLElement;
        const trayVisible = !!(tray && tray.classList.contains('summon-on') && tray.offsetParent !== null);
        return trayVisible || !!(slotEl && slotEl.offsetParent !== null && slotEl.offsetWidth > 0);
      }, slot).catch(() => false);

      if (!isSummonOpen) {
        for (let openTry = 1; openTry <= 3 && !isSummonOpen; openTry++) {
          const hadOpenDrawer = await this.page.evaluate(() => {
            const tray = document.querySelector('.prt-command-summon') as HTMLElement;
            if (tray && tray.classList.contains('summon-on') && tray.offsetParent !== null) return false;
            const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
            if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(back).trigger('tap');
              else back.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (hadOpenDrawer) {
            await new Promise(r => setTimeout(r, isTurbo ? 90 : 160));
          }

          const summonTrayBtn = await this.page.waitForSelector('.prt-list-top.btn-command-summon:not(.summon-on), .btn-command-summon', { visible: true, timeout: isTurbo ? 500 : 900 }).catch(() => null);
          if (summonTrayBtn) {
            await humanizedClick(this.page, summonTrayBtn).catch(() => null);
            await new Promise(r => setTimeout(r, isTurbo ? 120 : 200));
            await summonTrayBtn.evaluate((el: any) => {
              const tray = document.querySelector('.prt-command-summon') as HTMLElement;
              const slotEl = document.querySelector('.lis-summon') as HTMLElement;
              if ((tray && tray.classList.contains('summon-on')) || (slotEl && slotEl.offsetParent !== null && slotEl.offsetWidth > 0)) return;
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(el).trigger('tap');
              else el.click();
            }).catch(() => null);
          }

          isSummonOpen = await this.page.waitForFunction((targetSlot: number) => {
            const slotEl = (document.querySelector(`.lis-summon[pos="${targetSlot}"]`) || document.querySelector('.lis-summon')) as HTMLElement;
            const tray = document.querySelector('.prt-command-summon') as HTMLElement;
            return !!(slotEl && slotEl.offsetParent !== null && slotEl.offsetWidth > 0) || !!(tray && tray.classList.contains('summon-on'));
          }, { timeout: isTurbo ? 700 : 1200 }, slot).then(() => true).catch(() => false);
        }
      }

      // 3. Locate target summon slot button (in GBF .prt-summon-list, pos is 1-indexed: slot 1..5 is pos="1..5", slot 6 is supporter)
      const combinedSummonSelector = slot === 6
        ? `.lis-summon.supporter, .lis-summon[pos="6"], .lis-summon[pos="supporter"], .btn-summon-use[pos="6"], .lis-summon:nth-child(6), .lis-summon.summon-6`
        : `.lis-summon[pos="${slot}"], .btn-summon-use[pos="${slot}"], .lis-summon:nth-child(${slot}), .lis-summon.summon-${slot}`;

      let summonSlot: any = await this.page.waitForSelector(combinedSummonSelector, { visible: true, timeout: isTurbo ? 900 : 1800 }).catch(() => null);
      if (!summonSlot) {
        const allSummonCards = await this.page.$$('.prt-summon-list .lis-summon, .lis-summon').catch(() => []);
        if (allSummonCards.length >= slot) {
          summonSlot = allSummonCards[slot - 1];
        }
      }

      if (summonSlot) {
        const isUnavailable = await summonSlot.evaluate((el: any) => {
          const recastAttr = el.getAttribute('summon-recast') || el.getAttribute('recast') || '';
          return el.classList.contains('btn-summon-unavailable') ||
                 el.classList.contains('off') ||
                 el.classList.contains('disabled') ||
                 (recastAttr !== '' && recastAttr !== '0');
        }).catch(() => false);

        if (isUnavailable) {
          console.log(`[Combat] Summon slot ${slot} is on cooldown or unavailable. Skipping.`);
          await this.deps.combatResolution.dismissCombatDrawersAndPopups();
          this.stepMonitor.recordStepReceipt({
            runNumber: runNum,
            stepNumber: stepNum,
            step,
            dynamicName: summonDisplayName,
            status: 'SKIPPED_COOLDOWN',
            verified: true,
            attempts: summonAttempt,
            durationMs: Date.now() - stepStart,
            preState,
            networkConfirmed: false,
            stateMutated: false,
            reason: `Summon slot ${slot} unavailable in tray`
          });
          return true;
        }

        const targetNet = step.waitForNetwork || 'summon_result.json';
        const netPromise = this.deps.combatResolution.waitForNetworkResponseAndPayload(targetNet, isTurbo ? 2500 : 4500);

        await humanizedClick(this.page, summonSlot).catch(() => null);
        await new Promise(r => setTimeout(r, isTurbo ? 140 : 220));
        await summonSlot.evaluate((el: any) => {
          const pop = document.querySelector('.pop-summon-detail, .pop-usual.pop-show, #pop .btn-usual-ok') as HTMLElement;
          if (pop && pop.offsetParent !== null) return;
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          else el.click();
        }).catch(() => null);

        // 4. Click Call confirmation button inside the summon detail popup (never bare .btn-summon-use which matches tray cards)
        const okBtn = await this.page.waitForSelector(
          '.btn-usual-ok.btn-summon-use, .pop-summon-detail .btn-usual-ok, .pop-usual.pop-show .btn-usual-ok, #pop .btn-usual-ok, .btn-call, .se-summon-call',
          { visible: true, timeout: isTurbo ? 1200 : 2500 }
        ).catch(() => null);

        if (okBtn) {
          await humanizedClick(this.page, okBtn).catch(() => null);
          await new Promise(r => setTimeout(r, isTurbo ? 100 : 180));
          await okBtn.evaluate((el: any) => {
            if (el.offsetParent === null) return;
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(el).trigger('tap');
            else el.click();
          }).catch(() => null);
        } else {
          await this.deps.combatResolution.dismissCombatDrawersAndPopups();
          if (summonAttempt < maxSummonAttempts) {
            console.warn(`[Enforcer] Summon slot ${slot} detail popup did not open on attempt ${summonAttempt}/${maxSummonAttempts}; retrying...`);
            continue;
          }
          if (step.optional) {
            console.log(`[Combat] Optional summon slot ${slot} popup did not open; skipping.`);
            this.stepMonitor.recordStepReceipt({
              runNumber: runNum,
              stepNumber: stepNum,
              step,
              dynamicName: summonDisplayName,
              status: 'SKIPPED_OPTIONAL',
              verified: true,
              attempts: summonAttempt,
              durationMs: Date.now() - stepStart,
              preState,
              networkConfirmed: false,
              stateMutated: false,
              reason: 'Optional summon popup did not open'
            });
            return true;
          }
          return false;
        }

        console.log(`[Combat] 🔮 Invoked Summon Slot ${slot}. Awaiting resolution...`);
        const netRes = await netPromise;

        if (netRes.isPopupLockout && summonAttempt < maxSummonAttempts) {
          console.warn(`[Enforcer] 🔄 Server lockout popup on Summon Slot ${slot} (attempt ${summonAttempt}/${maxSummonAttempts}); dismissing & retrying...`);
          await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
          await new Promise(r => setTimeout(r, isTurbo ? 120 : 220));
          continue;
        }

        let summonDmg = 0;
        let summonHonors = 0;
        if (netRes.json) {
          summonDmg = CombatResolutionService.extractTurnDamage(netRes.json);
          if (summonDmg > 0) {
            summonHonors = Math.floor(summonDmg / 100);
            this.ctx.state.currentScore += summonHonors;
          }
        }

        // 5. Advance CreateJS tweens naturally (without forcing stage.gGameStatus.lock = false)
        // until the summon animation settles so subsequent summons or skills open their trays cleanly.
        const summonSettleStart = Date.now();
        const summonSettleTimeout = isTurbo ? 800 : 1800;
        while (Date.now() - summonSettleStart < summonSettleTimeout) {
          const summonSettled = await this.page.evaluate(() => {
            const cjs = (window as any).createjs;
            if (cjs?.Tween?.tick) {
              cjs.Tween.tick(1500, false);
            }
            const pop = document.querySelector('.pop-summon-detail, .pop-usual.pop-show, .prt-popup-header .btn-close') as HTMLElement | null;
            if (pop && pop.offsetParent !== null) {
              const close = pop.querySelector('.btn-close, .btn-usual-ok, .btn-usual-cancel') as HTMLElement | null;
              if (close && typeof close.click === 'function') close.click();
            }
            const stage = (window as any).stage;
            const gStatus = stage?.gGameStatus;
            const pJsn = stage?.pJsnData;
            const isDefeated = gStatus?.win || pJsn?.is_clear || pJsn?.finish;
            const inputUnlocked = !gStatus?.lock && !gStatus?.btn_lock && !gStatus?.attacking;
            return Boolean(isDefeated || inputUnlocked);
          }).catch(() => true);

          if (summonSettled) break;
          await new Promise(r => setTimeout(r, 45));
        }

        await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 350 : 1500);
        const postState = await this.stepMonitor.captureCombatSnapshot({ summonSlot: slot });
        const recastBefore = preState.recast || '0';
        const recastAfter = postState.recast || (netRes.resolved ? 'cast' : '0');

        this.stepMonitor.recordStepReceipt({
          runNumber: runNum,
          stepNumber: stepNum,
          step,
          dynamicName: summonDisplayName || postState.abilityName,
          status: netRes.resolved ? 'CONFIRMED_NETWORK' : 'CONFIRMED_STATE_MUTATION',
          verified: true,
          attempts: summonAttempt,
          durationMs: Date.now() - stepStart,
          damageDealt: summonDmg,
          honorsGained: summonHonors,
          preState,
          postState,
          networkConfirmed: netRes.resolved,
          stateMutated: recastAfter !== recastBefore || summonDmg > 0,
          recastTransition: `${recastBefore}->${recastAfter}`
        });

        await this.deps.combatResolution.getAndLogEnemyHp(`Summon Slot ${slot}`);
        return true;
      }
    }

    if (step.optional) {
      console.log(`[Combat] Optional summon slot ${slot} skipped.`);
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        dynamicName: summonDisplayName,
        status: 'SKIPPED_OPTIONAL',
        verified: true,
        attempts: maxSummonAttempts,
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        reason: 'Optional summon slot skipped'
      });
      return true;
    }

    this.stepMonitor.recordStepReceipt({
      runNumber: runNum,
      stepNumber: stepNum,
      step,
      dynamicName: summonDisplayName,
      status: 'FAILED_TIMEOUT',
      verified: false,
      attempts: maxSummonAttempts,
      durationMs: Date.now() - stepStart,
      preState,
      networkConfirmed: false,
      stateMutated: false,
      reason: `Failed to locate or invoke Summon Slot ${slot}`
    });
    return false;
  }


  /**
   * Toggles Full Auto / Semi Auto.
   */
  public async handleAuto(step: WorkflowStep): Promise<boolean> {
    const autoBtn = await this.page.waitForSelector('.btn-auto', { visible: true, timeout: 3000 }).catch(() => null);
    if (autoBtn) {
      await humanizedClick(this.page, autoBtn);
      return true;
    }
    return false;
  }

  /**
   * Toggles guard (V2).
   */
  public async handleGuard(step: WorkflowStep): Promise<boolean> {
    const target = step.target || 'all';
    if (target === 'all') {
      const guardAllBtn = await this.page.$('.btn-guard-all');
      if (guardAllBtn) {
        await humanizedClick(this.page, guardAllBtn);
        return true;
      }
    }
    return false;
  }

  /**
   * High-speed optimized Full Auto ("The Full Auto Version of Us").
   */
  public async handleSmartFullAuto(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const maxTurns = step.maxLoops || 25;
    const delayAfterAttack = step.delayAfterMs !== undefined ? step.delayAfterMs : 350;
    const targetChars = step.characters;
    const healHpThreshold = step.healHpThreshold ?? 0.75;
    const minHealHpThreshold = step.minHealHpThreshold ?? 0.60;
    const tacticalMode = step.tacticalSkillsMode ?? (step.skillsTurn1Only === true ? 'turn1_only' : 'smart');

    console.log(`[Workflow] ⚡ [Run ${runNumber}] Initiating Methodological Tactical Auto (max turns: ${maxTurns}, mode: ${tacticalMode}, post-attack wait: ${delayAfterAttack}ms)...`);

    for (let turn = 1; turn <= maxTurns; turn++) {
      if (this.ctx.state.stopRequested) return false;
      if (this.ctx.template.stopOnCaptcha !== false) await this.ctx.sentinel.assertSafe();

      if (await this.deps.combatResolution.isBattleEnded()) {
        console.log(`[Workflow] [Run ${runNumber}] Battle concluded at Turn ${turn}.`);
        return true;
      }

      await this.deps.combatResolution.waitForCombatInputReady(6000);
      if (await this.deps.combatResolution.isBattleEnded()) return true;

      // 1. Check Plain Damage Omen
      const omenActive = await this.isPlainDamageOmenActive();
      if (omenActive) {
        console.log(`[Workflow] ⚠️ Omen detected: [Deal 1,000,000 Plain Damage]! Checking Beelzebub summon...`);
        const bubsCalled = await this.executeBeelzebubSummonIfAvailable();
        if (bubsCalled) {
          console.log(`[Workflow] 🎉 Beelzebub summon cast! Plain Damage omen canceled.`);
          await this.deps.combatResolution.waitForCombatInputReady(5000);
          if (await this.deps.combatResolution.isBattleEnded()) return true;
        }
      }

      // 2. Quick summon call on Turn 1 if available
      if (turn === 1 && step.quickSummon !== false) {
        const qsReady = await this.page.evaluate(() => {
          const btn = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
          return !!(btn && btn.offsetParent !== null && !btn.classList.contains('disabled'));
        }).catch(() => false);
        if (qsReady) {
          console.log(`[Workflow] [Turn ${turn}] Invoking Quick Summon...`);
          await this.handleQuickCall({ code: 'quick_call', waitForNetwork: 'summon_result.json' });
          await logNormalDelay(150, 0.1);
        }
      }

      // 3. Tactical skills execution
      const shouldCastSkills = tacticalMode === 'smart' || (tacticalMode === 'turn1_only' && turn === 1);
      if (shouldCastSkills) {
        await this.executeTacticalReadySkills(targetChars, healHpThreshold, minHealHpThreshold, turn);
      }

      if (await this.deps.combatResolution.isBattleEnded()) return true;

      // 4. Attack dispatch
      console.log(`[Workflow] [Turn ${turn}] Dispatching Attack command...`);
      const attackDispatched = await this.handleAttack({
        code: 'attack',
        waitForNetwork: 'normal_attack_result.json'
      });

      if (!attackDispatched && !(await this.deps.combatResolution.isBattleEnded())) {
        console.warn(`[Workflow] [Turn ${turn}] Attack dispatch failed or unconfirmed.`);
      }

      // 5. Post-attack delay
      if (delayAfterAttack > 0) {
        await new Promise(r => setTimeout(r, delayAfterAttack));
      }

      // 6. Fast animation cancel via reload (F5)
      console.log(`[Workflow] [Turn ${turn}] Reloading (F5) to cancel attack animation...`);
      await this.handleReload({ code: 'reload' });

      await logNormalDelay(150, 0.1);

      if (await this.deps.combatResolution.isBattleEnded()) {
        console.log(`[Workflow] [Run ${runNumber}] Boss defeated after Turn ${turn}!`);
        return true;
      }
    }

    return true;
  }

  /**
   * Methodological Tactical Skill Engine for Granblue Fantasy.
   */
  public async executeTacticalReadySkills(
    targetCharacters?: number[],
    healHpThreshold = 0.75,
    minHealHpThreshold = 0.60,
    turn = 1
  ): Promise<void> {
    if (this.ctx.state.stopRequested) return;
    if (await this.deps.combatResolution.isBattleEnded()) return;

    const scan = await this.page.evaluate(
      (healThresh: number, minHealThresh: number, targetChars?: number[]) => {
        const stage = (window as any).stage;
        const pJsn = stage?.pJsnData;
        const gStatus = stage?.gGameStatus;

        const players = pJsn?.player?.param || gStatus?.player?.param || [];
        let totalHp = 0;
        let totalMaxHp = 0;
        let minHpRatio = 1.0;
        let hasDebuffedAlly = false;

        const frontline = players.slice(0, 4);
        for (const p of frontline) {
          if (p && p.alive !== 0) {
            const cur = Number(p.hp) || 0;
            const max = Number(p.hpmax) || 1;
            const ratio = cur / max;
            totalHp += cur;
            totalMaxHp += max;
            if (ratio < minHpRatio) minHpRatio = ratio;
            if (p.condition?.debuff && Array.isArray(p.condition.debuff) && p.condition.debuff.length > 0) {
              hasDebuffedAlly = true;
            }
          }
        }
        const avgHpRatio = totalMaxHp > 0 ? (totalHp / totalMaxHp) : 1.0;
        const needsHealing = (avgHpRatio < healThresh) || (minHpRatio < minHealThresh) || hasDebuffedAlly;

        interface ScannedTacticalSkill {
          charIndex: number;
          charNum: number;
          slot: number;
          abilityId: string;
          abilityName: string;
          iconType: number;
          category: 'field' | 'debuff' | 'buff' | 'damage' | 'heal';
          requiresPick: boolean;
        }

        const scanned: ScannedTacticalSkill[] = [];
        const targetSet = (targetChars && targetChars.length > 0)
          ? new Set(targetChars.map(c => Number(c)))
          : null;

        const abilityMap = pJsn?.ability || {};
        const charKeys = Object.keys(abilityMap);

        if (charKeys.length > 0) {
          for (const charKey of charKeys) {
            const charObj = abilityMap[charKey];
            if (!charObj || charObj.alive === 0) continue;
            const charPos = charObj.pos !== undefined ? Number(charObj.pos) : (Number(charKey) - 1);
            const charNum = charPos + 1;

            if (charNum < 1 || charNum > 4) continue;
            if (targetSet && !targetSet.has(charNum)) continue;

            const list = charObj.list || {};
            for (const [slotKey, abilityArray] of Object.entries(list) as [string, any][]) {
              const slotNum = Number(slotKey);
              if (slotNum < 1 || slotNum > 4) continue;
              const ab = Array.isArray(abilityArray) ? abilityArray[0] : abilityArray;
              if (!ab) continue;

              const recast = String(ab['ability-recast'] ?? '');
              const reqMet = ab['requirement_result_flag'] !== false;
              const isReady = (recast === '0' || recast === '') && reqMet;
              if (!isReady) continue;

              const iconType = Number(ab['icon-type'] || '1');
              let category: 'field' | 'debuff' | 'buff' | 'damage' | 'heal' = 'damage';
              if (iconType === 5) category = 'field';
              else if (iconType === 4) category = 'debuff';
              else if (iconType === 3) category = 'buff';
              else if (iconType === 2) category = 'heal';
              else if (iconType === 1) category = 'damage';

              if (category === 'heal' && !needsHealing) continue;

              scanned.push({
                charIndex: charPos,
                charNum,
                slot: slotNum,
                abilityId: String(ab['ability-id'] || ''),
                abilityName: String(ab['ability-name'] || ''),
                iconType,
                category,
                requiresPick: ab['type'] === '2' || ab['select_flag'] === 1 || ab['pick_flag'] === 1
              });
            }
          }
        } else {
          for (let c = 1; c <= 4; c++) {
            if (targetSet && !targetSet.has(c)) continue;
            for (let s = 1; s <= 4; s++) {
              const btn = document.querySelector(`.ability-character-num-${c}-${s}`) as HTMLElement;
              if (btn && !btn.classList.contains('btn-ability-unavailable') && !btn.classList.contains('btn-ability-off')) {
                const recast = btn.getAttribute('ability-recast');
                if (recast === '0' || recast === '' || recast === null) {
                  scanned.push({
                    charIndex: c - 1,
                    charNum: c,
                    slot: s,
                    abilityId: btn.getAttribute('ability-id') || '',
                    abilityName: '',
                    iconType: 1,
                    category: 'damage',
                    requiresPick: false
                  });
                }
              }
            }
          }
        }

        return { scanned, needsHealing, avgHpRatio, minHpRatio };
      },
      healHpThreshold,
      minHealHpThreshold,
      targetCharacters
    ).catch(() => ({ scanned: [], needsHealing: false, avgHpRatio: 1, minHpRatio: 1 }));

    if (!scan.scanned || scan.scanned.length === 0) {
      return;
    }

    const categoryOrder: Record<string, number> = {
      field: 1,
      debuff: 2,
      buff: 3,
      damage: 4,
      heal: 5
    };

    const sortedSkills = [...scan.scanned].sort((a, b) => {
      const catA = categoryOrder[a.category] || 99;
      const catB = categoryOrder[b.category] || 99;
      if (catA !== catB) return catA - catB;
      if (a.charNum !== b.charNum) return a.charNum - b.charNum;
      return a.slot - b.slot;
    });

    console.log(`[Combat] [Turn ${turn}] Tactical Skill Engine: ${sortedSkills.length} actionable skill(s) ready across frontline (HP: ${(scan.avgHpRatio * 100).toFixed(0)}%, Min: ${(scan.minHpRatio * 100).toFixed(0)}%). Executing...`);

    let activeDrawerChar = -1;

    for (const skill of sortedSkills) {
      if (this.ctx.state.stopRequested) break;
      if (await this.deps.combatResolution.isBattleEnded()) break;

      const charNum = skill.charNum;
      const slot = skill.slot;
      const selector = `.ability-character-num-${charNum}-${slot}`;

      if (activeDrawerChar !== charNum) {
        const charIdx = charNum - 1;
        const charSelector = `.prt-command-chara[pos="${charIdx}"] .btn-command-character, .lis-character${charIdx}.btn-command-character, .lis-character${charIdx}, div[pos="${charIdx}"].btn-command-character, .btn-command-character[pos="${charIdx}"]`;

        let opened = await this.page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (el && el.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(el).trigger('tap');
            el.click();
            return true;
          }
          return false;
        }, charSelector).catch(() => false);

        if (!opened) {
          const charBtn = await this.page.$(charSelector);
          if (charBtn) {
            await humanizedClick(this.page, charBtn);
            opened = true;
          }
        }

        if (opened) {
          activeDrawerChar = charNum;
          if (typeof (this.page as any).waitForFunction === 'function') {
            await this.page.waitForFunction((sel: string) => {
              const el = document.querySelector(sel) as HTMLElement;
              return !!(el && el.offsetParent !== null && window.getComputedStyle(el).display !== 'none');
            }, { timeout: 1500 }, selector).catch(() => null);
          }
        }
      }

      const netPromise = this.deps.combatResolution.waitForNetworkResponse('ability_result.json', 3500);
      const skillEl = await this.page.$(selector).catch(() => null);
      const clicked = await this.page.evaluate((sel: string) => {
        const btn = document.querySelector(sel) as HTMLElement;
        if (!btn || btn.offsetParent === null) return false;
        if (btn.classList.contains('btn-ability-unavailable') || btn.classList.contains('btn-ability-off')) return false;

        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
        return true;
      }, selector).catch(() => false);

      if (clicked) {
        console.log(`[Combat] [Turn ${turn}] Cast [${skill.category.toUpperCase()}] C${charNum}S${slot}${skill.abilityName ? ` ("${skill.abilityName}")` : ''}`);

        if (skill.requiresPick) {
          await logNormalDelay(150, 0.1);
          await this.page.evaluate(() => {
            const popups = Array.from(
              document.querySelectorAll('.pop-usual, .pop-select-member, .prt-popup-body, .pop-target, #pop')
            ) as HTMLElement[];
            for (const pop of popups) {
              if (!pop || pop.offsetParent === null) continue;
              const targetInPop = pop.querySelector('.lis-character0, .btn-command-character[pos="0"], [pos="0"]') as HTMLElement | null;
              if (targetInPop) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(targetInPop).trigger('tap');
                targetInPop.click();
                return;
              }
            }
            const targetChar = document.querySelector('.lis-character0, .btn-command-character[pos="0"]') as HTMLElement;
            if (targetChar) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(targetChar).trigger('tap');
              targetChar.click();
            }
          }).catch(() => null);
          await logNormalDelay(120, 0.1);
        }

        await netPromise;
        await this.deps.combatResolution.waitForCombatInputReady(1200);
      }
    }

    if (activeDrawerChar !== -1) {
      await this.deps.combatResolution.dismissCombatDrawersAndPopups();
    }
  }

  public async executeOptimalReadySkills(targetCharacters?: number[]): Promise<void> {
    await this.executeTacticalReadySkills(targetCharacters, 0.75, 0.60, 1);
  }

  /**
   * Evaluates if a Plain Damage Omen ("Deal 1,000,000 plain damage") is currently active on the enemy.
   */
  public async isPlainDamageOmenActive(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const specialSkill = document.querySelector('.prt-special-skill, .prt-omen, .prt-cancel-condition');
        if (specialSkill) {
          const text = (specialSkill as HTMLElement).innerText || '';
          if (
            (text.includes('1,000,000') || text.includes('1000000')) &&
            (text.toLowerCase().includes('plain') || text.includes('無属性'))
          ) {
            return true;
          }
        }

        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const bosses = gStatus?.boss?.param || stage?.pJsnData?.boss?.param || [];
        for (const boss of bosses) {
          if (boss?.special_skill) {
            const sText = JSON.stringify(boss.special_skill);
            if (
              (sText.includes('1,000,000') || sText.includes('1000000')) &&
              (sText.toLowerCase().includes('plain') || sText.includes('無属性'))
            ) {
              return true;
            }
          }
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Checks if Beelzebub summon is available and invokes it.
   */
  public async executeBeelzebubSummonIfAvailable(): Promise<boolean> {
    try {
      const bubsInfo = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const rawSummons = stage?.pJsnData?.summon || stage?.gGameStatus?.summon || {};
        const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);

        let bubsIndex = -1;
        let isAvailable = false;

        summonsList.forEach((s: any, idx: number) => {
          const idStr = String(s?.id || '');
          const nameStr = String(s?.name || '');
          if (idStr === '2040408000' || nameStr.toLowerCase().includes('beelzebub') || nameStr.includes('ベルゼバブ')) {
            bubsIndex = idx;
            isAvailable = s?.available_flag === 1 || s?.available_flag === true || s?.recast === '0' || s?.recast === 0;
          }
        });

        const summonEls = document.querySelectorAll('.lis-summon');
        summonEls.forEach((el, idx) => {
          const img = el.querySelector('img')?.getAttribute('src') || '';
          if (img.includes('2040408000')) {
            bubsIndex = idx;
            if (el.classList.contains('btn-summon-available') || el.classList.contains('on')) {
              isAvailable = true;
            }
          }
        });

        return { bubsIndex, isAvailable };
      });

      if (bubsInfo.bubsIndex === -1 || !bubsInfo.isAvailable) {
        return false;
      }

      console.log(`[Workflow] Calling Beelzebub (Summon Slot ${bubsInfo.bubsIndex})...`);
      const summonTab = await this.page.$('.prt-list-top.btn-command-summon:not(.summon-on)');
      if (summonTab) {
        await humanizedClick(this.page, summonTab);
        await randomDelay(250, 400);
      }

      const summonCards = await this.page.$$('.lis-summon');
      const bubsCard = summonCards[bubsInfo.bubsIndex];
      if (!bubsCard) return false;

      await humanReactionDelay(220, 0.15);
      await humanizedClick(this.page, bubsCard);
      await randomDelay(450, 700);

      const callBtn = await this.page.$('.pop-usual .btn-usual-ok, .btn-call, .btn-summon-start, #pop .btn-usual-ok');
      if (callBtn) {
        await humanReactionDelay(220, 0.15);
        await humanizedClick(this.page, callBtn);
        await randomDelay(600, 900);
      }

      await this.page.evaluate(() => location.reload()).catch(() => null);
      await randomDelay(600, 900);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Taps the READY screen overlay / Auto button to trigger Full Auto, Turn action, or Attack.
   * Confirms whether the action (normal_attack_result.json or summon_result.json) fired from the READY tap;
   * if not, waits for the combat screen to finish loading and manually clicks the Attack / Quick Call button.
   */
  public async handleTapReady(step: WorkflowStep): Promise<boolean> {
    (this.ctx.state as any).lastTapReadyAttackConfirmedAt = 0;
    (this.ctx.state as any).lastAttackReloadedAt = 0;
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const targetNet = step.waitForNetwork || 'normal_attack_result.json';
    const isQuickSummonTarget = targetNet.includes('summon_result.json');
    const initialTurn = this.ctx.state.currentTurn;
    const initialHonors = this.ctx.state.currentScore;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.ctx.state.stopRequested) return false;

      await this.deps.combatResolution.waitForBattleToMount(8000);
      if (await this.deps.combatResolution.isBattleEnded()) return true;

      await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
      await this.deps.combatResolution.dismissCombatDrawersAndPopups();

      if (this.ctx.state.currentTurn > initialTurn || (this.ctx.state.currentScore > initialHonors && initialHonors > 0)) {
        await this.deps.combatResolution.syncCurrentHonors();
        if (!isQuickSummonTarget) {
          (this.ctx.state as any).lastTapReadyAttackConfirmedAt = Date.now();
        }
        console.log(`[Combat] [tap_ready] Turn already resolved (${this.ctx.state.currentScore.toLocaleString()} pt).`);
        return true;
      }

      // 1. Arm network/turn resolution listener BEFORE tapping the READY screen so fast responses are never missed
      let turnResolved = false;
      const combatPromise = this.deps.combatResolution
        .waitForCombatTurnResolution(targetNet, isTurbo ? 6000 : 12000)
        .then(ok => {
          if (ok) turnResolved = true;
          return ok;
        });

      // 2. Tap READY screen ("TAP TO THE SCREEN") once with full Human Motor kinematics
      //    (Log-Normal reaction latency -> 2D Gaussian coordinate -> Cubic Bézier trajectory -> Microswitch hold & tap)
      const useHumanMotor = this.ctx.template?.humanMotor !== false;
      const vp = this.page.viewport() || { width: 480, height: 960 };
      const readyTapX = Math.max(
        24,
        Math.min(vp.width - 24, Math.round(vp.width * 0.5 + (useHumanMotor ? sampleGaussian(0, 14) : 0)))
      );
      const readyTapY = Math.max(
        48,
        Math.min(vp.height - 48, Math.round(vp.height * 0.385 + (useHumanMotor ? sampleGaussian(0, 16) : 0)))
      );

      // Inspect READY overlay & combat button state before physical actuation
      const preTapCheck = await this.page.evaluate((targetFps: number) => {
        const cjs = (window as any).createjs;
        if (cjs?.Ticker) {
          cjs.Ticker.framerate = targetFps;
          if (typeof cjs.Ticker.setInterval === 'function') cjs.Ticker.setInterval(1000 / targetFps);
        }
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(1500, false);
        }
        const readyEl = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready, #ready, .prt-start') as HTMLElement | null;
        const hasVisibleReady = !!(readyEl && readyEl.offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none');
        const atkEl = document.querySelector('.btn-attack-start') as HTMLElement | null;
        const atkAlreadyReady = !!(
          atkEl &&
          atkEl.offsetWidth > 0 &&
          window.getComputedStyle(atkEl).display !== 'none' &&
          !atkEl.classList.contains('display-off') &&
          !atkEl.classList.contains('lock')
        );
        return { hasVisibleReady, atkAlreadyReady };
      }, config.TICKER_FPS).catch(() => ({ hasVisibleReady: false, atkAlreadyReady: false }));

      if (useHumanMotor && !config.isProduction) {
        await humanReactionDelay(isTurbo ? 25 : 70, 0.18);
        await moveMouseSmoothly(this.page, { x: readyTapX, y: readyTapY }).catch(() => null);
      }

      if (preTapCheck.hasVisibleReady) {
        console.log(`[Combat] [tap_ready] Tapping READY screen ("TAP TO THE SCREEN") with human motor at (${readyTapX}, ${readyTapY})...`);
        await this.page.touchscreen.tap(readyTapX, readyTapY).catch(() => null);
        if (useHumanMotor && typeof this.page.mouse?.down === 'function' && typeof this.page.mouse?.up === 'function') {
          await this.page.mouse.down().catch(() => null);
          await logNormalDelay(isTurbo ? 18 : 42, 0.18);
          await this.page.mouse.up().catch(() => null);
        } else {
          await this.page.mouse.click(readyTapX, readyTapY).catch(() => null);
        }
      }

      const readyState = await this.page.evaluate((x: number, y: number) => {
        const readyEl = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready, #ready, .prt-start') as HTMLElement | null;
        const hasVisibleReady = !!(readyEl && readyEl.offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none');
        const targetEl =
          readyEl ||
          (typeof document.elementFromPoint === 'function' ? (document.elementFromPoint(x, y) as HTMLElement | null) : null) ||
          (document.querySelector('canvas, .cnt-raid') as HTMLElement | null);
        if (targetEl) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(targetEl).trigger('tap');
          if (typeof targetEl.click === 'function') targetEl.click();
        }
        const atkEl = document.querySelector('.btn-attack-start') as HTMLElement | null;
        const atkAlreadyReady = !!(
          atkEl &&
          atkEl.offsetWidth > 0 &&
          window.getComputedStyle(atkEl).display !== 'none' &&
          !atkEl.classList.contains('display-off') &&
          !atkEl.classList.contains('lock')
        );
        return { hasVisibleReady: hasVisibleReady || Boolean(readyEl), atkAlreadyReady };
      }, readyTapX, readyTapY).catch(() => preTapCheck);

      // 3. Grace window: check if tapping READY automatically triggered the attack / quick summon
      const autoGraceMs = (preTapCheck.hasVisibleReady || readyState.hasVisibleReady) ? (isTurbo ? 350 : 450) : 40;
      const graceStart = Date.now();
      while (!turnResolved && Date.now() - graceStart < autoGraceMs) {
        if (this.ctx.state.stopRequested) return false;
        await new Promise(r => setTimeout(r, 25));
      }

      // 4. Confirm the attack (if not triggered by READY tap, click Attack / Quick Summon button manually after fully loaded screen)
      let manualActionDispatched = false;
      if (!turnResolved) {
        if (isQuickSummonTarget) {
          const qsBtn = await this.page
            .waitForSelector('.btn-quick-summon.qs-ready, .btn-quick-summon, #js-btn-quick-summon', {
              visible: true,
              timeout: isTurbo ? 800 : 2000
            })
            .catch(() => null);
          if (qsBtn && !turnResolved) {
            await humanizedClick(this.page, qsBtn).catch(() => null);
            await qsBtn.evaluate((el: any) => {
              const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
              const $ = win?.$ || win?.Zepto;
              if ($) $(el).trigger('tap');
              if (typeof el.click === 'function') el.click();
            }).catch(() => null);
            manualActionDispatched = true;
          }
        } else {
          // Wait for screen to be fully loaded (.prt-ready dismissed and .btn-attack-start interactable) unless auto-attack already started
          const loadWaitStart = Date.now();
          const loadTimeoutMs = isTurbo ? 1200 : 3000;
          let atkReady = readyState.atkAlreadyReady;

          while (!turnResolved && !atkReady && Date.now() - loadWaitStart < loadTimeoutMs) {
            if (this.ctx.state.stopRequested) return false;
            const loadCheck = await this.page.evaluate(() => {
              const cjs = (window as any).createjs;
              if (cjs?.Tween?.tick) cjs.Tween.tick(1500, false);

              const back = document.querySelector('.btn-command-back.display-on') as HTMLElement | null;
              if (back && back.offsetWidth > 0 && window.getComputedStyle(back).display !== 'none') {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(back).trigger('tap');
                back.click();
                return { atkReady: false, autoAttacking: false };
              }

              const stage = (window as any).stage;
              const gStatus = stage?.gGameStatus;
              const autoAttacking = Boolean(gStatus?.attacking === 1 || gStatus?.attacking === true || gStatus?.turn_ing === 1);

              const activeReady = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready, #ready, .prt-start') as HTMLElement | null;
              const readyStillVisible = !!(activeReady && activeReady.offsetParent !== null && window.getComputedStyle(activeReady).display !== 'none');

              const el = document.querySelector('.btn-attack-start') as HTMLElement | null;
              if (!el || el.offsetWidth === 0 || window.getComputedStyle(el).display === 'none') {
                return { atkReady: false, autoAttacking };
              }
              const isLocked = el.classList.contains('display-off') || el.classList.contains('lock');
              return { atkReady: !isLocked && !readyStillVisible, autoAttacking };
            }).catch(() => ({ atkReady: false, autoAttacking: false }));

            if (loadCheck.autoAttacking) {
              break;
            }
            if (loadCheck.atkReady) {
              atkReady = true;
              break;
            }
            await new Promise(r => setTimeout(r, 35));
          }

          if (!turnResolved && atkReady) {
            const atkBtn = await this.page.$('.btn-attack-start.display-on, .btn-attack-start').catch(() => null);
            if (atkBtn && !turnResolved) {
              console.log('[Combat] [tap_ready] Auto-attack not active after full screen load; clicking Attack button manually...');
              await humanizedClick(this.page, atkBtn);
              await atkBtn.evaluate((el: any) => {
                const win = typeof window !== 'undefined' ? (window as any) : (globalThis as any);
                const $ = win?.$ || win?.Zepto;
                if ($) {
                  $(el).trigger('tap');
                  $(el).trigger('click');
                }
                if (typeof el.click === 'function') el.click();
              }).catch(() => null);
              manualActionDispatched = true;
            }
          } else if (!turnResolved) {
            const autoBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto, #btn-auto', { visible: true, timeout: 800 }).catch(() => null);
            if (autoBtn && !turnResolved) {
              console.log('[Combat] [tap_ready] Attack button in cooldown; engaging Auto...');
              await humanizedClick(this.page, autoBtn);
              manualActionDispatched = true;
            }
          }
        }
      }

      if (!turnResolved && !manualActionDispatched) {
        const atkX = Math.round(vp.width * 0.75 + (useHumanMotor ? sampleGaussian(0, 8) : 0));
        const atkY = Math.round(vp.height * 0.46 + (useHumanMotor ? sampleGaussian(0, 8) : 0));
        if (useHumanMotor && !config.isProduction) {
          await moveMouseSmoothly(this.page, { x: atkX, y: atkY }).catch(() => null);
          await logNormalDelay(isTurbo ? 15 : 35, 0.18);
        }
        await this.page.touchscreen.tap(atkX, atkY).catch(() => null);
        await this.page.mouse.click(atkX, atkY).catch(() => null);
      }

      const turnOutcome = await combatPromise;

      const clientTurnState = await this.page.evaluate((prevTurn) => {
        const stage = (window as any).stage;
        const currentTurn = Number(stage?.pJsnData?.turn || stage?.gGameStatus?.turn || 0);
        return { turnAdvanced: currentTurn > prevTurn };
      }, this.ctx.state.currentTurn).catch(() => ({ turnAdvanced: false }));

      const serverTurnAdvanced = clientTurnState.turnAdvanced || this.ctx.state.currentTurn > initialTurn;
      const honorsGained = this.ctx.state.currentScore > initialHonors;

      if (turnOutcome || serverTurnAdvanced || honorsGained) {
        if (!isQuickSummonTarget) {
          (this.ctx.state as any).lastTapReadyAttackConfirmedAt = Date.now();
        }
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] [tap_ready] Turn resolved successfully on attempt ${attempt}. Honors: ${this.ctx.state.currentScore.toLocaleString()} pt.`);
        return true;
      }

      if (await this.deps.combatResolution.isBattleEnded()) {
        if (!isQuickSummonTarget) {
          (this.ctx.state as any).lastTapReadyAttackConfirmedAt = Date.now();
        }
        await this.deps.combatResolution.syncCurrentHonors();
        return true;
      }

      console.warn(`[Combat] [tap_ready] Turn resolution unacknowledged on attempt ${attempt}/${maxRetries}. Retrying...`);
      if (!isTurbo) await logNormalDelay(250, 0.15);
    }

    return false;
  }

  /**
   * Dispatches Quick Summon call.
   */
  public async handleQuickCall(step: WorkflowStep): Promise<boolean> {
    (this.ctx.state as any).lastAttackReloadedAt = 0;
    const stepStart = Date.now();
    const runNum = (this.ctx.state.totalCompletedRuns || 0) + 1;
    const stepNum = this.ctx.state.activeStepNum || 1;
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    await this.deps.combatResolution.dismissCombatDrawersAndPopups();
    await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 600 : 3000);
    const preState = await this.stepMonitor.captureCombatSnapshot();

    if (await this.deps.combatResolution.isBattleEnded()) {
      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        status: 'SKIPPED_BATTLE_ENDED',
        verified: true,
        attempts: 1,
        durationMs: Date.now() - stepStart,
        preState,
        networkConfirmed: false,
        stateMutated: false,
        reason: 'Battle ended prior to Quick Summon'
      });
      return true;
    }

    const maxAttempts = step.retries || (step.ensureCast ? 3 : 2);
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.ctx.state.stopRequested) return false;
      const qBtn = await this.page.waitForSelector('.btn-quick-summon, #js-btn-quick-summon', { visible: true, timeout: 2500 }).catch(() => null);
      if (!qBtn) break;

      const isUnavailable = await qBtn.evaluate((el: any) => {
        return el.classList.contains('btn-summon-unavailable') ||
               el.classList.contains('off') ||
               el.classList.contains('disabled') ||
               el.getAttribute('aria-disabled') === 'true' ||
               el.style.opacity === '0.5';
      }).catch(() => false);

      if (isUnavailable) {
        console.log('[Workflow] Quick Summon button disabled or already invoked this turn. Continuing...');
        this.stepMonitor.recordStepReceipt({
          runNumber: runNum,
          stepNumber: stepNum,
          step,
          status: attempt > 1 ? 'CONFIRMED_STATE_MUTATION' : 'SKIPPED_COOLDOWN',
          verified: true,
          attempts: attempt,
          durationMs: Date.now() - stepStart,
          preState,
          networkConfirmed: false,
          stateMutated: attempt > 1,
          reason: attempt > 1 ? 'Quick Summon button transitioned to used state' : 'Quick Summon already on cooldown'
        });
        return true;
      }

      const netPromise = this.deps.combatResolution.waitForNetworkResponseAndPayload(step.waitForNetwork || 'summon_result.json', 3500);
      await humanizedClick(this.page, qBtn);
      await qBtn.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        el.click();
      }).catch(() => null);
      const netRes = await netPromise;

      if (netRes.isPopupLockout && attempt < maxAttempts) {
        console.warn(`[Enforcer] 🔄 Server lockout popup on Quick Summon (attempt ${attempt}/${maxAttempts}); dismissing & retrying...`);
        await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
        await new Promise(r => setTimeout(r, isTurbo ? 100 : 180));
        continue;
      }

      let qDmg = 0;
      let qHonors = 0;
      if (netRes.json) {
        qDmg = CombatResolutionService.extractTurnDamage(netRes.json);
        if (qDmg > 0) {
          qHonors = Math.floor(qDmg / 100);
          this.ctx.state.currentScore += qHonors;
        }
      }

      await this.page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(2000, false);
        }
      }).catch(() => null);

      await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 400 : 2500);
      const postState = await this.stepMonitor.captureCombatSnapshot();

      this.stepMonitor.recordStepReceipt({
        runNumber: runNum,
        stepNumber: stepNum,
        step,
        status: netRes.resolved ? 'CONFIRMED_NETWORK' : 'CONFIRMED_STATE_MUTATION',
        verified: true,
        attempts: attempt,
        durationMs: Date.now() - stepStart,
        damageDealt: qDmg,
        honorsGained: qHonors,
        preState,
        postState,
        networkConfirmed: netRes.resolved,
        stateMutated: qDmg > 0 || postState.bossHp < preState.bossHp
      });

      await this.deps.combatResolution.getAndLogEnemyHp('Quick Call');
      return true;
    }

    this.stepMonitor.recordStepReceipt({
      runNumber: runNum,
      stepNumber: stepNum,
      step,
      status: step.optional ? 'SKIPPED_OPTIONAL' : 'FAILED_TIMEOUT',
      verified: Boolean(step.optional),
      attempts: maxAttempts,
      durationMs: Date.now() - stepStart,
      preState,
      networkConfirmed: false,
      stateMutated: false,
      reason: 'Quick Summon button not found or unconfirmed'
    });
    return step.optional ? true : false;
  }

  /**
   * Executes Attack action with ability drawer dismissal, dynamic coordinate targeting,
   * network confirmation (normal_attack_result.json), and an automated retry loop.
   */
  public async handleAttack(step: WorkflowStep): Promise<boolean> {
    (this.ctx.state as any).lastAttackReloadedAt = 0;
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';

    // If the immediately preceding tap_ready step already confirmed the attack for this turn,
    // verify and proceed immediately without dispatching a duplicate second attack.
    const lastTapReadyConfirmedAt = Number((this.ctx.state as any).lastTapReadyAttackConfirmedAt || 0);
    (this.ctx.state as any).lastTapReadyAttackConfirmedAt = 0;
    if (lastTapReadyConfirmedAt > 0 && Date.now() - lastTapReadyConfirmedAt < 5000) {
      console.log(`[Combat] ✅ Attack already confirmed by READY screen step. Proceeding immediately to next step...`);
      this.stepMonitor.recordStepReceipt({
        runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
        stepNumber: this.ctx.state.activeStepNum || 1,
        step,
        status: 'CONFIRMED_NETWORK',
        verified: true,
        attempts: 1,
        durationMs: 0,
        honorsGained: this.ctx.state.currentScore,
        networkConfirmed: true,
        stateMutated: true,
        reason: 'Attack confirmed during READY tap sequence'
      });
      return true;
    }

    // HonorGuard: Suppress attack immediately if targetScore has already been met
    if (this.ctx.template.honorGuard !== false && this.ctx.template.targetScore && this.ctx.state.currentScore >= this.ctx.template.targetScore) {
      console.log(`[Combat] Target score already satisfied (${this.ctx.state.currentScore.toLocaleString()} >= ${this.ctx.template.targetScore.toLocaleString()} pt). Suppressing attack.`);
      return true;
    }

    // HP Cutoff Guard: Suppress attack immediately if boss HP <= exitHpPct (e.g. Siete 10% trigger threshold)
    const exitHpCutoff = this.ctx.template?.exitIfHpPct ?? (
      (!this.isSoloQuest() && (this.ctx.template?.targetEnemy === 'Seofon' || String(this.ctx.template?.targetRaidQuestId) === '305411')) ? 12 : undefined
    );
    if (exitHpCutoff !== undefined) {
      const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
      if (enemy && (enemy.isDefeated || enemy.hpPct <= exitHpCutoff)) {
        console.log(`[Combat] Boss HP is at or below cutoff (${enemy.hpPct.toFixed(1)}% <= ${exitHpCutoff}%). Honors will not count past 10% with current setup. Suppressing attack.`);
        return true;
      }
    }

    // Wait for any queued skills in .prt-ability-rail or active attack-ability animations (e.g. C1S2 Blitz Raid) to finish draining before attacking
    const queueDrainStart = Date.now();
    const queueDrainTimeout = isTurbo ? 2500 : 6000;
    while (Date.now() - queueDrainStart < queueDrainTimeout) {
      if (this.ctx.state.stopRequested) return false;
      const queueDrained = await this.page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(1500, false);
        }
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;
        const isDefeated = gStatus?.win || gStatus?.lose || pJsn?.is_clear || pJsn?.finish;
        if (isDefeated) return true;
        const railItems = document.querySelectorAll('.prt-ability-rail .lis-ability, .prt-ability-rail .ico-ability, .prt-ability-rail [ability-id]');
        const queueArr = Array.isArray(gStatus?.ability_queue)
          ? gStatus.ability_queue
          : (Array.isArray(stage?.gAbilityQueue) ? stage.gAbilityQueue : []);
        const railCount = Math.max(railItems ? railItems.length : 0, queueArr.length);
        const isBusy = Boolean(gStatus?.lock || gStatus?.btn_lock || gStatus?.attacking || gStatus?.ability_turn || railCount > 0);
        return !isBusy;
      }).catch(() => true);

      if (queueDrained) break;
      await new Promise(r => setTimeout(r, 50));
    }

    const targetNet = step.waitForNetwork || 'normal_attack_result.json';
    const maxAttempts = 5;
    const initialTurn = this.ctx.state.currentTurn;
    const initialHonors = this.ctx.state.currentScore;

    const preAttackState = await this.page.evaluate(() => {
      const stage = (window as any).stage;
      const gStatus = stage?.gGameStatus;
      const pJsn = stage?.pJsnData;
      const turn = Number(pJsn?.turn || gStatus?.turn || 0);
      const rawBoss = gStatus?.boss?.param || pJsn?.boss?.param || [];
      const firstBoss = Array.isArray(rawBoss) ? rawBoss[0] : Object.values(rawBoss || {})[0];
      const bossHp = firstBoss && (firstBoss as any).hp !== undefined ? Number((firstBoss as any).hp) : -1;
      return { turn, bossHp };
    }).catch(() => ({ turn: 0, bossHp: -1 }));

    const baselineTurn = preAttackState.turn > 0 ? preAttackState.turn : initialTurn;
    const baselineBossHp = preAttackState.bossHp;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.ctx.state.stopRequested) return false;
      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Battle concluded before attack attempt ${attempt}. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        return true;
      }

      if (attempt > 1) {
        await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
      }
      await this.deps.combatResolution.dismissCombatDrawersAndPopups();

      await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 450 : 2000);
      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Battle concluded before attack dispatch. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        return true;
      }

      let atkBtn = await this.page.waitForFunction((caOff: boolean) => {
        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          else back.click();
        }
        if (caOff) {
          const caOnBtn = document.querySelector('.btn-lock.lock0') as HTMLElement | null;
          if (caOnBtn && caOnBtn.offsetParent !== null && window.getComputedStyle(caOnBtn).display !== 'none') {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(caOnBtn).trigger('tap');
            else caOnBtn.click();
          }
        }
        const el = document.querySelector('.btn-attack-start') as HTMLElement;
        if (!el || el.offsetWidth === 0 || window.getComputedStyle(el).display === 'none') return false;
        const isReady = el.classList.contains('display-on') && !el.classList.contains('lock') && !el.classList.contains('display-off');
        return isReady;
      }, { timeout: isTurbo ? 1000 : 2200 }, this.ctx.template.chargeAttack === false || this.ctx.template.chargeAttack === 'off' || this.ctx.template.chargeAttack === 'hold').then(() => this.page.$('.btn-attack-start.display-on, .btn-attack-start')).catch(() => null);

      if (!atkBtn) {
        if (await this.deps.combatResolution.isBattleEnded()) {
          await this.deps.combatResolution.syncCurrentHonors();
          console.log(`[Combat] Battle concluded before attack dispatch. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
          return true;
        }
        await this.deps.combatResolution.dismissCombatDrawersAndPopups().catch(() => false);
        if (await this.deps.combatResolution.isBattleEnded()) {
          await this.deps.combatResolution.syncCurrentHonors();
          console.log(`[Combat] Battle concluded after dismissing drawers. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
          return true;
        }
        atkBtn = await this.page.$('.btn-attack-start.display-on, .btn-attack-start').catch(() => null);
      }

      if (this.ctx.template.humanMotor !== false && !isTurbo) {
        // Minimal ocular-motor reaction latency before striking attack
        await logNormalDelay(80, 0.12);
      }

      const netPromise = this.deps.combatResolution.waitForNetworkResponseAndPayload(targetNet, isTurbo ? 1800 : 2400);

      let tapped = false;
      if (atkBtn) {
        tapped = await atkBtn.evaluate((el: any) => {
          if (!el || el.classList.contains('display-off')) return false;
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(el).trigger('tap');
          } else {
            el.click();
          }
          return true;
        }).catch(() => false);

        if (!tapped) {
          const box = await atkBtn.boundingBox().catch(() => null);
          if (box && box.width > 0 && box.height > 0) {
            const tapX = Math.round(box.x + box.width / 2 + (isTurbo ? 0 : sampleGaussian(0, 3)));
            const tapY = Math.round(box.y + box.height / 2 + (isTurbo ? 0 : sampleGaussian(0, 2)));
            await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
            tapped = true;
          }
        }
      }

      if (!tapped) {
        if (await this.deps.combatResolution.isBattleEnded()) {
          await this.deps.combatResolution.syncCurrentHonors();
          console.log(`[Combat] Battle concluded before fallback tap. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
          return true;
        }
        const vp = this.page.viewport() || { width: 480, height: 960 };
        const atkX = Math.round(vp.width * 0.75);
        const atkY = Math.round(vp.height * 0.46);
        await this.page.touchscreen.tap(atkX, atkY).catch(() => null);
        await this.page.mouse.click(atkX, atkY).catch(() => null);
      }

      const netResult = await netPromise;
      const resolved = netResult.resolved;
      const json = netResult.json;

      if (json) {
        if (json.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(json.user_id);
        let directPoint: number | null = null;

        if (Array.isArray(json.multi_raid_member_info)) {
          const myId = String(this.ctx.state.myUserId || json.user_id || '');
          const myName = this.ctx.state.playerName || '';
          const me = json.multi_raid_member_info.find((m: any) => 
            (myId && String(m.user_id) === myId) || 
            (myName && (m.nickname === myName || m.name === myName)) ||
            (m.is_host && json.is_host)
          );
          if (me) {
            if (me.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(me.user_id);
            if (me.point !== undefined) {
              const pt = parseInt(String(me.point).replace(/,/g, ''), 10);
              if (!isNaN(pt) && pt > 0) directPoint = pt;
            }
          }
        }

        if (directPoint === null) {
          directPoint =
            (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
            (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
            (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null) ??
            (typeof json.player?.point === 'number' && json.player.point > 0 ? json.player.point : null);
        }

        const payloadKey = `${json.raid_id || 'battle'}_t${json.status?.turn || json.turn || ''}_hp${json.status?.boss?.param?.[0]?.hp ?? ''}`;

        if (directPoint !== null) {
          this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, directPoint);
          this.ctx.state.lastProcessedAttackKey = payloadKey;
        } else if (this.ctx.state.lastProcessedAttackKey !== payloadKey) {
          this.ctx.state.lastProcessedAttackKey = payloadKey;
          const turnDmg = CombatResolutionService.extractTurnDamage(json);
          if (turnDmg > 0) {
            const turnHonors = Math.floor(turnDmg / 100);
            this.ctx.state.currentScore += turnHonors;
          }
        }

        if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
        else if (json.turn !== undefined) this.ctx.state.currentTurn = Number(json.turn);

        let caCount = 0;
        if (Array.isArray(json.scenario)) {
          caCount = json.scenario.filter((ev: any) => ev && (ev.cmd === 'special' || ev.cmd === 'special_npc')).length;
        }
        const lockoutMs = caCount >= 5 ? 11500 : caCount === 4 ? 10000 : caCount === 3 ? 7800 : caCount === 2 ? 5500 : caCount === 1 ? 3400 : 1400;
        this.ctx.state.lastAttackLockoutExpires = Date.now() + lockoutMs;
      }

      const clientState = await this.page.evaluate((prevTurn: number, prevBossHp: number) => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;
        const currentTurn = Number(pJsn?.turn || gStatus?.turn || 0);
        const rawBoss = gStatus?.boss?.param || pJsn?.boss?.param || [];
        const firstBoss = Array.isArray(rawBoss) ? rawBoss[0] : Object.values(rawBoss || {})[0];
        const currentBossHp = firstBoss && (firstBoss as any).hp !== undefined ? Number((firstBoss as any).hp) : -1;

        const atkEl = document.querySelector('.btn-attack-start') as HTMLElement | null;
        const backEl = document.querySelector('.btn-command-back.display-on') as HTMLElement | null;
        const drawerOpen = Boolean(backEl && backEl.offsetParent !== null && window.getComputedStyle(backEl).display !== 'none');
        const atkHiddenAfterTap = Boolean(
          atkEl &&
          (atkEl.classList.contains('display-off') || atkEl.classList.contains('lock') || window.getComputedStyle(atkEl).display === 'none') &&
          !drawerOpen
        );
        const attackInProgress = Boolean(
          gStatus?.attacking === 1 ||
          gStatus?.attacking === true ||
          gStatus?.turn_ing === 1 ||
          atkHiddenAfterTap
        );

        return {
          currentTurn,
          turnAdvanced: prevTurn > 0 && currentTurn > prevTurn,
          bossHpDropped: prevBossHp > 0 && currentBossHp >= 0 && currentBossHp < prevBossHp,
          attackInProgress
        };
      }, baselineTurn, baselineBossHp).catch(() => ({
        currentTurn: 0,
        turnAdvanced: false,
        bossHpDropped: false,
        attackInProgress: false
      }));

      const serverTurnAdvanced = clientState.turnAdvanced || this.ctx.state.currentTurn > baselineTurn;
      const serverHonorsIncreased = this.ctx.state.currentScore > initialHonors;

      if (resolved || serverTurnAdvanced || serverHonorsIncreased || clientState.bossHpDropped) {
        if (clientState.currentTurn > this.ctx.state.currentTurn) {
          this.ctx.state.currentTurn = clientState.currentTurn;
        }
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Attack registered successfully (attempt ${attempt}). Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        this.stepMonitor.recordStepReceipt({
          runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
          stepNumber: this.ctx.state.activeStepNum || 1,
          step,
          status: resolved ? 'CONFIRMED_NETWORK' : 'CONFIRMED_STATE_MUTATION',
          verified: true,
          attempts: attempt,
          durationMs: 0,
          honorsGained: Math.max(0, this.ctx.state.currentScore - initialHonors),
          networkConfirmed: resolved,
          stateMutated: serverTurnAdvanced || serverHonorsIncreased || clientState.bossHpDropped,
          recastTransition: `T${baselineTurn}->T${this.ctx.state.currentTurn}`
        });
        await this.deps.combatResolution.getAndLogEnemyHp(`Turn ${this.ctx.state.currentTurn} Attack`);
        return true;
      }

      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Battle concluded during attack attempt. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        this.stepMonitor.recordStepReceipt({
          runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
          stepNumber: this.ctx.state.activeStepNum || 1,
          step,
          status: 'SKIPPED_BATTLE_ENDED',
          verified: true,
          attempts: attempt,
          durationMs: 0,
          honorsGained: Math.max(0, this.ctx.state.currentScore - initialHonors),
          networkConfirmed: false,
          stateMutated: true,
          reason: 'Battle concluded during attack attempt'
        });
        return true;
      }

      if (clientState.attackInProgress) {
        console.log(`[Combat] Attack already in progress on attempt ${attempt}/${maxAttempts}. Reloading (F5) to skip animation & sync turn...`);
        await this.executeFastAttackSyncReload(isTurbo);
        (this.ctx.state as any).lastAttackReloadedAt = Date.now();
        console.log(`[Combat] Attack synced via reload (attempt ${attempt}). Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        this.stepMonitor.recordStepReceipt({
          runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
          stepNumber: this.ctx.state.activeStepNum || 1,
          step,
          status: 'CONFIRMED_STATE_MUTATION',
          verified: true,
          attempts: attempt,
          durationMs: 0,
          honorsGained: Math.max(0, this.ctx.state.currentScore - initialHonors),
          networkConfirmed: false,
          stateMutated: true,
          recastTransition: `T${baselineTurn}->T${this.ctx.state.currentTurn}`
        });
        return true;
      }

      console.warn(`[Combat] Attack unacknowledged on attempt ${attempt}/${maxAttempts}. Checking if attack already executed & reloading (F5)...`);
      await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
      await this.executeFastAttackSyncReload(isTurbo);

      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        (this.ctx.state as any).lastAttackReloadedAt = Date.now();
        console.log(`[Combat] Battle concluded upon post-attack reload check. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        this.stepMonitor.recordStepReceipt({
          runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
          stepNumber: this.ctx.state.activeStepNum || 1,
          step,
          status: 'CONFIRMED_STATE_MUTATION',
          verified: true,
          attempts: attempt,
          durationMs: 0,
          honorsGained: Math.max(0, this.ctx.state.currentScore - initialHonors),
          networkConfirmed: false,
          stateMutated: true,
          reason: 'Battle concluded upon post-attack reload check'
        });
        return true;
      }

      const postReloadState = await this.page.evaluate((prevTurn: number, prevBossHp: number) => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;
        const currentTurn = Number(pJsn?.turn || gStatus?.turn || 0);
        const rawBoss = gStatus?.boss?.param || pJsn?.boss?.param || [];
        const firstBoss = Array.isArray(rawBoss) ? rawBoss[0] : Object.values(rawBoss || {})[0];
        const currentBossHp = firstBoss && (firstBoss as any).hp !== undefined ? Number((firstBoss as any).hp) : -1;
        return {
          currentTurn,
          turnAdvanced: prevTurn > 0 && currentTurn > prevTurn,
          bossHpDropped: prevBossHp > 0 && currentBossHp >= 0 && currentBossHp < prevBossHp
        };
      }, baselineTurn, baselineBossHp).catch(() => ({
        currentTurn: 0,
        turnAdvanced: false,
        bossHpDropped: false
      }));

      if (postReloadState.currentTurn > this.ctx.state.currentTurn) {
        this.ctx.state.currentTurn = postReloadState.currentTurn;
      }

      const confirmedAfterReload =
        postReloadState.turnAdvanced ||
        postReloadState.bossHpDropped ||
        this.ctx.state.currentTurn > baselineTurn ||
        this.ctx.state.currentScore > initialHonors;

      if (confirmedAfterReload) {
        (this.ctx.state as any).lastAttackReloadedAt = Date.now();
        console.log(`[Combat] Post-reload verification confirmed attack already executed (Turn ${baselineTurn} -> ${this.ctx.state.currentTurn}). Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        this.stepMonitor.recordStepReceipt({
          runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
          stepNumber: this.ctx.state.activeStepNum || 1,
          step,
          status: 'CONFIRMED_STATE_MUTATION',
          verified: true,
          attempts: attempt,
          durationMs: 0,
          honorsGained: Math.max(0, this.ctx.state.currentScore - initialHonors),
          networkConfirmed: false,
          stateMutated: true,
          recastTransition: `T${baselineTurn}->T${this.ctx.state.currentTurn}`
        });
        return true;
      }

      console.log(`[Combat] Post-reload check: attack not yet executed (Turn ${this.ctx.state.currentTurn || baselineTurn}). Retrying immediately on refreshed state...`);
    }

    this.stepMonitor.recordStepReceipt({
      runNumber: (this.ctx.state.totalCompletedRuns || 0) + 1,
      stepNumber: this.ctx.state.activeStepNum || 1,
      step,
      status: 'FAILED_TIMEOUT',
      verified: false,
      attempts: maxAttempts,
      durationMs: 0,
      networkConfirmed: false,
      stateMutated: false,
      reason: 'All 5 attack dispatch & reload verification attempts failed'
    });
    return false;
  }

  /**
   * Performs a fast in-combat reload to resync turn/honors state when an attack is already in progress or unacknowledged.
   */
  private async executeFastAttackSyncReload(isTurbo: boolean): Promise<void> {
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
      this.page.evaluate(() => location.reload()).catch(() => null)
    ]);
    await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
    await this.deps.combatResolution.waitForBattleToMount(isTurbo ? 4000 : 6000);
    await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
    await this.deps.combatResolution.syncCurrentHonors();
    const updatedTurn = await this.page.evaluate(() => {
      const stage = (window as any).stage;
      return Number(stage?.pJsnData?.turn || stage?.gGameStatus?.turn || 0);
    }).catch(() => 0);
    if (updatedTurn > 0) {
      this.ctx.state.currentTurn = updatedTurn;
    }
  }

  /**
   * Instant reload (F5) to skip animation frames.
   */
  public async handleReload(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const lastAttackReloadedAt = Number((this.ctx.state as any).lastAttackReloadedAt || 0);
    const alreadyReloadedByAttack = lastAttackReloadedAt > 0 && (Date.now() - lastAttackReloadedAt < 2000);
    (this.ctx.state as any).lastAttackReloadedAt = 0;

    if (alreadyReloadedByAttack) {
      console.log('[Combat] ⏩ Skipping redundant F5 reload (already reloaded during attack verification).');
    } else {
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
        this.page.evaluate(() => location.reload()).catch(() => null)
      ]);
      if (!isTurbo) await logNormalDelay(60, 0.1);
      await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
      await this.deps.combatResolution.waitForBattleToMount(isTurbo ? 5000 : 8000);
      await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
    }

    const isManual = this.isManualWorkflow();
    await this.page.evaluate((manual: boolean, targetFps: number) => {
      const cjs = (window as any).createjs;
      if (cjs?.Ticker) {
        cjs.Ticker.framerate = targetFps;
        if (typeof cjs.Ticker.setInterval === 'function') {
          cjs.Ticker.setInterval(1000 / targetFps);
        }
      }
      if (cjs?.Tween?.tick) {
        cjs.Tween.tick(2000, false);
      }
      const stage = (window as any).stage;
      const gStatus = stage?.gGameStatus;
      if (manual) {
        const auto = document.querySelector('.btn-auto, .btn-ability-auto, #btn-auto') as HTMLElement;
        const isAutoActive = gStatus?.auto_attack === 1 || gStatus?.auto_attack === true ||
          (auto && (auto.classList.contains('active') || auto.classList.contains('btn-auto-active')));
        if (auto && isAutoActive) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(auto).trigger('tap');
          else auto.click();
        }
      } else {
        const ready = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready') as HTMLElement;
        if (ready) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ready).trigger('tap');
          ready.click();
        }
      }
      const lockBtn = document.querySelector('.btn-lock.lock1') as HTMLElement;
      if (lockBtn && lockBtn.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(lockBtn).trigger('tap');
        lockBtn.click();
      }
    }, isManual, config.TICKER_FPS).catch(() => null);

    if (!isTurbo) await logNormalDelay(100, 0.1);

    // Wait out server-side Charge Attack (Ougi) lockout window before executing next turn's skills/summons
    // Only wait if there are subsequent combat actions in the pipeline (skip wait if reload is followed only by confirm_result)
    const remainingSteps = (this.ctx.template?.steps || []).slice(this.ctx.state.activeStepNum || 0);
    const hasSubsequentCombatSteps = remainingSteps.some(s =>
      ['skill', 'summon', 'quick_call', 'attack', 'tap_ready', 'repeat', 'smart_full_auto'].includes((s.code || s.action) as string)
    );
    if (hasSubsequentCombatSteps && this.ctx.state.lastAttackLockoutExpires > Date.now()) {
      const waitRemainingMs = this.ctx.state.lastAttackLockoutExpires - Date.now();
      if (waitRemainingMs > 400) {
        console.log(`[Combat] ⏳ Awaiting post-Ougi server lockout (${(waitRemainingMs / 1000).toFixed(1)}s remaining)...`);
        while (Date.now() < this.ctx.state.lastAttackLockoutExpires) {
          if (this.ctx.state.stopRequested) break;
          await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
          if (await this.deps.combatResolution.isBattleEnded()) break;
          await new Promise(r => setTimeout(r, 250));
        }
        await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
      }
    }

    await this.deps.combatResolution.syncCurrentHonors();
    const updatedTurn = await this.page.evaluate(() => {
      const stage = (window as any).stage;
      return Number(stage?.pJsnData?.turn || stage?.gGameStatus?.turn || 0);
    }).catch(() => 0);
    if (updatedTurn > 0) {
      this.ctx.state.currentTurn = updatedTurn;
    }

    await this.deps.combatResolution.getAndLogEnemyHp('Post-Reload');
    return true;
  }

  /**
   * Clicks an arbitrary selector with intelligent child-element unwrapping and dual-dispatch.
   */
  public async handleClick(step: WorkflowStep): Promise<boolean> {
    if (!step.target) return false;
    if (step.target === 'back' || step.target === 'back button') {
      const clickedDrawerBack = await this.page.evaluate(() => {
        const drawerBack = document.querySelector('.btn-command-back.display-on') as HTMLElement;
        if (drawerBack && drawerBack.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(drawerBack).trigger('tap');
          drawerBack.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (!clickedDrawerBack) {
        await this.page.evaluate(() => {
          window.history.back();
        }).catch(() => null);
      }
      return true;
    }
    const el = await this.page.waitForSelector(step.target, { visible: true, timeout: step.timeoutMs || 3000 }).catch(() => null);
    if (el) {
      const clicked = await this.page.evaluate((sel: string) => {
        const target = document.querySelector(sel) as HTMLElement;
        if (!target) return false;
        const clickable = target.matches('button, a, input, select, [role="button"]')
          ? target
          : (target.querySelector('button, a, input, [role="button"]') as HTMLElement) || target;
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(clickable).trigger('tap');
        clickable.click();
        return true;
      }, step.target).catch(() => false);

      if (!clicked) {
        await humanizedClick(this.page, el);
      }
      return true;
    }
    return step.optional ? true : false;
  }

  /**
   * Honors Guard: continues combat attack loop until minimum required honors are attained.
   */
  public async ensureMinimumHonors(minHonors = 1500000, maxExtraTurns = 25): Promise<void> {
    if (this.ctx.template.honorGuard === false || this.isSoloQuest()) return;

    const exitHpCutoff = this.ctx.template?.exitIfHpPct ?? (
      (!this.isSoloQuest() && (this.ctx.template?.targetEnemy === 'Seofon' || String(this.ctx.template?.targetRaidQuestId) === '305411')) ? 12 : undefined
    );
    if (exitHpCutoff !== undefined) {
      const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
      if (enemy && (enemy.isDefeated || enemy.hpPct <= exitHpCutoff)) {
        console.log(`[Honors Guard] Boss HP (${enemy.hpPct.toFixed(1)}%) already at or below cutoff threshold (${exitHpCutoff}%). Honors will not count past 10%; skipping extra attack turns.`);
        return;
      }
    }

    await this.deps.combatResolution.syncCurrentHonors();
    if (this.ctx.state.currentScore >= minHonors) {
      console.log(`[Honors Guard] Minimum honor met (${this.ctx.state.currentScore.toLocaleString()} >= ${minHonors.toLocaleString()} pt).`);
      return;
    }

    if (await this.deps.combatResolution.isBattleEnded()) {
      console.log(`[Honors Guard] Battle concluded with ${this.ctx.state.currentScore.toLocaleString()} pt.`);
      return;
    }

    console.log(`[Honors Guard] Current honors (${this.ctx.state.currentScore.toLocaleString()} pt) below minimum threshold (${minHonors.toLocaleString()} pt). Continuing attack loop...`);

    const usesTapReady = this.ctx.template.steps.some(s => s.code === 'tap_ready' || s.action === 'tap_ready');
    let consecutiveUnchangedTurns = 0;
    let lastObservedHonors = this.ctx.state.currentScore;

    for (let extra = 1; extra <= maxExtraTurns; extra++) {
      if (this.ctx.state.stopRequested) break;
      if (await this.deps.combatResolution.isBattleEnded()) {
        console.log('[Honors Guard] Battle concluded during extra turns.');
        break;
      }

      if (exitHpCutoff !== undefined) {
        const enemy = await this.deps.combatResolution.getAndLogEnemyHp();
        if (enemy && (enemy.isDefeated || enemy.hpPct <= exitHpCutoff)) {
          console.log(`[Honors Guard] 🏁 Boss HP (${enemy.hpPct.toFixed(1)}%) reached cutoff threshold (${exitHpCutoff}%). Honors will not count past 10%; exiting guard loop to check another raid.`);
          break;
        }
      }

      await this.deps.combatResolution.syncCurrentHonors();
      if (this.ctx.state.currentScore >= minHonors) {
        console.log(`[Honors Guard] Target honors reached on extra turn ${extra} (${this.ctx.state.currentScore.toLocaleString()} >= ${minHonors.toLocaleString()} pt).`);
        break;
      }

      if (extra > 1 && this.ctx.state.currentScore === lastObservedHonors) {
        consecutiveUnchangedTurns++;
        if (consecutiveUnchangedTurns >= 3) {
          console.log('[Honors Guard] Honors unchanged for 3 consecutive turns. Battle concluded or stalled; exiting guard loop.');
          break;
        }
      } else {
        consecutiveUnchangedTurns = 0;
      }
      lastObservedHonors = this.ctx.state.currentScore;

      const pct = ((this.ctx.state.currentScore / minHonors) * 100).toFixed(1);
      console.log(`[Honors Guard] Extra attack turn ${extra}/${maxExtraTurns} (Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${minHonors.toLocaleString()} pt - ${pct}%)...`);

      if (usesTapReady) {
        const ok = await this.handleTapReady({ code: 'tap_ready' });
        if (ok) {
          await this.handleReload({ code: 'reload' });
        } else {
          await this.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' });
          await this.handleReload({ code: 'reload' });
        }
      } else {
        await this.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' });
        await this.handleReload({ code: 'reload' });
      }

      await this.deps.combatResolution.syncCurrentHonors();
    }
  }

  /**
   * Concludes combat if the burst rotation completed but the enemy is still alive.
   * Dispatches attack + reload iterations until isBattleEnded() is true or maxExtraTurns reached.
   */
  public async ensureBattleConcluded(maxExtraTurns = 10): Promise<boolean> {
    let isEnded = await this.deps.combatResolution.isBattleEnded();
    if (isEnded) return true;

    console.log('[Combat] Burst steps completed, verifying battle conclusion...');
    let extraTurn = 0;
    while (!isEnded && extraTurn < maxExtraTurns) {
      if (this.ctx.state.stopRequested) return false;
      extraTurn++;
      console.log(`[Combat] Battle active after burst. Dispatching finisher turn ${extraTurn}/${maxExtraTurns}...`);

      await this.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' });
      await logNormalDelay(300, 0.1);

      await this.handleReload({ code: 'reload' });
      await logNormalDelay(300, 0.1);

      isEnded = await this.deps.combatResolution.isBattleEnded();
      if (isEnded) {
        console.log(`[Combat] Battle successfully concluded after ${extraTurn} finisher turn(s).`);
        return true;
      }
    }

    return isEnded;
  }
}


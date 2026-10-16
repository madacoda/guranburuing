// src/engines/universal/combat-execution.service.ts
import { Page } from 'puppeteer-core';
import { UniversalContext } from './types.js';
import { CombatResolutionService } from './combat-resolution.service.js';
import { WorkflowStep, isSoloWorkflowTemplate } from '../../types/workflow.types.js';
import { config } from '../../config.js';
import {
  humanizedClick,
  humanReactionDelay,
  randomDelay,
  logNormalDelay,
  sampleGaussian,
  getSpeedProfile
} from '../../human-motor.js';

export interface CombatExecutionDependencies {
  combatResolution: CombatResolutionService;
  executeSingleStep?: (step: WorkflowStep, stepNum: number, runNumber: number) => Promise<boolean>;
  isManualWorkflow?: () => boolean;
}

export class CombatExecutionService {
  constructor(
    private ctx: UniversalContext,
    private deps: CombatExecutionDependencies
  ) {}

  public get page(): Page {
    return this.ctx.page;
  }

  public isManualWorkflow(): boolean {
    if (this.deps.isManualWorkflow) return this.deps.isManualWorkflow();
    const mode = this.ctx.template.mode as string | undefined;
    if (mode === 'single' || mode === 'multi' || mode === 'routine' || mode === 'combat' || mode === 'manual') return true;
    if (mode === 'assist' || mode === 'auto' || mode === 'smart_auto') return false;

    const hasAuto = this.ctx.template.steps?.some(s => s.code === 'auto' || s.code === 'smart_full_auto');
    if (hasAuto) return false;

    const hasManualSteps = this.ctx.template.steps?.some(s =>
      s.code === 'skill' || s.code === 'attack' || s.code === 'summon' || s.code === 'quick_call' || s.code === 'wait_element'
    );
    return hasManualSteps || this.ctx.template.isSolo === true;
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

    const tempTrayBtn = await this.page.$('.btn-temporary, .btn-item');
    if (tempTrayBtn) {
      await humanizedClick(this.page, tempTrayBtn);
      await humanReactionDelay(120, 0.1);
    }

    const itemSelector = pType === 'green'
      ? '.lis-item[item-id="1"], .btn-item-small'
      : pType === 'blue'
      ? '.lis-item[item-id="2"], .btn-item-all'
      : '.lis-item[item-id="3"], .btn-item-elixir';

    const potionBtn = await this.page.waitForSelector(itemSelector, { visible: true, timeout: 2500 }).catch(() => null);
    if (potionBtn) {
      await humanizedClick(this.page, potionBtn);
      const okBtn = await this.page.waitForSelector('.btn-usual-ok.btn-item-use, .btn-usual-ok.se-use', { visible: true, timeout: 1500 }).catch(() => null);
      if (okBtn) await humanizedClick(this.page, okBtn);
      await logNormalDelay(250, 0.1);
      return true;
    }
    return false;
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
   * Reliably ensures the target character's ability tray is active, checks true readiness
   * via internal game state and DOM markers, dispatches clicks, and handles single-target popups.
   */
  public async handleSkill(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const isManual = this.isManualWorkflow();
    const char = step.character || 1;
    const skill = step.skill || 1;
    const charIdx = char - 1;

    if (isManual) {
      await this.deps.combatResolution.cancelFullAutoAndActionQueue();
    }

    // 1. Fast O(1) JavaScript game state inspection
    const jsSkillCheck = await this.page.evaluate((cNum: number, sNum: number) => {
      const stage = (window as any).stage;
      const pJsn = stage?.pJsnData;
      const abilityMap = pJsn?.ability || {};
      const charPos = cNum - 1;
      let charObj = abilityMap[String(cNum)] || abilityMap[String(charPos)];
      if (!charObj) {
        charObj = Object.values(abilityMap).find((o: any) => Number(o?.pos) === charPos);
      }
      if (charObj && charObj.list) {
        const ab = charObj.list[String(sNum)];
        const abilityData = Array.isArray(ab) ? ab[0] : ab;
        if (abilityData) {
          const recast = String(abilityData['ability-recast'] ?? '');
          const reqMet = abilityData['requirement_result_flag'] !== false;
          const isReady = (recast === '0' || recast === '') && reqMet;
          return { found: true, isReady, recast, name: abilityData['ability-name'] || '' };
        }
      }
      return { found: false, isReady: null, recast: '', name: '' };
    }, char, skill).catch(() => ({ found: false, isReady: null, recast: '', name: '' }));

    if (jsSkillCheck.found && jsSkillCheck.isReady === false) {
      console.log(`[Combat] Skill C${char}S${skill}${jsSkillCheck.name ? ` ("${jsSkillCheck.name}")` : ''} is on cooldown (${jsSkillCheck.recast} turns left). Skipping.`);
      return true;
    }

    // 2. Wait for combat HUD readiness
    await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 800 : 3000);
    if (await this.deps.combatResolution.isBattleEnded()) return true;

    // 3. Ensure Character `char`'s ability drawer is open
    let isDrawerOpen = await this.page.evaluate((targetIdx: number) => {
      const stage = (window as any).stage;
      const selectChara = stage?.gGameStatus?.select_character;
      const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
      const hasBack = back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none';
      if (hasBack && selectChara !== undefined && Number(selectChara) === targetIdx) {
        return true;
      }
      const charPortrait = document.querySelector(`.prt-command-chara[pos="${targetIdx}"], .lis-character${targetIdx}`);
      if (hasBack && charPortrait && (charPortrait.classList.contains('selected') || charPortrait.classList.contains('active'))) {
        return true;
      }
      return false;
    }, charIdx).catch(() => false);

    if (!isDrawerOpen) {
      const charSelector = `.prt-command-chara[pos="${charIdx}"] .btn-command-character, .lis-character${charIdx}.btn-command-character, .lis-character${charIdx}, div[pos="${charIdx}"].btn-command-character, .btn-command-character[pos="${charIdx}"]`;
      const maxOpenAttempts = step.ensureCast ? 5 : 3;

      for (let openAttempt = 1; openAttempt <= maxOpenAttempts; openAttempt++) {
        let charBtn = await this.page.waitForSelector(charSelector, { visible: true, timeout: isTurbo ? 1000 : 2500 }).catch(() => null);
        if (!charBtn) {
          await this.deps.combatResolution.dismissCombatDrawersAndPopups();
          await logNormalDelay(100, 0.1);
          charBtn = await this.page.waitForSelector(charSelector, { visible: true, timeout: isTurbo ? 1000 : 2500 }).catch(() => null);
        }

        if (charBtn) {
          await humanizedClick(this.page, charBtn);
          await charBtn.evaluate((el: any) => {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) {
              $(el).trigger('tap');
              $(el).trigger('click');
            }
            el.click();
          }).catch(() => null);

          // Wait for ability drawer to open specifically for character `char`
          isDrawerOpen = await this.page.waitForFunction((c: number, s: number) => {
            const stage = (window as any).stage;
            const selectChara = stage?.gGameStatus?.select_character;
            const cIdx = c - 1;
            if (selectChara !== undefined && Number(selectChara) === cIdx) return true;
            const specificBtn = document.querySelector(`.ability-character-num-${c}-${s}`);
            if (specificBtn && (specificBtn as HTMLElement).offsetParent !== null) return true;
            const charPortrait = document.querySelector(`.prt-command-chara[pos="${cIdx}"], .lis-character${cIdx}`);
            if (charPortrait && (charPortrait.classList.contains('selected') || charPortrait.classList.contains('active'))) return true;
            return false;
          }, { timeout: isTurbo ? 1200 : 2500 }, char, skill).then(() => true).catch(() => false);

          if (isDrawerOpen) break;
        }

        await this.deps.combatResolution.dismissCombatDrawersAndPopups();
        await logNormalDelay(150, 0.1);
      }

      if (!isDrawerOpen) {
        console.warn(`[Combat] Character portrait for C${char} drawer could not be opened!`);
        if (!step.optional) return false;
        return true;
      }
    }

    // 4. Evaluate skill availability (only if jsSkillCheck didn't already verify it is ready)
    if (jsSkillCheck.isReady !== true) {
      const domSkillCheck = await this.page.evaluate((cNum: number, sNum: number) => {
        const stage = (window as any).stage;
        const selectChara = stage?.gGameStatus?.select_character;
        if (selectChara !== undefined && Number(selectChara) !== cNum - 1) {
          return { found: false, ready: false, onCooldown: false };
        }

        const slotIdx = sNum - 1;
        const specificEl = document.querySelector(`.ability-character-num-${cNum}-${sNum}`) as HTMLElement;
        const listEl = document.querySelector(`.prt-ability-list .lis-ability[pos="${slotIdx}"], .prt-ability-list .lis-ability:nth-child(${sNum})`) as HTMLElement;
        const el = specificEl || listEl;

        if (!el || el.offsetParent === null) return { found: false, ready: false, onCooldown: false };

        const hasAvailableClass = el.classList.contains('btn-ability-available') || !!el.querySelector('.btn-ability-available');
        const hasUnavailableClass = el.classList.contains('btn-ability-unavailable') || el.classList.contains('btn-ability-off') || !!el.querySelector('.btn-ability-unavailable, .btn-ability-off');
        const hasEmptyOrDisabled = el.classList.contains('empty') || el.classList.contains('disabled');
        const recastAttr = el.getAttribute('ability-recast') || el.querySelector('[ability-recast]')?.getAttribute('ability-recast');
        const hasNonZeroRecast = recastAttr !== null && recastAttr !== '' && recastAttr !== '0';

        const onCooldown = hasUnavailableClass || hasEmptyOrDisabled || hasNonZeroRecast;
        const ready = hasAvailableClass || (!onCooldown && el.offsetParent !== null);

        return { found: true, ready, onCooldown };
      }, char, skill).catch(() => ({ found: false, ready: false, onCooldown: false }));

      if (domSkillCheck.found && domSkillCheck.onCooldown && !domSkillCheck.ready) {
        console.log(`[Combat] Skill C${char}S${skill} is on cooldown or unavailable. Skipping.`);
        return true;
      }
    }

    // 5. Locate skill button handle and dispatch click
    const skillSelectors = [
      `.ability-character-num-${char}-${skill} .btn-ability-available`,
      `.ability-character-num-${char}-${skill}`,
      `.prt-ability-list .lis-ability[pos="${skill - 1}"] .btn-ability-available`,
      `.prt-ability-list .lis-ability:nth-child(${skill}) .btn-ability-available`,
      `.prt-ability-list .lis-ability[pos="${skill - 1}"] [ability-id]`,
      `.prt-ability-list .lis-ability:nth-child(${skill}) [ability-id]`,
      `.prt-ability-list .lis-ability[pos="${skill - 1}"]`,
      `.prt-ability-list .lis-ability:nth-child(${skill})`
    ];

    const targetNet = step.waitForNetwork || 'ability_result.json';
    const maxCastTries = step.ensureCast ? 3 : 1;
    let clicked = false;

    for (let tryNum = 1; tryNum <= maxCastTries; tryNum++) {
      const netPromise = this.deps.combatResolution.waitForNetworkResponse(targetNet, isTurbo ? 2500 : 4500);

      for (const sel of skillSelectors) {
        clicked = await this.page.evaluate((s: string) => {
          const target = document.querySelector(s) as HTMLElement;
          if (!target || target.offsetParent === null) return false;
          if (target.classList.contains('btn-ability-unavailable') || target.classList.contains('btn-ability-off')) return false;
          const btn = ((target.classList.contains('btn-ability-available') ? target : target.querySelector('.btn-ability-available')) || target) as HTMLElement;
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(btn).trigger('tap');
            $(btn).trigger('click');
          }
          btn.click();
          return true;
        }, sel).catch(() => false);

        if (clicked) break;
      }

      if (!clicked) {
        for (const sel of skillSelectors) {
          const handle = await this.page.$(sel).catch(() => null);
          if (handle) {
            await humanizedClick(this.page, handle);
            clicked = true;
            break;
          }
        }
      }

      if (clicked) {
        console.log(`[Combat] ⚡ Cast Skill C${char}S${skill}${jsSkillCheck.name ? ` ("${jsSkillCheck.name}")` : ''}${step.ensureCast ? ' (Verified)' : ''}`);
        await netPromise;

        // 6. Handle single-target character selection modal if present
        await this.page.evaluate((targetIdx: number) => {
          const pop = document.querySelector('.pop-usual, .prt-popup-body, .pop-target');
          if (pop && (pop as HTMLElement).offsetParent !== null) {
            const targetChar = pop.querySelector(`.lis-character${targetIdx}, .btn-command-character[pos="${targetIdx}"], .lis-character0, .btn-command-character`) as HTMLElement;
            if (targetChar) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(targetChar).trigger('tap');
              targetChar.click();
            }
          }
        }, (step.targetCharacter ? step.targetCharacter - 1 : 0)).catch(() => null);

        // 7. Fast-tick animation and unlock UI
        await this.page.evaluate(() => {
          const cjs = (window as any).createjs;
          if (cjs?.Tween?.tick) cjs.Tween.tick(2500, false);
          const stage = (window as any).stage;
          if (stage?.gGameStatus) {
            stage.gGameStatus.lock = false;
            stage.gGameStatus.btn_lock = false;
            stage.gGameStatus.animation = false;
          }
        }).catch(() => null);

        await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 250 : 1000);
        await this.deps.combatResolution.getAndLogEnemyHp(`C${char}S${skill} Cast`);
        return true;
      }

      if (tryNum < maxCastTries) {
        console.log(`[Combat] Skill C${char}S${skill} cast attempt ${tryNum}/${maxCastTries} unconfirmed. Retrying...`);
        await new Promise(r => setTimeout(r, 200));
      }
    }

    if (step.optional) {
      console.log(`[Combat] Optional skill C${char}S${skill} skipped.`);
      return true;
    }

    return false;
  }

  /**
   * Uses a summon card from the summon tray.
   */
  public async handleSummon(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    let slot = (step as any).summonSlot || step.slot || 1;
    const targetName = ((step as any).summonName || '').toLowerCase().trim();

    // 1. Dismiss any open ability drawers or popups so summon controls are active
    await this.deps.combatResolution.dismissCombatDrawersAndPopups();
    await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 800 : 2500);
    if (await this.deps.combatResolution.isBattleEnded()) return true;

    // Fast O(1) JavaScript game state inspection for summon readiness
    const jsSummonCheck = await this.page.evaluate((targetSlot: number, targetNameStr: string) => {
      const stage = (window as any).stage;
      const rawSummons = stage?.pJsnData?.summon || stage?.gGameStatus?.summon;
      if (rawSummons) {
        const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);
        let resolvedSlot = targetSlot;
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
        const s: any = summonsList[sIdx] || summonsList.find((item: any) => Number(item?.pos) === sIdx);
        if (s) {
          const recast = String(s.recast ?? '');
          const isReady = s.available_flag === 1 || s.available_flag === true || recast === '0' || recast === '';
          return { found: true, isReady, recast, name: s.name || '', resolvedSlot };
        }
      }
      return { found: false, isReady: null, recast: '', name: '', resolvedSlot: targetSlot };
    }, slot, targetName).catch(() => ({ found: false, isReady: null, recast: '', name: '', resolvedSlot: slot }));

    if (jsSummonCheck.resolvedSlot && jsSummonCheck.resolvedSlot !== slot) {
      slot = jsSummonCheck.resolvedSlot;
      console.log(`[Workflow] Resolved summon "${targetName}" to slot ${slot}`);
    }

    if (jsSummonCheck.found && jsSummonCheck.isReady === false) {
      console.log(`[Combat] Summon slot ${slot}${jsSummonCheck.name ? ` ("${jsSummonCheck.name}")` : ''} is on cooldown (${jsSummonCheck.recast} turns left). Skipping.`);
      return true;
    }

    // 2. Open summon tray if not already open
    const isSummonOpen = await this.page.evaluate(() => {
      const slotEl = document.querySelector('.lis-summon, .btn-summon-use');
      const tab = document.querySelector('.btn-command-summon, .prt-command-summon');
      const isOpen = tab?.classList.contains('summon-on') || tab?.classList.contains('selected');
      return isOpen || (!!slotEl && (slotEl as HTMLElement).offsetWidth > 0 && window.getComputedStyle(slotEl).display !== 'none');
    }).catch(() => false);

    if (!isSummonOpen) {
      const summonTrayBtn = await this.page.$('.prt-list-top.btn-command-summon:not(.summon-on), .btn-command-summon, .btn-summon-available, .prt-command-summon');
      if (summonTrayBtn) {
        await humanizedClick(this.page, summonTrayBtn);
        await summonTrayBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          el.click();
        }).catch(() => null);
        if (!isTurbo) await humanReactionDelay(180, 0.1);
      }
    }

    // 3. Locate target summon slot button (in GBF, pos attribute is 0-indexed: slot 1 is pos 0, slot 4 is pos 3)
    const targetPos = slot - 1;
    const summonSelectors = [
      `.lis-summon[pos="${targetPos}"]`,
      `.btn-summon-use[pos="${targetPos}"]`,
      `div[pos="${targetPos}"].lis-summon`,
      `.lis-summon:nth-child(${slot})`,
      `.lis-summon.summon-${slot}`,
      `.lis-summon[pos="${slot}"]`,
      `.btn-summon-use[pos="${slot}"]`
    ];

    let summonSlot: any = null;
    for (const sel of summonSelectors) {
      summonSlot = await this.page.waitForSelector(sel, { visible: true, timeout: isTurbo ? 1000 : 2500 }).catch(() => null);
      if (summonSlot) break;
    }

    if (!summonSlot) {
      const allSummons = await this.page.$$('.lis-summon, .btn-summon-use');
      if (allSummons && allSummons.length >= slot) {
        summonSlot = allSummons[slot - 1];
      }
    }

    if (summonSlot) {
      const isUnavailable = await summonSlot.evaluate((el: any) => {
        return el.classList.contains('btn-summon-unavailable') ||
               el.classList.contains('off') ||
               el.classList.contains('disabled');
      }).catch(() => false);

      if (isUnavailable && (jsSummonCheck.isReady === false || !jsSummonCheck.found)) {
        console.log(`[Combat] Summon slot ${slot} is on cooldown or unavailable.`);
        if (step.optional) return true;
        return false;
      }

      const targetNet = step.waitForNetwork || 'summon_result.json';
      const netPromise = this.deps.combatResolution.waitForNetworkResponseAndPayload(targetNet, isTurbo ? 2500 : 4500);

      await humanizedClick(this.page, summonSlot);
      await summonSlot.evaluate((el: any) => {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(el).trigger('tap');
        el.click();
      }).catch(() => null);
      if (!isTurbo) await logNormalDelay(150, 0.1);

      // 4. Click Call confirmation button
      const okBtn = await this.page.waitForSelector(
        '.btn-usual-ok.btn-summon-use, .pop-summon-detail .btn-usual-ok, .pop-usual.pop-show .btn-usual-ok, .btn-summon-use, .btn-call, .se-summon-call, #pop .btn-usual-ok, .btn-usual-ok',
        { visible: true, timeout: isTurbo ? 1200 : 2500 }
      ).catch(() => null);

      if (okBtn) {
        await humanizedClick(this.page, okBtn);
        await okBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(el).trigger('tap');
          el.click();
        }).catch(() => null);
      }

      console.log(`[Combat] 🔮 Invoked Summon Slot ${slot}. Awaiting resolution...`);
      const netRes = await netPromise;
      if (netRes.json) {
        const summonDmg = CombatResolutionService.extractTurnDamage(netRes.json);
        if (summonDmg > 0) {
          const summonHonors = Math.floor(summonDmg / 100);
          this.ctx.state.currentScore += summonHonors;
        }
      }

      // 5. Fast-tick animation and unlock UI
      await this.page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(3000, false);
        }
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }
        const pop = document.querySelector('.pop-summon-detail, .pop-usual.pop-show, .prt-popup-header .btn-close') as HTMLElement;
        if (pop && pop.offsetParent !== null) {
          const close = pop.querySelector('.btn-close, .btn-usual-ok, .btn-usual-cancel') as HTMLElement;
          if (close) close.click();
        }
      }).catch(() => null);

      await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 350 : 1500);
      await this.deps.combatResolution.getAndLogEnemyHp(`Summon Slot ${slot}`);
      return true;
    }

    if (step.optional) {
      console.log(`[Combat] Optional summon slot ${slot} skipped.`);
      return true;
    }

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
        await this.deps.combatResolution.waitForNetworkResponse('ability_result.json', 3500);

        if (skill.requiresPick) {
          await this.page.evaluate(() => {
            const targetChar = document.querySelector('.lis-character0, .btn-command-character[pos="0"]') as HTMLElement;
            if (targetChar) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(targetChar).trigger('tap');
              targetChar.click();
            }
          }).catch(() => null);
          await logNormalDelay(150, 0.1);
        }

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
   */
  public async handleTapReady(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const targetNet = step.waitForNetwork || 'normal_attack_result.json';
    const initialTurn = this.ctx.state.currentTurn;
    const initialHonors = this.ctx.state.currentScore;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.ctx.state.stopRequested) return false;

      await this.deps.combatResolution.waitForBattleToMount(8000);
      if (await this.deps.combatResolution.isBattleEnded()) return true;

      await this.page.evaluate(() => {
        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          back.click();
        }
      }).catch(() => null);
      await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
      await this.deps.combatResolution.dismissCombatDrawersAndPopups();

      await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 500 : 2500);
      if (await this.deps.combatResolution.isBattleEnded()) return true;

      if (this.ctx.state.currentTurn > initialTurn || (this.ctx.state.currentScore > initialHonors && initialHonors > 0)) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] [tap_ready] Turn already resolved (${this.ctx.state.currentScore.toLocaleString()} pt).`);
        return true;
      }

      await this.page.evaluate((targetFps: number) => {
        const cjs = (window as any).createjs;
        if (cjs?.Ticker) {
          cjs.Ticker.framerate = targetFps;
          if (typeof cjs.Ticker.setInterval === 'function') cjs.Ticker.setInterval(1000 / targetFps);
        }
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(2000, false);
        }
        const readyEl = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready');
        if (readyEl) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(readyEl).trigger('tap');
          (readyEl as HTMLElement).click();
        }
      }, config.TICKER_FPS).catch(() => null);

      const combatPromise = this.deps.combatResolution.waitForCombatTurnResolution(targetNet, isTurbo ? 6000 : 12000);

      let attackDispatched = false;

      const atkBtn = await this.page.waitForFunction(() => {
        const back = document.querySelector('.btn-command-back.display-on') as HTMLElement;
        if (back && back.offsetWidth > 0 && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          back.click();
          return false;
        }
        const el = document.querySelector('.btn-attack-start') as HTMLElement;
        if (!el || el.offsetWidth === 0 || window.getComputedStyle(el).display === 'none') return false;
        const isLocked = el.classList.contains('display-off') || el.classList.contains('lock');
        return !isLocked;
      }, { timeout: isTurbo ? 800 : 2500 }).then(() => this.page.$('.btn-attack-start')).catch(() => null);

      if (atkBtn) {
        await humanizedClick(this.page, atkBtn);
        await atkBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(el).trigger('tap');
            $(el).trigger('click');
          }
          el.click();
        }).catch(() => null);
        attackDispatched = true;
      } else {
        const autoBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto, #btn-auto', { visible: true, timeout: 1000 }).catch(() => null);
        if (autoBtn) {
          console.log('[Combat] [tap_ready] Attack button in cooldown; engaging Auto...');
          await humanizedClick(this.page, autoBtn);
          attackDispatched = true;
        }
      }

      if (!attackDispatched) {
        const vp = this.page.viewport() || { width: 480, height: 960 };
        const atkX = Math.round(vp.width * 0.75);
        const atkY = Math.round(vp.height * 0.46);
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
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] [tap_ready] Turn resolved successfully on attempt ${attempt}. Honors: ${this.ctx.state.currentScore.toLocaleString()} pt.`);
        return true;
      }

      if (await this.deps.combatResolution.isBattleEnded()) {
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
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    await this.deps.combatResolution.dismissCombatDrawersAndPopups();
    await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 600 : 3000);
    if (await this.deps.combatResolution.isBattleEnded()) return true;

    const qBtn = await this.page.waitForSelector('.btn-quick-summon, #js-btn-quick-summon', { visible: true, timeout: 2500 }).catch(() => null);
    if (qBtn) {
      const isUnavailable = await qBtn.evaluate((el: any) => {
        return el.classList.contains('btn-summon-unavailable') ||
               el.classList.contains('off') ||
               el.classList.contains('disabled') ||
               el.getAttribute('aria-disabled') === 'true' ||
               el.style.opacity === '0.5';
      }).catch(() => false);

      if (isUnavailable) {
        console.log('[Workflow] Quick Summon button disabled or already invoked this turn. Continuing...');
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
      if (netRes.json) {
        const qDmg = CombatResolutionService.extractTurnDamage(netRes.json);
        if (qDmg > 0) {
          const qHonors = Math.floor(qDmg / 100);
          this.ctx.state.currentScore += qHonors;
        }
      }

      await this.page.evaluate(() => {
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) {
          cjs.Tween.tick(3000, false);
        }
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }
      }).catch(() => null);

      await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 400 : 2500);
      await this.deps.combatResolution.getAndLogEnemyHp('Quick Call');
      return true;
    }
    return step.optional ? true : false;
  }

  /**
   * Executes Attack action with ability drawer dismissal, dynamic coordinate targeting,
   * network confirmation (normal_attack_result.json), and an automated retry loop.
   */
  public async handleAttack(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';

    // HonorGuard: Suppress attack immediately if targetScore has already been met
    if (this.ctx.template.honorGuard !== false && this.ctx.template.targetScore && this.ctx.state.currentScore >= this.ctx.template.targetScore) {
      console.log(`[Combat] Target score already satisfied (${this.ctx.state.currentScore.toLocaleString()} >= ${this.ctx.template.targetScore.toLocaleString()} pt). Suppressing attack.`);
      return true;
    }

    const targetNet = step.waitForNetwork || 'normal_attack_result.json';
    const maxAttempts = 3;
    const initialTurn = this.ctx.state.currentTurn;
    const initialHonors = this.ctx.state.currentScore;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.ctx.state.stopRequested) return false;
      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Battle concluded before attack attempt ${attempt}. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        return true;
      }

      await this.deps.combatResolution.dismissCombatDrawersAndPopups();

      await this.deps.combatResolution.waitForCombatInputReady(isTurbo ? 500 : 3000);
      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Battle concluded before attack dispatch. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        return true;
      }

      let atkBtn = await this.page.waitForFunction(() => {
        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          back.click();
        }
        const el = document.querySelector('.btn-attack-start') as HTMLElement;
        if (!el || el.offsetWidth === 0 || window.getComputedStyle(el).display === 'none') return false;
        const isReady = el.classList.contains('display-on') && !el.classList.contains('lock') && !el.classList.contains('display-off');
        return isReady;
      }, { timeout: isTurbo ? 1200 : 3000 }).then(() => this.page.$('.btn-attack-start.display-on, .btn-attack-start')).catch(() => null);

      if (!atkBtn) {
        await this.deps.combatResolution.dismissCombatDrawersAndPopups();
        atkBtn = await this.page.$('.btn-attack-start.display-on, .btn-attack-start');
      }

      if (this.ctx.template.humanMotor !== false && !isTurbo) {
        // Natural ocular-motor reaction latency (120ms - 220ms) before striking attack
        await logNormalDelay(160, 0.18);
      }

      const netPromise = this.deps.combatResolution.waitForNetworkResponseAndPayload(targetNet, isTurbo ? 3500 : 5000);

      let tapped = false;
      if (atkBtn) {
        const box = await atkBtn.boundingBox();
        if (box && box.width > 0 && box.height > 0) {
          const tapX = Math.round(box.x + box.width / 2 + (isTurbo ? 0 : sampleGaussian(0, 3)));
          const tapY = Math.round(box.y + box.height / 2 + (isTurbo ? 0 : sampleGaussian(0, 2)));
          await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
          await this.page.mouse.click(tapX, tapY).catch(() => null);
          tapped = true;
        } else {
          await humanizedClick(this.page, atkBtn);
          tapped = true;
        }

        await atkBtn.evaluate((el: any) => {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) {
            $(el).trigger('tap');
            $(el).trigger('click');
          }
          el.click();
        }).catch(() => null);
        tapped = true;
      }

      if (!tapped) {
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
        this.ctx.state.lastAttackLockoutExpires = Date.now() + 2400;
      }

      const clientState = await this.page.evaluate((prevTurn) => {
        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const currentTurn = Number(stage?.pJsnData?.turn || gStatus?.turn || 0);
        return { turnAdvanced: currentTurn > prevTurn };
      }, this.ctx.state.currentTurn).catch(() => ({ turnAdvanced: false }));

      const serverTurnAdvanced = clientState.turnAdvanced || this.ctx.state.currentTurn > initialTurn;
      const serverHonorsIncreased = this.ctx.state.currentScore > initialHonors;

      if (resolved || serverTurnAdvanced || serverHonorsIncreased) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Attack registered successfully (attempt ${attempt}). Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        await this.deps.combatResolution.getAndLogEnemyHp(`Turn ${this.ctx.state.currentTurn} Attack`);
        return true;
      }

      if (await this.deps.combatResolution.isBattleEnded()) {
        await this.deps.combatResolution.syncCurrentHonors();
        console.log(`[Combat] Battle concluded during attack attempt. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`);
        return true;
      }

      console.warn(`[Combat] Attack unacknowledged on attempt ${attempt}/${maxAttempts}. Retrying immediately...`);
      if (!isTurbo) await logNormalDelay(200, 0.12);
    }

    return false;
  }

  /**
   * Instant reload (F5) to skip animation frames.
   */
  public async handleReload(step: WorkflowStep): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
      this.page.evaluate(() => location.reload()).catch(() => null)
    ]);
    if (!isTurbo) await logNormalDelay(100, 0.1);
    await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();
    await this.deps.combatResolution.waitForBattleToMount(isTurbo ? 5000 : 8000);
    await this.deps.combatResolution.checkAndDismissProcessingTurnPopup();

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
      if (manual) {
        const auto = document.querySelector('.btn-auto, .btn-ability-auto, #btn-auto') as HTMLElement;
        if (auto && (auto.classList.contains('display-on') || auto.classList.contains('active') || auto.classList.contains('full'))) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(auto).trigger('tap');
          auto.click();
        }
      } else {
        const ready = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready') as HTMLElement;
        if (ready) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ready).trigger('tap');
          ready.click();
        }
      }
    }, isManual, config.TICKER_FPS).catch(() => null);

    if (!isTurbo) await logNormalDelay(100, 0.1);

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


// src/engines/universal/step-execution-monitor.service.ts
import { Page } from 'puppeteer-core';
import { UniversalContext } from './types.js';
import {
  WorkflowStep,
  StepExecutionOutcomeStatus,
  StepStateSnapshot,
  StepExecutionReceipt,
  RunExecutionAuditReport
} from '../../types/workflow.types.js';
import { CombatResolutionService } from './combat-resolution.service.js';

export interface SkillVerificationProbe {
  recast: string;
  abilityId: string;
  abilityName: string;
  isUnavailableInDom: boolean;
  inRail: boolean;
  railCount: number;
  bossHp: number;
  turn: number;
  battleEnded: boolean;
}

/**
 * Dedicated Step Execution Monitor & Verification Oracle.
 * Adheres to SRP: Captures pre/post in-game combat snapshots, verifies whether
 * skills/summons/attacks genuinely executed via dual network + DOM/stage state proof,
 * and maintains a structured per-step execution ledger and run audit report.
 */
export class StepExecutionMonitorService {
  constructor(private ctx: UniversalContext) {}

  private get page(): Page {
    return this.ctx.page;
  }

  /**
   * Initializes the step execution ledger at the start of a workflow run.
   */
  public beginRun(runNumber: number): void {
    this.ctx.state.currentRunStepReceipts = [];
    this.ctx.state.lastStepReceipt = null;
    this.ctx.state.activeStepNum = 0;
    if (this.ctx.state.networkSequenceId === undefined) {
      this.ctx.state.networkSequenceId = 0;
    }
  }

  /**
   * Formats a human-readable label for a workflow step.
   */
  public static formatStepLabel(step: WorkflowStep, dynamicName?: string): string {
    const code = step.code || step.action || 'custom';
    const nameSuffix = dynamicName
      ? ` ("${dynamicName}")`
      : step.name
      ? ` ("${step.name}")`
      : '';

    if (code === 'skill') {
      const c = step.character || 1;
      const s = step.skill || 1;
      const tgt = step.targetCharacter ? ` -> C${step.targetCharacter}` : '';
      return `SKILL C${c}S${s}${tgt}${nameSuffix}`;
    }

    if (code === 'summon') {
      const slot = (step as any).summonSlot || step.slot || 1;
      return `SUMMON Slot ${slot}${nameSuffix}`;
    }

    if (code === 'quick_call') {
      return `QUICK_CALL${nameSuffix}`;
    }

    if (code === 'attack') {
      return `ATTACK${nameSuffix}`;
    }

    if (code === 'tap_ready') {
      return `TAP_READY${nameSuffix}`;
    }

    if (code === 'reload' || code === 'f5') {
      return `RELOAD (F5)${nameSuffix}`;
    }

    return `${String(code).toUpperCase()}${nameSuffix}`;
  }

  /**
   * Captures a pre- or post-step snapshot of the in-game combat state.
   */
  public async captureCombatSnapshot(options?: {
    character?: number;
    skill?: number;
    summonSlot?: number;
  }): Promise<StepStateSnapshot> {
    const netSeq = this.ctx.state.networkSequenceId || 0;
    const honors = this.ctx.state.currentScore || 0;
    const fallbackTurn = this.ctx.state.currentTurn || 1;

    try {
      const raw = await this.page.evaluate(
        (cNum?: number, sNum?: number, sumSlot?: number) => {
          const stage = (window as any).stage;
          const pJsn = stage?.pJsnData;
          const gStatus = stage?.gGameStatus;

          const turn = Number(pJsn?.turn || gStatus?.turn || 1) || 1;
          let wave = 1;
          if (pJsn?.battle && typeof pJsn.battle === 'object') {
            wave = Number(pJsn.battle.count ?? pJsn.battle.current ?? 1);
          } else if (gStatus?.battle && typeof gStatus.battle === 'object') {
            wave = Number(gStatus.battle.count ?? gStatus.battle.current ?? 1);
          } else {
            wave = Number(gStatus?.wave ?? pJsn?.battle ?? gStatus?.battle ?? 1) || 1;
          }

          const rawBoss = gStatus?.boss?.param || pJsn?.boss?.param || [];
          const bosses = Array.isArray(rawBoss) ? rawBoss : Object.values(rawBoss || {});
          const activeBoss: any =
            bosses.find((b: any) => b && b.hp !== undefined && Number(b.hp) > 0) || bosses[0];
          const bossHp = activeBoss && activeBoss.hp !== undefined ? Math.max(0, Number(activeBoss.hp)) : 0;
          const bossMaxHp = activeBoss && activeBoss.hpmax !== undefined ? Math.max(0, Number(activeBoss.hpmax)) : 0;
          const bossHpPct = bossMaxHp > 0 ? (bossHp / bossMaxHp) * 100 : 100;

          const railDomItems = document.querySelectorAll(
            '.prt-ability-rail .lis-ability, .prt-ability-rail .ico-ability, .prt-ability-rail [ability-id]'
          );
          const queueArr = Array.isArray(gStatus?.ability_queue)
            ? gStatus.ability_queue
            : Array.isArray(stage?.gAbilityQueue)
            ? stage.gAbilityQueue
            : [];
          const railCount = Math.max(railDomItems ? railDomItems.length : 0, queueArr.length);

          let abilityId = '';
          let abilityName = '';
          let recast = '';

          if (cNum !== undefined && sNum !== undefined) {
            const charPos = cNum - 1;
            const slotIdx = sNum - 1;
            const abilityMap = pJsn?.ability || gStatus?.ability || {};
            let charObj = abilityMap[String(cNum)] || abilityMap[String(charPos)];
            if (!charObj) {
              charObj = Object.values(abilityMap).find((o: any) => Number(o?.pos) === charPos);
            }
            const abEntry = charObj?.list ? charObj.list[String(sNum)] : undefined;
            const abData = Array.isArray(abEntry) ? abEntry[0] : abEntry;
            if (abData) {
              abilityId = String(abData['ability-id'] ?? '');
              abilityName = String(abData['ability-name'] ?? '');
              recast = String(abData['ability-recast'] ?? '');
            }

            const domEl = (
              document.querySelector(`.ability-character-num-${cNum}-${sNum}`) ||
              document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability[pos="${slotIdx}"]`)
            ) as HTMLElement | null;
            if (domEl) {
              const container = ((typeof domEl.closest === 'function' ? domEl.closest('.lis-ability') : null) || domEl) as HTMLElement;
              const getAttr = (el: any, attr: string) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null);
              const querySub = (el: any, sel: string) => (el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null);

              const domRecast =
                getAttr(container, 'ability-recast') ||
                getAttr(domEl, 'ability-recast') ||
                getAttr(querySub(container, '[ability-recast]'), 'ability-recast') ||
                '';
              const domName =
                getAttr(container, 'ability-name') ||
                getAttr(domEl, 'ability-name') ||
                getAttr(querySub(container, '[ability-name]'), 'ability-name') ||
                '';
              const domId =
                getAttr(container, 'ability-id') ||
                getAttr(domEl, 'ability-id') ||
                getAttr(querySub(container, '[ability-id]'), 'ability-id') ||
                '';

              if (domRecast !== '') recast = domRecast;
              if (!abilityName && domName) abilityName = domName;
              if (!abilityId && domId) abilityId = domId;
            }
          } else if (sumSlot !== undefined) {
            const rawSummons = gStatus?.summon || pJsn?.summon;
            if (rawSummons) {
              const summonsList = Array.isArray(rawSummons) ? rawSummons : Object.values(rawSummons);
              const s: any =
                sumSlot === 6 && (gStatus?.supporter || pJsn?.supporter)
                  ? gStatus?.supporter || pJsn?.supporter
                  : summonsList.find((item: any) => Number(item?.pos) === sumSlot) || summonsList[sumSlot - 1];
              if (s) {
                abilityId = String(s.id ?? '');
                abilityName = String(s.name ?? '');
                recast = String(s.recast ?? '');
              }
            }
            const domSum = document.querySelector(`.lis-summon[pos="${sumSlot}"]`) as HTMLElement | null;
            if (domSum && typeof domSum.getAttribute === 'function') {
              const domRecast = domSum.getAttribute('summon-recast') || domSum.getAttribute('recast') || '';
              const domName = domSum.getAttribute('summon-name') || '';
              if (domRecast !== '') recast = domRecast;
              if (!abilityName && domName) abilityName = domName;
            }
          }

          return {
            turn,
            wave,
            bossHp,
            bossMaxHp,
            bossHpPct,
            abilityId,
            abilityName,
            recast,
            railCount
          };
        },
        options?.character,
        options?.skill,
        options?.summonSlot
      );

      return {
        timestamp: Date.now(),
        turn: raw?.turn || fallbackTurn,
        wave: raw?.wave || 1,
        bossHp: raw?.bossHp ?? 0,
        bossMaxHp: raw?.bossMaxHp ?? 0,
        bossHpPct: raw?.bossHpPct ?? 100,
        honors,
        abilityId: raw?.abilityId || undefined,
        abilityName: raw?.abilityName || undefined,
        recast: raw?.recast !== undefined ? raw.recast : undefined,
        railCount: raw?.railCount ?? 0,
        networkSequenceId: netSeq
      };
    } catch {
      return {
        timestamp: Date.now(),
        turn: fallbackTurn,
        wave: 1,
        bossHp: 0,
        bossMaxHp: 0,
        bossHpPct: 100,
        honors,
        networkSequenceId: netSeq
      };
    }
  }

  /**
   * Probes the live in-page state for a specific character skill to determine if it has
   * transitioned to cast/cooldown or queued state, even if a network event was coalesced.
   */
  public async probeSkillCastState(
    character: number,
    skill: number,
    expectedAbilityId?: string
  ): Promise<SkillVerificationProbe> {
    try {
      return await this.page.evaluate(
        (cNum: number, sNum: number, abId: string) => {
          const stage = (window as any).stage;
          const pJsn = stage?.pJsnData;
          const gStatus = stage?.gGameStatus;
          const charPos = cNum - 1;
          const slotIdx = sNum - 1;

          const firstBoss = pJsn?.boss?.param?.[0] || gStatus?.boss?.param?.[0];
          const bossHp = firstBoss && firstBoss.hp !== undefined ? Number(firstBoss.hp) : -1;
          const bossDead = bossHp !== -1 && bossHp <= 0;
          const battleEnded = Boolean(
            gStatus?.win || gStatus?.lose || pJsn?.is_clear || pJsn?.finish || pJsn?.is_defeat || bossDead
          );
          const turn = Number(pJsn?.turn || gStatus?.turn || 1) || 1;

          const railDomItems = Array.from(
            document.querySelectorAll(
              '.prt-ability-rail .lis-ability, .prt-ability-rail .ico-ability, .prt-ability-rail [ability-id]'
            )
          ) as HTMLElement[];
          const queueArr = Array.isArray(gStatus?.ability_queue)
            ? gStatus.ability_queue
            : Array.isArray(stage?.gAbilityQueue)
            ? stage.gAbilityQueue
            : [];
          const railCount = Math.max(railDomItems.length, queueArr.length);
          const inRail = Boolean(
            abId &&
              (railDomItems.some(el => typeof el.getAttribute === 'function' && el.getAttribute('ability-id') === abId) ||
                queueArr.some((item: any) => String(item?.ability_id || item?.id || '') === abId))
          );

          let recast = '';
          let abilityId = abId || '';
          let abilityName = '';

          const abilityMap = pJsn?.ability || gStatus?.ability || {};
          let charObj = abilityMap[String(cNum)] || abilityMap[String(charPos)];
          if (!charObj) {
            charObj = Object.values(abilityMap).find((o: any) => Number(o?.pos) === charPos);
          }
          const abEntry = charObj?.list ? charObj.list[String(sNum)] : undefined;
          const abData = Array.isArray(abEntry) ? abEntry[0] : abEntry;
          if (abData) {
            recast = String(abData['ability-recast'] ?? '');
            if (!abilityId) abilityId = String(abData['ability-id'] ?? '');
            abilityName = String(abData['ability-name'] ?? '');
          }

          let isUnavailableInDom = false;
          const domEl = (
            document.querySelector(`.ability-character-num-${cNum}-${sNum}`) ||
            document.querySelector(`.prt-command-chara.chara${cNum} .prt-ability-list .lis-ability[pos="${slotIdx}"]`)
          ) as HTMLElement | null;
          if (domEl) {
            const container = ((typeof domEl.closest === 'function' ? domEl.closest('.lis-ability') : null) || domEl) as HTMLElement;
            const getAttr = (el: any, attr: string) => (el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null);
            const querySub = (el: any, sel: string) => (el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null);

            const domRecast =
              getAttr(container, 'ability-recast') ||
              getAttr(domEl, 'ability-recast') ||
              getAttr(querySub(container, '[ability-recast]'), 'ability-recast') ||
              '';
            if (domRecast !== '') recast = domRecast;

            const domName =
              getAttr(container, 'ability-name') ||
              getAttr(domEl, 'ability-name') ||
              getAttr(querySub(container, '[ability-name]'), 'ability-name') ||
              '';
            if (!abilityName && domName) abilityName = domName;

            isUnavailableInDom =
              Boolean(container.classList?.contains('btn-ability-unavailable')) ||
              Boolean(container.classList?.contains('btn-ability-off')) ||
              Boolean(container.classList?.contains('tmp-unusable')) ||
              Boolean(domEl.classList?.contains('btn-ability-unavailable')) ||
              Boolean(domEl.classList?.contains('btn-ability-off')) ||
              Boolean(domEl.classList?.contains('tmp-unusable')) ||
              Boolean(querySub(container, '.btn-ability-unavailable, .btn-ability-off, .tmp-unusable'));
          }

          return {
            recast,
            abilityId,
            abilityName,
            isUnavailableInDom,
            inRail,
            railCount,
            bossHp,
            turn,
            battleEnded
          };
        },
        character,
        skill,
        expectedAbilityId || ''
      );
    } catch {
      return {
        recast: '',
        abilityId: expectedAbilityId || '',
        abilityName: '',
        isUnavailableInDom: false,
        inRail: false,
        railCount: 0,
        bossHp: -1,
        turn: this.ctx.state.currentTurn || 1,
        battleEnded: false
      };
    }
  }

  /**
   * Records a structured step execution receipt, updates run/session counters,
   * and logs a clear monitoring line for combat actions.
   */
  public recordStepReceipt(params: {
    runNumber: number;
    stepNumber: number;
    step: WorkflowStep;
    dynamicName?: string;
    status: StepExecutionOutcomeStatus;
    verified: boolean;
    attempts: number;
    durationMs: number;
    damageDealt?: number;
    honorsGained?: number;
    preState?: StepStateSnapshot;
    postState?: StepStateSnapshot;
    networkConfirmed: boolean;
    stateMutated: boolean;
    recastTransition?: string;
    reason?: string;
    silent?: boolean;
  }): StepExecutionReceipt {
    const stepCode = String(params.step.code || params.step.action || 'custom');
    const stepLabel = StepExecutionMonitorService.formatStepLabel(params.step, params.dynamicName);

    const receipt: StepExecutionReceipt = {
      runNumber: params.runNumber,
      stepNumber: params.stepNumber,
      stepCode,
      stepLabel,
      status: params.status,
      verified: params.verified,
      attempts: Math.max(1, params.attempts),
      durationMs: Math.max(0, params.durationMs),
      damageDealt: params.damageDealt || 0,
      honorsGained: params.honorsGained || 0,
      preState: params.preState,
      postState: params.postState,
      networkConfirmed: params.networkConfirmed,
      stateMutated: params.stateMutated,
      recastTransition: params.recastTransition,
      reason: params.reason
    };

    if (!this.ctx.state.currentRunStepReceipts) {
      this.ctx.state.currentRunStepReceipts = [];
    }
    this.ctx.state.currentRunStepReceipts.push(receipt);
    this.ctx.state.lastStepReceipt = receipt;

    if (receipt.attempts > 1) {
      this.ctx.state.totalStepRetries = (this.ctx.state.totalStepRetries || 0) + (receipt.attempts - 1);
    }
    if (!receipt.verified) {
      this.ctx.state.totalFailedSteps = (this.ctx.state.totalFailedSteps || 0) + 1;
    }

    if (!params.silent) {
      const icon = receipt.verified
        ? receipt.status.startsWith('SKIPPED')
          ? '⏭️'
          : '✅'
        : '❌';
      const attemptTag =
        receipt.attempts > 1 ? `Attempts: ${receipt.attempts} (Enforced Retry)` : `Attempt: 1`;
      const recastTag = receipt.recastTransition ? ` | Recast: ${receipt.recastTransition}` : '';
      const dmgTag = receipt.damageDealt > 0 ? ` | Dmg: ${receipt.damageDealt.toLocaleString()}` : '';
      const reasonTag = receipt.reason ? ` | Note: ${receipt.reason}` : '';

      console.log(
        `[Monitor] ${icon} Step ${receipt.stepNumber} [${receipt.stepLabel}]: ${receipt.status} | ${attemptTag}${recastTag}${dmgTag} | ${receipt.durationMs}ms${reasonTag}`
      );
    }

    return receipt;
  }

  /**
   * Finalizes the run's step execution ledger into an aggregated audit report.
   */
  public finalizeRun(runNumber: number, totalStepsPlanned: number): RunExecutionAuditReport {
    const receipts = this.ctx.state.currentRunStepReceipts || [];
    let confirmedSteps = 0;
    let skippedCooldownSteps = 0;
    let retriedSteps = 0;
    let failedSteps = 0;
    let unacknowledgedSteps = 0;

    for (const r of receipts) {
      if (
        r.status === 'CONFIRMED_NETWORK' ||
        r.status === 'CONFIRMED_STATE_MUTATION' ||
        r.status === 'CONFIRMED_DIRECT'
      ) {
        confirmedSteps++;
      } else if (r.status === 'SKIPPED_COOLDOWN') {
        skippedCooldownSteps++;
      } else if (r.status === 'UNACKNOWLEDGED_CONTINUED') {
        unacknowledgedSteps++;
      } else if (r.status === 'FAILED_TIMEOUT' || !r.verified) {
        failedSteps++;
      }
      if (r.attempts > 1) {
        retriedSteps++;
      }
    }

    const perfectExecution = failedSteps === 0 && unacknowledgedSteps === 0;
    if (perfectExecution) {
      this.ctx.state.totalPerfectRuns = (this.ctx.state.totalPerfectRuns || 0) + 1;
    }

    const report: RunExecutionAuditReport = {
      runNumber,
      totalStepsPlanned,
      totalStepsExecuted: receipts.length,
      confirmedSteps,
      skippedCooldownSteps,
      retriedSteps,
      failedSteps,
      unacknowledgedSteps,
      perfectExecution,
      receipts: [...receipts]
    };

    this.ctx.state.lastRunAuditReport = report;

    if (receipts.length > 0) {
      const statusBadge = perfectExecution ? 'PERFECT ✅' : 'DEGRADED ⚠️';
      console.log(
        `[Monitor] 📊 [Run ${runNumber} Step Audit] ${statusBadge} | Confirmed: ${confirmedSteps}/${receipts.length} | Enforced Retries: ${retriedSteps} | Cooldown Skips: ${skippedCooldownSteps} | Failed/Unack: ${failedSteps + unacknowledgedSteps}`
      );
    }

    return report;
  }
}

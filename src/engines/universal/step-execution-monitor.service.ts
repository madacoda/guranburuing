// src/engines/universal/step-execution-monitor.service.ts
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Page } from 'puppeteer-core';
import { UniversalContext } from './types.js';
import {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowTelemetryMode,
  StepExecutionOutcomeStatus,
  StepStateSnapshot,
  StepExecutionReceipt,
  StepHotspotStats,
  StepAuditRootCauseFinding,
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
  private rollingByStep = new Map<number, StepHotspotStats>();
  private totalReceiptsRecorded = 0;
  private runsAuditedCount = 0;
  private ledgerDirty = false;

  constructor(private ctx: UniversalContext) {}

  /**
   * Computes a deterministic short hash of the template's compiled step pipeline
   * so battle-tested auto-quiet promotion resets cleanly when steps change.
   */
  public static computePipelineHash(template?: WorkflowTemplate | null): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(template?.steps || []))
      .digest('hex')
      .slice(0, 12);
  }

  /**
   * Initializes telemetry mode and restores pipeline-hash-scoped clean-run streak
   * from data/step-audit-ledger.json once per workflow session.
   */
  public initializeTelemetryState(explicitMode?: WorkflowTelemetryMode, customLedgerPath?: string): void {
    const configured = explicitMode || this.ctx.template?.telemetryMode;
    if (configured === 'off') {
      this.ctx.state.telemetryMode = 'off';
      this.ctx.state.telemetryExplicit = true;
      this.ctx.state.consecutiveCleanRuns = 0;
      return;
    }

    const pipelineHash = StepExecutionMonitorService.computePipelineHash(this.ctx.template);
    this.ctx.state.pipelineHash = pipelineHash;

    const accId = this.ctx.accountId || 'default';
    let priorClean = 0;
    if (accId !== 'test-acc' || customLedgerPath) {
      try {
        const ledgerPath = customLedgerPath || path.resolve(process.cwd(), 'data', 'step-audit-ledger.json');
        if (fs.existsSync(ledgerPath)) {
          const existing = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
          const templateName = this.ctx.template?.name || 'Unknown Workflow';
          const entry = existing[`${templateName}::${accId}`];
          if (entry && entry.pipelineHash === pipelineHash) {
            priorClean = Number(entry.consecutiveCleanRuns || 0);
          }
        }
      } catch {
        priorClean = 0;
      }
    }

    this.ctx.state.consecutiveCleanRuns = priorClean;

    if (configured) {
      this.ctx.state.telemetryMode = configured;
      this.ctx.state.telemetryExplicit = true;
      return;
    }

    const threshold = this.ctx.template?.telemetryAutoQuietRuns ?? 100;
    if (threshold > 0 && priorClean >= threshold) {
      this.ctx.state.telemetryMode = 'summary';
      this.ctx.state.telemetryExplicit = false;
      console.log(
        `[Monitor] ⚡ Battle-tested workflow (${priorClean} clean runs on hash ${pipelineHash}); auto-enabling summary telemetry (per-run report). Pass --telemetry=verbose to inspect steps.`
      );
    } else {
      this.ctx.state.telemetryMode = 'verbose';
      this.ctx.state.telemetryExplicit = false;
    }
  }

  public setTelemetryMode(mode: WorkflowTelemetryMode, explicit = true): void {
    this.ctx.state.telemetryMode = mode;
    this.ctx.state.telemetryExplicit = explicit;
  }

  public getTelemetryMode(): WorkflowTelemetryMode {
    return this.ctx.state.telemetryMode || this.ctx.template?.telemetryMode || 'verbose';
  }

  public isQuietMode(): boolean {
    const mode = this.getTelemetryMode();
    return mode === 'summary' || mode === 'off';
  }

  public isOffMode(): boolean {
    return this.getTelemetryMode() === 'off';
  }

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

    if (this.isOffMode()) {
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
      ensureCast: Boolean(params.step.ensureCast),
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

    const isFailure =
      !receipt.verified ||
      receipt.status === 'FAILED_TIMEOUT' ||
      receipt.status === 'UNACKNOWLEDGED_CONTINUED';

    if (this.isOffMode()) {
      this.ctx.state.lastStepReceipt = receipt;
      if (!receipt.verified) {
        this.ctx.state.totalFailedSteps = (this.ctx.state.totalFailedSteps || 0) + 1;
      }
      if (isFailure) {
        if (!this.ctx.state.currentRunStepReceipts) {
          this.ctx.state.currentRunStepReceipts = [];
        }
        this.ctx.state.currentRunStepReceipts.push(receipt);
        if (!params.silent) {
          const attemptTag =
            receipt.attempts > 1 ? `Attempts: ${receipt.attempts} (Enforced Retry)` : `Attempt: 1`;
          const reasonTag = receipt.reason ? ` | Note: ${receipt.reason}` : '';
          console.log(
            `[Monitor] ❌ Step ${receipt.stepNumber} [${receipt.stepLabel}]: ${receipt.status} | ${attemptTag} | ${receipt.durationMs}ms${reasonTag}`
          );
        }
      }
      return receipt;
    }

    if (!this.ctx.state.currentRunStepReceipts) {
      this.ctx.state.currentRunStepReceipts = [];
    }
    if (!this.ctx.state.sessionStepReceipts) {
      this.ctx.state.sessionStepReceipts = [];
    }
    this.ctx.state.currentRunStepReceipts.push(receipt);
    this.ctx.state.sessionStepReceipts.push(receipt);
    if (this.ctx.state.sessionStepReceipts.length > 500) {
      this.ctx.state.sessionStepReceipts.shift();
    }
    this.ctx.state.lastStepReceipt = receipt;

    this.totalReceiptsRecorded++;
    this.updateRollingHotspot(receipt);

    if (receipt.attempts > 1) {
      this.ctx.state.totalStepRetries = (this.ctx.state.totalStepRetries || 0) + (receipt.attempts - 1);
    }
    if (!receipt.verified) {
      this.ctx.state.totalFailedSteps = (this.ctx.state.totalFailedSteps || 0) + 1;
    }

    if (!params.silent && (!this.isQuietMode() || isFailure)) {
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
   * Finalizes the run's step execution ledger into an aggregated audit report,
   * runs root-cause cascade diagnostics, and persists session hotspot telemetry.
   */
  public finalizeRun(runNumber: number, totalStepsPlanned: number): RunExecutionAuditReport {
    const receipts = this.ctx.state.currentRunStepReceipts || [];
    if (this.isOffMode() && receipts.length === 0) {
      this.ctx.state.totalPerfectRuns = (this.ctx.state.totalPerfectRuns || 0) + 1;
      const report: RunExecutionAuditReport = {
        runNumber,
        totalStepsPlanned,
        totalStepsExecuted: 0,
        confirmedSteps: 0,
        skippedCooldownSteps: 0,
        ensuredCooldownSkips: 0,
        retriedSteps: 0,
        failedSteps: 0,
        unacknowledgedSteps: 0,
        perfectExecution: true,
        receipts: [],
        findings: []
      };
      this.ctx.state.lastRunAuditReport = report;
      return report;
    }

    let confirmedSteps = 0;
    let skippedCooldownSteps = 0;
    let ensuredCooldownSkips = 0;
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
        if (r.ensureCast) {
          ensuredCooldownSkips++;
        }
      } else if (r.status === 'UNACKNOWLEDGED_CONTINUED') {
        unacknowledgedSteps++;
      } else if (r.status === 'FAILED_TIMEOUT' || !r.verified) {
        failedSteps++;
      }
      if (r.attempts > 1) {
        retriedSteps++;
      }
    }

    const findings = StepExecutionMonitorService.diagnoseReceipts(receipts);
    const hasCriticalFinding = findings.some(f => f.severity === 'CRITICAL');
    const perfectExecution = failedSteps === 0 && unacknowledgedSteps === 0 && !hasCriticalFinding;
    if (perfectExecution) {
      this.ctx.state.totalPerfectRuns = (this.ctx.state.totalPerfectRuns || 0) + 1;
      this.ctx.state.consecutiveCleanRuns = (this.ctx.state.consecutiveCleanRuns || 0) + 1;
    } else {
      this.ctx.state.consecutiveCleanRuns = 0;
    }

    this.runsAuditedCount = Math.max(this.runsAuditedCount, runNumber, 1);

    if (!this.ctx.state.telemetryExplicit && this.getTelemetryMode() === 'verbose') {
      const threshold = this.ctx.template?.telemetryAutoQuietRuns ?? 100;
      if (threshold > 0 && (this.ctx.state.consecutiveCleanRuns || 0) >= threshold) {
        this.ctx.state.telemetryMode = 'summary';
        console.log(
          `[Monitor] ⚡ Reached ${threshold} consecutive clean runs; switching to summary telemetry (per-run report).`
        );
      }
    }

    const report: RunExecutionAuditReport = {
      runNumber,
      totalStepsPlanned,
      totalStepsExecuted: receipts.length,
      confirmedSteps,
      skippedCooldownSteps,
      ensuredCooldownSkips,
      retriedSteps,
      failedSteps,
      unacknowledgedSteps,
      perfectExecution,
      receipts: [...receipts],
      findings
    };

    this.ctx.state.lastRunAuditReport = report;

    if (receipts.length > 0) {
      const mode = this.getTelemetryMode();
      const shouldPrintAudit = !perfectExecution || !this.isQuietMode();
      if (shouldPrintAudit) {
        const statusBadge = perfectExecution ? 'PERFECT ✅' : 'DEGRADED ⚠️';
        console.log(
          `[Monitor] 📊 [Run ${runNumber} Step Audit] ${statusBadge} | Confirmed: ${confirmedSteps}/${receipts.length} | Enforced Retries: ${retriedSteps} | Cooldown Skips: ${skippedCooldownSteps} | Failed/Unack: ${failedSteps + unacknowledgedSteps}`
        );
        if (findings.length > 0 && (!perfectExecution || ensuredCooldownSkips > 0)) {
          for (const f of findings) {
            const badge = f.severity === 'CRITICAL' ? '🚨' : f.severity === 'WARNING' ? '⚠️' : 'ℹ️';
            console.log(`[Monitor] ${badge} [Audit Root-Cause] Step ${f.stepNumber} [${f.stepLabel}]: ${f.summary}`);
          }
        }
      }

      this.ledgerDirty = true;
      const shouldFlush =
        mode === 'verbose' ||
        (mode === 'summary' &&
          (runNumber % 10 === 0 || !perfectExecution || Boolean(this.ctx.state.stopRequested)));
      if (shouldFlush) {
        this.persistSessionAuditLedger();
      }
    }

    return report;
  }

  /**
   * Flushes any pending summary-mode audit ledger updates before shutdown.
   */
  public flushLedgerIfDirty(customPath?: string): void {
    if (this.ledgerDirty && this.getTelemetryMode() !== 'off') {
      this.persistSessionAuditLedger(customPath);
    }
  }

  /**
   * Returns aggregated per-step hotspot statistics across all runs recorded in this session in O(steps).
   */
  public getSessionStepHotspots(): StepHotspotStats[] {
    if (this.rollingByStep.size > 0) {
      return Array.from(this.rollingByStep.values())
        .sort((a, b) => a.stepNumber - b.stepNumber)
        .map(h => ({ ...h }));
    }
    return StepExecutionMonitorService.aggregateHotspots(this.ctx.state.sessionStepReceipts || []);
  }

  /**
   * Persists the session's aggregated step audit ledger to data/step-audit-ledger.json.
   */
  public persistSessionAuditLedger(customPath?: string): void {
    try {
      const accId = this.ctx.accountId || 'default';
      if (accId === 'test-acc' && !customPath) return;
      const receipts = this.ctx.state.sessionStepReceipts || [];
      if (this.totalReceiptsRecorded === 0 && receipts.length === 0) return;

      const ledgerPath = customPath || path.resolve(process.cwd(), 'data', 'step-audit-ledger.json');
      const dir = path.dirname(ledgerPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let existing: Record<string, any> = {};
      if (fs.existsSync(ledgerPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
        } catch {
          existing = {};
        }
      }

      const templateName = this.ctx.template?.name || 'Unknown Workflow';
      const key = `${templateName}::${accId}`;
      const pipelineHash =
        this.ctx.state.pipelineHash || StepExecutionMonitorService.computePipelineHash(this.ctx.template);
      const hotspots = this.getSessionStepHotspots();
      const findings = StepExecutionMonitorService.diagnoseReceipts(this.ctx.state.currentRunStepReceipts || receipts);

      existing[key] = {
        templateName,
        accountId: accId,
        pipelineHash,
        consecutiveCleanRuns: this.ctx.state.consecutiveCleanRuns || 0,
        updatedAt: new Date().toISOString(),
        totalRunsAudited: this.runsAuditedCount || 1,
        totalStepReceipts: this.totalReceiptsRecorded || receipts.length,
        hotspots,
        latestFindings: findings
      };

      fs.writeFileSync(ledgerPath, JSON.stringify(existing, null, 2), 'utf8');
      this.ledgerDirty = false;
    } catch {
      // Non-fatal telemetry write
    }
  }

  private updateRollingHotspot(receipt: StepExecutionReceipt): void {
    let h = this.rollingByStep.get(receipt.stepNumber);
    if (!h) {
      h = {
        stepNumber: receipt.stepNumber,
        stepCode: receipt.stepCode,
        stepLabel: receipt.stepLabel,
        ensureCast: Boolean(receipt.ensureCast),
        executions: 0,
        confirmedCount: 0,
        firstTryCount: 0,
        retriedCount: 0,
        totalExtraAttempts: 0,
        cooldownSkipCount: 0,
        ensuredCooldownSkipCount: 0,
        koSkipCount: 0,
        failedCount: 0,
        noopMutationCount: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        maxDurationMs: 0,
        failureRatePct: 0,
        retryRatePct: 0,
        skipRatePct: 0,
        healthStatus: 'HEALTHY'
      };
      this.rollingByStep.set(receipt.stepNumber, h);
    }

    h.stepCode = receipt.stepCode;
    h.stepLabel = receipt.stepLabel;
    h.ensureCast = h.ensureCast || Boolean(receipt.ensureCast);
    h.executions++;
    h.totalDurationMs += receipt.durationMs;
    if (receipt.durationMs > h.maxDurationMs) h.maxDurationMs = receipt.durationMs;
    if (receipt.reason) h.lastReason = receipt.reason;

    const isConfirmed =
      receipt.status === 'CONFIRMED_NETWORK' ||
      receipt.status === 'CONFIRMED_STATE_MUTATION' ||
      receipt.status === 'CONFIRMED_DIRECT';

    if (isConfirmed) {
      h.confirmedCount++;
      if (receipt.attempts === 1) h.firstTryCount++;
      if (
        (receipt.stepCode === 'summon' || receipt.stepCode === 'skill') &&
        receipt.recastTransition === '0->0' &&
        !receipt.stateMutated &&
        receipt.damageDealt === 0
      ) {
        h.noopMutationCount++;
      }
    } else if (receipt.status === 'SKIPPED_COOLDOWN') {
      h.cooldownSkipCount++;
      if (receipt.ensureCast) h.ensuredCooldownSkipCount++;
    } else if (receipt.status === 'SKIPPED_KO') {
      h.koSkipCount++;
    } else if (receipt.status === 'FAILED_TIMEOUT' || receipt.status === 'UNACKNOWLEDGED_CONTINUED' || !receipt.verified) {
      h.failedCount++;
    }

    if (receipt.attempts > 1) {
      h.retriedCount++;
      h.totalExtraAttempts += receipt.attempts - 1;
    }

    const derived = StepExecutionMonitorService.computeHotspotHealth(h);
    h.avgDurationMs = derived.avgDurationMs;
    h.failureRatePct = derived.failureRatePct;
    h.retryRatePct = derived.retryRatePct;
    h.skipRatePct = derived.skipRatePct;
    h.healthStatus = derived.healthStatus;
    h.diagnosticHint = derived.diagnosticHint;
  }

  private static computeHotspotHealth(stats: {
    stepCode: string;
    executions: number;
    retriedCount: number;
    totalExtraAttempts: number;
    cooldownSkipCount: number;
    ensuredCooldownSkipCount: number;
    koSkipCount: number;
    failedCount: number;
    noopMutationCount: number;
    totalDurationMs: number;
    lastReason?: string;
  }): Pick<
    StepHotspotStats,
    'avgDurationMs' | 'failureRatePct' | 'retryRatePct' | 'skipRatePct' | 'healthStatus' | 'diagnosticHint'
  > {
    const { executions } = stats;
    const avgDurationMs = executions > 0 ? Math.round(stats.totalDurationMs / executions) : 0;
    const failureRatePct = executions > 0 ? Number(((stats.failedCount / executions) * 100).toFixed(1)) : 0;
    const retryRatePct = executions > 0 ? Number(((stats.retriedCount / executions) * 100).toFixed(1)) : 0;
    const skipRatePct =
      executions > 0 ? Number((((stats.cooldownSkipCount + stats.koSkipCount) / executions) * 100).toFixed(1)) : 0;

    let healthStatus: StepHotspotStats['healthStatus'] = 'HEALTHY';
    let diagnosticHint: string | undefined;

    if (stats.failedCount > 0) {
      healthStatus = 'FAILING';
      diagnosticHint = stats.lastReason || 'Step timed out or failed network/state verification';
    } else if (stats.ensuredCooldownSkipCount > 0 || (stats.cooldownSkipCount > 0 && stats.stepCode === 'summon')) {
      healthStatus = 'SKIP_ANOMALY';
      diagnosticHint =
        stats.stepCode === 'summon' && avgDurationMs < 150
          ? 'Summon skipped in <150ms (summon tray not opened or slot misread as unavailable)'
          : stats.lastReason || 'Ensured step skipped on cooldown (missing prerequisite swap or cooldown reset)';
    } else if (retryRatePct >= 50 || (executions > 0 && stats.totalExtraAttempts / executions >= 1.5)) {
      healthStatus = 'RETRY_HEAVY';
      diagnosticHint = `High enforced retry count (${stats.totalExtraAttempts} extra taps across ${executions} run(s)); previous animation/reload lock contention`;
    } else if (stats.noopMutationCount > 0 && stats.stepCode === 'summon') {
      healthStatus = 'SKIP_ANOMALY';
      diagnosticHint = 'Summon reported network response with Recast 0->0 and 0 state mutation';
    }

    return { avgDurationMs, failureRatePct, retryRatePct, skipRatePct, healthStatus, diagnosticHint };
  }

  /**
   * Aggregates an array of StepExecutionReceipts (across 1 or N runs) into per-step reliability hotspot stats.
   */
  public static aggregateHotspots(receipts: StepExecutionReceipt[]): StepHotspotStats[] {
    const byStep = new Map<number, StepExecutionReceipt[]>();
    for (const r of receipts) {
      const arr = byStep.get(r.stepNumber) || [];
      arr.push(r);
      byStep.set(r.stepNumber, arr);
    }

    const stats: StepHotspotStats[] = [];
    for (const [stepNumber, list] of Array.from(byStep.entries()).sort((a, b) => a[0] - b[0])) {
      const sample = list[list.length - 1];
      const executions = list.length;
      let confirmedCount = 0;
      let firstTryCount = 0;
      let retriedCount = 0;
      let totalExtraAttempts = 0;
      let cooldownSkipCount = 0;
      let ensuredCooldownSkipCount = 0;
      let koSkipCount = 0;
      let failedCount = 0;
      let noopMutationCount = 0;
      let totalDurationMs = 0;
      let maxDurationMs = 0;
      let lastReason: string | undefined;

      for (const r of list) {
        totalDurationMs += r.durationMs;
        if (r.durationMs > maxDurationMs) maxDurationMs = r.durationMs;
        if (r.reason) lastReason = r.reason;

        const isConfirmed =
          r.status === 'CONFIRMED_NETWORK' ||
          r.status === 'CONFIRMED_STATE_MUTATION' ||
          r.status === 'CONFIRMED_DIRECT';

        if (isConfirmed) {
          confirmedCount++;
          if (r.attempts === 1) firstTryCount++;
          if (
            (r.stepCode === 'summon' || r.stepCode === 'skill') &&
            r.recastTransition === '0->0' &&
            !r.stateMutated &&
            r.damageDealt === 0
          ) {
            noopMutationCount++;
          }
        } else if (r.status === 'SKIPPED_COOLDOWN') {
          cooldownSkipCount++;
          if (r.ensureCast) ensuredCooldownSkipCount++;
        } else if (r.status === 'SKIPPED_KO') {
          koSkipCount++;
        } else if (r.status === 'FAILED_TIMEOUT' || r.status === 'UNACKNOWLEDGED_CONTINUED' || !r.verified) {
          failedCount++;
        }

        if (r.attempts > 1) {
          retriedCount++;
          totalExtraAttempts += r.attempts - 1;
        }
      }

      const ensureCast = list.some(r => Boolean(r.ensureCast));
      const avgDurationMs = executions > 0 ? Math.round(totalDurationMs / executions) : 0;
      const failureRatePct = executions > 0 ? Number(((failedCount / executions) * 100).toFixed(1)) : 0;
      const retryRatePct = executions > 0 ? Number(((retriedCount / executions) * 100).toFixed(1)) : 0;
      const skipRatePct =
        executions > 0 ? Number((((cooldownSkipCount + koSkipCount) / executions) * 100).toFixed(1)) : 0;

      let healthStatus: StepHotspotStats['healthStatus'] = 'HEALTHY';
      let diagnosticHint: string | undefined;

      if (failedCount > 0) {
        healthStatus = 'FAILING';
        diagnosticHint = lastReason || 'Step timed out or failed network/state verification';
      } else if (ensuredCooldownSkipCount > 0 || (cooldownSkipCount > 0 && sample.stepCode === 'summon')) {
        healthStatus = 'SKIP_ANOMALY';
        diagnosticHint =
          sample.stepCode === 'summon' && avgDurationMs < 150
            ? 'Summon skipped in <150ms (summon tray not opened or slot misread as unavailable)'
            : lastReason || 'Ensured step skipped on cooldown (missing prerequisite swap or cooldown reset)';
      } else if (retryRatePct >= 50 || (executions > 0 && totalExtraAttempts / executions >= 1.5)) {
        healthStatus = 'RETRY_HEAVY';
        diagnosticHint = `High enforced retry count (${totalExtraAttempts} extra taps across ${executions} run(s)); previous animation/reload lock contention`;
      } else if (noopMutationCount > 0 && sample.stepCode === 'summon') {
        healthStatus = 'SKIP_ANOMALY';
        diagnosticHint = 'Summon reported network response with Recast 0->0 and 0 state mutation';
      }

      stats.push({
        stepNumber,
        stepCode: sample.stepCode,
        stepLabel: sample.stepLabel,
        ensureCast,
        executions,
        confirmedCount,
        firstTryCount,
        retriedCount,
        totalExtraAttempts,
        cooldownSkipCount,
        ensuredCooldownSkipCount,
        koSkipCount,
        failedCount,
        noopMutationCount,
        totalDurationMs,
        avgDurationMs,
        maxDurationMs,
        failureRatePct,
        retryRatePct,
        skipRatePct,
        healthStatus,
        lastReason,
        diagnosticHint
      });
    }

    return stats;
  }

  /**
   * Performs automated forensic root-cause analysis on a sequence of step receipts from a run.
   * Detects unopened summon trays, failed Death/backline swap cascades, ensured step cooldown skips,
   * and post-cast / post-reload input lock contention.
   */
  public static diagnoseReceipts(receipts: StepExecutionReceipt[]): StepAuditRootCauseFinding[] {
    const findings: StepAuditRootCauseFinding[] = [];
    if (!receipts || receipts.length === 0) return findings;

    const cascadeVictimStepNums = new Set<number>();

    for (let i = 0; i < receipts.length; i++) {
      const r = receipts[i];

      // 1. Premature Summon Tray Skip (e.g. Step 1 Hades skipped in 12ms)
      if (
        r.stepCode === 'summon' &&
        r.status === 'SKIPPED_COOLDOWN' &&
        (r.durationMs <= 150 || (r.reason && r.reason.toLowerCase().includes('unavailable in tray')))
      ) {
        findings.push({
          stepNumber: r.stepNumber,
          stepLabel: r.stepLabel,
          severity: 'CRITICAL',
          category: 'UNOPENED_SUMMON_TRAY',
          summary: `Summon skipped in ${r.durationMs}ms ("${r.reason || 'unavailable in tray'}") without opening .prt-command-summon.summon-on tray.`
        });
        continue;
      }

      // 2. Failed Death / Character Swap Cascade Detection
      const isDeathOrSwapSummon =
        (r.stepCode === 'summon' || r.stepCode === 'quick_call') &&
        (r.stepLabel.toLowerCase().includes('death') || r.stepLabel.includes('Slot 3'));

      if (isDeathOrSwapSummon) {
        const downstreamVictims: number[] = [];
        let passedSingleReload = false;
        // Look ahead at subsequent skill steps in the same turn (crossing at most one post-summon reload)
        for (let j = i + 1; j < receipts.length; j++) {
          const next = receipts[j];
          if (next.stepCode === 'reload') {
            if (!passedSingleReload) {
              passedSingleReload = true;
              continue;
            }
            break;
          }
          if (next.stepCode === 'attack' || next.stepCode === 'confirm_result') {
            break;
          }
          if (
            next.stepCode === 'skill' &&
            (next.status === 'SKIPPED_COOLDOWN' || next.status === 'FAILED_TIMEOUT' || !next.verified)
          ) {
            downstreamVictims.push(next.stepNumber);
          }
        }

        const summonNoOp =
          r.recastTransition === '0->0' && r.damageDealt === 0 && downstreamVictims.length >= 2;
        if (summonNoOp || (!r.verified && downstreamVictims.length > 0)) {
          for (const v of downstreamVictims) cascadeVictimStepNums.add(v);
          findings.push({
            stepNumber: r.stepNumber,
            stepLabel: r.stepLabel,
            severity: 'CRITICAL',
            category: 'FAILED_CHARACTER_SWAP_CASCADE',
            downstreamStepNumbers: downstreamVictims,
            summary: `Summon did not execute KO/backline swap (Recast: ${r.recastTransition || '0->0'}, Dmg: ${r.damageDealt}); C4 stayed unswapped and caused cascade failure/skips on Steps [${downstreamVictims.join(', ')}].`
          });
          continue;
        }
      }

      // 3. Explicit Step Timeout / Failure
      if (r.status === 'FAILED_TIMEOUT' || r.status === 'UNACKNOWLEDGED_CONTINUED' || !r.verified) {
        const isCascade = cascadeVictimStepNums.has(r.stepNumber);
        findings.push({
          stepNumber: r.stepNumber,
          stepLabel: r.stepLabel,
          severity: 'CRITICAL',
          category: 'STEP_TIMEOUT',
          summary: isCascade
            ? `Failed (${r.status} in ${r.durationMs}ms) as downstream consequence of failed C4 backline swap (slot lacked 4th skill).`
            : `Step failed (${r.status} after ${r.attempts} attempt(s), ${r.durationMs}ms): ${r.reason || 'Unconfirmed'}`
        });
        continue;
      }

      // 4. Ensured Step Skipped on Cooldown
      if (
        r.status === 'SKIPPED_COOLDOWN' &&
        (r.ensureCast || cascadeVictimStepNums.has(r.stepNumber))
      ) {
        const isCascade = cascadeVictimStepNums.has(r.stepNumber);
        findings.push({
          stepNumber: r.stepNumber,
          stepLabel: r.stepLabel,
          severity: isCascade ? 'WARNING' : 'CRITICAL',
          category: 'ENSURED_STEP_SKIPPED',
          summary: isCascade
            ? `Skipped on cooldown (${r.recastTransition || 'cd'}) because Death summon did not KO C4 to bring in Nier / trigger ally-KO cooldown reset.`
            : `Ensured step skipped on cooldown (${r.reason || r.recastTransition || 'on cooldown'}).`
        });
        continue;
      }

      // 5. High Retry Count (Input Lock / Scenario Settle Contention)
      if (r.attempts >= 3 && (r.stepCode === 'skill' || r.stepCode === 'summon' || r.stepCode === 'quick_call')) {
        findings.push({
          stepNumber: r.stepNumber,
          stepLabel: r.stepLabel,
          severity: 'WARNING',
          category: 'HIGH_RETRY_LOCK_CONTENTION',
          summary: `Required ${r.attempts} enforced attempts (${r.durationMs}ms); skill tapped while previous ability scenario or post-reload lock was still settling.`
        });
      }
    }

    return findings;
  }

  /**
   * Parses raw console log text containing "[Monitor]" lines into structured StepExecutionReceipt objects.
   * Allows auditing any live or historical terminal log paste directly.
   */
  public static parseMonitorLogText(logText: string): StepExecutionReceipt[] {
    const receipts: StepExecutionReceipt[] = [];
    const lines = logText.split(/\r?\n/);
    let currentRun = 1;

    const rxRunHeader = /\[Run\s+(\d+)\]/i;
    const rxMonitorStep =
      /\[Monitor\]\s+(?:✅|⏭️|❌)\s+Step\s+(\d+)\s+\[([^\]]+)\]:\s+([A-Z_]+)\s+\|\s+Attempts?:\s+(\d+)(?:\s+\(Enforced Retry\))?(?:\s+\|\s+Recast:\s+([^\s|]+))?(?:\s+\|\s+Dmg:\s+([0-9,]+))?\s+\|\s+(\d+)ms(?:\s+\|\s+Note:\s+(.+))?/i;

    const seenInRun = new Set<string>();

    for (const line of lines) {
      const runMatch = line.match(rxRunHeader);
      if (runMatch) {
        currentRun = parseInt(runMatch[1], 10) || currentRun;
      }

      const m = line.match(rxMonitorStep);
      if (!m) continue;

      const stepNumber = parseInt(m[1], 10);
      const stepLabel = m[2].trim();
      const status = m[3].trim() as StepExecutionOutcomeStatus;
      const attempts = parseInt(m[4], 10) || 1;
      const recastTransition = m[5]?.trim();
      const damageDealt = m[6] ? parseInt(m[6].replace(/,/g, ''), 10) || 0 : 0;
      const durationMs = parseInt(m[7], 10) || 0;
      const reason = m[8]?.trim();

      let stepCode = 'custom';
      if (stepLabel.startsWith('SKILL')) stepCode = 'skill';
      else if (stepLabel.startsWith('SUMMON')) stepCode = 'summon';
      else if (stepLabel.startsWith('QUICK_CALL')) stepCode = 'quick_call';
      else if (stepLabel.startsWith('ATTACK')) stepCode = 'attack';
      else if (stepLabel.startsWith('RELOAD')) stepCode = 'reload';
      else if (stepLabel.startsWith('CONFIRM_RESULT')) stepCode = 'confirm_result';

      const verified = status !== 'FAILED_TIMEOUT' && status !== 'UNACKNOWLEDGED_CONTINUED';
      const networkConfirmed = status === 'CONFIRMED_NETWORK';
      const stateMutated =
        status === 'CONFIRMED_STATE_MUTATION' ||
        damageDealt > 0 ||
        Boolean(
          recastTransition &&
            recastTransition.includes('->') &&
            recastTransition.split('->')[0] !== recastTransition.split('->')[1]
        );

      // Deduplicate in-step retry failure lines for the same (run, stepNumber) by keeping the final outcome or accumulating attempts
      const dedupKey = `${currentRun}::${stepNumber}::${stepCode}`;
      if (seenInRun.has(dedupKey) && status === 'FAILED_TIMEOUT') {
        const prevIdx = receipts.findIndex(
          r => r.runNumber === currentRun && r.stepNumber === stepNumber && r.stepCode === stepCode
        );
        if (prevIdx !== -1) {
          receipts[prevIdx].attempts += attempts;
          receipts[prevIdx].durationMs += durationMs;
          continue;
        }
      }
      seenInRun.add(dedupKey);

      receipts.push({
        runNumber: currentRun,
        stepNumber,
        stepCode,
        stepLabel,
        ensureCast: true,
        status,
        verified,
        attempts,
        durationMs,
        damageDealt,
        honorsGained: 0,
        networkConfirmed,
        stateMutated,
        recastTransition,
        reason
      });
    }

    return receipts;
  }

  /**
   * Formats a human-readable Step Reliability & Root-Cause Audit Table.
   */
  public static formatAuditReportTable(
    hotspots: StepHotspotStats[],
    findings: StepAuditRootCauseFinding[],
    title = 'Workflow Step Execution & Failure Audit'
  ): string {
    const out: string[] = [];
    out.push('========================================================================================');
    out.push(`  🔍 ${title}`);
    out.push('========================================================================================');

    if (hotspots.length === 0) {
      out.push('  No monitored step receipts found.');
      out.push('========================================================================================');
      return out.join('\n');
    }

    out.push(
      '  Step | Health       | Action / Label                           | Pass% | Retry% | Skip% | AvgMs'
    );
    out.push(
      '  -----+--------------+------------------------------------------+-------+--------+-------+-------'
    );

    for (const h of hotspots) {
      const stepStr = `#${h.stepNumber}`.padEnd(4);
      const badge =
        h.healthStatus === 'FAILING'
          ? '❌ FAILING   '
          : h.healthStatus === 'SKIP_ANOMALY'
          ? '⏭️ SKIP_ANOM '
          : h.healthStatus === 'RETRY_HEAVY'
          ? '🔄 RETRY_HVY '
          : '✅ HEALTHY   ';
      const labelStr = h.stepLabel.length > 40 ? h.stepLabel.slice(0, 37) + '...' : h.stepLabel.padEnd(40);
      const passPct = `${((h.confirmedCount / Math.max(1, h.executions)) * 100).toFixed(0)}%`.padStart(5);
      const retryPct = `${h.retryRatePct.toFixed(0)}%`.padStart(6);
      const skipPct = `${h.skipRatePct.toFixed(0)}%`.padStart(5);
      const avgMs = `${h.avgDurationMs}ms`.padStart(6);
      out.push(`  ${stepStr} | ${badge} | ${labelStr} | ${passPct} | ${retryPct} | ${skipPct} | ${avgMs}`);
    }

    if (findings.length > 0) {
      out.push('----------------------------------------------------------------------------------------');
      out.push('  🚨 Root-Cause & Failure Cascade Diagnostics:');
      for (const f of findings) {
        const icon = f.severity === 'CRITICAL' ? '🚨 [CRITICAL]' : f.severity === 'WARNING' ? '⚠️ [WARNING] ' : 'ℹ️ [INFO]    ';
        out.push(`  ${icon} Step #${f.stepNumber} (${f.stepLabel}):`);
        out.push(`     -> ${f.summary}`);
      }
    }

    out.push('========================================================================================');
    return out.join('\n');
  }
}

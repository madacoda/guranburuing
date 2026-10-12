// src/engines/universal-workflow.engine.ts
import { Page, HTTPResponse } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { AlertRelay } from '../alert-relay.js';
import { DropLogger } from './drop-logger.js';
import { goldBarTracker } from '../services/telemetry/gold-bar-tracker.service.js';
import { discordPresence } from '../relay/discord-presence.js';
import { discordDmRelay } from '../relay/discord-dm-relay.js';
import {
  setSpeedProfile,
  getSpeedProfile,
  logNormalDelay
} from '../human-motor.js';
import {
  WorkflowTemplate,
  WorkflowStep,
  WorkflowRunResult,
  WorkflowSummary
} from '../types/workflow.types.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { RecoveryModalService, PendingBattleService, SupporterSelectionService } from '../services/navigation/index.js';
import { CombatActionService } from '../services/combat/index.js';
import { LootTrackerService } from '../services/telemetry/index.js';
import { StepHandlerRegistry, createDefaultStepHandlerRegistry, WorkflowExecutionContext } from '../workflows/index.js';

// Modular Universal Sub-Services
import {
  UniversalWorkflowState,
  UniversalContext,
  ScreenDiagnosticService,
  CombatResolutionService,
  CombatExecutionService,
  MilestoneSweeperService,
  QuestNavigationService,
  RoutineExecutionService
} from './universal/index.js';

export interface WorkflowLoopOptions {
  runs?: number;
  autoReplenishAp?: boolean;
  autoReplenishEp?: boolean;
  logPath?: string;
  onProgress?: (result: WorkflowRunResult) => void;
}

export class UniversalWorkflowEngine {
  public ctx: UniversalContext;
  public screenDiagnostic: ScreenDiagnosticService;
  public combatResolution: CombatResolutionService;
  public combatExecution: CombatExecutionService;
  public milestoneSweeper: MilestoneSweeperService;
  public questNavigation: QuestNavigationService;
  public routineExecution: RoutineExecutionService;

  // Legacy services retained for backward compatibility
  private recoveryModalService: RecoveryModalService;
  private pendingBattleService: PendingBattleService;
  private supporterSelectionService: SupporterSelectionService;
  private combatActionService: CombatActionService;
  private lootTrackerService: LootTrackerService;
  private stepRegistry: StepHandlerRegistry;
  private responseListenerInitialized = false;

  constructor(
    private _page: Page,
    private sentinel: SentinelWatchdog,
    private template: WorkflowTemplate,
    private accountId: string
  ) {
    const accConfig = AccountRegistry.getAccountById(this.accountId);
    const playerName = accConfig?.name || this.accountId;

    const state: UniversalWorkflowState = {
      stopRequested: false,
      totalGoldBarsAccumulated: 0,
      totalBlueChestsAccumulated: 0,
      totalHonorsAccumulated: 0,
      totalLootItemsAccumulated: 0,
      currentRaidId: 'N/A',
      myUserId: '',
      currentScore: 0,
      currentTurn: 1,
      joinedInCurrentBatch: 0,
      currentBatchThreshold: 3,
      latestRewardData: null,
      currentLogPath: 'logs/workflow.md',
      currentWorkflowLogPath: 'logs/workflow.md',
      currentBattleHadGoldBar: false,
      currentBattleHadBlueChest: false,
      totalCompletedRuns: 0,
      dailyCatalogCache: null,
      totalJoinedAndClearedBattles: 0,
      lastStartFailureWasRaidLimit: false,
      lastStartFailureWasRaidWait: false,
      lastStartFailureWasMaintenance: false,
      consecutiveEmptyRaidSearches: 0,
      deadRaidIds: new Map<string, number>(),
      playerName,
      lastAttackLockoutExpires: 0
    };

    this.ctx = {
      page: this._page,
      sentinel: this.sentinel,
      template: this.template,
      accountId: this.accountId,
      state,
      alertRelay: new AlertRelay(),
      updatePage: (newPage: Page) => {
        this.ctx.page = newPage;
        this._page = newPage;
      }
    };

    // Initialize modular domain services
    this.screenDiagnostic = new ScreenDiagnosticService(this.ctx);
    this.combatResolution = new CombatResolutionService(this.ctx);
    this.milestoneSweeper = new MilestoneSweeperService(this.ctx, undefined, undefined, {
      claimPendingBattles: (logPath, currentRuns, returnUrl) => this.claimPendingBattles(logPath, currentRuns, returnUrl),
      resolveLingeringRaidLimit: (logPath, currentRuns) => this.resolveLingeringRaidLimit(logPath, currentRuns)
    });

    this.questNavigation = new QuestNavigationService(this.ctx, {
      milestoneSweeper: this.milestoneSweeper,
      combatResolution: this.combatResolution,
      screenDiagnostic: this.screenDiagnostic,
      handleAapRecoveryModal: (autoReplenish) => this.routineExecution.handleAapRecoveryModal(autoReplenish)
    });

    this.routineExecution = new RoutineExecutionService(this.ctx, {
      executeSingleStep: (s, num, runNum) => this.executeSingleStep(s, num, runNum)
    });

    this.combatExecution = new CombatExecutionService(this.ctx, {
      combatResolution: this.combatResolution,
      executeSingleStep: (s, num, runNum) => this.executeSingleStep(s, num, runNum),
      isManualWorkflow: () => this.isManualWorkflow()
    });

    this.recoveryModalService = new RecoveryModalService(this._page);
    this.pendingBattleService = new PendingBattleService(this._page);
    this.supporterSelectionService = new SupporterSelectionService(this._page);
    this.combatActionService = new CombatActionService(this._page);
    this.lootTrackerService = new LootTrackerService(this._page);
    this.stepRegistry = createDefaultStepHandlerRegistry();

    setSpeedProfile(template.speedProfile || 'fast');
    this.ctx.state.currentBatchThreshold = this.calculateNextBatchThreshold();

    this.sentinel?.setSessionContext?.({
      accountId: this.accountId,
      playerName: this.ctx.state.playerName,
      questName: this.template.name
    });

    this.setupResponseListener();
  }

  // --- Dynamic property delegates for backward compatibility ---
  public get page(): Page { return this.ctx.page; }
  public set page(p: Page) { this.updatePage(p); }

  public get currentScore(): number { return this.ctx.state.currentScore; }
  public set currentScore(v: number) { this.ctx.state.currentScore = v; }

  public get currentTurn(): number { return this.ctx.state.currentTurn; }
  public set currentTurn(v: number) { this.ctx.state.currentTurn = v; }

  public get currentRaidId(): string { return this.ctx.state.currentRaidId; }
  public set currentRaidId(v: string) { this.ctx.state.currentRaidId = v; }

  public get totalGoldBarsAccumulated(): number { return this.ctx.state.totalGoldBarsAccumulated; }
  public set totalGoldBarsAccumulated(v: number) { this.ctx.state.totalGoldBarsAccumulated = v; }

  public get totalBlueChestsAccumulated(): number { return this.ctx.state.totalBlueChestsAccumulated; }
  public set totalBlueChestsAccumulated(v: number) { this.ctx.state.totalBlueChestsAccumulated = v; }

  public get totalHonorsAccumulated(): number { return this.ctx.state.totalHonorsAccumulated; }
  public set totalHonorsAccumulated(v: number) { this.ctx.state.totalHonorsAccumulated = v; }

  public get totalCompletedRuns(): number { return this.ctx.state.totalCompletedRuns; }
  public set totalCompletedRuns(v: number) { this.ctx.state.totalCompletedRuns = v; }

  public get totalJoinedAndClearedBattles(): number { return this.ctx.state.totalJoinedAndClearedBattles; }
  public set totalJoinedAndClearedBattles(v: number) { this.ctx.state.totalJoinedAndClearedBattles = v; }

  public get lastStartFailureWasRaidLimit(): boolean { return this.ctx.state.lastStartFailureWasRaidLimit; }
  public set lastStartFailureWasRaidLimit(v: boolean) { this.ctx.state.lastStartFailureWasRaidLimit = v; }

  public get lastStartFailureWasRaidWait(): boolean { return this.ctx.state.lastStartFailureWasRaidWait; }
  public set lastStartFailureWasRaidWait(v: boolean) { this.ctx.state.lastStartFailureWasRaidWait = v; }

  public get lastStartFailureWasMaintenance(): boolean { return this.ctx.state.lastStartFailureWasMaintenance; }
  public set lastStartFailureWasMaintenance(v: boolean) { this.ctx.state.lastStartFailureWasMaintenance = v; }

  public get stopRequested(): boolean { return this.ctx.state.stopRequested; }
  public set stopRequested(v: boolean) { this.ctx.state.stopRequested = v; }

  public get currentLogPath(): string { return this.ctx.state.currentLogPath; }
  public set currentLogPath(v: string) { this.ctx.state.currentLogPath = v; }

  public get currentWorkflowLogPath(): string { return this.ctx.state.currentWorkflowLogPath; }
  public set currentWorkflowLogPath(v: string) { this.ctx.state.currentWorkflowLogPath = v; }

  public get currentDropLogPath(): string | undefined { return this.ctx.state.currentDropLogPath; }
  public set currentDropLogPath(v: string | undefined) { this.ctx.state.currentDropLogPath = v; }

  public get dailyCatalogCache(): any[] | null { return this.ctx.state.dailyCatalogCache; }
  public set dailyCatalogCache(v: any[] | null) { this.ctx.state.dailyCatalogCache = v; }

  public get alertRelay(): AlertRelay { return this.ctx.alertRelay; }
  public get dropLogger(): DropLogger | undefined { return this.ctx.dropLogger; }
  public set dropLogger(dl: DropLogger | undefined) { this.ctx.dropLogger = dl; }

  public async syncInGamePlayerName(): Promise<string> {
    try {
      const name = await this.page.evaluate(() => {
        const el = document.querySelector('.txt-user-name, .prt-user-name, .prt-user-id');
        return el ? (el.textContent || '').trim() : '';
      }).catch(() => '');

      if (name) {
        this.ctx.state.playerName = name;
        this.sentinel?.setSessionContext?.({ playerName: name });
        return name;
      }
    } catch {
      // Best-effort extraction
    }
    return this.ctx.state.playerName || this.accountId;
  }

  public updatePage(newPage: Page): void {
    this.ctx.updatePage(newPage);
    this.screenDiagnostic.updatePage(newPage);
    this.recoveryModalService = new RecoveryModalService(newPage);
    this.pendingBattleService = new PendingBattleService(newPage);
    this.supporterSelectionService = new SupporterSelectionService(newPage);
    this.combatActionService = new CombatActionService(newPage);
    this.lootTrackerService = new LootTrackerService(newPage);
    this.responseListenerInitialized = false;
    this.setupResponseListener();
  }

  public async ensureViewportAndMobile(): Promise<void> {
    try {
      await this.page.setViewport({ width: 480, height: 960, isMobile: true, hasTouch: true });
    } catch {
      // In mock tests or disconnected pages
    }
  }

  public requestStop(): void {
    this.ctx.state.stopRequested = true;
    console.log(`[Workflow] 🛑 Stop requested for engine (${this.template.name}).`);
  }

  private setupResponseListener(): void {
    if (this.responseListenerInitialized) return;
    this.responseListenerInitialized = true;

    this.page.on('response', async (res: HTTPResponse) => {
      const url = res.url();

      try {
        // 1. Initial Raid State or Mid-battle Re-sync
        if (
          url.includes('/quest/raid_info') ||
          url.includes('start.json') ||
          url.includes('raid_battle.json')
        ) {
          const json = await res.json().catch(() => null);
          if (json) {
            if (json.raid_id) {
              this.ctx.state.currentRaidId = String(json.raid_id);
              this.sentinel?.setSessionContext?.({ raidId: this.ctx.state.currentRaidId });
            }

            if (json.user_id && !this.ctx.state.myUserId) this.ctx.state.myUserId = String(json.user_id);
            let memberPoint: number | null = null;
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
                  if (!isNaN(pt) && pt > 0) memberPoint = pt;
                }
              }
            }

            const serverPoint =
              memberPoint ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null) ??
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.player?.point === 'number' && json.player.point > 0 ? json.player.point : null);
            if (serverPoint !== null) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, serverPoint);
            if (json.turn !== undefined) this.ctx.state.currentTurn = Number(json.turn);
            else if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
          }
        }

        // 2. Normal Attack Result
        if (url.includes('normal_attack_result.json')) {
          this.ctx.state.lastAttackLockoutExpires = Date.now() + 2400;
          const json = await res.json().catch(() => null);
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

            const targetHonors = this.template.targetScore || 1500000;
            const payloadKey = `${json.raid_id || 'battle'}_t${json.status?.turn || json.turn || ''}_hp${json.status?.boss?.param?.[0]?.hp ?? ''}`;

            if (directPoint !== null) {
              this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, directPoint);
              this.ctx.state.lastProcessedAttackKey = payloadKey;
              const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
              console.log(`[Combat] 🎯 Attack Honors Synced: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
            } else if (this.ctx.state.lastProcessedAttackKey !== payloadKey) {
              this.ctx.state.lastProcessedAttackKey = payloadKey;
              const turnDmg = this.extractTurnDamage(json);
              if (turnDmg > 0) {
                const turnHonors = Math.floor(turnDmg / 100);
                this.ctx.state.currentScore += turnHonors;
                const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
                console.log(`[Combat] Turn Dmg: ${turnDmg.toLocaleString()} (~${turnHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
              }
            }
            if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
            else if (json.turn !== undefined) this.ctx.state.currentTurn = Number(json.turn);
          }
        }

        // 3. Ability Result
        if (url.includes('ability_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            const hasAttackCmd = Array.isArray(json.scenario) && json.scenario.some((s: any) => s && s.cmd === 'attack');
            if (hasAttackCmd) {
              this.ctx.state.lastAttackLockoutExpires = Date.now() + 2400;
            }

            const abilityDmg = this.extractTurnDamage(json);
            if (abilityDmg > 0) {
              const abilityHonors = Math.floor(abilityDmg / 100);
              this.ctx.state.currentScore += abilityHonors;
              const targetHonors = this.template.targetScore || 1500000;
              const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
              console.log(`[Combat] ⚡ Skill Damage: ${abilityDmg.toLocaleString()} (~${abilityHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
            }

            const abilityPoint =
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null);
            if (abilityPoint !== null) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, abilityPoint);
            if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
          }
        }

        // 4. Summon Result
        if (url.includes('summon_result.json')) {
          const json = await res.json().catch(() => null);
          if (json) {
            const summonPoint =
              (typeof json.status?.user_point === 'number' && json.status.user_point > 0 ? json.status.user_point : null) ??
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point_info?.user_point === 'number' && json.point_info.user_point > 0 ? json.point_info.user_point : null);
            if (summonPoint !== null) {
              this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, summonPoint);
            } else {
              const summonDmg = this.extractTurnDamage(json);
              if (summonDmg > 0) {
                const summonHonors = Math.floor(summonDmg / 100);
                this.ctx.state.currentScore += summonHonors;
                const targetHonors = this.template.targetScore || 1500000;
                const pct = ((this.ctx.state.currentScore / targetHonors) * 100).toFixed(1);
                console.log(`[Combat] 🔮 Summon Damage: ${summonDmg.toLocaleString()} (~${summonHonors.toLocaleString()} pt) | Total Honors: ${this.ctx.state.currentScore.toLocaleString()} / ${targetHonors.toLocaleString()} pt (${pct}%)`);
              }
            }
            if (json.status?.turn !== undefined) this.ctx.state.currentTurn = Number(json.status.turn);
          }
        }

        // 5. Battle Result & Rewards
        if (
          url.includes('resultmulti') ||
          url.includes('result_multi') ||
          url.includes('/result/data') ||
          url.includes('/result/content') ||
          url.includes('reward.json')
        ) {
          const json = await res.json().catch(() => null);
          if (json) {
            this.ctx.state.latestRewardData = json;
            const resPoint =
              (typeof json.user_point === 'number' && json.user_point > 0 ? json.user_point : null) ??
              (typeof json.point === 'number' && json.point > 0 ? json.point : null) ??
              (typeof json.total_point === 'number' && json.total_point > 0 ? json.total_point : null);
            if (resPoint !== null) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, resPoint);

            if (typeof json.data === 'string') {
              try {
                const decoded = decodeURIComponent(json.data);
                const match = decoded.match(/class=["'](?:prt-user-point|txt-user-point)["'][^>]*>.*?([0-9,]+)/i);
                if (match && match[1]) {
                  const num = parseInt(match[1].replace(/,/g, ''), 10);
                  if (!isNaN(num) && num > 0) this.ctx.state.currentScore = Math.max(this.ctx.state.currentScore, num);
                }
              } catch {}
            }

            this.checkForGoldBarDrop(json);
            this.checkForBlueChestDrop(json);
          }
        }
      } catch {
        // Silently ignore parsing errors
      }
    });
  }

  public extractTurnDamage(data: any): number {
    return CombatResolutionService.extractTurnDamage(data);
  }

  public static extractTurnDamage(data: any): number {
    return CombatResolutionService.extractTurnDamage(data);
  }

  private checkForGoldBarDrop(payload: any): boolean {
    if (!payload) return false;
    let found = false;

    const traverse = (node: any) => {
      if (!node || found) return;
      if (typeof node === 'object') {
        const itemId = String(node.item_id || node.id || '');
        const itemName = String(node.name || node.item_name || '');
        if (itemId === '20004' || itemName.includes('Gold Bar') || itemName.includes('Gold Brick') || itemName.includes('ヒヒイロカネ')) {
          found = true;
          return;
        }
        for (const key of Object.keys(node)) {
          traverse(node[key]);
        }
      }
    };
    traverse(payload);

    if (!found) {
      try {
        const str = JSON.stringify(payload);
        if (str.includes('20004') || str.includes('ヒヒイロカネ') || str.includes('Gold Bar') || str.includes('Gold Brick')) {
          found = true;
        }
      } catch {}
    }

    if (!found && typeof payload.data === 'string') {
      try {
        if (
          payload.data.includes('20004') ||
          payload.data.includes('ヒヒイロカネ') ||
          payload.data.includes('Gold%20Brick') ||
          payload.data.includes('Gold%20Bar')
        ) {
          found = true;
        } else {
          const decoded = decodeURIComponent(payload.data);
          if (
            decoded.includes('20004') ||
            decoded.includes('ヒヒイロカネ') ||
            decoded.includes('Gold Bar') ||
            decoded.includes('Gold Brick')
          ) {
            found = true;
          }
        }
      } catch {
        if (payload.data.includes('20004')) found = true;
      }
    }

    if (found && !this.ctx.state.currentBattleHadGoldBar) {
      this.ctx.state.currentBattleHadGoldBar = true;
      this.ctx.state.totalGoldBarsAccumulated++;
      this.broadcastGoldBarFound();
    }

    return found;
  }

  private checkForBlueChestDrop(payload: any): boolean {
    if (!payload) return false;
    let found = false;

    if (payload.special_reward_flag || payload.special_reward || payload.reward_box_11) {
      found = true;
    }

    if (!found) {
      const traverse = (node: any) => {
        if (!node || found) return;
        if (typeof node === 'object') {
          const boxType = String(node.box_type || node.box_id || node.box || node.reward_type || '');
          if (boxType === '11') {
            found = true;
            return;
          }
          for (const key of Object.keys(node)) {
            traverse(node[key]);
          }
        }
      };
      traverse(payload);
    }

    if (!found && typeof payload.data === 'string') {
      try {
        if (
          payload.data.includes('box_type="11"') ||
          payload.data.includes('box_type=\\"11\\"') ||
          payload.data.includes('special_reward') ||
          payload.data.includes('特別報酬')
        ) {
          found = true;
        }
      } catch {}
    }

    if (found && !this.ctx.state.currentBattleHadBlueChest) {
      this.ctx.state.currentBattleHadBlueChest = true;
      this.ctx.state.totalBlueChestsAccumulated++;
      console.log(`[Telemetry] 💎 Blue Chest drop confirmed! Total Blue Chests: ${this.ctx.state.totalBlueChestsAccumulated}`);
    }

    return found;
  }

  private async captureCleanLootProof(raidId?: string): Promise<{ buffer?: Buffer; path: string }> {
    const cleanRaidId = (raidId || this.ctx.state.currentRaidId || '').replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
    const capDir = path.resolve(process.cwd(), 'artifacts/captures');
    if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
    const proofPath = path.resolve(capDir, `gold-bar-${cleanRaidId || 'drop'}-${Date.now()}.png`);

    let shotBuf: Buffer | undefined;

    try {
      const currentUrl = this.page.url();
      const isAlreadyOnResult = currentUrl.includes('result_multi') || currentUrl.includes('result');

      if (!isAlreadyOnResult && cleanRaidId && /^\d+$/.test(cleanRaidId)) {
        const resultUrl = `https://game.granbluefantasy.jp/#result_multi/detail/${cleanRaidId}/1/0/0`;
        console.log(`[Workflow] 📸 Navigating to battle result for clean loot proof: ${resultUrl}`);
        await this.page.goto(resultUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
      }

      const tWaitStart = Date.now();
      while (Date.now() - tWaitStart < 7000) {
        const ready = await this.page.evaluate(() => {
          const hasLoot = !!document.querySelector(
            '.cnt-result, #cnt-result, .prt-result-cnt, .prt-reward-item, .prt-item-list, .prt-box-special, .prt-special-reward-box, [data-item-id="20004"], img[src*="20004"], .prt-module'
          );
          const loadingEl = document.querySelector('#loading, .prt-loading, .cnt-loading, .loading-stage');
          const isLoading = loadingEl && (loadingEl as HTMLElement).style.display !== 'none' && (loadingEl as HTMLElement).offsetParent !== null;
          return hasLoot && !isLoading;
        }).catch(() => false);

        if (ready) break;
        await new Promise(r => setTimeout(r, 250));
      }
      await logNormalDelay(600, 0.15);

      await this.page.evaluate(() => {
        const blueBox = document.querySelector(
          '.prt-box-special, .prt-special-reward-box, [data-box-type="11"], .prt-box-item.special, .ico-box-special'
        ) as HTMLElement;
        if (blueBox && blueBox.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(blueBox).trigger('tap');
          blueBox.click();
        }
      }).catch(() => null);
      await logNormalDelay(800, 0.15);

      await this.page.evaluate(() => {
        const okBtns = document.querySelectorAll(
          '.pop-usual .btn-usual-ok, .btn-usual-ok, .pop-usual .btn-usual-close, .btn-usual-close, .btn-settle, .btn-result-close'
        );
        okBtns.forEach((btn: any) => {
          if (btn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
          }
        });
      }).catch(() => null);
      await logNormalDelay(400, 0.1);

      const targetEl = await this.page.$(
        '#cnt-result, .cnt-result, .prt-result-cnt, #wrapper, body'
      );
      if (targetEl) {
        shotBuf = await targetEl.screenshot({ path: proofPath, type: 'png' }) as Buffer;
      } else {
        shotBuf = await this.page.screenshot({ path: proofPath, fullPage: false }) as Buffer;
      }
      console.log(`[Workflow] 📸 Proof screenshot captured: ${proofPath}`);
    } catch (shotErr: any) {
      console.warn(`[Workflow] Proof capture error: ${shotErr.message}`);
    }

    return { buffer: shotBuf, path: proofPath };
  }

  private async broadcastGoldBarFound(overrideRaidId?: string): Promise<void> {
    const raidId = overrideRaidId || this.ctx.state.currentRaidId || '';
    console.log(`\n========================================================================`);
    console.log(`  🌟🌟🌟 [GOLD BAR FOUND!] Account: [${this.accountId}] Raid: ${raidId || 'Active'} 🌟🌟🌟`);
    console.log(`========================================================================\n`);

    process.stdout.write('\x07\x07\x07');

    const battleUrl = raidId
      ? `https://game.granbluefantasy.jp/#result_multi/detail/${raidId}/1/0/0`
      : (this.page.url().includes('result') ? this.page.url() : 'https://game.granbluefantasy.jp/#quest/assist');

    try {
      const { buffer: shotBuffer, path: proofPath } = await this.captureCleanLootProof(raidId);

      await goldBarTracker.recordDrop({
        raidId: raidId || 'Raid',
        questName: this.template.name,
        honors: this.ctx.state.currentScore > 0 ? this.ctx.state.currentScore.toLocaleString() + ' pt' : '-',
        turns: this.ctx.state.currentTurn || '-',
        screenshotPath: proofPath,
        screenshotBuffer: shotBuffer,
        source: 'live_combat',
        accountId: this.accountId,
        skipAlert: true
      }).catch(() => null);

      if (this.ctx.dropLogger) {
        await this.ctx.dropLogger.notifyGoldBarDrop({
          raidId: raidId || 'Raid',
          honors: this.ctx.state.currentScore > 0 ? this.ctx.state.currentScore.toLocaleString() + ' pt' : '-',
          turns: this.ctx.state.currentTurn || '-',
          screenshotBuffer: shotBuffer,
          screenshotPath: proofPath,
          accountId: this.accountId,
        });
      } else {
        const playerName = this.accountId || 'acc1';
        await this.ctx.alertRelay.sendEmergencyAlert(
          `🌟 GOLD BAR DROP CONFIRMED for ${playerName}!\n• Raid: ${this.template.name}\n• Battle Log: ${battleUrl}\n• Honors: ${this.ctx.state.currentScore.toLocaleString()} pt\n• Total GB: ${this.ctx.state.totalGoldBarsAccumulated}`,
          shotBuffer
        );

        if (discordDmRelay.isConfigured()) {
          try {
            await discordDmRelay.sendMessage(
              `🌟 **Gold Brick Drop Confirmed** 🌟\n• **Raid**: ${this.template.name}\n• **Raid ID**: \`${raidId || 'N/A'}\`\n• **Battle Log**: ${battleUrl}\n• **Account**: ${playerName}\n• **Honors**: ${this.ctx.state.currentScore.toLocaleString()} pt\n• **Total GB**: ${this.ctx.state.totalGoldBarsAccumulated}`,
              shotBuffer,
              `gold-bar-${raidId || 'drop'}.png`,
              undefined,
              true
            );
          } catch (dmErr: any) {
            console.error('[Workflow] Direct Discord DM dispatch error:', dmErr.message);
          }
        }
      }
    } catch (err: any) {
      console.error(`[Workflow] Error broadcasting Gold Bar:`, err.message);
    }
  }

  private calculateNextBatchThreshold(): number {
    if (this.template.batchClaimSize && this.template.batchClaimSize > 0) {
      return Math.min(3, Math.max(1, this.template.batchClaimSize));
    }
    const min = Math.max(1, Math.min(this.template.minBatchClaim || 2, 3));
    const max = Math.max(min, Math.min(this.template.maxBatchClaim || 3, 3));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  public async runLoop(options: WorkflowLoopOptions = {}): Promise<WorkflowSummary> {
    const {
      runs = this.template.defaultRuns || 100,
      autoReplenishAp = this.template.autoElixir !== false,
      autoReplenishEp = this.template.autoBerry !== false,
      logPath = this.template.logPath,
      onProgress
    } = options;

    const startTime = Date.now();
    let totalCompleted = 0;
    this.ctx.state.stopRequested = false;
    this.ctx.state.totalGoldBarsAccumulated = 0;
    this.ctx.state.totalHonorsAccumulated = 0;
    this.ctx.state.totalLootItemsAccumulated = 0;
    this.ctx.state.joinedInCurrentBatch = 0;
    this.ctx.state.totalJoinedAndClearedBattles = 0;
    this.ctx.state.lastStartFailureWasRaidLimit = false;
    this.ctx.state.lastStartFailureWasRaidWait = false;
    this.ctx.state.lastStartFailureWasMaintenance = false;
    this.ctx.state.consecutiveEmptyRaidSearches = 0;

    await this.syncInGamePlayerName();

    const isAssistRaid = this.template.questUrl.includes('assist');

    let dropLogPath: string | undefined = logPath || this.template.logPath;
    if (!dropLogPath) {
      const lowerName = this.template.name.toLowerCase();
      if (lowerName.includes('akasha') || this.template.raidSlot === 3) {
        dropLogPath = 'logs/gb-akasha.md';
      } else if (lowerName.includes('pbhl') || this.template.raidSlot === 4) {
        dropLogPath = 'logs/gb-pbhl.md';
      } else if (lowerName.includes('go') || lowerName.includes('grand order') || this.template.raidSlot === 2) {
        dropLogPath = 'logs/gb-go.md';
      } else if (isAssistRaid) {
        dropLogPath = 'logs/gb-farm.md';
      }
    }

    const workflowSlug = this.template.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const workflowLogPath = `logs/workflow-${this.accountId}-${workflowSlug}.md`;
    this.ctx.state.currentWorkflowLogPath = workflowLogPath;
    this.ctx.state.currentDropLogPath = dropLogPath;
    const activeLogPath = dropLogPath || workflowLogPath;
    this.ctx.state.currentLogPath = activeLogPath;

    if (dropLogPath) {
      this.ensureLogDirExists(dropLogPath);
      this.ctx.dropLogger = new DropLogger(path.resolve(process.cwd(), dropLogPath), this.template.name);
      const initialStats = this.ctx.dropLogger.getStats();
      console.log(`[Workflow] Drop Logger active: ${dropLogPath} (${initialStats.totalBattles} historical battles, ${initialStats.blueChests} Blue Chests, ${initialStats.goldBars} Gold Bars, dry streak: ${initialStats.currentDryStreak} ${initialStats.dryStreakMode === 'blue_chest' ? 'blue chests' : 'battles'})`);

      discordPresence.updateStatus({
        raidName: this.template.name,
        runNumber: initialStats.totalBattles + 1,
        totalRuns: runs === Infinity ? undefined : runs,
        goldBars: initialStats.goldBars,
        goldBarsToday: initialStats.goldBarsToday,
        goldBarsSession: 0,
        blueChests: initialStats.blueChests,
        dryStreak: initialStats.currentDryStreak,
        dryStreakMode: initialStats.dryStreakMode,
        status: 'Searching',
        accountId: this.accountId
      }, true);
    }

    this.ensureLogDirExists(workflowLogPath);

    console.log(`\n========================================================================`);
    console.log(`     Universal Workflow Engine: ${this.template.name}`);
    console.log(`     Account:                   [${this.accountId}]`);
    console.log(`========================================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Quest URL:            ${this.template.questUrl}`);
    console.log(`Mode:                 ${isAssistRaid ? 'Multi-Raid Assist / Backup Farmer' : 'Single Quest / Supporter Runner'}`);
    console.log(`Total Steps:          ${this.template.steps.length}`);
    console.log(`Speed Profile:        ${(this.template.speedProfile || 'fast').toUpperCase()}`);
    console.log(`Human Motor:          ${this.template.humanMotor !== false ? 'Enabled (Gaussian Jitter & Log-Normal Delays)' : 'Disabled'}`);
    console.log(`Stop on CAPTCHA:      ${this.template.stopOnCaptcha !== false ? 'Enabled (Hard-Freeze & Alert)' : 'Disabled'}`);
    console.log(`Auto Half-Elixir:     ${autoReplenishAp ? 'Enabled' : 'Disabled'}`);
    console.log(`Auto Soul-Berry:      ${autoReplenishEp ? 'Enabled' : 'Disabled'}`);
    if (isAssistRaid) {
      console.log(`Batch Claim Window:   Randomized ${this.template.minBatchClaim || 3} - ${this.template.maxBatchClaim || 5} raids (First batch: ${this.ctx.state.currentBatchThreshold})`);
    }
    if (dropLogPath) {
      console.log(`Drop Log (Gold Bars): ${dropLogPath}`);
    }
    console.log(`Workflow Log:         ${workflowLogPath}`);
    console.log(`========================================================================\n`);

    await this.combatResolution.resolveLingeringState();

    const isGw = this.template.name.toLowerCase().includes('gw') || this.template.questUrl.includes('teamraid') || this.template.questUrl.includes('event');
    if (isAssistRaid || isGw) {
      console.log('[Workflow] 🛡️ Verifying zero pending/unclaimed battles exist before starting runs...');
      await this.milestoneSweeper.claimPendingBattles(activeLogPath, 0, this.template.questUrl);
    }

    let consecutiveStartFailures = 0;
    const MAX_START_FAILURES = 5;

    while (totalCompleted < runs && !this.ctx.state.stopRequested) {
      const runNumber = totalCompleted + 1;
      const runStart = Date.now();
      this.ctx.state.currentScore = 0;
      this.ctx.state.currentTurn = 1;
      this.ctx.state.currentBattleHadGoldBar = false;
      this.ctx.state.currentBattleHadBlueChest = false;
      this.ctx.state.totalCompletedRuns = totalCompleted;

      if (isAssistRaid && this.ctx.state.joinedInCurrentBatch >= this.ctx.state.currentBatchThreshold) {
        console.log(`\n[Workflow] Batch claim threshold (${this.ctx.state.currentBatchThreshold}) reached. Claiming pending battles...`);
        await this.milestoneSweeper.claimPendingBattles(activeLogPath, totalCompleted);
        this.ctx.state.joinedInCurrentBatch = 0;
        this.ctx.state.currentBatchThreshold = this.calculateNextBatchThreshold();
        console.log(`[Workflow] Next pending claim scheduled in ${this.ctx.state.currentBatchThreshold} raids.\n`);
      }

      if (this.ctx.state.stopRequested) break;

      console.log(`------------------------------------------------------------------------`);
      console.log(`[${this.accountId}] [Run ${runNumber}] Initiating Workflow Run...`);
      console.log(`------------------------------------------------------------------------`);

      this.sentinel?.setSessionContext?.({
        accountId: this.accountId,
        questName: this.template.name,
        runNumber: runNumber,
      });

      discordPresence.updateStatus({
        raidName: this.template.name,
        runNumber,
        totalRuns: runs === Infinity ? undefined : runs,
        goldBars: this.ctx.state.totalGoldBarsAccumulated,
        blueChests: this.ctx.state.totalBlueChestsAccumulated,
        status: isAssistRaid ? 'Searching' : 'Starting',
        accountId: this.accountId
      }, true);

      // Phase 1: Navigation / Supporter selection
      let started = false;
      if (this.template.mode === 'routine') {
        started = true;
        if (this.template.questUrl) {
          const targetHash = this.template.questUrl.includes('#') ? '#' + this.template.questUrl.split('#')[1] : this.template.questUrl;
          const curUrl = this.page.url();
          if (targetHash.startsWith('#') && !curUrl.includes(targetHash)) {
            await this.page.evaluate((h: string) => {
              if (window.location.hash === h) {
                window.location.reload();
              } else {
                window.location.hash = h;
              }
            }, targetHash).catch(() => null);
            await logNormalDelay(600, 0.15);
          }
        }
      } else {
        try {
          started = await this.questNavigation.selectSupporterAndStartQuest(autoReplenishAp, autoReplenishEp, activeLogPath, totalCompleted);
        } catch (startErr: any) {
          console.warn(`[Workflow] Error during quest navigation: ${startErr.message}`);
          started = false;
        }
      }

      if (!started) {
        consecutiveStartFailures++;
        console.warn(`[Workflow] Quest launch failed on Run ${runNumber} (Failure ${consecutiveStartFailures}/${MAX_START_FAILURES}).`);

        const recovery = await this.screenDiagnostic.diagnoseAndRecoverQuestStart(
          runNumber,
          autoReplenishAp,
          autoReplenishEp,
          activeLogPath,
          totalCompleted
        );

        if (recovery.recovered) {
          console.log(`[Workflow] Self-healing diagnostic successfully recovered obstruction (${recovery.condition}). Retrying run immediately...`);
          consecutiveStartFailures = 0;
          await logNormalDelay(600, 0.15);
          continue;
        }

        if (recovery.isFatal) {
          console.error(`[Workflow] ❌ Unrecoverable screen condition encountered (${recovery.condition}): ${recovery.reason}. Aborting loop.`);
          break;
        }

        if (this.ctx.state.lastStartFailureWasRaidLimit) {
          console.log(`[Workflow] Recovered from 3-raid backup limit via passive wait cycle. Resuming runs immediately...`);
          consecutiveStartFailures = 0;
          this.ctx.state.lastStartFailureWasRaidLimit = false;
          continue;
        }

        if (this.ctx.state.lastStartFailureWasRaidWait || this.ctx.state.lastStartFailureWasMaintenance) {
          consecutiveStartFailures = 0;
          this.ctx.state.lastStartFailureWasRaidWait = false;
          this.ctx.state.lastStartFailureWasMaintenance = false;
          continue;
        }

        if (consecutiveStartFailures >= MAX_START_FAILURES) {
          console.error(`[Workflow] Aborting: Quest failed to launch ${MAX_START_FAILURES} consecutive times.`);
          break;
        }

        await logNormalDelay(1500, 0.2);
        continue;
      }

      consecutiveStartFailures = 0;
      this.ctx.state.joinedInCurrentBatch++;
      this.ctx.state.totalJoinedAndClearedBattles++;

      discordPresence.updateStatus({
        raidName: this.template.name,
        runNumber,
        totalRuns: runs === Infinity ? undefined : runs,
        goldBars: this.ctx.state.totalGoldBarsAccumulated,
        blueChests: this.ctx.state.totalBlueChestsAccumulated,
        status: this.template.mode === 'routine' ? 'Routine Running' : 'In Combat',
        accountId: this.accountId
      }, true);

      // Phase 2: Execute step pipeline
      const pipelineSuccess = await this.executeStepPipeline(runNumber);

      // Phase 3: Result settlement & rewards processing (combat mode only)
      if (this.template.mode !== 'routine') {
        const isAssist = this.template.questUrl?.includes('assist') || (this.template.raidSlots && this.template.raidSlots.length > 0);
        if (!isAssist) {
          await this.combatExecution.ensureBattleConcluded(10);
        }
        await this.combatResolution.handleConfirmResult();
        await this.combatResolution.syncCurrentHonors();
        this.ctx.state.totalHonorsAccumulated += this.ctx.state.currentScore;
        // Phase 4: 5-Battle Milestone Unclaimed Sweep
        await this.milestoneSweeper.checkFiveBattleMilestone(activeLogPath, totalCompleted + 1);
      }

      totalCompleted++;
      this.ctx.state.totalCompletedRuns = totalCompleted;

      if (this.ctx.state.stopRequested) {
        console.log(`[Workflow] 🏁 Stop requested (completed ${totalCompleted} run(s)). Concluding workflow.`);
        break;
      }

      const runDuration = Date.now() - runStart;

      const result: WorkflowRunResult = {
        runNumber,
        durationMs: runDuration,
        status: pipelineSuccess ? 'SUCCESS' : 'FAILED',
        supporterName: 'N/A',
        honors: this.ctx.state.currentScore,
        message: `Cleared in ${(runDuration / 1000).toFixed(1)}s. Honors: ${this.ctx.state.currentScore.toLocaleString()} pt`
      };

      if (this.ctx.dropLogger) {
        this.ctx.dropLogger.logBattle({
          raidId: this.ctx.state.currentRaidId || 'N/A',
          turns: this.ctx.state.currentTurn,
          honors: this.ctx.state.currentScore,
          targetMet: (!this.template.targetScore || this.ctx.state.currentScore >= this.template.targetScore),
          hasGoldBar: this.ctx.state.currentBattleHadGoldBar,
          hasBlueChest: this.ctx.state.currentBattleHadBlueChest
        });
      }

      this.appendRunLog(activeLogPath, result);
      if (onProgress) onProgress(result);

      if (this.ctx.dropLogger) {
        const stats = this.ctx.dropLogger.getStats();
        discordPresence.updateStatus({
          raidName: this.template.name,
          runNumber: stats.totalBattles,
          totalRuns: runs === Infinity ? undefined : runs,
          goldBars: stats.goldBars,
          goldBarsToday: stats.goldBarsToday,
          goldBarsSession: this.ctx.state.totalGoldBarsAccumulated,
          blueChests: stats.blueChests,
          dryStreak: stats.currentDryStreak,
          dryStreakMode: stats.dryStreakMode,
          status: 'Searching',
          accountId: this.accountId
        }, true);
      } else {
        discordPresence.updateStatus({
          raidName: this.template.name,
          runNumber: totalCompleted,
          totalRuns: runs === Infinity ? undefined : runs,
          goldBars: this.ctx.state.totalGoldBarsAccumulated,
          blueChests: this.ctx.state.totalBlueChestsAccumulated,
          status: 'Searching',
          accountId: this.accountId
        }, true);
      }

      console.log(`[Run ${runNumber}] Completed in ${(runDuration / 1000).toFixed(1)}s | Honors: ${this.ctx.state.currentScore.toLocaleString()} pt | Overall: ${totalCompleted}/${runs} runs`);

      if ((this.template as any).delayBetweenRunsMs) {
        await new Promise(r => setTimeout(r, (this.template as any).delayBetweenRunsMs));
      } else {
        await logNormalDelay(400, 0.15);
      }
    }

    const totalDurationMs = Date.now() - startTime;
    return {
      templateName: this.template.name,
      accountId: this.accountId,
      totalRunsCompleted: totalCompleted,
      totalDurationMs,
      averageDurationSec: totalCompleted > 0 ? (totalDurationMs / totalCompleted) / 1000 : 0,
      logPath: this.ctx.state.currentLogPath
    };
  }

  private async executeStepPipeline(runNumber: number): Promise<boolean> {
    this.ctx.state.currentScore = 0;
    this.ctx.state.currentTurn = 1;

    if (this.template.mode !== 'routine') {
      await this.combatResolution.ensureInitialCombatReady();
    }

    for (let i = 0; i < this.template.steps.length; i++) {
      const step = this.template.steps[i];
      if (this.ctx.state.stopRequested) return false;

      if (this.template.stopOnCaptcha !== false) {
        await this.sentinel.assertSafe();
      }

      if (!this.isManualWorkflow() && this.template.honorGuard !== false && this.template.targetScore && this.ctx.state.currentScore >= this.template.targetScore) {
        console.log(`[Run ${runNumber}] Target score reached (${this.ctx.state.currentScore.toLocaleString()} >= ${this.template.targetScore.toLocaleString()} pt). Terminating combat pipeline early.`);
        return true;
      }

      if (step.code === 'exit_if_score' || step.action === 'exit_if_score') {
        await this.combatResolution.syncCurrentHonors();
        const threshold = step.targetScore || this.template.targetScore || 1500000;
        if (this.ctx.state.currentScore >= threshold) {
          console.log(`[Run ${runNumber}] Honor threshold met (${this.ctx.state.currentScore.toLocaleString()} >= ${threshold.toLocaleString()} pt). Exiting combat pipeline early.`);
          return true;
        }
        console.log(`[Run ${runNumber}] Current honors (${this.ctx.state.currentScore.toLocaleString()} pt) below threshold (${threshold.toLocaleString()} pt). Continuing pipeline...`);
        continue;
      }

      if (this.template.mode !== 'routine' && i > 0 && await this.combatResolution.isBattleEnded()) {
        const stepAction = step.code || step.action;
        const isPostBattleCleanup = stepAction === 'reload' || stepAction === 'f5' || stepAction === 'confirm_result' || stepAction === 'dismiss_popups';
        if (!isPostBattleCleanup) {
          await this.combatResolution.syncCurrentHonors();
          console.log(`[Run ${runNumber}] Battle concluded before Step ${i + 1} (${stepAction}). Exiting combat pipeline early. Final Honors: ${this.ctx.state.currentScore.toLocaleString()} pt.`);
          return true;
        }
      }

      console.log(`[Run ${runNumber}] Step ${i + 1}/${this.template.steps.length}: ${step.code || step.action}${step.waitForNetwork ? ` (awaiting ${step.waitForNetwork})` : ''}`);

      const success = await this.executeSingleStep(step, i + 1, runNumber);
      if (!success && !step.optional) {
        console.warn(`[Run ${runNumber}] Step ${i + 1} (${step.code || step.action}) failed all attempts.`);
        if (await this.combatResolution.isBattleEnded()) {
          console.log(`[Run ${runNumber}] Battle already concluded. Proceeding to result resolution.`);
          return true;
        }

        const isCombatSkillOrSummon = step.code === 'skill' || step.action === 'skill' ||
                                      step.code === 'summon' || step.action === 'summon' ||
                                      step.code === 'quick_call' || step.action === 'quick_call';
        const hasSubsequentBurst = this.template.steps.slice(i + 1).some(s =>
          s.code === 'attack' || s.action === 'attack' ||
          s.code === 'tap_ready' || s.action === 'tap_ready' ||
          s.code === 'repeat' || s.action === 'repeat' ||
          s.code === 'smart_full_auto' || s.action === 'smart_full_auto'
        );

        if (isCombatSkillOrSummon && hasSubsequentBurst && (this.template.mode === 'assist' || this.template.mode === 'combat' || !this.template.mode)) {
          console.warn(`[Run ${runNumber}] ⚠️ Non-fatal combat action failure: Step ${i + 1} (${step.code || step.action}) unacknowledged, but subsequent attack/burst steps exist. Continuing combat pipeline to secure honors.`);
          continue;
        }

        return false;
      }

      if (step.delayAfterMs) {
        await new Promise(r => setTimeout(r, step.delayAfterMs));
      }
    }

    if (this.template.honorGuard !== false && this.template.targetScore) {
      await this.combatExecution.ensureMinimumHonors(this.template.targetScore);
    }

    return true;
  }

  private isManualWorkflow(): boolean {
    const mode = this.template.mode as string | undefined;
    const isManualMode = mode === 'single' || mode === 'multi' || mode === 'routine';
    const isRaidEvaluatorOrBurst = !!this.template.evaluatorStrategy || (this.template.speedProfile === 'turbo' && mode === 'assist');
    return isManualMode && !isRaidEvaluatorOrBurst;
  }

  private createExecutionContext(): WorkflowExecutionContext {
    return {
      page: this.page,
      template: this.template,
      accountId: this.accountId,
      playerName: this.ctx.state.playerName,
      services: {
        combat: this.combatActionService,
        recovery: this.recoveryModalService,
        pending: this.pendingBattleService,
        supporter: this.supporterSelectionService,
        loot: this.lootTrackerService,
        sentinel: this.sentinel,
        alertRelay: this.ctx.alertRelay,
        dropLogger: this.ctx.dropLogger
      },
      state: {
        currentScore: this.ctx.state.currentScore,
        currentTurn: this.ctx.state.currentTurn,
        currentRaidId: this.ctx.state.currentRaidId,
        isCombatActive: true,
        totalGoldBarsAccumulated: this.ctx.state.totalGoldBarsAccumulated,
        totalBlueChestsAccumulated: this.ctx.state.totalBlueChestsAccumulated,
        totalHonorsAccumulated: this.ctx.state.totalHonorsAccumulated,
        totalCompletedRuns: this.ctx.state.totalCompletedRuns,
        lastAttackLockoutExpires: this.ctx.state.lastAttackLockoutExpires,
        stopRequested: this.ctx.state.stopRequested,
        myUserId: this.ctx.state.myUserId
      },
      executeSubSteps: async (steps, runNum) => {
        for (let i = 0; i < steps.length; i++) {
          const ok = await this.executeSingleStep(steps[i], i + 1, runNum);
          if (!ok && !steps[i].optional) return false;
        }
        return true;
      },
      executeStep: async (s, num, runNum) => this.executeSingleStep(s, num, runNum),
      log: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
      error: (msg, err) => console.error(msg, err)
    };
  }

  public async executeSingleStep(step: WorkflowStep, stepNum: number, runNumber: number): Promise<boolean> {
    const actionCode = step.code || step.action;

    switch (actionCode) {
      case 'tap_ready':
        return await this.combatExecution.handleTapReady(step);

      case 'quick_call':
        return await this.combatExecution.handleQuickCall(step);

      case 'attack':
        return await this.combatExecution.handleAttack(step);

      case 'reload':
      case 'f5':
        return await this.combatExecution.handleReload(step);

      case 'skill':
        return await this.combatExecution.handleSkill(step);

      case 'summon':
        return await this.combatExecution.handleSummon(step);

      case 'target_enemy':
        return await this.combatExecution.handleTargetEnemy(step);

      case 'heal':
        return await this.combatExecution.handleHeal(step);

      case 'backup_request':
        return await this.combatExecution.handleBackupRequest();

      case 'exit_if_score':
        return await this.combatExecution.handleExitIfScore(step);

      case 'wait_turn':
        return await this.combatExecution.handleWaitTurn(step);

      case 'repeat':
        return await this.combatExecution.handleRepeat(step, runNumber);

      case 'auto':
        return await this.combatExecution.handleAuto(step);

      case 'guard':
        return await this.combatExecution.handleGuard(step);

      case 'navigate':
        if (step.target) {
          await this.page.evaluate((url: string) => { window.location.href = url; }, step.target).catch(() => null);
        }
        return true;

      case 'click':
        return await this.combatExecution.handleClick(step);

      case 'touch_tap':
        if (step.x !== undefined && step.y !== undefined) {
          await this.page.touchscreen.tap(step.x, step.y).catch(() => null);
          await this.page.mouse.click(step.x, step.y).catch(() => null);
        }
        return true;

      case 'wait':
        {
          const waitMs = step.ms || step.delayAfterMs || 500;
          await new Promise(r => setTimeout(r, waitMs));
        }
        return true;

      case 'wait_random':
      case 'wait_randomize':
        {
          const min = step.minMs || 300;
          const max = step.maxMs || 800;
          const delay = Math.floor(Math.random() * (max - min + 1)) + min;
          await new Promise(r => setTimeout(r, delay));
        }
        return true;

      case 'wait_network':
        if (step.waitForNetwork) {
          await this.combatResolution.waitForNetworkResponse(step.waitForNetwork, step.timeoutMs || 5000);
        }
        return true;

      case 'wait_element':
        if (step.target) {
          await this.page.waitForSelector(step.target, { visible: true, timeout: step.timeoutMs || 5000 }).catch(() => null);
        }
        return true;

      case 'eval':
        if (step.script) {
          await this.page.evaluate((js: string) => {
            try { return (window as any).eval(js); } catch { return null; }
          }, step.script).catch(() => null);
        }
        return true;

      case 'confirm_result':
        return await this.combatResolution.handleConfirmResult();

      case 'loop_while':
        return await this.handleLoopWhile(step, runNumber);

      case 'loop_until':
        return await this.handleLoopUntil(step, runNumber);

      case 'skip_story_scene':
        return await this.routineExecution.handleSkipStoryScene(step);

      case 'auto_fate_episode':
      case 'skip_fate_episode':
        return await this.routineExecution.handleFateEpisode(step);

      case 'pro_skip_favorites':
        return await this.routineExecution.handleProSkipFavorites(step);

      case 'dismiss_popups':
        return await this.routineExecution.handleDismissPopups(step);

      case 'smart_full_auto':
        return await this.combatExecution.handleSmartFullAuto(step, runNumber);

      case 'do_until_finish':
      case 'run_daily_target':
        return await this.routineExecution.handleDoUntilFinish(step, runNumber);

      default:
        return true;
    }
  }

  private async handleLoopWhile(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const selector = step.target || step.conditionElement;
    if (!selector || !step.subSteps || step.subSteps.length === 0) return true;
    const maxLoops = step.maxLoops || 50;

    console.log(`[Workflow] 🔄 Starting loop_while: "${selector}" (max loops: ${maxLoops})...`);

    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (this.ctx.state.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      let exists = false;
      const waitLimit = loopIdx === 0 ? 3500 : 600;
      const tCheckStart = Date.now();
      while (Date.now() - tCheckStart < waitLimit) {
        exists = await this.page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }, selector).catch(() => false);

        if (exists) break;
        await new Promise(r => setTimeout(r, 200));
      }

      if (!exists) {
        console.log(`[Workflow] ⏹️ loop_while condition met: element "${selector}" no longer present/visible. Loop completed at cycle ${loopIdx}.`);
        break;
      }

      console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Target "${selector}" active. Executing sub-steps...`);

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];
        const ok = await this.executeSingleStep(sub, s + 1, runNumber);
        if (!ok && !sub.optional) {
          console.warn(`[Workflow] Sub-step ${s + 1} (${sub.code}) failed inside loop_while.`);
          return false;
        }
      }

      await logNormalDelay(300, 0.15);
    }

    return true;
  }

  private async handleLoopUntil(step: WorkflowStep, runNumber: number): Promise<boolean> {
    const selector = step.target || step.conditionElement;
    if (!selector || !step.subSteps || step.subSteps.length === 0) return true;
    const maxLoops = step.maxLoops || 50;

    console.log(`[Workflow] 🔄 Starting loop_until: "${selector}" (max loops: ${maxLoops})...`);

    for (let loopIdx = 0; loopIdx < maxLoops; loopIdx++) {
      if (this.ctx.state.stopRequested) return false;
      if (this.template.stopOnCaptcha !== false) await this.sentinel.assertSafe();

      const exists = await this.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      }, selector).catch(() => false);

      if (exists) {
        console.log(`[Workflow] ⏹️ loop_until target "${selector}" reached. Exiting loop at cycle ${loopIdx}.`);
        break;
      }

      console.log(`[Workflow] [Cycle ${loopIdx + 1}/${maxLoops}] Target not yet met. Executing sub-steps...`);

      for (let s = 0; s < step.subSteps.length; s++) {
        const sub = step.subSteps[s];
        const ok = await this.executeSingleStep(sub, s + 1, runNumber);
        if (!ok && !sub.optional) {
          return false;
        }
      }

      await logNormalDelay(300, 0.15);
    }

    return true;
  }

  // --- Delegated Sub-Service Methods for 100% Backward Compatibility ---

  public async syncCurrentHonors(): Promise<number> {
    return await this.combatResolution.syncCurrentHonors();
  }

  public async isBattleEnded(): Promise<boolean> {
    return await this.combatResolution.isBattleEnded();
  }

  public async ensureInitialCombatReady(timeoutMs = 8000): Promise<void> {
    return await this.combatResolution.ensureInitialCombatReady(timeoutMs);
  }

  public async cancelFullAutoAndActionQueue(): Promise<void> {
    return await this.combatResolution.cancelFullAutoAndActionQueue();
  }

  public async waitForCombatInputReady(timeoutMs = 5000): Promise<boolean> {
    return await this.combatResolution.waitForCombatInputReady(timeoutMs);
  }

  public async waitForBattleToMount(timeoutMs = 15000): Promise<boolean> {
    return await this.combatResolution.waitForBattleToMount(timeoutMs);
  }

  public async waitForBattleToMountOrResult(timeoutMs = 12000): Promise<'MOUNTED' | 'RESULT' | 'TIMEOUT'> {
    return await this.combatResolution.waitForBattleToMountOrResult(timeoutMs);
  }

  public async inspectDomForGoldBar(): Promise<{ hasGoldBar: boolean; raidId?: string }> {
    return await this.combatResolution.inspectDomForGoldBar();
  }

  public async inspectDomForBlueChest(): Promise<boolean> {
    return await this.combatResolution.inspectDomForBlueChest();
  }

  public async checkAndDismissProcessingTurnPopup(): Promise<boolean> {
    return await this.combatResolution.checkAndDismissProcessingTurnPopup();
  }

  public async dismissCombatDrawersAndPopups(): Promise<boolean> {
    return await this.combatResolution.dismissCombatDrawersAndPopups();
  }

  public async handleConfirmResult(): Promise<boolean> {
    return await this.combatResolution.handleConfirmResult();
  }

  public async resolveLingeringState(): Promise<void> {
    return await this.combatResolution.resolveLingeringState();
  }

  public async waitForCombatTurnResolution(targetNet: string | null, totalTimeoutMs = 15000): Promise<boolean> {
    return await this.combatResolution.waitForCombatTurnResolution(targetNet, totalTimeoutMs);
  }

  public async waitForNetworkResponse(targetSubstring: string, timeoutMs: number): Promise<boolean> {
    return await this.combatResolution.waitForNetworkResponse(targetSubstring, timeoutMs);
  }

  public async waitForCombatActionResponse(targetNet: string | null, timeoutMs: number): Promise<boolean> {
    return await this.combatResolution.waitForCombatActionResponse(targetNet, timeoutMs);
  }

  public async checkFiveBattleMilestone(logPath: string, currentRuns: number): Promise<void> {
    if (this.ctx.state.totalJoinedAndClearedBattles > 0 && this.ctx.state.totalJoinedAndClearedBattles % 5 === 0) {
      console.log(`\n========================================================================`);
      console.log(`[Workflow] 🛡️ 5-Battle Milestone Reached (${this.ctx.state.totalJoinedAndClearedBattles} battles joined & cleared)`);
      console.log(`[Workflow] Checking and sweeping pending battles to avoid GBF 5-battle hard lock...`);
      console.log(`========================================================================\n`);
      await this.claimPendingBattles(logPath, currentRuns);
      return;
    }
    return await this.milestoneSweeper.checkFiveBattleMilestone(logPath, currentRuns);
  }

  public async claimPendingBattles(logPath: string, currentRuns: number, returnUrl?: string): Promise<number> {
    return await this.milestoneSweeper.claimPendingBattles(logPath, currentRuns, returnUrl);
  }

  public async detectAndHandlePendingBattleModal(logPath: string, currentRuns: number): Promise<boolean> {
    return await this.milestoneSweeper.detectAndHandlePendingBattleModal(logPath, currentRuns, {
      onRaidLimit: () => this.resolveLingeringRaidLimit(logPath, currentRuns),
      onPendingLimit: (returnUrl) => this.claimPendingBattles(logPath, currentRuns, returnUrl)
    });
  }

  public async resolveLingeringRaidLimit(logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<boolean> {
    return await this.milestoneSweeper.resolveLingeringRaidLimit(logPath, currentRuns);
  }

  public async getLingeringJoinedRaidCount(): Promise<number> {
    return await this.milestoneSweeper.getLingeringJoinedRaidCount();
  }

  public async performActiveAssistCycle(logPath: string, currentRuns: number): Promise<boolean> {
    return await this.milestoneSweeper.performActiveAssistCycle(logPath, currentRuns);
  }

  public async performPassiveWaitCycle(logPath: string, currentRuns: number): Promise<boolean> {
    return await this.milestoneSweeper.performPassiveWaitCycle(logPath, currentRuns);
  }

  public async checkAndClearPendingBattles(logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<void> {
    return await this.milestoneSweeper.checkAndClearPendingBattles(logPath, currentRuns);
  }

  public async deepAnalyzeScreenState() {
    return await this.screenDiagnostic.deepAnalyzeScreenState();
  }

  public async diagnoseQuestStartFailure(runNumber: number) {
    return await this.screenDiagnostic.diagnoseQuestStartFailure(runNumber);
  }

  public async diagnoseAndRecoverQuestStart(runNumber: number, autoReplenishAp = true, autoReplenishEp = true, logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns) {
    return await this.screenDiagnostic.diagnoseAndRecoverQuestStart(runNumber, autoReplenishAp, autoReplenishEp, logPath, currentRuns);
  }

  public async dismissPopupModal(): Promise<boolean> {
    return await this.screenDiagnostic.dismissPopupModal();
  }

  public async dismissFullOrEndedRaidPopup(): Promise<boolean> {
    return await this.screenDiagnostic.dismissFullOrEndedRaidPopup();
  }

  public async selectSupporterAndStartQuest(autoReplenishAp: boolean, autoReplenishEp: boolean, logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<boolean> {
    return await this.questNavigation.selectSupporterAndStartQuest(autoReplenishAp, autoReplenishEp, logPath, currentRuns);
  }

  public async joinAssistRaidAndStartQuest(slots: number | number[], autoReplenishEp: boolean, logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<boolean> {
    return await this.questNavigation.joinAssistRaidAndStartQuest(slots, autoReplenishEp, logPath, currentRuns);
  }

  public async waitForSupporterOrModal(timeoutMs = 10000) {
    return await this.questNavigation.waitForSupporterOrModal(timeoutMs);
  }

  public async selectSupporterCard(priorities: string[]): Promise<boolean> {
    return await this.questNavigation.selectSupporterCard(priorities);
  }

  public async confirmPartyAndStartRaid(autoReplenishEp: boolean, logPath = this.ctx.state.currentLogPath, currentRuns = this.ctx.state.totalCompletedRuns): Promise<boolean> {
    return await this.questNavigation.confirmPartyAndStartRaid(autoReplenishEp, logPath, currentRuns);
  }

  public async waitForActiveRaidSlot(maxWaitSec = 90): Promise<boolean> {
    return await this.questNavigation.waitForActiveRaidSlot(maxWaitSec);
  }

  public async handleProSkipFavorites(step?: WorkflowStep): Promise<boolean> {
    return await this.routineExecution.handleProSkipFavorites(step);
  }

  public async handleDismissPopups(step?: WorkflowStep): Promise<boolean> {
    return await this.routineExecution.handleDismissPopups(step);
  }

  public getDailyCatalogTask(tagOrId: string): any | null {
    return this.routineExecution.getDailyCatalogTask(tagOrId);
  }

  public async navigateIfNeeded(targetUrl: string): Promise<void> {
    return await this.routineExecution.navigateIfNeeded(targetUrl);
  }

  public async evaluateTargetFinished(selector: string): Promise<boolean> {
    return await this.routineExecution.evaluateTargetFinished(selector);
  }

  public async handleApRecoveryModal(): Promise<boolean> {
    return await this.routineExecution.handleApRecoveryModal();
  }

  public async handleAapRecoveryModal(autoReplenishAap = true): Promise<boolean> {
    return await this.routineExecution.handleAapRecoveryModal(autoReplenishAap);
  }

  public async ensureProListModalOpen(): Promise<boolean> {
    return await this.routineExecution.ensureProListModalOpen();
  }

  public async closeProListModalIfOpen(): Promise<void> {
    return await this.routineExecution.closeProListModalIfOpen();
  }

  public async executeAutomatedProSkip(task: any, selector?: string): Promise<boolean> {
    return await this.routineExecution.executeAutomatedProSkip(task, selector);
  }

  public async executeAutomatedRupieGacha(task: any, selector?: string): Promise<boolean> {
    return await this.routineExecution.executeAutomatedRupieGacha(task, selector);
  }

  public async executeAutomatedSkyscopeMission(task: any, selector?: string): Promise<boolean> {
    return await this.routineExecution.executeAutomatedSkyscopeMission(task, selector);
  }

  public async executeAutomatedCasinoExchange(task: any, selector?: string): Promise<boolean> {
    return await this.routineExecution.executeAutomatedCasinoExchange(task, selector);
  }

  public async executeGenericClickUntilFinish(selector?: string): Promise<boolean> {
    return await this.routineExecution.executeGenericClickUntilFinish(selector);
  }

  public async handleDoUntilFinish(step: WorkflowStep, runNumber: number): Promise<boolean> {
    return await this.routineExecution.handleDoUntilFinish(step, runNumber);
  }

  public async handleSkipStoryScene(step: WorkflowStep): Promise<boolean> {
    return await this.routineExecution.handleSkipStoryScene(step);
  }

  public async handleFateEpisode(step?: WorkflowStep): Promise<boolean> {
    return await this.routineExecution.handleFateEpisode(step);
  }

  public async handleRepeat(step: WorkflowStep, runNumber: number): Promise<boolean> {
    return await this.combatExecution.handleRepeat(step, runNumber);
  }

  public async handleExitIfScore(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleExitIfScore(step);
  }

  public async handleWaitTurn(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleWaitTurn(step);
  }

  public async handleTargetEnemy(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleTargetEnemy(step);
  }

  public async handleHeal(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleHeal(step);
  }

  public async handleBackupRequest(): Promise<boolean> {
    return await this.combatExecution.handleBackupRequest();
  }

  public async handleSkill(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleSkill(step);
  }

  public async handleSummon(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleSummon(step);
  }

  public async handleAuto(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleAuto(step);
  }

  public async handleGuard(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleGuard(step);
  }

  public async handleSmartFullAuto(step: WorkflowStep, runNumber: number): Promise<boolean> {
    return await this.combatExecution.handleSmartFullAuto(step, runNumber);
  }

  public async executeTacticalReadySkills(targetCharacters?: number[], healHpThreshold = 0.75, minHealHpThreshold = 0.60, turn = 1): Promise<void> {
    return await this.combatExecution.executeTacticalReadySkills(targetCharacters, healHpThreshold, minHealHpThreshold, turn);
  }

  public async executeOptimalReadySkills(targetCharacters?: number[]): Promise<void> {
    return await this.combatExecution.executeOptimalReadySkills(targetCharacters);
  }

  public async isPlainDamageOmenActive(): Promise<boolean> {
    return await this.combatExecution.isPlainDamageOmenActive();
  }

  public async executeBeelzebubSummonIfAvailable(): Promise<boolean> {
    return await this.combatExecution.executeBeelzebubSummonIfAvailable();
  }

  public async handleTapReady(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleTapReady(step);
  }

  public async handleQuickCall(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleQuickCall(step);
  }

  public async handleAttack(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleAttack(step);
  }

  public async handleReload(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleReload(step);
  }

  public async handleClick(step: WorkflowStep): Promise<boolean> {
    return await this.combatExecution.handleClick(step);
  }

  public async ensureMinimumHonors(minHonors = 1500000, maxExtraTurns = 25): Promise<void> {
    return await this.combatExecution.ensureMinimumHonors(minHonors, maxExtraTurns);
  }

  private ensureLogDirExists(logPath: string): void {
    const dir = path.dirname(path.resolve(process.cwd(), logPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private appendRunLog(logPath: string, result: WorkflowRunResult): void {
    const fullPath = path.resolve(process.cwd(), logPath);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(
        fullPath,
        `# Workflow Execution Log: ${this.template.name} (${this.accountId})\n\n| Run | Time | Duration | Status | Honors | Notes |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`,
        'utf-8'
      );
    }
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = `| ${result.runNumber} | ${timestamp} | ${(result.durationMs / 1000).toFixed(1)}s | ${result.status} | ${result.honors?.toLocaleString() || '0'} | ${result.message} |\n`;
    fs.appendFileSync(fullPath, line, 'utf-8');

    try {
      const jsonlPath = fullPath.replace(/\.md$/i, '.jsonl');
      const event = {
        runNumber: result.runNumber,
        timestamp: new Date().toISOString(),
        timeStr: timestamp,
        durationMs: result.durationMs,
        status: result.status,
        honors: result.honors || 0,
        message: result.message,
        accountId: this.accountId,
        templateName: this.template.name
      };
      fs.appendFileSync(jsonlPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Non-critical logging failure
    }
  }
}

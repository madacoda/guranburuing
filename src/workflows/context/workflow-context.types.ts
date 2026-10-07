// src/workflows/context/workflow-context.types.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import { WorkflowActionType, WorkflowStep, WorkflowTemplate } from '../../types/workflow.types.js';
import { ICombatActionService } from '../../domain/combat/combat.types.js';
import { IPendingBattleService, IRecoveryModalService, ISupporterSelectionService } from '../../domain/navigation/navigation.types.js';
import { ILootTrackerService } from '../../domain/telemetry/loot.types.js';
import { DropLogger } from '../../engines/drop-logger.js';
import { AlertRelay } from '../../alert-relay.js';

export interface StepExecutionResult {
  success: boolean;
  actionCode: WorkflowActionType;
  durationMs: number;
  message?: string;
  shouldExitEarly?: boolean;
}

export interface WorkflowExecutionState {
  currentScore: number;
  currentTurn: number;
  currentRaidId: string;
  isCombatActive: boolean;
  totalGoldBarsAccumulated: number;
  totalBlueChestsAccumulated: number;
  totalHonorsAccumulated: number;
  totalCompletedRuns: number;
  lastAttackLockoutExpires: number;
  stopRequested: boolean;
  myUserId?: string;
}

export interface WorkflowServices {
  combat: ICombatActionService;
  recovery: IRecoveryModalService;
  pending: IPendingBattleService;
  supporter: ISupporterSelectionService;
  loot: ILootTrackerService;
  sentinel: SentinelWatchdog;
  alertRelay: AlertRelay;
  dropLogger?: DropLogger;
}

export interface WorkflowExecutionContext {
  page: Page;
  template: WorkflowTemplate;
  accountId: string;
  playerName?: string;
  services: WorkflowServices;
  state: WorkflowExecutionState;
  
  // High-level engine delegation callbacks
  executeSubSteps: (steps: WorkflowStep[], runNumber: number) => Promise<boolean>;
  executeStep: (step: WorkflowStep, stepNum: number, runNumber: number) => Promise<boolean>;
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: any) => void;
}

export interface IStepHandler {
  readonly supportedActions: WorkflowActionType[];
  execute(step: WorkflowStep, context: WorkflowExecutionContext): Promise<StepExecutionResult>;
}

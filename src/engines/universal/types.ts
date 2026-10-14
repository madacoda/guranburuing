// src/engines/universal/types.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import { WorkflowTemplate, WorkflowRunResult } from '../../types/workflow.types.js';
import { AlertRelay } from '../../alert-relay.js';
import { DropLogger } from '../drop-logger.js';

export interface UniversalWorkflowState {
  stopRequested: boolean;
  totalGoldBarsAccumulated: number;
  totalBlueChestsAccumulated: number;
  totalHonorsAccumulated: number;
  totalLootItemsAccumulated: number;
  currentRaidId: string;
  myUserId: string;
  currentScore: number;
  currentTurn: number;
  joinedInCurrentBatch: number;
  currentBatchThreshold: number;
  latestRewardData: any;
  currentLogPath: string;
  currentDropLogPath?: string;
  currentWorkflowLogPath: string;
  currentBattleHadGoldBar: boolean;
  currentBattleHadBlueChest: boolean;
  totalCompletedRuns: number;
  dailyCatalogCache: any[] | null;
  totalJoinedAndClearedBattles: number;
  lastStartFailureWasRaidLimit: boolean;
  lastStartFailureWasRaidWait: boolean;
  lastStartFailureWasMaintenance: boolean;
  consecutiveEmptyRaidSearches: number;
  deadRaidIds: Map<string, number>;
  playerName?: string;
  lastAttackLockoutExpires: number;
  lastProcessedAttackKey?: string;
  isClaimingPending?: boolean;
}

export interface UniversalContext {
  page: Page;
  sentinel: SentinelWatchdog;
  template: WorkflowTemplate;
  accountId: string;
  state: UniversalWorkflowState;
  alertRelay: AlertRelay;
  dropLogger?: DropLogger;
  updatePage: (newPage: Page) => void;
}

export type ScreenCondition =
  | 'NONE'
  | 'SOUL_BERRY_DEPLETED'
  | 'AP_DEPLETED'
  | 'ACTIVE_RAID_LIMIT_3'
  | 'PENDING_BATTLES_LIMIT'
  | 'RAID_FULL_OR_ENDED'
  | 'SUSPENDED_QUEST'
  | 'DAILY_HOST_LIMIT'
  | 'COMMUNICATION_ERROR'
  | 'CAPTCHA_CHALLENGE'
  | 'UNKNOWN_MODAL';

export interface ScreenAnalysisResult {
  condition: ScreenCondition;
  title: string;
  message: string;
  hasPopup: boolean;
  canAutoRecover: boolean;
  rawText: string;
}

export interface QuestStartRecoveryResult {
  recovered: boolean;
  condition: ScreenCondition;
  reason: string;
  isFatal: boolean;
  capturePath?: string;
}

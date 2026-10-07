// src/domain/daily-host/daily-host.interfaces.ts
import { Page } from 'puppeteer-core';
import {
  DailyRaidHostDefinition,
  DailyRaidExecutionRecord,
  DailyHostExecutionSummary,
  HostPreconditionCheck,
  BackupBroadcastResult,
  HostedCombatOutcome
} from './daily-host.types.js';

/**
 * Interface for detecting and resuming any in-progress self-hosted raid.
 * (Single Responsibility: In-progress raid detection & resumption).
 */
export interface IActiveHostedRaidScanner {
  updatePage(page: Page): void;
  scanAndResumeActiveHostedRaid(scanRecentTab?: boolean): Promise<DailyRaidExecutionRecord | null>;
}

/**
 * Interface for navigating Stage cards and category modals on #quest/multi/0.
 * (Single Responsibility: UI Stage Navigation).
 */
export interface IStageModalNavigator {
  updatePage(page: Page): void;
  navigateToMultiList(): Promise<void>;
  openStageCategoryModal(stageId: string): Promise<boolean>;
  closeStageCategoryModal(): Promise<void>;
  resetActiveStage(): void;
  getActiveStageId(): string | null;
}

/**
 * Interface for validating quest limits and treasure requirements.
 * (Single Responsibility: Host Precondition Validation).
 */
export interface IHostPreconditionValidator {
  updatePage(page: Page): void;
  inspectQuestAvailability(questId: string): Promise<HostPreconditionCheck>;
  clickQuestPlay(questId: string): Promise<boolean>;
  verifyTreasureRequirements(): Promise<{ hasMaterials: boolean; reason: string }>;
  confirmTreasureOffer(): Promise<boolean>;
  dismissTreasureModal(): Promise<void>;
}

/**
 * Interface for supporter summon selection and party deck launching.
 * (Single Responsibility: Supporter & Quest Launch).
 */
export interface ISupporterPartyLauncher {
  updatePage(page: Page): void;
  requestStop?(): void;
  selectSupporterSummon(priorities?: string[]): Promise<boolean>;
  confirmPartyAndLaunchQuest(): Promise<boolean>;
}

/**
 * Interface for broadcasting multiplayer backup requests.
 * (Single Responsibility: Multiplayer Backup Broadcast).
 */
export interface IBackupBroadcastService {
  updatePage(page: Page): void;
  broadcastBackupRequestToAll(): Promise<BackupBroadcastResult>;
  canBroadcastBackup(): Promise<boolean>;
  getLastBroadcastTimestamp(): number;
}

/**
 * Interface for executing smart combat on hosted raids until victory.
 * (Single Responsibility: Hosted Combat Orchestration).
 */
export interface IHostedCombatRunner {
  updatePage(page: Page): void;
  requestStop(): void;
  executeHostedCombat(raid: DailyRaidHostDefinition, maxTurns?: number): Promise<HostedCombatOutcome>;
  confirmAndDismissBattleResult(): Promise<void>;
}

/**
 * Interface for rendering and saving run reports.
 * (Single Responsibility: Telemetry Reporting & Audit Persistence).
 */
export interface IDailyHostReporter {
  renderConsoleSummary(summary: DailyHostExecutionSummary): void;
  persistMarkdownAuditReport(summary: DailyHostExecutionSummary, logPath?: string): string;
}

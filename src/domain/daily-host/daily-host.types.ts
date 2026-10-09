// src/domain/daily-host/daily-host.types.ts

/**
 * Standardized Category for Daily Hosted Raids.
 */
export type DailyRaidCategory = 'hl' | 'magna3' | 'dragons' | 'standard';

/**
 * Authoritative Domain Definition for a Daily Hosted Raid.
 * Strictly standardizes naming across all database and execution contexts.
 */
export interface DailyRaidHostDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: DailyRaidCategory;
  readonly stageId: string;
  readonly questId: string;
  readonly chapterId: string;
  readonly dailyLimit: number;
  readonly apCost: number;
}

/**
 * Discrete Execution Status for a Daily Hosted Raid.
 */
export type DailyRaidExecutionStatus =
  | 'CLEARED'
  | 'SKIPPED_NO_MATERIAL'
  | 'SKIPPED_LIMIT'
  | 'FAILED'
  | 'STOPPED';

/**
 * Result of Precondition Verification (Limits & Materials).
 */
export interface HostPreconditionCheck {
  readonly isAvailable: boolean;
  readonly remainingHostsToday: number;
  readonly hasRequiredMaterials: boolean;
  readonly heldMaterialCount: number | null;
  readonly requiredMaterialCount: number | null;
  readonly status: 'AVAILABLE' | 'SKIPPED_LIMIT' | 'SKIPPED_NO_MATERIAL';
  readonly reason: string;
  readonly isInProgress?: boolean;
  readonly activeRaidId?: string;
}

/**
 * Scopes for Multiplayer Backup Requests.
 */
export type BackupBroadcastScope = 'Everyone' | 'Friends' | 'Crew';

/**
 * Result of Multiplayer Backup Broadcast.
 */
export interface BackupBroadcastResult {
  readonly broadcastSuccessful: boolean;
  readonly activeScopes: BackupBroadcastScope[];
  readonly wasOnCooldown: boolean;
  readonly message: string;
}

/**
 * Telemetry and Outcome of In-Battle Combat Resolution.
 */
export interface HostedCombatOutcome {
  readonly isVictoryConfirmed: boolean;
  readonly turnsElapsed: number;
  readonly honorsEarned: number;
  readonly message: string;
  readonly durationMs: number;
  readonly yieldedToAssist?: boolean;
  readonly activeRaidId?: string;
}

/**
 * Comprehensive Execution Record for an Individual Raid Attempt.
 */
export interface DailyRaidExecutionRecord {
  readonly raid: DailyRaidHostDefinition;
  readonly status: DailyRaidExecutionStatus;
  readonly turnsElapsed: number;
  readonly honorsEarned: number;
  readonly durationMs: number;
  readonly message: string;
  readonly executedAt: string;

  // Backward compatibility aliases
  readonly turns?: number;
  readonly honors?: number;
  readonly timestamp?: string;
}

/**
 * Complete Executive Summary for a Daily Host Session.
 */
export interface DailyHostExecutionSummary {
  readonly accountId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly totalRaidsTargeted: number;
  readonly clearedCount: number;
  readonly skippedNoMaterialCount: number;
  readonly skippedLimitCount: number;
  readonly failedCount: number;
  readonly executionRecords: DailyRaidExecutionRecord[];
  readonly retriedCount?: number;
  readonly retriedClearedCount?: number;
  readonly failureDiagnoses?: any[];

  // Backward compatibility aliases
  readonly account?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly totalRaids?: number;
  readonly cleared?: number;
  readonly skippedNoMaterial?: number;
  readonly skippedLimit?: number;
  readonly failed?: number;
  readonly results?: DailyRaidExecutionRecord[];
}

/**
 * Options passed to the Daily Host Orchestrator.
 */
export interface DailyHostExecutionOptions {
  categoryFilter?: DailyRaidCategory | 'all';
  specificRaidId?: string;
  autoReplenishAp?: boolean;
  maxTurnsPerRaid?: number;
  speedProfile?: 'fast' | 'normal' | 'turbo';
  logPath?: string;

  // Senior Gold Standard Interleaved Assist Farming Options
  enableAssistInterleaving?: boolean;
  assistActivity?: 'gb-farm' | 'gb-pbhl' | 'gb-akasha' | 'gb-go' | string;
  maxCombatTimeBeforeYieldMs?: number;
  maxCombatTurnsBeforeYield?: number;
  hostedRaidRecheckIntervalMs?: number;

  // Autonomous Self-Healing Retry Options
  autoRetryFailures?: boolean; // When true, runs a targeted self-healing pass on transiently failed raids
  maxFailureRetries?: number;  // Max retry attempts per failed raid (default: 2)
}

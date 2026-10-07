// src/domain/gold-bar/gold-bar.types.ts

/**
 * Valid Gold Bar raid identifiers.
 */
export type GoldBarRaidId = 'pbhl' | 'akasha' | 'go';

/**
 * Immutable definition of a Gold Bar hunting raid.
 */
export interface GoldBarRaidDefinition {
  readonly id: GoldBarRaidId;
  readonly name: string;
  readonly shortName: string;
  readonly questId: string;
  readonly chapterId: string;
  readonly finderSlot: number;
  readonly defaultTargetScore: number;
  readonly defaultLogPath: string;
  readonly supporterPriorities: readonly string[];
  readonly sweetSpotMinHp: number;
  readonly sweetSpotMaxPlayers: number;
  readonly sweetSpotBackupMinHp: number;
  readonly sweetSpotBackupMaxPlayers: number;
}

/**
 * Execution outcome for a single Gold Bar raid attempt.
 */
export interface GoldBarCombatOutcome {
  readonly status:
    | 'SUCCESS'
    | 'TARGET_SCORE_REACHED'
    | 'RAID_EXPIRED'
    | 'ROOM_FULL'
    | 'PENDING_LIMIT'
    | 'EP_DEFICIENT'
    | 'JOIN_FAILED'
    | 'FAILED';
  readonly finalScore: number;
  readonly turnsElapsed: number;
  readonly durationMs: number;
  readonly message: string;
}

/**
 * Options for continuous Gold Bar hunting loops.
 */
export interface GoldBarFarmingOptions {
  runs?: number;
  targetScore?: number;
  autoReplenishEp?: boolean;
  minBatchClaim?: number;
  maxBatchClaim?: number;
  batchClaimSize?: number;
  logPath?: string;
}

/**
 * Telemetry summary for a Gold Bar farming session.
 */
export interface GoldBarFarmingSummary {
  readonly totalRunsAttempted: number;
  readonly totalRunsCompleted: number;
  readonly totalGoldBars: number;
  readonly battlesWithoutGb: number;
  readonly currentDryStreak: number;
  readonly dropRatePct: string;
  readonly durationMs: number;
}

/**
 * Options for directly joining a specific Gold Bar raid target.
 */
export interface GoldBarJoinOptions {
  raidTarget: string;
  targetScore?: number;
  autoReplenishEp?: boolean;
}

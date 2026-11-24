// src/domain/combat/combat.types.ts

export type SkillSlot = 1 | 2 | 3 | 4;
export type CharacterSlot = 1 | 2 | 3 | 4;

export interface SkillInvocationOptions {
  character: CharacterSlot;
  skill: SkillSlot;
  target?: CharacterSlot;
  timeoutMs?: number;
  ensureCast?: boolean;
  retries?: number;
}

export interface SkillInvocationOutcome {
  success: boolean;
  queued: boolean;
  verified?: boolean;
  attempts?: number;
  character: CharacterSlot;
  skill: SkillSlot;
  abilityId?: string;
  abilityName?: string;
  recastBefore?: string;
  recastAfter?: string;
  message?: string;
}

export type StepExecutionOutcomeStatus =
  | 'CONFIRMED_NETWORK'
  | 'CONFIRMED_STATE_MUTATION'
  | 'CONFIRMED_DIRECT'
  | 'SKIPPED_COOLDOWN'
  | 'SKIPPED_KO'
  | 'SKIPPED_BATTLE_ENDED'
  | 'SKIPPED_CONDITION_MET'
  | 'SKIPPED_OPTIONAL'
  | 'UNACKNOWLEDGED_CONTINUED'
  | 'FAILED_TIMEOUT';

export interface StepStateSnapshot {
  timestamp: number;
  turn: number;
  wave: number;
  bossHp: number;
  bossMaxHp: number;
  bossHpPct: number;
  honors: number;
  abilityId?: string;
  abilityName?: string;
  recast?: string;
  railCount?: number;
  networkSequenceId: number;
}

export interface StepExecutionReceipt {
  runNumber: number;
  stepNumber: number;
  stepCode: string;
  stepLabel: string;
  ensureCast?: boolean;
  status: StepExecutionOutcomeStatus;
  verified: boolean;
  attempts: number;
  durationMs: number;
  damageDealt: number;
  honorsGained: number;
  preState?: StepStateSnapshot;
  postState?: StepStateSnapshot;
  networkConfirmed: boolean;
  stateMutated: boolean;
  recastTransition?: string;
  reason?: string;
}

export type StepHealthStatus = 'HEALTHY' | 'RETRY_HEAVY' | 'SKIP_ANOMALY' | 'FAILING';

export interface StepHotspotStats {
  stepNumber: number;
  stepCode: string;
  stepLabel: string;
  ensureCast: boolean;
  executions: number;
  confirmedCount: number;
  firstTryCount: number;
  retriedCount: number;
  totalExtraAttempts: number;
  cooldownSkipCount: number;
  ensuredCooldownSkipCount: number;
  koSkipCount: number;
  failedCount: number;
  noopMutationCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  failureRatePct: number;
  retryRatePct: number;
  skipRatePct: number;
  healthStatus: StepHealthStatus;
  lastReason?: string;
  diagnosticHint?: string;
}

export type StepAuditFindingCategory =
  | 'UNOPENED_SUMMON_TRAY'
  | 'FAILED_CHARACTER_SWAP_CASCADE'
  | 'ENSURED_STEP_SKIPPED'
  | 'HIGH_RETRY_LOCK_CONTENTION'
  | 'NOOP_CAST_RESPONSE'
  | 'STEP_TIMEOUT';

export interface StepAuditRootCauseFinding {
  stepNumber: number;
  stepLabel: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  category: StepAuditFindingCategory;
  summary: string;
  downstreamStepNumbers?: number[];
}

export interface RunExecutionAuditReport {
  runNumber: number;
  totalStepsPlanned: number;
  totalStepsExecuted: number;
  confirmedSteps: number;
  skippedCooldownSteps: number;
  ensuredCooldownSkips?: number;
  retriedSteps: number;
  failedSteps: number;
  unacknowledgedSteps: number;
  perfectExecution: boolean;
  receipts: StepExecutionReceipt[];
  findings?: StepAuditRootCauseFinding[];
}

export interface AttackInvocationOutcome {
  success: boolean;
  turnsElapsed: number;
  durationMs: number;
  message?: string;
}

export interface SummonInvocationOptions {
  slot?: number; // 1-6 or quick summon
  isQuickCall?: boolean;
}

export interface BackupRequestOptions {
  shareToAll?: boolean;
  requestFriends?: boolean;
  requestCrew?: boolean;
}

export interface BackupRequestOutcome {
  requested: boolean;
  sharedAll: boolean;
  message: string;
}

export interface ICombatActionService {
  triggerSkill(options: SkillInvocationOptions): Promise<SkillInvocationOutcome>;
  triggerQuickCall(): Promise<boolean>;
  triggerAttack(options?: { expectLockout?: boolean }): Promise<AttackInvocationOutcome>;
  toggleAutoMode(enableFullAuto?: boolean): Promise<boolean>;
  requestBackup(options?: BackupRequestOptions): Promise<BackupRequestOutcome>;
  dismissCombatDrawersAndPopups(): Promise<boolean>;
  waitForCombatInputReady(timeoutMs?: number): Promise<boolean>;
}

// src/domain/combat/combat.types.ts

export type SkillSlot = 1 | 2 | 3 | 4;
export type CharacterSlot = 1 | 2 | 3 | 4;

export interface SkillInvocationOptions {
  character: CharacterSlot;
  skill: SkillSlot;
  target?: CharacterSlot;
  timeoutMs?: number;
}

export interface SkillInvocationOutcome {
  success: boolean;
  queued: boolean;
  character: CharacterSlot;
  skill: SkillSlot;
  message?: string;
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

// src/domain/navigation/navigation.types.ts
import { Page } from 'puppeteer-core';

/**
 * Resource type for player stamina replenishment.
 */
export type RecoveryResourceType = 'AP' | 'EP' | 'AAP';

/**
 * Outcome of attempting resource recovery.
 */
export interface ResourceRecoveryOutcome {
  readonly resource: RecoveryResourceType;
  readonly wasRequired: boolean;
  readonly recoverySuccessful: boolean;
  readonly itemsUsed: number;
  readonly message: string;
}

/**
 * Outcome of inspecting and clearing pending / unclaimed battles.
 */
export interface PendingBattleResolution {
  readonly hasPendingBattles: boolean;
  readonly unclaimedCount: number;
  readonly clearedCount: number;
  readonly goldBarDetected: boolean;
  readonly blueChestDetected: boolean;
  readonly message: string;
}

/**
 * Result of supporter summon selection.
 */
export interface SupporterSelectionOutcome {
  readonly selected: boolean;
  readonly summonName?: string;
  readonly element?: string;
  readonly isFriendSummon: boolean;
  readonly message: string;
}

/**
 * Abstraction for resource recovery management.
 */
export interface IRecoveryModalService {
  updatePage(page: Page): void;
  handleApRecovery(autoElixir?: boolean): Promise<ResourceRecoveryOutcome>;
  handleEpRecovery(autoBerry?: boolean): Promise<ResourceRecoveryOutcome>;
  handleAapRecovery(): Promise<ResourceRecoveryOutcome>;
  handleAnyRecovery(options?: { autoElixir?: boolean; autoBerry?: boolean }): Promise<ResourceRecoveryOutcome | null>;
}

/**
 * Abstraction for pending battle management.
 */
export interface IPendingBattleService {
  updatePage(page: Page): void;
  checkAndClearPendingBattles(targetUrlAfterClean?: string): Promise<PendingBattleResolution>;
  inspectUnclaimedCount(): Promise<number>;
}

export interface SupporterSelectionOptions {
  priorities?: string[];
  attribute?: string;
  selectFirstIfNotFound?: boolean;
}

/**
 * Abstraction for supporter summon selection.
 */
export interface ISupporterSelectionService {
  updatePage(page: Page): void;
  selectSupporter(options?: SupporterSelectionOptions): Promise<SupporterSelectionOutcome>;
}



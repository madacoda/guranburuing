// src/types/daily-host.types.ts
export * from '../domain/daily-host/daily-host.types.js';

import type {
  DailyRaidCategory,
  DailyRaidHostDefinition,
  DailyRaidExecutionStatus,
  DailyRaidExecutionRecord,
  DailyHostExecutionSummary,
  DailyHostExecutionOptions
} from '../domain/daily-host/daily-host.types.js';

/**
 * Backward compatibility aliases.
 * Standardizes upon DailyRaid* domain types while preserving legacy call signatures.
 */
export type DailyHostCategory = DailyRaidCategory;
export type DailyHostRaidDef = DailyRaidHostDefinition;
export type DailyHostStatus = DailyRaidExecutionStatus;
export type DailyHostRaidResult = DailyRaidExecutionRecord;
export type DailyHostRunSummary = DailyHostExecutionSummary;
export type DailyHostOptions = DailyHostExecutionOptions;


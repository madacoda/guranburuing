// src/engines/pbhl.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { GoldBarHunterEngine } from './gold-bar-hunter.engine.js';
import { GOLD_BAR_RAID_CATALOG } from '../domain/gold-bar/gold-bar.catalog.js';
import {
  GoldBarCombatOutcome,
  GoldBarFarmingOptions,
  GoldBarFarmingSummary,
  GoldBarJoinOptions
} from '../domain/gold-bar/gold-bar.types.js';

// Legacy Type Aliases for 100% Backward Compatibility
export type PbhlJoinOptions = GoldBarJoinOptions;
export type PbhlCombatResult = GoldBarCombatOutcome;
export type PbhlFarmingOptions = GoldBarFarmingOptions;
export type PbhlFarmingSummary = GoldBarFarmingSummary;

/**
 * Proto Bahamut HL (PBHL / Tsuyo Baha) automated Gold Bar hunter.
 * Adheres to SOLID: Extends unified GoldBarHunterEngine with PBHL catalog specifications.
 */
export class PbhlEngine extends GoldBarHunterEngine {
  constructor(
    page: Page,
    sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {
    super(page, sentinel, GOLD_BAR_RAID_CATALOG.pbhl);
  }

  /**
   * Continuous farming loop for Proto Bahamut HL.
   */
  public async runPbhlFarmingLoop(options: PbhlFarmingOptions = {}): Promise<PbhlFarmingSummary> {
    return await this.runFarmingLoop(options);
  }

  /**
   * Directly joins and bursts a specific PBHL raid target.
   */
  public async joinAndBurstPbhl(options: PbhlJoinOptions): Promise<PbhlCombatResult> {
    return await this.joinAndBurstRaid(options);
  }

  /**
   * Alias for joinAndBurstPbhl for backward compatibility.
   */
  public async runPbhl(options: PbhlJoinOptions): Promise<PbhlCombatResult> {
    return await this.joinAndBurstPbhl(options);
  }
}

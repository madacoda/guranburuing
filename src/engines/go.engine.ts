// src/engines/go.engine.ts
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
export type GoJoinOptions = GoldBarJoinOptions;
export type GoCombatResult = GoldBarCombatOutcome;
export type GoFarmingOptions = GoldBarFarmingOptions;
export type GoFarmingSummary = GoldBarFarmingSummary;

/**
 * Grand Order HL (GO HL / The Peacemaker's Wings) automated Gold Bar hunter.
 * Adheres to SOLID: Extends unified GoldBarHunterEngine with Grand Order HL catalog specifications.
 */
export class GoEngine extends GoldBarHunterEngine {
  constructor(
    page: Page,
    sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {
    super(page, sentinel, GOLD_BAR_RAID_CATALOG.go);
  }

  /**
   * Continuous farming loop for Grand Order HL.
   */
  public async runGoFarmingLoop(options: GoFarmingOptions = {}): Promise<GoFarmingSummary> {
    return await this.runFarmingLoop(options);
  }

  /**
   * Directly joins and bursts a specific Grand Order HL raid target.
   */
  public async joinAndBurstGo(options: GoJoinOptions): Promise<GoCombatResult> {
    return await this.joinAndBurstRaid(options);
  }

  /**
   * Alias for joinAndBurstGo for backward compatibility.
   */
  public async runGo(options: GoJoinOptions): Promise<GoCombatResult> {
    return await this.joinAndBurstGo(options);
  }
}

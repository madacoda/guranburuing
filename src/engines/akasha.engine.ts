// src/engines/akasha.engine.ts
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
export type AkashaJoinOptions = GoldBarJoinOptions;
export type AkashaCombatResult = GoldBarCombatOutcome;
export type AkashaFarmingOptions = GoldBarFarmingOptions;
export type AkashaFarmingSummary = GoldBarFarmingSummary;

/**
 * Akasha HL automated Gold Bar hunter.
 * Adheres to SOLID: Extends unified GoldBarHunterEngine with Akasha catalog specifications.
 */
export class AkashaEngine extends GoldBarHunterEngine {
  constructor(
    page: Page,
    sentinel: SentinelWatchdog = new SentinelWatchdog(page)
  ) {
    super(page, sentinel, GOLD_BAR_RAID_CATALOG.akasha);
  }

  /**
   * Continuous farming loop for Akasha HL.
   */
  public async runAkashaFarmingLoop(options: AkashaFarmingOptions = {}): Promise<AkashaFarmingSummary> {
    return await this.runFarmingLoop(options);
  }

  /**
   * Directly joins and bursts a specific Akasha raid target.
   */
  public async joinAndBurstAkasha(options: AkashaJoinOptions): Promise<AkashaCombatResult> {
    return await this.joinAndBurstRaid(options);
  }

  /**
   * Alias for joinAndBurstAkasha for backward compatibility.
   */
  public async runAkasha(options: AkashaJoinOptions): Promise<AkashaCombatResult> {
    return await this.joinAndBurstAkasha(options);
  }
}

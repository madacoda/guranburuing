// src/domain/gold-bar/gold-bar.interfaces.ts
import { Page } from 'puppeteer-core';
import {
  GoldBarCombatOutcome,
  GoldBarFarmingOptions,
  GoldBarFarmingSummary,
  GoldBarJoinOptions
} from './gold-bar.types.js';

export interface IGoldBarHunterEngine {
  updatePage(page: Page): void;
  requestStop(): void;
  runFarmingLoop(options?: GoldBarFarmingOptions): Promise<GoldBarFarmingSummary>;
  joinAndBurstRaid(options: GoldBarJoinOptions): Promise<GoldBarCombatOutcome>;
}

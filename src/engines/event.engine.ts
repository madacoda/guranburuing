// src/engines/event.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import {
  ActiveStoryCard,
  CollaborationQuestOptions,
  CollaborationQuestSummary,
  EventCombatHelper,
  EventCollaborationService,
  EventEngineHost,
  EventFullRoutineSummary,
  EventGachaService,
  EventNightmareService,
  EventStoryProgress,
  EventStoryService,
  EventStorySummary,
  EventTokenGachaProgress,
  EventTokenGachaSummary,
  ResolvedEventInfo
} from './event/index.js';

export type {
  ActiveStoryCard,
  CollaborationQuestOptions,
  CollaborationQuestSummary,
  EventEngineHost,
  EventFullRoutineSummary,
  EventStoryProgress,
  EventStorySummary,
  EventTokenGachaProgress,
  EventTokenGachaSummary,
  ResolvedEventInfo
};

/**
 * EventEngine
 * Granblue Fantasy Story Event (treasureraid & biography) Automation Engine.
 * Supports:
 * - Autonomous Main Story Clears (dialogue fast-skip + story combat)
 * - 1-Time Challenge Quest Clears (fixed party puzzle battle)
 * - Daily Maniac Solo Clears (2/2 daily limit)
 * - Nightmare (HELL) Detection and 1-Click Skip / Battle
 * - Daily Event Raid Mission Claims (50 Crystals)
 * - Event Token Drawbox (Senka Gacha) Automation
 *
 * Refactored into a clean SOLID Facade orchestrating:
 * - EventCombatHelper
 * - EventStoryService
 * - EventCollaborationService
 * - EventNightmareService
 * - EventGachaService
 */
export class EventEngine implements EventEngineHost {
  public page: Page;
  public sentinel: SentinelWatchdog;
  private stopRequested = false;

  public readonly combatHelper: EventCombatHelper;
  public readonly storyService: EventStoryService;
  public readonly collaborationService: EventCollaborationService;
  public readonly nightmareService: EventNightmareService;
  public readonly gachaService: EventGachaService;

  constructor(page: Page, sentinel: SentinelWatchdog) {
    this.page = page;
    this.sentinel = sentinel;
    this.combatHelper = new EventCombatHelper(this);
    this.storyService = new EventStoryService(this);
    this.collaborationService = new EventCollaborationService(this);
    this.nightmareService = new EventNightmareService(this);
    this.gachaService = new EventGachaService(this);
  }

  public get isStopRequested(): boolean {
    return this.stopRequested;
  }

  public requestStop(): void {
    console.log('[EventEngine] Stop requested by operator.');
    this.stopRequested = true;
  }

  // =========================================================================
  // COMBAT & NAVIGATION HELPERS (Delegated to EventCombatHelper)
  // =========================================================================

  public async ensureViewportAndMobile(): Promise<void> {
    return this.combatHelper.ensureViewportAndMobile();
  }

  public async resolveEventInfo(explicitId?: string): Promise<ResolvedEventInfo> {
    return this.combatHelper.resolveEventInfo(explicitId);
  }

  public async resolveEventId(explicitId?: string): Promise<string> {
    return this.combatHelper.resolveEventId(explicitId);
  }

  public isCombatRaidActive(): boolean {
    return this.combatHelper.isCombatRaidActive();
  }

  public isCutsceneActive(): boolean {
    return this.combatHelper.isCutsceneActive();
  }

  public async activateFullAuto(): Promise<void> {
    return this.combatHelper.activateFullAuto();
  }

  public async selectFirstSupporter(timeoutMs = 12000): Promise<boolean> {
    return this.combatHelper.selectFirstSupporter(timeoutMs);
  }

  public async handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean> {
    return this.combatHelper.handleApRecoveryIfPresent(autoReplenishAp);
  }

  public async dismissPopupsAndResults(maxPasses = 6): Promise<string | boolean> {
    return this.combatHelper.dismissPopupsAndResults(maxPasses);
  }

  public async safeNavigate(targetUrl: string): Promise<void> {
    return this.combatHelper.safeNavigate(targetUrl);
  }

  public async waitForBattleStart(timeoutMs = 30000): Promise<boolean> {
    return this.combatHelper.waitForBattleStart(timeoutMs);
  }

  public async waitForBattleEnd(timeoutMs = 180000): Promise<boolean> {
    return this.combatHelper.waitForBattleEnd(timeoutMs);
  }

  public async processCombatEpisode(targetIdOrType: string, autoReplenishAp = true): Promise<boolean> {
    return this.combatHelper.processCombatEpisode(targetIdOrType, autoReplenishAp);
  }

  // =========================================================================
  // STORY, CUTSCENES, CHALLENGE QUEST & MISSIONS (Delegated to EventStoryService)
  // =========================================================================

  public async runClearEventStory(options?: {
    eventId?: string;
    maxEpisodes?: number;
    autoReplenishAp?: boolean;
    onProgress?: (progress: EventStoryProgress) => void;
  }): Promise<EventStorySummary> {
    return this.storyService.runClearEventStory(options);
  }

  public async processCutsceneEpisode(card: {
    chapterId: string;
    questId: string;
    questName: string;
    sceneOnly: string;
    ap: string;
    sceneId?: string;
  }): Promise<boolean> {
    return this.storyService.processCutsceneEpisode(card);
  }

  public async skipStoryCutscene(timeoutMs = 20000): Promise<boolean> {
    return this.storyService.skipStoryCutscene(timeoutMs);
  }

  public async waitForTransitionOutOfScene(timeoutMs = 15000): Promise<boolean> {
    return this.storyService.waitForTransitionOutOfScene(timeoutMs);
  }

  public async getActiveStoryCard(): Promise<ActiveStoryCard | null> {
    return this.storyService.getActiveStoryCard();
  }

  public async clickCurrentStoryCard(): Promise<boolean> {
    return this.storyService.clickCurrentStoryCard();
  }

  public async isStoryFullyCleared(): Promise<boolean> {
    return this.storyService.isStoryFullyCleared();
  }

  public async handleSynopsisSkipIfPresent(): Promise<boolean> {
    return this.storyService.handleSynopsisSkipIfPresent();
  }

  public async dismissOpeningIfPresent(): Promise<void> {
    return this.storyService.dismissOpeningIfPresent();
  }

  public async runClearChallengeQuest(
    eventIdExplicit?: string
  ): Promise<{ status: 'SUCCESS' | 'ALREADY_CLEARED' | 'NOT_AVAILABLE'; message: string }> {
    return this.storyService.runClearChallengeQuest(eventIdExplicit);
  }

  public async runClaimDailyMissions(eventIdExplicit?: string): Promise<boolean> {
    return this.storyService.runClaimDailyMissions(eventIdExplicit);
  }

  // =========================================================================
  // COLLABORATION EXTRA QUESTS & MANIAC (Delegated to EventCollaborationService)
  // =========================================================================

  public async navigateToEventExtraQuests(extraGroupId = '6045'): Promise<boolean> {
    return this.collaborationService.navigateToEventExtraQuests(extraGroupId);
  }

  public async executeCollaborationBattleFlow(autoReplenishAp = true): Promise<boolean> {
    return this.collaborationService.executeCollaborationBattleFlow(autoReplenishAp);
  }

  public async runClearCollaborationQuests(
    options: CollaborationQuestOptions = {}
  ): Promise<CollaborationQuestSummary> {
    return this.collaborationService.runClearCollaborationQuests(options);
  }

  public async runClearCollaborationHellIfPresent(
    extraGroupId = '6045',
    autoReplenishAp = true
  ): Promise<boolean> {
    return this.collaborationService.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);
  }

  public async runClearDailyManiac(
    eventIdExplicit?: string
  ): Promise<{ clears: number; message: string }> {
    return this.collaborationService.runClearDailyManiac(eventIdExplicit);
  }

  // =========================================================================
  // NIGHTMARE (HELL) SKIP LOOPER (Delegated to EventNightmareService)
  // =========================================================================

  public async runClearNightmareLoop(
    eventIdExplicit?: string,
    maxBatches = 100
  ): Promise<{ batchesCleared: number; totalBattlesSkipped: number; message: string }> {
    return this.nightmareService.runClearNightmareLoop(eventIdExplicit, maxBatches);
  }

  public async runCheckNightmare(
    eventIdExplicit?: string
  ): Promise<{ status: 'SKIPPED' | 'CLEARED' | 'NONE'; message: string }> {
    return this.nightmareService.runCheckNightmare(eventIdExplicit);
  }

  // =========================================================================
  // EVENT TOKEN DRAWBOX / SENKA GACHA (Delegated to EventGachaService)
  // =========================================================================

  public async runClearTokenGachaLoop(
    eventIdExplicit?: string,
    maxBoxes = 200,
    onProgress?: (progress: EventTokenGachaProgress) => void
  ): Promise<EventTokenGachaSummary> {
    return this.gachaService.runClearTokenGachaLoop(eventIdExplicit, maxBoxes, onProgress);
  }

  public async executeEventBoxReset(eventId: string): Promise<boolean> {
    return this.gachaService.executeEventBoxReset(eventId);
  }

  public async runDrawTokenGacha(
    eventIdExplicit?: string,
    maxBoxes = 200
  ): Promise<{ drawsProcessed: number; message: string }> {
    return this.gachaService.runDrawTokenGacha(eventIdExplicit, maxBoxes);
  }

  // =========================================================================
  // FULL END-TO-END EVENT PIPELINE ORCHESTRATOR
  // =========================================================================

  /**
   * Complete End-to-End Event Routine:
   * 1. Clears all Main Story Chapters & Episodes
   * 2. Clears 1-Time Challenge Quest
   * 3. Clears Daily 2/2 Maniac Battles
   * 4. Checks and Skips / Battles Nightmare
   * 5. Claims Daily Event Missions
   * 6. Pulls Event Token Gacha (if standard scenario event)
   */
  public async runFullEventPipeline(eventIdExplicit?: string): Promise<EventFullRoutineSummary> {
    const startTime = Date.now();
    const eventInfo = await this.resolveEventInfo(eventIdExplicit);
    const eventId = eventInfo.id;

    console.log('\n========================================================================');
    console.log(`      🚀 FULL EVENT PIPELINE: ${eventInfo.name}                    `);
    console.log('========================================================================\n');

    // Step 1: Main Story
    const storySummary = await this.runClearEventStory({ eventId: eventInfo.id });

    // Step 2: Challenge Quest
    let challengeStatus = 'NOT_AVAILABLE';
    if (!this.stopRequested) {
      const res = await this.runClearChallengeQuest(eventInfo.id);
      challengeStatus = res.status;
    }

    // Step 3: Daily Maniac
    let maniacClears = 0;
    if (!this.stopRequested) {
      const res = await this.runClearDailyManiac(eventInfo.id);
      maniacClears = res.clears;
    }

    // Step 4: Nightmare
    let nightmareStatus = 'NONE';
    if (!this.stopRequested) {
      const res = await this.runCheckNightmare(eventInfo.id);
      nightmareStatus = res.status;
    }

    // Step 5: Daily Missions
    let missionsClaimed = false;
    if (!this.stopRequested) {
      missionsClaimed = await this.runClaimDailyMissions(eventInfo.id);
    }

    // Step 6: Token Gacha (skip if collaboration event)
    let tokensDrawn = 0;
    if (!this.stopRequested && eventInfo.type !== 'biography') {
      const res = await this.runDrawTokenGacha(eventInfo.id);
      tokensDrawn = res.drawsProcessed;
    }

    console.log('\n========================================================================');
    console.log('              🎉 EVENT ROUTINE COMPLETE SUMMARY                        ');
    console.log('========================================================================');
    console.log(`Event ID:               ${eventInfo.name}`);
    console.log(`Story Episodes Cleared: ${storySummary.episodesCleared} (${storySummary.cutscenesSkipped} cutscenes, ${storySummary.storyBattlesCleared} battles)`);
    console.log(`All Story Completed:    ${storySummary.allStoryCleared ? 'YES' : 'NO'}`);
    console.log(`Challenge Quest:        ${challengeStatus}`);
    console.log(`Daily Maniac Clears:    ${maniacClears}/2`);
    console.log(`Nightmare (HELL):       ${nightmareStatus}`);
    console.log(`Missions Claimed:       ${missionsClaimed ? 'YES' : 'NO'}`);
    console.log(`Token Gacha Batches:    ${tokensDrawn}`);
    console.log(`Total Elapsed Time:     ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log('========================================================================\n');

    return {
      eventId,
      storySummary,
      challengeQuestStatus: challengeStatus,
      maniacClears,
      nightmareStatus,
      missionsClaimed,
      tokensDrawn,
      totalDurationMs: Date.now() - startTime
    };
  }
}

// src/engines/event/event.types.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';

export interface EventStoryProgress {
  episodeNumber: number;
  questName: string;
  chapterId: string;
  questId: string;
  type: 'cutscene' | 'combat';
  status: 'SUCCESS' | 'ALREADY_CLEARED' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  message: string;
}

export interface EventStorySummary {
  eventId: string;
  episodesCleared: number;
  cutscenesSkipped: number;
  storyBattlesCleared: number;
  totalDurationMs: number;
  allStoryCleared: boolean;
  status: 'ALL_CLEARED' | 'PARTIAL' | 'FAILED' | 'STOPPED';
  history: EventStoryProgress[];
}

export interface EventFullRoutineSummary {
  eventId: string;
  storySummary: EventStorySummary;
  challengeQuestStatus?: string;
  maniacClears?: number;
  nightmareStatus?: string;
  missionsClaimed?: boolean;
  tokensDrawn?: number;
  totalDurationMs: number;
}

export interface EventTokenGachaProgress {
  cycle: number;
  boxNumber: string;
  tokensRemaining: number | null;
  boxesCleared: number;
  status: 'DRAWING' | 'RESETTING' | 'COMPLETED' | 'DEPLETED' | 'FAILED';
  message: string;
}

export interface EventTokenGachaSummary {
  eventId: string;
  initialTokens: number | null;
  finalTokens: number | null;
  tokensSpent: number;
  boxesCleared: number;
  totalDurationMs: number;
  status: 'COMPLETED' | 'STOPPED' | 'DEPLETED' | 'FAILED';
}

export interface ResolvedEventInfo {
  id: string;
  type: 'treasureraid' | 'biography' | 'collaboration' | 'generic';
  route: string;
  url: string;
  name: string;
}

export interface CollaborationQuestOptions {
  eventId?: string;
  mode?: 'sweep' | 'solo' | 'raid' | 'maniac' | 'hell';
  difficulty?: 'vh' | 'ex' | 'ex_plus' | 'maniac' | 'hell' | string;
  runs?: number;
  autoReplenishAp?: boolean;
  extraGroupId?: string;
  onProgress?: (progress: {
    questId: string;
    questName: string;
    difficulty?: string;
    status: 'STARTING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
    currentRun: number;
    totalRuns: number;
    message: string;
  }) => void;
}

export interface CollaborationQuestSummary {
  eventId: string;
  mode: string;
  questsCleared: number;
  totalDurationMs: number;
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'STOPPED';
  history: Array<{ questId: string; questName: string; difficulty: string; status: string }>;
}

export interface ActiveStoryCard {
  chapterId: string;
  questId: string;
  questName: string;
  sceneOnly: string;
  ap: string;
  sceneId: string;
}

export interface EventEngineHost {
  readonly page: Page;
  readonly sentinel: SentinelWatchdog;
  readonly isStopRequested: boolean;
  ensureViewportAndMobile(): Promise<void>;
  resolveEventInfo(explicitId?: string): Promise<ResolvedEventInfo>;
  resolveEventId(explicitId?: string): Promise<string>;
  isCombatRaidActive(): boolean;
  isCutsceneActive(): boolean;
  activateFullAuto(): Promise<void>;
  selectFirstSupporter(timeoutMs?: number): Promise<boolean>;
  handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean>;
  dismissPopupsAndResults(maxPasses?: number): Promise<string | boolean>;
  safeNavigate(targetUrl: string): Promise<void>;
  waitForBattleStart(timeoutMs?: number): Promise<boolean>;
  waitForBattleEnd(timeoutMs?: number): Promise<boolean>;
  clickCurrentStoryCard(): Promise<boolean>;
  processCombatEpisode(targetIdOrType: string, autoReplenishAp?: boolean): Promise<boolean>;
  runClearCollaborationQuests(options?: CollaborationQuestOptions): Promise<CollaborationQuestSummary>;
}

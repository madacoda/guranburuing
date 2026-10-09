// src/engines/event.engine.ts
import { Page, ElementHandle } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { logNormalDelay, humanizedClick } from '../human-motor.js';

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
 */
export class EventEngine {
  private page: Page;
  private sentinel: SentinelWatchdog;
  private stopRequested = false;

  constructor(page: Page, sentinel: SentinelWatchdog) {
    this.page = page;
    this.sentinel = sentinel;
  }

  public requestStop(): void {
    console.log('[EventEngine] Stop requested by operator.');
    this.stopRequested = true;
  }

  public async ensureViewportAndMobile(): Promise<void> {
    try {
      await this.page.setViewport({
        width: 480,
        height: 960,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true
      });
    } catch (err: any) {
      console.warn('[EventEngine] Notice setting viewport:', err.message);
    }
  }

  /**
   * Resolves target event metadata and routing information.
   * Universally handles monthly story events (treasureraidXXX), collaboration events (biographyXXX),
   * and raw URLs / hashes (#event/biography045).
   */
  public async resolveEventInfo(explicitId?: string): Promise<ResolvedEventInfo> {
    let clean = (explicitId || '').trim();

    if (clean.includes('#')) {
      clean = clean.split('#')[1] || '';
    }
    clean = clean.replace(/^\/+/, '');
    if (clean.startsWith('event/')) {
      clean = clean.substring(6);
    }
    clean = clean.split('/')[0];

    if (clean.length > 0) {
      if (clean.startsWith('biography')) {
        return {
          id: clean,
          type: 'biography',
          route: `event/${clean}/top`,
          url: `https://game.granbluefantasy.jp/#event/${clean}/top`,
          name: clean
        };
      }
      if (clean.startsWith('treasureraid')) {
        const num = clean.replace(/[^0-9]/g, '');
        return {
          id: num || clean,
          type: 'treasureraid',
          route: `event/${clean}`,
          url: `https://game.granbluefantasy.jp/#event/${clean}`,
          name: clean
        };
      }
      if (/^\d+$/.test(clean)) {
        const curr = this.page.url();
        const bioMatch = curr.match(/#event\/(biography\d+)/);
        if (bioMatch && bioMatch[1].endsWith(clean)) {
          return {
            id: bioMatch[1],
            type: 'biography',
            route: `event/${bioMatch[1]}/top`,
            url: `https://game.granbluefantasy.jp/#event/${bioMatch[1]}/top`,
            name: bioMatch[1]
          };
        }
        return {
          id: clean,
          type: 'treasureraid',
          route: `event/treasureraid${clean}`,
          url: `https://game.granbluefantasy.jp/#event/treasureraid${clean}`,
          name: `treasureraid${clean}`
        };
      }
      return {
        id: clean,
        type: 'generic',
        route: `event/${clean}`,
        url: `https://game.granbluefantasy.jp/#event/${clean}`,
        name: clean
      };
    }

    const currentUrl = this.page.url();
    const eventMatch = currentUrl.match(/#event\/([a-zA-Z0-9_-]+)/);
    if (eventMatch && eventMatch[1]) {
      const seg = eventMatch[1].split('/')[0];
      if (seg.startsWith('biography')) {
        return {
          id: seg,
          type: 'biography',
          route: `event/${seg}/top`,
          url: `https://game.granbluefantasy.jp/#event/${seg}/top`,
          name: seg
        };
      }
      if (seg.startsWith('treasureraid')) {
        const num = seg.replace(/[^0-9]/g, '');
        return {
          id: num || seg,
          type: 'treasureraid',
          route: `event/${seg}`,
          url: `https://game.granbluefantasy.jp/#event/${seg}`,
          name: seg
        };
      }
      return {
        id: seg,
        type: 'generic',
        route: `event/${seg}`,
        url: `https://game.granbluefantasy.jp/#event/${seg}`,
        name: seg
      };
    }

    return {
      id: '177',
      type: 'treasureraid',
      route: 'event/treasureraid177',
      url: 'https://game.granbluefantasy.jp/#event/treasureraid177',
      name: 'treasureraid177'
    };
  }

  /**
   * Resolves target event ID (defaults to '177' or parses from current URL/hash).
   */
  public async resolveEventId(explicitId?: string): Promise<string> {
    const info = await this.resolveEventInfo(explicitId);
    return info.id;
  }

  /**
   * Returns true only if actively in a combat raid (#raid/...), not merely on a treasureraid event page.
   */
  public isCombatRaidActive(): boolean {
    const hash = (this.page.url().split('#')[1] || '').toLowerCase();
    return hash.startsWith('raid') || hash.includes('/raid/');
  }

  /**
   * Returns true if actively inside a story cutscene player (#quest/scene/...).
   */
  public isCutsceneActive(): boolean {
    const hash = (this.page.url().split('#')[1] || '').toLowerCase();
    return hash.startsWith('quest/scene') || hash.includes('/scene/');
  }

  /**
   * Clears all unread event story episodes sequentially.
   * Auto-skips dialogue cutscenes and handles story combat via Full Auto.
   */
  public async runClearEventStory(options?: {
    eventId?: string;
    maxEpisodes?: number;
    autoReplenishAp?: boolean;
    onProgress?: (progress: EventStoryProgress) => void;
  }): Promise<EventStorySummary> {
    const startTime = Date.now();
    const eventInfo = await this.resolveEventInfo(options?.eventId);
    const eventId = eventInfo.id;
    const maxEpisodes = options?.maxEpisodes || 40;
    const autoReplenishAp = options?.autoReplenishAp !== false;

    await this.ensureViewportAndMobile();

    console.log('\n========================================================================');
    console.log(`      📖 GBF Event Story Engine: ${eventInfo.name}                 `);
    console.log('========================================================================');
    console.log(`Target Event:     ${eventInfo.url}`);
    console.log(`Max Episodes:     ${maxEpisodes}`);
    console.log(`Auto AP Restore:  ${autoReplenishAp ? 'ENABLED (Half-Elixir)' : 'DISABLED'}`);
    console.log('========================================================================\n');

    let episodesCleared = 0;
    let cutscenesSkipped = 0;
    let storyBattlesCleared = 0;
    const history: EventStoryProgress[] = [];

    // Navigate to event top page
    const eventUrl = eventInfo.url;
    await this.safeNavigate(eventUrl);
    
    // Wait for event page DOM or active quest card/modal to mount
    const tMount = Date.now();
    while (Date.now() - tMount < 10000) {
      const ready = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-quest-list, .prt-main-quest, .cnt-quest, .popRestartQuest, .pop-usual');
      }).catch(() => false);
      if (ready) break;
      await new Promise(r => setTimeout(r, 400));
    }
    // Check if story is already fully cleared before initiating loop
    const alreadyCleared = await this.isStoryFullyCleared();
    if (alreadyCleared) {
      console.log('\n🎉 [EventEngine] All Event Story Chapters & Episodes are ALREADY 100% CLEARED!');
      return {
        eventId,
        episodesCleared: 0,
        cutscenesSkipped: 0,
        storyBattlesCleared: 0,
        totalDurationMs: Date.now() - startTime,
        allStoryCleared: true,
        status: 'ALL_CLEARED',
        history: []
      };
    }

    for (let episodeIdx = 1; episodeIdx <= maxEpisodes; episodeIdx++) {
      if (this.stopRequested) {
        console.log('[EventEngine] Halting story loop on operator stop signal.');
        break;
      }
      await this.sentinel.assertSafe();

      const epStart = Date.now();

      // Clear any pending transition popups before inspecting state
      const popAction = await this.dismissPopupsAndResults();
      if (popAction === 'resumed_quest') {
        console.log('[EventEngine] In-progress quest resumed. Awaiting transition to scene or battle...');
        await logNormalDelay(2000, 0.2);
      }

      // Check if we are currently inside a scene cutscene or combat raid
      if (this.isCutsceneActive()) {
        console.log('[EventEngine] Currently inside a cutscene. Fast-skipping...');
        await this.skipStoryCutscene();
        await this.dismissPopupsAndResults();
        await this.safeNavigate(eventUrl);
        episodesCleared++;
        cutscenesSkipped++;
        await logNormalDelay(1000, 0.15);
        continue;
      } else if (this.isCombatRaidActive()) {
        console.log('[EventEngine] Currently inside an in-progress combat battle. Activating Full Auto...');
        await this.activateFullAuto();
        await this.waitForBattleEnd(180000);
        await this.dismissPopupsAndResults();
        await this.safeNavigate(eventUrl);
        episodesCleared++;
        storyBattlesCleared++;
        await logNormalDelay(1000, 0.15);
        continue;
      }

      // Check if opening dialogue modal is showing
      await this.dismissOpeningIfPresent();

      // Scan for the active in-progress story episode card
      let questCard = await this.getActiveStoryCard();

      if (!questCard) {
        // If the URL already transitioned into a scene or battle during popup dismissal
        if (this.isCutsceneActive()) {
          console.log('[EventEngine] Page entered scene cutscene. Fast-skipping...');
          await this.skipStoryCutscene();
          await this.dismissPopupsAndResults();
          await this.safeNavigate(eventUrl);
          episodesCleared++;
          cutscenesSkipped++;
          continue;
        }
        if (this.isCombatRaidActive()) {
          console.log('[EventEngine] Page entered combat raid. Activating Full Auto...');
          await this.activateFullAuto();
          await this.waitForBattleEnd(180000);
          await this.dismissPopupsAndResults();
          await this.safeNavigate(eventUrl);
          episodesCleared++;
          storyBattlesCleared++;
          continue;
        }

        // Double-check if all story episodes are cleared
        const isAllCleared = await this.isStoryFullyCleared();
        if (isAllCleared) {
          console.log('\n🎉 [EventEngine] All Event Story Chapters & Episodes are 100% CLEARED!');
          return {
            eventId,
            episodesCleared,
            cutscenesSkipped,
            storyBattlesCleared,
            totalDurationMs: Date.now() - startTime,
            allStoryCleared: true,
            status: 'ALL_CLEARED',
            history
          };
        }

        // Wait brief moment and re-check in case page was re-rendering
        console.log('[EventEngine] Waiting for event story card to mount...');
        const tRetry = Date.now();
        while (Date.now() - tRetry < 5000) {
          await new Promise(r => setTimeout(r, 600));
          questCard = await this.getActiveStoryCard();
          if (questCard) break;
          if (this.isCutsceneActive() || this.isCombatRaidActive()) break;
        }

        if (this.isCutsceneActive() || this.isCombatRaidActive()) {
          continue;
        }

        if (!questCard) {
          console.log('[EventEngine] No further active story episode found. Exiting story loop.');
          break;
        }
      }

      const activeCard = questCard!;
      const isCutscene = activeCard.sceneOnly === '1';
      const questType: 'cutscene' | 'combat' = isCutscene ? 'cutscene' : 'combat';

      console.log(`\n[EventEngine] [Episode ${episodeIdx}/${maxEpisodes}] Active Target: "${activeCard.questName}"`);
      console.log(`   Type: ${questType.toUpperCase()} | Quest ID: ${activeCard.questId} | Chapter: ${activeCard.chapterId}`);

      let success = false;
      let errorMsg = '';

      if (isCutscene) {
        // Execute pure cutscene skip flow
        success = await this.processCutsceneEpisode(activeCard);
        if (success) cutscenesSkipped++;
      } else {
        // Execute combat episode with supporter + Full Auto
        success = await this.processCombatEpisode(activeCard.questId, autoReplenishAp);
        if (success) storyBattlesCleared++;
      }

      const durationMs = Date.now() - epStart;
      const progressRecord: EventStoryProgress = {
        episodeNumber: episodeIdx,
        questName: activeCard.questName,
        chapterId: activeCard.chapterId,
        questId: activeCard.questId,
        type: questType,
        status: success ? 'SUCCESS' : 'FAILED',
        durationMs,
        message: success ? `Cleared ${questType} episode in ${(durationMs / 1000).toFixed(1)}s` : errorMsg || 'Failed to complete episode'
      };

      history.push(progressRecord);
      if (options?.onProgress) options.onProgress(progressRecord);

      if (success) {
        episodesCleared++;
        console.log(`[EventEngine] ✅ Episode ${episodeIdx} cleared successfully! (${(durationMs / 1000).toFixed(1)}s)`);
      } else {
        console.warn(`[EventEngine] ⚠️ Episode ${episodeIdx} did not complete cleanly.`);
      }

      // Ensure safely back on event home for the next episode
      await this.safeNavigate(eventUrl);
      await this.dismissPopupsAndResults();
      await logNormalDelay(1000, 0.15);
    }

    const allStoryCleared = await this.isStoryFullyCleared();
    return {
      eventId,
      episodesCleared,
      cutscenesSkipped,
      storyBattlesCleared,
      totalDurationMs: Date.now() - startTime,
      allStoryCleared,
      status: allStoryCleared ? 'ALL_CLEARED' : 'PARTIAL',
      history
    };
  }

  /**
   * Dispatches and skips a pure story cutscene episode.
   */
  private async processCutsceneEpisode(card: { chapterId: string; questId: string; questName: string; sceneOnly: string; ap: string; sceneId?: string }): Promise<boolean> {
    console.log(`[EventEngine] Entering story episode: "${card.questName}" (Quest ${card.questId})...`);

    // 1. Click active story card or resume in-progress quest
    if (!this.isCutsceneActive() && !this.isCombatRaidActive()) {
      await this.clickCurrentStoryCard();
    }

    // 2. Await transition into the scene, raid battle, or synopsis modal
    const startWait = Date.now();
    while (Date.now() - startWait < 10000) {
      if (this.isCutsceneActive() || this.isCombatRaidActive() || this.page.url().includes('result')) break;
      const hasSynopsis = await this.handleSynopsisSkipIfPresent();
      if (hasSynopsis) break;
      await new Promise(r => setTimeout(r, 250));
    }

    // 3. Handle scene cutscene or combat raid
    if (this.isCombatRaidActive()) {
      console.log('[EventEngine] Active episode entered combat raid. Activating Full Auto...');
      await this.activateFullAuto();
      await this.waitForBattleEnd(180000);
    } else {
      await this.skipStoryCutscene();
    }

    // 4. Handle results and reward popups
    await this.dismissPopupsAndResults();

    return true;
  }

  /**
   * Fast-skips story dialogue, scene cutscenes, dialogue selections, and confirms dialog skips.
   */
  public async skipStoryCutscene(timeoutMs = 20000): Promise<boolean> {
    const tStart = Date.now();
    let hasEnteredScene = this.page.url().includes('scene');

    while (Date.now() - tStart < timeoutMs) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      const currentUrl = this.page.url();
      if (currentUrl.includes('scene')) {
        hasEnteredScene = true;
      }

      // If we previously entered the scene and now exited to result or event home, scene is concluded!
      if (hasEnteredScene && (currentUrl.includes('result') || currentUrl.includes('#event/') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#mypage'))) {
        break;
      }

      const target = await this.page.evaluate(() => {
        try {
          // 1. Skip modal confirmation: ".btn-scene-skip", ".pop-synopsis .btn-scene-skip", ".pop-skip .btn-usual-ok"
          const confirmSkip = document.querySelector(
            '.pop-skip .btn-usual-ok, .pop-skip .btn-skip-confirm, .pop-synopsis .btn-scene-skip, .btn-scene-skip, .pop-usual .btn-scene-skip'
          ) as HTMLElement;
          if (confirmSkip && confirmSkip.offsetParent !== null) {
            const r = confirmSkip.getBoundingClientRect();
            return { action: 'confirmed_skip', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          // 2. Story scene SKIP button
          const skipBtn = document.querySelector(
            '.btn-skip:not(.btn-scene-skip), .prt-scene-setting .btn-skip, [data-action="skip"]'
          ) as HTMLElement;
          if (skipBtn && skipBtn.offsetParent !== null) {
            const r = skipBtn.getBoundingClientRect();
            return { action: 'clicked_skip', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          // 3. Story dialogue choice selection
          const choiceBtn = document.querySelector(
            '.prt-selection .btn-selection, .btn-selection, .prt-balloon .btn-usual-ok'
          ) as HTMLElement;
          if (choiceBtn && choiceBtn.offsetParent !== null) {
            const r = choiceBtn.getBoundingClientRect();
            return { action: 'selected_choice', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          // 4. General OK / Proceed button
          const usualOk = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
          if (usualOk && usualOk.offsetParent !== null) {
            const r = usualOk.getBoundingClientRect();
            return { action: 'clicked_ok', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (target) {
        await this.page.touchscreen.tap(target.x, target.y).catch(() => null);
        if (target.action === 'confirmed_skip') {
          console.log('[EventEngine] Confirmed cutscene skip dialog. Awaiting transition to result/event...');
          await logNormalDelay(600, 0.2);
          await this.waitForTransitionOutOfScene(15000);
          break;
        } else if (target.action === 'clicked_skip') {
          await logNormalDelay(400, 0.15);
        } else if (target.action === 'selected_choice') {
          await logNormalDelay(300, 0.15);
        } else {
          await logNormalDelay(300, 0.15);
        }
      } else {
        // Tap screen to display HUD if controls are hidden
        await this.page.touchscreen.tap(240, 360).catch(() => null);
        await new Promise(r => setTimeout(r, 400));
      }
    }

    return true;
  }

  /**
   * Waits for the page to navigate out of a cutscene into #result/quest or event home.
   */
  private async waitForTransitionOutOfScene(timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const url = this.page.url();
      if (url.includes('result') || url.includes('#event/') || url.includes('#mypage')) {
        return true;
      }
      await new Promise(r => setTimeout(r, 350));
    }
    return false;
  }

  /**
   * Activates Full Auto in battle via touchscreen coordinates and DOM trigger.
   */
  private async activateFullAuto(): Promise<void> {
    try {
      const autoBtn = await this.page.$('.btn-auto, .btn-ability-auto');
      if (autoBtn) {
        const isAutoActive = await this.page.evaluate((el: any) => el?.classList?.contains('active') || false, autoBtn).catch(() => false);
        if (!isAutoActive) {
          await humanizedClick(this.page, autoBtn).catch(() => null);
        }
      }

      // Also trigger attack button if attack is available and active
      const atkBtn = await this.page.$('.btn-attack-start.display-on, .btn-attack.display-on, .btn-attack-start:not(.display-off)');
      if (atkBtn) {
        await humanizedClick(this.page, atkBtn).catch(() => null);
      }
    } catch {}
  }

  /**
   * Reads active story card information on the event page.
   */
  public async getActiveStoryCard(): Promise<{
    chapterId: string;
    questId: string;
    questName: string;
    sceneOnly: string;
    ap: string;
    sceneId: string;
  } | null> {
    return await this.page.evaluate(() => {
      // Check if prologue opening card is present and unplayed
      const openingCard = document.querySelector('.btn-quest-list.is-opening') as HTMLElement;
      if (openingCard && !openingCard.classList.contains('ico-clear') && !openingCard.classList.contains('treasureraid-cleared')) {
        const isCurrent = openingCard.classList.contains('ico-current') || openingCard.classList.contains('ico-new');
        const hasOtherCurrent = document.querySelector('.btn-quest-list.ico-current:not(.is-opening)');
        if (isCurrent || !hasOtherCurrent) {
          return {
            chapterId: '0',
            questId: openingCard.dataset.questId || 'opening',
            questName: 'Prologue Opening',
            sceneOnly: '1',
            ap: '0',
            sceneId: openingCard.dataset.sceneId || ''
          };
        }
      }

      const candidates = Array.from(document.querySelectorAll(
        '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main'
      )) as HTMLElement[];

      const btn = candidates.find(c => {
        // Strictly exclude Hell/Nightmare, Challenge Quests, or already cleared episodes
        const isHell = c.classList.contains('type-treasureraid-hell') || c.classList.contains('hell');
        const isChallenge = c.classList.contains('type-treasureraid-challenge') || c.classList.contains('challenge');
        const isCleared = c.classList.contains('ico-clear') || c.classList.contains('treasureraid-cleared');
        return !isHell && !isChallenge && !isCleared;
      });

      if (!btn) return null;

      const ds = btn.dataset;
      return {
        chapterId: ds.chapterId || '',
        questId: ds.questId || '',
        questName: ds.questName || btn.innerText.split('\n')[0] || 'Unknown Episode',
        sceneOnly: ds.sceneOnly || '0',
        ap: ds.ap || '0',
        sceneId: ds.sceneId || ''
      };
    }).catch(() => null);
  }

  /**
   * Clicks the currently active in-progress story episode card or resumes an in-progress quest modal.
   */
  private async clickCurrentStoryCard(): Promise<boolean> {
    // 1. If popRestartQuest (Resume Quests) is already visible, click its OK (Resume) button
    const resumed = await this.page.evaluate(() => {
      const restartOk = document.querySelector('.popRestartQuest .btn-usual-ok') as HTMLElement;
      if (restartOk && restartOk.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        try { if ($) $(restartOk).trigger('tap'); } catch {}
        try { restartOk.click(); } catch {}
        return true;
      }
      return false;
    }).catch(() => false);

    if (resumed) {
      console.log('[EventEngine] Resumed in-progress quest from popRestartQuest modal.');
      await logNormalDelay(600, 0.2);
      return true;
    }

    // 2. Locate story card coordinates and tap via touchscreen
    const cardCoords = await this.page.evaluate(() => {
      const btn = document.querySelector(
        '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main, .btn-quest-list.is-opening'
      ) as HTMLElement;
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).catch(() => null);

    if (cardCoords) {
      await this.page.touchscreen.tap(cardCoords.x, cardCoords.y).catch(() => null);
    } else {
      // Fallback DOM click
      await this.page.evaluate(() => {
        const btn = document.querySelector(
          '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main, .btn-quest-list.is-opening'
        ) as HTMLElement;
        if (btn) {
          btn.scrollIntoView({ block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          try { if ($) $(btn).trigger('tap'); } catch {}
          try { btn.click(); } catch {}
        }
      }).catch(() => null);
    }

    await logNormalDelay(600, 0.2);

    // 3. Await and immediately handle any modal that popped up from tapping the card (synopsis, continue, restart)
    const tModalStart = Date.now();
    while (Date.now() - tModalStart < 4000) {
      if (this.isCutsceneActive() || this.isCombatRaidActive() || this.page.url().includes('result')) break;

      const postModalCoord = await this.page.evaluate(() => {
        // Resume quest popup if appeared
        const restartOk = document.querySelector('.popRestartQuest .btn-usual-ok') as HTMLElement;
        if (restartOk && restartOk.offsetParent !== null) {
          const r = restartOk.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'restart' };
        }
        // Synopsis skip popup if appeared
        const synopsisSkip = document.querySelector('.pop-synopsis .btn-scene-skip, .pop-usual .btn-scene-skip') as HTMLElement;
        if (synopsisSkip && synopsisSkip.offsetParent !== null) {
          const r = synopsisSkip.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'synopsis' };
        }
        // Synopsis or continue quest start button
        const startOk = document.querySelector(
          '.pop-synopsis .btn-usual-ok, .pop-continue-quest-comfirm .btn-usual-ok, .pop-usual.pop-show .btn-usual-ok, .btn-usual-ok.se-quest-start, .pop-usual .btn-usual-ok'
        ) as HTMLElement;
        if (startOk && startOk.offsetParent !== null) {
          const r = startOk.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'start' };
        }
        return null;
      }).catch(() => null);

      if (postModalCoord) {
        await this.page.touchscreen.tap(postModalCoord.x, postModalCoord.y).catch(() => null);
        await logNormalDelay(600, 0.2);
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    return true;
  }

  /**
   * Checks if all event story chapters are already cleared.
   */
  public async isStoryFullyCleared(): Promise<boolean> {
    return await this.page.evaluate(() => {
      // 1. Check if ending card is cleared
      const endingCard = document.querySelector(
        '.btn-quest-list.ending, .btn-quest-list.is-ending, .btn-quest-list[data-chapter-id*="7"], .btn-quest-list.main[data-chapter-id*="7"], .btn-quest-list[data-chapter-id*="ending"]'
      );
      if (endingCard && (endingCard.classList.contains('ico-clear') || endingCard.classList.contains('treasureraid-cleared'))) {
        return true;
      }

      // 2. Check if any in-progress / unread card exists
      const inProgress = document.querySelector('.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .btn-quest-list.ico-new');
      if (inProgress) return false;

      // 3. Check if all main story cards have clear badges
      const storyCards = Array.from(document.querySelectorAll(
        '.btn-quest-list.lis-quest-list.main.type-treasureraid-top, .btn-quest-list.lis-quest-list.main'
      ));
      if (storyCards.length > 0 && storyCards.every(c => c.classList.contains('ico-clear') || c.classList.contains('treasureraid-cleared'))) {
        return true;
      }

      // 4. Fallback: If battle list is directly unlocked and no in-progress main story card exists
      const battleQuests = document.querySelector('.prt-battle-quest, .cnt-quest.battle, .btn-event-battle, .btn-event-raid, .prt-raid-quest');
      const textCleared = document.body.innerText.includes('Ending Cleared') || document.body.innerText.includes('All chapters cleared');

      return !inProgress && (!!battleQuests || textCleared);
    }).catch(() => false);
  }

  /**
   * Handles and dismisses synopsis skip modal if present.
   */
  private async handleSynopsisSkipIfPresent(): Promise<boolean> {
    const coords = await this.page.evaluate(() => {
      const skipBtn = document.querySelector(
        '.pop-synopsis .btn-scene-skip, .pop-usual .btn-scene-skip, .pop-synopsis .btn-usual-ok, .pop-usual.pop-show .btn-usual-ok, .btn-scene-skip'
      ) as HTMLElement;
      if (skipBtn && skipBtn.offsetParent !== null) {
        const r = skipBtn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    }).catch(() => null);

    if (coords) {
      await this.page.touchscreen.tap(coords.x, coords.y).catch(() => null);
      return true;
    }
    return false;
  }

  /**
   * Dismisses initial event opening cutscene modal if present.
   */
  private async dismissOpeningIfPresent(): Promise<void> {
    await this.page.evaluate(() => {
      const openModal = document.querySelector('.pop-usual, .pop-show') as HTMLElement;
      if (openModal && openModal.innerText.includes('opening')) {
        const skipBtn = openModal.querySelector('.btn-scene-skip, .btn-usual-cancel, .btn-usual-ok') as HTMLElement;
        if (skipBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(skipBtn).trigger('tap');
          skipBtn.click();
        }
      }
    }).catch(() => null);
  }

  /**
   * Selects the first visible supporter summon across elemental containers.
   */
  private async selectFirstSupporter(timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return false;

      const coords = await this.page.evaluate(() => {
        const containers = Array.from(document.querySelectorAll('.prt-supporter-attribute'));
        const visibleContainer = containers.find(
          c => (c as HTMLElement).offsetParent !== null && window.getComputedStyle(c).display !== 'none'
        );
        const supporter =
          visibleContainer?.querySelector('.btn-supporter') ||
          document.querySelector('.btn-autoselect-supporter') ||
          Array.from(document.querySelectorAll('.btn-supporter')).find(el => (el as HTMLElement).offsetParent !== null);

        if (supporter) {
          const r = (supporter as HTMLElement).getBoundingClientRect();
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(supporter).trigger('tap');
          (supporter as HTMLElement).click();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return null;
      }).catch(() => null);

      if (coords && coords.x && coords.y) {
        await this.page.touchscreen.tap(coords.x, coords.y).catch(() => null);
        return true;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }

  /**
   * Consumes Half-Elixir if AP recovery popup appears.
   */
  private async handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean> {
    const apModal = await this.page.$('.pop-usual .btn-use-item, .pop-usual .use-item, .pop-show .btn-use-item, .btn-use-item').catch(() => null);
    if (!apModal) return true;

    if (!autoReplenishAp) {
      console.warn('[EventEngine] AP depleted and autoReplenishAp is false.');
      return false;
    }

    console.log('[EventEngine] AP depleted. Consuming Half-Elixir to restore AP...');
    await this.page.evaluate(() => {
      const itemBtn = document.querySelector('.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item') as HTMLElement;
      if (itemBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(itemBtn).trigger('tap');
        itemBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);

    await this.page.evaluate(() => {
      const okBtn = document.querySelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-usual-ok') as HTMLElement;
      if (okBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(okBtn).trigger('tap');
        okBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);
    return true;
  }

  /**
   * Dismisses post-battle and quest reward popups (Crystals, Honors, Tokens, EXP, and chapter transition modals).
   */
  public async dismissPopupsAndResults(maxPasses = 6): Promise<string | boolean> {
    let lastAction: string | boolean = false;
    for (let i = 0; i < maxPasses; i++) {
      await this.sentinel.assertSafe();

      const dismissed = await this.page.evaluate(() => {
        try {
          const $ = (window as any).$ || (window as any).Zepto;

          // 0. Resume in-progress quest modal: always click .btn-usual-ok (resume)
          const restartOk = document.querySelector('.popRestartQuest .btn-usual-ok') as HTMLElement;
          if (restartOk && restartOk.offsetParent !== null) {
            try { if ($) $(restartOk).trigger('tap'); } catch {}
            try { restartOk.click(); } catch {}
            const r = restartOk.getBoundingClientRect();
            return { action: 'resumed_quest', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          // 1. Result next button or flex next
          const nextBtn = document.querySelector('.btn-result-next, .btn-control, .btn-next, .flex-next') as HTMLElement;
          if (nextBtn && nextBtn.offsetParent !== null) {
            try { if ($) $(nextBtn).trigger('tap'); } catch {}
            try { nextBtn.click(); } catch {}
            const r = nextBtn.getBoundingClientRect();
            return { action: 'next', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          // 2. Standard OK button or popup OK button (journal entry, loot, etc.)
          const okBtn = document.querySelector(
            '.pop-journal-update .btn-usual-ok, .pop-usual .btn-usual-ok, .pop-show .btn-usual-ok, .btn-usual-ok, .btn-result-close'
          ) as HTMLElement;
          if (okBtn && okBtn.offsetParent !== null) {
            try { if ($) $(okBtn).trigger('tap'); } catch {}
            try { okBtn.click(); } catch {}
            const r = okBtn.getBoundingClientRect();
            return { action: 'ok', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          // 3. Quest continue / unlock modal cancel or close buttons (e.g. pop-continue-quest-comfirm, pop-event-quest-clear)
          const closeOrCancel = document.querySelector(
            '.pop-continue-quest-comfirm .btn-usual-cancel, .pop-event-quest-clear .btn-usual-close, .pop-usual .btn-usual-close, .btn-usual-close'
          ) as HTMLElement;
          if (closeOrCancel && closeOrCancel.offsetParent !== null) {
            // NEVER cancel popRestartQuest!
            if (closeOrCancel.closest('.popRestartQuest')) return null;
            try { if ($) $(closeOrCancel).trigger('tap'); } catch {}
            try { closeOrCancel.click(); } catch {}
            const r = closeOrCancel.getBoundingClientRect();
            return { action: 'close', x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }

          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (!dismissed) break;
      if (dismissed.x && dismissed.y) {
        await this.page.touchscreen.tap(dismissed.x, dismissed.y).catch(() => null);
      }
      lastAction = dismissed.action;
      if (dismissed.action === 'resumed_quest') break;
      await logNormalDelay(600, 0.15);
    }
    return lastAction;
  }

  /**
   * Safely navigates to URL without resetting window location if already matching, awaiting DOM readiness.
   */
  private async safeNavigate(targetUrl: string): Promise<void> {
    const hash = targetUrl.includes('#') ? targetUrl.substring(targetUrl.indexOf('#')) : '';
    const route = hash.replace(/^#/, '');
    console.log(`[EventEngine] Navigating to: ${targetUrl}...`);

    // Ensure GBF core runtime is ready before changing hash
    await this.page.evaluate(() => {
      return (window as any).Game || document.querySelector('.cnt-mypage, .prt-header, #ready, .prt-user-info') !== null;
    }).catch(() => false);

    // Try Backbone navigate first (cleanest route change in GBF)
    await this.page.evaluate((r: string, h: string) => {
      try {
        const bb = (window as any).Backbone;
        if (bb && bb.history) {
          bb.history.navigate(r, { trigger: true });
          return;
        }
        window.location.hash = h;
      } catch {
        window.location.hash = h;
      }
    }, route, hash).catch(() => null);

    // Wait for hash to apply
    const tWait = Date.now();
    let routeApplied = false;
    while (Date.now() - tWait < 4000) {
      routeApplied = await this.page.evaluate((targetRoute: string) => {
        const currentHash = window.location.hash.replace(/^#/, '');
        return currentHash.includes(targetRoute) || ((window as any).Backbone?.history?.fragment || '').includes(targetRoute);
      }, route).catch(() => false);
      if (routeApplied) break;
      await new Promise(r => setTimeout(r, 300));
    }

    // Fallback if hash did not switch (e.g. Backbone router frozen)
    if (!routeApplied && !this.page.url().includes(route)) {
      console.log(`[EventEngine] Route transition pending, loading URL via page.goto...`);
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
    }

    // Wait for event DOM or quest container to mount (note: do NOT check .pop-usual as it is statically present everywhere)
    const tMount = Date.now();
    while (Date.now() - tMount < 10000) {
      const ready = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-quest-list, .prt-main-quest, .cnt-quest, .cnt-list-layout, .lis-event-list, .cnt-event, .popRestartQuest');
      }).catch(() => false);
      if (ready) break;
      await new Promise(r => setTimeout(r, 400));
    }

    await logNormalDelay(600, 0.2);
  }

  /**
   * Waits for combat raid UI to mount (replaces fragile page.waitForFunction).
   */
  private async waitForBattleStart(timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      if (this.isCombatRaidActive() || this.isCutsceneActive()) {
        return true;
      }

      const hasAuto = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-auto, .btn-ability-auto, .btn-attack-start');
      }).catch(() => false);

      if (hasAuto) return true;
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }

  /**
   * Waits for combat battle to conclude and reach result screen.
   * Auto-detects server victory (boss hp 0 / finish flag) and reloads instantly to skip slow animations.
   */
  private async waitForBattleEnd(timeoutMs = 180000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      const url = this.page.url();
      if (url.includes('result')) {
        return true;
      }

      const stageStatus = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const g = stage?.gGameStatus;
        const isFinalWave = !g?.totalwave || g?.wave === g?.totalwave;
        const hasBosses = Array.isArray(g?.boss?.param) && g.boss.param.length > 0;
        const allBossesDead = hasBosses && g.boss.param.every((b: any) => (Number(b.hp) === 0 || Number(b.alive) === 0) && Number(b.hpmax) > 0);
        const isEnded = g?.finish === true || (isFinalWave && allBossesDead);
        const hasResult = !!document.querySelector('.cnt-result, .pop-usual, .btn-result-next, .flex-next');
        const canAttack = !!document.querySelector('.btn-attack-start:not(.display-off)');
        return { isEnded, hasResult, canAttack, attacking: g?.attacking };
      }).catch(() => null);

      if (stageStatus?.hasResult) return true;

      // Only fast-reload if we're past the initial battle mount delay (> 2000ms)
      if (stageStatus?.isEnded && (Date.now() - start > 2000)) {
        console.log('[EventEngine] 🎉 Boss defeated on server! Fast-reloading to result screen...');
        await this.page.reload().catch(() => null);
        await new Promise(r => setTimeout(r, 2500));
        return true;
      }

      // If attack button ready and not currently attacking, tap Attack / engage auto
      if (stageStatus?.canAttack && !stageStatus?.attacking) {
        const atkBtn = await this.page.$('.btn-attack-start:not(.display-off)');
        if (atkBtn) {
          const box = await atkBtn.boundingBox();
          if (box && box.width > 0) {
            await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          }
        }
      }

      // Keep full auto active if it turned off somehow
      await this.activateFullAuto();

      await new Promise(r => setTimeout(r, 1200));
    }
    return false;
  }

  /**
   * Dispatches and completes a combat story or solo episode via supporter selection and Full Auto.
   */
  public async processCombatEpisode(targetIdOrType: string, autoReplenishAp = true): Promise<boolean> {
    console.log(`[EventEngine] Starting combat encounter for: ${targetIdOrType}...`);

    // If on event page, click the appropriate quest card if not already on supporter selection
    if (!this.page.url().includes('supporter')) {
      if (targetIdOrType === 'maniac') {
        await this.page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('.btn-quest-list'));
          const maniac = cards.find(c => (c as HTMLElement).innerText.includes('Maniac') || (c as HTMLElement).dataset.questName?.includes('Maniac')) as HTMLElement;
          if (maniac) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(maniac).trigger('tap');
            maniac.click();
          }
        }).catch(() => null);
      } else if (targetIdOrType === 'nightmare') {
        await this.page.evaluate(() => {
          const hellBtn = document.querySelector('.btn-hell, .prt-hell-quest, [data-quest-id*="hell"]') as HTMLElement;
          if (hellBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(hellBtn).trigger('tap');
            hellBtn.click();
          }
        }).catch(() => null);
      } else {
        await this.clickCurrentStoryCard();
      }
    }

    await logNormalDelay(1200, 0.2);

    // Supporter summon selection
    const supporterSelected = await this.selectFirstSupporter();
    if (!supporterSelected) {
      console.warn('[EventEngine] Could not select supporter summon.');
    }
    await logNormalDelay(800, 0.15);

    // Check AP replenishment
    const apOk = await this.handleApRecoveryIfPresent(autoReplenishAp);
    if (!apOk) {
      console.warn('[EventEngine] Aborting combat episode due to insufficient AP.');
      return false;
    }

    // Start battle button
    await this.page.evaluate(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      if (ok && ok.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(ok).trigger('tap');
        ok.click();
      }
    }).catch(() => null);

    // Wait for combat scene / raid and enable Full Auto
    console.log('[EventEngine] Waiting for combat raid UI to mount...');
    const inBattle = await this.waitForBattleStart(30000);
    if (!inBattle) {
      console.warn('[EventEngine] Timed out waiting for battle to start.');
      return false;
    }

    console.log('[EventEngine] Activating Full Auto...');
    await this.activateFullAuto();

    // Await victory / completion
    console.log('[EventEngine] Full Auto engaged. Awaiting victory...');
    const victory = await this.waitForBattleEnd(180000);
    if (!victory) {
      console.warn('[EventEngine] Battle did not complete within timeout.');
      return false;
    }

    // Dismiss popups and rewards
    await this.dismissPopupsAndResults();
    return true;
  }

  // =========================================================================
  // ADVANCED CLEAR FURTHER FEATURES:
  // 1. Challenge Quest
  // 2. Daily Maniac
  // 3. Nightmare (HELL) Check & Skip
  // 4. Daily Missions
  // 5. Token Drawbox
  // =========================================================================

  /**
   * Clears the event Challenge Quest (1-time clear for 3x Blue Sky Crystals / Draw Ticket).
   */
  public async runClearChallengeQuest(eventIdExplicit?: string): Promise<{ status: 'SUCCESS' | 'ALREADY_CLEARED' | 'NOT_AVAILABLE'; message: string }> {
    const eventInfo = await this.resolveEventInfo(eventIdExplicit);
    console.log(`\n[EventEngine] 🎯 Checking Challenge Quest for ${eventInfo.name}...`);

    await this.safeNavigate(`https://game.granbluefantasy.jp/#${eventInfo.route}/challenge`);
    await logNormalDelay(1500, 0.2);

    const challengeCard = await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-quest-list[data-quest-id*="challenge"], .btn-challenge, .lis-challenge .btn-quest-list') as HTMLElement;
      if (!btn) return null;
      return {
        isCleared: btn.classList.contains('is-cleared') || !!btn.querySelector('.ico-clear'),
        questName: btn.dataset.questName || btn.innerText.slice(0, 50)
      };
    });

    if (!challengeCard) {
      console.log('[EventEngine] Challenge Quest not currently unlocked or available.');
      return { status: 'NOT_AVAILABLE', message: 'Challenge Quest not found on event page.' };
    }

    if (challengeCard.isCleared) {
      console.log(`[EventEngine] 🎉 Challenge Quest "${challengeCard.questName}" is ALREADY CLEARED!`);
      return { status: 'ALREADY_CLEARED', message: 'Challenge Quest already cleared.' };
    }

    console.log(`[EventEngine] Starting Challenge Quest: "${challengeCard.questName}"...`);
    // Click challenge quest card
    await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-quest-list[data-quest-id*="challenge"], .btn-challenge, .lis-challenge .btn-quest-list') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);

    await logNormalDelay(1200, 0.2);
    await this.selectFirstSupporter();
    await logNormalDelay(800, 0.15);

    // Click Start
    await this.page.evaluate(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      if (ok) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(ok).trigger('tap');
        ok.click();
      }
    }).catch(() => null);

    // Wait for combat & enable Full Auto
    console.log('[EventEngine] Waiting for challenge battle to mount...');
    await this.waitForBattleStart(30000);
    await this.activateFullAuto();

    // Await victory
    console.log('[EventEngine] Full Auto engaged. Awaiting victory...');
    await this.waitForBattleEnd(180000);
    await this.dismissPopupsAndResults();

    console.log('🎉 [EventEngine] Challenge Quest cleared successfully! Trophy & rewards claimed.');
    return { status: 'SUCCESS', message: 'Challenge Quest completed.' };
  }

  /**
   * Navigates to the collaboration extra quest hub (e.g. #quest/extra/event/6045).
   * Also verifies and clicks the Event category tab if on #quest/extra.
   */
  public async navigateToEventExtraQuests(extraGroupId = '6045'): Promise<boolean> {
    await this.ensureViewportAndMobile();
    const targetUrl = `https://game.granbluefantasy.jp/#quest/extra/event/${extraGroupId}`;

    if (!this.page.url().includes(`#quest/extra/event/${extraGroupId}`)) {
      console.log(`[EventEngine] Navigating to Extra Quest Event hub: ${targetUrl}...`);
      await this.safeNavigate(targetUrl);
    }

    // Await either event banners or tab
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      if (this.stopRequested) return false;
      const ready = await this.page.evaluate((groupId: string) => {
        const banners = document.querySelectorAll(`.lis-event-list.event-id-${groupId}, .lis-event-list.extra`);
        if (banners.length > 0) return true;
        const eventTab = document.querySelector('.btn-tabs.event-general') as HTMLElement;
        if (eventTab && !eventTab.classList.contains('active')) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(eventTab).trigger('tap');
          eventTab.click();
        }
        return false;
      }, extraGroupId).catch(() => false);

      if (ready) break;
      await new Promise(r => setTimeout(r, 500));
    }

    // Handle any suspended quest resume dialog if actually shown
    const resumeOk = await this.page.$('.popRestartQuest.pop-show .btn-usual-ok');
    if (resumeOk) {
      const rBox = await resumeOk.boundingBox();
      if (rBox && rBox.width > 0 && rBox.height > 0) {
        console.log('[EventEngine] Detected suspended quest prompt (popRestartQuest). Resuming to finish...');
        await this.page.touchscreen.tap(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2);
        await logNormalDelay(1500, 0.2);
        await this.activateFullAuto();
        await this.waitForBattleEnd(180000);
        await this.dismissPopupsAndResults();
        await this.safeNavigate(targetUrl);
      }
    }

    await logNormalDelay(600, 0.15);
    return true;
  }

  /**
   * Universal battle flow for single/multi/hell collaboration quests:
   * Selects supporter summon -> handles AP restore -> clicks Start battle -> Full Auto -> awaits victory -> sweeps results.
   */
  public async executeCollaborationBattleFlow(autoReplenishAp = true): Promise<boolean> {
    // 0. Handle quest confirmation modal (.pop-confirm-battle), suspended battle (.popRestartQuest), or AP recovery before supporter screen
    const tConfirm = Date.now();
    while (Date.now() - tConfirm < 8000) {
      if (this.stopRequested) return false;
      if (this.page.url().includes('supporter') || this.isCombatRaidActive() || this.page.url().includes('#raid/')) break;

      // Check AP replenishment
      await this.handleApRecoveryIfPresent(autoReplenishAp);

      // Handle suspended quest prompt (.popRestartQuest)
      const restartBtn = await this.page.$('.popRestartQuest.pop-show .btn-usual-ok');
      if (restartBtn) {
        const box = await restartBtn.boundingBox();
        if (box && box.width > 0) {
          console.log('[EventEngine] Detected suspended quest prompt (.popRestartQuest). Resuming battle...');
          await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          await this.page.evaluate(() => {
            const btn = document.querySelector('.popRestartQuest.pop-show .btn-usual-ok') as HTMLElement;
            if (btn && btn.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
            }
          }).catch(() => null);
          await logNormalDelay(1500, 0.2);
          break;
        }
      }

      // Handle .pop-confirm-battle
      const confirmBtn = await this.page.$('.pop-confirm-battle.pop-show .btn-usual-ok');
      if (confirmBtn) {
        const box = await confirmBtn.boundingBox();
        if (box && box.width > 0) {
          console.log('[EventEngine] Detected battle confirmation popup (.pop-confirm-battle). Confirming...');
          await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          await this.page.evaluate(() => {
            const btn = document.querySelector('.pop-confirm-battle.pop-show .btn-usual-ok') as HTMLElement;
            if (btn && btn.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
            }
          }).catch(() => null);
          await logNormalDelay(1000, 0.2);
          break;
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }

    // 1. Wait for supporter screen or battle directly
    const tSupporter = Date.now();
    while (Date.now() - tSupporter < 15000) {
      if (this.stopRequested) return false;
      if (this.page.url().includes('supporter') || this.isCombatRaidActive() || this.page.url().includes('#raid/')) break;

      // Check confirm button or suspended prompt one more time if still not moved
      const confirmBtn = await this.page.$('.pop-confirm-battle.pop-show .btn-usual-ok, .popRestartQuest.pop-show .btn-usual-ok');
      if (confirmBtn) {
        const box = await confirmBtn.boundingBox();
        if (box && box.width > 0) {
          await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }

    if (this.page.url().includes('supporter')) {
      // 2. Select supporter summon
      console.log('[EventEngine] Selecting supporter summon...');
      const supporterOk = await this.selectFirstSupporter();
      if (!supporterOk) {
        console.warn('[EventEngine] Could not select supporter summon.');
      }
      await logNormalDelay(800, 0.15);

      // 3. Wait for party prompt (.pop_party) or start button (.se-quest-start)
      const tPrompt = Date.now();
      while (Date.now() - tPrompt < 8000) {
        if (this.stopRequested) return false;

        const partyCancel = await this.page.$('.pop-usual.pop_party.pop-show .btn-usual-cancel, .pop-usual.pop_party .btn-usual-cancel, .pop_party .btn-usual-cancel');
        if (partyCancel) {
          console.log('[EventEngine] Detected party members prompt. Dismissing to proceed with current party...');
          const box = await partyCancel.boundingBox();
          if (box && box.width > 0) {
            await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          }
          await this.page.evaluate(() => {
            const btn = document.querySelector('.pop-usual.pop_party .btn-usual-cancel, .pop_party .btn-usual-cancel') as HTMLElement;
            if (btn) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
            }
          }).catch(() => null);
          await logNormalDelay(800, 0.15);
          break;
        }

        const startVisible = await this.page.evaluate(() => {
          const s = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start') as HTMLElement;
          return !!(s && s.offsetParent !== null);
        }).catch(() => false);
        if (startVisible) break;

        await new Promise(r => setTimeout(r, 400));
      }

      // 4. Handle AP restoration if needed
      const apOk = await this.handleApRecoveryIfPresent(autoReplenishAp);
      if (!apOk) {
        console.warn('[EventEngine] Insufficient AP for quest.');
        return false;
      }
      await logNormalDelay(400, 0.15);

      // 5. Confirm Start Battle modal with polling wait
      const okBtn = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start', { visible: true, timeout: 8000 }).catch(() => null);
      if (okBtn) {
        const box = await okBtn.boundingBox();
        if (box && box.width > 0) {
          await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
        }
      }

      // Fallback: If start button still present, click via DOM
      await this.page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start') as HTMLElement;
        if (ok && ok.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
        }
      }).catch(() => null);
    }

    // If redirected to #party/index, handle return
    if (this.page.url().includes('party/index')) {
      console.log('[EventEngine] Detected #party/index. Returning to quest flow...');
      await this.page.evaluate(() => {
        const link = document.querySelector('.btn-link.quest, .btn-treasure-footer-back') as HTMLElement;
        if (link) link.click();
        else window.history.back();
      }).catch(() => null);
      await logNormalDelay(1500, 0.2);
    }

    // 6. Wait for combat raid to mount
    console.log('[EventEngine] Waiting for combat raid UI to mount...');
    const inBattle = await this.waitForBattleStart(30000);
    if (!inBattle) {
      console.warn('[EventEngine] Battle did not start within timeout.');
      return false;
    }

    // 7. Activate Full Auto
    console.log('[EventEngine] Activating Full Auto...');
    await this.activateFullAuto();

    // 8. Await victory (auto fast-reloads on boss defeat to skip animations)
    console.log('[EventEngine] Awaiting victory...');
    const victory = await this.waitForBattleEnd(180000);
    if (!victory) {
      console.warn('[EventEngine] Battle timed out.');
      return false;
    }

    // 9. Sweep victory results
    console.log('[EventEngine] Sweeping rewards and result screens...');
    await this.dismissPopupsAndResults();
    return true;
  }

  /**
   * Master Autonomous Runner for Collaboration Event Quests (#quest/extra/event/XXXX).
   * Fully supports:
   * - First Clear Sweep across all Solo & Raid difficulties (collecting all first-clear Crystals)
   * - Solo Quest Farming Loop (Very Hard, Extreme, Extreme+)
   * - Raid Quest Hosting Loop (Very Hard Multi, Extreme Multi, Extreme+ Multi)
   * - Daily Maniac Solo Clears (2/2 daily limit)
   * - Nightmare (HELL) Detection and Autonomous Clearance
   */
  public async runClearCollaborationQuests(options: CollaborationQuestOptions = {}): Promise<CollaborationQuestSummary> {
    const {
      eventId = 'biography045',
      mode = 'sweep',
      difficulty = 'ex',
      runs = 1,
      autoReplenishAp = true,
      extraGroupId = '6045',
      onProgress
    } = options;

    const startTime = Date.now();
    const history: Array<{ questId: string; questName: string; difficulty: string; status: string }> = [];
    let questsCleared = 0;

    console.log('\n========================================================================');
    console.log(`      ⚔️ Granblue Fantasy - Collaboration Quest Engine                  `);
    console.log(`      Event: ${eventId} | Extra Group: ${extraGroupId}                 `);
    console.log(`      Mode:  ${mode.toUpperCase()} | Target Difficulty: ${difficulty.toUpperCase()} | Runs: ${runs} `);
    console.log('========================================================================\n');

    await this.ensureViewportAndMobile();

    const closeModal = async () => {
      await this.page.evaluate(() => {
        const closeBtn = document.querySelector('.pop-usual.pop-show .btn-usual-close, .pop-usual.pop-show .btn-close') as HTMLElement;
        if (closeBtn) closeBtn.click();
      }).catch(() => null);
      await logNormalDelay(600, 0.15);
    };

    if (mode === 'sweep') {
      console.log('[EventEngine] 🚀 Starting First-Clear Sweep for collaboration quests...');

      // 1. Solo Quests Sweep
      let soloSweepDone = false;
      while (!soloSweepDone && !this.stopRequested) {
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const opened = await this.page.evaluate((groupId: string) => {
          const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
          if (!banner) return false;
          banner.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(banner).trigger('tap');
          banner.click();
          return true;
        }, extraGroupId).catch(() => false);

        if (!opened) {
          console.warn('[EventEngine] Solo banner not found.');
          break;
        }

        let modal = await this.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        if (!modal) {
          await this.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modal = await this.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const newQuest = await this.page.evaluate(() => {
          const modal = document.querySelector('.pop-quest-detail.pop-show:not(.solo-multi)');
          const btns = Array.from(modal?.querySelectorAll('.btn-set-quest') || []) as HTMLElement[];
          const newBtn = btns.find(b => {
            const parent = b.closest('.lis-quest') || b.parentElement;
            return b.classList.contains('ico-new') || !!parent?.querySelector('.ico-new');
          });
          if (!newBtn) return null;
          newBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(newBtn).trigger('tap');
          newBtn.click();
          const r = newBtn.getBoundingClientRect();
          return {
            questId: newBtn.getAttribute('data-quest-id') || '',
            chapterId: newBtn.getAttribute('data-chapter-id') || '',
            difficulty: newBtn.getAttribute('data-difficulty') || '',
            name: newBtn.getAttribute('data-chapter-name') || 'Solo Quest',
            x: r.left + r.width / 2,
            y: r.top + r.height / 2
          };
        }).catch(() => null);

        if (!newQuest) {
          console.log('[EventEngine] ✅ All available Solo Quests cleared (no new quests remaining).');
          await closeModal();
          soloSweepDone = true;
          break;
        }

        console.log(`\n[EventEngine] [Solo Sweep] Starting NEW Quest: "${newQuest.name}" (ID: ${newQuest.questId}, Diff: ${newQuest.difficulty})...`);
        onProgress?.({ questId: newQuest.questId, questName: newQuest.name, difficulty: newQuest.difficulty, status: 'STARTING', currentRun: questsCleared + 1, totalRuns: -1, message: 'Starting quest' });

        await logNormalDelay(600, 0.15);

        const ok = await this.executeCollaborationBattleFlow(autoReplenishAp);
        if (ok) {
          questsCleared++;
          history.push({ questId: newQuest.questId, questName: newQuest.name, difficulty: newQuest.difficulty, status: 'SUCCESS' });
          onProgress?.({ questId: newQuest.questId, questName: newQuest.name, difficulty: newQuest.difficulty, status: 'SUCCESS', currentRun: questsCleared, totalRuns: -1, message: 'First clear victory' });
        } else {
          history.push({ questId: newQuest.questId, questName: newQuest.name, difficulty: newQuest.difficulty, status: 'FAILED' });
          break;
        }
      }

      // 2. Raid Quests Sweep
      let raidSweepDone = false;
      while (!raidSweepDone && !this.stopRequested) {
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const opened = await this.page.evaluate((groupId: string) => {
          const banner = document.querySelector(`.lis-event-list.extra.solo-multi.event-id-${groupId} .btn-stage-detail, .lis-event-list.extra.solo-multi .btn-stage-detail`) as HTMLElement;
          if (!banner) return false;
          banner.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(banner).trigger('tap');
          banner.click();
          return true;
        }, extraGroupId).catch(() => false);

        if (!opened) {
          console.warn('[EventEngine] Raid banner not found.');
          break;
        }

        let modal = await this.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        if (!modal) {
          await this.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.solo-multi.event-id-${groupId} .btn-stage-detail, .lis-event-list.extra.solo-multi .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modal = await this.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const newRaid = await this.page.evaluate(() => {
          const modal = document.querySelector('.pop-quest-detail.solo-multi.pop-show');
          const btns = Array.from(modal?.querySelectorAll('.btn-set-quest') || []) as HTMLElement[];
          const newBtn = btns.find(b => {
            const parent = b.closest('.lis-quest') || b.parentElement;
            return b.classList.contains('ico-new') || !!parent?.querySelector('.ico-new');
          });
          if (!newBtn) return null;
          newBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(newBtn).trigger('tap');
          newBtn.click();
          const r = newBtn.getBoundingClientRect();
          return {
            questId: newBtn.getAttribute('data-quest-id') || '',
            chapterId: newBtn.getAttribute('data-chapter-id') || '',
            difficulty: newBtn.getAttribute('data-difficulty') || '',
            name: newBtn.getAttribute('data-chapter-name') || 'Raid Quest',
            x: r.left + r.width / 2,
            y: r.top + r.height / 2
          };
        }).catch(() => null);

        if (!newRaid) {
          console.log('[EventEngine] ✅ All available Raid Quests cleared (no new raids remaining).');
          await closeModal();
          raidSweepDone = true;
          break;
        }

        console.log(`\n[EventEngine] [Raid Sweep] Starting NEW Raid: "${newRaid.name}" (ID: ${newRaid.questId}, Diff: ${newRaid.difficulty})...`);
        onProgress?.({ questId: newRaid.questId, questName: newRaid.name, difficulty: newRaid.difficulty, status: 'STARTING', currentRun: questsCleared + 1, totalRuns: -1, message: 'Starting raid' });

        await logNormalDelay(600, 0.15);

        const ok = await this.executeCollaborationBattleFlow(autoReplenishAp);
        if (ok) {
          questsCleared++;
          history.push({ questId: newRaid.questId, questName: newRaid.name, difficulty: newRaid.difficulty, status: 'SUCCESS' });
          onProgress?.({ questId: newRaid.questId, questName: newRaid.name, difficulty: newRaid.difficulty, status: 'SUCCESS', currentRun: questsCleared, totalRuns: -1, message: 'First clear victory' });
        } else {
          history.push({ questId: newRaid.questId, questName: newRaid.name, difficulty: newRaid.difficulty, status: 'FAILED' });
          break;
        }
      }

      // 3. Check for Nightmare (HELL) proc
      await this.navigateToEventExtraQuests(extraGroupId);
      await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);

    } else if (mode === 'solo') {
      console.log(`[EventEngine] 🌾 Starting Solo Quest Farm Loop: Difficulty "${difficulty.toUpperCase()}", Target Runs: ${runs}...`);
      for (let r = 1; r <= runs; r++) {
        if (this.stopRequested) break;
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const hellCleared = await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);
        if (hellCleared) {
          await this.navigateToEventExtraQuests(extraGroupId);
          await closeModal();
        }

        await this.page.waitForSelector(`.lis-event-list.extra.event-id-${extraGroupId}, .lis-event-list.extra`, { timeout: 8000 }).catch(() => null);
        await logNormalDelay(500, 0.15);

        const opened = await this.page.evaluate((groupId: string) => {
          const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
          if (!banner) return false;
          banner.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(banner).trigger('tap');
          banner.click();
          return true;
        }, extraGroupId).catch(() => false);

        if (!opened) {
          console.warn('[EventEngine] Solo banner not found.');
          break;
        }

        let modalFound = await this.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        if (!modalFound) {
          await this.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modalFound = await this.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const targetDiff = difficulty === 'vh' ? '3' : difficulty === 'ex_plus' ? '9' : (difficulty === 'maniac' ? '6' : '4');
        const targetQuest = await this.page.evaluate((diff: string, diffName: string) => {
          const modal = document.querySelector('.pop-quest-detail.pop-show:not(.solo-multi)');
          if (!modal) return null;
          const btns = Array.from(modal.querySelectorAll('.btn-set-quest')) as HTMLElement[];
          let btn = btns.find(b => b.getAttribute('data-difficulty') === diff);
          if (!btn) {
            if (diffName === 'vh') btn = btns.find(b => (b.getAttribute('data-chapter-name') || '').includes('15') || (b.innerText || '').includes('Very Hard'));
            else if (diffName === 'ex') btn = btns.find(b => (b.getAttribute('data-chapter-name') || '').includes('50') || (b.innerText || '').includes('Extreme'));
            else if (diffName === 'ex_plus') btn = btns.find(b => (b.getAttribute('data-chapter-name') || '').includes('60') || (b.innerText || '').includes('Extreme+'));
            else if (diffName === 'maniac') btn = btns.find(b => (b.getAttribute('data-chapter-name') || '').includes('75') || (b.innerText || '').includes('Maniac'));
          }
          if (!btn) return null;
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
          const r = btn.getBoundingClientRect();
          return {
            questId: btn.getAttribute('data-quest-id') || '',
            name: btn.getAttribute('data-chapter-name') || 'Solo Quest',
            x: r.left + r.width / 2,
            y: r.top + r.height / 2
          };
        }, targetDiff, difficulty).catch(() => null);

        if (!targetQuest) {
          console.warn(`[EventEngine] Solo quest with difficulty ${difficulty} not found!`);
          break;
        }

        console.log(`\n[EventEngine] [Run ${r}/${runs}] Starting Solo: "${targetQuest.name}"...`);
        onProgress?.({ questId: targetQuest.questId, questName: targetQuest.name, difficulty, status: 'STARTING', currentRun: r, totalRuns: runs, message: 'Starting run' });

        await logNormalDelay(600, 0.15);

        const ok = await this.executeCollaborationBattleFlow(autoReplenishAp);
        if (ok) {
          questsCleared++;
          history.push({ questId: targetQuest.questId, questName: targetQuest.name, difficulty, status: 'SUCCESS' });
          onProgress?.({ questId: targetQuest.questId, questName: targetQuest.name, difficulty, status: 'SUCCESS', currentRun: r, totalRuns: runs, message: 'Victory' });
        } else {
          history.push({ questId: targetQuest.questId, questName: targetQuest.name, difficulty, status: 'FAILED' });
          break;
        }
      }

    } else if (mode === 'raid') {
      console.log(`[EventEngine] 🤝 Starting Raid Host Loop: Target Runs: ${runs}...`);
      for (let r = 1; r <= runs; r++) {
        if (this.stopRequested) break;
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const hellCleared = await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);
        if (hellCleared) {
          await this.navigateToEventExtraQuests(extraGroupId);
          await closeModal();
        }

        await this.page.waitForSelector(`.lis-event-list.extra.solo-multi.event-id-${extraGroupId}, .lis-event-list.extra.solo-multi`, { timeout: 8000 }).catch(() => null);
        await logNormalDelay(500, 0.15);

        const opened = await this.page.evaluate((groupId: string) => {
          const banner = document.querySelector(`.lis-event-list.extra.solo-multi.event-id-${groupId} .btn-stage-detail.solo-multi, .lis-event-list.extra.solo-multi .btn-stage-detail`) as HTMLElement;
          if (!banner) return false;
          banner.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(banner).trigger('tap');
          banner.click();
          return true;
        }, extraGroupId).catch(() => false);

        if (!opened) {
          console.warn('[EventEngine] Raid banner not found.');
          break;
        }

        let modalFound = await this.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        if (!modalFound) {
          await this.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.solo-multi.event-id-${groupId} .btn-stage-detail.solo-multi, .lis-event-list.extra.solo-multi .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modalFound = await this.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const targetDiff = difficulty === 'vh' ? '3' : difficulty === 'ex_plus' ? '9' : (difficulty === 'ex' ? '4' : '');
        const targetRaid = await this.page.evaluate((diff: string) => {
          const modal = document.querySelector('.pop-quest-detail.solo-multi.pop-show');
          const btns = Array.from(modal?.querySelectorAll('.btn-set-quest') || []) as HTMLElement[];
          const btn = diff ? btns.find(b => b.getAttribute('data-difficulty') === diff) : btns[btns.length - 1];
          if (!btn) return null;
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
          const rect = btn.getBoundingClientRect();
          return {
            questId: btn.getAttribute('data-quest-id') || '',
            name: btn.getAttribute('data-chapter-name') || 'Raid Quest',
            diff: btn.getAttribute('data-difficulty') || '',
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        }, targetDiff).catch(() => null);

        if (!targetRaid) {
          console.warn('[EventEngine] Raid quest not found!');
          break;
        }

        console.log(`\n[EventEngine] [Raid ${r}/${runs}] Hosting Raid: "${targetRaid.name}" (Diff: ${targetRaid.diff})...`);
        onProgress?.({ questId: targetRaid.questId, questName: targetRaid.name, difficulty: targetRaid.diff, status: 'STARTING', currentRun: r, totalRuns: runs, message: 'Hosting raid' });

        await logNormalDelay(600, 0.15);

        const ok = await this.executeCollaborationBattleFlow(autoReplenishAp);
        if (ok) {
          questsCleared++;
          history.push({ questId: targetRaid.questId, questName: targetRaid.name, difficulty: targetRaid.diff, status: 'SUCCESS' });
          onProgress?.({ questId: targetRaid.questId, questName: targetRaid.name, difficulty: targetRaid.diff, status: 'SUCCESS', currentRun: r, totalRuns: runs, message: 'Raid victory' });
        } else {
          history.push({ questId: targetRaid.questId, questName: targetRaid.name, difficulty: targetRaid.diff, status: 'FAILED' });
          break;
        }
      }

    } else if (mode === 'maniac') {
      console.log(`[EventEngine] 👑 Starting Daily Maniac Quests for event group ${extraGroupId}...`);
      await this.navigateToEventExtraQuests(extraGroupId);
      await closeModal();

      const soloBanner = await this.page.$(`.lis-event-list.extra.event-id-${extraGroupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`);
      if (soloBanner) {
        const sBox = await soloBanner.boundingBox();
        if (sBox) await this.page.touchscreen.tap(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
        await this.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 8000 }).catch(() => null);
        await logNormalDelay(800, 0.15);
      }

      const maniacQuests = await this.page.evaluate(() => {
        const modal = document.querySelector('.pop-quest-detail.pop-show:not(.solo-multi)');
        const btns = Array.from(modal?.querySelectorAll('.btn-set-quest[data-difficulty="6"]') || []) as HTMLElement[];
        return btns.map(b => {
          const isCleared = b.classList.contains('ico-clear') || b.classList.contains('is-cleared-limit');
          return {
            questId: b.getAttribute('data-quest-id') || '',
            name: b.getAttribute('data-chapter-name') || 'Maniac Quest',
            isCleared
          };
        });
      }).catch(() => []);

      console.log(`[EventEngine] Found ${maniacQuests.length} Maniac quests:`, maniacQuests.map(m => `${m.name} (${m.questId})`).join(', '));
      await closeModal();

      for (const m of maniacQuests) {
        if (this.stopRequested) break;
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const opened = await this.page.evaluate((groupId: string) => {
          const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
          if (!banner) return false;
          banner.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(banner).trigger('tap');
          banner.click();
          return true;
        }, extraGroupId).catch(() => false);

        if (!opened) break;
        await this.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        await logNormalDelay(600, 0.15);

        const targetCoords = await this.page.evaluate((qId: string) => {
          const btn = document.querySelector(`.btn-set-quest[data-quest-id="${qId}"]`) as HTMLElement;
          if (!btn) return null;
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
          const rect = btn.getBoundingClientRect();
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }, m.questId).catch(() => null);

        if (!targetCoords) {
          console.log(`[EventEngine] Maniac "${m.name}" limit reached or not available.`);
          continue;
        }

        console.log(`\n[EventEngine] Starting Daily Maniac: "${m.name}" (${m.questId})...`);
        onProgress?.({ questId: m.questId, questName: m.name, difficulty: 'maniac', status: 'STARTING', currentRun: questsCleared + 1, totalRuns: maniacQuests.length, message: 'Starting Maniac' });

        await logNormalDelay(600, 0.15);

        const ok = await this.executeCollaborationBattleFlow(autoReplenishAp);
        if (ok) {
          questsCleared++;
          history.push({ questId: m.questId, questName: m.name, difficulty: 'maniac', status: 'SUCCESS' });
          onProgress?.({ questId: m.questId, questName: m.name, difficulty: 'maniac', status: 'SUCCESS', currentRun: questsCleared, totalRuns: maniacQuests.length, message: 'Maniac clear' });
        } else {
          history.push({ questId: m.questId, questName: m.name, difficulty: 'maniac', status: 'FAILED' });
        }
      }

      await this.navigateToEventExtraQuests(extraGroupId);
      await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);

    } else if (mode === 'hell') {
      await this.navigateToEventExtraQuests(extraGroupId);
      const hellCleared = await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);
      if (hellCleared) {
        questsCleared++;
        history.push({ questId: 'hell', questName: 'Nightmare (HELL)', difficulty: 'hell', status: 'SUCCESS' });
      }
    }

    const totalDurationMs = Date.now() - startTime;
    console.log('\n========================================================================');
    console.log(`      🏁 Collaboration Quest Session Summary                           `);
    console.log('========================================================================');
    console.log(`Total Quests Cleared:   ${questsCleared}`);
    console.log(`Duration:               ${(totalDurationMs / 1000).toFixed(1)}s`);
    console.log('========================================================================\n');

    return {
      eventId,
      mode,
      questsCleared,
      totalDurationMs,
      status: questsCleared > 0 ? 'COMPLETED' : 'PARTIAL',
      history
    };
  }

  /**
   * Checks if Nightmare (HELL) banner is active in extra quest hub and clears it.
   */
  public async runClearCollaborationHellIfPresent(extraGroupId = '6045', autoReplenishAp = true): Promise<boolean> {
    const hasHell = await this.page.evaluate((groupId: string) => {
      const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}.is-select-hell, .lis-event-list.extra.is-select-hell`);
      return !!banner;
    }, extraGroupId).catch(() => false);

    if (!hasHell) {
      console.log('[EventEngine] No active Nightmare (HELL) banner detected.');
      return false;
    }

    console.log('\n🔥 [EventEngine] Nightmare (HELL) Encounter Spawned! Launching HELL battle...');
    await this.page.evaluate((groupId: string) => {
      const btn = document.querySelector(`.lis-event-list.extra.event-id-${groupId}.is-select-hell .btn-stage-detail.select-hell, .lis-event-list.extra.is-select-hell .btn-stage-detail.select-hell`) as HTMLElement;
      if (btn) {
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }, extraGroupId).catch(() => null);

    await logNormalDelay(1000, 0.15);

    // 1. Wait for .pop-select-hell-quest modal and select difficulty (prioritize ico-new or highest lvl)
    await this.page.waitForSelector('.pop-select-hell-quest.pop-show', { timeout: 8000 }).catch(() => null);
    const selectedHell = await this.page.evaluate(() => {
      const modal = document.querySelector('.pop-select-hell-quest.pop-show');
      const btns = Array.from(modal?.querySelectorAll('.btn-select-hell') || []) as HTMLElement[];
      const btn = btns.find(b => b.classList.contains('ico-new')) || btns[btns.length - 1];
      if (!btn) return null;
      btn.scrollIntoView({ behavior: 'instant', block: 'center' });
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(btn).trigger('tap');
      btn.click();
      return {
        id: btn.dataset.questId,
        name: btn.dataset.chapterName
      };
    }).catch(() => null);

    if (selectedHell) {
      console.log(`[EventEngine] Selected HELL difficulty: "${selectedHell.name || 'Nightmare'}" (${selectedHell.id || 'hell'})...`);
    }
    await logNormalDelay(1000, 0.15);

    // 2. Click Play on confirmation modal .pop-start-select-hell (.btn-usual-ok)
    await this.page.waitForSelector('.pop-start-select-hell.pop-show .btn-usual-ok, .pop-start-select-hell .btn-usual-ok', { visible: true, timeout: 6000 }).catch(() => null);
    await this.page.evaluate(() => {
      const btn = document.querySelector('.pop-start-select-hell.pop-show .btn-usual-ok, .pop-start-select-hell .btn-usual-ok') as HTMLElement;
      if (btn) {
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);
    await logNormalDelay(1000, 0.15);

    // 3. Complete combat through full auto flow
    const ok = await this.executeCollaborationBattleFlow(autoReplenishAp);
    if (ok) {
      console.log('🎉 [EventEngine] Nightmare (HELL) victory! Cleared successfully.');
      return true;
    }
    return false;
  }

  /**
   * Clears daily 2/2 Maniac Solo Battles for the event.
   */
  public async runClearDailyManiac(eventIdExplicit?: string): Promise<{ clears: number; message: string }> {
    const eventInfo = await this.resolveEventInfo(eventIdExplicit);
    console.log(`\n[EventEngine] ⚔️ Checking Daily Maniac for ${eventInfo.name}...`);

    if (eventInfo.type === 'biography') {
      const summary = await this.runClearCollaborationQuests({
        eventId: eventInfo.id,
        mode: 'maniac'
      });
      return { clears: summary.questsCleared, message: `Completed ${summary.questsCleared} collaboration Maniac clears.` };
    }

    await this.safeNavigate(`https://game.granbluefantasy.jp/#${eventInfo.route}/quest`);
    await logNormalDelay(1500, 0.2);

    let clears = 0;
    for (let m = 0; m < 2; m++) {
      if (this.stopRequested) break;

      const maniacInfo = await this.page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.btn-quest-list'));
        const maniacCard = cards.find(c => (c as HTMLElement).innerText.includes('Maniac') || (c as HTMLElement).dataset.questName?.includes('Maniac')) as HTMLElement;
        if (!maniacCard) return null;

        const remainText = maniacCard.querySelector('.txt-remain, .prt-remain')?.textContent || '';
        const isDepleted = remainText.includes('0/') || maniacCard.classList.contains('is-cleared-limit');
        return { isDepleted, questName: maniacCard.dataset.questName || 'Event Maniac' };
      });

      if (!maniacInfo || maniacInfo.isDepleted) {
        console.log(`[EventEngine] Daily Maniac limit reached or not available (${clears} cleared today).`);
        break;
      }

      console.log(`[EventEngine] [Maniac #${m + 1}] Starting: "${maniacInfo.questName}"...`);
      await this.processCombatEpisode('maniac', true);
      clears++;
      await logNormalDelay(1500, 0.2);
    }

    return { clears, message: `Completed ${clears} Maniac clears today.` };
  }

  /**
   * Autonomous Nightmare (HELL) Solo Skip Looper.
   * Clicks Nightmare banner (.img-hell-boss / .prt-hell), verifies Skip checkbox (#hell-skip-setting),
   * selects up to 10x batch skip, clicks 'Claim Loot', confirms party selection, and sweeps results.
   * Loops continuously until all accumulated Nightmare battles are exhausted or stop requested.
   */
  public async runClearNightmareLoop(
    eventIdExplicit?: string,
    maxBatches = 100
  ): Promise<{ batchesCleared: number; totalBattlesSkipped: number; message: string }> {
    const eventInfo = await this.resolveEventInfo(eventIdExplicit);
    console.log('\n========================================================================');
    console.log(`      ⚡ Granblue Fantasy - Nightmare (HELL) Solo Skip Looper           `);
    console.log(`      Event: ${eventInfo.name} | Max Batches: ${maxBatches}        `);
    console.log('========================================================================\n');

    if (eventInfo.type === 'biography') {
      const summary = await this.runClearCollaborationQuests({
        eventId: eventInfo.id,
        mode: 'hell'
      });
      return {
        batchesCleared: summary.questsCleared,
        totalBattlesSkipped: 0,
        message: `Cleared ${summary.questsCleared} collaboration Nightmare (HELL) battles.`
      };
    }

    let batchesCleared = 0;
    let totalBattlesSkipped = 0;

    while (batchesCleared < maxBatches && !this.stopRequested) {
      await this.sentinel.assertSafe();

      // 1. Ensure on event page
      const currentUrl = this.page.url();
      if (!currentUrl.includes(eventInfo.name)) {
        console.log(`[EventEngine] Navigating to event page #${eventInfo.route}...`);
        await this.safeNavigate(eventInfo.url);
        await logNormalDelay(1500, 0.2);
      }

      // 2. Scan for Nightmare (HELL) quest card on event page (with polling for view render)
      console.log(`[EventEngine] [Batch #${batchesCleared + 1}] Scanning for Nightmare (HELL) banner...`);
      let hellState = { hasHell: false, remainCount: 0, availableCount: 0, canSkip: false };

      const scanStart = Date.now();
      while (Date.now() - scanStart < 12000 && !this.stopRequested) {
        hellState = await this.page.evaluate(() => {
          const hellCard = document.querySelector(
            '.btn-quest-list.type-treasureraid-hell, .prt-hell, .img-hell-boss, [data-quest-id*="hell"], [data-type="3"]'
          ) as HTMLElement;
          if (!hellCard || hellCard.offsetParent === null) {
            return { hasHell: false, remainCount: 0, availableCount: 0, canSkip: false };
          }

          const listEl = (hellCard.closest('.btn-quest-list') || hellCard) as HTMLElement;
          const ds = listEl.dataset || {};
          const remainCount = parseInt(ds.hellSkipRemainCount || '0', 10) || 0;
          const availableCount = parseInt(ds.hellSkipAvailableCount || '10', 10) || 10;
          const canSkip = ds.hellSkipVaild === '1' || ds.hellSkipStatus === '1';

          return {
            hasHell: true,
            remainCount,
            availableCount,
            canSkip
          };
        });

        if (hellState.hasHell) break;

        // If still lingering on result or intermediate screen, dismiss and re-navigate
        const curHash = await this.page.evaluate(() => window.location.hash || '');
        if (curHash.includes('result') || curHash.includes('supporter')) {
          await this.dismissPopupsAndResults();
          await this.safeNavigate(eventInfo.url);
        }

        await new Promise(r => setTimeout(r, 600));
      }

      if (!hellState.hasHell) {
        console.log('[EventEngine] 🏁 No active Nightmare (HELL) quest banner found on event page.');
        break;
      }

      if (hellState.remainCount <= 0 && batchesCleared > 0) {
        console.log('[EventEngine] 🏁 All Nightmare (HELL) attempts exhausted (0 remaining).');
        break;
      }

      console.log(`\n[EventEngine] [Batch #${batchesCleared + 1}] Found Nightmare (HELL)! Remaining attempts: ${hellState.remainCount}`);

      // 3. Click Nightmare card / banner
      console.log('[EventEngine] Clicking Nightmare banner (.img-hell-boss / .prt-hell)...');
      const clickedCard = await this.page.evaluate(() => {
        const btn = document.querySelector(
          '.btn-quest-list.type-treasureraid-hell, .prt-hell, .img-hell-boss'
        ) as HTMLElement;
        if (!btn) return false;
        const target = btn.closest('.btn-quest-list') || btn;
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(target).trigger('tap');
        (target as HTMLElement).click();
        return true;
      });

      if (!clickedCard) {
        console.warn('[EventEngine] Could not click Nightmare card.');
        break;
      }

      // 4. Wait for Nightmare modal ("Unparalleled Foe" / #tpl-start-event-hell)
      console.log('[EventEngine] Waiting for Nightmare quest modal...');
      let modalReady = false;
      for (let w = 0; w < 20; w++) {
        modalReady = await this.page.evaluate(() => {
          return !!document.querySelector('.prt-start-event-hell, #hell-skip-setting, .pop-usual, .prt-popup-header');
        });
        if (modalReady) break;
        await new Promise(r => setTimeout(r, 300));
      }

      if (!modalReady) {
        console.warn('[EventEngine] Timed out waiting for Nightmare modal to appear.');
        break;
      }

      await logNormalDelay(600, 0.15);

      // 5. Ensure "Skip" is checked & Select 10 times (or max available)
      const setupResult = await this.page.evaluate(() => {
        const skipCheckbox = document.querySelector('#hell-skip-setting') as HTMLInputElement;
        const skipLabel = document.querySelector('label[for="hell-skip-setting"], .btn-hell-skip-check') as HTMLElement;
        const select = document.querySelector('#skip-num-count') as HTMLSelectElement;
        const $ = (window as any).$ || (window as any).Zepto;

        let wasChecked = false;
        if (skipCheckbox) {
          if (!skipCheckbox.checked) {
            if (skipLabel) {
              if ($) $(skipLabel).trigger('tap');
              skipLabel.click();
            } else {
              skipCheckbox.click();
            }
          }
          wasChecked = skipCheckbox.checked;
        }

        let selectedCount = 1;
        if (select) {
          // Select the highest available option (first option is maximum available, e.g. 10)
          const maxVal = select.options[0]?.value || '10';
          select.value = maxVal;
          if ($) $(select).trigger('change');
          select.dispatchEvent(new Event('change', { bubbles: true }));
          selectedCount = parseInt(maxVal, 10) || 1;
        }

        return {
          hasSkipCheckbox: !!skipCheckbox,
          isChecked: wasChecked,
          selectedCount
        };
      });

      if (!setupResult.hasSkipCheckbox) {
        console.warn('[EventEngine] ⚠️ Skip checkbox (#hell-skip-setting) not present. Nightmare skip might not be unlocked.');
        break;
      }

      console.log(`[EventEngine] Skip checkbox verified: ${setupResult.isChecked ? 'CHECKED ✅' : 'NOT CHECKED ⚠️'}`);
      console.log(`[EventEngine] Skip count selected: ${setupResult.selectedCount}x`);

      await logNormalDelay(500, 0.15);

      // 6. Click "Claim Loot" button
      console.log('[EventEngine] Clicking "Claim Loot" button...');
      const clickedClaim = await this.page.evaluate(() => {
        const claimText = Array.from(document.querySelectorAll('.btn-usual-text, .btn-usual-ok, .prt-popup-footer *'))
          .find(el => el.textContent?.trim().toLowerCase().includes('claim loot')) as HTMLElement;
        const btn = (claimText?.closest('.btn-usual-ok') || claimText) as HTMLElement | null;
        if (btn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
          return true;
        }
        return false;
      });

      if (!clickedClaim) {
        console.warn('[EventEngine] "Claim Loot" button not found in modal footer.');
        break;
      }

      // 7. Await transition to Supporter / Party Screen (#quest/supporter/...)
      console.log('[EventEngine] Awaiting party option screen (#quest/supporter)...');
      let partyScreenReady = false;
      for (let p = 0; p < 35; p++) {
        partyScreenReady = await this.page.evaluate(() => {
          const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start') as HTMLElement;
          return !!ok && ok.offsetParent !== null;
        });
        if (partyScreenReady) break;
        await new Promise(r => setTimeout(r, 400));
      }

      if (!partyScreenReady) {
        console.warn('[EventEngine] Timed out waiting for party / supporter screen.');
        break;
      }

      await logNormalDelay(800, 0.2);

      // 8. Click OK on party screen (.btn-usual-ok.se-quest-start)
      console.log('[EventEngine] Confirming party option (clicking OK / .se-quest-start)...');
      await this.page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
        if (ok) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
        }
      });

      // 9. Await Result Screen (#result_hell_skip or #result)
      console.log('[EventEngine] Awaiting result screen (#result_hell_skip)...');
      let resultReady = false;
      for (let r = 0; r < 40; r++) {
        resultReady = await this.page.evaluate(() => {
          const hash = window.location.hash || '';
          return (
            hash.includes('result') ||
            !!document.querySelector('.cnt-result, .prt-result-cnt, .head-win, .btn-control[data-status="ok"]')
          );
        });
        if (resultReady) break;
        await new Promise(res => setTimeout(res, 400));
      }

      if (resultReady) {
        batchesCleared++;
        totalBattlesSkipped += setupResult.selectedCount;
        console.log(`🎉 [EventEngine] Batch #${batchesCleared} completed! Skipped ${setupResult.selectedCount} battle(s). (Total: ${totalBattlesSkipped})`);
      } else {
        console.warn('[EventEngine] Result screen did not appear within timeout.');
      }

      await logNormalDelay(1000, 0.2);

      // 10. Dismiss popups / results & return to event page
      console.log('[EventEngine] Returning to event top page...');
      await this.page.evaluate(() => {
        const nextBtn = document.querySelector('.btn-control[data-status="ok"], .btn-control, .btn-usual-ok') as HTMLElement;
        if (nextBtn && nextBtn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(nextBtn).trigger('tap');
          nextBtn.click();
        }
      }).catch(() => null);

      await logNormalDelay(600, 0.2);
      await this.dismissPopupsAndResults();
      await this.safeNavigate(eventInfo.url);
      await logNormalDelay(1200, 0.2);
    }

    console.log('\n========================================================================');
    console.log('       🏁 NIGHTMARE (HELL) SKIP LOOP EXECUTION SUMMARY                  ');
    console.log('========================================================================');
    console.log(`Total Batches Executed: ${batchesCleared}`);
    console.log(`Total Battles Skipped:  ${totalBattlesSkipped}`);
    console.log('========================================================================\n');

    return {
      batchesCleared,
      totalBattlesSkipped,
      message: `Completed ${batchesCleared} batches (${totalBattlesSkipped} battles skipped).`
    };
  }

  /**
   * Checks for Nightmare (HELL) proc and skips all available stock using the skip looper.
   */
  public async runCheckNightmare(eventIdExplicit?: string): Promise<{ status: 'SKIPPED' | 'CLEARED' | 'NONE'; message: string }> {
    const res = await this.runClearNightmareLoop(eventIdExplicit, 100);
    if (res.totalBattlesSkipped > 0) {
      return { status: 'SKIPPED', message: `Nightmare skipped (${res.totalBattlesSkipped} battles).` };
    }
    return { status: 'NONE', message: 'No Nightmare battles available to skip.' };
  }

  /**
   * Checks and claims daily event mission rewards (50 Crystals).
   */
  public async runClaimDailyMissions(eventIdExplicit?: string): Promise<boolean> {
    const eventInfo = await this.resolveEventInfo(eventIdExplicit);
    console.log(`\n[EventEngine] 🎁 Checking Daily Event Missions for ${eventInfo.name}...`);

    await this.safeNavigate(eventInfo.url);
    await logNormalDelay(1200, 0.2);

    const claimed = await this.page.evaluate(() => {
      const missionBtn = document.querySelector('.btn-event-mission, .btn-mission-receive, .btn-claim-all') as HTMLElement;
      if (missionBtn && missionBtn.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(missionBtn).trigger('tap');
        missionBtn.click();
        return true;
      }
      return false;
    });

    if (claimed) {
      await logNormalDelay(800, 0.15);
      await this.dismissPopupsAndResults();
      console.log('🎉 [EventEngine] Daily event mission rewards claimed!');
      return true;
    }

    console.log('[EventEngine] No pending mission rewards ready to claim.');
    return false;
  }

  /**
   * Clears Event Token Drawboxes (Senka Gacha) in an automated loop:
   * 1. Navigate to / tap token draw (#event/treasureraid<ID>/gacha)
   * 2. Click "Draw 1 Drawbox" (.btn-bulk-play-box)
   * 3. Tap screen to skip crystal animation
   * 4. Reload page to bypass loot roll
   * 5. Click Reset Drawbox (.btn-reset)
   * 6. Confirm modal (.pop-usual .btn-usual-ok)
   * 7. Reload and repeat until tokens are depleted or maxBoxes reached.
   */
  public async runClearTokenGachaLoop(
    eventIdExplicit?: string,
    maxBoxes = 200,
    onProgress?: (progress: EventTokenGachaProgress) => void
  ): Promise<EventTokenGachaSummary> {
    const startTime = Date.now();
    const eventInfo = await this.resolveEventInfo(eventIdExplicit);
    const eventId = eventInfo.id;

    if (eventInfo.type === 'biography') {
      console.log(`[EventEngine] Collaboration event (${eventInfo.name}) uses Treasure Exchange Shop, not Senka Token Gacha.`);
      return {
        eventId,
        initialTokens: 0,
        finalTokens: 0,
        tokensSpent: 0,
        boxesCleared: 0,
        totalDurationMs: 0,
        status: 'COMPLETED'
      };
    }

    const gachaUrl = `https://game.granbluefantasy.jp/#${eventInfo.route}/gacha`;

    let initialTokens: number | null = null;
    let finalTokens: number | null = null;
    let boxesCleared = 0;
    let cycle = 0;

    console.log('\n========================================================================');
    console.log(`      🎰 Granblue Fantasy - Event Token Drawbox Clearer                `);
    console.log(`      Event: ${eventInfo.name} | Max Boxes: ${maxBoxes}          `);
    console.log('========================================================================\n');

    while (boxesCleared < maxBoxes) {
      if (this.stopRequested) break;
      await this.sentinel.assertSafe();

      cycle++;

      // 1. Ensure on gacha page
      if (!this.page.url().includes('gacha') || this.page.url().includes('action')) {
        console.log(`[EventEngine] Navigating to token draw: ${gachaUrl}...`);
        await this.page.evaluate((targetUrl) => {
          const hash = targetUrl.substring(targetUrl.indexOf('#'));
          window.location.hash = hash;
        }, gachaUrl);
        await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
        await logNormalDelay(1500, 0.2);
      }

      // Wait for loading mask to clear
      for (let i = 0; i < 20; i++) {
        const hasMask = await this.page.evaluate(() => !!document.querySelector('#loading.show, .mask.show'));
        if (!hasMask) break;
        await new Promise(r => setTimeout(r, 250));
      }

      // 2. Read current box and token state
      const state = await this.page.evaluate(() => {
        const text = document.body.innerText.replace(/\s+/g, ' ');
        const boxEl = document.querySelector('.prt-gacha-infomation');
        const boxMatch = boxEl?.getAttribute('data-box-num') || text.match(/Drawbox\s*#(\d+)/i)?.[0] || 'Unknown';
        const tokenEl = document.querySelector('.txt-gacha-point');
        const tokenCount = tokenEl ? parseInt(tokenEl.textContent?.replace(/,/g, '') || '', 10) : null;

        const drawBtn = document.querySelector('.btn-bulk-play-box, .btn-draw-all, .btn-play-all') as HTMLElement;
        const resetBtn = document.querySelector('.btn-reset') as HTMLElement;

        const dVisible = drawBtn && drawBtn.offsetParent !== null && !drawBtn.classList.contains('disable');
        const rVisible = resetBtn && resetBtn.offsetParent !== null && !resetBtn.classList.contains('disable');

        return {
          boxNum: boxMatch.replace(/[^0-9]/g, '') || boxMatch,
          tokenCount,
          canDrawBox: !!dVisible,
          canReset: !!rVisible
        };
      });

      if (initialTokens === null && state.tokenCount !== null) {
        initialTokens = state.tokenCount;
      }
      if (state.tokenCount !== null) {
        finalTokens = state.tokenCount;
      }

      console.log(`\n[EventEngine] [Cycle #${cycle}] Box #${state.boxNum} | Tokens: ${state.tokenCount?.toLocaleString() ?? 'Unknown'}`);
      console.log(`   Actions Available -> Draw 1 Drawbox: ${state.canDrawBox} | Reset: ${state.canReset}`);

      // Case A: Reset button is already available (target item pulled or box empty)
      if (state.canReset) {
        console.log('[EventEngine] ✨ Box is already ready to reset! Resetting...');
        const resetOk = await this.executeEventBoxReset(eventId);
        if (resetOk) {
          boxesCleared++;
          onProgress?.({
            cycle,
            boxNumber: state.boxNum,
            tokensRemaining: finalTokens,
            boxesCleared,
            status: 'RESETTING',
            message: `Reset Box #${state.boxNum} successfully`
          });
          continue;
        }
      }

      // Case B: Draw 1 Drawbox is available
      if (state.canDrawBox) {
        console.log('[EventEngine] 🎁 Clicking "Draw 1 Drawbox"...');
        const drawClicked = await this.page.evaluate(() => {
          const btn = document.querySelector('.btn-bulk-play-box, .btn-draw-all, .btn-play-all') as HTMLElement;
          if (btn && btn.offsetParent !== null) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            const z = (window as any).$ || (window as any).Zepto;
            if (z) z(btn).trigger('tap');
            btn.click();
            return true;
          }
          return false;
        });

        if (!drawClicked) {
          console.log('[EventEngine] Failed to click drawbox button. Retrying after reload...');
          await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
          await logNormalDelay(1500, 0.2);
          continue;
        }

        // Dismiss instant confirmation modal if present
        await logNormalDelay(600, 0.15);
        await this.page.evaluate(() => {
          const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const z = (window as any).$ || (window as any).Zepto;
            if (z) z(ok).trigger('tap');
            ok.click();
          }
        }).catch(() => null);

        // Await draw animation crystal / action transition
        console.log('[EventEngine] Awaiting draw animation crystal...');
        await logNormalDelay(1500, 0.15);

        // Tap screen to skip crystal animation ("tap the tap")
        console.log('[EventEngine] Tapping screen to skip crystal animation...');
        await this.page.touchscreen.tap(240, 360).catch(() => null);
        await logNormalDelay(500, 0.1);

        // Fast-skip: Reload immediately to skip loot roll and return to gacha index
        console.log('[EventEngine] Reloading to skip loot roll...');
        await this.page.evaluate((destUrl) => {
          const hash = destUrl.substring(destUrl.indexOf('#'));
          window.location.hash = hash;
        }, gachaUrl);
        await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
        await logNormalDelay(1800, 0.2);

        // Check if reset button is now available after draw
        const resetAfterDraw = await this.executeEventBoxReset(eventId);
        if (resetAfterDraw) {
          boxesCleared++;
          console.log(`🎉 [EventEngine] ✅ Box #${state.boxNum} cleared and reset! (Total cleared: ${boxesCleared})`);
          onProgress?.({
            cycle,
            boxNumber: state.boxNum,
            tokensRemaining: finalTokens,
            boxesCleared,
            status: 'COMPLETED',
            message: `Cleared and reset Box #${state.boxNum}`
          });
        }
        continue;
      }

      // Case C: Neither Drawbox nor Reset available
      if (state.tokenCount !== null && state.tokenCount < 2) {
        console.log('[EventEngine] 🏁 Tokens fully depleted! Stopping.');
        break;
      }

      // If drawbox button missing but has tokens, wait once or check if out of boxes
      console.log('[EventEngine] ⚠️ No Draw 1 Drawbox or Reset button found. Retrying page load once...');
      await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
      await logNormalDelay(2500, 0.2);

      const retryAvailable = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-bulk-play-box, .btn-reset, .btn-draw-all');
      });
      if (!retryAvailable) {
        console.log('[EventEngine] No drawbox actions available after retry. Stopping.');
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const tokensSpent = (initialTokens !== null && finalTokens !== null) ? Math.max(0, initialTokens - finalTokens) : 0;

    console.log(`\n========================================================================`);
    console.log(`🎉 [EventEngine] Event Token Drawbox Session Finished!`);
    console.log(`   Boxes Cleared: ${boxesCleared}`);
    console.log(`   Tokens Spent:  ${tokensSpent.toLocaleString()} (Remaining: ${finalTokens?.toLocaleString() ?? 'Unknown'})`);
    console.log(`   Duration:      ${(totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`========================================================================\n`);

    return {
      eventId,
      initialTokens,
      finalTokens,
      tokensSpent,
      boxesCleared,
      totalDurationMs,
      status: this.stopRequested ? 'STOPPED' : (finalTokens !== null && finalTokens < 2 ? 'DEPLETED' : 'COMPLETED')
    };
  }

  /**
   * Detects, scrolls to, clicks, and confirms the Reset Drawbox modal for events.
   */
  private async executeEventBoxReset(eventId: string): Promise<boolean> {
    const eventInfo = await this.resolveEventInfo(eventId);
    const gachaUrl = `https://game.granbluefantasy.jp/#${eventInfo.route}/gacha`;

    // 1. Check if reset button is available
    const hasReset = await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-reset') as HTMLElement;
      return !!btn && btn.offsetParent !== null && !btn.classList.contains('disable');
    });

    if (!hasReset) return false;

    console.log('[EventEngine] Tapping "Reset Drawbox" button...');
    await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-reset') as HTMLElement;
      if (btn) {
        btn.scrollIntoView({ behavior: 'instant', block: 'center' });
        const z = (window as any).$ || (window as any).Zepto;
        if (z) z(btn).trigger('tap');
        btn.click();
      }
    });

    await logNormalDelay(1000, 0.15);

    // 2. Confirm modal (.pop-usual .btn-usual-ok)
    const confirmed = await this.page.evaluate(() => {
      const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok, .btn-reset-confirm') as HTMLElement;
      if (ok && ok.offsetParent !== null) {
        const z = (window as any).$ || (window as any).Zepto;
        if (z) z(ok).trigger('tap');
        ok.click();
        return true;
      }
      return false;
    });

    if (confirmed) {
      console.log('[EventEngine] Confirmed Reset Drawbox modal.');
      await logNormalDelay(1200, 0.15);
    }

    // 3. Reload to mount fresh next drawbox
    console.log('[EventEngine] Reloading to mount next drawbox...');
    await this.page.evaluate((destUrl) => {
      const hash = destUrl.substring(destUrl.indexOf('#'));
      window.location.hash = hash;
    }, gachaUrl);
    await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
    await logNormalDelay(1800, 0.2);

    return true;
  }

  /**
   * Draws event token boxes (Senka Gacha) - delegates to runClearTokenGachaLoop.
   */
  public async runDrawTokenGacha(eventIdExplicit?: string, maxBoxes = 200): Promise<{ drawsProcessed: number; message: string }> {
    const summary = await this.runClearTokenGachaLoop(eventIdExplicit, maxBoxes);
    return {
      drawsProcessed: summary.boxesCleared,
      message: `Cleared ${summary.boxesCleared} boxes, spent ${summary.tokensSpent.toLocaleString()} tokens.`
    };
  }

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

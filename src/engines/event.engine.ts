// src/engines/event.engine.ts
import { Page, ElementHandle } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { logNormalDelay } from '../human-motor.js';

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

/**
 * EventEngine
 * Granblue Fantasy Story Event (treasureraid) Automation Engine.
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

  /**
   * Resolves target event ID (defaults to '177' or parses from current URL/hash).
   */
  public async resolveEventId(explicitId?: string): Promise<string> {
    if (explicitId && explicitId.trim().length > 0) {
      return explicitId.replace(/[^0-9]/g, '');
    }

    const currentUrl = this.page.url();
    const match = currentUrl.match(/#event\/treasureraid(\d+)/);
    if (match && match[1]) {
      return match[1];
    }

    // Default to the current active event ID (Farewell, Cold Heart = 177)
    return '177';
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
    const eventId = await this.resolveEventId(options?.eventId);
    const maxEpisodes = options?.maxEpisodes || 40;
    const autoReplenishAp = options?.autoReplenishAp !== false;

    console.log('\n========================================================================');
    console.log(`      📖 GBF Event Story Engine: treasureraid${eventId}                 `);
    console.log('========================================================================');
    console.log(`Target Event:     https://game.granbluefantasy.jp/#event/treasureraid${eventId}`);
    console.log(`Max Episodes:     ${maxEpisodes}`);
    console.log(`Auto AP Restore:  ${autoReplenishAp ? 'ENABLED (Half-Elixir)' : 'DISABLED'}`);
    console.log('========================================================================\n');

    let episodesCleared = 0;
    let cutscenesSkipped = 0;
    let storyBattlesCleared = 0;
    const history: EventStoryProgress[] = [];

    // Navigate to event top page
    const eventUrl = `https://game.granbluefantasy.jp/#event/treasureraid${eventId}`;
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
    await logNormalDelay(500, 0.15);

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
      if (hasEnteredScene && (currentUrl.includes('result') || currentUrl.includes('#event/treasureraid') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#mypage'))) {
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
      if (url.includes('result') || url.includes('#event/treasureraid') || url.includes('#mypage')) {
        return true;
      }
      await new Promise(r => setTimeout(r, 350));
    }
    return false;
  }

  /**
   * Activates Full Auto in battle.
   */
  private async activateFullAuto(): Promise<void> {
    await this.page.evaluate(() => {
      const autoBtn = document.querySelector('.btn-auto, .btn-ability-auto') as HTMLElement;
      if (autoBtn && !autoBtn.classList.contains('active')) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(autoBtn).trigger('tap');
        autoBtn.click();
      }
    }).catch(() => null);
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
      const btn = document.querySelector(
        '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main'
      ) as HTMLElement;

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
        '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main'
      ) as HTMLElement;
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).catch(() => null);

    if (cardCoords) {
      await this.page.touchscreen.tap(cardCoords.x, cardCoords.y).catch(() => null);
    } else {
      // Fallback DOM click
      await this.page.evaluate(() => {
        const btn = document.querySelector(
          '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main'
        ) as HTMLElement;
        if (btn) {
          const $ = (window as any).$ || (window as any).Zepto;
          try { if ($) $(btn).trigger('tap'); } catch {}
          try { btn.click(); } catch {}
        }
      }).catch(() => null);
    }

    await logNormalDelay(500, 0.2);

    // 3. Immediately handle any modal that popped up from tapping the card
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
      // Quest start button
      const startOk = document.querySelector('.btn-usual-ok.se-quest-start') as HTMLElement;
      if (startOk && startOk.offsetParent !== null) {
        const r = startOk.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'start' };
      }
      return null;
    }).catch(() => null);

    if (postModalCoord) {
      await this.page.touchscreen.tap(postModalCoord.x, postModalCoord.y).catch(() => null);
    }

    return true;
  }

  /**
   * Checks if all event story chapters are already cleared.
   */
  public async isStoryFullyCleared(): Promise<boolean> {
    return await this.page.evaluate(() => {
      // If battle list is directly unlocked and no in-progress main story card exists
      const inProgress = document.querySelector('.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list');
      const battleQuests = document.querySelector('.prt-battle-quest, .cnt-quest.battle, .btn-event-battle');
      const textCleared = document.body.innerText.includes('Ending Cleared') || document.body.innerText.includes('All chapters cleared');

      return !inProgress && (!!battleQuests || textCleared);
    }).catch(() => false);
  }

  /**
   * Handles and dismisses synopsis skip modal if present.
   */
  private async handleSynopsisSkipIfPresent(): Promise<boolean> {
    const coords = await this.page.evaluate(() => {
      const skipBtn = document.querySelector('.pop-synopsis .btn-scene-skip, .btn-scene-skip, .pop-usual .btn-scene-skip') as HTMLElement;
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
   * Selects the first visible supporter summon.
   */
  private async selectFirstSupporter(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const selected = await this.page.evaluate(() => {
        const supporter = document.querySelector('.btn-supporter, .lis-supporter, .prt-supporter-detail') as HTMLElement;
        if (supporter && supporter.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(supporter).trigger('tap');
          supporter.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (selected) return true;
      await new Promise(r => setTimeout(r, 300));
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
    console.log(`[EventEngine] Navigating to: ${targetUrl}...`);

    // Ensure GBF core runtime is ready before changing hash
    await this.page.evaluate(() => {
      return (window as any).Game || document.querySelector('.cnt-mypage, .prt-header, #ready, .prt-user-info') !== null;
    }).catch(() => false);

    await this.page.evaluate((destHash: string) => {
      try {
        if (destHash) {
          window.location.hash = destHash;
        }
      } catch {}
    }, hash).catch(() => null);

    // Wait for hash to apply and event DOM to mount
    const tWait = Date.now();
    while (Date.now() - tWait < 12000) {
      const ready = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-quest-list, .prt-main-quest, .cnt-quest, .popRestartQuest, .pop-usual');
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
   */
  private async waitForBattleEnd(timeoutMs = 180000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.stopRequested) return false;
      await this.sentinel.assertSafe();

      const url = this.page.url();
      if (url.includes('result') || url.includes('#event/treasureraid') || url.includes('#mypage')) {
        return true;
      }

      const hasResult = await this.page.evaluate(() => {
        return !!document.querySelector('.cnt-result, .pop-usual, .btn-result-next, .flex-next');
      }).catch(() => false);

      if (hasResult) return true;

      // Keep full auto active if it turned off somehow
      await this.activateFullAuto();

      await new Promise(r => setTimeout(r, 1000));
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
    const eventId = await this.resolveEventId(eventIdExplicit);
    console.log(`\n[EventEngine] 🎯 Checking Challenge Quest for treasureraid${eventId}...`);

    await this.safeNavigate(`https://game.granbluefantasy.jp/#event/treasureraid${eventId}/challenge`);
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
   * Clears daily 2/2 Maniac Solo Battles for the event.
   */
  public async runClearDailyManiac(eventIdExplicit?: string): Promise<{ clears: number; message: string }> {
    const eventId = await this.resolveEventId(eventIdExplicit);
    console.log(`\n[EventEngine] ⚔️ Checking Daily Maniac for treasureraid${eventId}...`);

    await this.safeNavigate(`https://game.granbluefantasy.jp/#event/treasureraid${eventId}/quest`);
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
   * Checks for Nightmare (HELL) proc. If Nightmare Skip is unlocked, skips it instantly for free loot.
   */
  public async runCheckNightmare(eventIdExplicit?: string): Promise<{ status: 'SKIPPED' | 'CLEARED' | 'NONE'; message: string }> {
    const eventId = await this.resolveEventId(eventIdExplicit);
    console.log(`\n[EventEngine] ⚡ Checking Nightmare (HELL) status for treasureraid${eventId}...`);

    await this.safeNavigate(`https://game.granbluefantasy.jp/#event/treasureraid${eventId}`);
    await logNormalDelay(1200, 0.2);

    const hellInfo = await this.page.evaluate(() => {
      const hellBtn = document.querySelector('.btn-hell, .prt-hell-quest, [data-quest-id*="hell"]') as HTMLElement;
      if (!hellBtn || hellBtn.offsetParent === null) return { hasHell: false, canSkip: false };

      const ds = hellBtn.dataset;
      const canSkip = ds.hellSkipVaild === '1' || ds.hellSkipStatus === '1' || !!document.querySelector('.btn-hell-skip');
      return { hasHell: true, canSkip };
    });

    if (!hellInfo.hasHell) {
      console.log('[EventEngine] No active Nightmare (HELL) quest spawned.');
      return { status: 'NONE', message: 'No Nightmare battle active.' };
    }

    if (hellInfo.canSkip) {
      console.log('[EventEngine] ⚡ Nightmare Skip is UNLOCKED! Triggering 1-Click Instant Skip...');
      await this.page.evaluate(() => {
        const skipBtn = document.querySelector('.btn-hell-skip, .btn-usual-ok.btn-skip-hell') as HTMLElement;
        if (skipBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(skipBtn).trigger('tap');
          skipBtn.click();
        }
      });
      await logNormalDelay(800, 0.15);
      await this.dismissPopupsAndResults();
      console.log('🎉 [EventEngine] Nightmare quest skipped instantly! Free tokens & crystals claimed.');
      return { status: 'SKIPPED', message: 'Nightmare 1-click skipped.' };
    }

    console.log('[EventEngine] Nightmare spawned without skip feature unlocked. Running Full Auto...');
    await this.processCombatEpisode('nightmare', true);
    return { status: 'CLEARED', message: 'Nightmare completed via Full Auto.' };
  }

  /**
   * Checks and claims daily event mission rewards (50 Crystals).
   */
  public async runClaimDailyMissions(eventIdExplicit?: string): Promise<boolean> {
    const eventId = await this.resolveEventId(eventIdExplicit);
    console.log(`\n[EventEngine] 🎁 Checking Daily Event Missions for treasureraid${eventId}...`);

    await this.safeNavigate(`https://game.granbluefantasy.jp/#event/treasureraid${eventId}`);
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
   * Draws event token boxes (Senka Gacha) and resets boxes 1-4 when target is drawn.
   */
  public async runDrawTokenGacha(eventIdExplicit?: string, maxDrawPasses = 10): Promise<{ drawsProcessed: number; message: string }> {
    const eventId = await this.resolveEventId(eventIdExplicit);
    console.log(`\n[EventEngine] 🎰 Accessing Event Token Gacha for treasureraid${eventId}...`);

    await this.safeNavigate(`https://game.granbluefantasy.jp/#event/treasureraid${eventId}/gacha`);
    await logNormalDelay(1500, 0.2);

    let drawsProcessed = 0;
    for (let p = 0; p < maxDrawPasses; p++) {
      if (this.stopRequested) break;
      await this.sentinel.assertSafe();

      // Check if box reset button is available (SSR item pulled in boxes 1-4)
      const canReset = await this.page.evaluate(() => {
        const resetBtn = document.querySelector('.btn-box-reset, .btn-reset') as HTMLElement;
        return resetBtn && resetBtn.offsetParent !== null && !resetBtn.classList.contains('disable');
      });

      if (canReset) {
        console.log('[EventEngine] 🎯 Key Box reward pulled! Triggering Box Reset to advance to next box...');
        await this.page.evaluate(() => {
          const resetBtn = document.querySelector('.btn-box-reset, .btn-reset') as HTMLElement;
          if (resetBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(resetBtn).trigger('tap');
            resetBtn.click();
          }
        });
        await logNormalDelay(600, 0.15);
        await this.page.evaluate(() => {
          const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
          if (ok) ok.click();
        });
        await logNormalDelay(1000, 0.2);
        continue;
      }

      // Check for available draw button (e.g. Draw 100, Draw All, or Draw 10)
      const drawn = await this.page.evaluate(() => {
        const drawBtns = Array.from(document.querySelectorAll('.btn-draw, .btn-gacha-draw, .btn-draw-all, .btn-draw-100'));
        const activeBtn = drawBtns.find(b => (b as HTMLElement).offsetParent !== null && !b.classList.contains('disable')) as HTMLElement;
        if (activeBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(activeBtn).trigger('tap');
          activeBtn.click();
          return true;
        }
        return false;
      });

      if (!drawn) {
        console.log('[EventEngine] No further tokens or draw buttons available.');
        break;
      }

      drawsProcessed++;
      console.log(`[EventEngine] [Batch ${drawsProcessed}] Draw submitted, dismissing result...`);
      await logNormalDelay(1200, 0.2);
      await this.dismissPopupsAndResults();
      await logNormalDelay(600, 0.15);
    }

    return { drawsProcessed, message: `Processed ${drawsProcessed} token draw batches.` };
  }

  /**
   * Complete End-to-End Event Routine:
   * 1. Clears all Main Story Chapters & Episodes
   * 2. Clears 1-Time Challenge Quest
   * 3. Clears Daily 2/2 Maniac Battles
   * 4. Checks and Skips / Battles Nightmare
   * 5. Claims Daily Event Missions
   * 6. Pulls Event Token Gacha
   */
  public async runFullEventPipeline(eventIdExplicit?: string): Promise<EventFullRoutineSummary> {
    const startTime = Date.now();
    const eventId = await this.resolveEventId(eventIdExplicit);

    console.log('\n========================================================================');
    console.log(`      🚀 FULL EVENT PIPELINE: treasureraid${eventId}                    `);
    console.log('========================================================================\n');

    // Step 1: Main Story
    const storySummary = await this.runClearEventStory({ eventId });

    // Step 2: Challenge Quest
    let challengeStatus = 'NOT_AVAILABLE';
    if (!this.stopRequested) {
      const res = await this.runClearChallengeQuest(eventId);
      challengeStatus = res.status;
    }

    // Step 3: Daily Maniac
    let maniacClears = 0;
    if (!this.stopRequested) {
      const res = await this.runClearDailyManiac(eventId);
      maniacClears = res.clears;
    }

    // Step 4: Nightmare
    let nightmareStatus = 'NONE';
    if (!this.stopRequested) {
      const res = await this.runCheckNightmare(eventId);
      nightmareStatus = res.status;
    }

    // Step 5: Daily Missions
    let missionsClaimed = false;
    if (!this.stopRequested) {
      missionsClaimed = await this.runClaimDailyMissions(eventId);
    }

    // Step 6: Token Gacha
    let tokensDrawn = 0;
    if (!this.stopRequested) {
      const res = await this.runDrawTokenGacha(eventId);
      tokensDrawn = res.drawsProcessed;
    }

    console.log('\n========================================================================');
    console.log('              🎉 EVENT ROUTINE COMPLETE SUMMARY                        ');
    console.log('========================================================================');
    console.log(`Event ID:               treasureraid${eventId}`);
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

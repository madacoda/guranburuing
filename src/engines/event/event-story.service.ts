// src/engines/event/event-story.service.ts
import { logNormalDelay } from '../../human-motor.js';
import { ActiveStoryCard, EventEngineHost, EventStoryProgress, EventStorySummary } from './event.types.js';

export class EventStoryService {
  constructor(private readonly host: EventEngineHost) {}

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
    const eventInfo = await this.host.resolveEventInfo(options?.eventId);
    const eventId = eventInfo.id;
    const maxEpisodes = options?.maxEpisodes || 40;
    const autoReplenishAp = options?.autoReplenishAp !== false;

    await this.host.ensureViewportAndMobile();

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
    await this.host.safeNavigate(eventUrl);

    // Wait for event page DOM or active quest card/modal to mount
    const tMount = Date.now();
    while (Date.now() - tMount < 10000) {
      const ready = await this.host.page.evaluate(() => {
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
      if (this.host.isStopRequested) {
        console.log('[EventEngine] Halting story loop on operator stop signal.');
        break;
      }
      await this.host.sentinel.assertSafe();

      const epStart = Date.now();

      // Clear any pending transition popups before inspecting state
      const popAction = await this.host.dismissPopupsAndResults();
      if (popAction === 'resumed_quest') {
        console.log('[EventEngine] In-progress quest resumed. Awaiting transition to scene or battle...');
        await logNormalDelay(2000, 0.2);
      }

      // Check if we are currently inside a scene cutscene or combat raid
      if (this.host.isCutsceneActive()) {
        console.log('[EventEngine] Currently inside a cutscene. Fast-skipping...');
        await this.skipStoryCutscene();
        await this.host.dismissPopupsAndResults();
        await this.host.safeNavigate(eventUrl);
        episodesCleared++;
        cutscenesSkipped++;
        await logNormalDelay(1000, 0.15);
        continue;
      } else if (this.host.isCombatRaidActive()) {
        console.log('[EventEngine] Currently inside an in-progress combat battle. Activating Full Auto...');
        await this.host.activateFullAuto();
        await this.host.waitForBattleEnd(180000);
        await this.host.dismissPopupsAndResults();
        await this.host.safeNavigate(eventUrl);
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
        if (this.host.isCutsceneActive()) {
          console.log('[EventEngine] Page entered scene cutscene. Fast-skipping...');
          await this.skipStoryCutscene();
          await this.host.dismissPopupsAndResults();
          await this.host.safeNavigate(eventUrl);
          episodesCleared++;
          cutscenesSkipped++;
          continue;
        }
        if (this.host.isCombatRaidActive()) {
          console.log('[EventEngine] Page entered combat raid. Activating Full Auto...');
          await this.host.activateFullAuto();
          await this.host.waitForBattleEnd(180000);
          await this.host.dismissPopupsAndResults();
          await this.host.safeNavigate(eventUrl);
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
          if (this.host.isCutsceneActive() || this.host.isCombatRaidActive()) break;
        }

        if (this.host.isCutsceneActive() || this.host.isCombatRaidActive()) {
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
      const errorMsg = '';

      if (isCutscene) {
        // Execute pure cutscene skip flow
        success = await this.processCutsceneEpisode(activeCard);
        if (success) cutscenesSkipped++;
      } else {
        // Execute combat episode with supporter + Full Auto
        success = await this.host.processCombatEpisode(activeCard.questId, autoReplenishAp);
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
      await this.host.safeNavigate(eventUrl);
      await this.host.dismissPopupsAndResults();
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
  public async processCutsceneEpisode(card: { chapterId: string; questId: string; questName: string; sceneOnly: string; ap: string; sceneId?: string }): Promise<boolean> {
    console.log(`[EventEngine] Entering story episode: "${card.questName}" (Quest ${card.questId})...`);

    // 1. Click active story card or resume in-progress quest
    if (!this.host.isCutsceneActive() && !this.host.isCombatRaidActive()) {
      await this.clickCurrentStoryCard();
    }

    // 2. Await transition into the scene, raid battle, or synopsis modal
    const startWait = Date.now();
    while (Date.now() - startWait < 10000) {
      if (this.host.isCutsceneActive() || this.host.isCombatRaidActive() || this.host.page.url().includes('result')) break;
      const hasSynopsis = await this.handleSynopsisSkipIfPresent();
      if (hasSynopsis) break;
      await new Promise(r => setTimeout(r, 250));
    }

    // 3. Handle scene cutscene or combat raid
    if (this.host.isCombatRaidActive()) {
      console.log('[EventEngine] Active episode entered combat raid. Activating Full Auto...');
      await this.host.activateFullAuto();
      await this.host.waitForBattleEnd(180000);
    } else {
      await this.skipStoryCutscene();
    }

    // 4. Handle results and reward popups
    await this.host.dismissPopupsAndResults();

    return true;
  }

  /**
   * Fast-skips story dialogue, scene cutscenes, dialogue selections, and confirms dialog skips.
   */
  public async skipStoryCutscene(timeoutMs = 20000): Promise<boolean> {
    const tStart = Date.now();
    let hasEnteredScene = this.host.page.url().includes('scene');

    while (Date.now() - tStart < timeoutMs) {
      if (this.host.isStopRequested) return false;
      await this.host.sentinel.assertSafe();

      const currentUrl = this.host.page.url();
      if (currentUrl.includes('scene')) {
        hasEnteredScene = true;
      }

      // If we previously entered the scene and now exited to result or event home, scene is concluded!
      if (hasEnteredScene && (currentUrl.includes('result') || currentUrl.includes('#event/') || currentUrl.includes('#quest/supporter') || currentUrl.includes('#mypage'))) {
        break;
      }

      const target = await this.host.page.evaluate(() => {
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
        await this.host.page.touchscreen.tap(target.x, target.y).catch(() => null);
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
        await this.host.page.touchscreen.tap(240, 360).catch(() => null);
        await new Promise(r => setTimeout(r, 400));
      }
    }

    return true;
  }

  /**
   * Waits for the page to navigate out of a cutscene into #result/quest or event home.
   */
  public async waitForTransitionOutOfScene(timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const url = this.host.page.url();
      if (url.includes('result') || url.includes('#event/') || url.includes('#mypage')) {
        return true;
      }
      await new Promise(r => setTimeout(r, 350));
    }
    return false;
  }

  /**
   * Reads active story card information on the event page.
   */
  public async getActiveStoryCard(): Promise<ActiveStoryCard | null> {
    return await this.host.page.evaluate(() => {
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
  public async clickCurrentStoryCard(): Promise<boolean> {
    // 1. If popRestartQuest (Resume Quests) is already visible, click its OK (Resume) button
    const resumed = await this.host.page.evaluate(() => {
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
    const cardCoords = await this.host.page.evaluate(() => {
      const btn = document.querySelector(
        '.btn-quest-list.ico-current, .btn-quest-list.treasureraid-in-progress, .prt-main-quest .btn-quest-list, .btn-quest-list.lis-quest-list.main, .btn-quest-list.is-opening'
      ) as HTMLElement;
      if (!btn) return null;
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).catch(() => null);

    if (cardCoords) {
      await this.host.page.touchscreen.tap(cardCoords.x, cardCoords.y).catch(() => null);
    } else {
      // Fallback DOM click
      await this.host.page.evaluate(() => {
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
      if (this.host.isCutsceneActive() || this.host.isCombatRaidActive() || this.host.page.url().includes('result')) break;

      const postModalCoord = await this.host.page.evaluate(() => {
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
        await this.host.page.touchscreen.tap(postModalCoord.x, postModalCoord.y).catch(() => null);
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
    return await this.host.page.evaluate(() => {
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
  public async handleSynopsisSkipIfPresent(): Promise<boolean> {
    const coords = await this.host.page.evaluate(() => {
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
      await this.host.page.touchscreen.tap(coords.x, coords.y).catch(() => null);
      return true;
    }
    return false;
  }

  /**
   * Dismisses initial event opening cutscene modal if present.
   */
  public async dismissOpeningIfPresent(): Promise<void> {
    await this.host.page.evaluate(() => {
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
   * Clears the event Challenge Quest (1-time clear for 3x Blue Sky Crystals / Draw Ticket).
   */
  public async runClearChallengeQuest(eventIdExplicit?: string): Promise<{ status: 'SUCCESS' | 'ALREADY_CLEARED' | 'NOT_AVAILABLE'; message: string }> {
    const eventInfo = await this.host.resolveEventInfo(eventIdExplicit);
    console.log(`\n[EventEngine] 🎯 Checking Challenge Quest for ${eventInfo.name}...`);

    await this.host.safeNavigate(`https://game.granbluefantasy.jp/#${eventInfo.route}/challenge`);
    await logNormalDelay(1500, 0.2);

    const challengeCard = await this.host.page.evaluate(() => {
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
    await this.host.page.evaluate(() => {
      const btn = document.querySelector('.btn-quest-list[data-quest-id*="challenge"], .btn-challenge, .lis-challenge .btn-quest-list') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);

    await logNormalDelay(1200, 0.2);
    await this.host.selectFirstSupporter();
    await logNormalDelay(800, 0.15);

    // Click Start
    await this.host.page.evaluate(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      if (ok) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(ok).trigger('tap');
        ok.click();
      }
    }).catch(() => null);

    // Wait for combat & enable Full Auto
    console.log('[EventEngine] Waiting for challenge battle to mount...');
    await this.host.waitForBattleStart(30000);
    await this.host.activateFullAuto();

    // Await victory
    console.log('[EventEngine] Full Auto engaged. Awaiting victory...');
    await this.host.waitForBattleEnd(180000);
    await this.host.dismissPopupsAndResults();

    console.log('🎉 [EventEngine] Challenge Quest cleared successfully! Trophy & rewards claimed.');
    return { status: 'SUCCESS', message: 'Challenge Quest completed.' };
  }

  /**
   * Checks and claims daily event mission rewards (50 Crystals).
   */
  public async runClaimDailyMissions(eventIdExplicit?: string): Promise<boolean> {
    const eventInfo = await this.host.resolveEventInfo(eventIdExplicit);
    console.log(`\n[EventEngine] 🎁 Checking Daily Event Missions for ${eventInfo.name}...`);

    await this.host.safeNavigate(eventInfo.url);
    await logNormalDelay(1200, 0.2);

    const claimed = await this.host.page.evaluate(() => {
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
      await this.host.dismissPopupsAndResults();
      console.log('🎉 [EventEngine] Daily event mission rewards claimed!');
      return true;
    }

    console.log('[EventEngine] No pending mission rewards ready to claim.');
    return false;
  }
}

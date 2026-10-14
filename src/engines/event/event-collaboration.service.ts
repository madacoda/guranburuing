// src/engines/event/event-collaboration.service.ts
import { logNormalDelay } from '../../human-motor.js';
import { CollaborationQuestOptions, CollaborationQuestSummary, EventEngineHost } from './event.types.js';

export class EventCollaborationService {
  constructor(private readonly host: EventEngineHost) {}

  /**
   * Navigates to the collaboration extra quest hub (e.g. #quest/extra/event/6045).
   * Also verifies and clicks the Event category tab if on #quest/extra.
   */
  public async navigateToEventExtraQuests(extraGroupId = '6045'): Promise<boolean> {
    await this.host.ensureViewportAndMobile();
    const targetUrl = `https://game.granbluefantasy.jp/#quest/extra/event/${extraGroupId}`;

    if (!this.host.page.url().includes(`#quest/extra/event/${extraGroupId}`)) {
      console.log(`[EventEngine] Navigating to Extra Quest Event hub: ${targetUrl}...`);
      await this.host.safeNavigate(targetUrl);
    }

    // Await either event banners or tab
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      if (this.host.isStopRequested) return false;
      const ready = await this.host.page.evaluate((groupId: string) => {
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
    const resumeOk = await this.host.page.$('.popRestartQuest.pop-show .btn-usual-ok');
    if (resumeOk) {
      const rBox = await resumeOk.boundingBox();
      if (rBox && rBox.width > 0 && rBox.height > 0) {
        console.log('[EventEngine] Detected suspended quest prompt (popRestartQuest). Resuming to finish...');
        await this.host.page.touchscreen.tap(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2);
        await logNormalDelay(1500, 0.2);
        await this.host.activateFullAuto();
        await this.host.waitForBattleEnd(180000);
        await this.host.dismissPopupsAndResults();
        await this.host.safeNavigate(targetUrl);
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
      if (this.host.isStopRequested) return false;
      if (this.host.page.url().includes('supporter') || this.host.isCombatRaidActive() || this.host.page.url().includes('#raid/')) break;

      // Check AP replenishment
      await this.host.handleApRecoveryIfPresent(autoReplenishAp);

      // Handle suspended quest prompt (.popRestartQuest)
      const restartBtn = await this.host.page.$('.popRestartQuest.pop-show .btn-usual-ok');
      if (restartBtn) {
        const box = await restartBtn.boundingBox();
        if (box && box.width > 0) {
          console.log('[EventEngine] Detected suspended quest prompt (.popRestartQuest). Resuming battle...');
          await this.host.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          await this.host.page.evaluate(() => {
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
      const confirmBtn = await this.host.page.$('.pop-confirm-battle.pop-show .btn-usual-ok');
      if (confirmBtn) {
        const box = await confirmBtn.boundingBox();
        if (box && box.width > 0) {
          console.log('[EventEngine] Detected battle confirmation popup (.pop-confirm-battle). Confirming...');
          await this.host.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          await this.host.page.evaluate(() => {
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
      if (this.host.isStopRequested) return false;
      if (this.host.page.url().includes('supporter') || this.host.isCombatRaidActive() || this.host.page.url().includes('#raid/')) break;

      // Check confirm button or suspended prompt one more time if still not moved
      const confirmBtn = await this.host.page.$('.pop-confirm-battle.pop-show .btn-usual-ok, .popRestartQuest.pop-show .btn-usual-ok');
      if (confirmBtn) {
        const box = await confirmBtn.boundingBox();
        if (box && box.width > 0) {
          await this.host.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
        }
      }
      await new Promise(r => setTimeout(r, 400));
    }

    if (this.host.page.url().includes('supporter')) {
      // 2. Select supporter summon
      console.log('[EventEngine] Selecting supporter summon...');
      const supporterOk = await this.host.selectFirstSupporter();
      if (!supporterOk) {
        console.warn('[EventEngine] Could not select supporter summon.');
      }
      await logNormalDelay(800, 0.15);

      // 3. Wait for party prompt (.pop_party) or start button (.se-quest-start)
      const tPrompt = Date.now();
      while (Date.now() - tPrompt < 8000) {
        if (this.host.isStopRequested) return false;

        const partyCancel = await this.host.page.$('.pop-usual.pop_party.pop-show .btn-usual-cancel, .pop-usual.pop_party .btn-usual-cancel, .pop_party .btn-usual-cancel');
        if (partyCancel) {
          console.log('[EventEngine] Detected party members prompt. Dismissing to proceed with current party...');
          const box = await partyCancel.boundingBox();
          if (box && box.width > 0) {
            await this.host.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          }
          await this.host.page.evaluate(() => {
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

        const startVisible = await this.host.page.evaluate(() => {
          const s = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start') as HTMLElement;
          return !!(s && s.offsetParent !== null);
        }).catch(() => false);
        if (startVisible) break;

        await new Promise(r => setTimeout(r, 400));
      }

      // 4. Handle AP restoration if needed
      const apOk = await this.host.handleApRecoveryIfPresent(autoReplenishAp);
      if (!apOk) {
        console.warn('[EventEngine] Insufficient AP for quest.');
        return false;
      }
      await logNormalDelay(400, 0.15);

      // 5. Confirm Start Battle modal with polling wait
      const okBtn = await this.host.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start', { visible: true, timeout: 8000 }).catch(() => null);
      if (okBtn) {
        const box = await okBtn.boundingBox();
        if (box && box.width > 0) {
          await this.host.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
        }
      }

      // Fallback: If start button still present, click via DOM
      await this.host.page.evaluate(() => {
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start') as HTMLElement;
        if (ok && ok.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
        }
      }).catch(() => null);
    }

    // If redirected to #party/index, handle return
    if (this.host.page.url().includes('party/index')) {
      console.log('[EventEngine] Detected #party/index. Returning to quest flow...');
      await this.host.page.evaluate(() => {
        const link = document.querySelector('.btn-link.quest, .btn-treasure-footer-back') as HTMLElement;
        if (link) link.click();
        else window.history.back();
      }).catch(() => null);
      await logNormalDelay(1500, 0.2);
    }

    // 6. Wait for combat raid to mount
    console.log('[EventEngine] Waiting for combat raid UI to mount...');
    const inBattle = await this.host.waitForBattleStart(30000);
    if (!inBattle) {
      console.warn('[EventEngine] Battle did not start within timeout.');
      return false;
    }

    // 7. Activate Full Auto
    console.log('[EventEngine] Activating Full Auto...');
    await this.host.activateFullAuto();

    // 8. Await victory (auto fast-reloads on boss defeat to skip animations)
    console.log('[EventEngine] Awaiting victory...');
    const victory = await this.host.waitForBattleEnd(180000);
    if (!victory) {
      console.warn('[EventEngine] Battle timed out.');
      return false;
    }

    // 9. Sweep victory results
    console.log('[EventEngine] Sweeping rewards and result screens...');
    await this.host.dismissPopupsAndResults();
    return true;
  }

  /**
   * Master Autonomous Runner for Collaboration Event Quests (#quest/extra/event/XXXX).
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

    await this.host.ensureViewportAndMobile();

    const closeModal = async () => {
      await this.host.page.evaluate(() => {
        const closeBtn = document.querySelector('.pop-usual.pop-show .btn-usual-close, .pop-usual.pop-show .btn-close') as HTMLElement;
        if (closeBtn) closeBtn.click();
      }).catch(() => null);
      await logNormalDelay(600, 0.15);
    };

    if (mode === 'sweep') {
      console.log('[EventEngine] 🚀 Starting First-Clear Sweep for collaboration quests...');

      // 1. Solo Quests Sweep
      let soloSweepDone = false;
      while (!soloSweepDone && !this.host.isStopRequested) {
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const opened = await this.host.page.evaluate((groupId: string) => {
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

        let modal = await this.host.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        if (!modal) {
          await this.host.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modal = await this.host.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const newQuest = await this.host.page.evaluate(() => {
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
      while (!raidSweepDone && !this.host.isStopRequested) {
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const opened = await this.host.page.evaluate((groupId: string) => {
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

        let modal = await this.host.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        if (!modal) {
          await this.host.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.solo-multi.event-id-${groupId} .btn-stage-detail, .lis-event-list.extra.solo-multi .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modal = await this.host.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const newRaid = await this.host.page.evaluate(() => {
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
        if (this.host.isStopRequested) break;
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const hellCleared = await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);
        if (hellCleared) {
          await this.navigateToEventExtraQuests(extraGroupId);
          await closeModal();
        }

        await this.host.page.waitForSelector(`.lis-event-list.extra.event-id-${extraGroupId}, .lis-event-list.extra`, { timeout: 8000 }).catch(() => null);
        await logNormalDelay(500, 0.15);

        const opened = await this.host.page.evaluate((groupId: string) => {
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

        let modalFound = await this.host.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        if (!modalFound) {
          await this.host.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modalFound = await this.host.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const targetDiff = difficulty === 'vh' ? '3' : difficulty === 'ex_plus' ? '9' : (difficulty === 'maniac' ? '6' : '4');
        const targetQuest = await this.host.page.evaluate((diff: string, diffName: string) => {
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
        if (this.host.isStopRequested) break;
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const hellCleared = await this.runClearCollaborationHellIfPresent(extraGroupId, autoReplenishAp);
        if (hellCleared) {
          await this.navigateToEventExtraQuests(extraGroupId);
          await closeModal();
        }

        await this.host.page.waitForSelector(`.lis-event-list.extra.solo-multi.event-id-${extraGroupId}, .lis-event-list.extra.solo-multi`, { timeout: 8000 }).catch(() => null);
        await logNormalDelay(500, 0.15);

        const opened = await this.host.page.evaluate((groupId: string) => {
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

        let modalFound = await this.host.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        if (!modalFound) {
          await this.host.page.evaluate((groupId: string) => {
            const banner = document.querySelector(`.lis-event-list.extra.solo-multi.event-id-${groupId} .btn-stage-detail.solo-multi, .lis-event-list.extra.solo-multi .btn-stage-detail`) as HTMLElement;
            if (banner) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(banner).trigger('tap');
              banner.click();
            }
          }, extraGroupId).catch(() => null);
          modalFound = await this.host.page.waitForSelector('.pop-quest-detail.solo-multi.pop-show', { timeout: 6000 }).catch(() => null);
        }
        await logNormalDelay(600, 0.15);

        const targetDiff = difficulty === 'vh' ? '3' : difficulty === 'ex_plus' ? '9' : (difficulty === 'ex' ? '4' : '');
        const targetRaid = await this.host.page.evaluate((diff: string) => {
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

      const soloBanner = await this.host.page.$(`.lis-event-list.extra.event-id-${extraGroupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`);
      if (soloBanner) {
        const sBox = await soloBanner.boundingBox();
        if (sBox) await this.host.page.touchscreen.tap(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
        await this.host.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 8000 }).catch(() => null);
        await logNormalDelay(800, 0.15);
      }

      const maniacQuests = await this.host.page.evaluate(() => {
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
        if (this.host.isStopRequested) break;
        await this.navigateToEventExtraQuests(extraGroupId);
        await closeModal();

        const opened = await this.host.page.evaluate((groupId: string) => {
          const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}:not(.solo-multi):not(.is-select-hell) .btn-stage-detail, .lis-event-list.extra:not(.solo-multi):not(.is-select-hell) .btn-stage-detail`) as HTMLElement;
          if (!banner) return false;
          banner.scrollIntoView({ behavior: 'instant', block: 'center' });
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(banner).trigger('tap');
          banner.click();
          return true;
        }, extraGroupId).catch(() => false);

        if (!opened) break;
        await this.host.page.waitForSelector('.pop-quest-detail.pop-show:not(.solo-multi)', { timeout: 6000 }).catch(() => null);
        await logNormalDelay(600, 0.15);

        const targetCoords = await this.host.page.evaluate((qId: string) => {
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
    const hasHell = await this.host.page.evaluate((groupId: string) => {
      const banner = document.querySelector(`.lis-event-list.extra.event-id-${groupId}.is-select-hell, .lis-event-list.extra.is-select-hell`);
      return !!banner;
    }, extraGroupId).catch(() => false);

    if (!hasHell) {
      console.log('[EventEngine] No active Nightmare (HELL) banner detected.');
      return false;
    }

    console.log('\n🔥 [EventEngine] Nightmare (HELL) Encounter Spawned! Launching HELL battle...');
    await this.host.page.evaluate((groupId: string) => {
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
    await this.host.page.waitForSelector('.pop-select-hell-quest.pop-show', { timeout: 8000 }).catch(() => null);
    const selectedHell = await this.host.page.evaluate(() => {
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
    await this.host.page.waitForSelector('.pop-start-select-hell.pop-show .btn-usual-ok, .pop-start-select-hell .btn-usual-ok', { visible: true, timeout: 6000 }).catch(() => null);
    await this.host.page.evaluate(() => {
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
    const eventInfo = await this.host.resolveEventInfo(eventIdExplicit);
    console.log(`\n[EventEngine] ⚔️ Checking Daily Maniac for ${eventInfo.name}...`);

    if (eventInfo.type === 'biography') {
      const summary = await this.runClearCollaborationQuests({
        eventId: eventInfo.id,
        mode: 'maniac'
      });
      return { clears: summary.questsCleared, message: `Completed ${summary.questsCleared} collaboration Maniac clears.` };
    }

    await this.host.safeNavigate(`https://game.granbluefantasy.jp/#${eventInfo.route}/quest`);
    await logNormalDelay(1500, 0.2);

    let clears = 0;
    for (let m = 0; m < 2; m++) {
      if (this.host.isStopRequested) break;

      const maniacInfo = await this.host.page.evaluate(() => {
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
      await this.host.processCombatEpisode('maniac', true);
      clears++;
      await logNormalDelay(1500, 0.2);
    }

    return { clears, message: `Completed ${clears} Maniac clears today.` };
  }
}

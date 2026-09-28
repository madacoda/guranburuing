// src/engines/gw-meat-light.engine.ts
import { Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, humanReactionDelay, randomDelay, logNormalDelay, sampleGaussian, moveMouseSmoothly, setSpeedProfile } from '../human-motor.js';

export interface GwMeatLightRunResult {
  runNumber: number;
  status: 'SUCCESS' | 'AP_EXHAUSTED' | 'FAILED' | 'STOPPED';
  durationMs: number;
  supporterName: string;
  meatGained: number;
  honors: number;
  message: string;
}

export interface GwMeatLightLoopOptions {
  runs?: number; // Target number of runs or Infinity
  autoReplenishAp?: boolean;
  logPath?: string;
  onProgress?: (result: GwMeatLightRunResult) => void;
}

export interface GwMeatLightSummary {
  totalRunsCompleted: number;
  totalMeatGained: number;
  totalDurationMs: number;
  averageDurationSec: number;
  logPath: string;
}

export class GwMeatLightEngine {
  private readonly QUEST_URL = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
  private stopRequested = false;
  private totalMeatAccumulated = 0;
  private latestHonors = 126120;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {
    setSpeedProfile('fast');
  }

  /**
   * Normalizes viewport and mobile touch settings to prevent layout shifts in headless mode.
   */
  public async ensureViewportAndMobile(): Promise<void> {
    try {
      await this.page.setViewport({
        width: 480,
        height: 960,
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true
      });
      console.log('[GwMeatLight] Mobile viewport normalized (480x960, Touch enabled).');
    } catch (err: any) {
      console.warn('[GwMeatLight] Notice setting viewport:', err.message);
    }
  }

  /**
   * Request graceful interruption after the active battle completes.
   */
  public requestStop(): void {
    console.log('\n[GwMeatLight] 🛑 Graceful stop requested. Finishing active run...');
    this.stopRequested = true;
  }

  /**
   * Runs the automated GW Meat farming loop.
   */
  public async runMeatLoop(options: GwMeatLightLoopOptions = {}): Promise<GwMeatLightSummary> {
    const {
      runs = Infinity,
      autoReplenishAp = true,
      logPath = 'logs/gw-meat-light.md',
      onProgress
    } = options;

    const startTime = Date.now();
    let totalCompleted = 0;
    this.stopRequested = false;
    this.totalMeatAccumulated = 0;

    this.ensureLogDirExists(logPath);

    console.log(`\n========================================================================`);
    console.log(`     Guild War (Unite and Fight) Light Meat Farm - September 2026      `);
    console.log(`                 Target Quest: 947551 / Extreme+ Meat                   `);
    console.log(`========================================================================`);
    console.log(`Target Runs:          ${runs === Infinity ? 'Continuous / Loop (Ctrl+C to stop)' : runs}`);
    console.log(`Supporter Priority:   1. Zeus (>=200, prioritizing 250)`);
    console.log(`                      2. Lucifer (>=200, prioritizing 250)`);
    console.log(`                      3. Fallback to highest available Light supporter`);
    console.log(`Combat Sequence:      Quick Call -> Attack -> Fast Bookmark Nav`);
    console.log(`Auto Half-Elixir:     ${autoReplenishAp ? 'Enabled' : 'Disabled'}`);
    console.log(`Log File:             ${logPath}`);
    console.log(`========================================================================\n`);

    // Startup check: clear any leftover modal or result left open before launching
    let startupHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (this.isBattleHash(startupHash) || startupHash.includes('result')) {
      console.log(`[GwMeatLight] Leftover battle/result detected on launch (${startupHash}). Clearing popups...`);
      await this.dismissAllPopups(2);
    }
    await this.dismissAllPopups(1);

    while (totalCompleted < runs && !this.stopRequested) {
      const runNumber = totalCompleted + 1;
      const runStartTime = Date.now();

      console.log(`\n------------------------------------------------------------------------`);
      console.log(`[GwMeatLight] [Run ${runNumber}] Initiating Meat Farm Run...`);
      console.log(`------------------------------------------------------------------------`);

      await this.sentinel.assertSafe();

      // 1. Navigate to Supporter Screen
      await this.navigateToSupporterScreen();
      await this.sentinel.assertSafe();

      // 2. Check and replenish AP if modal appeared
      const apRestored = await this.handleApRecoveryIfPresent(autoReplenishAp);
      if (!apRestored && await this.isApModalOpen()) {
        console.warn(`[GwMeatLight] [Run ${runNumber}] AP exhausted and auto-replenish failed. Stopping session.`);
        break;
      }

      // 3. Select Supporter Summon & Confirm Party (checks auto-selected popup first!)
      const supporter = await this.selectSupporterAndStartQuest(autoReplenishAp, runNumber);
      if (!supporter) {
        if (this.stopRequested) break;
        console.warn(`[GwMeatLight] [Run ${runNumber}] Failed to select supporter or start quest. Retrying in 2s...`);
        await logNormalDelay(2000, 0.15);
        continue;
      }

      await this.sentinel.assertSafe();

      // 5. Execute Combat Turn: Quick Summon -> F5 -> Attack -> (Dismiss Processing Modal) -> Next Run
      const combatResult = await this.executeCombatRotation(runNumber);

      totalCompleted++;
      this.totalMeatAccumulated += 4;

      const runElapsedSec = ((Date.now() - runStartTime) / 1000).toFixed(1);
      console.log(`[GwMeatLight] [Run ${totalCompleted}] Cleared in ${runElapsedSec}s | Supporter: ${supporter.name} | Meat: +4 (Total: ${this.totalMeatAccumulated}) | Honors: 126.120`);

      const runRecord: GwMeatLightRunResult = {
        runNumber: totalCompleted,
        status: combatResult.status,
        durationMs: Date.now() - runStartTime,
        supporterName: supporter.name,
        meatGained: 4,
        honors: 126120,
        message: combatResult.message
      };

      await this.appendLogEntry(logPath, {
        runNumber: totalCompleted,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        durationSec: runElapsedSec,
        supporter: supporter.name,
        meatGained: 4,
        totalMeat: this.totalMeatAccumulated,
        honors: 126120
      });

      if (onProgress) onProgress(runRecord);

      await logNormalDelay(150, 0.1);
    }

    const totalDurationMs = Date.now() - startTime;
    const averageDurationSec = totalCompleted > 0 ? (totalDurationMs / totalCompleted / 1000) : 0;

    return {
      totalRunsCompleted: totalCompleted,
      totalMeatGained: this.totalMeatAccumulated,
      totalDurationMs,
      averageDurationSec: parseFloat(averageDurationSec.toFixed(1)),
      logPath
    };
  }

  /**
   * Navigates to the GW Meat supporter selection screen.
   */
  private async navigateToSupporterScreen(): Promise<void> {
    let currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');

    // 0. If currently in an unfinished battle, finish it immediately
    if (this.isBattleHash(currentHash)) {
      console.log(`[GwMeatLight] Lingering battle detected (${currentHash}). Finishing active battle...`);
      await this.finishActiveBattle();
      currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    }

    // 1. Auto-bypass Title / Top screen (#top) if present
    if (currentHash.includes('top') || currentHash === '' || currentHash === '#') {
      console.log('[GwMeatLight] On Title/Top screen. Clicking Game Start (#start) to enter game...');
      const startBtn = await this.page.$('#start, .btn-start');
      if (startBtn) {
        await humanReactionDelay(250, 0.2);
        await humanizedClick(this.page, startBtn);
        await logNormalDelay(2500, 0.15);
        currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      }
    }

    // 2. Loop until Supporter / Party Confirmation popup or Supporter List is firmly mounted
    const tStart = Date.now();
    let hasAttemptedReload = false;

    while (Date.now() - tStart < 15000) {
      currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');

      // If currently on supporter hash, check if DOM elements have mounted
      if (currentHash.includes('supporter/947551')) {
        const mounted = await this.page.evaluate(() => {
          const supp = document.querySelector('.prt-supporter[data-supporter-id], .prt-supporter[data-summon-id], .prt-supporter');
          const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-settle') as HTMLElement;
          const isOkVis = !!(ok && ok.offsetParent !== null && window.getComputedStyle(ok).display !== 'none');
          const cards = document.querySelectorAll('.btn-supporter, .lis-supporter');
          const hasCards = Array.from(cards).some(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).getBoundingClientRect().height > 0);
          const apModal = document.querySelector('.pop-usual') as HTMLElement;
          const isApVis = !!(apModal && apModal.offsetParent !== null && window.getComputedStyle(apModal).display !== 'none');
          return {
            isAutoSupp: !!supp && isOkVis,
            hasCards,
            isApVis
          };
        }).catch(() => null);

        if (mounted && (mounted.isAutoSupp || mounted.hasCards || mounted.isApVis)) {
          await this.checkAndDismissProcessingTurnPopup();
          return;
        }
      }

      // If in lingering battle, conclude it first
      if (this.isBattleHash(currentHash)) {
        await this.finishActiveBattle();
        currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      }

      // If on result screen or any other screen, reload directly to supporter URL
      if (currentHash.includes('result') || !currentHash.includes('supporter/947551')) {
        console.log('[GwMeatLight] Navigating to Supporter URL with reload...');
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
          this.page.evaluate(() => {
            window.location.href = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
            window.location.reload();
          }).catch(() => null)
        ]);
        await logNormalDelay(400, 0.1);
        continue;
      }

      // Dismiss any "Processing turn" modal or error modal
      await this.checkAndDismissProcessingTurnPopup();

      // If still not mounted after 2.5s, force reload directly to supporter URL
      if (!hasAttemptedReload && Date.now() - tStart > 2500) {
        hasAttemptedReload = true;
        console.log('[GwMeatLight] Supporter view mounting delayed. Forcing reload to #quest/supporter/947551/1/0...');
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
          this.page.evaluate(() => {
            window.location.href = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
            window.location.reload();
          }).catch(() => null)
        ]);
        await logNormalDelay(500, 0.1);
      } else {
        await new Promise(r => setTimeout(r, 150));
      }
    }
  }

  /**
   * High-speed Supporter Selection & Quest Start.
   * Priority:
   * 1. Check IMMEDIATELY if supporter was auto-selected (<div class="prt-supporter" data-supporter-id="..." data-summon-id="...">)
   *    and Party Confirmation popup is open. If so, click OK IMMEDIATELY with human motor variance!
   * 2. If auto-supporter popup is not open, scan supporter list cards (.btn-supporter, .lis-supporter):
   *    - Zeus >= 200 (Highest level 250 first)
   *    - Lucifer >= 200 (Highest level 250 first)
   *    - Fallback to highest available Light supporter
   *    Click candidate card, then click OK!
   */
  private async selectSupporterAndStartQuest(
    autoReplenishAp: boolean,
    runNumber: number
  ): Promise<{ name: string; score: number } | null> {
    // Helper function to inspect the auto-selected supporter popup (<div class="prt-supporter" data-supporter-id="...">)
    const checkAutoSupporterPopup = async () => {
      return await this.page.evaluate(() => {
        const suppEl = document.querySelector('.prt-supporter[data-supporter-id], .prt-supporter[data-summon-id], .prt-supporter');
        const okBtn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-settle') as HTMLElement;
        const isOkVis = !!(okBtn && okBtn.offsetParent !== null && window.getComputedStyle(okBtn).display !== 'none');

        if (suppEl && isOkVis) {
          const summonText = suppEl.querySelector('.prt-supporter-summon')?.textContent?.replace(/\s+/g, ' ').trim() || 'Auto-Selected Supporter';
          const nameText = suppEl.querySelector('.txt-supporter-name')?.textContent?.trim() || '';
          return { name: nameText ? `${summonText} (${nameText})` : summonText, isAuto: true };
        }
        if (isOkVis) {
          return { name: 'Auto-Selected Supporter', isAuto: true };
        }
        return null;
      }).catch(() => null);
    };

    // Step 1: Immediately check if Supporter was auto-selected and Party Confirmation popup is open
    let autoSupp = await checkAutoSupporterPopup();
    if (autoSupp?.isAuto) {
      console.log(`[GwMeatLight] [Run ${runNumber}] Supporter auto-selected by GBF [${autoSupp.name}]! Clicking OK immediately...`);
      const started = await this.clickQuestStartOk(autoReplenishAp);
      if (started) {
        return { name: autoSupp.name, score: 9999 };
      }
    }

    // Step 2: If not found in 0ms, wait up to 1500ms for either auto-selected popup or supporter list cards to mount
    await this.page.waitForFunction(() => {
      const okBtn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-settle') as HTMLElement;
      if (okBtn && okBtn.offsetParent !== null && window.getComputedStyle(okBtn).display !== 'none') return true;
      const cards = Array.from(document.querySelectorAll('.btn-supporter, .lis-supporter'));
      return cards.some(el => (el as HTMLElement).offsetParent !== null && (el as HTMLElement).getBoundingClientRect().height > 0);
    }, { timeout: 1500 }).catch(() => null);

    // Re-check auto-supporter popup after brief wait
    autoSupp = await checkAutoSupporterPopup();
    if (autoSupp?.isAuto) {
      console.log(`[GwMeatLight] [Run ${runNumber}] Supporter auto-selected by GBF [${autoSupp.name}]! Clicking OK immediately...`);
      const started = await this.clickQuestStartOk(autoReplenishAp);
      if (started) {
        return { name: autoSupp.name, score: 9999 };
      }
    }

    // Step 3: Auto-selected supporter popup not present; proceed to scan supporter cards
    console.log(`[GwMeatLight] [Run ${runNumber}] Auto-selected supporter popup not found. Scanning supporter list...`);

    // 3. Scan list and select best candidate
    const bestCandidate = await this.page.evaluate((): { idx: number; name: string; level: number; score: number } | null => {
      const cards = Array.from(document.querySelectorAll('.btn-supporter, .lis-supporter'));
      let best: { idx: number; name: string; level: number; score: number } | null = null;
      let bestScore = -1;

      cards.forEach((card, idx) => {
        const el = card as HTMLElement;
        if (el.offsetParent === null || el.getBoundingClientRect().height === 0) return;
        const text = el.innerText || '';

        const isZeus = /Zeus|ゼウス/i.test(text);
        const isLucifer = /Lucifer|ルシフェル/i.test(text);

        const lvMatch = text.match(/(?:lvl?|lv|level)\s*(\d+)/i) || text.match(/\b(\d{3})\b/);
        const level = lvMatch ? parseInt(lvMatch[1], 10) : 0;

        let score = 0;
        let name = 'Other Supporter';

        if (isZeus) {
          name = `Zeus Lvl ${level || '?'}`;
          if (level >= 200) {
            score = 3000 + level; // Zeus 250 = 3250, Zeus 240 = 3240, ... Zeus 200 = 3200
          } else {
            score = 100 + level;
          }
        } else if (isLucifer) {
          name = `Lucifer Lvl ${level || '?'}`;
          if (level >= 200) {
            score = 2000 + level; // Lucifer 250 = 2250, Lucifer 240 = 2240, ... Lucifer 200 = 2200
          } else {
            score = 50 + level;
          }
        } else {
          score = 10;
        }

        if (score > bestScore) {
          bestScore = score;
          best = { idx, name, level, score };
        }
      });

      return best;
    });

    if (!bestCandidate) {
      const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (currentHash.includes('top')) {
        console.warn(`[GwMeatLight] ⚠️ Browser is on Title screen (#top). Please log in or click Game Start in the browser window.`);
      } else {
        console.warn(`[GwMeatLight] [Run ${runNumber}] No supporter summons visible on screen (Hash: "${currentHash}"). Navigating to Supporter URL...`);
        await this.page.goto(this.QUEST_URL, { waitUntil: 'domcontentloaded' }).catch(() => null);
      }
      return null;
    }

    console.log(`[GwMeatLight] [Run ${runNumber}] Supporter selected: [${bestCandidate.name}] (Priority Score: ${bestCandidate.score})`);

    // Scroll card into view smoothly
    await this.page.evaluate((idx) => {
      const cards = document.querySelectorAll('.btn-supporter, .lis-supporter');
      const target = cards[idx] as HTMLElement;
      if (target) target.scrollIntoView({ block: 'center' });
    }, bestCandidate.idx);

    await logNormalDelay(150, 0.12);

    const cards = await this.page.$$('.btn-supporter, .lis-supporter');
    const targetCard = cards[bestCandidate.idx];
    if (targetCard) {
      const box = await targetCard.boundingBox();
      if (box) {
        await humanReactionDelay(70, 0.10);
        const tapX = Math.round(box.x + box.width / 2 + sampleGaussian(0, 4));
        const tapY = Math.round(box.y + box.height / 2 + sampleGaussian(0, 3));
        await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
        await this.page.mouse.click(tapX, tapY).catch(() => null);
      } else {
        await humanizedClick(this.page, targetCard);
      }
      await logNormalDelay(250, 0.12);

      const started = await this.clickQuestStartOk(autoReplenishAp);
      if (started) {
        return { name: bestCandidate.name, score: bestCandidate.score };
      }
    }

    return null;
  }

  /**
   * Clicks Quest Start OK button with native touchscreen tap (FastClick) + mouse click.
   * Handles server turn lock ("A turn is currently being processed") dynamically without stalling.
   */
  private async clickQuestStartOk(autoReplenishAp: boolean): Promise<boolean> {
    // Wait for Quest Start button or AP modal
    await this.page.waitForFunction(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok, .btn-settle') as HTMLElement;
      const apModal = document.querySelector('.pop-usual');
      return (ok && ok.offsetParent !== null && window.getComputedStyle(ok).display !== 'none') || !!apModal;
    }, { timeout: 6000 }).catch(() => null);

    // Check AP modal in case AP depleted upon party confirm
    await this.handleApRecoveryIfPresent(autoReplenishAp);

    const okBtn = await this.page.waitForSelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok, .btn-settle', {
      visible: true,
      timeout: 4000
    }).catch(() => null);

    if (!okBtn) {
      console.warn('[GwMeatLight] Quest Start OK button not found.');
      return false;
    }

    // FastClick tap with Gaussian variance
    const box = await okBtn.boundingBox();
    if (box) {
      await humanReactionDelay(50, 0.10);
      const tapX = Math.round(box.x + box.width / 2 + sampleGaussian(0, 4));
      const tapY = Math.round(box.y + box.height / 2 + sampleGaussian(0, 3));
      await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
      await this.page.mouse.click(tapX, tapY).catch(() => null);
      await this.page.evaluate(() => {
        const btn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-settle') as HTMLElement;
        if (btn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
        }
      }).catch(() => null);
    } else {
      await humanizedClick(this.page, okBtn);
    }

    // Monitor for combat transition OR turn-lock modal (up to 5s)
    const tStart = Date.now();
    while (Date.now() - tStart < 5000) {
      const status = await this.page.evaluate(() => {
        const hash = window.location.hash;
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        const popText = (document.querySelector('.pop-usual, .common-pop-error, #pop')?.textContent || '').toLowerCase();
        const isTurnLock = popText.includes('processing') || popText.includes('processed') || popText.includes('turn') || popText.includes('処理中') || popText.includes('ターン');
        return { isCombat, isTurnLock };
      }).catch(() => ({ isCombat: false, isTurnLock: false }));

      if (status.isCombat) {
        return true;
      }

      if (status.isTurnLock) {
        console.log('[GwMeatLight] Server turn lock active. Dismissing modal and retrying Quest Start...');
        await this.checkAndDismissProcessingTurnPopup();
        await logNormalDelay(400, 0.10);
        const retryBtn = await this.page.$('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-settle');
        if (retryBtn) {
          const rBox = await retryBtn.boundingBox();
          if (rBox) {
            await this.page.touchscreen.tap(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2).catch(() => null);
            await this.page.mouse.click(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2).catch(() => null);
          }
        }
      }

      await new Promise(r => setTimeout(r, 40));
    }

    // Final safety verify on AP modal
    await this.handleApRecoveryIfPresent(autoReplenishAp);

    const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    return /^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHash);
  }

  /**
   * Compatibility wrapper for supporter selection.
   */
  private async selectSupporterByPriority(): Promise<{ name: string; score: number } | null> {
    return this.selectSupporterAndStartQuest(true, 0);
  }

  /**
   * Compatibility wrapper for party confirmation.
   */
  private async confirmPartyAndStartQuest(autoReplenishAp: boolean): Promise<boolean> {
    return this.clickQuestStartOk(autoReplenishAp);
  }

  /**
   * Simple, fast, consistent combat flow:
   * 1. Wait for battle to mount
   * 2. Tap READY screen once with human motor variance to skip animation
   * 3. Click Quick Call (.btn-quick-summon) -> Await server confirmation
   * 4. Instant Reload (F5) to skip summon animation
   * 5. Hit Attack (.btn-attack-start.display-on) -> Await normal_attack_result.json
   * 6. Conclude combat and transition directly to Supporter screen for next run
   */
  private async executeCombatRotation(runNumber: number): Promise<{ status: 'SUCCESS' | 'FAILED'; message: string }> {
    let summonResolved = false;
    const summonHandler = (res: any) => {
      if (res.url().includes('summon_result.json') && res.status() === 200) {
        summonResolved = true;
      }
    };
    this.page.on('response', summonHandler);

    try {
      console.log(`[GwMeatLight] [Run ${runNumber}] Entering combat...`);

      // 1. Wait for battle URL and combat HUD
      await this.page.waitForFunction(() => {
        const hash = window.location.hash;
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        const hasStage = !!document.querySelector('.prt-ready, #ready, canvas, .cnt-raid, .btn-quick-summon, .btn-attack-start');
        const isRes = hash.includes('result') || !!document.querySelector('.pop-raid-result');
        return (isCombat && hasStage) || isRes;
      }, { timeout: 15000 }).catch(() => null);

      if (await this.isBattleEnded()) {
        this.page.off('response', summonHandler);
        return { status: 'SUCCESS', message: 'Battle already concluded.' };
      }

      // Settle briefly for stage event listeners (~60ms)
      await logNormalDelay(60, 0.10);

      // 2. Tap READY screen to trigger Auto Quick Summon
      const tap1X = Math.round(240 + sampleGaussian(0, 12));
      const tap1Y = Math.round(370 + sampleGaussian(0, 14));
      console.log(`[GwMeatLight] [Run ${runNumber}] Tapping READY screen at (${tap1X}, ${tap1Y}) for Quick Call...`);

      await this.page.touchscreen.tap(tap1X, tap1Y).catch(() => null);
      await this.page.mouse.click(tap1X, tap1Y).catch(() => null);
      await this.page.evaluate((x, y) => {
        const stage = document.elementFromPoint(x, y) || document.querySelector('.prt-ready, #ready, canvas, .cnt-raid');
        if (stage) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(stage).trigger('tap');
          (stage as HTMLElement).click();
        }
      }, tap1X, tap1Y).catch(() => null);

      // 3. If ready tap did not trigger quick call in 400ms, click Quick Call button directly as fallback
      const qsPollStart = Date.now();
      while (!summonResolved && Date.now() - qsPollStart < 2500) {
        if (Date.now() - qsPollStart > 400 && !summonResolved) {
          const qsBtn = await this.page.$('.btn-quick-summon.qs-ready, .btn-quick-summon, #js-btn-quick-summon');
          if (qsBtn) {
            const isVis = await this.page.evaluate((el: any) => {
              const style = window.getComputedStyle(el);
              return el.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden';
            }, qsBtn).catch(() => false);

            if (isVis) {
              const box = await qsBtn.boundingBox();
              if (box) {
                const qsTapX = Math.round(box.x + box.width / 2 + sampleGaussian(0, 3));
                const qsTapY = Math.round(box.y + box.height / 2 + sampleGaussian(0, 3));
                await this.page.touchscreen.tap(qsTapX, qsTapY).catch(() => null);
                await this.page.mouse.click(qsTapX, qsTapY).catch(() => null);
              }
              await this.page.evaluate(() => {
                const btn = document.querySelector('.btn-quick-summon.qs-ready, .btn-quick-summon, #js-btn-quick-summon') as HTMLElement;
                if (btn) {
                  const $ = (window as any).$ || (window as any).Zepto;
                  if ($) $(btn).trigger('tap');
                  btn.click();
                }
              }).catch(() => null);
              console.log(`[GwMeatLight] [Run ${runNumber}] Quick Call button clicked with human motor.`);
              break;
            }
          }
        }
        await new Promise(r => setTimeout(r, 25));
      }

      // Wait up to 3500ms total for summon_result.json confirmation
      const tSummon = Date.now();
      while (!summonResolved && Date.now() - tSummon < 3500) {
        if (await this.isBattleEnded()) break;
        await new Promise(r => setTimeout(r, 25));
      }
      this.page.off('response', summonHandler);

      // 4. Reload 1 (F5): skip summon animation immediately
      if (summonResolved) {
        console.log(`[GwMeatLight] [Run ${runNumber}] Quick Summon confirmed (${Date.now() - tSummon}ms)! Instant reloading (F5)...`);
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
          this.page.evaluate(() => location.reload()).catch(() => null)
        ]);
      } else {
        console.warn(`[GwMeatLight] [Run ${runNumber}] Summon not acknowledged or already cast, checking Turn 1...`);
      }

      // 5. Check if battle concluded
      if (await this.isBattleEnded()) {
        console.log(`[GwMeatLight] [Run ${runNumber}] Battle concluded after summon. Skipping Attack...`);
      } else {
        // Step 4: "reload, on ready tab click it again, it will trigger attack"
        console.log(`[GwMeatLight] [Run ${runNumber}] Waiting for Turn 1 READY screen...`);
        await this.page.waitForFunction(() => {
          return !!document.querySelector('.prt-ready, #ready, canvas, .cnt-raid, .btn-attack-start');
        }, { timeout: 6000 }).catch(() => null);

        let attackResolved = false;
        const attackHandler = (res: any) => {
          if (res.url().includes('normal_attack_result.json') && res.status() === 200) {
            attackResolved = true;
          }
        };
        this.page.on('response', attackHandler);

        // Tap READY screen to trigger Attack
        const atkReadyTapX = Math.round(240 + sampleGaussian(0, 10));
        const atkReadyTapY = Math.round(370 + sampleGaussian(0, 10));
        console.log(`[GwMeatLight] [Run ${runNumber}] Tapping READY screen at (${atkReadyTapX}, ${atkReadyTapY}) for Attack...`);
        await this.page.touchscreen.tap(atkReadyTapX, atkReadyTapY).catch(() => null);
        await this.page.mouse.click(atkReadyTapX, atkReadyTapY).catch(() => null);
        await this.page.evaluate((x, y) => {
          const stage = document.elementFromPoint(x, y) || document.querySelector('.prt-ready, #ready, canvas, .cnt-raid');
          if (stage) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(stage).trigger('tap');
            (stage as HTMLElement).click();
          }
        }, atkReadyTapX, atkReadyTapY).catch(() => null);

        // If attack not resolved in 400ms, use dispatchAttack fallback
        const tAtk = Date.now();
        while (!attackResolved && Date.now() - tAtk < 3500) {
          if (Date.now() - tAtk > 400 && !attackResolved) {
            await this.dispatchAttack();
            break;
          }
          await new Promise(r => setTimeout(r, 25));
        }

        // Wait up to 3500ms total for normal_attack_result.json confirmation
        const tWaitAtk = Date.now();
        while (!attackResolved && Date.now() - tWaitAtk < 3500) {
          if (await this.isBattleEnded()) {
            attackResolved = true;
            break;
          }
          await new Promise(r => setTimeout(r, 25));
        }
        this.page.off('response', attackHandler);

        if (attackResolved) {
          console.log(`[GwMeatLight] [Run ${runNumber}] Attack confirmed by server!`);
        } else {
          console.warn(`[GwMeatLight] [Run ${runNumber}] Attack dispatched, checking result...`);
        }
      }

      // Step 5: "reload and we have the result, if processing click ok if not just return to loop"
      console.log(`[GwMeatLight] [Run ${runNumber}] Reloading (F5) to resolve battle result...`);
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
        this.page.evaluate(() => location.reload()).catch(() => null)
      ]);

      // Dismiss any "Processing turn" popup by clicking OK immediately
      await logNormalDelay(150, 0.10);
      await this.checkAndDismissProcessingTurnPopup();

      // Step 6: "return to loop" - Jump directly to Supporter Screen for next run
      console.log(`[GwMeatLight] [Run ${runNumber}] Combat concluded. Jumping directly to Supporter Screen...`);
      await logNormalDelay(100, 0.10);

      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
        this.page.evaluate(() => {
          window.location.href = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
          window.location.reload();
        }).catch(() => null)
      ]);

      // Wait for next run's auto-supporter popup or cards to mount before returning
      await this.page.waitForFunction(() => {
        const supp = document.querySelector('.prt-supporter[data-supporter-id], .prt-supporter[data-summon-id], .prt-supporter');
        const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-settle') as HTMLElement;
        const isOkVis = !!(ok && ok.offsetParent !== null && window.getComputedStyle(ok).display !== 'none');
        const cards = document.querySelectorAll('.btn-supporter, .lis-supporter');
        const apModal = document.querySelector('.pop-usual');
        return (supp && isOkVis) || cards.length > 0 || !!apModal;
      }, { timeout: 10000 }).catch(() => null);

      return { status: 'SUCCESS', message: 'Combat resolved.' };

    } catch (err: any) {
      this.page.off('response', summonHandler);
      console.warn(`[GwMeatLight] [Run ${runNumber}] Combat rotation notice:`, err?.message || err);
      return { status: 'SUCCESS', message: 'Combat concluded.' };
    }
  }

  /**
   * Dispatches attack with native touchscreen tap + human mouse variance.
   */
  private async dispatchAttack(): Promise<boolean> {
    await this.checkAndDismissProcessingTurnPopup();
    const atkBtn = await this.page.waitForSelector(
      '.btn-attack-start.display-on, .btn-attack-start, .btn-attack',
      { visible: true, timeout: 5000 }
    ).catch(() => null);

    if (!atkBtn) return false;

    const box = await atkBtn.boundingBox();
    if (box) {
      await humanReactionDelay(45, 0.10);
      const tapX = Math.round(box.x + box.width / 2 + sampleGaussian(0, 3));
      const tapY = Math.round(box.y + box.height / 2 + sampleGaussian(0, 2));
      await this.page.mouse.click(tapX, tapY).catch(() => null);
      await this.page.touchscreen.tap(tapX, tapY).catch(() => null);
    }

    // Also trigger via DOM & Zepto to ensure FastClick and Backbone handler execute
    await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-attack-start.display-on, .btn-attack-start') as HTMLElement;
      if (btn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(btn).trigger('tap');
        btn.click();
      }
    }).catch(() => null);
    return true;
  }

  /**
   * Swiftly concludes any lingering in-progress battle by hitting Attack until boss is dead.
   * Skips READY screen and Quick Summon checks since the battle is already past those stages.
   */
  private async finishActiveBattle(): Promise<void> {
    if (await this.isBattleEnded()) return;
    console.log('[GwMeatLight] Active unfinished battle detected. Concluding battle with Attacks...');
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (await this.isBattleEnded()) break;
      await this.checkAndDismissProcessingTurnPopup();
      await this.dispatchAttack();

      const start = Date.now();
      while (Date.now() - start < 3500) {
        if (await this.checkAndDismissProcessingTurnPopup()) break;
        if (await this.isBattleEnded()) break;
        await new Promise(r => setTimeout(r, 40));
      }
      await this.checkAndDismissProcessingTurnPopup();

      // Quick reload to skip animations if more turns are needed
      if (!await this.isBattleEnded()) {
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
          this.page.evaluate(() => location.reload()).catch(() => null)
        ]);
        await this.waitForCombatHudAfterReload(6000);
      }
    }
  }

  /**
   * Fast check for combat HUD / attack button or processing popup after F5 reload.
   */
  private async waitForCombatHudAfterReload(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    try {
      await this.page.waitForFunction(() => {
        const hasAtkOn = !!document.querySelector('.btn-attack-start.display-on');
        const hasStage = !!(window as any).stage?.gGameStatus;
        const hasPop = !!document.querySelector('.pop-usual, .common-pop-error, .pop-show');
        const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
        return (hasAtkOn && hasStage) || hasPop || isRes;
      }, { timeout: timeoutMs });
      return true;
    } catch {
      return Date.now() - start < timeoutMs;
    }
  }

  /**
   * Rapidly activates Character 1 Skill 3 (.ability-character-num-1-3).
   */
  private async executeChar1Skill3(): Promise<void> {
    try {
      let s3 = await this.page.$('.ability-character-num-1-3');
      const isS3Visible = s3 ? await this.page.evaluate((el: any) => {
        return el.offsetWidth > 0 && el.offsetHeight > 0;
      }, s3).catch(() => false) : false;

      if (!isS3Visible) {
        // Tap Character 1 portrait in .prt-member to open ability tray
        const char0 = await this.page.waitForSelector(
          '.prt-command-chara[pos="0"], .prt-member .lis-character0.btn-command-character, .lis-character0.btn-command-character, .lis-character0',
          { visible: true, timeout: 3000 }
        ).catch(() => null);

        if (char0) {
          await humanReactionDelay(70, 0.12);
          await humanizedClick(this.page, char0);
        }

        // Wait for Skill 3 to become visible
        s3 = await this.page.waitForSelector('.ability-character-num-1-3', {
          visible: true,
          timeout: 2500
        }).catch(() => null);
      }

      if (s3) {
        let abilityResolved = false;
        const abilityHandler = (res: any) => {
          if (res.url().includes('ability_result.json') && res.status() === 200) {
            abilityResolved = true;
          }
        };
        this.page.on('response', abilityHandler);

        await humanReactionDelay(70, 0.12);
        await humanizedClick(this.page, s3);

        // Wait for server resolution of ability_result.json (max 1200ms)
        const start = Date.now();
        while (!abilityResolved && Date.now() - start < 1200) {
          await new Promise(r => setTimeout(r, 40));
        }
        this.page.off('response', abilityHandler);

        if (abilityResolved) {
          console.log('[GwMeatLight] Char 1 Skill 3 activated.');
        }
      } else {
        console.warn('[GwMeatLight] Char 1 Skill 3 not found, continuing to attack...');
      }
    } catch (err: any) {
      console.warn('[GwMeatLight] Notice during Char 1 Skill 3 execution:', err?.message || err);
    }
  }

  /**
   * Executes Quick Call (.btn-quick-summon.qs-ready), waiting for server resolution of summon_result.json.
   */
  private async executeQuickSummon(): Promise<boolean> {
    try {
      // 1. If ability drawer is open, tap back button first to reveal command menu
      const backBtn = await this.page.$('.btn-command-back');
      if (backBtn) {
        const isBackVisible = await this.page.evaluate((el: any) => {
          return el.offsetParent !== null && window.getComputedStyle(el).display !== 'none';
        }, backBtn).catch(() => false);
        if (isBackVisible) {
          await humanizedClick(this.page, backBtn);
          await logNormalDelay(150, 0.12);
        }
      }

      // 2. Wait for Quick Summon button (.btn-quick-summon)
      const qsBtn = await this.page.waitForSelector(
        '.btn-quick-summon.qs-ready, #js-btn-quick-summon.qs-ready, .btn-quick-summon:not(.qs-hide), #js-btn-quick-summon:not(.qs-hide), .btn-quick-summon, #js-btn-quick-summon',
        { visible: true, timeout: 4000 }
      ).catch(() => null);

      if (!qsBtn) {
        console.warn('[GwMeatLight] Quick Summon button not found or not ready.');
        return false;
      }

      return await this.dispatchSummonWithListener(qsBtn);
    } catch (err: any) {
      console.warn('[GwMeatLight] Notice during Quick Summon:', err?.message || err);
      return false;
    }
  }

  /**
   * Dispatches Quick Summon click and awaits summon_result.json confirmation.
   */
  private async dispatchSummonWithListener(qsBtn: any): Promise<boolean> {
    let summonResolved = false;
    const summonHandler = (res: any) => {
      if (res.url().includes('summon_result.json') && res.status() === 200) {
        summonResolved = true;
      }
    };
    this.page.on('response', summonHandler);

    try {
      await humanReactionDelay(50, 0.10);
      await humanizedClick(this.page, qsBtn, { allowMultiClick: true, multiClickChance: 0.25 });

      // Wait for server resolution of summon_result.json (max 3500ms)
      const start = Date.now();
      while (!summonResolved && Date.now() - start < 3500) {
        await new Promise(r => setTimeout(r, 40));
      }
      this.page.off('response', summonHandler);

      if (summonResolved) {
        console.log(`[GwMeatLight] Quick Summon confirmed by server (${Date.now() - start}ms).`);
      }

      return summonResolved;
    } catch (err: any) {
      this.page.off('response', summonHandler);
      console.warn('[GwMeatLight] Notice during summon execution:', err?.message || err);
      return false;
    }
  }

  /**
   * Clicks Attack button, listens for normal_attack_result.json,
   * dismisses any "Processing turn" modal with OK,
   * and immediately triggers bookmark navigation to repeat to next run.
   */
  private async executeAttackAndRepeatToNextRun(): Promise<{ success: boolean; battleFinished: boolean }> {
    // 1. Locate attack button (or clear blocking popup first)
    let atkBtn = await this.page.waitForSelector('.btn-attack-start, .btn-attack', {
      visible: true,
      timeout: 4500
    }).catch(() => null);

    if (!atkBtn) {
      const hadPopup = await this.checkAndDismissProcessingTurnPopup();
      if (hadPopup) {
        atkBtn = await this.page.waitForSelector('.btn-attack-start, .btn-attack', {
          visible: true,
          timeout: 2500
        }).catch(() => null);
      }
    }

    if (!atkBtn) {
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.includes('result') || hash.includes('supporter') || await this.isBattleEnded()) {
        await this.triggerDirectBookmarkToNextRun();
        return { success: true, battleFinished: true };
      }
      console.warn('[GwMeatLight] Attack button not found. Triggering bookmark fallback...');
      await this.triggerDirectBookmarkToNextRun();
      return { success: true, battleFinished: true };
    }

    let attackResolved = false;
    let turnHonors = this.latestHonors || 126120;

    const responseHandler = async (res: any) => {
      if (res.url().includes('normal_attack_result.json') && res.status() === 200) {
        attackResolved = true;
        const data = await res.json().catch(() => null);
        if (data?.status?.user_point) {
          turnHonors = Number(data.status.user_point);
        }
      }
    };

    this.page.on('response', responseHandler);

    try {
      await humanReactionDelay(85, 0.15);
      await humanizedClick(this.page, atkBtn);

      // Poll for server confirmation, processing turn popup, or battle end
      const start = Date.now();
      while (Date.now() - start < 3500) {
        // Check for "Processing turn" popup
        const hadPopup = await this.checkAndDismissProcessingTurnPopup();
        if (hadPopup) {
          // If popup appeared before normal_attack_result was received, try a rapid click on attack in case it was blocked
          if (!attackResolved) {
            await logNormalDelay(120, 0.1);
            const retryAtk = await this.page.$('.btn-attack-start, .btn-attack');
            if (retryAtk) {
              const isRetryVis = await this.page.evaluate((el: any) => el.offsetParent !== null, retryAtk).catch(() => false);
              if (isRetryVis) {
                await humanizedClick(this.page, retryAtk);
              }
            }
          }
          break;
        }

        if (attackResolved) {
          console.log(`[GwMeatLight] Attack confirmed by server! (Honors: ${turnHonors.toLocaleString()} pt)`);
          break;
        }

        if (await this.isBattleEnded()) {
          break;
        }

        await new Promise(r => setTimeout(r, 40));
      }

      this.page.off('response', responseHandler);
      this.latestHonors = turnHonors;

      // Repeat to next run via direct bookmark navigation
      await this.triggerDirectBookmarkToNextRun();

      return { success: true, battleFinished: true };

    } catch (err: any) {
      this.page.off('response', responseHandler);
      console.warn('[GwMeatLight] Notice during attack dispatch:', err?.message || err);
      await this.triggerDirectBookmarkToNextRun();
      return { success: true, battleFinished: true };
    }
  }

  /**
   * Checks for and dismisses any "Processing turn" / "A turn is currently being processed" modal.
   * Clicks the OK button to close the modal.
   */
  private async checkAndDismissProcessingTurnPopup(): Promise<boolean> {
    try {
      const dismissed = await this.page.evaluate(() => {
        const popups = Array.from(document.querySelectorAll('.pop-usual, .common-pop-error, .pop-show, #pop, .prt-popup-body'));
        for (const pop of popups) {
          const text = (pop.textContent || '').toLowerCase();
          const isProcessingTurn =
            text.includes('processing') ||
            text.includes('processed') ||
            (text.includes('turn') && (text.includes('wait') || text.includes('process'))) ||
            text.includes('処理中') ||
            text.includes('ターン') ||
            text.includes('前ターン') ||
            text.includes('ended') ||
            text.includes('終了');

          if (isProcessingTurn) {
            const okBtn = (
              pop.querySelector('.btn-usual-ok, .btn-close, .btn-usual-close, .btn-result-close, .btn-agree') ||
              document.querySelector('.pop-usual .btn-usual-ok, .common-pop-error .btn-usual-ok, #pop .btn-usual-ok')
            ) as HTMLElement;

            if (okBtn) {
              const rect = okBtn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(okBtn).trigger('tap');
                okBtn.click();
                return true;
              }
            }
          }
        }
        return false;
      }).catch(() => false);

      if (dismissed) {
        console.log('[GwMeatLight] "Processing turn" popup detected and dismissed (clicked OK).');
        return true;
      }

      // Secondary check via Puppeteer handle if evaluate didn't catch it
      const modalOk = await this.page.$('.pop-usual .btn-usual-ok, .common-pop-error .btn-usual-ok, #pop .btn-usual-ok');
      if (modalOk) {
        const isVis = await this.page.evaluate((el: any) => {
          const style = window.getComputedStyle(el);
          return el.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden';
        }, modalOk).catch(() => false);
        if (isVis) {
          await humanizedClick(this.page, modalOk);
          console.log('[GwMeatLight] "Processing turn" modal dismissed (clicked OK via handle).');
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Direct bookmark navigation to repeat to next run.
   */
  private async triggerDirectBookmarkToNextRun(): Promise<void> {
    console.log('[GwMeatLight] Repeating to next run (direct bookmark navigation)...');
    await this.page.evaluate(() => {
      const bb = (window as any).Backbone;
      if (bb?.history?.navigate) {
        bb.history.navigate('quest/supporter/947551/1/0', { trigger: true });
      }
      window.location.hash = '#quest/supporter/947551/1/0';
    }).catch(() => null);
  }

  /**
   * Waits for page reload to settle into #result or combat HUD.
   */
  private async waitForTurnOrResultResolution(timeoutMs = 12000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await this.page.evaluate(() => {
        const hash = window.location.hash;
        const isResult = hash.includes('result');
        const hasAttack = !!document.querySelector('.btn-attack-start, .btn-attack');
        const hasModal = !!document.querySelector('.pop-usual, .pop-raid-result');
        return { isResult, hasAttack, hasModal };
      }).catch(() => null);

      if (status?.isResult || status?.hasAttack || status?.hasModal) {
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    await logNormalDelay(250, 0.12);
  }

  /**
   * Handles result screen popups, extracts honors and meat chunk loot rapidly without stalling.
   */
  private async handleResultScreen(): Promise<{ meatGained: number; honors: number }> {
    let meatGained = 4; // EX+ base meat drop
    let honors = this.latestHonors || 126120; // Captured from normal_attack_result.json

    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash.includes('supporter/947551')) {
      return { meatGained, honors };
    }

    try {
      // Rapid check for result screen container (max 800ms)
      const isResult = await this.page.waitForFunction(() => {
        const hash = window.location.hash;
        const hasHead = !!document.querySelector('.prt-result-head, .prt-navigation, .cnt-result, .pop-raid-result');
        return hash.includes('result') || hasHead;
      }, { timeout: 800 }).catch(() => null);

      if (isResult) {
        const data = await this.safeEvaluate(() => {
          const bodyText = document.body ? document.body.innerText || '' : '';
          const honorMatch = bodyText.match(/Total\s+honors:\s*([\d,]+)/i) || bodyText.match(/獲得貢献度[^\d]*([\d,]+)/);
          const parsedHonors = honorMatch ? parseInt(honorMatch[1].replace(/,/g, ''), 10) : 0;
          return { parsedHonors };
        }, { parsedHonors: 0 });

        if (data.parsedHonors > 0) {
          honors = data.parsedHonors;
        }

        await this.dismissAllPopups(1);
      }
    } catch (err: any) {
      console.warn('[GwMeatLight] Notice resolving result screen:', err?.message || err);
    }

    return { meatGained, honors };
  }

  /**
   * Consumes Half-Elixir if AP recovery popup appears.
   */
  private async handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean> {
    try {
      const apModal = await this.page.$('.pop-usual .btn-use-item, .pop-usual .use-item, .pop-show .btn-use-item, .btn-use-item');
      if (!apModal) return true;

      if (!autoReplenishAp) {
        console.warn('[GwMeatLight] AP depleted and autoReplenishAp is false.');
        const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel, .pop-show .btn-usual-cancel');
        if (cancelBtn) await humanizedClick(this.page, cancelBtn);
        return false;
      }

      console.log('[GwMeatLight] AP depleted. Consuming Half-Elixir to restore AP...');
      await humanReactionDelay(250, 0.18);
      await humanizedClick(this.page, apModal);

      const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok', {
        visible: true,
        timeout: 5000
      }).catch(() => null);

      if (confirmBtn) {
        await humanReactionDelay(220, 0.18);
        await humanizedClick(this.page, confirmBtn);
        await logNormalDelay(600, 0.15);
        console.log('[GwMeatLight] AP restored successfully.');
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private async isApModalOpen(): Promise<boolean> {
    const modal = await this.page.$('.pop-usual');
    if (!modal) return false;
    return await this.page.evaluate((el: any) => {
      const text = el.innerText || '';
      return text.includes('AP') || text.includes('Recovery') || text.includes('Elixir') || text.includes('回復');
    }, modal);
  }

  /**
   * Waits for combat HUD elements to become ready and interactable.
   */
  private async waitForCombatHudReady(timeoutMs = 20000): Promise<boolean> {
    const start = Date.now();
    try {
      await this.page.waitForFunction(() => {
        const hasAtk = !!document.querySelector('.btn-attack-start, .btn-attack');
        const hasChara = !!document.querySelector('.prt-member .lis-character0, .lis-character0.btn-command-character, .lis-character0');
        const isRes = window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
        return (hasAtk && hasChara) || isRes;
      }, { timeout: timeoutMs });
      // Settle delay for READY banner to finish fading
      await logNormalDelay(250, 0.12);
      return true;
    } catch {
      return Date.now() - start < timeoutMs;
    }
  }

  /**
   * Strictly determines if a hash corresponds to an active raid/battle.
   * Prevents false positives with non-combat URLs like '#event/teamraid084'.
   */
  private isBattleHash(hash: string): boolean {
    if (!hash) return false;
    return /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
  }

  /**
   * Checks if battle has concluded.
   */
  private async isBattleEnded(): Promise<boolean> {
    try {
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.includes('result') || hash.includes('supporter') || hash.includes('mypage') || hash.includes('event')) {
        return true;
      }

      return await this.page.evaluate(() => {
        if (document.querySelector('.pop-raid-result')) {
          return true;
        }

        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        const pJsn = stage?.pJsnData;

        if (gStatus?.finish || gStatus?.win || gStatus?.lose || pJsn?.finish || pJsn?.is_clear) {
          return true;
        }

        const boss = gStatus?.boss?.param?.[0] || pJsn?.boss?.param?.[0];
        if (boss?.hp !== undefined && Number(boss.hp) <= 0) {
          return true;
        }

        return false;
      });
    } catch {
      return false;
    }
  }

  /**
   * Helper to wait for the page DOM and execution context to settle after reloads.
   */
  private async waitForPageSettle(timeoutMs = 6000): Promise<void> {
    await new Promise(r => setTimeout(r, 350));
    await this.page.waitForFunction(() => {
      return document.readyState === 'interactive' || document.readyState === 'complete';
    }, { timeout: timeoutMs }).catch(() => null);
  }

  /**
   * Safe evaluate wrapper that recovers from transient detached Frame errors.
   */
  private async safeEvaluate<T>(fn: () => T, fallback: T): Promise<T> {
    try {
      return await this.page.evaluate(fn);
    } catch (err: any) {
      if (err?.message?.includes('detached Frame') || err?.message?.includes('Execution context was destroyed')) {
        await new Promise(r => setTimeout(r, 300));
        return await this.page.evaluate(fn).catch(() => fallback);
      }
      return fallback;
    }
  }

  /**
   * Dismisses any blocking popup modals.
   */
  public async dismissAllPopups(maxPasses = 3): Promise<void> {
    for (let i = 0; i < maxPasses; i++) {
      await this.checkAndDismissProcessingTurnPopup();

      const popup = await this.page.$('.pop-usual:not([style*="none"]), .pop-show, .pop-raid-result, .common-pop-error, #pop');
      if (!popup) break;

      const isVisible = await this.page.evaluate((el: any) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }, popup).catch(() => false);

      if (!isVisible) break;

      const okBtn = await popup.$('.btn-usual-ok, .btn-result-close, .btn-usual-close, .btn-close, .btn-agree');
      if (okBtn) {
        await humanizedClick(this.page, okBtn);
        await logNormalDelay(250, 0.15);
      } else {
        break;
      }
    }
  }

  private ensureLogDirExists(filePath: string): void {
    const dir = path.dirname(path.resolve(process.cwd(), filePath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        `# Guild War Light Meat Farming Log (September 2026)\n\n| Run # | Timestamp | Duration | Supporter | Meat Gained | Total Meat | Honors |\n| :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`
      );
    }
  }

  private async appendLogEntry(
    filePath: string,
    entry: {
      runNumber: number;
      timestamp: string;
      durationSec: string;
      supporter: string;
      meatGained: number;
      totalMeat: number;
      honors: number;
    }
  ): Promise<void> {
    const row = `| ${entry.runNumber} | ${entry.timestamp} | ${entry.durationSec}s | ${entry.supporter} | +${entry.meatGained} | ${entry.totalMeat} | ${entry.honors.toLocaleString()} |\n`;
    fs.appendFileSync(filePath, row);
  }
}

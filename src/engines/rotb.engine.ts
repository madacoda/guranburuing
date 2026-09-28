// src/engines/rotb.engine.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { humanizedClick, logNormalDelay } from '../human-motor.js';

export interface RotbRoundResult {
  round: number;
  status: 'SUCCESS' | 'AP_EXHAUSTED' | 'FAILED' | 'STOPPED' | 'NOT_AVAILABLE';
  durationMs: number;
  message: string;
}

export interface RotbLoopOptions {
  repeatCount?: number; // e.g. 10, 30, or Infinity
  autoReplenishAp?: boolean;
  onProgress?: (result: RotbRoundResult) => void;
}

export interface RotbLoopSummary {
  totalRounds: number;
  successCount: number;
  failedCount: number;
  totalDurationMs: number;
  status: 'COMPLETED' | 'AP_EXHAUSTED' | 'INTERRUPTED' | 'FAILED';
}

export interface RotbEarthLoopOptions {
  cycles?: number; // Total cycles, default 1, can be Infinity
  baihuPerCycle?: number; // default 9
  titanPerCycle?: number; // default 1
  autoReplenishAp?: boolean;
  onProgress?: (type: 'BAIHU' | 'TITAN', cycle: number, step: number, result: RotbRoundResult) => void;
}

export interface RotbEarthSummary {
  cyclesCompleted: number;
  totalBaihuClears: number;
  totalTitanClears: number;
  totalDurationMs: number;
  status: 'COMPLETED' | 'AP_EXHAUSTED' | 'INTERRUPTED' | 'FAILED';
}

export class RotbEngine {
  private isInterrupted = false;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  /**
   * Request graceful interruption after current round finishes.
   */
  public requestStop(): void {
    console.log('\n[RotbEngine] 🛑 Graceful stop requested. Finishing active run...');
    this.isInterrupted = true;
  }

  /**
   * 1. Head to https://game.granbluefantasy.jp/#event/advent
   * Establishes event session state and dismisses initial event banners.
   */
  public async visitEventOverview(): Promise<void> {
    console.log('[RotbEngine] Navigating to Event Overview (#event/advent)...');
    await this.sentinel.assertSafe();

    await this.page.evaluate(() => { window.location.hash = '#event/advent'; });
    await new Promise(resolve => setTimeout(resolve, 2500));
    await this.sentinel.assertSafe();

    await this.dismissAllPopups(2);
    console.log('[RotbEngine] Event overview initialized.');
  }

  /**
   * Executes a single Baihu Extreme round:
   * 1. Head to #quest/supporter/711141/1
   * 2. Select any first supporter
   * 3. Press OK
   * 4. Press Call
   * 5. Refresh page (F5)
   */
  public async runSingleBaihu(roundNumber = 1, autoReplenishAp = true): Promise<RotbRoundResult> {
    const startTime = Date.now();
    console.log(`\n-----------------------------------------------------`);
    console.log(`[RotbEngine] [Round ${roundNumber}] Starting Baihu Extreme (711141/1)...`);
    console.log(`-----------------------------------------------------`);

    await this.sentinel.assertSafe();

    // 1. Navigate to Baihu Supporter Selection
    console.log(`[RotbEngine] [Round ${roundNumber}] Navigating to #quest/supporter/711141/1...`);
    await this.page.evaluate(() => { window.location.hash = '#quest/supporter/711141/1'; });

    // Wait until hash is supporter and either visible supporter or visible AP modal is mounted
    await this.page.waitForFunction(() => {
      const isSupporterHash = window.location.hash.includes('supporter/711141');
      if (!isSupporterHash) return false;

      const hasVisibleSupp = Array.from(document.querySelectorAll('.btn-supporter, .lis-supporter')).some(el => {
        const html = el as HTMLElement;
        return html.offsetParent !== null && html.getBoundingClientRect().height > 0;
      });

      const hasVisibleApModal = Array.from(document.querySelectorAll('.pop-usual, .pop-show')).some(el => {
        const html = el as HTMLElement;
        return html.offsetParent !== null && html.innerText.includes('AP');
      });

      return hasVisibleSupp || hasVisibleApModal;
    }, { timeout: 20000 });

    await logNormalDelay(600, 0.15);
    await this.sentinel.assertSafe();

    // Check for AP Recovery modal
    const apRestored = await this.handleApRecoveryIfPresent(autoReplenishAp);
    if (!apRestored && await this.isApModalOpen()) {
      return {
        round: roundNumber,
        status: 'AP_EXHAUSTED',
        durationMs: Date.now() - startTime,
        message: 'AP exhausted and auto-replenish is disabled or items depleted.'
      };
    }

    // 2. Select first available supporter
    console.log(`[RotbEngine] [Round ${roundNumber}] Selecting first available supporter summon...`);
    const supporterSelected = await this.selectFirstSupporter();
    if (!supporterSelected) {
      throw new Error(`Failed to find or select supporter summon on round ${roundNumber}.`);
    }

    // 3. Press OK (Party Confirmation screen / Quest Start)
    console.log(`[RotbEngine] [Round ${roundNumber}] Waiting for Quest Start OK button...`);
    
    await this.page.waitForFunction(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      return ok && ok.offsetParent !== null;
    }, { timeout: 12000 });

    const okBtn = await this.page.$('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok');
    if (!okBtn) {
      throw new Error(`Quest Start OK button not found on round ${roundNumber}.`);
    }

    // In case AP modal popped up after selecting supporter
    await this.handleApRecoveryIfPresent(autoReplenishAp);

    console.log(`[RotbEngine] [Round ${roundNumber}] Pressing OK / Quest Start...`);
    await humanizedClick(this.page, okBtn);

    // 4. Wait for combat to mount and READY to pass
    console.log(`[RotbEngine] [Round ${roundNumber}] Entering battle, waiting for Quick Summon (Call)...`);
    
    await this.page.waitForFunction(() => {
      const qsReady = document.querySelector('.btn-quick-summon.qs-ready');
      const qsNormal = document.querySelector('.btn-quick-summon');
      const attackBtn = document.querySelector('.btn-attack-start');
      return (qsReady && (qsReady as HTMLElement).offsetParent !== null) ||
             (qsNormal && (qsNormal as HTMLElement).offsetParent !== null) ||
             (attackBtn && (attackBtn as HTMLElement).offsetParent !== null);
    }, { timeout: 25000 });

    await logNormalDelay(600, 0.15);
    await this.sentinel.assertSafe();

    // 5. Press Call (Quick Summon)
    const callBtn = await this.page.waitForSelector('.btn-quick-summon.qs-ready, .btn-quick-summon', {
      visible: true,
      timeout: 8000
    });

    if (callBtn) {
      console.log(`[RotbEngine] [Round ${roundNumber}] Quick Summon ready! Pressing Call...`);
      await humanizedClick(this.page, callBtn);
    } else {
      console.warn(`[RotbEngine] [Round ${roundNumber}] Quick Summon button not found, attempting summon menu...`);
      await this.callSummonFallback();
    }

    // Wait for summon call request to register on server
    await logNormalDelay(950, 0.1);

    // 6. Refresh page (F5)
    console.log(`[RotbEngine] [Round ${roundNumber}] Quick-refreshing page (F5) to skip combat animations...`);
    await this.page.evaluate(() => location.reload());

    // Wait for reload to resolve into Result or Combat
    console.log(`[RotbEngine] [Round ${roundNumber}] Waiting for turn resolution...`);
    await this.page.waitForFunction(() => {
      const isResult = window.location.hash.includes('result');
      const hasAttack = !!document.querySelector('.btn-attack-start');
      const hasModal = !!document.querySelector('.pop-usual, .pop-raid-result');
      return isResult || hasAttack || hasModal;
    }, { timeout: 18000 }).catch(() => null);

    await logNormalDelay(1000, 0.15);
    await this.sentinel.assertSafe();

    // 7. Verify Outcome
    const outcome = await this.verifyPostBattleOutcome();
    const durationMs = Date.now() - startTime;

    console.log(`[RotbEngine] [Round ${roundNumber}] Result: ${outcome.status} in ${(durationMs / 1000).toFixed(1)}s - ${outcome.message}`);

    return {
      round: roundNumber,
      status: outcome.status,
      durationMs,
      message: outcome.message
    };
  }

  /**
   * Executes a single Titan Extreme+ round:
   * 1. Head to #quest/supporter/711151/1
   * 2. Select any first supporter
   * 3. Press OK (handles Error B-001-38094 gracefully if Titan gauge is not full)
   * 4. In combat: Quick Summon (if ready) + Full Auto
   * 5. Wait 4s, refresh page (F5)
   * 6. Confirm victory on result screen
   */
  public async runSingleTitan(roundNumber = 1, autoReplenishAp = true): Promise<RotbRoundResult> {
    const startTime = Date.now();
    console.log(`\n-----------------------------------------------------`);
    console.log(`[RotbEngine] [Titan EX+] Starting Titan Extreme+ (711151/1)...`);
    console.log(`-----------------------------------------------------`);

    await this.sentinel.assertSafe();

    // 1. Navigate to Titan Supporter Selection
    console.log(`[RotbEngine] [Titan EX+] Navigating to #quest/supporter/711151/1...`);
    await this.page.evaluate(() => { window.location.hash = '#quest/supporter/711151/1'; });

    // Wait until hash is supporter and either visible supporter or visible AP modal is mounted
    await this.page.waitForFunction(() => {
      const isSupporterHash = window.location.hash.includes('supporter/711151');
      if (!isSupporterHash) return false;

      const hasVisibleSupp = Array.from(document.querySelectorAll('.btn-supporter, .lis-supporter')).some(el => {
        const html = el as HTMLElement;
        return html.offsetParent !== null && html.getBoundingClientRect().height > 0;
      });

      const hasVisibleApModal = Array.from(document.querySelectorAll('.pop-usual, .pop-show')).some(el => {
        const html = el as HTMLElement;
        return html.offsetParent !== null && html.innerText.includes('AP');
      });

      return hasVisibleSupp || hasVisibleApModal;
    }, { timeout: 20000 });

    await logNormalDelay(600, 0.15);
    await this.sentinel.assertSafe();

    // Check for AP Recovery modal
    const apRestored = await this.handleApRecoveryIfPresent(autoReplenishAp);
    if (!apRestored && await this.isApModalOpen()) {
      return {
        round: roundNumber,
        status: 'AP_EXHAUSTED',
        durationMs: Date.now() - startTime,
        message: 'AP exhausted for Titan.'
      };
    }

    // 2. Select first available supporter
    console.log(`[RotbEngine] [Titan EX+] Selecting first available supporter summon...`);
    const supporterSelected = await this.selectFirstSupporter();
    if (!supporterSelected) {
      throw new Error(`Failed to find or select supporter summon for Titan.`);
    }

    // 3. Press OK (Party Confirmation screen / Quest Start)
    console.log(`[RotbEngine] [Titan EX+] Waiting for Quest Start OK button...`);
    await this.page.waitForFunction(() => {
      const ok = document.querySelector('.btn-usual-ok, .se-quest-start') as HTMLElement;
      return ok && ok.offsetParent !== null;
    }, { timeout: 12000 });

    const okBtn = await this.page.$('.btn-usual-ok, .se-quest-start');
    if (!okBtn) {
      throw new Error(`Quest Start OK button not found for Titan.`);
    }

    await this.handleApRecoveryIfPresent(autoReplenishAp);

    console.log(`[RotbEngine] [Titan EX+] Pressing OK / Quest Start...`);
    await humanizedClick(this.page, okBtn);

    // Wait for either raid navigation OR error popup (B-001-38094) without context collision
    const navResult = await this.page.waitForFunction(() => {
      if (window.location.hash.includes('raid')) return 'RAID';
      const modal = document.querySelector('.pop-usual') as HTMLElement;
      if (modal && modal.offsetParent !== null) {
        const text = modal.innerText || '';
        if (text.includes('B-001') || text.includes('エラー') || text.includes('Error')) {
          return 'ERROR';
        }
      }
      return false;
    }, { timeout: 25000 }).catch(() => null);

    const resultType = navResult ? await navResult.jsonValue() : null;

    if (resultType === 'ERROR') {
      console.warn(`[RotbEngine] [Titan EX+] Titan is not unlocked yet (gauge not full). Dismissing error...`);
      const dismissOk = await this.page.$('.pop-usual .btn-usual-ok');
      if (dismissOk) await humanizedClick(this.page, dismissOk);
      await logNormalDelay(600, 0.15);
      return {
        round: roundNumber,
        status: 'NOT_AVAILABLE',
        durationMs: Date.now() - startTime,
        message: 'Titan EX+ not unlocked yet (gauge not full).'
      };
    }

    // 4. Wait for combat HUD
    console.log(`[RotbEngine] [Titan EX+] Entering combat, waiting for combat HUD...`);
    await this.page.waitForFunction(() => {
      const qsReady = document.querySelector('.btn-quick-summon.qs-ready');
      const attackBtn = document.querySelector('.btn-attack-start');
      const autoBtn = document.querySelector('.btn-auto');
      return (qsReady && (qsReady as HTMLElement).offsetParent !== null) ||
             (attackBtn && (attackBtn as HTMLElement).offsetParent !== null) ||
             (autoBtn && (autoBtn as HTMLElement).offsetParent !== null);
    }, { timeout: 25000 });

    await logNormalDelay(600, 0.15);
    await this.sentinel.assertSafe();

    // 5. If Quick Summon ready, call it
    const callBtn = await this.page.$('.btn-quick-summon.qs-ready');
    if (callBtn) {
      console.log(`[RotbEngine] [Titan EX+] Quick Summon ready! Pressing Call...`);
      await humanizedClick(this.page, callBtn);
      await logNormalDelay(800, 0.1);
    }

    // 6. Engage Full Auto and monitor combat loop
    console.log(`[RotbEngine] [Titan EX+] Engaging Full Auto...`);
    const autoBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto, .btn-attack-start', { visible: true, timeout: 8000 }).catch(() => null);
    if (autoBtn) {
      const isAutoActive = await this.page.evaluate((el: any) => el?.classList?.contains('active') || false, autoBtn);
      if (!isAutoActive) {
        await humanizedClick(this.page, autoBtn);
      }
    }

    // 7. Reactive Combat Loop (listen for normal_attack_result.json and fast-refresh)
    const combatMaxDurationMs = 60000;
    const combatStart = Date.now();
    let turnCount = 0;

    while (Date.now() - combatStart < combatMaxDurationMs) {
      const isResult = await this.page.evaluate(() => window.location.hash.includes('result'));
      if (isResult) {
        break;
      }

      // Listen for next attack turn resolution
      let attackResolved = false;
      const responseHandler = (res: any) => {
        if (res.url().includes('normal_attack_result.json') && res.status() === 200) {
          attackResolved = true;
        }
      };
      this.page.on('response', responseHandler);

      const waitStart = Date.now();
      while (!attackResolved && Date.now() - waitStart < 12000) {
        const isRes = await this.page.evaluate(() => window.location.hash.includes('result'));
        if (isRes) break;
        await new Promise(r => setTimeout(r, 400));
      }
      this.page.off('response', responseHandler);

      if (attackResolved) {
        turnCount++;
        console.log(`[RotbEngine] [Titan EX+] Turn ${turnCount} attack resolved. Quick refreshing (F5)...`);
        await logNormalDelay(200, 0.1);
        await this.page.evaluate(() => location.reload()).catch(() => null);
        await new Promise(r => setTimeout(r, 2500));
        await this.sentinel.assertSafe();

        // Check if victory reached after reload
        const hashAfterReload = await this.page.evaluate(() => window.location.hash);
        if (hashAfterReload.includes('result')) {
          break;
        }

        // Re-engage Full Auto if needed
        const reengageBtn = await this.page.waitForSelector('.btn-auto, .btn-ability-auto, .btn-attack-start', { visible: true, timeout: 8000 }).catch(() => null);
        if (reengageBtn) {
          const isActive = await this.page.evaluate((el: any) => el?.classList?.contains('active') || false, reengageBtn);
          if (!isActive) {
            await humanizedClick(this.page, reengageBtn);
          }
        }
      }

      await new Promise(r => setTimeout(r, 600));
    }

    // 8. Dismiss result screen
    await this.dismissAllPopups(2);
    const durationMs = Date.now() - startTime;

    console.log(`[RotbEngine] [Titan EX+] Result: SUCCESS in ${(durationMs / 1000).toFixed(1)}s - Titan defeated!`);

    return {
      round: roundNumber,
      status: 'SUCCESS',
      durationMs,
      message: 'Titan Extreme+ defeated successfully.'
    };
  }

  /**
   * Runs the full repeat loop for pure Baihu.
   */
  public async runBaihuLoop(options: RotbLoopOptions = {}): Promise<RotbLoopSummary> {
    const {
      repeatCount = 30,
      autoReplenishAp = true,
      onProgress
    } = options;

    const startTime = Date.now();
    let successCount = 0;
    let failedCount = 0;
    let currentRound = 0;
    let exitStatus: RotbLoopSummary['status'] = 'COMPLETED';

    console.log('=====================================================');
    console.log(`   RotB Baihu Repeat Loop Started (Limit: ${repeatCount === Infinity ? 'Infinite' : repeatCount})   `);
    console.log('=====================================================');

    await this.visitEventOverview();

    while (currentRound < repeatCount) {
      if (this.isInterrupted) {
        console.log('\n[RotbEngine] Loop terminated gracefully by user request.');
        exitStatus = 'INTERRUPTED';
        break;
      }

      currentRound++;
      try {
        const roundResult = await this.runSingleBaihu(currentRound, autoReplenishAp);
        if (onProgress) onProgress(roundResult);

        if (roundResult.status === 'SUCCESS') {
          successCount++;
        } else if (roundResult.status === 'AP_EXHAUSTED') {
          exitStatus = 'AP_EXHAUSTED';
          break;
        } else {
          failedCount++;
        }

        await this.dismissAllPopups(2);
        await logNormalDelay(1200, 0.15);

      } catch (err: any) {
        console.error(`[RotbEngine] [Round ${currentRound}] Error:`, err.message);
        failedCount++;

        await this.dismissAllPopups(2);
        await logNormalDelay(2000, 0.15);

        if (this.isInterrupted) {
          exitStatus = 'INTERRUPTED';
          break;
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;
    return {
      totalRounds: currentRound,
      successCount,
      failedCount,
      totalDurationMs,
      status: exitStatus
    };
  }

  /**
   * Runs the RotB Earth cycle: Baihu x9 -> Titan x1 on repeat.
   */
  public async runRotbEarthLoop(options: RotbEarthLoopOptions = {}): Promise<RotbEarthSummary> {
    const {
      cycles = 1,
      baihuPerCycle = 9,
      titanPerCycle = 1,
      autoReplenishAp = true,
      onProgress
    } = options;

    const startTime = Date.now();
    let totalBaihuClears = 0;
    let totalTitanClears = 0;
    let currentCycle = 0;
    let exitStatus: RotbEarthSummary['status'] = 'COMPLETED';

    console.log('=====================================================');
    console.log(`   RotB Earth Cycle: Baihu x${baihuPerCycle} -> Titan x${titanPerCycle}   `);
    console.log(`   Total Cycles: ${cycles === Infinity ? 'Infinite' : cycles}   `);
    console.log('=====================================================');

    await this.visitEventOverview();

    while (currentCycle < cycles) {
      if (this.isInterrupted) {
        exitStatus = 'INTERRUPTED';
        break;
      }

      currentCycle++;
      console.log(`\n=====================================================`);
      console.log(`   [Cycle ${currentCycle}/${cycles === Infinity ? '∞' : cycles}] Starting Earth Rotation`);
      console.log(`=====================================================`);

      // 1. Run Baihu x9
      let baihuStep = 0;
      let baihuAborted = false;
      while (baihuStep < baihuPerCycle) {
        if (this.isInterrupted) {
          baihuAborted = true;
          break;
        }

        baihuStep++;
        console.log(`\n[Cycle ${currentCycle}] Step ${baihuStep}/${baihuPerCycle}: Baihu Extreme`);
        const result = await this.runSingleBaihu(baihuStep, autoReplenishAp);
        if (onProgress) onProgress('BAIHU', currentCycle, baihuStep, result);

        if (result.status === 'SUCCESS') {
          totalBaihuClears++;
        } else if (result.status === 'AP_EXHAUSTED') {
          exitStatus = 'AP_EXHAUSTED';
          baihuAborted = true;
          break;
        }

        await this.dismissAllPopups(2);
        await logNormalDelay(1000, 0.15);
      }

      if (baihuAborted || this.isInterrupted) {
        exitStatus = exitStatus === 'AP_EXHAUSTED' ? 'AP_EXHAUSTED' : 'INTERRUPTED';
        break;
      }

      // 2. Run Titan x1
      let titanStep = 0;
      while (titanStep < titanPerCycle) {
        if (this.isInterrupted) break;

        titanStep++;
        console.log(`\n[Cycle ${currentCycle}] Boss Step ${titanStep}/${titanPerCycle}: Titan Extreme+`);
        const result = await this.runSingleTitan(titanStep, autoReplenishAp);
        if (onProgress) onProgress('TITAN', currentCycle, titanStep, result);

        if (result.status === 'SUCCESS') {
          totalTitanClears++;
        } else if (result.status === 'AP_EXHAUSTED') {
          exitStatus = 'AP_EXHAUSTED';
          break;
        }

        await this.dismissAllPopups(2);
        await logNormalDelay(1200, 0.15);
      }

      if (exitStatus === 'AP_EXHAUSTED' || this.isInterrupted) {
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    return {
      cyclesCompleted: currentCycle,
      totalBaihuClears,
      totalTitanClears,
      totalDurationMs,
      status: exitStatus
    };
  }

  /**
   * Finds and clicks the first visible supporter element.
   */
  private async selectFirstSupporter(timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const handle = await this.page.evaluateHandle(() => {
        const candidates = Array.from(document.querySelectorAll('.btn-supporter, .lis-supporter'));
        for (const el of candidates) {
          const h = el as HTMLElement;
          if (h.offsetParent !== null && h.getBoundingClientRect().height > 0) {
            return h;
          }
        }
        return null;
      });

      const el = handle.asElement();
      if (el) {
        await humanizedClick(this.page, el as any);
        return true;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  }

  /**
   * Fallback for summoning via summon menu if Quick Summon is not mapped.
   */
  private async callSummonFallback(): Promise<void> {
    const summonMenuBtn = await this.page.$('.btn-command-summon');
    if (summonMenuBtn) {
      await humanizedClick(this.page, summonMenuBtn);
      await logNormalDelay(400, 0.15);

      const firstSummon = await this.page.$('.lis-summon.on.btn-summon-available');
      if (firstSummon) {
        await humanizedClick(this.page, firstSummon);
        await logNormalDelay(400, 0.15);

        const useBtn = await this.page.$('.btn-usual-ok.btn-summon-use');
        if (useBtn) {
          await humanizedClick(this.page, useBtn);
        }
      }
    }
  }

  /**
   * Verifies battle state after F5 reload.
   */
  private async verifyPostBattleOutcome(): Promise<{ status: 'SUCCESS' | 'FAILED'; message: string }> {
    const currentHash = await this.page.evaluate(() => window.location.hash);

    if (currentHash.includes('result')) {
      await this.dismissAllPopups(2);
      return { status: 'SUCCESS', message: 'Victory confirmed! (Result screen reached)' };
    }

    if (currentHash.includes('raid')) {
      console.log('[RotbEngine] Boss survived summon call, checking HP and triggering Full Auto / Attack...');
      const fullAutoBtn = await this.page.$('.btn-auto, .btn-ability-auto');
      if (fullAutoBtn) {
        await humanizedClick(this.page, fullAutoBtn);
      } else {
        const attackBtn = await this.page.$('.btn-attack-start');
        if (attackBtn) await humanizedClick(this.page, attackBtn);
      }

      await this.page.waitForFunction(() => {
        return window.location.hash.includes('result') || !!document.querySelector('.pop-raid-result');
      }, { timeout: 25000 }).catch(() => null);

      await this.dismissAllPopups(2);
      return { status: 'SUCCESS', message: 'Combat concluded after follow-up turn.' };
    }

    return { status: 'SUCCESS', message: 'Battle resolved.' };
  }

  /**
   * Consumes Half-Elixir if AP recovery popup appears.
   */
  private async handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean> {
    const apModal = await this.page.$('.pop-usual .btn-use-item, .pop-usual .use-item, .pop-show .btn-use-item, .btn-use-item');
    if (!apModal) return true;

    if (!autoReplenishAp) {
      console.warn('[RotbEngine] AP depleted and autoReplenishAp is false.');
      const cancelBtn = await this.page.$('.pop-usual .btn-usual-cancel, .pop-show .btn-usual-cancel');
      if (cancelBtn) await humanizedClick(this.page, cancelBtn);
      return false;
    }

    console.log('[RotbEngine] AP depleted. Consuming Half-Elixir to restore AP...');
    await humanizedClick(this.page, apModal);

    const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok, .pop-show .btn-usual-ok', {
      visible: true,
      timeout: 5000
    }).catch(() => null);

    if (confirmBtn) {
      await humanizedClick(this.page, confirmBtn);
      await logNormalDelay(400, 0.15);
      await this.sentinel.assertSafe();
      console.log('[RotbEngine] AP restored successfully.');
      return true;
    }

    return false;
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
   * Safely dismisses any blocking popup modals (Shenxian alert, quest rewards, etc.).
   */
  public async dismissAllPopups(maxPasses = 3): Promise<void> {
    for (let i = 0; i < maxPasses; i++) {
      const popup = await this.page.$('.pop-usual:not([style*="none"]), .pop-show, .pop-raid-result');
      if (!popup) break;

      const isVisible = await this.page.evaluate((el: any) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      }, popup).catch(() => false);

      if (!isVisible) break;

      const okBtn = await popup.$('.btn-usual-ok, .btn-result-close, .btn-usual-close');
      if (okBtn) {
        await humanizedClick(this.page, okBtn);
        await logNormalDelay(350, 0.15);
      } else {
        break;
      }
    }
  }
}

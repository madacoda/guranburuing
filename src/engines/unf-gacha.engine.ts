import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { logNormalDelay } from '../human-motor.js';

export interface UnfGachaProgress {
  cycle: number;
  boxNumber: string;
  tokensRemaining: number | null;
  boxesCleared: number;
  status: 'DRAWING' | 'RESETTING' | 'COMPLETED' | 'FAILED';
  message: string;
}

export interface UnfGachaSummary {
  eventId: string;
  initialTokens: number | null;
  finalTokens: number | null;
  tokensSpent: number;
  boxesCleared: number;
  totalDurationMs: number;
  status: 'COMPLETED' | 'STOPPED' | 'DEPLETED' | 'FAILED';
}

export class UnfGachaEngine {
  private stopRequested = false;

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Clears Unite & Fight (Guild Wars) token drawboxes in an automated loop:
   * 1. Click "Draw 1 Drawbox"
   * 2. Wait and tap screen to skip crystal animation
   * 3. Reload page to bypass loot roll
   * 4. Click Drawbox Reset
   * 5. Confirm modal
   * 6. Reload and repeat until tokens are depleted or maxBoxes reached.
   */
  public async clearTokens(options?: {
    eventId?: string;
    maxBoxes?: number;
    onProgress?: (p: UnfGachaProgress) => void;
  }): Promise<UnfGachaSummary> {
    const eventId = options?.eventId || 'teamraid084';
    const maxBoxes = options?.maxBoxes ?? 200;
    const gachaUrl = `https://game.granbluefantasy.jp/#event/${eventId}/gacha/index`;

    const startTime = Date.now();
    let initialTokens: number | null = null;
    let finalTokens: number | null = null;
    let boxesCleared = 0;
    let cycle = 0;

    console.log(`[UnfGachaEngine] ========================================`);
    console.log(`[UnfGachaEngine] 🏆 Starting UNF Token Drawbox Clearer`);
    console.log(`[UnfGachaEngine] URL: ${gachaUrl} | Max Boxes: ${maxBoxes}`);
    console.log(`[UnfGachaEngine] ========================================`);

    while (boxesCleared < maxBoxes) {
      if (this.stopRequested) break;
      await this.sentinel.assertSafe();

      cycle++;

      // 1. Ensure on gacha index page
      if (!this.page.url().includes('gacha/index')) {
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
        const boxMatch = text.match(/Drawbox\s*#(\d+)/i);
        const tokenMatch = text.match(/(\d+)\s+Use\s+\d+\s+tokens/i) || text.match(/Token Draw\s+(\d+)/i) || text.match(/(\d+)\s+tokens/i);

        const drawBoxBtn = document.querySelector('.btn-bulk-play-box') as HTMLElement;
        const resetBtn = document.querySelector('.btn-reset') as HTMLElement;

        const dRect = drawBoxBtn && drawBoxBtn.offsetParent !== null ? drawBoxBtn.getBoundingClientRect() : null;
        const rRect = resetBtn && resetBtn.offsetParent !== null ? resetBtn.getBoundingClientRect() : null;

        return {
          boxNum: boxMatch ? boxMatch[1] : 'Unknown',
          tokenCount: tokenMatch ? parseInt(tokenMatch[1], 10) : null,
          canDrawBox: !!dRect && dRect.width > 0,
          drawBtnCoord: dRect ? { x: dRect.x + dRect.width / 2, y: dRect.y + dRect.height / 2 } : null,
          canReset: !!rRect && rRect.width > 0,
          resetBtnCoord: rRect ? { x: rRect.x + rRect.width / 2, y: rRect.y + rRect.height / 2 } : null
        };
      });

      if (initialTokens === null && state.tokenCount !== null) {
        initialTokens = state.tokenCount;
      }
      if (state.tokenCount !== null) {
        finalTokens = state.tokenCount;
      }

      console.log(`\n[UnfGachaEngine] [Cycle #${cycle}] Box #${state.boxNum} | Tokens: ${state.tokenCount ?? 'Unknown'}`);
      console.log(`   Actions Available -> Draw 1 Drawbox: ${state.canDrawBox} | Reset: ${state.canReset}`);

      // Case A: Reset button is already available (target item pulled or box empty)
      if (state.canReset) {
        console.log('[UnfGachaEngine] ✨ Box is already ready to reset! Resetting...');
        const resetOk = await this.executeBoxReset();
        if (resetOk) {
          boxesCleared++;
          options?.onProgress?.({
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
      if (state.canDrawBox && state.drawBtnCoord) {
        console.log('[UnfGachaEngine] 🎁 Tapping "Draw 1 Drawbox"...');
        await this.page.touchscreen.tap(state.drawBtnCoord.x, state.drawBtnCoord.y);

        // Dismiss instant confirmation modal if present
        await logNormalDelay(600, 0.15);
        await this.page.evaluate(() => {
          const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            ok.click();
          }
        }).catch(() => null);

        // Wait for crystal/TAP screen
        console.log('[UnfGachaEngine] Awaiting draw animation crystal...');
        await logNormalDelay(1800, 0.1);

        // Tap screen to skip crystal
        console.log('[UnfGachaEngine] Tapping screen to skip crystal...');
        await this.page.touchscreen.tap(240, 360).catch(() => null);

        // Reload to skip loot roll and return to gacha index
        console.log('[UnfGachaEngine] Reloading to skip loot roll...');
        await this.page.evaluate((destUrl) => {
          const hash = destUrl.substring(destUrl.indexOf('#'));
          window.location.hash = hash;
        }, gachaUrl);
        await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
        await logNormalDelay(2000, 0.2);

        // Check if reset button is now available
        const resetAfterDraw = await this.executeBoxReset();
        if (resetAfterDraw) {
          boxesCleared++;
          console.log(`[UnfGachaEngine] ✅ Box #${state.boxNum} cleared and reset! (Total cleared: ${boxesCleared})`);
          options?.onProgress?.({
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
        console.log('[UnfGachaEngine] 🏁 Tokens fully depleted! Stopping.');
        break;
      }

      // If drawbox button missing but has tokens, wait once or check if out of boxes
      console.log('[UnfGachaEngine] ⚠️ No Draw 1 Drawbox or Reset button found. Retrying page load once...');
      await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
      await logNormalDelay(2500, 0.2);

      const retryAvailable = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-bulk-play-box, .btn-reset');
      });
      if (!retryAvailable) {
        console.log('[UnfGachaEngine] No drawbox actions available after retry. Stopping.');
        break;
      }
    }

    const totalDurationMs = Date.now() - startTime;
    const tokensSpent = (initialTokens !== null && finalTokens !== null) ? Math.max(0, initialTokens - finalTokens) : 0;

    console.log(`\n[UnfGachaEngine] ========================================`);
    console.log(`[UnfGachaEngine] 🎉 UNF Token Drawbox Clearing Finished!`);
    console.log(`[UnfGachaEngine] Boxes Cleared: ${boxesCleared}`);
    console.log(`[UnfGachaEngine] Tokens Spent:  ${tokensSpent.toLocaleString()} (Remaining: ${finalTokens?.toLocaleString() ?? 'Unknown'})`);
    console.log(`[UnfGachaEngine] Duration:      ${(totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`[UnfGachaEngine] ========================================`);

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
   * Detects, scrolls to, taps, and confirms the Reset Drawbox modal.
   */
  private async executeBoxReset(): Promise<boolean> {
    // 1. Scroll reset button into view
    await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-reset') as HTMLElement;
      if (btn) btn.scrollIntoView({ behavior: 'instant', block: 'center' });
    }).catch(() => null);
    await logNormalDelay(350, 0.15);

    // 2. Get coordinates
    const resetCoord = await this.page.evaluate(() => {
      const btn = document.querySelector('.btn-reset') as HTMLElement;
      if (!btn || btn.offsetParent === null) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).catch(() => null);

    if (!resetCoord) return false;

    // 3. Tap Reset button
    console.log('[UnfGachaEngine] Tapping "Reset Drawbox" button...');
    await this.page.touchscreen.tap(resetCoord.x, resetCoord.y);
    await logNormalDelay(1000, 0.15);

    // 4. Confirm modal
    const modalCoord = await this.page.evaluate(() => {
      const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok, .btn-reset-confirm') as HTMLElement;
      if (ok && ok.offsetParent !== null) {
        const r = ok.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    }).catch(() => null);

    if (modalCoord) {
      console.log('[UnfGachaEngine] Confirming Reset Drawbox modal...');
      await this.page.touchscreen.tap(modalCoord.x, modalCoord.y);
      await logNormalDelay(1200, 0.15);
    }

    // 5. Reload to mount fresh next drawbox
    console.log('[UnfGachaEngine] Reloading to mount next drawbox...');
    await this.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
    await logNormalDelay(2000, 0.2);

    return true;
  }
}

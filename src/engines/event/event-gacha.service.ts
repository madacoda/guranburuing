// src/engines/event/event-gacha.service.ts
import { logNormalDelay } from '../../human-motor.js';
import { EventEngineHost, EventTokenGachaProgress, EventTokenGachaSummary } from './event.types.js';

export class EventGachaService {
  constructor(private readonly host: EventEngineHost) {}

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
    const eventInfo = await this.host.resolveEventInfo(eventIdExplicit);
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
      if (this.host.isStopRequested) break;
      await this.host.sentinel.assertSafe();

      cycle++;

      // 1. Ensure on gacha page
      if (!this.host.page.url().includes('gacha') || this.host.page.url().includes('action')) {
        console.log(`[EventEngine] Navigating to token draw: ${gachaUrl}...`);
        await this.host.page.evaluate((targetUrl) => {
          const hash = targetUrl.substring(targetUrl.indexOf('#'));
          window.location.hash = hash;
        }, gachaUrl);
        await this.host.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
        await logNormalDelay(1500, 0.2);
      }

      // Wait for loading mask to clear
      for (let i = 0; i < 20; i++) {
        const hasMask = await this.host.page.evaluate(() => !!document.querySelector('#loading.show, .mask.show'));
        if (!hasMask) break;
        await new Promise(r => setTimeout(r, 250));
      }

      // 2. Read current box and token state
      const state = await this.host.page.evaluate(() => {
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
        const drawClicked = await this.host.page.evaluate(() => {
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
          await this.host.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
          await logNormalDelay(1500, 0.2);
          continue;
        }

        // Dismiss instant confirmation modal if present
        await logNormalDelay(600, 0.15);
        await this.host.page.evaluate(() => {
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
        await this.host.page.touchscreen.tap(240, 360).catch(() => null);
        await logNormalDelay(500, 0.1);

        // Fast-skip: Reload immediately to skip loot roll and return to gacha index
        console.log('[EventEngine] Reloading to skip loot roll...');
        await this.host.page.evaluate((destUrl) => {
          const hash = destUrl.substring(destUrl.indexOf('#'));
          window.location.hash = hash;
        }, gachaUrl);
        await this.host.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
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
      await this.host.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
      await logNormalDelay(2500, 0.2);

      const retryAvailable = await this.host.page.evaluate(() => {
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
      status: this.host.isStopRequested ? 'STOPPED' : (finalTokens !== null && finalTokens < 2 ? 'DEPLETED' : 'COMPLETED')
    };
  }

  /**
   * Detects, scrolls to, clicks, and confirms the Reset Drawbox modal for events.
   */
  public async executeEventBoxReset(eventId: string): Promise<boolean> {
    const eventInfo = await this.host.resolveEventInfo(eventId);
    const gachaUrl = `https://game.granbluefantasy.jp/#${eventInfo.route}/gacha`;

    // 1. Check if reset button is available
    const hasReset = await this.host.page.evaluate(() => {
      const btn = document.querySelector('.btn-reset') as HTMLElement;
      return !!btn && btn.offsetParent !== null && !btn.classList.contains('disable');
    });

    if (!hasReset) return false;

    console.log('[EventEngine] Tapping "Reset Drawbox" button...');
    await this.host.page.evaluate(() => {
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
    const confirmed = await this.host.page.evaluate(() => {
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
    await this.host.page.evaluate((destUrl) => {
      const hash = destUrl.substring(destUrl.indexOf('#'));
      window.location.hash = hash;
    }, gachaUrl);
    await this.host.page.reload({ waitUntil: 'networkidle2' }).catch(() => null);
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
}

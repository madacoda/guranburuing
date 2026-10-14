// src/engines/event/event-nightmare.service.ts
import { logNormalDelay } from '../../human-motor.js';
import { EventEngineHost } from './event.types.js';

export class EventNightmareService {
  constructor(private readonly host: EventEngineHost) {}

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
    const eventInfo = await this.host.resolveEventInfo(eventIdExplicit);
    console.log('\n========================================================================');
    console.log(`      ⚡ Granblue Fantasy - Nightmare (HELL) Solo Skip Looper           `);
    console.log(`      Event: ${eventInfo.name} | Max Batches: ${maxBatches}        `);
    console.log('========================================================================\n');

    if (eventInfo.type === 'biography') {
      const summary = await this.host.runClearCollaborationQuests({
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

    while (batchesCleared < maxBatches && !this.host.isStopRequested) {
      await this.host.sentinel.assertSafe();

      // 1. Ensure on event page
      const currentUrl = this.host.page.url();
      if (!currentUrl.includes(eventInfo.name)) {
        console.log(`[EventEngine] Navigating to event page #${eventInfo.route}...`);
        await this.host.safeNavigate(eventInfo.url);
        await logNormalDelay(1500, 0.2);
      }

      // 2. Scan for Nightmare (HELL) quest card on event page (with polling for view render)
      console.log(`[EventEngine] [Batch #${batchesCleared + 1}] Scanning for Nightmare (HELL) banner...`);
      let hellState = { hasHell: false, remainCount: 0, availableCount: 0, canSkip: false };

      const scanStart = Date.now();
      while (Date.now() - scanStart < 12000 && !this.host.isStopRequested) {
        hellState = await this.host.page.evaluate(() => {
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
        const curHash = await this.host.page.evaluate(() => window.location.hash || '');
        if (curHash.includes('result') || curHash.includes('supporter')) {
          await this.host.dismissPopupsAndResults();
          await this.host.safeNavigate(eventInfo.url);
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
      const clickedCard = await this.host.page.evaluate(() => {
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
        modalReady = await this.host.page.evaluate(() => {
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
      const setupResult = await this.host.page.evaluate(() => {
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
      const clickedClaim = await this.host.page.evaluate(() => {
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
        partyScreenReady = await this.host.page.evaluate(() => {
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
      await this.host.page.evaluate(() => {
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
        resultReady = await this.host.page.evaluate(() => {
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
      await this.host.page.evaluate(() => {
        const nextBtn = document.querySelector('.btn-control[data-status="ok"], .btn-control, .btn-usual-ok') as HTMLElement;
        if (nextBtn && nextBtn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(nextBtn).trigger('tap');
          nextBtn.click();
        }
      }).catch(() => null);

      await logNormalDelay(600, 0.2);
      await this.host.dismissPopupsAndResults();
      await this.host.safeNavigate(eventInfo.url);
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
}

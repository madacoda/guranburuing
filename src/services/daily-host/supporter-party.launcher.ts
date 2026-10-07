// src/services/daily-host/supporter-party.launcher.ts
import { Page } from 'puppeteer-core';
import { ISupporterPartyLauncher } from '../../domain/daily-host/daily-host.interfaces.js';
import { UniversalWorkflowEngine } from '../../engines/universal-workflow.engine.js';
import { logNormalDelay } from '../../human-motor.js';

export class SupporterPartyLauncher implements ISupporterPartyLauncher {
  private page: Page;
  private workflow: UniversalWorkflowEngine;
  private stopRequested = false;

  constructor(page: Page, workflow: UniversalWorkflowEngine) {
    this.page = page;
    this.workflow = workflow;
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  public requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Handles Supporter Summon Selection (#quest/supporter/...) with Half-Elixir AP restoration.
   */
  public async selectSupporterSummon(priorities?: string[]): Promise<boolean> {
    const t0 = Date.now();
    const maxWaitMs = 12000;
    const targetPriorities = priorities || [
      'Hades', 'Bahamut', 'Lucifer', 'Zeus', 'Agni', 'Varuna', 'Titan', 'Zephyrus', 'Kaguya'
    ];

    while (Date.now() - t0 < maxWaitMs) {
      if (this.stopRequested) return false;

      // Handle AP recovery modal if present
      await (this.workflow as any).handleApRecoveryModal();

      // Check if blocked by in-progress raid popup
      const isBlocked = await this.page.evaluate(() => {
        const pop = document.querySelector('.popRestartQuest, #pop.popup-view-root, .pop-usual.pop-show') as HTMLElement;
        return pop && (pop.innerText.includes('in progress') || pop.innerText.includes('Resume Quests'));
      }).catch(() => false);
      if (isBlocked) return false;

      // Check if on supporter screen
      const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (currentHash.includes('supporter')) {
        const selected = await (this.workflow as any).selectSupporterCard(targetPriorities);
        if (selected) {
          console.log('[DailyHost:Launch] ✅ Supporter summon selected.');
          await logNormalDelay(800, 0.15);
          return true;
        }
      }

      // Check if already advanced to party screen, battle, or stage loading
      if (
        currentHash.includes('party') ||
        currentHash.includes('raid') ||
        currentHash.includes('stage') ||
        currentHash.includes('battle')
      ) {
        return true;
      }

      await logNormalDelay(400, 0.1);
    }

    console.warn('[DailyHost:Launch] Timed out waiting for Supporter Summon screen.');
    return false;
  }

  /**
   * Confirms party deck, acknowledges Ascendant Prayer if present, and clicks Quest Start.
   */
  public async confirmPartyAndLaunchQuest(): Promise<boolean> {
    const t0 = Date.now();
    const maxWaitMs = 15000;

    while (Date.now() - t0 < maxWaitMs) {
      if (this.stopRequested) return false;

      // Check if battle already mounted or stage transitioning
      const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (/^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHash)) {
        return true;
      }

      if (curHash.includes('stage') || curHash.includes('raid')) {
        const mounted = await (this.workflow as any).waitForBattleToMount(12000);
        if (mounted) return true;
      }

      // Handle AP recovery modal if present
      await (this.workflow as any).handleApRecoveryModal();

      // Check in-progress raid popup if present
      const isBlocked = await this.page.evaluate(() => {
        const pop = document.querySelector('.popRestartQuest, #pop.popup-view-root, .pop-usual.pop-show') as HTMLElement;
        return pop && (pop.innerText.includes('in progress') || pop.innerText.includes('Resume Quests'));
      }).catch(() => false);
      if (isBlocked) {
        return false;
      }

      // Handle Ascendant Prayer popup if present (.pop-ascendant-prayer-confirm)
      const prayerHandled = await this.page.evaluate(() => {
        const prayerOk = document.querySelector('.pop-ascendant-prayer-confirm .btn-usual-ok') as HTMLElement;
        if (prayerOk && prayerOk.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(prayerOk).trigger('tap');
          prayerOk.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (prayerHandled) {
        console.log('[DailyHost:Launch] Ascendant prayer confirmation acknowledged.');
        await logNormalDelay(600, 0.15);
      }

      // Priority 1: Slide-up deck drawer on supporter screen (.prt-btn-deck .btn-usual-ok.se-quest-start)
      // Priority 2: Standard quest start button on party page (.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle)
      const startClicked = await this.page.evaluate(() => {
        const startBtn = document.querySelector(
          '.prt-btn-deck .btn-usual-ok.se-quest-start, .pop-deck .btn-usual-ok.se-quest-start, .prt-btn-deck .btn-usual-ok, .pop-deck .btn-usual-ok, .btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok.btn-settle'
        ) as HTMLElement;
        if (startBtn && startBtn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(startBtn).trigger('tap');
          startBtn.click();
          return true;
        }
        return false;
      }).catch(() => false);

      if (startClicked) {
        console.log('[DailyHost:Launch] Quest Start confirmed. Waiting for battle to mount...');
        const mounted = await (this.workflow as any).waitForBattleToMount(12000);
        if (mounted) return true;
      }

      await logNormalDelay(400, 0.1);
    }

    return false;
  }
}

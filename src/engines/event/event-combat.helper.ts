// src/engines/event/event-combat.helper.ts
import { logNormalDelay, humanizedClick } from '../../human-motor.js';
import { EventEngineHost, ResolvedEventInfo } from './event.types.js';

export class EventCombatHelper {
  constructor(private readonly host: EventEngineHost) {}

  public async ensureViewportAndMobile(): Promise<void> {
    try {
      await this.host.page.setViewport({
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
        const curr = this.host.page.url();
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

    const currentUrl = this.host.page.url();
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
    const info = await this.host.resolveEventInfo(explicitId);
    return info.id;
  }

  /**
   * Returns true only if actively in a combat raid (#raid/...), not merely on a treasureraid event page.
   */
  public isCombatRaidActive(): boolean {
    const hash = (this.host.page.url().split('#')[1] || '').toLowerCase();
    return hash.startsWith('raid') || hash.includes('/raid/');
  }

  /**
   * Returns true if actively inside a story cutscene player (#quest/scene/...).
   */
  public isCutsceneActive(): boolean {
    const hash = (this.host.page.url().split('#')[1] || '').toLowerCase();
    return hash.startsWith('quest/scene') || hash.includes('/scene/');
  }

  /**
   * Activates Full Auto in battle via touchscreen coordinates and DOM trigger.
   */
  public async activateFullAuto(): Promise<void> {
    try {
      const autoBtn = await this.host.page.$('.btn-auto, .btn-ability-auto');
      if (autoBtn) {
        const isAutoActive = await this.host.page.evaluate((el: any) => el?.classList?.contains('active') || false, autoBtn).catch(() => false);
        if (!isAutoActive) {
          await humanizedClick(this.host.page, autoBtn).catch(() => null);
        }
      }

      // Also trigger attack button if attack is available and active
      const atkBtn = await this.host.page.$('.btn-attack-start.display-on, .btn-attack.display-on, .btn-attack-start:not(.display-off)');
      if (atkBtn) {
        await humanizedClick(this.host.page, atkBtn).catch(() => null);
      }
    } catch {}
  }

  /**
   * Selects the first visible supporter summon across elemental containers.
   */
  public async selectFirstSupporter(timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.host.isStopRequested) return false;

      const coords = await this.host.page.evaluate(() => {
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
        await this.host.page.touchscreen.tap(coords.x, coords.y).catch(() => null);
        return true;
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return false;
  }

  /**
   * Consumes Half-Elixir if AP recovery popup appears.
   */
  public async handleApRecoveryIfPresent(autoReplenishAp: boolean): Promise<boolean> {
    const apModal = await this.host.page.$('.pop-usual .btn-use-item, .pop-usual .use-item, .pop-show .btn-use-item, .btn-use-item').catch(() => null);
    if (!apModal) return true;

    if (!autoReplenishAp) {
      console.warn('[EventEngine] AP depleted and autoReplenishAp is false.');
      return false;
    }

    console.log('[EventEngine] AP depleted. Consuming Half-Elixir to restore AP...');
    await this.host.page.evaluate(() => {
      const itemBtn = document.querySelector('.pop-usual .btn-use-item, .pop-show .btn-use-item, .btn-use-item') as HTMLElement;
      if (itemBtn) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(itemBtn).trigger('tap');
        itemBtn.click();
      }
    }).catch(() => null);

    await logNormalDelay(400, 0.15);

    await this.host.page.evaluate(() => {
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
      await this.host.sentinel.assertSafe();

      const dismissed = await this.host.page.evaluate(() => {
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
        await this.host.page.touchscreen.tap(dismissed.x, dismissed.y).catch(() => null);
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
  public async safeNavigate(targetUrl: string): Promise<void> {
    const hash = targetUrl.includes('#') ? targetUrl.substring(targetUrl.indexOf('#')) : '';
    const route = hash.replace(/^#/, '');
    console.log(`[EventEngine] Navigating to: ${targetUrl}...`);

    // Ensure GBF core runtime is ready before changing hash
    await this.host.page.evaluate(() => {
      return (window as any).Game || document.querySelector('.cnt-mypage, .prt-header, #ready, .prt-user-info') !== null;
    }).catch(() => false);

    // Try Backbone navigate first (cleanest route change in GBF)
    await this.host.page.evaluate((r: string, h: string) => {
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
      routeApplied = await this.host.page.evaluate((targetRoute: string) => {
        const currentHash = window.location.hash.replace(/^#/, '');
        return currentHash.includes(targetRoute) || ((window as any).Backbone?.history?.fragment || '').includes(targetRoute);
      }, route).catch(() => false);
      if (routeApplied) break;
      await new Promise(r => setTimeout(r, 300));
    }

    // Fallback if hash did not switch (e.g. Backbone router frozen)
    if (!routeApplied && !this.host.page.url().includes(route)) {
      console.log(`[EventEngine] Route transition pending, loading URL via page.goto...`);
      await this.host.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => null);
    }

    // Wait for event DOM or quest container to mount (note: do NOT check .pop-usual as it is statically present everywhere)
    const tMount = Date.now();
    while (Date.now() - tMount < 10000) {
      const ready = await this.host.page.evaluate(() => {
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
  public async waitForBattleStart(timeoutMs = 30000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.host.isStopRequested) return false;
      await this.host.sentinel.assertSafe();

      if (this.host.isCombatRaidActive() || this.host.isCutsceneActive()) {
        return true;
      }

      const hasAuto = await this.host.page.evaluate(() => {
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
  public async waitForBattleEnd(timeoutMs = 180000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.host.isStopRequested) return false;
      await this.host.sentinel.assertSafe();

      const url = this.host.page.url();
      if (url.includes('result')) {
        return true;
      }

      const stageStatus = await this.host.page.evaluate(() => {
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
        await this.host.page.reload().catch(() => null);
        await new Promise(r => setTimeout(r, 2500));
        return true;
      }

      // If attack button ready and not currently attacking, tap Attack / engage auto
      if (stageStatus?.canAttack && !stageStatus?.attacking) {
        const atkBtn = await this.host.page.$('.btn-attack-start:not(.display-off)');
        if (atkBtn) {
          const box = await atkBtn.boundingBox();
          if (box && box.width > 0) {
            await this.host.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          }
        }
      }

      // Keep full auto active if it turned off somehow
      await this.host.activateFullAuto();

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
    if (!this.host.page.url().includes('supporter')) {
      if (targetIdOrType === 'maniac') {
        await this.host.page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll('.btn-quest-list'));
          const maniac = cards.find(c => (c as HTMLElement).innerText.includes('Maniac') || (c as HTMLElement).dataset.questName?.includes('Maniac')) as HTMLElement;
          if (maniac) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(maniac).trigger('tap');
            maniac.click();
          }
        }).catch(() => null);
      } else if (targetIdOrType === 'nightmare') {
        await this.host.page.evaluate(() => {
          const hellBtn = document.querySelector('.btn-hell, .prt-hell-quest, [data-quest-id*="hell"]') as HTMLElement;
          if (hellBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(hellBtn).trigger('tap');
            hellBtn.click();
          }
        }).catch(() => null);
      } else {
        await this.host.clickCurrentStoryCard();
      }
    }

    await logNormalDelay(1200, 0.2);

    // Supporter summon selection
    const supporterSelected = await this.host.selectFirstSupporter();
    if (!supporterSelected) {
      console.warn('[EventEngine] Could not select supporter summon.');
    }
    await logNormalDelay(800, 0.15);

    // Check AP replenishment
    const apOk = await this.host.handleApRecoveryIfPresent(autoReplenishAp);
    if (!apOk) {
      console.warn('[EventEngine] Aborting combat episode due to insufficient AP.');
      return false;
    }

    // Start battle button
    await this.host.page.evaluate(() => {
      const ok = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok') as HTMLElement;
      if (ok && ok.offsetParent !== null) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(ok).trigger('tap');
        ok.click();
      }
    }).catch(() => null);

    // Wait for combat scene / raid and enable Full Auto
    console.log('[EventEngine] Waiting for combat raid UI to mount...');
    const inBattle = await this.host.waitForBattleStart(30000);
    if (!inBattle) {
      console.warn('[EventEngine] Timed out waiting for battle to start.');
      return false;
    }

    console.log('[EventEngine] Activating Full Auto...');
    await this.host.activateFullAuto();

    // Await victory / completion
    console.log('[EventEngine] Full Auto engaged. Awaiting victory...');
    const victory = await this.host.waitForBattleEnd(180000);
    if (!victory) {
      console.warn('[EventEngine] Battle did not complete within timeout.');
      return false;
    }

    // Dismiss popups and rewards
    await this.host.dismissPopupsAndResults();
    return true;
  }
}

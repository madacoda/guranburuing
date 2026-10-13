// src/engines/universal/combat-resolution.service.ts
import { HTTPResponse, Page } from 'puppeteer-core';
import { humanizedClick, logNormalDelay, sampleGaussian, getSpeedProfile } from '../../human-motor.js';
import { UniversalContext } from './types.js';
import { config } from '../../config.js';

/**
 * Service orchestrating combat readiness, turn polling, honors synchronization,
 * loot inspection, and result screen confirmation.
 * Adheres to SRP: Exclusively handles combat lifecycle state & battle outcome resolution.
 */
export class CombatResolutionService {
  constructor(private ctx: UniversalContext) {}

  public get page(): Page {
    return this.ctx.page;
  }

  public async syncCurrentHonors(): Promise<number> {
    try {
      const result = await this.page.evaluate((cachedId, accountName) => {
        const stage = (window as any).stage;
        const pJsn = stage?.pJsnData;
        let detectedUserId = cachedId || '';

        // 1. Authoritative: multi_raid_member_info from stage.pJsnData
        if (pJsn?.multi_raid_member_info && Array.isArray(pJsn.multi_raid_member_info)) {
          const myId = String(cachedId || pJsn.user_id || (window as any).Game?.userId || '');
          const me = pJsn.multi_raid_member_info.find((m: any) => 
            (myId && String(m.user_id) === myId) || 
            (accountName && (m.nickname === accountName || m.name === accountName)) ||
            (m.is_host && pJsn.is_host)
          );
          if (me) {
            if (me.user_id) detectedUserId = String(me.user_id);
            if (me.point !== undefined) {
              const pt = parseInt(String(me.point).replace(/,/g, ''), 10);
              if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
            }
          }
        }

        if (pJsn?.user_id) detectedUserId = String(pJsn.user_id);

        // 2. Direct server user_point from stage.pJsnData
        if (pJsn?.user_point !== undefined) {
          const pt = parseInt(String(pJsn.user_point).replace(/,/g, ''), 10);
          if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
        }

        // 3. Direct server point_info from stage.pJsnData
        if (pJsn?.point_info?.user_point !== undefined) {
          const pt = parseInt(String(pJsn.point_info.user_point).replace(/,/g, ''), 10);
          if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
        }

        // 4. stage.gGameStatus.player.point
        if (stage?.gGameStatus?.player?.point !== undefined) {
          const pt = parseInt(String(stage.gGameStatus.player.point).replace(/,/g, ''), 10);
          if (!isNaN(pt) && pt > 0) return { score: pt, userId: detectedUserId };
        }

        // 5. In raid & result DOM elements
        const pointEls = Array.from(document.querySelectorAll('.txt-user-point, .prt-user-point, .txt-point, .prt-point, .prt-point-info .txt-point, .lis-user.user-me .txt-point'));
        for (const el of pointEls) {
          const text = (el as HTMLElement).innerText || '';
          const match = text.match(/(?:honors|貢献度|point)?\s*[:：]?\s*([0-9,]+)\s*(?:pt)?/i);
          if (match && match[1]) {
            const num = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(num) && num > 0) return { score: num, userId: detectedUserId };
          }
        }

        // 6. Look for raid info displaying honors / points (e.g. "... pt")
        const isResultPage = window.location.hash.includes('result');
        const selector = isResultPage
          ? '.prt-raid-info *, .cnt-raid-info *, .prt-result-cnt *'
          : '.prt-raid-info *, .cnt-raid-info *, .cnt-raid *';
        const ptElements = Array.from(document.querySelectorAll(selector));
        for (const el of ptElements) {
          if ((el as HTMLElement).offsetParent === null) continue;
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (text.includes('pt') && text.length < 25) {
            const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num) && num > 0) return { score: num, userId: detectedUserId };
          }
        }

        // 7. Authoritative Solo / Replicard Boss Damage tracking (1 pt = 100 dmg)
        const rawBoss = pJsn?.boss?.param || pJsn?.boss || stage?.gEnemyStatus || stage?.gGameStatus?.boss?.param || stage?.gGameStatus?.boss;
        const bosses = Array.isArray(rawBoss) ? rawBoss : (rawBoss?.param && Array.isArray(rawBoss.param) ? rawBoss.param : Object.values(rawBoss || {}));
        if (bosses.length > 0) {
          let totalMaxHp = 0;
          let totalCurHp = 0;
          for (const b of bosses) {
            if (b) {
              const bMax = parseInt(String(b.hpmax || 0), 10);
              const bCur = parseInt(String(b.hp || 0), 10);
              if (!isNaN(bMax) && bMax > 0) {
                totalMaxHp += bMax;
                totalCurHp += !isNaN(bCur) ? Math.min(Math.max(bCur, 0), bMax) : 0;
              }
            }
          }
          if (totalMaxHp > 0 && totalMaxHp > totalCurHp) {
            const bossDmg = totalMaxHp - totalCurHp;
            const soloHonors = Math.floor(bossDmg / 100);
            if (soloHonors > 0) return { score: soloHonors, userId: detectedUserId };
          }
        }

        return { score: 0, userId: detectedUserId };
      }, this.ctx.state.myUserId, this.ctx.state.playerName || '').catch(() => ({ score: 0, userId: '' }));

      if (result.userId && !this.ctx.state.myUserId) {
        this.ctx.state.myUserId = result.userId;
      }

      if (result.score > this.ctx.state.currentScore) {
        this.ctx.state.currentScore = result.score;
        const target = this.ctx.template.targetScore || 1500000;
        const pct = ((this.ctx.state.currentScore / target) * 100).toFixed(1);
        console.log(`[Honors] Synced: ${this.ctx.state.currentScore.toLocaleString()} / ${target.toLocaleString()} pt (${pct}%)`);
      }
      return this.ctx.state.currentScore;
    } catch {
      return this.ctx.state.currentScore;
    }
  }

  public async isBattleEnded(): Promise<boolean> {
    try {
      const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      if (
        hash.includes('result') ||
        hash.includes('supporter') ||
        hash.includes('mypage') ||
        hash.includes('quest/index') ||
        hash.includes('quest/assist') ||
        hash.includes('quest/extra')
      ) {
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
      }).catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Authoritative Enemy HP & Remaining HP extractor and telemetry logger.
   * Extracts real-time boss data from JS state (pJsnData / gGameStatus) or DOM gauges,
   * calculates percentage, tracks delta damage since previous check, and logs to console.
   */
  public async getAndLogEnemyHp(contextNote?: string): Promise<{ name: string; currentHp: number; maxHp: number; hpPct: number; isDefeated: boolean } | null> {
    try {
      const info = await this.page.evaluate(() => {
        const stage = (window as any).stage;
        const pJsn = stage?.pJsnData;
        const gStatus = stage?.gGameStatus;
        const rawBoss = pJsn?.boss?.param || pJsn?.boss || stage?.gEnemyStatus || gStatus?.boss?.param || gStatus?.boss;
        const bosses = Array.isArray(rawBoss) ? rawBoss : (rawBoss?.param && Array.isArray(rawBoss.param) ? rawBoss.param : Object.values(rawBoss || {}));

        if (bosses.length > 0) {
          const b = bosses[0];
          if (b) {
            const rawName = typeof b.name === 'object' && b.name ? (b.name.en || b.name.ja || '') : b.name;
            const name = String(rawName || b.monster || b.cjs || 'Enemy');
            const maxHp = parseInt(String(b.hpmax || 0), 10);
            const curHp = parseInt(String(b.hp || 0), 10);
            const gauge = document.querySelector('.prt-boss-gauge .prt-hp-gauge-inner, .prt-gauge-hp-inner') as HTMLElement;
            const gaugePct = gauge ? parseFloat(gauge.style.width || '100') : 100;

            let hpPct = 100;
            if (!isNaN(maxHp) && maxHp > 0 && !isNaN(curHp)) {
              hpPct = (Math.max(curHp, 0) / maxHp) * 100;
            } else if (!isNaN(gaugePct)) {
              hpPct = gaugePct;
            }

            return {
              name,
              currentHp: !isNaN(curHp) ? Math.max(curHp, 0) : 0,
              maxHp: !isNaN(maxHp) ? maxHp : 0,
              hpPct,
              isDefeated: curHp <= 0 || hpPct <= 0 || b.alive === 0
            };
          }
        }

        // DOM Fallback
        const gauge = document.querySelector('.prt-boss-gauge .prt-hp-gauge-inner, .prt-gauge-hp-inner') as HTMLElement;
        if (gauge) {
          const widthStr = gauge.style.width || '100%';
          const hpPct = parseFloat(widthStr) || 100;
          const nameEl = document.querySelector('.prt-enemy-name, .txt-enemy-name, .txt-boss-name');
          const name = nameEl?.textContent?.trim() || 'Enemy';
          return {
            name,
            currentHp: Math.round(hpPct),
            maxHp: 100,
            hpPct,
            isDefeated: hpPct <= 0
          };
        }

        return null;
      }).catch(() => null);

      if (info) {
        const lastHp = (this.ctx.state as any).lastLoggedEnemyHp ?? info.currentHp;
        const deltaDmg = lastHp > info.currentHp ? lastHp - info.currentHp : 0;
        (this.ctx.state as any).lastLoggedEnemyHp = info.currentHp;

        const hpStr = info.maxHp > 0 ? `${info.currentHp.toLocaleString()} / ${info.maxHp.toLocaleString()}` : `${info.hpPct.toFixed(1)}%`;
        const pctStr = `${info.hpPct.toFixed(1)}%`;
        const deltaStr = deltaDmg > 0 ? ` [-${deltaDmg.toLocaleString()} DMG]` : '';
        const noteStr = contextNote ? ` [${contextNote}]` : '';
        const statusStr = info.isDefeated ? ' [DEFEATED]' : '';

        console.log(`[Combat:Enemy] 👾 Enemy: ${info.name} | Remaining HP: ${hpStr} (${pctStr})${deltaStr}${statusStr}${noteStr}`);
        return info;
      }
      return null;
    } catch {
      return null;
    }
  }

  public async ensureInitialCombatReady(timeoutMs = 8000): Promise<void> {
    const isCombatHash = await this.page.evaluate(() => {
      const hash = window.location.hash;
      return /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash) || hash.includes('replicard/battle');
    }).catch(() => false);

    if (!isCombatHash) return;

    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const effectiveTimeout = isTurbo ? Math.min(timeoutMs, 2500) : timeoutMs;
    const pollInterval = isTurbo ? (config.isProduction ? 40 : 25) : 100;
    const isManual = this.isManualWorkflow();
    const start = Date.now();

    while (Date.now() - start < effectiveTimeout) {
      if (this.ctx.state.stopRequested) return;
      if (await this.isBattleEnded()) return;

      if (isManual) {
        await this.cancelFullAutoAndActionQueue();
      }

      const isReady = await this.page.evaluate((manual: boolean, targetFps: number) => {
        const cjs = (window as any).createjs;
        if (cjs?.Ticker) {
          cjs.Ticker.framerate = targetFps;
          if (typeof cjs.Ticker.setInterval === 'function') cjs.Ticker.setInterval(1000 / targetFps);
        }
        if (cjs?.Tween?.tick) cjs.Tween.tick(2000, false);

        if (manual) {
          const autoBtn = document.querySelector('.btn-auto, .btn-ability-auto, #btn-auto') as HTMLElement;
          if (autoBtn && (autoBtn.classList.contains('display-on') || autoBtn.classList.contains('active') || autoBtn.classList.contains('full'))) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(autoBtn).trigger('tap');
            autoBtn.click();
          }
        } else {
          const readyEl = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready');
          if (readyEl && (readyEl as HTMLElement).offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(readyEl).trigger('tap');
            (readyEl as HTMLElement).click();
          }
        }

        const atkBtn = document.querySelector('.btn-attack-start') as HTMLElement;
        if (atkBtn && atkBtn.offsetWidth > 0 && window.getComputedStyle(atkBtn).display !== 'none') {
          const isOff = atkBtn.classList.contains('display-off') || atkBtn.classList.contains('lock');
          const isOn = atkBtn.classList.contains('display-on');
          if (isOn || !isOff) return true;
        }

        const backBtn = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (backBtn && backBtn.offsetWidth > 0 && window.getComputedStyle(backBtn).display !== 'none') {
          return true;
        }

        const qsBtn = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
        if (qsBtn && qsBtn.offsetWidth > 0) return true;

        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        if (gStatus && !gStatus.lock && !gStatus.btn_lock && !gStatus.attacking) {
          const char0 = document.querySelector('.lis-character0.btn-command-character, .lis-character0') as HTMLElement;
          if (char0 && char0.offsetWidth > 0) {
            const readyEl = document.querySelector('.prt-ready, .cnt-ready, .prt-popup-ready');
            const hasReady = readyEl && (readyEl as HTMLElement).offsetParent !== null && window.getComputedStyle(readyEl).display !== 'none';
            if (!hasReady) return true;
          }
        }
        return false;
      }, isManual, config.TICKER_FPS).catch(() => false);

      if (isReady) {
        if (!isTurbo) {
          await this.page.touchscreen.tap(240, 260).catch(() => null);
          await this.page.mouse.click(240, 260).catch(() => null);
          await logNormalDelay(250, 0.12);
        }
        await this.getAndLogEnemyHp('Battle Start');
        return;
      }

      await new Promise(r => setTimeout(r, pollInterval));
    }
  }

  public async cancelFullAutoAndActionQueue(): Promise<void> {
    try {
      await this.page.evaluate(() => {
        const auto = document.querySelector('.btn-auto, .btn-ability-auto, #btn-auto') as HTMLElement;
        if (auto && (auto.classList.contains('display-on') || auto.classList.contains('active') || auto.classList.contains('full'))) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(auto).trigger('tap');
          auto.click();
        }
      });
    } catch {}
  }

  public async waitForCombatInputReady(timeoutMs = 5000): Promise<boolean> {
    const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
    const effectiveTimeout = isTurbo ? Math.min(timeoutMs, 1000) : timeoutMs;
    const pollInterval = isTurbo ? (config.isProduction ? 35 : 15) : 50;
    const start = Date.now();

    while (Date.now() - start < effectiveTimeout) {
      if (this.ctx.state.stopRequested) return false;
      if (await this.isBattleEnded()) return true;

      const isReady = await this.page.evaluate((targetFps: number) => {
        const cjs = (window as any).createjs;
        if (cjs?.Ticker) {
          cjs.Ticker.framerate = targetFps;
          if (typeof cjs.Ticker.setInterval === 'function') cjs.Ticker.setInterval(1000 / targetFps);
        }
        if (cjs?.Tween?.tick) cjs.Tween.tick(2000, false);

        const atk = document.querySelector('.btn-attack-start') as HTMLElement;
        if (atk && (atk.classList.contains('display-on') || !atk.classList.contains('display-off')) && !atk.classList.contains('lock') && atk.offsetWidth > 0) {
          return true;
        }

        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetWidth > 0 && window.getComputedStyle(back).display !== 'none') {
          return true;
        }

        const qs = document.querySelector('.btn-quick-summon.qs-ready') as HTMLElement;
        if (qs && qs.offsetWidth > 0) return true;

        const stage = (window as any).stage;
        const gStatus = stage?.gGameStatus;
        if (gStatus && !gStatus.lock && !gStatus.btn_lock && !gStatus.attacking) return true;

        return false;
      }, config.TICKER_FPS).catch(() => false);

      if (isReady) return true;
      await new Promise(r => setTimeout(r, pollInterval));
    }
    return false;
  }

  public async waitForBattleToMount(timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.ctx.state.stopRequested) return false;

      try {
        const check = await this.page.evaluate(() => {
          const hash = window.location.hash;
          const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash) || hash.includes('replicard/battle');
          const isResult = hash.includes('result');
          const hasRaidCanvas = !!document.querySelector('#canvas, .cnt-raid, .prt-command');
          const hasAtkBtn = !!document.querySelector('.btn-attack-start');

          if (isCombat && (hasRaidCanvas || hasAtkBtn)) return 'MOUNTED';
          if (isResult) return 'MOUNTED';

          const modal = document.querySelector('.pop-usual, #pop, .prt-popup-body');
          if (modal && (modal as HTMLElement).offsetParent !== null) {
            const text = ((modal as HTMLElement).innerText || '').toLowerCase();
            const rawText = (modal as HTMLElement).innerText || '';
            if (
              text.includes('three raid') ||
              text.includes('up to three') ||
              text.includes('provide backup in up to') ||
              text.includes('only provide backup') ||
              text.includes('pending') ||
              text.includes('unclaimed') ||
              rawText.includes('未確認') ||
              rawText.includes('参戦中') ||
              rawText.includes('同時に参戦できる') ||
              rawText.includes('3件') ||
              text.includes('3 battles')
            ) {
              return 'PENDING_MODAL';
            }
          }
          return null;
        });

        if (check === 'MOUNTED') {
          await this.page.evaluate((targetFps: number) => {
            const cjs = (window as any).createjs;
            if (cjs?.Ticker) {
              cjs.Ticker.framerate = targetFps;
              if (typeof cjs.Ticker.setInterval === 'function') cjs.Ticker.setInterval(1000 / targetFps);
            }
          }, config.TICKER_FPS).catch(() => null);
          const isTurbo = this.ctx.template?.speedProfile === 'turbo' || getSpeedProfile() === 'turbo';
          if (!isTurbo) await logNormalDelay(150, 0.1);
          return true;
        }
        if (check === 'PENDING_MODAL') return false;
      } catch {}
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  }

  public async waitForBattleToMountOrResult(timeoutMs = 12000): Promise<'MOUNTED' | 'RESULT' | 'TIMEOUT'> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.ctx.state.stopRequested) return 'TIMEOUT';

      const state = await this.page.evaluate(() => {
        const hash = window.location.hash;
        if (hash.includes('result') || !!document.querySelector('.pop-raid-result, .prt-result-head')) {
          return 'RESULT';
        }
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        const hasHud = !!document.querySelector('.btn-attack-start, .cnt-raid, #canvas');
        if (isCombat && hasHud) return 'MOUNTED';
        return null;
      }).catch(() => null);

      if (state === 'RESULT') return 'RESULT';
      if (state === 'MOUNTED') return 'MOUNTED';

      await new Promise(r => setTimeout(r, 150));
    }
    return 'TIMEOUT';
  }

  public async inspectDomForGoldBar(): Promise<{ hasGoldBar: boolean; raidId?: string }> {
    try {
      return await this.page.evaluate(() => {
        const barImg = document.querySelector(
          'img[src*="20004"], [data-item-id="20004"], img[title*="ヒヒイロカネ"], img[alt*="ヒヒイロカネ"], img[title*="Gold Bar"], img[alt*="Gold Bar"], img[title*="Gold Brick"], img[alt*="Gold Brick"]'
        );
        const hasBar = !!(barImg && (barImg as HTMLElement).offsetParent !== null);
        const hashMatch = window.location.hash.match(/(?:result|result_multi|raid|raid_multi)\/(\d+)/);
        const raidId = hashMatch ? hashMatch[1] : undefined;
        return { hasGoldBar: hasBar, raidId };
      });
    } catch {
      return { hasGoldBar: false };
    }
  }

  public async inspectDomForBlueChest(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const blueChest = document.querySelector(
          '.prt-special-reward, .ico-special-reward, [data-box-type="11"], img[src*="special_reward"], .prt-box-type-11, .pop-raid-result .ico-special-reward'
        );
        return !!(blueChest && (blueChest as HTMLElement).offsetParent !== null);
      });
    } catch {
      return false;
    }
  }

  public async broadcastGoldBarFound(raidId = this.ctx.state.currentRaidId): Promise<void> {
    const accConfig = this.ctx.state.playerName || this.ctx.accountId;
    console.log(`\n========================================================================`);
    console.log(`🏆 [GOLD BAR FOUND] Congratulations! Account [${accConfig}] looted a GOLD BAR!`);
    console.log(`Raid ID: ${raidId} | Total Session Gold Bars: ${this.ctx.state.totalGoldBarsAccumulated}`);
    console.log(`========================================================================\n`);

    try {
      await this.ctx.alertRelay.sendEmergencyAlert(
        `🏆 [GOLD BAR FOUND] Account [${accConfig}] looted a GOLD BAR! Raid: ${this.ctx.template.name} | Raid ID: ${raidId}`
      );
    } catch (err: any) {
      console.warn(`[AlertRelay] Failed to broadcast Gold Bar alert: ${err.message}`);
    }
  }

  public async checkAndDismissProcessingTurnPopup(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const pop = document.querySelector('.pop-processing, .prt-popup-processing, .pop-usual') as HTMLElement;
        if (pop && pop.offsetParent !== null) {
          const ok = pop.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
            return true;
          }
        }
        return false;
      });
    } catch {
      return false;
    }
  }

  public async dismissCombatDrawersAndPopups(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        let acted = false;
        const cjs = (window as any).createjs;
        if (cjs?.Tween?.tick) cjs.Tween.tick(2000, false);
        const stage = (window as any).stage;
        if (stage?.gGameStatus) {
          stage.gGameStatus.lock = false;
          stage.gGameStatus.btn_lock = false;
          stage.gGameStatus.animation = false;
        }

        const popBtns = Array.from(document.querySelectorAll(
          '.pop-usual .btn-close, .pop-usual .btn-usual-ok, .pop-usual .btn-usual-cancel, .prt-popup-header .btn-close, .btn-usual-close, .prt-popup-footer .btn-usual-ok'
        )) as HTMLElement[];
        for (const btn of popBtns) {
          if (btn.offsetParent !== null && window.getComputedStyle(btn).display !== 'none') {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
            acted = true;
          }
        }

        const back = document.querySelector('.btn-command-back.display-on, .btn-command-back') as HTMLElement;
        if (back && back.offsetParent !== null && window.getComputedStyle(back).display !== 'none') {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(back).trigger('tap');
          back.click();
          acted = true;
        }
        return acted;
      });
    } catch {
      return false;
    }
  }

  public async handleConfirmResult(): Promise<boolean> {
    await this.checkAndDismissProcessingTurnPopup();
    await this.syncCurrentHonors();

    const initialHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isLingerCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(initialHash) || initialHash.includes('replicard/battle');
    if (isLingerCombat && await this.isBattleEnded()) {
      console.log('[Workflow] Battle ended but still on combat hash. Reloading to transition to result screen...');
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null),
        this.page.evaluate(() => location.reload()).catch(() => null)
      ]);
      await logNormalDelay(350, 0.1);
      await this.checkAndDismissProcessingTurnPopup();
    }

    const tStart = Date.now();
    while (Date.now() - tStart < 3500) {
      const h = await this.page.evaluate(() => window.location.hash).catch(() => '');
      const hasResultElement = await this.page.evaluate(() => {
        return !!document.querySelector('.btn-usual-ok, .btn-settle, .btn-usual-close, .pop-raid-result, .prt-result-head');
      }).catch(() => false);
      if (hasResultElement || !(/^#(raid(_multi|_semi)?|battle)\/\d+/.test(h) || h.includes('replicard/battle'))) {
        break;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    const domCheck = await this.inspectDomForGoldBar();
    if (domCheck.hasGoldBar && !this.ctx.state.currentBattleHadGoldBar) {
      this.ctx.state.currentBattleHadGoldBar = true;
      this.ctx.state.currentBattleHadBlueChest = true;
      this.ctx.state.totalGoldBarsAccumulated++;
      this.ctx.state.totalBlueChestsAccumulated++;
      await this.broadcastGoldBarFound(domCheck.raidId || this.ctx.state.currentRaidId);
    }

    if (!this.ctx.state.currentBattleHadBlueChest) {
      const blueChestDom = await this.inspectDomForBlueChest();
      if (blueChestDom) {
        this.ctx.state.currentBattleHadBlueChest = true;
        this.ctx.state.totalBlueChestsAccumulated++;
      }
    }

    await this.page.evaluate(() => {
      const okBtns = Array.from(document.querySelectorAll('.btn-usual-ok, .btn-settle, .btn-usual-close, .pop-raid-result .btn-usual-ok, .btn-result-close, .btn-control.location-href, .prt-popup-body .btn-usual-ok')) as HTMLElement[];
      for (const btn of okBtns) {
        if (btn.offsetParent !== null) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
        }
      }
    }).catch(() => null);

    await this.syncCurrentHonors();

    const targetUrl = this.ctx.template.questUrl || '';
    const isAssistRaid = targetUrl.includes('assist') || (this.ctx.template.raidSlots && this.ctx.template.raidSlots.length > 0);
    const isReplicard = targetUrl.includes('replicard') || targetUrl.includes('819131') || targetUrl.includes('815091') || targetUrl.includes('816091') || targetUrl.includes('819141') || targetUrl.includes('819151') || targetUrl.includes('819161') || targetUrl.includes('819171');
    const curHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    const isStillCombatHash = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(curHash) || curHash.includes('replicard/battle');

    if (isAssistRaid) {
      if (isStillCombatHash) {
        console.log('[Workflow] Multi-raid rotation burst completed. Returning to #quest/assist for next raid...');
        await this.page.evaluate(() => { window.location.hash = '#quest/assist'; }).catch(() => null);
        await logNormalDelay(800, 0.15);
      }
    } else if (isReplicard) {
      if (isStillCombatHash || curHash.includes('result')) {
        const destHash = targetUrl.includes('#') ? '#' + targetUrl.split('#')[1] : '#replicard/stage/10';
        console.log(`[Workflow] Replicard run concluded. Returning to quest URL (${destHash})...`);
        await this.page.evaluate((hash: string) => { window.location.hash = hash; }, destHash).catch(() => null);
        await logNormalDelay(600, 0.15);
      }
    } else if (isStillCombatHash || curHash.includes('result')) {
      const destHash = targetUrl.includes('#') ? '#' + targetUrl.split('#')[1] : '#quest/index';
      console.log(`[Workflow] Quest concluded. Returning to quest URL (${destHash})...`);
      await this.page.evaluate((hash: string) => { window.location.hash = hash; }, destHash).catch(() => null);
      await logNormalDelay(600, 0.15);
    }

    return true;
  }

  public async resolveLingeringState(): Promise<void> {
    try {
      if (await this.ctx.sentinel.inspectForVerification()) {
        console.warn('[Workflow] 🛑 CAPTCHA detected. resolveLingeringState aborted to preserve puzzle for operator.');
        return;
      }

      const hasRestartPop = await this.page.evaluate(() => {
        const pop = document.querySelector('.popRestartQuest, .pop-usual');
        if (pop && pop.textContent?.includes('in progress')) {
          const ok = pop.querySelector('.btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
            return true;
          }
        }
        return false;
      }).catch(() => false);

      if (hasRestartPop) {
        await this.waitForBattleToMount(10000);
      } else {
        await this.dismissCombatDrawersAndPopups();
      }

      let attempts = 0;
      while (attempts < 6) {
        if (await this.isBattleEnded()) break;
        const hash = await this.page.evaluate(() => window.location.hash).catch(() => '');
        const isCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(hash);
        if (!isCombat) break;

        const isAssistRaid = this.ctx.template.questUrl.includes('assist') || (this.ctx.template.raidSlots && this.ctx.template.raidSlots.length > 0);
        if (isAssistRaid) {
          console.log(`[Workflow] In multi-raid assist mode. Exiting lingering raid (${hash}) to #quest/assist...`);
          await this.syncCurrentHonors();
          await this.page.evaluate(() => { window.location.hash = '#quest/assist'; }).catch(() => null);
          await logNormalDelay(800, 0.15);
          break;
        }

        console.log(`[Workflow] Lingering raid detected (${hash}). Resolving battle turn...`);
        await new Promise(r => setTimeout(r, 200));
        await this.dismissCombatDrawersAndPopups();

        const atkBtn = await this.page.waitForSelector('.btn-attack-start.display-on, .btn-attack-start', { visible: true, timeout: 5000 }).catch(() => null);
        if (atkBtn) {
          await humanizedClick(this.page, atkBtn);
          await this.waitForNetworkResponse('normal_attack_result.json', 3500);
          await logNormalDelay(400, 0.1);
        } else {
          await this.page.touchscreen.tap(260, 380).catch(() => null);
          await new Promise(r => setTimeout(r, 1000));
        }

        if (await this.isBattleEnded()) break;

        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
          this.page.evaluate(() => location.reload()).catch(() => null)
        ]);

        await this.waitForBattleToMount(6000);
        await this.dismissCombatDrawersAndPopups();
        attempts++;
      }

      const endHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
      const isStillCombat = /^#(raid(_multi|_semi)?|battle)\/\d+/.test(endHash);
      if (endHash.includes('result') || isStillCombat) {
        await this.page.evaluate(() => {
          const ok = document.querySelector('.btn-usual-ok, .btn-settle') as HTMLElement;
          if (ok && ok.offsetParent !== null) ok.click();
          window.location.href = 'https://game.granbluefantasy.jp/#quest/index';
        }).catch(() => null);
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch {}
  }

  public async waitForCombatTurnResolution(targetNet: string | null, totalTimeoutMs = 15000): Promise<boolean> {
    const prevTurn = this.ctx.state.currentTurn;
    return new Promise<boolean>(resolve => {
      let resolved = false;
      let lastActionTime = Date.now();
      let hasSeenSkill = false;

      const finish = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(hardTimeout);
          clearInterval(pollInterval);
          this.page.off('response', responseHandler);
          resolve(result);
        }
      };

      const hardTimeout = setTimeout(() => {
        finish(hasSeenSkill);
      }, totalTimeoutMs);

      const responseHandler = (res: HTTPResponse) => {
        const url = res.url();
        if (targetNet && url.includes(targetNet)) {
          finish(true);
          return;
        }
        if (url.includes('normal_attack_result.json')) {
          console.log('[Combat] Normal attack registered by server.');
          finish(true);
          return;
        }
        if (url.includes('summon_result.json')) {
          console.log('[Combat] Summon action registered by server.');
          finish(true);
          return;
        }
        if (url.includes('ability_result.json')) {
          hasSeenSkill = true;
          lastActionTime = Date.now();
          console.log('[Combat] Full Auto skill cast registered. Awaiting next skill or normal attack...');
        }
      };

      this.page.on('response', responseHandler);

      const pollInterval = setInterval(async () => {
        if (resolved) return;
        if (hasSeenSkill && (Date.now() - lastActionTime > 2500)) {
          console.log('[Combat] Full Auto skill sequence completed and settled.');
          finish(true);
          return;
        }

        try {
          const state = await this.page.evaluate((prev) => {
            const stage = (window as any).stage;
            const gStatus = stage?.gGameStatus;
            const pJsn = stage?.pJsnData;
            const currTurn = Number(pJsn?.turn || gStatus?.turn || 0);
            const turnAdvanced = currTurn > prev;
            const isEnded = gStatus?.finish === true || gStatus?.win === true || gStatus?.lose === true || pJsn?.finish === true || pJsn?.is_clear === true;
            return { turnAdvanced, isEnded };
          }, prevTurn).catch(() => null);

          if (state?.turnAdvanced) finish(true);
          else if (state?.isEnded) finish(true);
        } catch {}
      }, 80);
    });
  }

  public async waitForNetworkResponse(targetSubstring: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.page.off('response', responseHandler);
          resolve(false);
        }
      }, timeoutMs);

      const responseHandler = (res: HTTPResponse) => {
        try {
          if (res.url().includes(targetSubstring)) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              this.page.off('response', responseHandler);
              resolve(true);
            }
          }
        } catch {}
      };
      this.page.on('response', responseHandler);
    });
  }

  public async waitForNetworkResponseAndPayload(targetSubstring: string, timeoutMs: number): Promise<{ resolved: boolean; json: any | null }> {
    return new Promise(resolve => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.page.off('response', responseHandler);
          resolve({ resolved: false, json: null });
        }
      }, timeoutMs);

      const responseHandler = async (res: HTTPResponse) => {
        try {
          if (res.url().includes(targetSubstring)) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              this.page.off('response', responseHandler);
              const json = await res.json().catch(() => null);
              resolve({ resolved: true, json });
            }
          }
        } catch {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.page.off('response', responseHandler);
            resolve({ resolved: true, json: null });
          }
        }
      };
      this.page.on('response', responseHandler);
    });
  }


  public async waitForCombatActionResponse(targetNet: string | null, timeoutMs: number): Promise<boolean> {
    return await this.waitForCombatTurnResolution(targetNet, timeoutMs);
  }

  public extractTurnDamage(data: any): number {
    return CombatResolutionService.extractTurnDamage(data);
  }

  public static extractTurnDamage(data: any): number {
    if (!data) return 0;
    let totalDmg = 0;

    const traverse = (node: any) => {
      if (!node) return;

      if (Array.isArray(node)) {
        for (const item of node) {
          if (item && (item.from === 'boss' || item.from === 'enemy')) continue;
          if (item && item.cmd === 'heal') continue;
          traverse(item);
        }
        return;
      }

      if (typeof node === 'object') {
        if (node.from === 'boss' || node.from === 'enemy') return;
        if (node.cmd === 'heal') return;

        if (typeof node.damage === 'number' && node.damage > 0) {
          totalDmg += node.damage;
        }

        if (typeof node.hp_damage === 'number' && node.hp_damage > 0) {
          totalDmg += node.hp_damage;
        }

        if (Array.isArray(node.damage)) {
          for (const d of node.damage) {
            if (typeof d === 'number' && d > 0) totalDmg += d;
            else if (d && typeof d.damage === 'number' && d.damage > 0) totalDmg += d.damage;
            else if (d && typeof d.hp_damage === 'number' && d.hp_damage > 0) totalDmg += d.hp_damage;
            else traverse(d);
          }
        }

        if (Array.isArray(node.list)) {
          for (const item of node.list) {
            if (item && typeof item.damage === 'number' && item.damage > 0) totalDmg += item.damage;
            else if (item && typeof item.hp_damage === 'number' && item.hp_damage > 0) totalDmg += item.hp_damage;
            else traverse(item);
          }
        }

        if (Array.isArray(node.scenario)) {
          traverse(node.scenario);
        }
      }
    };

    traverse(data);

    // Direct damage payload fallback
    if (totalDmg === 0) {
      if (typeof data.status?.damage === 'number' && data.status.damage > 0) {
        totalDmg = data.status.damage;
      } else if (typeof data.damage === 'number' && data.damage > 0) {
        totalDmg = data.damage;
      }
    }

    // Boss HP delta fallback if available in payload
    if (totalDmg === 0) {
      const rawBoss = data.status?.boss?.param || data.boss?.param || data.status?.boss || data.boss;
      const bosses = Array.isArray(rawBoss) ? rawBoss : (rawBoss?.param && Array.isArray(rawBoss.param) ? rawBoss.param : Object.values(rawBoss || {}));
      if (bosses.length > 0) {
        let bMax = 0;
        let bCur = 0;
        for (const b of bosses) {
          if (b) {
            const maxVal = parseInt(String(b.hpmax || 0), 10);
            const curVal = parseInt(String(b.hp || 0), 10);
            if (!isNaN(maxVal) && maxVal > 0) {
              bMax += maxVal;
              bCur += !isNaN(curVal) ? Math.min(Math.max(curVal, 0), maxVal) : 0;
            }
          }
        }
        if (bMax > bCur) {
          totalDmg = bMax - bCur;
        }
      }
    }

    return totalDmg;
  }

  private isManualWorkflow(): boolean {
    const isManualMode = this.ctx.template.mode === 'combat' && !this.ctx.template.steps.some(s => s.code === 'smart_full_auto' || s.code === 'auto');
    return isManualMode || (this.ctx.template as any).manualMode === true;
  }
}

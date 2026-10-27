// src/engines/universal/screen-diagnostic.service.ts
import { Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { SentinelWatchdog } from '../../sentinel-watchdog.js';
import { humanizedClick, logNormalDelay } from '../../human-motor.js';
import { ScreenAnalysisResult, QuestStartRecoveryResult, ScreenCondition, UniversalContext } from './types.js';

export interface IScreenDiagnosticCallbacks {
  resolveLingeringRaidLimit: (logPath: string, currentRuns: number) => Promise<boolean>;
  claimPendingBattles: (logPath: string, currentRuns: number, returnUrl?: string) => Promise<number>;
  waitForBattleToMount: (timeoutMs?: number) => Promise<boolean>;
  resolveLingeringState: () => Promise<void>;
  getReplicardStageHash?: () => string;
  waitForAndDismissReplicardStagePopups?: (timeoutMs?: number) => Promise<boolean>;
}

/**
 * Autonomous screen diagnostic and self-healing service for Universal Workflow Engine.
 * Adheres to SRP: Diagnoses obstructive modals, error dialogs, and manages autonomous recovery.
 */
export class ScreenDiagnosticService {
  private page: Page;
  private sentinel: SentinelWatchdog;
  private ctx?: UniversalContext;
  private callbacks?: IScreenDiagnosticCallbacks;

  constructor(
    pageOrCtx: Page | UniversalContext,
    sentinelOrCallbacks?: SentinelWatchdog | IScreenDiagnosticCallbacks,
    callbacks?: IScreenDiagnosticCallbacks
  ) {
    if ('page' in pageOrCtx && 'sentinel' in pageOrCtx) {
      this.ctx = pageOrCtx as UniversalContext;
      this.page = this.ctx.page;
      this.sentinel = this.ctx.sentinel;
      this.callbacks = (sentinelOrCallbacks as IScreenDiagnosticCallbacks) || callbacks;
    } else {
      this.page = pageOrCtx as Page;
      this.sentinel = sentinelOrCallbacks as SentinelWatchdog;
      this.callbacks = callbacks;
    }
  }

  public setCallbacks(callbacks: IScreenDiagnosticCallbacks): void {
    this.callbacks = callbacks;
  }

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Deeply analyzes the current screen, modals, error dialogs, badges, and DOM state.
   */
  public async deepAnalyzeScreenState(): Promise<ScreenAnalysisResult> {
    try {
      // 1. Check CAPTCHA / Access Verification
      const isCaptcha = await this.sentinel.inspectForVerification().catch(() => false);
      if (isCaptcha) {
        return {
          condition: 'CAPTCHA_CHALLENGE',
          title: 'Access Verification',
          message: 'Access Verification / CAPTCHA challenge is blocking the screen',
          hasPopup: true,
          canAutoRecover: true,
          rawText: 'Access Verification'
        };
      }

      // 2. Extract DOM modal info
      const screenInfo = await this.page.evaluate(() => {
        const pop = document.querySelector(
          '.pop-usual, .common-pop-error, .prt-popup-body, .cnt-error, #pop, .pop-show, .popRestartQuest, .prt-dialog-content'
        );
        const popEl = pop as HTMLElement | null;
        const isPopVisible = popEl !== null && popEl.offsetParent !== null;

        const titleEl = document.querySelector(
          '.pop-usual .prt-title, .prt-popup-header, .txt-popup-title, .common-pop-error .prt-title'
        );
        const title = (titleEl as HTMLElement)?.innerText?.trim() || '';

        const text = isPopVisible ? (popEl.innerText?.trim() || '') : '';
        const bodyText = document.body.innerText || '';

        return {
          hasPopup: isPopVisible,
          title,
          text,
          bodyText
        };
      }).catch(() => ({ hasPopup: false, title: '', text: '', bodyText: '' }));

      const rawText = screenInfo.text || screenInfo.bodyText;
      const lower = rawText.toLowerCase();

      // Priority 1: Soul Berry / EP Depletion
      if (
        lower.includes('soul berry') ||
        lower.includes('soul berries') ||
        lower.includes('not enough ep') ||
        rawText.includes('ソウルシード') ||
        rawText.includes('ソウルパウダー') ||
        rawText.includes('BPが不足') ||
        rawText.includes('回復しますか')
      ) {
        return {
          condition: 'SOUL_BERRY_DEPLETED',
          title: screenInfo.title || 'Soul Berries Depleted',
          message: 'Soul Berries / EP depleted. Auto-replenishment required.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      // Priority 2: AP Depletion
      if (
        lower.includes('half elixir') ||
        lower.includes('elixir') ||
        lower.includes('not enough ap') ||
        rawText.includes('エリクシールハーフ') ||
        rawText.includes('エリクシール') ||
        rawText.includes('APが不足')
      ) {
        return {
          condition: 'AP_DEPLETED',
          title: screenInfo.title || 'AP Depleted',
          message: 'AP depleted. Half-Elixir replenishment required.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      // Priority 3: 3-Raid Backup Limit (Strict check against genuinely active popup)
      if (
        screenInfo.hasPopup &&
        (lower.includes('three raid') ||
          lower.includes('up to three') ||
          lower.includes('provide backup in up to') ||
          lower.includes('only provide backup') ||
          lower.includes('3 battles') ||
          lower.includes('3 raid') ||
          lower.includes('participating in 3') ||
          lower.includes('more than 3') ||
          lower.includes('up to 3') ||
          rawText.includes('3件まで') ||
          rawText.includes('同時に参戦できる') ||
          (rawText.includes('3件') && (rawText.includes('マルチバトル') || rawText.includes('救援'))))
      ) {
        return {
          condition: 'ACTIVE_RAID_LIMIT_3',
          title: screenInfo.title || '3-Raid Backup Limit',
          message: 'Active raid limit (3/3) reached. Lingering raids must be cleared.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      // Priority 4: 5-Pending Battles Limit (Strict check against genuinely active popup)
      if (
        screenInfo.hasPopup &&
        (lower.includes('pending') ||
          lower.includes('unclaimed') ||
          rawText.includes('未確認') ||
          lower.includes('five or more') ||
          rawText.includes('5件'))
      ) {
        return {
          condition: 'PENDING_BATTLES_LIMIT',
          title: screenInfo.title || 'Pending Battles Cap',
          message: 'Pending battles limit reached. Unclaimed battles must be swept.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      // Priority 5: Raid Full or Concluded
      if (
        lower.includes('already ended') ||
        lower.includes('already full') ||
        lower.includes('has ended') ||
        lower.includes('battle has already concluded') ||
        lower.includes('maximum number of participants') ||
        lower.includes('capacity') ||
        rawText.includes('定員に達している') ||
        rawText.includes('定員') ||
        rawText.includes('参戦人数') ||
        rawText.includes('参加人数') ||
        rawText.includes('終了') ||
        rawText.includes('解散') ||
        rawText.includes('すでに終了') ||
        rawText.includes('既に終了') ||
        rawText.includes('すでにバトルが終了')
      ) {
        return {
          condition: 'RAID_FULL_OR_ENDED',
          title: screenInfo.title || 'Raid Full / Ended',
          message: 'Raid is full or already ended.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      // Priority 6: Suspended Quest / Mid-battle reconnect
      if (
        lower.includes('suspended quest') ||
        lower.includes('quest is in progress') ||
        lower.includes('battle in progress') ||
        lower.includes('poprestartquest') ||
        rawText.includes('中断されたクエスト') ||
        rawText.includes('中断したクエスト') ||
        rawText.includes('未クリアのクエスト') ||
        rawText.includes('再開しますか') ||
        rawText.includes('再開') ||
        rawText.includes('続ける')
      ) {
        return {
          condition: 'SUSPENDED_QUEST',
          title: screenInfo.title || 'Suspended Quest',
          message: 'A quest was interrupted and is pending resumption.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      // Priority 7: Daily Host Limit
      if (
        lower.includes('daily limit') ||
        lower.includes('cannot start this quest') ||
        lower.includes('limit reached for today') ||
        rawText.includes('本日の挑戦回数') ||
        rawText.includes('制限に達しています')
      ) {
        return {
          condition: 'DAILY_HOST_LIMIT',
          title: screenInfo.title || 'Daily Host Limit',
          message: 'Daily host limit reached for this quest.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: false,
          rawText
        };
      }

      // Priority 8: Communication Error
      if (
        lower.includes('communication error') ||
        lower.includes('connection error') ||
        rawText.includes('通信エラー') ||
        rawText.includes('ネットワークエラー')
      ) {
        return {
          condition: 'COMMUNICATION_ERROR',
          title: screenInfo.title || 'Communication Error',
          message: 'A communication error occurred.',
          hasPopup: screenInfo.hasPopup,
          canAutoRecover: true,
          rawText
        };
      }

      if (screenInfo.hasPopup && screenInfo.text.length > 0) {
        return {
          condition: 'UNKNOWN_MODAL',
          title: screenInfo.title || 'In-Game Modal',
          message: screenInfo.text.substring(0, 120),
          hasPopup: true,
          canAutoRecover: false,
          rawText
        };
      }

      return {
        condition: 'NONE',
        title: '',
        message: 'No blocking modal or condition detected',
        hasPopup: false,
        canAutoRecover: false,
        rawText
      };
    } catch (err: any) {
      return {
        condition: 'NONE',
        title: 'Diagnostic Error',
        message: err.message,
        hasPopup: false,
        canAutoRecover: false,
        rawText: ''
      };
    }
  }

  /**
   * Backwards-compatible diagnosis method. Delegates to deepAnalyzeScreenState.
   */
  public async diagnoseQuestStartFailure(runNumber: number): Promise<{
    reason: string;
    popupText?: string;
    isCaptcha: boolean;
    isOutOfMeat: boolean;
    isOutOfAp: boolean;
    isRaidBackupLimit: boolean;
    capturePath?: string;
  }> {
    const analysis = await this.deepAnalyzeScreenState();
    let capturePath: string | undefined;

    const capDir = path.resolve(process.cwd(), 'artifacts/captures');
    if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
    capturePath = path.resolve(capDir, `quest-start-failed-run${runNumber}-${Date.now()}.png`);
    await this.page.screenshot({ path: capturePath, fullPage: false }).catch(() => null);

    return {
      reason: analysis.message || 'Unknown quest start obstruction',
      popupText: analysis.message,
      isCaptcha: analysis.condition === 'CAPTCHA_CHALLENGE',
      isOutOfMeat: analysis.rawText.includes('chunky meat') || analysis.rawText.includes('お肉'),
      isOutOfAp: analysis.condition === 'AP_DEPLETED',
      isRaidBackupLimit: analysis.condition === 'ACTIVE_RAID_LIMIT_3',
      capturePath
    };
  }

  /**
   * Performs deep on-screen failure diagnosis and autonomous self-healing.
   */
  public async diagnoseAndRecoverQuestStart(
    runNumber: number,
    autoReplenishAp: boolean,
    autoReplenishEp: boolean,
    logPath: string,
    currentRuns: number
  ): Promise<QuestStartRecoveryResult> {
    const analysis = await this.deepAnalyzeScreenState();
    console.log(`[Deep Analysis] Screen Condition: ${analysis.condition} | Details: "${analysis.message.replace(/\s+/g, ' ').substring(0, 90)}"`);

    let recovered = false;
    let reason = analysis.message || analysis.condition;
    let isFatal = false;
    let capturePath: string | undefined;

    switch (analysis.condition) {
      case 'SOUL_BERRY_DEPLETED': {
        if (autoReplenishEp) {
          console.log('[Deep Analysis] 🍇 Auto-replenishing Soul Berries / EP...');
          const clicked = await this.page.evaluate(() => {
            const btn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .pop-usual .btn-usual-ok') as HTMLElement;
            if (btn && btn.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (clicked) {
            await logNormalDelay(400, 0.1);
            const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 3000 }).catch(() => null);
            if (confirmBtn) {
              await humanizedClick(this.page, confirmBtn);
              await logNormalDelay(500, 0.12);
            }
            recovered = true;
            reason = 'Auto-replenished Soul Berries / EP';
          } else {
            reason = 'Soul Berry replenishment modal found but use button unclickable';
            isFatal = true;
          }
        } else {
          reason = 'Soul Berries / EP depleted and autoReplenishEp is disabled';
          isFatal = true;
        }
        break;
      }

      case 'AP_DEPLETED': {
        if (autoReplenishAp) {
          console.log('[Deep Analysis] 🧪 Auto-replenishing AP with Half-Elixir...');
          const clicked = await this.page.evaluate(() => {
            const btn = document.querySelector('.btn-use-item.btn-usual-use, .btn-usual-ok.se-use, .pop-usual .btn-usual-ok') as HTMLElement;
            if (btn && btn.offsetParent !== null) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
              return true;
            }
            return false;
          }).catch(() => false);

          if (clicked) {
            await logNormalDelay(400, 0.1);
            const confirmBtn = await this.page.waitForSelector('.pop-usual .btn-usual-ok', { visible: true, timeout: 3000 }).catch(() => null);
            if (confirmBtn) {
              await humanizedClick(this.page, confirmBtn);
              await logNormalDelay(500, 0.12);
            }
            recovered = true;
            reason = 'Auto-replenished AP with Half-Elixir';
          } else {
            reason = 'AP replenishment modal found but elixir button unclickable';
            isFatal = true;
          }
        } else {
          reason = 'AP depleted and autoReplenishAp is disabled';
          isFatal = true;
        }
        break;
      }

      case 'ACTIVE_RAID_LIMIT_3': {
        console.log('[Deep Analysis] 🛡️ 3-Raid Backup Limit intercepted! Resolving lingering raids...');
        await this.dismissPopupModal();
        if (this.callbacks) {
          await this.callbacks.resolveLingeringRaidLimit(logPath, currentRuns);
        }
        recovered = true;
        reason = '3-Raid Backup Limit resolved';
        break;
      }

      case 'PENDING_BATTLES_LIMIT': {
        console.log('[Deep Analysis] 🧹 5-Pending Battles Limit intercepted! Clearing all unclaimed battles...');
        await this.dismissPopupModal();
        if (this.callbacks) {
          await this.callbacks.claimPendingBattles(logPath, currentRuns, 'https://game.granbluefantasy.jp/#quest/assist');
        }
        recovered = true;
        reason = 'Pending battles thoroughly cleared';
        break;
      }

      case 'RAID_FULL_OR_ENDED': {
        console.log('[Deep Analysis] ⚠️ Raid full or ended. Dismissing modal and refreshing finder...');
        await this.dismissFullOrEndedRaidPopup();
        const refreshBtn = await this.page.$('.btn-search-refresh, .btn-post-key, .btn-refresh-list');
        if (refreshBtn) {
          await humanizedClick(this.page, refreshBtn);
          await logNormalDelay(600, 0.1);
        }
        recovered = true;
        reason = 'Raid full/ended dismissed; finder refreshed';
        break;
      }

      case 'SUSPENDED_QUEST': {
        console.log('[Deep Analysis] 🔄 Suspended quest in progress detected. Resuming...');
        const resumed = await this.page.evaluate(() => {
          const ok = document.querySelector('.popRestartQuest .btn-usual-ok, .pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
            return true;
          }
          return false;
        }).catch(() => false);
        if (resumed) {
          if (this.callbacks) {
            await this.callbacks.waitForBattleToMount(12000);
            await this.callbacks.resolveLingeringState();
          }
          recovered = true;
          reason = 'Suspended quest resumed and resolved';
        }
        break;
      }

      case 'COMMUNICATION_ERROR': {
        console.log('[Deep Analysis] 🌐 Communication error detected. Resolving dialog...');
        await this.page.evaluate(() => {
          const ok = document.querySelector('.pop-usual .btn-usual-ok, .btn-usual-ok') as HTMLElement;
          if (ok && ok.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(ok).trigger('tap');
            ok.click();
          }
        }).catch(() => null);
        await logNormalDelay(600, 0.15);

        const questUrl = (this.ctx?.template?.questUrl || '').toLowerCase();
        const stageUrl = (this.ctx?.template?.stageUrl || '').toLowerCase();
        const name = (this.ctx?.template?.name || '').toLowerCase();
        const isReplicard = questUrl.includes('replicard') ||
          questUrl.includes('arcarum') ||
          stageUrl.includes('replicard') ||
          name.includes('replicard') ||
          name.includes('arcarum') ||
          name.includes('cocytus') ||
          name.includes('fortress') ||
          name.includes('paragon') ||
          Boolean(this.ctx?.template?.divisionId) ||
          Boolean(this.ctx?.template?.sector) ||
          questUrl.includes('816131') ||
          questUrl.includes('819131') ||
          questUrl.includes('812051');

        if (isReplicard) {
          const stageHash = this.callbacks?.getReplicardStageHash
            ? this.callbacks.getReplicardStageHash()
            : (this.ctx?.template?.stageUrl
              ? (this.ctx.template.stageUrl.includes('#') ? '#' + this.ctx.template.stageUrl.split('#')[1] : this.ctx.template.stageUrl)
              : (questUrl.match(/replicard\/(?:supporter|stage)\/(\d+)/i) ? `#replicard/stage/${questUrl.match(/replicard\/(?:supporter|stage)\/(\d+)/i)![1]}` : '#replicard/stage/7'));

          console.log(`[Deep Analysis] Replicard communication error encountered. Heading to stage map (${stageHash}) to settle pending rewards...`);
          await this.page.evaluate((hash: string) => {
            window.location.hash = hash;
          }, stageHash).catch(() => null);
          await logNormalDelay(800, 0.15);

          if (this.callbacks?.waitForAndDismissReplicardStagePopups) {
            await this.callbacks.waitForAndDismissReplicardStagePopups(6000);
          } else {
            await this.dismissPopupModal();
          }
          recovered = true;
          reason = `Recovered Replicard communication error via stage map (${stageHash}) settlement`;
        } else {
          await this.page.evaluate(() => {
            window.location.reload();
          }).catch(() => null);
          await logNormalDelay(1500, 0.15);
          recovered = true;
          reason = 'Reloaded page after communication error';
        }
        break;
      }

      case 'CAPTCHA_CHALLENGE': {
        console.warn('[Deep Analysis] 🛑 Access Verification challenge encountered!');
        await this.sentinel.assertSafe();
        recovered = true;
        reason = 'CAPTCHA challenge resolved via Sentinel';
        break;
      }

      case 'DAILY_HOST_LIMIT': {
        console.warn('[Deep Analysis] 🛑 Daily host limit reached for this quest. Stopping workflow.');
        isFatal = true;
        reason = 'Daily host limit reached';
        break;
      }

      default: {
        if (analysis.hasPopup) {
          const dismissed = await this.dismissPopupModal();
          if (dismissed) {
            console.log('[Deep Analysis] Dismissed generic modal dialog.');
            await logNormalDelay(500, 0.1);
          }
        } else if (analysis.condition === 'NONE') {
          // If no modal or condition is found, the page/router view is likely desynchronized or wedged
          console.log('[Deep Analysis] 🔄 No blocking modal found. Proactively reloading page to resync router state...');
          await this.page.evaluate(() => { window.location.reload(); }).catch(() => null);
          await logNormalDelay(1200, 0.15);
          recovered = true;
          reason = 'Reloaded page to clear desynchronized router/DOM view';
          break;
        }

        // Capture emergency diagnostic screenshot
        const capDir = path.resolve(process.cwd(), 'artifacts/captures');
        if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
        capturePath = path.resolve(capDir, `quest-start-failed-run${runNumber}-${Date.now()}.png`);
        await this.page.screenshot({ path: capturePath, fullPage: false }).catch(() => null);
        break;
      }
    }

    return {
      recovered,
      condition: analysis.condition,
      reason,
      isFatal,
      capturePath
    };
  }

  public async dismissPopupModal(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        let dismissed = false;
        const pop = document.querySelector('.pop-usual, #pop, .prt-popup-body, .pop-show');
        if (pop && (pop as HTMLElement).offsetParent !== null) {
          const cancel = pop.querySelector('.btn-usual-cancel, .btn-usual-close, .btn-close, .btn-usual-ok') as HTMLElement;
          if (cancel && cancel.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(cancel).trigger('tap');
            cancel.click();
            dismissed = true;
          }
        }
        return dismissed;
      });
    } catch {
      return false;
    }
  }

  public async dismissFullOrEndedRaidPopup(): Promise<boolean> {
    try {
      return await this.page.evaluate(() => {
        const modals = Array.from(document.querySelectorAll('.pop-usual.pop-show, .pop-show, #pop .pop-usual.pop-show, .pop-usual:not([style*="display: none"])'));
        const modal = modals.find(m => {
          const el = m as HTMLElement;
          if (el.offsetParent === null) return false;
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
        }) as HTMLElement;

        if (!modal) return false;
        const text = modal.innerText || modal.textContent || '';
        const lower = text.toLowerCase();
        const isFullOrEnded = (
          lower.includes('already ended') ||
          lower.includes('already full') ||
          lower.includes('battle has ended') ||
          lower.includes('maximum number of participants') ||
          lower.includes('capacity') ||
          text.includes('定員に達している') ||
          text.includes('定員') ||
          text.includes('参戦人数') ||
          text.includes('参加人数') ||
          text.includes('終了') ||
          text.includes('解散') ||
          text.includes('すでに終了') ||
          text.includes('既に終了') ||
          text.includes('すでにバトルが終了') ||
          text.includes('既に参戦中') ||
          text.includes('すでに参戦中')
        );

        if (isFullOrEnded) {
          const ok = modal.querySelector('.btn-usual-ok, .btn-usual-close, .btn-close') as HTMLElement;
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
}

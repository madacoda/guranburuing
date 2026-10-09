// src/sentinel-watchdog.ts
import path from 'path';
import { Page } from 'puppeteer-core';
import { AlertRelay } from './alert-relay.js';
import { ArtifactManager } from './core/artifact-manager.js';
import { discordDmRelay, CaptchaContext } from './relay/discord-dm-relay.js';

export type SentinelContext = CaptchaContext;

export interface SentinelOptions {
  enableTwoWayDiscord?: boolean;
  browserWaitTimeoutMs?: number;
  skipBrowserWaitOnHalt?: boolean;
}

export class SentinelWatchdog {
  private isLocked = false;
  private networkVerificationDetected = false;
  private alertRelay: AlertRelay;
  private options: SentinelOptions;
  private sessionContext: SentinelContext = {};

  public setSessionContext(ctx: Partial<SentinelContext>): void {
    this.sessionContext = { ...this.sessionContext, ...ctx };
  }

  public getSessionContext(): SentinelContext {
    return { ...this.sessionContext };
  }

  public clearContext(): void {
    this.sessionContext = {};
  }

  private readonly CAPTCHA_SELECTORS = [
    // 1. Core GBF verification containers
    '#cnt-verification',
    '.cnt-verification',
    '.prt-verification',
    '.pop-usual.verification',
    'div[class*="verification"][class*="pop"]',
    'div[id*="verification"]',
    'div[data-location-href*="verification"]',
    '.cnt-captcha',
    '.pop-captcha',

    // 2. GBF puzzle & tile elements
    '#c-a-i-frm-group',
    '.prt-c-a-i-input',
    '.prt-c-a-i-image',
    '.lis-c-a-i-image',
    'li.c-a-i-image',
    'img.img-verification',
    'img[src*="c/i?"]',
    'img[src*="/c/i?"]',
    'img.image[src*="c/i?"]',
    '.prt-popup-body .img-verification',

    // 3. Scoped inputs & submit buttons
    '#c-a-i-frm-group .btn-talk-message',
    '.prt-c-a-i-input .btn-talk-message',
    '.prt-c-a-i-input textarea',
    '#c-a-i-frm-group textarea',
    '.cnt-verification .btn-usual-ok',
    '.pop-usual.verification .btn-usual-ok',
    '.btn-verify',
    '.btn-talk-message',
    '.btn-send',

    // 4. External CAPTCHA & Security iframes / providers
    'iframe[src*="recaptcha"]',
    'iframe[src*="turnstile"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="hcaptcha"]',
    'iframe[src*="sec_challenge"]',
    '.geetest_holder',
    '.geetest_popup',
    '.cf-turnstile'
  ];

  constructor(
    private page: Page,
    alertRelay?: AlertRelay,
    options?: SentinelOptions
  ) {
    this.alertRelay = alertRelay || new AlertRelay();
    this.options = options || { enableTwoWayDiscord: true };
    this.setupNetworkListener();
  }

  public updatePage(newPage: Page): void {
    this.page = newPage;
    this.setupNetworkListener();
  }

  /**
   * Sets up proactive network-level interception of verification responses.
   */
  private setupNetworkListener(): void {
    if (!this.page || typeof this.page.on !== 'function') return;

    try {
      this.page.on('response', async (res) => {
        try {
          const currentUrl = typeof this.page.url === 'function' ? this.page.url() : '';
          // Ignore external auth providers (Mobage, DMM) loading recaptcha or auth scripts during normal login
          if (
            !currentUrl.includes('sec_challenge') &&
            (currentUrl.includes('mobage.jp') || currentUrl.includes('mbga.jp') || currentUrl.includes('dmm.com'))
          ) {
            return;
          }

          const url = res.url();

          // 1. Direct verification route or security challenge
          if (
            url.includes('/quest/verification') ||
            url.includes('/verification') ||
            url.includes('sec_challenge') ||
            url.includes('turnstile') ||
            url.includes('recaptcha')
          ) {
            this.networkVerificationDetected = true;
            this.isLocked = true;
            return;
          }

          // 2. Action API response JSON redirecting to verification
          if (
            url.includes('granbluefantasy.jp') &&
            (url.includes('/quest/') || url.includes('/rest/') || url.includes('/multiraid/'))
          ) {
            const headers = res.headers ? res.headers() : {};
            const contentType = headers['content-type'] || '';
            if (contentType.includes('application/json')) {
              const json = await res.json().catch(() => null);
              if (
                json &&
                (json.url?.includes('verification') ||
                 json.redirect?.includes('verification') ||
                 json.error === 'verification')
              ) {
                this.networkVerificationDetected = true;
                this.isLocked = true;
              }
            }
          }
        } catch {
          // Ignore transient response parsing errors on unrelated assets
        }
      });
    } catch {
      // Non-critical network hook setup
    }
  }

  /**
   * Scans the active page for any visual verification modal with context destruction protection.
   * Uses multi-layered detection: URL hash check, iframe checks, and atomic single-pass DOM evaluation.
   * When liveOnly is true, bypasses unconsumed network flags to check actual present page DOM/URL.
   */
  public async inspectForVerification(liveOnly = false): Promise<boolean> {
    try {
      const currentUrl = typeof this.page.url === 'function' ? this.page.url() : '';

      // 1. Instant URL / Hash check (0ms CDP overhead, immune to DOM states)
      if (
        currentUrl.includes('#quest/verification') ||
        currentUrl.includes('#verification') ||
        currentUrl.includes('/verification') ||
        currentUrl.includes('sec_challenge')
      ) {
        return true;
      }

      // Pre-check: Never trip in-game captcha alarms while on third-party login pages (unless sec_challenge)
      if (
        currentUrl.includes('mobage.jp') ||
        currentUrl.includes('mbga.jp') ||
        currentUrl.includes('dmm.com')
      ) {
        return false;
      }

      // Pre-check: Internal network detection flag (unless doing a live-only DOM inspection)
      if (!liveOnly && this.networkVerificationDetected) {
        return true;
      }

      // 2. Child frame / iframe URL check
      const frames = typeof this.page.frames === 'function' ? this.page.frames() : [];
      for (const frame of frames) {
        const frameUrl = typeof frame.url === 'function' ? frame.url() : '';
        if (
          frameUrl &&
          (frameUrl.includes('recaptcha') ||
           frameUrl.includes('turnstile') ||
           frameUrl.includes('challenges.cloudflare.com') ||
           frameUrl.includes('hcaptcha') ||
           frameUrl.includes('sec_challenge') ||
           frameUrl.includes('verification'))
        ) {
          return true;
        }
      }

      // 3. Atomic in-page DOM inspection (Single evaluate round-trip for all selectors & text)
      if (typeof this.page.evaluate === 'function') {
        const hasVerificationDom = await this.page.evaluate((selectors: string[]) => {
          const isElementVisible = (el: Element | null): boolean => {
            if (!el) return false;
            const htmlEl = el as HTMLElement;
            const style = window.getComputedStyle(htmlEl);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
              return false;
            }
            const rect = htmlEl.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          // 3a. Check targeted CAPTCHA selectors
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (let i = 0; i < els.length; i++) {
              if (isElementVisible(els[i])) return true;
            }
          }

          // 3b. Check active visible verification modals / headers / dialogs
          const modalElements = document.querySelectorAll(
            '.pop-usual, .prt-popup-body, .prt-popup-header, .txt-message, .cnt-error, #pop, .prt-dialog-body'
          );
          for (let i = 0; i < modalElements.length; i++) {
            const modal = modalElements[i] as HTMLElement;
            if (!isElementVisible(modal)) continue;

            const text = (modal.innerText || '').toLowerCase();
            if (
              text.includes('access verification') ||
              text.includes('verify access') ||
              text.includes('verification challenge') ||
              text.includes('enter the verification below') ||
              text.includes('画像認証') ||
              text.includes('アクセス認証') ||
              text.includes('セキュリティ認証') ||
              text.includes('不正アクセス防止') ||
              text.includes('歪んでいる文字') ||
              text.includes('表示されている画像')
            ) {
              return true;
            }
          }

          return false;
        }, this.CAPTCHA_SELECTORS).catch(() => false);

        if (hasVerificationDom) return true;
      }

      // If live inspection confirms DOM/URL has no verification, clear any lingering network flag
      if (this.networkVerificationDetected) {
        this.networkVerificationDetected = false;
      }

      return false;
    } catch {
      // Catch transient "Execution context was destroyed" during page transitions
      return false;
    }
  }

  /**
   * Ensures the CAPTCHA modal and challenge image are actively rendered on screen
   * before taking a diagnostic or resolution screenshot.
   */
  public async waitForActiveCaptchaRender(timeoutMs = 3500): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (typeof this.page.evaluate === 'function') {
          const isReady = await this.page.evaluate(() => {
            const isVisible = (el: HTMLElement | null): boolean => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                parseFloat(style.opacity || '1') > 0.1 &&
                el.offsetHeight > 0
              );
            };

            // Check security iframes
            const iframe = document.querySelector('iframe[src*="turnstile"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="sec_challenge"]');
            if (iframe && isVisible(iframe as HTMLElement)) return true;

            // Check modal visibility
            const modal = document.querySelector(
              '.pop-usual, #pop, .cnt-verification, #cnt-verification, .cnt-captcha, .prt-popup-body'
            ) as HTMLElement;

            if (modal && isVisible(modal)) {
              // Challenge image must be complete with positive dimensions
              const img = modal.querySelector('img.img-verification, img[src*="c/i"], .prt-c-a-i-image img, .prt-popup-body img') as HTMLImageElement;
              if (img) {
                return img.complete && img.naturalWidth > 0;
              }

              // Tile selection challenge
              const tiles = modal.querySelectorAll('li.c-a-i-image, .lis-c-a-i-image li');
              if (tiles.length > 0) return true;

              // Text input challenge
              const input = modal.querySelector('textarea, input[type="text"]');
              if (input && isVisible(input as HTMLElement)) return true;
            }

            return false;
          }).catch(() => false);

          if (isReady) {
            // Settle CSS transitions / animations
            await new Promise(r => setTimeout(r, 400));
            return true;
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  }

  /**
   * Clears any leftover text from the verification input field to ensure
   * screenshots are clean and subsequent attempts are unpolluted.
   */
  public async clearCaptchaInput(): Promise<void> {
    try {
      if (typeof this.page.evaluate === 'function') {
        await this.page.evaluate(() => {
          const input = document.querySelector(
            'textarea.frm-message, input.frm-message, .pop-usual textarea, #pop textarea, .prt-c-a-i-input textarea, .prt-c-a-i-input input, #c-a-i-frm-group textarea, #c-a-i-frm-group input, input[name*="verification"], textarea[name*="verification"]'
          ) as HTMLTextAreaElement | HTMLInputElement;
          if (input) {
            input.value = '';
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) {
              $(input).val('').trigger('input').trigger('change');
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }).catch(() => null);
      }
    } catch {}
  }

  /**
   * Dismisses any error or authentication failure popups that GBF might show
   * after an incorrect CAPTCHA code is submitted.
   */
  public async dismissErrorAlertIfPresent(): Promise<boolean> {
    try {
      if (typeof this.page.evaluate === 'function') {
        return await this.page.evaluate(() => {
          const $ = (window as any).$ || (window as any).Zepto;
          const popups = document.querySelectorAll('.pop-usual, #pop, .prt-popup-frame');
          for (let i = 0; i < popups.length; i++) {
            const popup = popups[i] as HTMLElement;
            const style = window.getComputedStyle(popup);
            if (style.display === 'none' || style.visibility === 'hidden') continue;

            const text = (popup.innerText || '').toLowerCase();
            const isError = text.includes('failed') ||
                            text.includes('error') ||
                            text.includes('失敗') ||
                            text.includes('エラー') ||
                            text.includes('不正');

            // Do not dismiss the main Access Verification prompt itself
            const isAccessVerificationPrompt = text.includes('access verification') && text.includes('enter the verification');
            if (isError && !isAccessVerificationPrompt) {
              const okBtn = popup.querySelector('.btn-usual-ok, .btn-usual-close, .btn-close') as HTMLElement;
              if (okBtn) {
                if ($) $(okBtn).trigger('tap');
                okBtn.click();
                return true;
              }
            }
          }
          return false;
        }).catch(() => false);
      }
    } catch {
      return false;
    }
    return false;
  }

  /**
   * Captures the full game viewport screenshot of the active CAPTCHA challenge.
   * Ensures the challenge is fully rendered before capture.
   */
  public async captureCaptchaArtifacts(): Promise<{ fullScreenshot: Buffer; puzzleCrop?: Buffer }> {
    const capturePath = ArtifactManager.getCapturePath({ namespace: 'captcha', label: 'viewport' });
    let fullScreenshot: Buffer = Buffer.alloc(0);

    // 1. Ensure the active CAPTCHA is fully rendered and stabilized
    await this.waitForActiveCaptchaRender(3500);

    // 2. Capture clean full viewport
    if (typeof this.page.screenshot === 'function') {
      try {
        fullScreenshot = (await this.page.screenshot({ path: capturePath, type: 'png' })) as Buffer;
        ArtifactManager.pruneOldCaptures(path.dirname(capturePath), 20);
        console.error(`[Sentinel] 📸 CAPTCHA Viewport: ${capturePath}`);
      } catch (err: any) {
        console.warn('[Sentinel] Failed to capture full viewport screenshot:', err.message);
      }
    }

    return { fullScreenshot };
  }

  /**
   * Evaluates safety invariant. Must be called before EVERY click and navigation.
   * Prompts operator via Discord DM (or browser) to resolve challenge before proceeding.
   */
  public async assertSafe(): Promise<void> {
    if (this.isLocked) {
      const resolved = await this.handleVerificationChallenge();
      if (!resolved) {
        throw new Error('SENTINEL_LOCKED: Automation frozen awaiting human manual resolution.');
      }
      return;
    }

    const hasCaptcha = await this.inspectForVerification();
    if (hasCaptcha) {
      const resolved = await this.handleVerificationChallenge();
      if (!resolved) {
        throw new Error('SENTINEL_HALT: Captcha detected and not resolved. Execution terminated to protect account.');
      }
    }
  }

  /**
   * Comprehensive interactive CAPTCHA resolution cycle.
   * Enters "CAPTCHA clear mode":
   * 1. Captures fresh artifacts (clean viewport).
   * 2. Prompts user on Discord DM (concise, displaying in-game player name).
   * 3. Listens for user reply while checking for in-browser external resolution.
   * 4. If user replies 'halt' / 'manual': pauses and waits for user to solve in browser.
   * 5. If user replies with code/tiles: attempts in-game submission.
   * 6. If submission clears challenge: sends concise success confirmation, unlocks, resumes!
   * 7. If submission fails: recaptures the new puzzle and loops again (up to 5 attempts).
   */
  public async handleVerificationChallenge(): Promise<boolean> {
    this.isLocked = true;
    if (typeof this.page.bringToFront === 'function') {
      await this.page.bringToFront().catch(() => null);
    }
    process.stdout.write('\x07\x07\x07');

    const displayName = this.sessionContext.playerName
      ? `${this.sessionContext.playerName}${this.sessionContext.accountId && this.sessionContext.accountId !== this.sessionContext.playerName ? ` (${this.sessionContext.accountId})` : ''}`
      : (this.sessionContext.accountId || 'Player');

    console.error('\n============================================================');
    console.error(' 🚨 CRITICAL: GBF CAPTCHA / VERIFICATION CHALLENGE DETECTED! ');
    console.error('============================================================');
    console.error(` 👤 Player:      ${displayName}`);
    if (this.sessionContext.questName) console.error(` ⚔️ Quest/Raid:  ${this.sessionContext.questName}`);
    if (this.sessionContext.raidId)    console.error(` 🆔 Raid ID:     ${this.sessionContext.raidId}`);
    if (this.sessionContext.runNumber !== undefined) console.error(` 🔄 Run:         #${this.sessionContext.runNumber}`);
    console.error(' 👉 Solve in browser or reply via Discord DM (reply "halt" to pause).');
    console.error('============================================================\n');

    const enableDiscord = this.options.enableTwoWayDiscord !== false && discordDmRelay.isConfigured();
    const MAX_ATTEMPTS = 5;

    if (enableDiscord) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Fast check if challenge was already cleared (live DOM check)
        const isStillThere = await this.inspectForVerification(true);
        if (!isStillThere) {
          console.log('[Sentinel] ✅ CAPTCHA is no longer present. Resuming...');
          await discordDmRelay.sendConfirmation(
            `✅ **CAPTCHA Cleared!**\nPlayer: **${displayName}** | Automation resumed.`
          );
          this.unlock();
          return true;
        }

        console.log(`[Sentinel] 🤖 [Attempt ${attempt}/${MAX_ATTEMPTS}] Capturing CAPTCHA artifacts...`);
        let artifacts: { fullScreenshot: Buffer; puzzleCrop?: Buffer } | null = null;
        try {
          artifacts = await this.captureCaptchaArtifacts();
        } catch (err: any) {
          console.error('[Sentinel] Failed capturing artifacts:', err.message);
        }

        if (!artifacts || !artifacts.fullScreenshot || artifacts.fullScreenshot.length === 0) {
          console.warn('[Sentinel] Could not capture screenshot artifacts. Falling back to browser wait.');
          break;
        }

        const contextWithAttempt: CaptchaContext = {
          ...this.sessionContext,
          attempt,
          maxAttempts: MAX_ATTEMPTS,
        };

        console.log(`[Sentinel] 📤 Sending challenge to Discord DM (Attempt ${attempt}/${MAX_ATTEMPTS})...`);
        const reply = await discordDmRelay.requestCaptchaResolution(
          artifacts,
          300000,
          async () => {
            const gone = !(await this.inspectForVerification(true));
            return gone;
          },
          contextWithAttempt
        );

        if (reply === 'RESOLVED_EXTERNALLY') {
          console.log('[Sentinel] ✅ CAPTCHA solved directly in browser window!');
          await discordDmRelay.sendConfirmation(
            `✅ **CAPTCHA Cleared in Browser!**\nPlayer: **${displayName}** | Automation resumed.`
          );
          this.unlock();
          return true;
        }

        if (reply === 'HALT_REQUESTED') {
          console.log(`[Sentinel] ⏸️ Operator requested manual halt via Discord DM.`);
          await discordDmRelay.sendConfirmation(
            `⏸️ **Automation Halted**\nPlayer: **${displayName}**\nPaused for manual solving. Solve in your browser; automation will auto-resume once cleared.`
          );
          return await this.waitForUserToSolveCaptcha(600000);
        }

        if (reply) {
          console.log(`[Sentinel] 📩 Submitting response code from Discord: "${reply}"...`);
          const solved = await this.submitCaptchaCode(reply);
          if (solved) {
            console.log('[Sentinel] ✅ CAPTCHA verified and dismissed successfully!');
            await discordDmRelay.sendConfirmation(
              `✅ **CAPTCHA Verified!**\nPlayer: **${displayName}** | Challenge cleared successfully. Resuming runs.`
            );
            this.unlock();
            return true;
          } else {
            console.warn(`[Sentinel] ⚠️ Code "${reply}" did not dismiss the CAPTCHA. Waiting for new puzzle to load...`);
            // Ensure error dialog is dismissed and clear text box so next attempt is fresh
            await this.dismissErrorAlertIfPresent();
            await this.clearCaptchaInput();
            await new Promise(r => setTimeout(r, 2000));
            // Continues loop to attempt + 1
          }
        } else {
          // Timeout
          console.warn(`[Sentinel] ⏱️ Discord reply timed out on attempt ${attempt}.`);
          break;
        }
      }
    }

    if (this.options.skipBrowserWaitOnHalt) {
      return false;
    }

    const waitTimeout = this.options.browserWaitTimeoutMs || 600000;
    // Fallback: wait for user to solve directly in browser
    console.log('[Sentinel] ⏱️ Waiting for operator to solve CAPTCHA in browser window...');
    return await this.waitForUserToSolveCaptcha(waitTimeout);
  }

  /**
   * Polls to determine if the verification modal is dismissed following submission.
   */
  public async pollForVerificationDismissal(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 500));

      const isStillPresent = await this.inspectForVerification(true);
      if (!isStillPresent) {
        this.unlock();
        console.log('[Sentinel] ✅ CAPTCHA solved and verified successfully!');
        return true;
      }

      // Check if GBF displayed an error modal indicating the code failed
      const errorDismissed = await this.dismissErrorAlertIfPresent();
      if (errorDismissed) {
        console.warn('[Sentinel] ⚠️ Verification error alert was shown and dismissed. Code was incorrect.');
        return false;
      }
    }

    console.warn('[Sentinel] ⚠️ Verification challenge still present after submission timeout.');
    return false;
  }

  /**
   * Submits a CAPTCHA response into the active in-game verification modal.
   * Handles both text input codes and picture-selection tile indices.
   */
  public async submitCaptchaCode(code: string): Promise<boolean> {
    try {
      console.log(`[Sentinel] Attempting to submit CAPTCHA response: "${code}"...`);
      const cleanCode = code.trim();

      if (typeof this.page.evaluate !== 'function') return false;

      // 1. Check for tile / image grid challenge first
      const tileResult = await this.page.evaluate((val: string) => {
        const $ = (window as any).$ || (window as any).Zepto;

        const tileElements = Array.from(document.querySelectorAll(
          'li.c-a-i-image, .lis-c-a-i-image > li, .prt-c-a-i-image li, .cnt-verification ul li, .pop-usual.verification li'
        )) as HTMLElement[];

        const visibleTiles = tileElements.filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
        });

        const tileIndices = val.split(/[\s,–#-]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);

        if (visibleTiles.length > 0 && tileIndices.length > 0) {
          for (const idx of tileIndices) {
            const tile = visibleTiles[idx - 1];
            if (tile) {
              if ($) $(tile).trigger('tap');
              tile.click();
              const img = tile.querySelector('img');
              if (img) {
                if ($) $(img).trigger('tap');
                (img as HTMLElement).click();
              }
            }
          }

          const btn = document.querySelector(
            '.btn-usual-ok.se-quest-start, .btn-usual-ok, .btn-verify, .btn-talk-message'
          ) as HTMLElement;

          if (btn) {
            if ($) $(btn).trigger('tap');
            btn.click();
          }

          return true;
        }

        return false;
      }, cleanCode);

      if (tileResult) {
        return await this.pollForVerificationDismissal();
      }

      // 2. Text Input Challenge (e.g. "g4h65f")
      const domResult = await this.page.evaluate((val: string) => {
        const $ = (window as any).$ || (window as any).Zepto;

        const input = document.querySelector(
          'textarea.frm-message, input.frm-message, .pop-usual textarea, #pop textarea, .prt-c-a-i-input textarea, .prt-c-a-i-input input, #c-a-i-frm-group textarea, #c-a-i-frm-group input, input[name*="verification"], textarea[name*="verification"], input[placeholder*="verification"], textarea[placeholder*="verification"], .pop-usual input[type="text"]'
        ) as HTMLTextAreaElement | HTMLInputElement;

        if (!input) return { foundInput: false };

        input.value = val;
        if ($) {
          $(input).val(val);
          $(input).trigger('input');
          $(input).trigger('change');
          $(input).trigger('keyup');
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));

        // Search for the "Send" button in modal container
        const container = input.closest('.pop-usual, #pop, .prt-popup-body, .cnt-verification, form, .prt-c-a-i-input, #c-a-i-frm-group') || document.body;

        const candidates = Array.from(container.querySelectorAll(
          'div, button, a, span, input[type="button"], input[type="submit"]'
        )) as HTMLElement[];

        // Priority 1: Exact text match ("Send", "送信")
        let btn = candidates.find(el => {
          const txt = (el.innerText || el.textContent || (el as HTMLInputElement).value || '').trim();
          if (/^(send|送信)$/i.test(txt)) {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
          }
          return false;
        });

        // Priority 2: Standard class selectors
        if (!btn) {
          const selectors = [
            '.btn-talk-message',
            '.btn-post',
            '.btn-send',
            '.btn-usual-text',
            '.btn-usual-ok',
            '.btn-verify',
            '.btn-submit',
            '[class*="btn-talk"]',
            '[class*="btn-send"]',
            '[class*="btn-post"]'
          ];
          for (const sel of selectors) {
            const el = container.querySelector(sel) as HTMLElement;
            if (el) {
              const style = window.getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0) {
                btn = el;
                break;
              }
            }
          }
        }

        // Priority 3: Fallback button text
        if (!btn) {
          btn = candidates.find(el => {
            const txt = (el.innerText || el.textContent || (el as HTMLInputElement).value || '').trim();
            if (/^(ok|verify|決定|認証)$/i.test(txt)) {
              const style = window.getComputedStyle(el);
              return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            }
            return false;
          });
        }

        let buttonClicked = false;
        let btnBox: { x: number; y: number; width: number; height: number } | null = null;

        if (btn) {
          if ($) {
            $(btn).trigger('touchstart');
            $(btn).trigger('touchend');
            $(btn).trigger('tap');
          }
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          btn.click();
          buttonClicked = true;

          const rect = btn.getBoundingClientRect();
          btnBox = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        }

        return { foundInput: true, buttonClicked, btnBox };
      }, cleanCode);

      if (!domResult || !domResult.foundInput) {
        console.warn('[Sentinel] ⚠️ Could not locate verification input field in DOM.');
        return false;
      }

      // Step 2b: Native Puppeteer / CDP typing & physical click
      try {
        const inputEl = await this.page.$(
          'textarea.frm-message, input.frm-message, .pop-usual textarea, #pop textarea, .prt-c-a-i-input textarea, .prt-c-a-i-input input, input[name*="verification"]'
        );
        if (inputEl) {
          await inputEl.click().catch(() => null);
          await inputEl.focus().catch(() => null);
          await this.page.keyboard.down('Control').catch(() => null);
          await this.page.keyboard.press('KeyA').catch(() => null);
          await this.page.keyboard.up('Control').catch(() => null);
          await this.page.keyboard.press('Backspace').catch(() => null);
          await this.page.keyboard.type(cleanCode, { delay: 40 }).catch(() => null);
        }

        if (domResult.btnBox && domResult.btnBox.width > 0) {
          const cx = domResult.btnBox.x + domResult.btnBox.width / 2;
          const cy = domResult.btnBox.y + domResult.btnBox.height / 2;
          if (this.page.mouse) {
            await this.page.mouse.click(cx, cy).catch(() => null);
          }
          if (this.page.touchscreen) {
            await this.page.touchscreen.tap(cx, cy).catch(() => null);
          }
        }
      } catch (cdpErr: any) {
        console.warn('[Sentinel] CDP typing/click warning:', cdpErr.message);
      }

      console.log(`[Sentinel] 🚀 Submitted code "${cleanCode}". Awaiting verification response...`);
      return await this.pollForVerificationDismissal();
    } catch (err: any) {
      console.error('[Sentinel] Error submitting CAPTCHA code:', err.message);
      return false;
    }
  }

  /**
   * Pauses and waits for the user to manually solve the captcha in their browser.
   * Resolves when the verification challenge disappears.
   */
  public async waitForUserToSolveCaptcha(timeoutMs = 600000): Promise<boolean> {
    console.log(`[Sentinel] ⏱️ Waiting for operator to solve CAPTCHA in browser (up to ${Math.round(timeoutMs / 60000)} minutes)...`);
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 2500));

      const stillHasCaptcha = await this.inspectForVerification(true);
      if (!stillHasCaptcha) {
        this.unlock();
        console.log('\n✅ [Sentinel] CAPTCHA resolved in browser! Resuming automation safely.\n');
        if (discordDmRelay.isConfigured()) {
          const displayName = this.sessionContext.playerName
            ? `${this.sessionContext.playerName}${this.sessionContext.accountId && this.sessionContext.accountId !== this.sessionContext.playerName ? ` (${this.sessionContext.accountId})` : ''}`
            : (this.sessionContext.accountId || 'Player');
          await discordDmRelay.sendConfirmation(
            `✅ **CAPTCHA Cleared in Browser!**\nPlayer: **${displayName}** | Automation resumed.`
          );
        }
        return true;
      }
    }

    console.error(`[Sentinel] ❌ Captcha wait timed out after ${Math.round(timeoutMs / 60000)} minutes.`);
    return false;
  }

  /**
   * Clears the lock after the user manually solves the challenge.
   */
  public unlock(): void {
    this.isLocked = false;
    this.networkVerificationDetected = false;
    console.log('[Sentinel] Lock released. Automation re-armed.');
  }

  public get isArmed(): boolean {
    return !this.isLocked && !this.networkVerificationDetected;
  }
}

// src/sentinel-watchdog.ts
import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer-core';
import { AlertRelay } from './alert-relay.js';
import { ArtifactManager } from './core/artifact-manager.js';
import { discordDmRelay } from './relay/discord-dm-relay.js';

export class SentinelWatchdog {
  private isLocked = false;
  private alertRelay: AlertRelay;

  private readonly CAPTCHA_SELECTORS = [
    '.prt-c-a-i-input',
    '#c-a-i-frm-group',
    '.btn-talk-message',
    'img[src*="c/i?"]',
    'img.image[src*="c/i"]',
    'textarea.frm-message',
    '.prt-popup-body .img-verification',
    '.pop-usual.verification',
    'div[class*="verification"]',
    'div[id*="verification"]',
    '.cnt-verification',
    '#cnt-verification',
    '.prt-verification',
    'img.img-verification',
    '.btn-verify',
    '.cnt-captcha',
    '.pop-captcha',
    'div[data-location-href*="verification"]'
  ];

  constructor(
    private page: Page,
    alertRelay?: AlertRelay
  ) {
    this.alertRelay = alertRelay || new AlertRelay();
  }

  public updatePage(newPage: Page): void {
    this.page = newPage;
  }

  /**
   * Scans the active page for any visual verification modal with context destruction protection.
   */
  public async inspectForVerification(): Promise<boolean> {
    try {
      // 1. Selector-based detection
      for (const selector of this.CAPTCHA_SELECTORS) {
        const isVisible = await this.page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const style = window.getComputedStyle(el);
          return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }, selector).catch(() => false);

        if (isVisible) return true;
      }

      // 2. Text / modal based detection for authentication challenges
      const hasVerificationText = await this.page.evaluate(() => {
        const modals = Array.from(document.querySelectorAll('.pop-usual, .prt-popup-body, .prt-popup-header, .txt-message, .cnt-error'));
        return modals.some(m => {
          const text = ((m as HTMLElement).innerText || '').toLowerCase();
          return text.includes('access verification') ||
                 text.includes('verify access') ||
                 text.includes('enter the verification below') ||
                 text.includes('画像認証') ||
                 text.includes('認証') ||
                 text.includes('verification') ||
                 text.includes('verification challenge');
        });
      }).catch(() => false);

      if (hasVerificationText) return true;

    } catch (e: any) {
      // Catch transient "Execution context was destroyed" during page transitions
      return false;
    }
    return false;
  }


  /**
   * Captures both the isolated picture puzzle crop and the full game viewport screenshot.
   */
  public async captureCaptchaArtifacts(): Promise<{ fullScreenshot: Buffer; puzzleCrop?: Buffer }> {
    const capturePath = ArtifactManager.getCapturePath({ namespace: 'captcha', label: 'viewport' });
    const fullScreenshot = (await this.page.screenshot({ path: capturePath, type: 'png' })) as Buffer;
    ArtifactManager.pruneOldCaptures(path.dirname(capturePath), 20);

    let puzzleCrop: Buffer | undefined;
    try {
      // Find the visual puzzle container or modal holding the picture verification
      const puzzleEl = await this.page.$(
        '.pop-usual, .prt-popup-body, .cnt-verification, #cnt-verification, .pop-captcha, .prt-c-a-i-input, #c-a-i-frm-group, .prt-c-a-i-image, img.image[src*="c/i"], img.img-verification'
      );
      if (puzzleEl) {
        const box = await puzzleEl.boundingBox();
        if (box && box.width > 20 && box.height > 20) {
          const cropPath = path.resolve(path.dirname(capturePath), `captcha-puzzle-${Date.now()}.png`);
          puzzleCrop = (await puzzleEl.screenshot({ path: cropPath, type: 'png' })) as Buffer;
          console.error(`[Sentinel] 🔍 CAPTCHA Puzzle Crop: ${cropPath}`);
        }
      }
    } catch (err: any) {
      console.warn('[Sentinel] Transient error capturing puzzle crop:', err.message);
    }

    console.error(`[Sentinel] 📸 CAPTCHA Viewport: ${capturePath}`);
    return { fullScreenshot, puzzleCrop };
  }

  /**
   * Evaluates safety invariant. Must be called before EVERY click and navigation.
   * Throws an error to immediately abort execution if verification is present or locked.
   */
  public async assertSafe(): Promise<void> {
    if (this.isLocked) {
      throw new Error('SENTINEL_LOCKED: Automation frozen awaiting human manual resolution.');
    }

    const hasCaptcha = await this.inspectForVerification();
    if (hasCaptcha) {
      this.isLocked = true;
      // Bring tab to front so user sees the puzzle immediately
      await this.page.bringToFront().catch(() => null);

      // Emit terminal audible alert beeps
      process.stdout.write('\x07\x07\x07');

      console.error('\n============================================================');
      console.error(' 🚨 CRITICAL: GBF CAPTCHA / VERIFICATION CHALLENGE DETECTED! ');
      console.error('============================================================');
      console.error(' 👉 Automation has HARD-FROZEN to protect your account.');
      console.error(' 👉 Browser navigation is BLOCKED to keep the puzzle visible.');
      console.error(' 👉 Solve the CAPTCHA in your browser or reply via Discord DM.');
      console.error('============================================================\n');

      let capturedArtifacts: { fullScreenshot: Buffer; puzzleCrop?: Buffer } | null = null;
      try {
        capturedArtifacts = await this.captureCaptchaArtifacts();
        await this.alertRelay.sendEmergencyAlert(
          'Verification CAPTCHA detected on desktop! Automation has been HARD-FROZEN. Please solve the puzzle in your browser or reply to Discord DM.',
          capturedArtifacts.fullScreenshot
        );
      } catch (err: any) {
        console.error('[Sentinel] Failed to capture screenshot:', err.message);
      }

      // Two-way Discord DM Human-in-the-Loop Resolution
      if (capturedArtifacts && discordDmRelay.isConfigured()) {
        try {
          console.log('[Sentinel] 🤖 Requesting human CAPTCHA resolution via Discord DM...');
          const userCode = await discordDmRelay.requestCaptchaResolution(capturedArtifacts, 300000);
          if (userCode) {
            console.log(`[Sentinel] 📩 Received resolution code from Discord DM: "${userCode}". Submitting...`);
            const solved = await this.submitCaptchaCode(userCode);
            if (solved) {
              await discordDmRelay.sendConfirmation(
                `✅ **CAPTCHA Verified!**\nChallenge cleared successfully. Automation has resumed automatically.`
              );
              this.unlock();
              return;
            } else {
              await discordDmRelay.sendConfirmation(
                `❌ **CAPTCHA Submission Failed**\nThe code "${userCode}" did not dismiss the challenge. Automation is halted to protect your account.`
              );
            }
          }
        } catch (relayErr: any) {
          console.error('[Sentinel] Discord DM resolution failed:', relayErr.message);
        }
      }

      throw new Error('SENTINEL_HALT: Captcha detected. Execution terminated to protect account.');
    }
  }

  /**
   * Submits a CAPTCHA response into the active in-game verification modal.
   * Handles both text input codes and picture-selection tile indices.
   */
  public async submitCaptchaCode(code: string): Promise<boolean> {
    try {
      console.log(`[Sentinel] Attempting to submit CAPTCHA response via DOM: "${code}"...`);

      // 1. First attempt: Text / Character input fields
      const textSuccess = await this.page.evaluate((val: string) => {
        const input = document.querySelector('.prt-c-a-i-input textarea, textarea.frm-message, input[name*="verification"]') as HTMLTextAreaElement | HTMLInputElement;
        const btn = document.querySelector('.btn-talk-message, .btn-usual-ok.se-quest-start, .btn-verify') as HTMLElement;
        if (input && btn) {
          input.value = val;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
          return true;
        }
        return false;
      }, code);

      // 2. Second attempt: Picture Grid / Tile Selection (e.g. "1 3" or "2")
      let tileSuccess = false;
      if (!textSuccess) {
        tileSuccess = await this.page.evaluate((val: string) => {
          const tiles = Array.from(document.querySelectorAll(
            '.lis-c-a-i-image, li.c-a-i-image, .prt-c-a-i-image li, .cnt-verification ul li, .pop-usual .prt-popup-body li, .prt-c-a-i-image img'
          )) as HTMLElement[];

          const indices = val.split(/[\s,-]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
          if (tiles.length > 0 && indices.length > 0) {
            for (const idx of indices) {
              const tile = tiles[idx - 1]; // 1-indexed for human convenience
              if (tile) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(tile).trigger('tap');
                tile.click();
              }
            }

            const btn = document.querySelector('.btn-usual-ok, .btn-verify, .btn-talk-message') as HTMLElement;
            if (btn) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
            }
            return true;
          }
          return false;
        }, code);
      }

      if (textSuccess || tileSuccess) {
        const btnEl = await this.page.$('.btn-talk-message, .btn-usual-ok.se-quest-start, .btn-verify');
        if (btnEl) {
          const box = await btnEl.boundingBox();
          if (box && box.width > 0) {
            await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
            await this.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2).catch(() => null);
          }
        }

        await new Promise(r => setTimeout(r, 2000));
        const stillHas = await this.inspectForVerification();
        if (!stillHas) {
          this.unlock();
          console.log('[Sentinel] ✅ CAPTCHA solved and verified successfully!');
          return true;
        } else {
          console.warn('[Sentinel] ⚠️ Verification modal still present. Code may have been incorrect or still verifying.');
          return false;
        }
      }
      return false;
    } catch (err: any) {
      console.error('[Sentinel] Error submitting CAPTCHA code:', err.message);
      return false;
    }
  }

  /**
   * Pauses and waits for the user to manually solve the captcha in their browser.
   * Resolves when the verification challenge disappears.
   */
  public async waitForUserToSolveCaptcha(timeoutMs = 300000): Promise<boolean> {
    console.log('[Sentinel] ⏱️ Waiting for user to solve captcha in browser (up to 5 minutes)...');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 2500));

      const stillHasCaptcha = await this.inspectForVerification();
      if (!stillHasCaptcha) {
        this.unlock();
        console.log('\n✅ [Sentinel] CAPTCHA resolved! Resuming automation safely.\n');
        return true;
      }
    }

    console.error('[Sentinel] ❌ Captcha wait timed out after 5 minutes.');
    return false;
  }

  /**
   * Clears the lock after the user manually solves the challenge.
   */
  public unlock(): void {
    this.isLocked = false;
    console.log('[Sentinel] Lock released. Automation re-armed.');
  }

  public get isArmed(): boolean {
    return !this.isLocked;
  }
}

// src/sentinel-watchdog.ts
import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer-core';
import { AlertRelay } from './alert-relay.js';
import { ArtifactManager } from './core/artifact-manager.js';

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
      console.error(' 👉 Solve the CAPTCHA in your browser or enter code in CLI.');
      console.error('============================================================\n');

      try {
        const capturePath = ArtifactManager.getCapturePath({ namespace: 'captcha', label: 'detected' });
        const screenshot = (await this.page.screenshot({ path: capturePath, type: 'png' })) as Buffer;
        ArtifactManager.pruneOldCaptures(path.dirname(capturePath), 20);

        // Also capture isolated captcha crop if image element exists
        const cropPath = path.resolve(path.dirname(capturePath), `captcha-crop-${Date.now()}.png`);
        const imgEl = await this.page.$('img.image[src*="c/i"], img.image, .prt-c-a-i-input img, .pop-usual img');
        if (imgEl) {
          await imgEl.screenshot({ path: cropPath }).catch(() => null);
        }

        console.error(`[Sentinel] 📸 CAPTCHA Screenshot: ${capturePath}`);
        if (fs.existsSync(cropPath)) {
          console.error(`[Sentinel] 🔍 CAPTCHA Image Crop: ${cropPath}`);
        }

        await this.alertRelay.sendEmergencyAlert(
          'Verification CAPTCHA detected on desktop! Automation has been HARD-FROZEN. Please solve the puzzle in your browser.',
          screenshot
        );
      } catch (err: any) {
        console.error('[Sentinel] Failed to capture screenshot:', err.message);
      }

      throw new Error('SENTINEL_HALT: Captcha detected. Execution terminated to protect account.');
    }
  }

  /**
   * Submits a CAPTCHA response string into the active in-game verification modal.
   */
  public async submitCaptchaCode(code: string): Promise<boolean> {
    try {
      console.log(`[Sentinel] Attempting to submit CAPTCHA response via DOM: "${code}"...`);
      const success = await this.page.evaluate((val: string) => {
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

      if (success) {
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

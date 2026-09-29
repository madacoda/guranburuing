// src/auth/account-auth.manager.ts
import { Page } from 'puppeteer-core';
import { AccountConfig, VerifiedPlayerProfile } from '../types/account.types.js';
import { logNormalDelay, humanReactionDelay } from '../human-motor.js';

export class AccountAuthManager {
  /**
   * Navigates to https://game.granbluefantasy.jp/#profile and obtains verified in-game player details.
   * Returns null if unauthenticated or redirected to title/login screen.
   */
  public static async getVerifiedProfile(page: Page): Promise<VerifiedPlayerProfile | null> {
    try {
      // 1. Fast check if active page is already authenticated (#mypage, #profile, header)
      const instant = await page.evaluate(() => {
        const Game = (window as any).Game;
        const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
        const rankEl = document.querySelector('.prt-rank-value');
        const idEl = document.querySelector('.prt-user-id, .txt-user-id');
        const hasUserInfo = !!document.querySelector('.prt-user-info, .cnt-mypage, .prt-header');

        if (Game?.userId || hasUserInfo) {
          let cleanName = nameEl?.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || (Game?.userName ? String(Game.userName) : 'Player');
          let cleanRank = rankEl?.textContent?.trim() || 'Unknown';
          const id = Game?.userId ? String(Game.userId) : (idEl?.textContent?.replace(/[^0-9]/g, '') || 'Unknown');
          return { name: cleanName, rank: cleanRank, id };
        }
        return null;
      }).catch(() => null);

      if (instant) {
        return instant;
      }

      // 2. Navigate to #profile if not yet on GBF
      const currentUrl = page.url();
      if (!currentUrl.includes('granbluefantasy.jp')) {
        await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
      } else {
        await page.evaluate(() => {
          window.location.hash = '#profile';
        }).catch(() => null);
      }

      // Wait up to 8s for #profile DOM elements to mount or true redirect to occur
      const start = Date.now();
      while (Date.now() - start < 8000) {
        const hash = await page.evaluate(() => window.location.hash).catch(() => '');
        const url = page.url();

        // Only treat as unauthenticated redirect if at least 2.5s have elapsed (giving router time to mount)
        const elapsed = Date.now() - start;
        const isAuthRedirect = (hash.includes('login') && !hash.includes('loginbonus')) || hash.includes('authentication') || (elapsed > 2500 && hash.includes('top')) || url.includes('mbga.jp') || url.includes('dmm.com');
        if (isAuthRedirect) {
          return null;
        }

        // If on loginbonus daily screen, dismiss modal and re-route to #profile
        if (hash.includes('loginbonus')) {
          await page.evaluate(() => {
            const btn = document.querySelector('.btn-usual-ok, .btn-usual-close, .btn-close, .pop-usual .btn-usual-ok, [class*="close"]') as HTMLElement;
            if (btn) btn.click();
            window.location.hash = '#profile';
          }).catch(() => null);
        }

        const data = await page.evaluate(() => {
          const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
          const rankEl = document.querySelector('.prt-rank-value');
          const idEl = document.querySelector('.prt-user-id, .txt-user-id');
          const gameUserId = (window as any).Game?.userId;

          let cleanName = nameEl?.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || null;
          let cleanRank = rankEl?.textContent?.trim() || null;
          if (cleanName && cleanName.includes('Rank')) {
            const parts = cleanName.split(/Rank\s*/);
            cleanName = parts[0].trim();
            if (!cleanRank && parts[1]) {
              cleanRank = parts[1].trim();
            }
          }
          const id = gameUserId ? String(gameUserId) : (idEl?.textContent?.replace(/[^0-9]/g, '') || null);

          if (cleanName) {
            return { name: cleanName, rank: cleanRank || 'Unknown', id: id || 'Unknown' };
          }
          return null;
        }).catch(() => null);

        if (data && data.name) {
          return data;
        }

        await new Promise(r => setTimeout(r, 400));
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fast check to verify if the account's existing session is active.
   */
  public static async isSessionActive(page: Page): Promise<boolean> {
    const profile = await this.getVerifiedProfile(page);
    return !!profile;
  }

  /**
   * Ensures the page is authenticated for the given account.
   * Navigates to #profile, verifies in-game player name and rank, or performs on-demand login.
   */
  public static async ensureAuthenticated(page: Page, account: AccountConfig): Promise<VerifiedPlayerProfile | null> {
    console.log(`[Auth] Verifying in-game identity on #profile for account [${account.name}]...`);
    let profile = await this.getVerifiedProfile(page);
    if (profile) {
      console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
      return profile;
    }

    console.log(`[Auth] Account [${account.name}] session is NOT authenticated (redirected to title/login).`);
    console.log(`[Auth] Triggering on-demand authentication (Service: ${account.service.toUpperCase()})...`);

    // 1. If on Title screen (#top), check Game Start (#start) or login options safely
    const currentHash = await page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash.includes('top') || currentHash === '' || currentHash === '#') {
      try {
        const hasStart = await page.evaluate(() => {
          const btn = document.querySelector('#start, .btn-start, [data-location-href="start"]') as HTMLElement;
          if (btn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
            return true;
          }
          return false;
        }).catch(() => false);

        if (hasStart) {
          console.log(`[Auth] [${account.name}] Triggered Game Start (#start)...`);
          await logNormalDelay(2500, 0.15);

          profile = await this.getVerifiedProfile(page);
          if (profile) {
            console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
            return profile;
          }
        }
      } catch (clickErr: any) {
        console.warn(`[Auth] [${account.name}] Game start click deferred: ${clickErr?.message || clickErr}`);
      }
    }

    // 2. If unauthenticated on #top or #authentication, check in-game authentication buttons
    const authState = await page.evaluate(() => {
      const hash = window.location.hash;
      const hasLoginBtn = !!document.querySelector('#login-auth, .btn-login');
      const isAuthPage = hash.includes('authentication') || !!document.querySelector('.prt-select-auth, .btn-auth-platform');
      return { hash, hasLoginBtn, isAuthPage };
    }).catch(() => ({ hash: '', hasLoginBtn: false, isAuthPage: false }));

    if (authState.hasLoginBtn) {
      console.log(`[Auth] [${account.name}] Clicking Login button (#login-auth)...`);
      await page.evaluate(() => {
        const btn = document.querySelector('#login-auth, .btn-login') as HTMLElement;
        if (btn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
        }
      }).catch(() => null);
      await logNormalDelay(2000, 0.15);
    }

    // If on #authentication screen, select platform (Mobage/DMM) and proceed
    const isNowAuth = await page.evaluate(() => {
      return window.location.hash.includes('authentication') || !!document.querySelector('.btn-auth-platform');
    }).catch(() => false);

    if (isNowAuth) {
      console.log(`[Auth] [${account.name}] Selecting platform [${account.service}] on authentication screen...`);
      await page.evaluate((service) => {
        const platformBtn = document.querySelector(`.btn-auth-platform[data-platform="${service}"], .btn-auth-platform`) as HTMLElement;
        if (platformBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(platformBtn).trigger('tap');
          platformBtn.click();
        }
      }, account.service).catch(() => null);
      await logNormalDelay(1000, 0.15);

      await page.evaluate(() => {
        const ok = document.querySelector('.btn-ok:not(.disable)') as HTMLElement;
        if (ok) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(ok).trigger('tap');
          ok.click();
        }
      }).catch(() => null);
      await logNormalDelay(3000, 0.15);

      // Check if popup tab opened (e.g. Mobage OAuth connect popup)
      try {
        const browser = page.browser();
        const pages = await browser.pages();
        for (const p of pages) {
          if (p !== page && p.url().includes('connect.mobage.jp')) {
            console.log(`[Auth] [${account.name}] Handling Mobage connect popup window...`);
            await p.evaluate(() => {
              const closeBtn = document.querySelector('a, button, [class*="close"], [class*="btn"]') as HTMLElement;
              if (closeBtn) closeBtn.click();
            }).catch(() => null);
            await logNormalDelay(2000, 0.15);
          }
        }
      } catch {}

      profile = await this.getVerifiedProfile(page);
      if (profile) {
        console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
        return profile;
      }
    }

    // 2. Perform automated login if credentials are provided
    if (account.credentials?.email && account.credentials?.password) {
      let loginOk = false;
      if (account.service === 'mobage') {
        loginOk = await this.loginMobage(page, account);
      } else if (account.service === 'dmm') {
        loginOk = await this.loginDmm(page, account);
      }
      if (loginOk) {
        profile = await this.getVerifiedProfile(page);
        if (profile) {
          console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
          return profile;
        }
      }
    }

    // 3. Fallback: Manual assisted login (audible prompt)
    console.log('\n\x07');
    console.log('========================================================================');
    console.log(` 🔑 ONE-TIME LOGIN REQUIRED: Account [${account.name}] (${account.id}) `);
    console.log('========================================================================');
    console.log(` 👉 Please complete the 1-time login in the open browser window.`);
    console.log(` 👉 Once you reach in-game, your profile will be verified automatically.`);
    console.log('========================================================================\n');

    const startWait = Date.now();
    while (Date.now() - startWait < 300000) {
      profile = await this.getVerifiedProfile(page);
      if (profile) {
        console.log(`[Auth] 🎉 Verified Player: "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})!`);
        return profile;
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    return null;
  }

  /**
   * Automated credential login for Mobage.
   */
  private static async loginMobage(page: Page, account: AccountConfig): Promise<boolean> {
    const email = account.credentials?.email || '';
    const password = account.credentials?.password || '';
    if (!email || !password) {
      console.warn(`[Auth] [${account.name}] Missing credentials for Mobage login.`);
      return false;
    }
    console.log(`[Auth] [${account.name}] Performing automated Mobage login for: ${email}`);

    // If not already on Mobage login, navigate there
    if (!page.url().includes('mbga.jp')) {
      await page.goto('https://ssl.sp.mbga.jp/_login', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1500, 0.15);
    }

    // Wait for login inputs safely
    const emailInput = await page.waitForSelector('#login_id, input[name="login_id"]', { visible: true, timeout: 8000 }).catch(() => null);
    if (!emailInput) return false;
    const passInput = await page.$('#login_pw, input[name="login_pw"]').catch(() => null);
    if (!passInput) return false;

    if (emailInput && passInput) {
      await humanReactionDelay(80, 0.10);
      await emailInput.click({ clickCount: 3 });
      await emailInput.type(email, { delay: 40 });

      await humanReactionDelay(80, 0.10);
      await passInput.click({ clickCount: 3 });
      await passInput.type(password, { delay: 40 });

      await humanReactionDelay(120, 0.10);
      const submitBtn = await page.$('.btn-login, input[type="submit"], button[type="submit"]');
      if (submitBtn) {
        console.log(`[Auth] [${account.name}] Submitting Mobage credentials...`);
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
          submitBtn.click()
        ]);
      }
    }

    // Check if verification challenge (CAPTCHA / 2FA OTP) appeared
    const hasChallenge = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      return (
        bodyText.includes('captcha') ||
        bodyText.includes('verification') ||
        bodyText.includes('認証コード') ||
        bodyText.includes('確認コード') ||
        !!document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, #auth_code')
      );
    }).catch(() => false);

    if (hasChallenge) {
      console.log('\n\x07\x07');
      console.log('========================================================================');
      console.log(` 🚨 VERIFICATION CHALLENGE / 2FA DETECTED for [${account.name}] `);
      console.log('========================================================================');
      console.log(' 👉 Please complete the verification challenge or enter your email OTP.');
      console.log(' 👉 Waiting for successful navigation to #mypage...');
      console.log('========================================================================\n');
    }

    // Navigate to GBF #mypage if redirected to Mobage portal
    if (page.url().includes('mbga.jp')) {
      await logNormalDelay(2000, 0.15);
      await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
    }

    return await this.waitForMypage(page, 60000);
  }

  /**
   * Automated credential login for DMM.
   */
  private static async loginDmm(page: Page, account: AccountConfig): Promise<boolean> {
    const email = account.credentials?.email || '';
    const password = account.credentials?.password || '';
    if (!email || !password) {
      console.warn(`[Auth] [${account.name}] Missing credentials for DMM login.`);
      return false;
    }
    console.log(`[Auth] [${account.name}] Performing automated DMM login for: ${email}`);

    if (!page.url().includes('accounts.dmm.com')) {
      await page.goto('https://accounts.dmm.com/service/login/password', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(1500, 0.15);
    }

    const idInput = await page.waitForSelector('#login_id, input[name="login_id"]', { visible: true, timeout: 8000 }).catch(() => null);
    const pwInput = await page.$('#password, input[name="password"]');

    if (idInput && pwInput) {
      await humanReactionDelay(80, 0.10);
      await idInput.click({ clickCount: 3 });
      await idInput.type(email, { delay: 40 });

      await humanReactionDelay(80, 0.10);
      await pwInput.click({ clickCount: 3 });
      await pwInput.type(password, { delay: 40 });

      await humanReactionDelay(120, 0.10);
      const submitBtn = await page.$('input[type="submit"], button[type="submit"], .btn-login');
      if (submitBtn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null),
          submitBtn.click()
        ]);
      }
    }

    await logNormalDelay(2500, 0.15);
    await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
    return await this.waitForMypage(page, 60000);
  }

  /**
   * Helper that polls until the page lands on #mypage or #quest.
   */
  private static async waitForMypage(page: Page, timeoutMs = 60000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const hash = await page.evaluate(() => window.location.hash).catch(() => '');
      if (hash.includes('mypage') || hash.includes('quest') || hash.includes('raid')) {
        console.log('[Auth] Authenticated session confirmed on #mypage!');
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.warn('[Auth] Timed out waiting for #mypage.');
    return false;
  }
}

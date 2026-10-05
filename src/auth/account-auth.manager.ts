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
      // 0. Fast direct API verification (authoritative in-game check)
      const apiProfile = await page.evaluate(async () => {
        try {
          let version = (window as any).Game?.version || (window as any).version || '';
          if (!version) {
            for (let i = 0; i < 10 && !version; i++) {
              await new Promise(r => setTimeout(r, 300));
              version = (window as any).Game?.version || (window as any).version || '';
            }
          }
          const headers: Record<string, string> = {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          };
          if (version) headers['X-VERSION'] = String(version);

          const [rStatus, rUser] = await Promise.all([
            fetch(`/user/status?_=${Date.now()}`, { headers }),
            fetch(`/user/user_id/0?_=${Date.now()}`, { headers })
          ]);
          if (!rStatus.ok) return null;
          const statusJson = await rStatus.json().catch(() => null);
          const userJson = await rUser.json().catch(() => null);

          if (statusJson?.status?.level && userJson?.user_id) {
            const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
            const cleanName = nameEl?.textContent?.trim() || g?.userName || 'Player';
            return {
              name: cleanName,
              rank: String(statusJson.status.level),
              id: String(userJson.user_id)
            };
          }
          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (apiProfile) {
        return apiProfile;
      }

      // 1. Fast check if active page DOM is already authenticated (#mypage, #profile, header)
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

      // 2. Navigate to #mypage if not yet on GBF
      const currentUrl = page.url();
      if (!currentUrl.includes('granbluefantasy.jp')) {
        await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
      } else {
        await page.evaluate(() => {
          window.location.hash = '#mypage';
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

    // 0. If already on Mobage/DMM login portal, perform automated login immediately
    if (page.url().includes('mobage.jp') || page.url().includes('mbga.jp')) {
      if (account.credentials?.email && account.credentials?.password) {
        console.log(`[Auth] [${account.name}] Currently on Mobage portal. Performing automated login...`);
        const ok = await this.loginMobage(page, account);
        if (ok) {
          profile = await this.getVerifiedProfile(page);
          if (profile) return profile;
        }
      }
    }

    // 1. If unauthenticated on Title (#top) or #authentication, prioritize Login button (#login-auth / データ連携)
    const authState = await page.evaluate(() => {
      const hash = window.location.hash;
      const hasLoginBtn = !!document.querySelector('#login-auth, .btn-login');
      const isAuthPage = hash.includes('authentication') || !!document.querySelector('.prt-select-auth, .btn-auth-platform');
      return { hash, hasLoginBtn, isAuthPage };
    }).catch(() => ({ hash: '', hasLoginBtn: false, isAuthPage: false }));

    if (authState.hasLoginBtn) {
      console.log(`[Auth] [${account.name}] Clicking Login button (#login-auth / データ連携)...`);
      await page.evaluate(() => {
        const btn = document.querySelector('#login-auth, .btn-login') as HTMLElement;
        if (btn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
        }
      }).catch(() => null);
      await logNormalDelay(2000, 0.15);
    } else {
      // If no login button, check Game Start (#start) on Title screen (#top)
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
          if (p !== page && (p.url().includes('connect.mobage.jp') || p.url().includes('mbga.jp'))) {
            console.log(`[Auth] [${account.name}] Handling Mobage connect popup window...`);
            if (account.credentials?.email && account.credentials?.password) {
              await this.handleMobageConnectForm(p, account.credentials.email, account.credentials.password);
            }
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
   * Helper that automates the modern Mobage Connect OAuth login form (connect.mobage.jp).
   */
  private static async handleMobageConnectForm(targetPage: Page, email: string, pass: string): Promise<boolean> {
    try {
      const emailInput = await targetPage.waitForSelector('#subject-id, input[name="subject_id"]', { visible: true, timeout: 6000 }).catch(() => null);
      const passInput = await targetPage.$('#subject-password, input[name="subject_password"]').catch(() => null);
      if (emailInput && passInput) {
        console.log(`[Auth] Entering Mobage Connect credentials (${email})...`);
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(email, { delay: 30 });
        await targetPage.evaluate(() => {
          const el = document.querySelector('#subject-id, input[name="subject_id"]');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }).catch(() => null);

        await passInput.click({ clickCount: 3 });
        await passInput.type(pass, { delay: 30 });
        await targetPage.evaluate(() => {
          const el = document.querySelector('#subject-password, input[name="subject_password"]');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }).catch(() => null);

        await new Promise(r => setTimeout(r, 400));
        const submitBtn = await targetPage.$('#login, button[name="login"], button[type="submit"]');
        if (submitBtn) {
          console.log(`[Auth] Submitting Mobage Connect login form...`);
          await Promise.all([
            targetPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
            submitBtn.click()
          ]);
        }

        // Dismiss success checkmark modal if shown
        await new Promise(r => setTimeout(r, 1500));
        await targetPage.evaluate(() => {
          const closeBtn = document.querySelector('button, a, [class*="close"], [class*="btn"]') as HTMLElement;
          if (closeBtn && (closeBtn.innerText?.includes('閉じる') || closeBtn.textContent?.includes('閉じる'))) {
            closeBtn.click();
          }
        }).catch(() => null);

        return true;
      }
    } catch (e: any) {
      console.warn(`[Auth] Mobage connect form notice: ${e.message}`);
    }
    return false;
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

    // If active page or any tab is on connect.mobage.jp
    const currentUrl = page.url();
    if (currentUrl.includes('connect.mobage.jp')) {
      await this.handleMobageConnectForm(page, email, password);
    } else {
      const browser = page.browser();
      const pages = await browser.pages();
      const mobagePage = pages.find(p => p.url().includes('connect.mobage.jp'));
      if (mobagePage) {
        await this.handleMobageConnectForm(mobagePage, email, password);
      } else if (!page.url().includes('mbga.jp')) {
        await page.goto('https://ssl.sp.mbga.jp/_login', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1500, 0.15);
      }
    }

    // Wait for login inputs safely if on mbga.jp
    if (page.url().includes('mbga.jp')) {
      const emailInput = await page.waitForSelector('#login_id, input[name="login_id"]', { visible: true, timeout: 5000 }).catch(() => null);
      const passInput = await page.$('#login_pw, input[name="login_pw"]').catch(() => null);

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
    }

    // Check if verification challenge (CAPTCHA / 2FA OTP) appeared
    const hasChallenge = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      return (
        bodyText.includes('captcha') ||
        bodyText.includes('verification') ||
        bodyText.includes('認証コード') ||
        bodyText.includes('確認コード') ||
        !!document.querySelector('#auth_code')
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
    if (page.url().includes('mbga.jp') || page.url().includes('mobage.jp')) {
      await logNormalDelay(2000, 0.15);
      await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
    } else if (page.url().includes('#top')) {
      await page.evaluate(() => {
        const start = document.querySelector('#start, .btn-start') as HTMLElement;
        if (start) start.click();
        else window.location.hash = '#profile';
      }).catch(() => null);
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

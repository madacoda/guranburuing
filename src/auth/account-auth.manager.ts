// src/auth/account-auth.manager.ts
import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer-core';
import { AccountConfig, VerifiedPlayerProfile } from '../types/account.types.js';
import { logNormalDelay, humanReactionDelay } from '../human-motor.js';

export function safeUrl(p?: Page | null): string {
  if (!p) return '';
  try {
    return p.url() || '';
  } catch {
    return '';
  }
}

export class AccountAuthManager {
  /**
   * Navigates to https://game.granbluefantasy.jp/#profile and obtains verified in-game player details.
   * Returns null if unauthenticated or redirected to title/login screen.
   */
  public static async getVerifiedProfile(page: Page): Promise<VerifiedPlayerProfile | null> {
    try {
      // 0. Fast direct API verification (authoritative in-game check with context retry)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const apiProfile = await page.evaluate(async () => {
            try {
              const g = (window as any).Game;
              let version = g?.version || (window as any).version || '';
              if (!version) {
                for (let i = 0; i < 10 && !version; i++) {
                  await new Promise(r => setTimeout(r, 150));
                  version = (window as any).Game?.version || (window as any).version || '';
                }
              }
              const headers: Record<string, string> = {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'X-Requested-With': 'XMLHttpRequest'
              };
              if (version) headers['X-VERSION'] = String(version);

              const rStatus = await fetch(`/user/status?_=${Date.now()}`, { headers });
              if (!rStatus.ok) return null;
              const statusJson = await rStatus.json().catch(() => null);

              const uid = statusJson?.status?.user_id;
              if (statusJson?.status?.level && uid && uid !== '0' && uid !== 0) {
                const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
                const cleanName = nameEl?.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || g?.userName || statusJson?.status?.name || 'Player';
                return {
                  name: cleanName,
                  rank: String(statusJson.status.level),
                  id: String(uid)
                };
              }
              return null;
            } catch {
              return null;
            }
          });
          if (apiProfile) return apiProfile;
        } catch (evalErr: any) {
          if (evalErr.message?.includes('Execution context was destroyed') || evalErr.message?.includes('navigated')) {
            await new Promise(r => setTimeout(r, 600));
            continue;
          }
          break;
        }
      }

      // 1. Fast check if active page DOM is already authenticated (#mypage, #profile, header)
      const instant = await page.evaluate(() => {
        const Game = (window as any).Game;
        const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
        const rankEl = document.querySelector('.prt-rank-value');
        const idEl = document.querySelector('.prt-user-id, .txt-user-id');
        const hasUserInfo = !!document.querySelector('.prt-user-info, .cnt-mypage, .prt-header');

        if ((Game?.userId && Game.userId !== 0 && Game.userId !== '0') || hasUserInfo) {
          let cleanName = nameEl?.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || (Game?.userName ? String(Game.userName) : null);
          let cleanRank = rankEl?.textContent?.trim() || null;
          const id = (Game?.userId && Game.userId !== 0) ? String(Game.userId) : (idEl?.textContent?.replace(/[^0-9]/g, '') || null);
          if (cleanName && cleanName !== 'Guest' && cleanName !== 'undefined' && cleanName !== 'Player') {
            return { name: cleanName, rank: cleanRank || 'Unknown', id: id || 'Unknown' };
          }
        }
        return null;
      }).catch(() => null);

      if (instant) {
        return instant;
      }

      // 2. Navigate to #profile if not yet on GBF
      const currentUrl = safeUrl(page);
      if (!currentUrl.includes('granbluefantasy.jp')) {
        await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
      } else {
        await page.evaluate(() => {
          window.location.hash = '#profile';
        }).catch(() => null);
      }

      // Wait up to 6s for #profile DOM elements to mount or true redirect to occur
      const start = Date.now();
      while (Date.now() - start < 6000) {
        const hash = await page.evaluate(() => window.location.hash).catch(() => '');
        const url = safeUrl(page);

        // Only treat as unauthenticated redirect if at least 4s have elapsed and hash is top or login
        const elapsed = Date.now() - start;
        const isAuthRedirect = (hash.includes('login') && !hash.includes('loginbonus')) ||
                               (elapsed > 4000 && (hash.includes('top') || hash === '' || hash === '#')) ||
                               url.includes('mbga.jp') || url.includes('dmm.com');
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
          const id = (gameUserId && gameUserId !== 0) ? String(gameUserId) : (idEl?.textContent?.replace(/[^0-9]/g, '') || null);

          if (cleanName && cleanName !== 'Guest' && cleanName !== 'undefined') {
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
      await this.saveCookiesSafely(page, account);
      return profile;
    }

    // Attempt restoring session from data/${account.id}-cookies.json if available
    const cookieFile = path.resolve(process.cwd(), 'data', `${account.id}-cookies.json`);
    if (fs.existsSync(cookieFile)) {
      try {
        const raw = fs.readFileSync(cookieFile, 'utf-8');
        const cookies = JSON.parse(raw);
        if (Array.isArray(cookies) && cookies.length > 0) {
          console.log(`[Auth] Attempting session restoration from data/${account.id}-cookies.json (${cookies.length} cookies)...`);
          const client = await page.target().createCDPSession();
          await client.send('Network.setCookies', { cookies });
          await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
          await logNormalDelay(2500, 0.15);
          profile = await this.getVerifiedProfile(page);
          if (profile) {
            console.log(`[Auth] ✅ Authenticated via cached cookies: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
            return profile;
          }
        }
      } catch {}
    }

    console.log(`[Auth] Account [${account.name}] session is NOT authenticated (redirected to title/login).`);
    console.log(`[Auth] Triggering on-demand authentication (Service: ${account.service.toUpperCase()})...`);

    // 0. Recover if stuck on error page
    const currentHash = await page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash.includes('error')) {
      await page.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await logNormalDelay(2000, 0.15);
    }

    // 1. If currently on Title screen (#top), click Login button (#login-auth / データ連携)
    const onTitle = await page.evaluate(() => {
      const h = window.location.hash;
      return h.includes('top') || h === '' || h === '#';
    }).catch(() => false);

    if (onTitle) {
      console.log(`[Auth] [${account.name}] Clicking Login button (#login-auth / データ連携)...`);
      await page.evaluate(() => {
        const btn = document.querySelector('#login-auth, .btn-login') as HTMLElement;
        if (btn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(btn).trigger('tap');
          btn.click();
        }
      }).catch(() => null);
      await logNormalDelay(2500, 0.15);
    }

    // 2. If on #authentication screen, select platform (Mobage/DMM) and proceed
    const isNowAuth = await page.evaluate(() => {
      return window.location.hash.includes('authentication') || !!document.querySelector('.btn-auth-platform, .prt-select-auth');
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

      // Check for popup tab (Mobage Connect popup)
      try {
        const browser = page.browser();
        const pages = await browser.pages();
        for (const p of pages) {
          const pUrl = safeUrl(p);
          if (p !== page && (pUrl.includes('connect.mobage.jp') || pUrl.includes('mbga.jp'))) {
            console.log(`[Auth] [${account.name}] Handling Mobage connect popup window...`);
            await this.handleMobageConnectForm(p, account.credentials?.email || '', account.credentials?.password || '');
            await logNormalDelay(2000, 0.15);
          }
        }
      } catch {}

      // Bring GBF page forward and wait for in-game navigation
      await page.bringToFront().catch(() => null);
      profile = await this.getVerifiedProfile(page);
      if (!profile) {
        await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(3000, 0.15);
        profile = await this.getVerifiedProfile(page);
      }
      if (profile) {
        console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
        await this.saveCookiesSafely(page, account);
        return profile;
      }
    }

    // 3. Perform automated portal login if credentials are provided
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
          await this.saveCookiesSafely(page, account);
          return profile;
        }
      }
    }

    // 4. Fallback: Manual assisted login (audible prompt)
    console.log('\n\x07');
    console.log('========================================================================');
    console.log(` 🔑 ONE-TIME LOGIN REQUIRED: Account [${account.name}] (${account.id}) `);
    console.log('========================================================================');
    console.log(` 👉 Please complete the 1-time login in the open browser window.`);
    console.log(` ⚠️ If no browser window is visible, run with visible window:`);
    console.log(`    👉 bun run account:setup ${account.id} --windowed`);
    console.log(` 👉 Once you reach in-game (#mypage), your profile will be verified automatically.`);
    console.log('========================================================================\n');

    const startWait = Date.now();
    while (Date.now() - startWait < 300000) {
      profile = await this.getVerifiedProfile(page);
      if (profile) {
        console.log(`[Auth] 🎉 Verified Player: "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})!`);
        await this.saveCookiesSafely(page, account);
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
      // 1. Fast path: check if already redirected to success screen
      const isRedirectScreen = await targetPage.evaluate(() => {
        return !!document.querySelector('#notify-response-button');
      }).catch(() => false);

      if (isRedirectScreen || safeUrl(targetPage).includes('redirect')) {
        console.log('[Auth] Finalizing Mobage redirect popup (already authorized)...');
        await targetPage.evaluate(() => {
          const notifyBtn = document.querySelector('#notify-response-button') as HTMLElement;
          if (notifyBtn) {
            notifyBtn.click();
            return;
          }
          const btns = Array.from(document.querySelectorAll('button, a, [class*="close"], [class*="btn"]')) as HTMLElement[];
          const closeBtn = btns.find(b => b.innerText?.includes('閉じる') || b.textContent?.includes('閉じる') || b.className.includes('btn-close'));
          if (closeBtn) closeBtn.click();
        }).catch(() => null);

        await new Promise(r => setTimeout(r, 1500));
        await targetPage.close().catch(() => null);
        return true;
      }

      // 2. Form submission if login inputs exist
      const emailInput = await targetPage.waitForSelector('#subject-id, input[name="subject_id"], #login_id, input[name="login_id"]', { visible: true, timeout: 5000 }).catch(() => null);
      const passInput = await targetPage.$('#subject-password, input[name="subject_password"], #login_pw, input[name="login_pw"]').catch(() => null);
      if (emailInput && passInput && email && pass) {
        console.log(`[Auth] Entering Mobage Connect credentials (${email})...`);
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(email, { delay: 30 });
        await targetPage.evaluate(() => {
          const el = document.querySelector('#subject-id, input[name="subject_id"], #login_id, input[name="login_id"]');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }).catch(() => null);

        await passInput.click({ clickCount: 3 });
        await passInput.type(pass, { delay: 30 });
        await targetPage.evaluate(() => {
          const el = document.querySelector('#subject-password, input[name="subject_password"], #login_pw, input[name="login_pw"]');
          if (el) {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }).catch(() => null);

        await new Promise(r => setTimeout(r, 400));
        const submitBtn = await targetPage.$('#login, button[name="login"], button[type="submit"], input[type="submit"]');
        if (submitBtn) {
          console.log(`[Auth] Submitting Mobage Connect login form...`);
          await Promise.all([
            targetPage.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null),
            submitBtn.click()
          ]);
        }

        // Wait for redirect to settle
        await new Promise(r => setTimeout(r, 2000));

        // Check if consent/agree screen appears ("連携する", "許可する", "同意する")
        await targetPage.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="submit"], a, [class*="btn"]')) as HTMLElement[];
          const agreeBtn = btns.find(b => {
            const t = b.innerText || b.textContent || (b as any).value || '';
            return t.includes('同意') || t.includes('許可') || t.includes('連携') || t.includes('Authorize') || t.includes('Agree');
          });
          if (agreeBtn) agreeBtn.click();
        }).catch(() => null);

        await new Promise(r => setTimeout(r, 1500));

        // Click close/notify button (#notify-response-button or "閉じる")
        console.log(`[Auth] Finalizing Mobage redirect popup...`);
        await targetPage.evaluate(() => {
          const notifyBtn = document.querySelector('#notify-response-button') as HTMLElement;
          if (notifyBtn) {
            notifyBtn.click();
            return;
          }
          const btns = Array.from(document.querySelectorAll('button, a, [class*="close"], [class*="btn"]')) as HTMLElement[];
          const closeBtn = btns.find(b => b.innerText?.includes('閉じる') || b.textContent?.includes('閉じる') || b.className.includes('btn-close'));
          if (closeBtn) closeBtn.click();
        }).catch(() => null);

        await new Promise(r => setTimeout(r, 1000));
        await targetPage.close().catch(() => null);
        return true;
      }
    } catch (e: any) {
      console.warn(`[Auth] Mobage connect form notice: ${e.message}`);
    }
    return false;
  }

  /**
   * Automatically saves active session cookies to data/${account.id}-cookies.json.
   */
  private static async saveCookiesSafely(page: Page, account: AccountConfig): Promise<void> {
    try {
      const client = await page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      const relevantCookies = cookies.filter(c => {
        const domain = (c.domain || '').toLowerCase();
        return (
          domain.includes('granbluefantasy.jp') ||
          domain.includes('mbga.jp') ||
          domain.includes('mobage.jp') ||
          domain.includes('dmm.com')
        );
      });
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const cookieFile = path.join(dataDir, `${account.id}-cookies.json`);
      fs.writeFileSync(cookieFile, JSON.stringify(relevantCookies, null, 2), 'utf-8');
      console.log(`[Auth] 💾 Auto-cached session cookies (${relevantCookies.length} cookies) to data/${account.id}-cookies.json`);
    } catch {}
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
    const currentUrl = safeUrl(page);
    if (currentUrl.includes('connect.mobage.jp')) {
      await this.handleMobageConnectForm(page, email, password);
      const gbfPage = (await page.browser().pages().catch(() => [])).find(p => safeUrl(p).includes('granbluefantasy.jp')) || page;
      await gbfPage.bringToFront().catch(() => null);
      await gbfPage.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
      return await this.waitForMypage(gbfPage, 25000);
    } else {
      const browser = page.browser();
      const pages = await browser.pages().catch(() => []);
      const mobagePage = pages.find(p => safeUrl(p).includes('connect.mobage.jp'));
      if (mobagePage) {
        await this.handleMobageConnectForm(mobagePage, email, password);
        const gbfPage = (await browser.pages().catch(() => [])).find(p => safeUrl(p).includes('granbluefantasy.jp')) || page;
        await gbfPage.bringToFront().catch(() => null);
        await gbfPage.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
        return await this.waitForMypage(gbfPage, 25000);
      } else if (!currentUrl.includes('mbga.jp')) {
        await page.goto('https://ssl.sp.mbga.jp/_login', { waitUntil: 'domcontentloaded' }).catch(() => null);
        await logNormalDelay(1500, 0.15);
      }
    }

    // Wait for login inputs safely if on mbga.jp
    if (safeUrl(page).includes('mbga.jp')) {
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
    if (safeUrl(page).includes('mbga.jp') || safeUrl(page).includes('mobage.jp')) {
      await logNormalDelay(2000, 0.15);
      await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
    } else if (safeUrl(page).includes('#top')) {
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

    if (!safeUrl(page).includes('accounts.dmm.com')) {
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

      // If on #top title screen, trigger Game Start
      if (hash.includes('top') || hash === '' || hash === '#') {
        await page.evaluate(() => {
          const startBtn = document.querySelector('#start, .btn-start, [data-location-href="start"], #wrapper') as HTMLElement;
          if (startBtn) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(startBtn).trigger('tap');
            startBtn.click();
          }
        }).catch(() => null);
      }

      // Authoritative API check
      const isAuth = await page.evaluate(async () => {
        try {
          const g = (window as any).Game;
          const version = g?.version || (window as any).version || '';
          const headers: Record<string, string> = { 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' };
          if (version) headers['X-VERSION'] = String(version);
          const r = await fetch(`/user/status?_=${Date.now()}`, { headers });
          const d = await r.json().catch(() => null);
          return !!(d?.status?.level);
        } catch { return false; }
      }).catch(() => false);

      if (isAuth) {
        console.log('[Auth] Authenticated session confirmed via in-game API!');
        return true;
      }

      await new Promise(r => setTimeout(r, 800));
    }
    console.warn('[Auth] Timed out waiting for #mypage.');
    return false;
  }
}

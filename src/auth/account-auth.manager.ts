// src/auth/account-auth.manager.ts
import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer-core';
import { AccountConfig, VerifiedPlayerProfile } from '../types/account.types.js';
import { installMobageSessionImmunity } from './session-immunity.js';

export function safeUrl(p?: Page | null): string {
  if (!p) return '';
  try {
    return p.url() || '';
  } catch {
    return '';
  }
}

export interface EnsureAuthenticatedOptions {
  interactive?: boolean;        // e.g. Windowed setup mode: prioritize user interactive login
  skipCookieRestore?: boolean;  // Don't inject disk cookies from data/${account.id}-cookies.json
  timeoutMs?: number;
}

export class AccountAuthManager {
  /**
   * Checks if any tab or page in the browser is currently on the Mobage JSSDK redirect URL.
   */
  public static isMobageRedirectUrl(url: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('connect.mobage.jp') &&
      (lower.includes('redirect') || lower.includes('access_token=') || lower.includes('authorization_response') || lower.includes('jssdk'))
    );
  }

  /**
   * Checks if midship session cookie is present and valid in the browser via CDP.
   */
  public static async getMidshipCookie(page: Page): Promise<any | null> {
    let client: any = null;
    try {
      client = await page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      const midship = cookies.find((c: any) =>
        c.name === 'midship' &&
        (c.domain.includes('granbluefantasy.jp') || c.domain.includes('mbga.jp')) &&
        c.value && c.value.length > 20
      );
      return midship || null;
    } catch {
      return null;
    } finally {
      if (client && typeof client.detach === 'function') {
        await client.detach().catch(() => null);
      }
    }
  }

  /**
   * Sanitizes cookie objects for Puppeteer / CDP Network.setCookies.
   * Strips out guest markers, deduplicates by name+domain+path, formats expires as integer,
   * ensures sameSite: 'None' has secure: true.
   */
  public static sanitizeCookiesForCDP(rawCookies: any[]): any[] {
    if (!Array.isArray(rawCookies)) return [];
    const cookieMap = new Map<string, any>();

    for (const c of rawCookies) {
      if (!c || !c.name || typeof c.name !== 'string') continue;
      const name = c.name.trim();
      if (name === 'SP_GUEST' || (name === 't' && c.value === 'dummy')) continue;

      let domain = (c.domain || '').toLowerCase().trim();
      if (!domain) domain = 'game.granbluefantasy.jp';

      // Crucial: Cygames only accepts host-only midship, wing, access_gbtk on game.granbluefantasy.jp.
      // Duplicate dot-domain cookies (.granbluefantasy.jp) cause duplicate Cookie headers and 409 Conflict.
      if (['midship', 'wing', 'access_gbtk'].includes(name)) {
        domain = 'game.granbluefantasy.jp';
      }

      let path = c.path || '/';
      const key = ['midship', 'wing', 'access_gbtk'].includes(name)
        ? `${name}|game.granbluefantasy.jp|${path}`
        : `${name}|${domain}|${path}`;

      const secure = typeof c.secure === 'boolean' ? c.secure : false;
      const httpOnly = typeof c.httpOnly === 'boolean' ? c.httpOnly : false;
      const expires = typeof c.expires === 'number' && c.expires > 0 ? Math.floor(c.expires) : undefined;
      const sameSite = c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : undefined;

      const clean: any = {
        name,
        value: String(c.value ?? ''),
        domain,
        path,
        secure: sameSite === 'None' ? true : secure,
        httpOnly,
        ...(expires !== undefined ? { expires } : {}),
        ...(sameSite ? { sameSite } : {})
      };

      if (cookieMap.has(key)) {
        const existing = cookieMap.get(key);
        const existingExp = existing.expires || 0;
        const newExp = clean.expires || 0;
        if (newExp >= existingExp && clean.value.length >= existing.value.length) {
          cookieMap.set(key, clean);
        }
      } else {
        cookieMap.set(key, clean);
      }
    }

    return Array.from(cookieMap.values());
  }

  /**
   * Passively inspects the active browser page to determine if an authenticated Granblue player session is active.
   * Completely read-only: NEVER clicks any DOM buttons, NEVER forces reloads or page navigations.
   * Returns VerifiedPlayerProfile if authenticated, or null if unauthenticated or on login/title screens.
   */
  public static async getVerifiedProfile(page: Page): Promise<VerifiedPlayerProfile | null> {
    try {
      const currentUrl = safeUrl(page);
      if (!currentUrl || !currentUrl.includes('granbluefantasy.jp')) {
        return null;
      }
      if (currentUrl.includes('mobage.jp') || currentUrl.includes('mbga.jp') || currentUrl.includes('dmm.com')) {
        return null;
      }

      // Check DOM and window.Game state
      const profile = await page.evaluate(() => {
        try {
          const Game = (window as any).Game;
          const hash = window.location.hash || '';

          // Definitely on authentication or platform select screen
          if (hash.includes('authentication') || !!document.querySelector('.btn-auth-platform, .prt-select-auth')) {
            return null;
          }

          const nameEl = document.querySelector('.btn-user-name, .prt-user-name, .txt-user-name, .prt-status-user-name');
          const rankEl = document.querySelector('.txt-rank-value, .prt-rank-value, .prt-info-rank, .prt-rank');
          const idEl = document.querySelector('.prt-user-id, .txt-user-id');

          const uid = (Game?.userId && Game.userId !== 0 && Game.userId !== '0')
            ? String(Game.userId)
            : (idEl?.textContent?.replace(/[^0-9]/g, '') || null);

          let cleanName = nameEl?.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() || (Game?.userName ? String(Game.userName) : null);
          let cleanRank = rankEl?.textContent?.replace(/[^0-9]/g, '').trim() || (Game?.userRank ? String(Game.userRank) : null);

          if (cleanName && cleanName.includes('Rank')) {
            const parts = cleanName.split(/Rank\s*/);
            cleanName = parts[0].trim();
            if (!cleanRank && parts[1]) cleanRank = parts[1].replace(/[^0-9]/g, '').trim();
          }

          if (
            uid &&
            uid !== '0' &&
            cleanName &&
            cleanName !== 'Guest' &&
            cleanName !== 'undefined' &&
            cleanRank &&
            cleanRank !== '0'
          ) {
            return { name: cleanName, rank: cleanRank, id: uid };
          }

          // If uid is valid and Game.isLoggedIn is true on an in-game page
          if (uid && uid !== '0' && (Game?.isLoggedIn || hash.includes('mypage') || hash.includes('quest') || hash.includes('raid') || hash.includes('profile'))) {
            return {
              name: cleanName || (Game?.userName ? String(Game.userName) : 'Player'),
              rank: cleanRank || (Game?.userRank ? String(Game.userRank) : 'Unknown'),
              id: uid
            };
          }

          return null;
        } catch {
          return null;
        }
      }).catch(() => null);

      if (profile) return profile;

      // If on an in-game page and DOM didn't yield all fields, perform a passive API check via /user/status
      const hash = await page.evaluate(() => window.location.hash || '').catch(() => '');
      if (hash.includes('mypage') || hash.includes('quest') || hash.includes('raid') || hash.includes('profile')) {
        const apiProfile = await page.evaluate(async () => {
          try {
            const g = (window as any).Game;
            let version = g?.version || (window as any).version || '';
            if (!version) {
              const scriptEl = document.querySelector('script[src*="version="], script[src*="v="]') as HTMLScriptElement;
              if (scriptEl) {
                const m = scriptEl.src.match(/[?&](?:version|v)=(\d+)/);
                if (m) version = m[1];
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

            if (statusJson?.auth_status === 'require_auth') {
              return null;
            }

            const uid = statusJson?.status?.user_id;
            const level = statusJson?.status?.level;
            const rawName = statusJson?.status?.name || g?.userName;
            const name = rawName ? String(rawName).trim() : null;

            if (
              level &&
              String(level) !== 'Unknown' &&
              uid &&
              uid !== '0' &&
              uid !== 0 &&
              name &&
              name !== 'Player' &&
              name !== 'Guest' &&
              name !== 'undefined'
            ) {
              return {
                name,
                rank: String(level),
                id: String(uid)
              };
            }
            return null;
          } catch {
            return null;
          }
        }).catch(() => null);

        if (apiProfile) return apiProfile;
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
   * Master Human Login Flow for Granblue Fantasy:
   * 1. Check if already authenticated on active page. If yes, save fresh cookies and return.
   * 2. If on #top title screen, click login button (#login-auth / .btn-login) ONCE to go to #authentication.
   * 3. On #authentication screen, choose Mobage and click OK ONCE.
   * 4. Await Mobage Connect authorization screen.
   * 5. When on Mobage authorization redirect (jssdk/redirect or "この画面を閉じて元の画面に戻り操作を続行できます"):
   *    TRULY WAIT, NO RUSH (allow 6s quiet buffer for server-side tokens and session to settle).
   * 6. Click the gray button ("閉じる" / #notify-response-button).
   * 7. Follow redirect back to GBF game tab.
   * 8. On GBF tab, detect in-game modal popup showing email / signing-in / "続ける" (Continue) / "OK" button.
   *    Click the Continue button.
   * 9. NO NEED TO FORCE OPEN MOBAGE CONNECT AGAIN OR ANYTHING, LET IT BE, WAIT THERE.
   *    (Never force reload, never force #mypage via goto(). Let the game client transition naturally!)
   * 10. If Game Start button (#start) appears on #top, tap it to enter game naturally.
   * 11. Once verified on #mypage, wait 4s settling buffer, save all cookies to data/${account.id}-cookies.json,
   *     close leftover popup tab, and return verified profile.
   */
  public static async executeHumanLoginFlow(
    gbfPage: Page,
    account: AccountConfig,
    options?: { timeoutMs?: number }
  ): Promise<VerifiedPlayerProfile | null> {
    const timeoutMs = options?.timeoutMs || 300000;
    const start = Date.now();

    console.log(`[Auth] Starting human login workflow for account [${account.name}] (${account.id})...`);
    await installMobageSessionImmunity(gbfPage).catch(() => null);

    // 0. Ensure GBF tab is open on game.granbluefantasy.jp (recover if off-domain or trapped on tutorial/termsofuse)
    const currentUrl = safeUrl(gbfPage);
    const isTerms = currentUrl.includes('tutorial') || currentUrl.includes('termsofuse');
    if (!currentUrl.includes('granbluefantasy.jp') || isTerms) {
      console.log('[Auth] Opening Granblue Fantasy (https://game.granbluefantasy.jp/)...');
      await gbfPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await new Promise(r => setTimeout(r, 2000));
    }

    // Check if already authenticated
    let initialProfile = await this.getVerifiedProfile(gbfPage);
    if (initialProfile) {
      console.log(`[Auth] ✅ Already authenticated: Player "${initialProfile.name}" (Rank ${initialProfile.rank} | ID: ${initialProfile.id})`);
      await this.saveCookiesSafely(gbfPage, account);
      return initialProfile;
    }

    let authInitiated = false;
    let redirectNotified = false;
    let redirectClosed = false;
    let continueClicked = false;
    let handledCredentialSubmit = false;
    let lastLogTime = 0;

    while (Date.now() - start < timeoutMs) {
      // 1. Check if session is verified in-game on #mypage
      const candidateProfile = await this.getVerifiedProfile(gbfPage);
      if (candidateProfile) {
        console.log(`[Auth] ⏳ In-game session detected ("${candidateProfile.name}" | Rank ${candidateProfile.rank}). Waiting 5s settling buffer to confirm persistence...`);
        await new Promise(r => setTimeout(r, 5000));

        // Re-confirm profile after settling buffer (guarantees session did NOT bounce or fail heartbeat)
        const confirmedProfile = await this.getVerifiedProfile(gbfPage);
        if (!confirmedProfile) {
          console.warn('[Auth] ⚠️ Session transiently unverified after settling buffer. Continuing to monitor...');
          continue;
        }

        console.log('\n========================================================================');
        console.log(`🎉 [Auth] SUCCESS: Authoritatively verified in-game session for account [${account.name}]!`);
        console.log(`   Player Name:      ${confirmedProfile.name}`);
        console.log(`   Player Rank:      ${confirmedProfile.rank}`);
        console.log(`   Granblue User ID: ${confirmedProfile.id}`);
        console.log('========================================================================\n');

        await this.saveCookiesSafely(gbfPage, account);
        return confirmedProfile;
      }

      // 2. Discover all browser tabs
      const browser = gbfPage.browser();
      const allPages = await browser.pages().catch(() => [gbfPage]);
      const mobageTab = allPages.find(p => {
        const u = safeUrl(p);
        return u.includes('connect.mobage.jp') || u.includes('mbga.jp');
      });

      // 3. Mobage tab handling: Form credentials if unauthenticated, or redirect completion if authenticated
      if (mobageTab && !mobageTab.isClosed()) {
        const mobageUrl = safeUrl(mobageTab);

        // Check if on redirect page (JSSDK redirect or text "この画面を閉じて...")
        const isRedirect = this.isMobageRedirectUrl(mobageUrl) || await mobageTab.evaluate(() => {
          const body = document.body?.innerText || '';
          return body.includes('この画面を閉じて') || !!document.querySelector('#notify-response-button');
        }).catch(() => false);

        if (isRedirect) {
          if (!redirectNotified) {
            redirectNotified = true;
            console.log('[Auth] ⏳ Detected Mobage authorization redirect (jssdk/redirect).');
            console.log('[Auth] ⏳ Truly waiting (no rush) for 6 seconds so session cookies and tokens settle...');
            await new Promise(r => setTimeout(r, 6000));
          }

          if (!redirectClosed) {
            console.log('[Auth] 🔘 Clicking the gray button (閉じる) to complete Mobage authorization...');
            await mobageTab.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button, a, [class*="close"], [class*="btn"], input[type="button"], input[type="submit"]')) as HTMLElement[];
              const closeBtn = btns.find(b => {
                const t = (b.innerText || b.textContent || b.getAttribute('value') || '').trim();
                return t.includes('閉じる') || b.className.includes('btn-close') || b.id === 'notify-response-button';
              });
              if (closeBtn) {
                const $ = (window as any).$ || (window as any).Zepto;
                if ($) $(closeBtn).trigger('tap');
                closeBtn.click();
              }
            }).catch(() => null);

            redirectClosed = true;
            await new Promise(r => setTimeout(r, 2000));
            await mobageTab.close().catch(() => null);

            console.log('[Auth] Switching focus back to GBF game tab...');
            await gbfPage.bringToFront().catch(() => null);
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
        } else if (!handledCredentialSubmit && account.credentials?.email && account.credentials?.password) {
          // If Mobage login form is visible with login inputs
          const hasLoginForm = await mobageTab.evaluate(() => {
            return !!document.querySelector('#subject-id, input[name="subject_id"], #login_id, input[name="login_id"]');
          }).catch(() => false);

          if (hasLoginForm) {
            console.log(`[Auth] Entering Mobage Connect credentials (${account.credentials.email})...`);
            handledCredentialSubmit = true;
            await this.handleMobageConnectForm(mobageTab, account.credentials.email, account.credentials.password);
            continue;
          }
        }
      }

      // 4. On GBF tab: Check for in-game confirmation popup ("...でログイン中" / Continue button)
      // "there is signin u in, OR U SEE BUTTON CONTINUE, click it"
      // MUST only look inside an active visible popup modal (#pop, .pop-usual, .prt-popup-body)
      const inGameContinueClicked = await gbfPage.evaluate(() => {
        const popContainer = document.querySelector('#pop:not([style*="none"]), .pop-usual:not([style*="none"]), .prt-popup-body:not([style*="none"])');
        if (!popContainer) return false;

        const modalBtns = Array.from(popContainer.querySelectorAll(
          '.btn-usual-ok, .btn-agree, .btn-continue, [class*="btn-ok"], [class*="btn-agree"], [class*="btn-continue"], button, a'
        )) as HTMLElement[];

        const confirmBtn = modalBtns.find(b => {
          if (b.id === 'login-auth' || b.className.includes('btn-login') || b.className.includes('close')) return false;
          const t = (b.innerText || b.textContent || b.getAttribute('value') || '').trim();
          return (
            t.includes('続ける') ||
            t.includes('OK') ||
            t.includes('同意') ||
            t.includes('Continue') ||
            t === '次へ'
          );
        });

        if (confirmBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(confirmBtn).trigger('tap');
          confirmBtn.click();
          return true;
        }

        return false;
      }).catch(() => false);

      if (inGameContinueClicked) {
        continueClicked = true;
        console.log('[Auth] 🔘 In-game login confirmation detected ("続ける" / Continue). Clicked Continue.');
        console.log('[Auth] ⏳ Letting the game client transition naturally (no reload, no forced URL, waiting there)...');
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      // 5. Initial trigger: "auth, choose mobage" (only run if no popup is active)
      if (!authInitiated && !mobageTab) {
        const pageState = await gbfPage.evaluate(() => {
          const h = window.location.hash || '';
          const hasLoginBtn = !!document.querySelector('#login-auth, .btn-login');
          const isAuthPage = h.includes('authentication') || !!document.querySelector('.btn-auth-platform, .prt-select-auth');
          const isTermsOrTutorial = h.includes('tutorial') || h.includes('termsofuse');
          const isTop = h.includes('top') || h === '' || h === '#';
          return { h, isTop, hasLoginBtn, isAuthPage, isTermsOrTutorial };
        }).catch(() => null);

        // Escape out of accidental tutorial or terms-of-use
        if (pageState?.isTermsOrTutorial) {
          console.log('[Auth] Detected tutorial/terms of use page (#tutorial/termsofuse). Navigating directly to authentication...');
          await gbfPage.goto('https://game.granbluefantasy.jp/#authentication', { waitUntil: 'domcontentloaded' }).catch(() => null);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if (pageState?.isAuthPage) {
          console.log(`[Auth] Selecting platform [${account.service}] on authentication screen...`);
          await gbfPage.evaluate((service) => {
            const platformBtn = document.querySelector(`.btn-auth-platform[data-platform="${service}"], .btn-auth-platform`) as HTMLElement;
            if (platformBtn) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(platformBtn).trigger('tap');
              platformBtn.click();
            }
          }, account.service).catch(() => null);

          await new Promise(r => setTimeout(r, 1000));

          await gbfPage.evaluate(() => {
            const ok = document.querySelector('.btn-ok:not(.disable), .btn-usual-ok:not(.disable)') as HTMLElement;
            if (ok) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(ok).trigger('tap');
              ok.click();
            }
          }).catch(() => null);

          authInitiated = true;
          console.log('[Auth] Platform Mobage selected and confirmed. Awaiting Mobage Connect popup window...');
          await new Promise(r => setTimeout(r, 2500));
          continue;
        } else if (pageState?.hasLoginBtn) {
          console.log(`[Auth] [${account.name}] Clicking Login button (#login-auth / データ連携)...`);
          await gbfPage.evaluate(() => {
            const btn = document.querySelector('#login-auth, .btn-login') as HTMLElement;
            if (btn) {
              const $ = (window as any).$ || (window as any).Zepto;
              if ($) $(btn).trigger('tap');
              btn.click();
            }
          }).catch(() => null);

          await new Promise(r => setTimeout(r, 2500));
          continue;
        } else if (pageState?.isTop || !pageState?.h.includes('authentication')) {
          console.log('[Auth] Directing to authentication screen (https://game.granbluefantasy.jp/#authentication)...');
          await gbfPage.goto('https://game.granbluefantasy.jp/#authentication', { waitUntil: 'domcontentloaded' }).catch(() => null);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }

      // 7. Periodic humane progress logging
      if (Date.now() - lastLogTime > 10000) {
        lastLogTime = Date.now();
        const elapsedSec = Math.round((Date.now() - start) / 1000);
        console.log(`[Auth] ⏳ Awaiting natural game transition... (${elapsedSec}s / ${Math.round(timeoutMs / 1000)}s) [No reload, waiting there]`);
      }

      await new Promise(r => setTimeout(r, 1500));
    }

    console.warn(`[Auth] ⚠️ Human login flow timed out after ${Math.round(timeoutMs / 1000)}s.`);
    return null;
  }

  /**
   * Ensures the page is authenticated for the given account.
   * Restores cached cookies if present, or executes the human login workflow if interactive.
   */
  public static async ensureAuthenticated(
    page: Page,
    account: AccountConfig,
    options?: EnsureAuthenticatedOptions
  ): Promise<VerifiedPlayerProfile | null> {
    // 0. Install Mobage Session Immunity Shield immediately
    await installMobageSessionImmunity(page).catch(() => null);

    console.log(`[Auth] Verifying active session for account [${account.name}]...`);
    let profile = await this.getVerifiedProfile(page);
    if (profile) {
      console.log(`[Auth] ✅ Authenticated: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
      await this.saveCookiesSafely(page, account);
      return profile;
    }

    // Attempt restoring session from data/${account.id}-cookies.json unless skipCookieRestore requested
    const cookieFile = path.resolve(process.cwd(), 'data', `${account.id}-cookies.json`);
    if (!options?.skipCookieRestore && fs.existsSync(cookieFile)) {
      try {
        const raw = fs.readFileSync(cookieFile, 'utf-8');
        const rawCookies = JSON.parse(raw);
        if (Array.isArray(rawCookies) && rawCookies.length > 0) {
          console.log(`[Auth] Restoring session from data/${account.id}-cookies.json (${rawCookies.length} cookies)...`);
          const sanitized = this.sanitizeCookiesForCDP(rawCookies);
          let client: any = null;
          try {
            client = await page.target().createCDPSession();
            await client.send('Network.setCookies', { cookies: sanitized });

            // Also set CHIPS partitioned variants for Mobage session cookies so session_iframe matches
            const partitionedVariants: any[] = [];
            for (const sc of sanitized) {
              if (['CSSID', 'CSID_P', 'USE_CHIPS', 'CTID_P'].includes(sc.name)) {
                partitionedVariants.push({
                  ...sc,
                  secure: true,
                  sameSite: 'None',
                  partitionKey: {
                    topLevelSite: 'https://granbluefantasy.jp',
                    hasCrossSiteAncestor: true
                  }
                });
              }
            }
            if (partitionedVariants.length > 0) {
              await client.send('Network.setCookies', { cookies: partitionedVariants }).catch(() => null);
            }
          } finally {
            if (client && typeof client.detach === 'function') {
              await client.detach().catch(() => null);
            }
          }

          await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
          await new Promise(r => setTimeout(r, 3000));

          profile = await this.getVerifiedProfile(page);
          if (profile) {
            console.log(`[Auth] ✅ Authenticated via cached cookies: Player "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
            await this.saveCookiesSafely(page, account);
            return profile;
          }
        }
      } catch (err: any) {
        console.warn('[Auth] Notice during cookie restoration:', err.message);
      }
    }

    if (!options?.interactive) {
      console.warn(`\n[Auth] ⚠️ Account [${account.name}] session has expired or requires re-authentication.`);
      console.warn(`[Auth] 👉 Please log in via desktop browser window:\n       bun run account:setup ${account.id} --windowed\n`);
      return null;
    }

    // Clean only guest/colliding cookies before interactive setup, preserving valid existing sessions
    let cleanClient: any = null;
    try {
      console.log('[Auth] Preparing clean interactive login session (purging guest & colliding cookies)...');
      cleanClient = await page.target().createCDPSession();
      const { cookies } = await cleanClient.send('Network.getCookies', { urls: ['https://game.granbluefantasy.jp/'] });
      for (const c of cookies) {
        const isGuest = c.name === 'SP_GUEST' || (c.name === 't' && c.value === 'dummy');
        const isDotDomainDuplicate = c.domain.startsWith('.') && ['midship', 'wing', 'access_gbtk'].includes(c.name);
        if (isGuest || isDotDomainDuplicate) {
          await cleanClient.send('Network.deleteCookies', { name: c.name, domain: c.domain, path: c.path });
        }
      }
    } catch {} finally {
      if (cleanClient && typeof cleanClient.detach === 'function') {
        await cleanClient.detach().catch(() => null);
      }
    }

    return await this.executeHumanLoginFlow(page, account, { timeoutMs: options?.timeoutMs || 300000 });
  }

  /**
   * Waits for the Mobage OAuth token exchange and session cookies to settle.
   * Backward-compatible delegation to executeHumanLoginFlow.
   */
  public static async waitForMidshipSync(
    gbfPage: Page,
    redirectPage?: Page | null,
    timeoutMs = 60000
  ): Promise<boolean> {
    console.log('[Auth] ⏳ Detected Mobage OAuth redirect (jssdk/redirect).');
    console.log('[Auth] ⏳ Letting it sit quietly for session and tokens to settle (truly waiting, no rush)...');

    // Truly wait 6s undisturbed
    await new Promise(r => setTimeout(r, 6000));

    // Click the gray button ("閉じる" / close) to finish authorization
    if (redirectPage && !redirectPage.isClosed()) {
      console.log('[Auth] 🔘 Clicking the gray button (閉じる) to complete Mobage authorization...');
      await redirectPage.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a, [class*="close"], [class*="btn"], input[type="button"], input[type="submit"]')) as HTMLElement[];
        const closeBtn = btns.find(b => {
          const t = (b.innerText || b.textContent || b.getAttribute('value') || '').trim();
          return t.includes('閉じる') || b.className.includes('btn-close') || b.id === 'notify-response-button';
        });
        if (closeBtn) closeBtn.click();
      }).catch(() => null);

      await new Promise(r => setTimeout(r, 2000));
    }

    // Switch focus to the GBF opener tab
    console.log('[Auth] Switching focus to GBF game tab...');
    await gbfPage.bringToFront().catch(() => null);
    await new Promise(r => setTimeout(r, 1500));

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const profile = await this.getVerifiedProfile(gbfPage);
      if (profile) {
        console.log(`[Auth] 🎉 GBF in-game session verified: "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})`);
        return true;
      }

      // Check for in-game continue popup
      await gbfPage.evaluate(() => {
        const modalBtns = Array.from(document.querySelectorAll(
          '.btn-usual-ok, .btn-agree, .btn-continue, .btn-login, .btn-submit, [class*="btn-ok"], [class*="btn-agree"], [class*="btn-continue"], .pop-usual .btn-usual-ok, #pop .btn-usual-ok'
        )) as HTMLElement[];
        const confirmBtn = modalBtns.find(b => {
          const t = (b.innerText || b.textContent || b.getAttribute('value') || '').trim();
          return t.includes('続ける') || t.includes('OK') || t.includes('同意') || t.includes('ログイン') || t.includes('次へ') || t.includes('Continue') || t.includes('Sign in');
        });
        if (confirmBtn) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(confirmBtn).trigger('tap');
          confirmBtn.click();
        }
      }).catch(() => null);



      await new Promise(r => setTimeout(r, 1500));
    }

    return false;
  }

  /**
   * Helper that automates the modern Mobage Connect OAuth login form (connect.mobage.jp).
   */
  public static async handleMobageConnectForm(targetPage: Page, email: string, pass: string): Promise<boolean> {
    try {
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

        return true;
      }
    } catch (e: any) {
      console.warn(`[Auth] Mobage connect form notice: ${e.message}`);
    }
    return false;
  }

  /**
   * Automatically saves active session cookies to data/${account.id}-cookies.json.
   * Strips out guest markers (SP_GUEST), dummy tokens, deduplicates, and preserves canonical midship.
   */
  public static async saveCookiesSafely(page: Page, account: AccountConfig): Promise<void> {
    let client: any = null;
    try {
      client = await page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');

      // Filter for GBF, Mobage, DMM
      const relevant = cookies.filter((c: any) => {
        const d = (c.domain || '').toLowerCase();
        return (
          d.includes('granbluefantasy.jp') ||
          d.includes('mbga.jp') ||
          d.includes('mobage.jp') ||
          d.includes('dmm.com')
        );
      });

      // Sanitize and deduplicate across all domains without stripping subdomains
      const cleanCookies = this.sanitizeCookiesForCDP(relevant);

      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const cookieFile = path.join(dataDir, `${account.id}-cookies.json`);
      fs.writeFileSync(cookieFile, JSON.stringify(cleanCookies, null, 2), 'utf-8');
      console.log(`[Auth] 💾 Successfully saved ${cleanCookies.length} fresh session cookies across all domains to data/${account.id}-cookies.json`);
    } catch (err: any) {
      console.warn('[Auth] Notice saving fresh cookies:', err.message);
    } finally {
      if (client && typeof client.detach === 'function') {
        await client.detach().catch(() => null);
      }
    }
  }
}

import puppeteer, { Browser, Page } from 'puppeteer-core';
import { execSync } from 'child_process';
import path from 'path';
import { config } from './config.js';
import { installMobageSessionImmunity } from './auth/session-immunity.js';

export class CdpConnectionManager {
  private browser: Browser | null = null;
  private gbfPage: Page | null = null;
  private isConnecting = false;
  private isExplicitDisconnect = false;
  private isRecoveringRenderer = false;
  private recoveryPromise: Promise<Page | null> | null = null;
  private lastAccountOptions?: { cdpPort?: number; profileDir?: string; proxy?: string | null };
  private lastIsHeadless: boolean = true;
  private reconnectListeners: ((page: Page, browser: Browser) => void)[] = [];

  /**
   * Detects whether an error is a CDP protocol / renderer main-thread timeout
   * (e.g. "Runtime.callFunctionOn timed out", "Runtime.evaluate timed out").
   */
  public static isProtocolTimeoutError(err: any): boolean {
    const msg = String(err?.message || err || '');
    return (
      msg.includes('timed out') &&
      (msg.includes('Runtime.callFunctionOn') ||
        msg.includes('Runtime.evaluate') ||
        msg.includes('protocolTimeout') ||
        msg.includes('Page.navigate') ||
        msg.includes('DOM.'))
    );
  }

  /**
   * Out-of-band Browser-level Standby Mode via Chrome DevTools HTTP JSON API.
   * Ensures a single lightweight `about:blank` standby tab is open and closes all heavy
   * Granblue Fantasy tabs (`game.granbluefantasy.jp` / `mbga.jp`), completely terminating
   * the GBF renderer OS process (0% idle CPU, freeing ~300-500MB RAM) while keeping
   * the Chrome browser process alive on `port` with all session cookies intact.
   * Works in <20ms even if the GBF tab's JS main thread is completely deadlocked.
   */
  public static async putPortOnStandby(
    port: number = config.CDP_PORT,
    preserveVerification = true
  ): Promise<boolean> {
    try {
      const listRes = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(2000)
      });
      if (!listRes.ok) return false;

      const targets: any[] = (await listRes.json()) as any[];
      if (!Array.isArray(targets)) return false;

      const pageTargets = targets.filter(t => t && t.type === 'page');
      if (pageTargets.length === 0) return false;

      if (preserveVerification) {
        const hasVerification = pageTargets.some(t => {
          const u = String(t.url || '');
          return u.includes('verification') || u.includes('sec_challenge');
        });
        if (hasVerification) {
          console.log('[CDP:Standby] 🛡️ Active verification challenge detected on tab. Preserving tab for operator.');
          return false;
        }
      }

      const blankTargets = pageTargets.filter(t => {
        const u = String(t.url || '');
        return u === 'about:blank' || u === '' || u === 'chrome://newtab/';
      });

      const gbfOrActiveTargets = pageTargets.filter(t => {
        const u = String(t.url || '');
        return u !== 'about:blank' && u !== '' && u !== 'chrome://newtab/' && !u.startsWith('devtools://');
      });

      // Ensure at least one about:blank standby tab exists before closing GBF tabs so Chrome stays alive
      let hasStandbyBlank = blankTargets.length > 0;
      if (!hasStandbyBlank && gbfOrActiveTargets.length > 0) {
        try {
          const newRes = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
            method: 'PUT',
            signal: AbortSignal.timeout(2000)
          }).catch(() =>
            fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
              signal: AbortSignal.timeout(2000)
            })
          );
          if (newRes && newRes.ok) {
            hasStandbyBlank = true;
          }
        } catch {}
      }

      if (!hasStandbyBlank) {
        return false;
      }

      // Close all GBF / active game tabs to terminate their renderer process and free RAM/CPU
      let closedCount = 0;
      for (const t of gbfOrActiveTargets) {
        if (t.id) {
          await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`, {
            signal: AbortSignal.timeout(1500)
          }).catch(() => null);
          closedCount++;
        }
      }

      // Prune any extra duplicate about:blank tabs beyond the single standby tab
      if (blankTargets.length > 1) {
        for (let i = 1; i < blankTargets.length; i++) {
          if (blankTargets[i]?.id) {
            await fetch(`http://127.0.0.1:${port}/json/close/${blankTargets[i].id}`, {
              signal: AbortSignal.timeout(1500)
            }).catch(() => null);
          }
        }
      }

      if (closedCount > 0) {
        console.log(`[CDP:Standby] 💤 Closed ${closedCount} active GBF tab(s) on port ${port}. Browser is now in 0%-CPU standby (about:blank).`);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async withTimeoutThrow<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withTimeoutFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>(resolve => {
          timer = setTimeout(() => resolve(fallback), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public async connectWithRetry(
    maxRetries = 6,
    retryDelayMs = 2000,
    forceHeadless?: boolean,
    accountOptions?: { cdpPort?: number; profileDir?: string; proxy?: string | null }
  ): Promise<{ browser: Browser; page: Page }> {
    this.isExplicitDisconnect = false;
    const isHeadless = forceHeadless !== undefined
      ? forceHeadless
      : (process.env.HEADLESS === 'true' || process.env.HEADLESS === '1' || config.HEADLESS);

    this.lastAccountOptions = accountOptions;
    this.lastIsHeadless = isHeadless;

    const port = accountOptions?.cdpPort || config.CDP_PORT;
    const profileDir = accountOptions?.profileDir || '';
    const proxy = accountOptions?.proxy || '';

    // Enforce correct browser mode (Headless vs Windowed) and port/profile before connecting
    if (config.AUTO_LAUNCH_CHROME) {
      try {
        this.launchChromeProcess(isHeadless, port, profileDir, proxy);
      } catch (spawnErr: any) {
        console.warn('[CDP] Mode verification launcher notice:', spawnErr.message);
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[CDP] Connecting to Chrome on port ${port} (Attempt ${attempt}/${maxRetries}, Headless: ${isHeadless})...`);
        
        let wsEndpoint: string | null = null;
        try {
          const verRes = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
          if (verRes.ok) {
            const verData: any = await verRes.json();
            if (verData && verData.webSocketDebuggerUrl) {
              wsEndpoint = verData.webSocketDebuggerUrl;
            }
          }
        } catch {
          // Fall back to browserURL
        }

        const connectOptions: any = {
          defaultViewport: null,
          protocolTimeout: 15000,
          targetFilter: (target: any) => {
            if (target.type() === 'browser_ui' || target.url().startsWith('chrome://')) {
              return false;
            }
            return true;
          }
        };

        if (wsEndpoint) {
          connectOptions.browserWSEndpoint = wsEndpoint;
        } else {
          connectOptions.browserURL = `http://127.0.0.1:${port}`;
        }

        this.browser = await this.withTimeoutThrow(
          puppeteer.connect(connectOptions),
          25000,
          'puppeteer.connect timed out after 25000ms'
        );

        this.browser.on('disconnected', () => {
          if (this.isExplicitDisconnect) return;
          console.warn('[CDP] Chrome connection severed! Triggering reconnect watchdog...');
          this.browser = null;
          this.gbfPage = null;
          this.reconnect();
        });

        // Locate active GBF tab directly via targets (avoids browser.pages() hang on internal browser_ui)
        let targetPage: puppeteer.Page | null = null;
        const targets = this.browser.targets();
        const gbfTargets = targets.filter(t => t.type() === 'page' && (t.url().includes('game.granbluefantasy.jp') || t.url().includes('gbf.game.mbga.jp')));
        if (gbfTargets.length > 0) {
          const preferredTarget = gbfTargets.find(t => {
            const u = t.url();
            return u.includes('#raid/') || u.includes('#battle/') || u.includes('#result/') || u.includes('replicard');
          }) || gbfTargets[0];

          targetPage = await this.withTimeoutFallback(preferredTarget.page(), 3000, null);

          // Close duplicate stale GBF tabs to avoid socket/session desync
          if (gbfTargets.length > 1) {
            console.log(`[CDP] Detected ${gbfTargets.length} Granblue Fantasy tabs. Pruning ${gbfTargets.length - 1} duplicate tab(s)...`);
            for (const t of gbfTargets) {
              if (t !== preferredTarget) {
                try {
                  const targetId = (t as any)._targetId || (t as any)._targetInfo?.targetId;
                  if (targetId) {
                    await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
                  } else {
                    const extraPage = await this.withTimeoutFallback(t.page(), 1500, null);
                    if (extraPage && !extraPage.isClosed()) {
                      await this.withTimeoutFallback(extraPage.close(), 1500, undefined).catch(() => null);
                    }
                  }
                } catch {}
              }
            }
          }

          // Renderer Liveness Probe: Ensure existing GBF tab's JS main thread is not frozen/deadlocked
          if (targetPage) {
            const isAlive = await this.withTimeoutFallback(
              targetPage.evaluate(() => true).catch(() => false),
              2500,
              false
            );
            if (!isAlive) {
              console.warn('[CDP] 🚨 Existing GBF tab failed 2.5s renderer liveness probe (frozen main thread). Closing wedged tab and spawning clean tab...');
              const stuckId = (preferredTarget as any)?._targetId || (preferredTarget as any)?._targetInfo?.targetId;
              if (stuckId) {
                await fetch(`http://127.0.0.1:${port}/json/close/${stuckId}`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
              }
              targetPage = null;
            }
          }
        }

        // If not found via gbfTarget, only reuse an existing page target if it is blank
        if (!targetPage) {
          const blankTarget = targets.find(t => t.type() === 'page' && (t.url() === 'about:blank' || t.url() === '' || t.url() === 'chrome://newtab/'));
          if (blankTarget) {
            targetPage = await this.withTimeoutFallback(blankTarget.page(), 3000, null);
            if (targetPage) {
              console.log('[CDP] Waking from standby blank tab. Arming Session Immunity & navigating to https://game.granbluefantasy.jp/...');
              await installMobageSessionImmunity(targetPage);
              await targetPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
            }
          }
        }

        // If still no page, open a clean dedicated page for GBF
        if (!targetPage) {
          console.log('[CDP] GBF tab not found in active browser. Opening dedicated https://game.granbluefantasy.jp/ tab...');
          targetPage = await this.withTimeoutFallback(this.browser.newPage(), 5000, null);
          if (targetPage) {
            await installMobageSessionImmunity(targetPage);
            await targetPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
          }
        }

        if (!targetPage) {
          throw new Error('Failed to resolve or create a valid Granblue Fantasy browser page target');
        }

        this.gbfPage = targetPage;

        // Ensure Mobage Session Immunity Shield is armed before any navigation/reload
        await installMobageSessionImmunity(this.gbfPage);

        const currentUrl = targetPage.url();
        if (!currentUrl.includes('granbluefantasy.jp') && !currentUrl.includes('mbga.jp')) {
          console.log(`[CDP] Active tab is on non-GBF URL ("${currentUrl}"). Navigating to https://game.granbluefantasy.jp/...`);
          await targetPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
        }

        let pageTitle = await this.withTimeoutFallback(
          this.gbfPage.title(),
          2000,
          'Granblue Fantasy (Title Timeout)'
        ).catch(() => 'Granblue Fantasy');

        if (pageTitle.toLowerCase().includes('error')) {
          console.warn('[CDP] Detected error page. Automatically recovering to https://game.granbluefantasy.jp/...');
          await this.gbfPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
          pageTitle = await this.gbfPage.title().catch(() => 'Granblue Fantasy');
        }

        // Production VPS Optimization Gate (Mute audio, lite canvas graphics, mobile touch viewport)
        if (config.isProduction || config.AUTO_MUTE_GAME) {
          await this.optimizePageEnvironment(this.gbfPage);
        }

        // Install Renderer Freeze Watchdog to auto-recover from Runtime.callFunctionOn timeouts
        this.installRendererFreezeWatchdog(this.gbfPage, port);

        console.log(`[CDP] Connected successfully to page: ${pageTitle} (Env: ${config.APP_ENV}, Ticker: ${config.TICKER_FPS}fps)`);
        return { browser: this.browser, page: this.gbfPage };

      } catch (err: any) {
        console.warn(`[CDP] Connection failed: ${err.message}.`);

        // Auto-launch or force-restart Chrome on failed attempts if enabled
        if (config.AUTO_LAUNCH_CHROME) {
          if (attempt === 1) {
            console.log(`[CDP] Attempt 1 failed. Re-verifying Chrome process (Headless: ${isHeadless})...`);
            try {
              this.launchChromeProcess(isHeadless, port, profileDir, proxy, false);
            } catch (spawnErr: any) {
              console.warn('[CDP] Auto-launch attempt warning:', spawnErr.message);
            }
          } else if (attempt === 2) {
            console.log(`[CDP] Multiple connection failures. Force-restarting Chrome on port ${port}...`);
            try {
              this.launchChromeProcess(isHeadless, port, profileDir, proxy, true);
            } catch (spawnErr: any) {
              console.warn('[CDP] Force restart warning:', spawnErr.message);
            }
          }
        }

        if (attempt === maxRetries) {
          throw new Error(`[CDP] Could not attach to Chrome on port ${config.CDP_PORT} after ${maxRetries} attempts.`);
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error('[CDP] Unexpected connection termination.');
  }

  private async reconnect(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    try {
      const conn = await this.connectWithRetry(10, 3000, this.lastIsHeadless, this.lastAccountOptions);
      for (const listener of this.reconnectListeners) {
        try {
          listener(conn.page, conn.browser);
        } catch (e: any) {
          console.error('[CDP] Reconnect listener error:', e.message);
        }
      }
    } catch (e: any) {
      console.error('[CDP] Reconnect loop failed:', e.message);
    } finally {
      this.isConnecting = false;
    }
  }

  public onReconnect(fn: (page: Page, browser: Browser) => void): void {
    this.reconnectListeners.push(fn);
  }

  public getPage(): Page {
    if (!this.gbfPage) throw new Error('[CDP] No active GBF page attached.');
    return this.gbfPage;
  }

  public getBrowser(): Browser {
    if (!this.browser) throw new Error('[CDP] No active Browser attached.');
    return this.browser;
  }

  private launchChromeProcess(isHeadless: boolean, port: number, profileDir: string, proxy: string, forceRestart = false): void {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'launch-gbf-chrome.ps1');
      let cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
      if (isHeadless) cmd += ' -Headless';
      else cmd += ' -Windowed';
      if (port) cmd += ` -Port ${port}`;
      if (profileDir) cmd += ` -CustomUserDataDir "${profileDir}"`;
      if (proxy) cmd += ` -Proxy "${proxy}"`;
      if (forceRestart) cmd += ' -Force';
      execSync(cmd, { stdio: 'inherit' });
    } else {
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'launch-gbf-chrome.sh');
      let cmd = `bash "${scriptPath}"`;
      if (isHeadless) cmd += ' --headless';
      else cmd += ' --windowed';
      if (port) cmd += ` --port ${port}`;
      if (profileDir) cmd += ` --user-data-dir "${profileDir}"`;
      if (proxy) cmd += ` --proxy "${proxy}"`;
      if (forceRestart) cmd += ' --force';
      execSync(cmd, {
        stdio: 'inherit',
        env: {
          ...process.env,
          V8_MAX_OLD_SPACE: String(config.V8_MAX_OLD_SPACE),
          DISK_CACHE_SIZE: String(config.DISK_CACHE_SIZE),
          WINDOW_SIZE: `${config.VIEWPORT_WIDTH},${config.VIEWPORT_HEIGHT}`
        }
      });
    }
  }

  public async optimizePageEnvironment(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        try {
          // 1. Mute GBF WebAudio/SoundJS to eliminate CPU audio decoding
          localStorage.setItem('sound_bgm_volume', '0');
          localStorage.setItem('sound_se_volume', '0');
          localStorage.setItem('sound_voice_volume', '0');
          // 2. Set quality to standard/lite (suppresses heavy canvas particle effects)
          localStorage.setItem('quality', '1');
          
          const g = (window as any).Game;
          if (g?.storage) {
            g.storage.set('sound_bgm_volume', '0');
            g.storage.set('sound_se_volume', '0');
            g.storage.set('sound_voice_volume', '0');
            g.storage.set('quality', '1');
          }
        } catch {}
      }).catch(() => null);

      if (config.isProduction && config.VIEWPORT_WIDTH && config.VIEWPORT_HEIGHT) {
        await page.setViewport({
          width: config.VIEWPORT_WIDTH,
          height: config.VIEWPORT_HEIGHT,
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 1
        }).catch(() => null);
      }
    } catch (e: any) {
      console.warn('[CDP] Environment optimization notice:', e.message);
    }
  }

  /**
   * Instruments a Puppeteer Page with a Renderer Freeze Watchdog:
   * 1. Intercepts `Runtime.callFunctionOn timed out` / protocol timeouts on `page.evaluate`.
   * 2. Prevents silent 30s x N timeout cascades inside `.catch(() => null)` loops by immediately
   *    triggering out-of-band tab recovery (`recoverFrozenRenderer`) on the first protocol timeout.
   * 3. Transparently forwards subsequent `evaluate` calls on a retired page reference to the newly
   *    recovered `this.gbfPage`.
   * 4. Exposes `page.__recycleTab` for proactive inter-run memory hygiene.
   */
  public installRendererFreezeWatchdog(page: Page, port?: number): void {
    if (!page || typeof page.evaluate !== 'function') return;
    if ((page as any).__freezeWatchdogInstalled) return;
    (page as any).__freezeWatchdogInstalled = true;

    const activePort = port || this.lastAccountOptions?.cdpPort || config.CDP_PORT;
    (page as any).__recycleTab = async (destUrl?: string) => {
      return await this.recycleTab(destUrl);
    };

    const originalEvaluate = page.evaluate.bind(page);

    page.evaluate = (async (...args: any[]) => {
      // Forward transparently if this page was replaced by a newer recovered gbfPage
      if (this.gbfPage && this.gbfPage !== page && !this.gbfPage.isClosed()) {
        return await (this.gbfPage.evaluate as any)(...args);
      }

      // If another call is already recovering a frozen renderer, wait for recovery and forward
      if (this.isRecoveringRenderer && this.recoveryPromise) {
        const recovered = await this.recoveryPromise.catch(() => null);
        if (recovered && recovered !== page && !recovered.isClosed()) {
          return await (recovered.evaluate as any)(...args);
        }
      }

      try {
        return await (originalEvaluate as any)(...args);
      } catch (err: any) {
        if (CdpConnectionManager.isProtocolTimeoutError(err) && !this.isExplicitDisconnect) {
          console.warn(`[CDP:Watchdog] 🚨 Renderer main-thread freeze detected (${err.message}). Executing out-of-band tab recovery...`);
          const recoveredPage = await this.recoverFrozenRenderer(page, activePort);
          if (recoveredPage && !recoveredPage.isClosed()) {
            return await (recoveredPage.evaluate as any)(...args);
          }
        }
        throw err;
      }
    }) as any;
  }

  /**
   * Recovers from a deadlocked Chrome renderer tab by opening a fresh tab, closing the wedged
   * target via Chrome's Browser-process HTTP endpoint (`/json/close/<targetId>`), re-initializing
   * session immunity + viewport optimization, and notifying all `onReconnect` listeners.
   */
  public async recoverFrozenRenderer(stuckPage?: Page | null, port?: number): Promise<Page | null> {
    if (this.isRecoveringRenderer && this.recoveryPromise) {
      return await this.recoveryPromise;
    }

    this.isRecoveringRenderer = true;
    const activePort = port || this.lastAccountOptions?.cdpPort || config.CDP_PORT;
    const targetToReplace = stuckPage || this.gbfPage;

    this.recoveryPromise = (async (): Promise<Page | null> => {
      try {
        let stuckTargetId: string | undefined;
        let lastUrl = 'https://game.granbluefantasy.jp/#mypage';
        try {
          if (targetToReplace) {
            const rawUrl = targetToReplace.url();
            if (rawUrl && rawUrl.includes('granbluefantasy.jp')) {
              // Avoid reopening directly into a corrupted #result_multi empty hash that caused the freeze
              lastUrl = rawUrl.includes('#result')
                ? 'https://game.granbluefantasy.jp/#quest/assist'
                : rawUrl;
            }
            const t = typeof targetToReplace.target === 'function' ? targetToReplace.target() : null;
            stuckTargetId = (t as any)?._targetId || (t as any)?._targetInfo?.targetId;
          }
        } catch {}

        // 1. Try spawning a fresh tab on the existing Browser connection first
        let freshPage: Page | null = null;
        if (this.browser && this.browser.connected) {
          freshPage = await this.withTimeoutFallback(this.browser.newPage(), 4000, null);
        }

        // 2. Ensure at least one new tab exists via HTTP if browser.newPage() timed out
        if (!freshPage) {
          await fetch(`http://127.0.0.1:${activePort}/json/new?about:blank`, {
            method: 'PUT',
            signal: AbortSignal.timeout(2000)
          }).catch(() =>
            fetch(`http://127.0.0.1:${activePort}/json/new?about:blank`, {
              signal: AbortSignal.timeout(2000)
            }).catch(() => null)
          );
        }

        // 3. Kill the wedged renderer target via Browser-level HTTP endpoint (<10ms, bypasses frozen JS thread)
        if (stuckTargetId) {
          console.log(`[CDP:Watchdog] 🔪 Terminating wedged renderer target (${stuckTargetId}) on port ${activePort}...`);
          await fetch(`http://127.0.0.1:${activePort}/json/close/${stuckTargetId}`, {
            signal: AbortSignal.timeout(2000)
          }).catch(() => null);
        }

        // 4. If freshPage was created on active browser, initialize and rebind
        if (freshPage && this.browser) {
          await installMobageSessionImmunity(freshPage);
          await freshPage.goto(lastUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
          if (config.isProduction || config.AUTO_MUTE_GAME) {
            await this.optimizePageEnvironment(freshPage);
          }
          this.installRendererFreezeWatchdog(freshPage, activePort);
          this.gbfPage = freshPage;

          for (const listener of this.reconnectListeners) {
            try {
              listener(freshPage, this.browser);
            } catch (e: any) {
              console.error('[CDP:Watchdog] Reconnect listener error:', e.message);
            }
          }
          console.log(`[CDP:Watchdog] ✅ Renderer recovered in fresh tab (${freshPage.url()}).`);
          return freshPage;
        }

        // 5. Fallback: Full reconnect cycle (will also force-restart Chrome on attempt 2 if browser is wedged)
        console.log('[CDP:Watchdog] 🔄 Re-establishing full CDP connection after renderer freeze...');
        const conn = await this.connectWithRetry(4, 1500, this.lastIsHeadless, this.lastAccountOptions);
        for (const listener of this.reconnectListeners) {
          try {
            listener(conn.page, conn.browser);
          } catch (e: any) {
            console.error('[CDP:Watchdog] Reconnect listener error:', e.message);
          }
        }
        return conn.page;
      } catch (err: any) {
        console.error('[CDP:Watchdog] ❌ Renderer recovery error:', err.message);
        return null;
      } finally {
        this.isRecoveringRenderer = false;
        this.recoveryPromise = null;
      }
    })();

    return await this.recoveryPromise;
  }

  /**
   * Proactively recycles the active GBF tab between runs (e.g. every 50 runs) to flush
   * accumulated V8 heap, detached DOM nodes, and SwiftShader WebGL textures.
   */
  public async recycleTab(targetUrl?: string): Promise<Page | null> {
    if (!this.browser || !this.gbfPage) return null;
    const activePort = this.lastAccountOptions?.cdpPort || config.CDP_PORT;
    const oldPage = this.gbfPage;
    const destUrl = targetUrl || oldPage.url() || 'https://game.granbluefantasy.jp/#quest/assist';

    try {
      const oldTarget = typeof oldPage.target === 'function' ? oldPage.target() : null;
      const oldTargetId = (oldTarget as any)?._targetId || (oldTarget as any)?._targetInfo?.targetId;

      const newPage = await this.withTimeoutFallback(this.browser.newPage(), 5000, null);
      if (!newPage) return oldPage;

      await installMobageSessionImmunity(newPage);
      await newPage.goto(destUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
      if (config.isProduction || config.AUTO_MUTE_GAME) {
        await this.optimizePageEnvironment(newPage);
      }
      this.installRendererFreezeWatchdog(newPage, activePort);
      this.gbfPage = newPage;

      for (const listener of this.reconnectListeners) {
        try {
          listener(newPage, this.browser);
        } catch {}
      }

      if (oldTargetId) {
        await fetch(`http://127.0.0.1:${activePort}/json/close/${oldTargetId}`, {
          signal: AbortSignal.timeout(1500)
        }).catch(() => null);
      } else {
        await this.withTimeoutFallback(oldPage.close(), 1500, undefined).catch(() => null);
      }

      console.log(`[CDP] ♻️ Recycled GBF tab into fresh renderer process (${newPage.url()}).`);
      return newPage;
    } catch (err: any) {
      console.warn(`[CDP] Tab recycle notice: ${err.message}`);
      return this.gbfPage;
    }
  }

  /**
   * Places the browser into 0%-CPU Standby Mode (`about:blank` tab open, all GBF tabs closed)
   * and cleanly disconnects the CDP client.
   */
  public async standby(preserveVerification = true): Promise<void> {
    this.isExplicitDisconnect = true;
    const port = this.lastAccountOptions?.cdpPort || config.CDP_PORT;

    const stoodByViaHttp = await CdpConnectionManager.putPortOnStandby(port, preserveVerification);

    if (!stoodByViaHttp && this.browser && this.gbfPage && !this.gbfPage.isClosed()) {
      try {
        const currentUrl = this.gbfPage.url() || '';
        const isVerification = preserveVerification && (currentUrl.includes('verification') || currentUrl.includes('sec_challenge'));
        if (!isVerification) {
          const blankPage = await this.withTimeoutFallback(this.browser.newPage(), 2500, null);
          if (blankPage) {
            await this.withTimeoutFallback(this.gbfPage.close(), 2000, undefined).catch(() => null);
            console.log(`[CDP:Standby] 💤 Closed GBF tab via Puppeteer. Browser is in standby (about:blank).`);
          } else {
            await this.withTimeoutFallback(
              this.gbfPage.goto('about:blank', { timeout: 2500 }),
              2500,
               null
            ).catch(() => null);
          }
        }
      } catch {}
    }

    await this.disconnect();
  }

  public async disconnect(): Promise<void> {
    this.isExplicitDisconnect = true;
    if (this.browser) {
      this.browser.removeAllListeners('disconnected');
      await this.browser.disconnect().catch(() => {});
      this.browser = null;
      this.gbfPage = null;
    }
  }
}

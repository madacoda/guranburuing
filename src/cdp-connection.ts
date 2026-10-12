import puppeteer, { Browser, Page } from 'puppeteer-core';
import { execSync } from 'child_process';
import path from 'path';
import { config } from './config.js';

export class CdpConnectionManager {
  private browser: Browser | null = null;
  private gbfPage: Page | null = null;
  private isConnecting = false;
  private isExplicitDisconnect = false;
  private lastAccountOptions?: { cdpPort?: number; profileDir?: string; proxy?: string | null };
  private lastIsHeadless: boolean = true;
  private reconnectListeners: ((page: Page, browser: Browser) => void)[] = [];

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

        const connectPromise = puppeteer.connect(connectOptions);

        this.browser = await Promise.race([
          connectPromise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('puppeteer.connect timed out after 25000ms')), 25000))
        ]);

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
        const gbfTarget = targets.find(t => t.type() === 'page' && (t.url().includes('game.granbluefantasy.jp') || t.url().includes('gbf.game.mbga.jp')));
        if (gbfTarget) {
          targetPage = await Promise.race([
            gbfTarget.page(),
            new Promise<puppeteer.Page | null>(r => setTimeout(() => r(null), 3000))
          ]);
        }

        // If not found via gbfTarget, only reuse an existing page target if it is blank
        if (!targetPage) {
          const blankTarget = targets.find(t => t.type() === 'page' && (t.url() === 'about:blank' || t.url() === '' || t.url() === 'chrome://newtab/'));
          if (blankTarget) {
            targetPage = await Promise.race([
              blankTarget.page(),
              new Promise<puppeteer.Page | null>(r => setTimeout(() => r(null), 3000))
            ]);
            if (targetPage) {
              console.log('[CDP] Reusing blank tab. Navigating to https://game.granbluefantasy.jp/...');
              await targetPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
            }
          }
        }

        // If still no page, open a clean dedicated page for GBF
        if (!targetPage) {
          console.log('[CDP] GBF tab not found in active browser. Opening dedicated https://game.granbluefantasy.jp/ tab...');
          targetPage = await Promise.race([
            this.browser.newPage(),
            new Promise<puppeteer.Page | null>(r => setTimeout(() => r(null), 5000))
          ]);
          if (targetPage) {
            await targetPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
          }
        }

        if (!targetPage) {
          throw new Error('Failed to resolve or create a valid Granblue Fantasy browser page target');
        }

        this.gbfPage = targetPage;

        const currentUrl = targetPage.url();
        if (!currentUrl.includes('granbluefantasy.jp') && !currentUrl.includes('mbga.jp')) {
          console.log(`[CDP] Active tab is on non-GBF URL ("${currentUrl}"). Navigating to https://game.granbluefantasy.jp/...`);
          await targetPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
        }

        let pageTitle = await Promise.race([
          this.gbfPage.title(),
          new Promise<string>(resolve => setTimeout(() => resolve('Granblue Fantasy (Title Timeout)'), 2000))
        ]).catch(() => 'Granblue Fantasy');

        if (pageTitle.toLowerCase().includes('error')) {
          console.warn('[CDP] Detected error page. Automatically recovering to https://game.granbluefantasy.jp/...');
          await this.gbfPage.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
          pageTitle = await this.gbfPage.title().catch(() => 'Granblue Fantasy');
        }

        // Production VPS Optimization Gate (Mute audio, lite canvas graphics, mobile touch viewport)
        if (config.isProduction || config.AUTO_MUTE_GAME) {
          await this.optimizePageEnvironment(this.gbfPage);
        }

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

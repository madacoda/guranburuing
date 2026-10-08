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
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('puppeteer.connect timed out after 8000ms')), 8000))
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

        console.log(`[CDP] Connected successfully to page: ${pageTitle}`);
        return { browser: this.browser, page: this.gbfPage };

      } catch (err: any) {
        console.warn(`[CDP] Connection failed: ${err.message}.`);

        // Auto-launch Chrome on first failed attempt if enabled
        if (attempt === 1 && config.AUTO_LAUNCH_CHROME) {
          console.log(`[CDP] Auto-launching Chrome (Headless: ${isHeadless})...`);
          try {
            this.launchChromeProcess(isHeadless, port, profileDir, proxy);
            continue;
          } catch (spawnErr: any) {
            console.warn('[CDP] Auto-launch attempt warning:', spawnErr.message);
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

  private launchChromeProcess(isHeadless: boolean, port: number, profileDir: string, proxy: string): void {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'launch-gbf-chrome.ps1');
      let cmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
      if (isHeadless) cmd += ' -Headless';
      else cmd += ' -Windowed';
      if (port) cmd += ` -Port ${port}`;
      if (profileDir) cmd += ` -CustomUserDataDir "${profileDir}"`;
      if (proxy) cmd += ` -Proxy "${proxy}"`;
      execSync(cmd, { stdio: 'inherit' });
    } else {
      const scriptPath = path.resolve(process.cwd(), 'scripts', 'launch-gbf-chrome.sh');
      let cmd = `bash "${scriptPath}"`;
      if (isHeadless) cmd += ' --headless';
      else cmd += ' --windowed';
      if (port) cmd += ` --port ${port}`;
      if (profileDir) cmd += ` --user-data-dir "${profileDir}"`;
      if (proxy) cmd += ` --proxy "${proxy}"`;
      execSync(cmd, { stdio: 'inherit' });
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

// src/gateway/server.ts
import Fastify, { FastifyRequest } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { Page } from 'puppeteer-core';
import { config } from '../config.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { ProSkipEngine } from '../engines/pro-skip.engine.js';
import { RaidEngine } from '../engines/raid.engine.js';
import { ScreencastManager } from './screencast.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { VerifiedPlayerProfile } from '../types/account.types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GatewayServer {
  private app = Fastify({ logger: false });
  private screencast: ScreencastManager;
  private proSkipEngine: ProSkipEngine;
  private raidEngine: RaidEngine;
  private wsClients: Set<WebSocket> = new Set();
  private isBusy = false; // Async Mutex flag

  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {
    this.screencast = new ScreencastManager(page);
    this.proSkipEngine = new ProSkipEngine(page, sentinel);
    this.raidEngine = new RaidEngine(page, sentinel);
  }

  public async start(): Promise<void> {
    await this.screencast.initialize();

    await this.app.register(fastifyCors, { origin: '*' });
    await this.app.register(fastifyWebsocket);

    // Serve Mobile Companion PWA from public/ directory
    const publicPath = path.resolve(__dirname, '../../public');
    await this.app.register(fastifyStatic, {
      root: publicPath,
      prefix: '/'
    });

    // Health check endpoint
    this.app.get('/api/health', async () => {
      return {
        status: 'OK',
        armed: this.sentinel.isArmed,
        busy: this.isBusy,
        timestamp: Date.now()
      };
    });

    // In-game Profile & Session Status Endpoint
    this.app.get('/api/session/profile', async (req: FastifyRequest) => {
      const queryToken = (req.query as any)?.token;
      const headerToken = (req.headers.authorization?.replace('Bearer ', '') || req.headers['x-auth-token']) as string;
      const validToken = queryToken === config.AUTH_TOKEN || headerToken === config.AUTH_TOKEN;

      if (!validToken) {
        return { error: 'Unauthorized: Invalid token' };
      }

      const profile = await AccountAuthManager.getVerifiedProfile(this.page).catch(() => null);
      return {
        authenticated: !!profile,
        profile,
        currentUrl: this.page.url()
      };
    });

    // Remote Cookie Injection & Session Sync Endpoint
    this.app.post('/api/cookies/import', async (req: FastifyRequest, reply) => {
      const queryToken = (req.query as any)?.token;
      const headerToken = (req.headers.authorization?.replace('Bearer ', '') || req.headers['x-auth-token']) as string;
      const validToken = queryToken === config.AUTH_TOKEN || headerToken === config.AUTH_TOKEN;

      if (!validToken) {
        reply.code(401);
        return { error: 'Unauthorized: Invalid token' };
      }

      const body = (req.body as any) || {};
      const { cookies, accountId } = body;

      if (!Array.isArray(cookies) || cookies.length === 0) {
        reply.code(400);
        return { error: 'Invalid payload: Expected an array of cookie definitions in "cookies"' };
      }

      try {
        const result = await this.applyAndVerifyCookies(cookies, accountId);
        return {
          success: true,
          count: result.sanitizedCount,
          profile: result.profile
        };
      } catch (err: any) {
        reply.code(500);
        return { error: `Failed to import cookies: ${err.message}` };
      }
    });

    // WebSocket Gateway Endpoint
    this.app.get('/ws', { websocket: true }, (rawSocket: any, req: FastifyRequest) => {
      const socket: WebSocket = rawSocket.socket || rawSocket;

      // Token Authentication Check
      const queryToken = (req.query as any)?.token;
      const headerToken = req.headers.authorization?.replace('Bearer ', '');
      const validToken = queryToken === config.AUTH_TOKEN || headerToken === config.AUTH_TOKEN;

      if (!validToken) {
        socket.send(JSON.stringify({ type: 'EVENT_ERROR', message: 'Unauthorized: Invalid AUTH_TOKEN' }));
        socket.close(1008, 'Unauthorized');
        return;
      }

      this.wsClients.add(socket);
      this.screencast.registerClient(socket);
      console.log('[Gateway] Remote companion client authenticated and connected.');

      // Send initial status greeting
      socket.send(JSON.stringify({
        type: 'EVENT_GREETING',
        data: {
          armed: this.sentinel.isArmed,
          busy: this.isBusy,
          currentUrl: this.page.url()
        }
      }));

      // Command Message Ingestion
      socket.on('message', async (raw: Buffer) => {
        try {
          const message = JSON.parse(raw.toString());
          await this.handleClientCommand(socket, message);
        } catch (err: any) {
          socket.send(JSON.stringify({ type: 'EVENT_ERROR', message: err.message }));
        }
      });

      socket.on('close', () => {
        this.wsClients.delete(socket);
        console.log('[Gateway] Remote client disconnected.');
      });
    });

    // Keepalive Heartbeat & Telemetry Broadcaster (every 2.5 seconds)
    setInterval(async () => {
      if (this.wsClients.size === 0) return;
      try {
        const telemetry = {
          type: 'EVENT_TELEMETRY',
          timestamp: Date.now(),
          data: {
            currentUrl: this.page.url(),
            sentinelArmed: this.sentinel.isArmed,
            busy: this.isBusy
          }
        };
        const payload = JSON.stringify(telemetry);
        for (const ws of this.wsClients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(payload);
            ws.ping(); // TCP keepalive
          }
        }
      } catch (e) {}
    }, 2500);

    await this.app.listen({ port: config.PORT, host: config.HOST });
    console.log(`[Gateway] Fastify server running on http://${config.HOST}:${config.PORT}`);
  }

  /**
   * Injects cookies into active Chrome session via CDP, saves locally, and verifies identity on #profile.
   */
  public async applyAndVerifyCookies(
    cookies: any[],
    accountId: string = 'acc1'
  ): Promise<{ sanitizedCount: number; profile: VerifiedPlayerProfile | null }> {
    console.log(`[Gateway] Injecting ${cookies.length} cookies into browser session for account [${accountId}]...`);

    const sanitizedCookies = cookies.map((c: any) => {
      const item: any = {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/'
      };
      if (typeof c.secure === 'boolean') item.secure = c.secure;
      if (typeof c.httpOnly === 'boolean') item.httpOnly = c.httpOnly;
      if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) {
        item.sameSite = c.sameSite;
      }
      if (typeof c.expires === 'number' && c.expires > 0) {
        item.expires = c.expires;
      }
      return item;
    });

    const client = await this.page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await client.send('Network.setCookies', { cookies: sanitizedCookies });

    // Persist cookies to data directory
    try {
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, `${accountId}-cookies.json`),
        JSON.stringify(sanitizedCookies, null, 2),
        'utf-8'
      );
      console.log(`[Gateway] Cached cookies to data/${accountId}-cookies.json`);
    } catch (saveErr: any) {
      console.warn('[Gateway] Notice saving cookie cache:', saveErr.message);
    }

    // Navigate to #profile and verify
    console.log('[Gateway] Navigating to https://game.granbluefantasy.jp/#profile to verify session...');
    await this.page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
    await new Promise(r => setTimeout(r, 2000));

    // Handle Title screen (#top) if present
    const currentHash = await this.page.evaluate(() => window.location.hash).catch(() => '');
    if (currentHash.includes('top') || currentHash === '' || currentHash === '#') {
      await this.page.evaluate(() => {
        const start = document.querySelector('#start, .btn-start, [data-location-href="start"]') as HTMLElement;
        if (start) {
          const $ = (window as any).$ || (window as any).Zepto;
          if ($) $(start).trigger('tap');
          start.click();
        }
      }).catch(() => null);
      await new Promise(r => setTimeout(r, 2500));
    }

    let profile = await AccountAuthManager.getVerifiedProfile(this.page).catch(() => null);

    // If still null, wait up to 5s for router mount
    if (!profile) {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 1000));
        profile = await AccountAuthManager.getVerifiedProfile(this.page).catch(() => null);
        if (profile) break;
      }
    }

    this.broadcast({
      type: 'EVENT_COOKIES_IMPORTED',
      data: {
        success: !!profile,
        count: sanitizedCookies.length,
        profile,
        accountId
      }
    });

    if (profile) {
      console.log(`[Gateway] 🎉 Verified Player: "${profile.name}" (Rank ${profile.rank} | ID: ${profile.id})!`);
    } else {
      console.warn('[Gateway] ⚠️ Session cookies injected, but player profile verification returned empty.');
    }

    return { sanitizedCount: sanitizedCookies.length, profile };
  }

  private async handleClientCommand(ws: WebSocket, cmd: any): Promise<void> {
    console.log(`[Gateway] Received Command: ${cmd.type}`);

    // Allow Emergency Stop and Unlock commands even when busy
    if (cmd.type === 'CMD_EMERGENCY_STOP') {
      console.warn('[Gateway] Emergency stop invoked by remote client!');
      await this.page.evaluate(() => { window.location.hash = '#mypage'; });
      this.isBusy = false;
      this.broadcast({ type: 'EVENT_EMERGENCY_STOPPED', timestamp: Date.now() });
      return;
    }

    if (cmd.type === 'CMD_SOLVE_CAPTCHA_COMPLETE') {
      this.sentinel.unlock();
      this.broadcast({ type: 'EVENT_SENTINEL_UNLOCKED', armed: true });
      return;
    }

    // Remote cookie import command from cockpit
    if (cmd.type === 'CMD_IMPORT_COOKIES') {
      const { cookies, accountId } = cmd.payload || {};
      if (Array.isArray(cookies) && cookies.length > 0) {
        try {
          const res = await this.applyAndVerifyCookies(cookies, accountId || 'acc1');
          ws.send(JSON.stringify({
            type: 'EVENT_COOKIES_IMPORTED',
            data: { success: true, count: res.sanitizedCount, profile: res.profile }
          }));
        } catch (err: any) {
          ws.send(JSON.stringify({
            type: 'EVENT_ERROR',
            message: `Cookie import failed: ${err.message}`
          }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'EVENT_ERROR', message: 'No cookies provided' }));
      }
      return;
    }

    // Interactive remote touch/click forwarded to headless browser
    if (cmd.type === 'CMD_TAP') {
      const { x, y } = cmd;
      if (typeof x === 'number' && typeof y === 'number') {
        try {
          await this.page.mouse.click(x, y);
        } catch (e: any) {
          console.warn('[Gateway] Tap event error:', e.message);
        }
      }
      return;
    }

    // Interactive remote typing forwarded to headless browser
    if (cmd.type === 'CMD_TYPE') {
      const { text } = cmd;
      if (typeof text === 'string') {
        try {
          await this.page.keyboard.type(text, { delay: 20 });
        } catch (e: any) {
          console.warn('[Gateway] Type event error:', e.message);
        }
      }
      return;
    }

    // Interactive remote keypress (e.g. Enter, Backspace)
    if (cmd.type === 'CMD_KEY') {
      const { key } = cmd;
      if (typeof key === 'string') {
        try {
          await this.page.keyboard.press(key as any);
        } catch (e: any) {
          console.warn('[Gateway] Key event error:', e.message);
        }
      }
      return;
    }

    // Async Mutex Check: Prevent concurrent overlapping operations
    if (this.isBusy) {
      ws.send(JSON.stringify({
        type: 'EVENT_BUSY',
        message: 'Engine is currently executing another routine. Please wait.'
      }));
      return;
    }

    try {
      this.isBusy = true;
      this.broadcast({ type: 'EVENT_ENGINE_BUSY', busy: true });

      switch (cmd.type) {
        case 'CMD_TRIGGER_DAILY': {
          const target = cmd.payload?.target || 'magna_pro';
          const results = await this.proSkipEngine.execute(target);
          this.broadcast({ type: 'EVENT_TASK_COMPLETE', task: 'PRO_SKIP', results });
          break;
        }

        case 'CMD_JOIN_RAID': {
          const { raidCode, element, preferredSummon, enableFullAuto } = cmd.payload;
          const result = await this.raidEngine.joinAndFight({ raidCode, element, preferredSummon, enableFullAuto });
          this.broadcast({ type: 'EVENT_TASK_COMPLETE', task: 'JOIN_RAID', result });
          break;
        }

        default:
          ws.send(JSON.stringify({ type: 'EVENT_ERROR', message: `Unknown command type: ${cmd.type}` }));
      }
    } finally {
      this.isBusy = false;
      this.broadcast({ type: 'EVENT_ENGINE_BUSY', busy: false });
    }
  }

  private broadcast(obj: any): void {
    const payload = JSON.stringify(obj);
    for (const ws of this.wsClients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  public async stop(): Promise<void> {
    try {
      await this.app.close();
      console.log('[Gateway] Server shut down cleanly.');
    } catch {}
  }
}

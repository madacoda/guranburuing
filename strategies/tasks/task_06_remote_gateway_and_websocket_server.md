# Task 06: Remote Gateway & WebSocket Server

## 1. Task Objective
Implement the decoupled communications bridge: `src/gateway/server.ts` and `src/gateway/screencast.ts` based on [Principle 04](file:///c:/laragon/www/gbf/strategies/principles/04_remote_control_protocol.md).

The gateway provides **Bearer-token authenticated REST and WebSocket endpoints**, serves the mobile companion PWA via `@fastify/static`, enforces an **Async Mutex** to prevent concurrent page command race conditions, maintains **heartbeat ping-pong keepalives**, and streams real-time telemetry and adaptive WebP screencast frames with backpressure throttling.

---

## 2. Technical Specifications & File Deliverables

```
gbf/
├── src/
│   └── gateway/
│       ├── server.ts              # Fastify HTTP & WebSocket router with Mutex
│       └── screencast.ts          # CDP WebP screencast streamer with backpressure protection
└── tests/
    └── test-gateway-client.ts     # Mock WebSocket client for validation
```

---

## 3. Implementation Code

### 3.1 `src/gateway/screencast.ts`: Low-Bandwidth Viewport Streamer with Backpressure Protection

```typescript
// src/gateway/screencast.ts
import { Page, CDPSession } from 'puppeteer-core';
import { WebSocket } from 'ws';

export class ScreencastManager {
  private cdpSession: CDPSession | null = null;
  private clients: Set<WebSocket> = new Set();
  private isStreaming = false;
  private readonly MAX_BUFFER_BYTES = 256 * 1024; // 256 KB buffer limit before dropping frames

  constructor(private page: Page) {}

  public async initialize(): Promise<void> {
    this.cdpSession = await this.page.target().createCDPSession();

    this.cdpSession.on('Page.screencastFrame', async ({ data, sessionId }) => {
      // Acknowledge frame to CDP session to maintain stream flow
      try {
        await this.cdpSession?.send('Page.screencastFrameAck', { sessionId });
      } catch (e) {}

      const message = JSON.stringify({
        type: 'EVENT_SCREENCAST_FRAME',
        data: `data:image/webp;base64,${data}`,
        timestamp: Date.now()
      });

      // Broadcast frame to clients with backpressure protection
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount < this.MAX_BUFFER_BYTES) {
            client.send(message);
          }
          // If bufferedAmount > limit, drop frame for that client to avoid streaming lag
        }
      }
    });
  }

  public registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        this.stopStreaming();
      }
    });

    if (!this.isStreaming) {
      this.startStreaming();
    }
  }

  private async startStreaming(): Promise<void> {
    if (!this.cdpSession || this.isStreaming) return;
    try {
      this.isStreaming = true;
      await this.cdpSession.send('Page.startScreencast', {
        format: 'webp',
        quality: 50,
        maxWidth: 480,
        everyNthFrame: 10 // Yields ~2-3 FPS (ideal for cellular networks)
      });
      console.log('[Screencast] Adaptive WebP screencast started.');
    } catch (err: any) {
      console.error('[Screencast] Failed to start screencast:', err.message);
      this.isStreaming = false;
    }
  }

  private async stopStreaming(): Promise<void> {
    if (!this.cdpSession || !this.isStreaming) return;
    try {
      await this.cdpSession.send('Page.stopScreencast');
      this.isStreaming = false;
      console.log('[Screencast] Screencast paused (no active clients).');
    } catch (err: any) {
      console.error('[Screencast] Failed to stop screencast:', err.message);
    }
  }
}
```

---

### 3.2 `src/gateway/server.ts`: Fastify HTTP & WebSocket Gateway with Mutex

```typescript
// src/gateway/server.ts
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { Page } from 'puppeteer-core';
import { config } from '../config.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { ProSkipEngine } from '../engines/pro-skip.engine.js';
import { RaidEngine } from '../engines/raid.engine.js';
import { ScreencastManager } from './screencast.js';

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

    // WebSocket Gateway Endpoint
    this.app.get('/ws', { websocket: true }, (connection, req) => {
      const socket = connection.socket;

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
}
```

---

## 4. Verification & Testing Protocol

Create `tests/test-gateway-client.ts`:
```typescript
import { WebSocket } from 'ws';
import { config } from '../src/config.js';

const ws = new WebSocket(`ws://127.0.0.1:${config.PORT}/ws?token=${config.AUTH_TOKEN}`);

ws.on('open', () => {
  console.log('Connected to gateway! Sending test telemetry query...');
  ws.send(JSON.stringify({ type: 'CMD_TRIGGER_DAILY', payload: { target: 'magna_pro' } }));
});

ws.on('message', (data) => {
  console.log('Received from gateway:', data.toString().substring(0, 100));
});
```

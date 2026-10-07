// src/gateway/screencast.ts
import { Page, CDPSession } from 'puppeteer-core';
import { WebSocket } from 'ws';

export class ScreencastManager {
  private cdpSession: CDPSession | null = null;
  private clients: Set<WebSocket> = new Set();
  private isStreaming = false;
  private lastFrameTime = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private isCapturing = false;
  private readonly MAX_BUFFER_BYTES = 256 * 1024; // 256 KB buffer limit before dropping frames

  constructor(private page: Page) {}

  public async initialize(): Promise<void> {
    this.cdpSession = await this.page.target().createCDPSession();

    this.cdpSession.on('Page.screencastFrame', async ({ data, sessionId }) => {
      // Acknowledge frame to CDP session to maintain stream flow
      try {
        await this.cdpSession?.send('Page.screencastFrameAck', { sessionId });
      } catch (e) {}

      this.lastFrameTime = Date.now();
      this.broadcastFrame(data);
    });
  }

  public registerClient(ws: WebSocket): void {
    this.clients.add(ws);

    // Send immediate snapshot so user never sees blank / "connecting" screen
    this.sendImmediateSnapshot(ws).catch(() => {});

    ws.on('close', () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) {
        this.stopStreaming();
      }
    });

    if (this.clients.size > 0 && !this.isStreaming) {
      this.startStreaming();
    }
  }

  public async captureFrame(): Promise<string | null> {
    if (this.isCapturing) return null;
    this.isCapturing = true;
    try {
      if (this.cdpSession) {
        const res = await this.cdpSession.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 55
        });
        return res.data;
      }
    } catch {
      try {
        const buf = await this.page.screenshot({ type: 'jpeg', quality: 55 });
        return (buf as Buffer).toString('base64');
      } catch {}
    } finally {
      this.isCapturing = false;
    }
    return null;
  }

  public async sendImmediateSnapshot(targetWs?: WebSocket): Promise<void> {
    const data = await this.captureFrame();
    if (data) {
      this.lastFrameTime = Date.now();
      this.broadcastFrame(data, targetWs);
    }
  }

  public triggerImmediateCapture(delayMs = 120): void {
    setTimeout(async () => {
      if (this.clients.size > 0) {
        await this.sendImmediateSnapshot();
      }
    }, delayMs);
  }

  private broadcastFrame(data: string, targetWs?: WebSocket): void {
    const message = JSON.stringify({
      type: 'EVENT_SCREENCAST_FRAME',
      data: `data:image/jpeg;base64,${data}`,
      timestamp: Date.now()
    });

    if (targetWs) {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(message);
      }
      return;
    }

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount < this.MAX_BUFFER_BYTES) {
          client.send(message);
        }
      }
    }
  }

  private async startStreaming(): Promise<void> {
    if (!this.cdpSession || this.isStreaming) return;
    try {
      this.isStreaming = true;
      await this.cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 55,
        maxWidth: 480,
        everyNthFrame: 1 // Adaptive: 1:1 compositor sync
      });
      console.log('[Screencast] Adaptive JPEG screencast started.');

      // Active idle heartbeat (every 800ms) for static pages (login/auth/dialogs)
      // where Chromium software compositor emits zero frames
      if (!this.idleTimer) {
        this.idleTimer = setInterval(async () => {
          if (this.clients.size === 0) return;
          if (Date.now() - this.lastFrameTime >= 800) {
            await this.sendImmediateSnapshot();
          }
        }, 800);
      }
    } catch (err: any) {
      console.error('[Screencast] Failed to start screencast:', err.message);
      this.isStreaming = false;
    }
  }

  private async stopStreaming(): Promise<void> {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.cdpSession || !this.isStreaming) return;
    try {
      await this.cdpSession.send('Page.stopScreencast');
      this.isStreaming = false;
      console.log('[Screencast] Screencast paused (no active clients).');
    } catch (err: any) {
      console.error('[Screencast] Failed to stop screencast:', err.message);
    }
  }

  public async stop(): Promise<void> {
    await this.stopStreaming();
  }
}

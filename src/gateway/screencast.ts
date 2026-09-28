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
        data: `data:image/jpeg;base64,${data}`,
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

    if (this.clients.size > 0 && !this.isStreaming) {
      this.startStreaming();
    }
  }

  private async startStreaming(): Promise<void> {
    if (!this.cdpSession || this.isStreaming) return;
    try {
      this.isStreaming = true;
      await this.cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 50,
        maxWidth: 480,
        everyNthFrame: 10 // Yields ~2-3 FPS (ideal for cellular networks)
      });
      console.log('[Screencast] Adaptive JPEG screencast started.');
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

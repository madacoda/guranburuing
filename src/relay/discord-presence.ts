import net from 'net';
import { config } from '../config.js';
import {
  type PresenceMode,
  type FormattedPresence,
  type PresenceCustomOptions,
  formatPresenceByMode,
  loadPresenceConfig,
  savePresenceConfig
} from './presence-templates.js';

export type { PresenceMode, FormattedPresence, PresenceCustomOptions };

export interface PresenceState {
  mode?: PresenceMode;
  project?: string;
  task?: string;
  quote?: string;
  quoteAuthor?: string;
  raidName?: string;
  runNumber?: number;
  totalRuns?: number;
  goldBars?: number;
  goldBarsToday?: number;
  goldBarsSession?: number;
  blueChests?: number;
  dryStreak?: number;
  dryStreakMode?: 'blue_chest' | 'min_honor' | 'all_battles';
  honors?: number | string;
  status?: 'In Combat' | 'Searching' | 'Claiming Pending' | 'Idle' | 'Finished' | string;
  turn?: number;
  accountId?: string;
  startTimestamp?: number;
}

export class DiscordPresenceManager {
  private gatewayWs: WebSocket | null = null;
  private isGatewayReady = false;
  private heartbeatTimer: any = null;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;

  private ipcSocket: net.Socket | null = null;
  private isIpcReady = false;
  private lastIpcAttempt = 0;

  private currentState: PresenceState = {};
  private currentMode: PresenceMode = 'gbf';
  private customOptions: PresenceCustomOptions = {};
  private updateDebounceTimer: any = null;
  private sessionStartTime = Date.now();
  private lastGatewaySignature = '';
  private lastIpcSignature = '';
  private isConnectingIpc = false;

  constructor() {
    // Initialize active template mode from persistence or config
    const saved = loadPresenceConfig();
    this.currentMode = saved.mode || (config.DISCORD_PRESENCE_MODE as PresenceMode) || 'gbf';
    this.customOptions = {
      project: saved.project || config.DISCORD_PRESENCE_PROJECT || 'Every Hero',
      task: saved.task,
      quote: saved.quote,
    };
  }

  public setMode(mode: PresenceMode, options?: PresenceCustomOptions, immediate = true): void {
    this.currentMode = mode;
    if (options) {
      this.customOptions = { ...this.customOptions, ...options };
    }
    savePresenceConfig({
      mode,
      project: this.customOptions.project,
      task: this.customOptions.task,
      quote: this.customOptions.quote,
    });
    if (immediate) {
      this.ensureConnected();
      this.dispatchCurrentPresence();
    }
  }

  public getMode(): PresenceMode {
    return this.currentMode;
  }

  public getCustomOptions(): PresenceCustomOptions {
    return { ...this.customOptions };
  }

  public isEnabled(): boolean {
    if (process.env.DISCORD_PRESENCE_ENABLED === 'false' || process.env.DISCORD_PRESENCE_ENABLED === '0') {
      return false;
    }
    return Boolean(config.DISCORD_PRESENCE_ENABLED && config.DISCORD_BOT_TOKEN);
  }

  private ensureConnected(): void {
    if (!this.isEnabled()) return;
    if (!this.gatewayWs) this.initGateway();
    if (!this.ipcSocket && !this.isIpcReady) {
      this.initIpc().catch(() => {});
    }
  }

  /**
   * Initializes Discord Gateway WebSocket connection for live Bot Presence.
   */
  private initGateway(): void {
    if (!config.DISCORD_BOT_TOKEN || this.gatewayWs) return;

    try {
      const gatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json';
      this.gatewayWs = new WebSocket(gatewayUrl);

      this.gatewayWs.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.gatewayWs.onmessage = (event: MessageEvent) => {
        try {
          const payload = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(event.data.toString());
          this.handleGatewayPayload(payload);
        } catch {}
      };

      this.gatewayWs.onclose = () => {
        this.cleanupGateway();
        this.scheduleGatewayReconnect();
      };

      this.gatewayWs.onerror = () => {
        this.cleanupGateway();
        this.scheduleGatewayReconnect();
      };
    } catch {
      this.scheduleGatewayReconnect();
    }
  }

  private cleanupGateway(): void {
    this.isGatewayReady = false;
    this.lastGatewaySignature = '';
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.gatewayWs = null;
  }

  private scheduleGatewayReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(60000, Math.max(3000, this.reconnectAttempts * 4000));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isEnabled()) {
        this.initGateway();
      }
    }, delay);
    this.reconnectTimer?.unref?.();
  }

  private handleGatewayPayload(payload: any): void {
    const { op, d, t } = payload;

    // Opcode 10: HELLO -> Setup Heartbeat & IDENTIFY
    if (op === 10) {
      const interval = d?.heartbeat_interval || 41250;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
        this.sendGatewayHeartbeat();
      }, interval);
      this.heartbeatTimer?.unref?.();

      // Send Identify
      this.sendGatewayIdentify();
      return;
    }

    // Dispatch Events
    if (op === 0 && t === 'READY') {
      this.isGatewayReady = true;
      this.dispatchCurrentPresence();
      return;
    }
  }

  private sendGatewayHeartbeat(): void {
    if (this.gatewayWs && this.gatewayWs.readyState === WebSocket.OPEN) {
      this.gatewayWs.send(JSON.stringify({ op: 1, d: null }));
    }
  }

  private sendGatewayIdentify(): void {
    if (!this.gatewayWs || this.gatewayWs.readyState !== WebSocket.OPEN) return;

    const initialActivity = this.formatActivityData(this.currentState);

    const identifyPayload = {
      op: 2,
      d: {
        token: config.DISCORD_BOT_TOKEN,
        intents: 0, // No privileged intents needed for presence!
        properties: {
          os: process.platform,
          browser: 'guranburuing',
          device: 'guranburuing',
        },
        presence: {
          status: 'online',
          since: null,
          afk: false,
          activities: [
            {
              name: initialActivity.name,
              type: 0, // Playing
              state: initialActivity.state,
              details: initialActivity.details,
            },
          ],
        },
      },
    };

    this.gatewayWs.send(JSON.stringify(identifyPayload));
  }

  /**
   * Initializes Discord Desktop IPC named pipe connection for Local Rich Presence (RPC).
   * Probes discord-ipc-0 through discord-ipc-9 to reliably connect.
   */
  private async initIpc(): Promise<void> {
    const now = Date.now();
    if (this.isConnectingIpc || this.ipcSocket || (now - this.lastIpcAttempt < 5000)) return;
    this.lastIpcAttempt = now;
    this.isConnectingIpc = true;

    const clientId = config.DISCORD_CLIENT_ID || '1554396837127921714';
    const isWin = process.platform === 'win32';
    const pipePrefix = isWin ? '\\\\?\\pipe\\' : (process.env.XDG_RUNTIME_DIR || '/tmp') + '/';
    const pipeSuffix = isWin ? '' : '';

    try {
      for (let i = 0; i < 10; i++) {
        const pipePath = isWin ? `\\\\.\\pipe\\discord-ipc-${i}` : `${pipePrefix}discord-ipc-${i}${pipeSuffix}`;
        const connected = await this.tryConnectPipe(pipePath, clientId);
        if (connected) break;
      }
    } finally {
      this.isConnectingIpc = false;
    }
  }

  private tryConnectPipe(pipePath: string, clientId: string): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      try {
        const socket = net.connect(pipePath);

        socket.once('connect', () => {
          if (resolved) return;
          resolved = true;
          this.ipcSocket = socket;

          socket.on('data', (data: Buffer) => {
            let offset = 0;
            while (offset < data.length) {
              if (data.length - offset < 8) break;
              const op = data.readInt32LE(offset);
              const len = data.readInt32LE(offset + 4);
              const raw = data.slice(offset + 8, offset + 8 + len).toString('utf-8');
              offset += 8 + len;

              try {
                const parsed = JSON.parse(raw);
                if (op === 1 && parsed.cmd === 'DISPATCH' && parsed.evt === 'READY') {
                  this.isIpcReady = true;
                  this.dispatchIpcActivity();
                }
              } catch {}
            }
          });

          socket.on('error', () => {
            this.cleanupIpc();
          });

          socket.on('close', () => {
            this.cleanupIpc();
          });

          // Send Handshake packet (op 0)
          const handshake = JSON.stringify({ v: 1, client_id: clientId });
          this.sendIpcPacket(0, handshake);
          resolve(true);
        });

        socket.once('error', () => {
          if (!resolved) {
            resolved = true;
            try { socket.destroy(); } catch {}
            resolve(false);
          }
        });
      } catch {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }
    });
  }

  private cleanupIpc(): void {
    this.isIpcReady = false;
    this.lastIpcSignature = '';
    if (this.ipcSocket) {
      try {
        this.ipcSocket.destroy();
      } catch {}
      this.ipcSocket = null;
    }
  }

  private sendIpcPacket(op: number, jsonString: string): void {
    if (!this.ipcSocket || this.ipcSocket.destroyed) return;
    try {
      const body = Buffer.from(jsonString, 'utf-8');
      const header = Buffer.alloc(8);
      header.writeInt32LE(op, 0);
      header.writeInt32LE(body.length, 4);
      this.ipcSocket.write(Buffer.concat([header, body]));
    } catch {}
  }

  /**
   * Translates internal PresenceState into human-friendly Discord activity strings.
   * Dispatches according to active template mode (gbf, work, trade).
   */
  public formatActivityData(state: PresenceState): FormattedPresence {
    const targetMode = state.mode || this.currentMode || 'gbf';
    return formatPresenceByMode(targetMode, state, {
      project: state.project || this.customOptions.project,
      task: state.task || this.customOptions.task,
      quote: state.quote || this.customOptions.quote,
      author: state.quoteAuthor || this.customOptions.author,
    });
  }

  /**
   * Updates current presence state with debouncing to respect Discord rate limits.
   */
  public updateStatus(partial: Partial<PresenceState>, immediate = false): void {
    if (!this.isEnabled()) return;
    this.currentState = { ...this.currentState, ...partial };
    this.ensureConnected();

    if (immediate) {
      if (this.updateDebounceTimer) {
        clearTimeout(this.updateDebounceTimer);
        this.updateDebounceTimer = null;
      }
      this.dispatchCurrentPresence();
      return;
    }

    if (!this.updateDebounceTimer) {
      this.updateDebounceTimer = setTimeout(() => {
        this.updateDebounceTimer = null;
        this.dispatchCurrentPresence();
      }, 2500);
      this.updateDebounceTimer?.unref?.();
    }
  }

  /**
   * Broadcasts current presence to both the Discord Bot Gateway and Local Desktop IPC.
   */
  private dispatchCurrentPresence(): void {
    const act = this.formatActivityData(this.currentState);
    const signature = `${act.name}|${act.details}|${act.state}`;

    // 1. Dispatch to Discord Bot Gateway
    if (this.isGatewayReady && this.gatewayWs && this.gatewayWs.readyState === WebSocket.OPEN) {
      if (signature !== this.lastGatewaySignature) {
        try {
          const presenceUpdate = {
            op: 3,
            d: {
              since: null,
              status: 'online',
              afk: false,
              activities: [
                {
                  name: act.name,
                  type: 0, // 0 = Playing
                  state: act.state,
                  details: act.details,
                },
              ],
            },
          };
          this.gatewayWs.send(JSON.stringify(presenceUpdate));
          this.lastGatewaySignature = signature;
        } catch {}
      }
    } else if (!this.gatewayWs) {
      this.initGateway();
    }

    // 2. Dispatch to Desktop Local IPC
    this.dispatchIpcActivity();
  }

  private dispatchIpcActivity(): void {
    if (!this.isIpcReady || !this.ipcSocket || this.ipcSocket.destroyed) {
      this.initIpc().catch(() => {});
      return;
    }

    try {
      const act = this.formatActivityData(this.currentState);
      const signature = `${act.name}|${act.details}|${act.state}`;
      if (signature === this.lastIpcSignature) return;

      const payload = {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          activity: {
            details: act.details,
            state: act.state,
            timestamps: {
              start: this.currentState.startTimestamp || this.sessionStartTime,
            },
            assets: {
              large_text: act.largeText || act.name,
              small_text: act.smallText || act.details,
            },
          },
        },
        nonce: String(Date.now()),
      };

      this.sendIpcPacket(1, JSON.stringify(payload));
      this.lastIpcSignature = signature;
    } catch {}
  }

  /**
   * Graceful shutdown of presence sockets and heartbeats.
   */
  public shutdown(): void {
    if (this.updateDebounceTimer) clearTimeout(this.updateDebounceTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    if (this.gatewayWs) {
      try {
        // Send idle status before disconnecting
        if (this.gatewayWs.readyState === WebSocket.OPEN) {
          this.gatewayWs.send(
            JSON.stringify({
              op: 3,
              d: {
                since: null,
                status: 'idle',
                afk: true,
                activities: [],
              },
            })
          );
        }
        this.gatewayWs.close();
      } catch {}
      this.gatewayWs = null;
    }

    this.cleanupIpc();
  }
}

export const discordPresence = new DiscordPresenceManager();

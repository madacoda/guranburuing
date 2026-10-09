// src/services/discord/discord-command-gateway.service.ts
import { config } from '../../config.js';
import { discordDmRelay, DiscordMessageResponse } from '../../relay/discord-dm-relay.js';
import { processRunnerService, COMMAND_WHITELIST, ActiveJob } from './process-runner.service.js';
import { dailyResetScheduler } from '../scheduler/daily-reset.scheduler.js';

export interface CommandGatewayOptions {
  pollingIntervalMs?: number;
}

/**
 * High-Security Remote Controller Gateway for Granblue Fantasy.
 * Connects to Discord via real-time WebSocket Gateway + REST DM listener.
 * Strictly verifies sender snowflake against DISCORD_USER_ID in private DM.
 * Enforces strict whitelist execution and provides real-time telemetry updates.
 */
export class DiscordCommandGatewayService {
  private isRunning = false;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private dmChannelId: string | null = null;
  private processedMessageIds = new Set<string>();
  private readonly baseUrl = 'https://discord.com/api/v10';

  constructor() {
    // Register auto-notification when any spawned job finishes
    processRunnerService.onJobExit((job: ActiveJob, exitCode: number | null, durationMs: number) => {
      this.notifyJobCompletion(job, exitCode, durationMs).catch(err => {
        console.warn(`[CommandGateway] Failed to notify job completion: ${err.message}`);
      });
    });
  }

  /**
   * Starts the secure Discord remote control gateway daemon.
   */
  public async start(options: CommandGatewayOptions = {}): Promise<void> {
    if (this.isRunning) {
      console.log('[CommandGateway] ⚠️ Discord Command Gateway is already running.');
      return;
    }

    if (!discordDmRelay.isConfigured()) {
      throw new Error('[CommandGateway] DISCORD_BOT_TOKEN and DISCORD_USER_ID must be set in .env');
    }

    this.isRunning = true;
    this.dmChannelId = await discordDmRelay.getDmChannelId();

    console.log('\n========================================================================');
    console.log('       🛡️ Granblue Fantasy - Discord Remote Command Gateway             ');
    console.log('========================================================================');
    console.log(`Authorized User ID: ${config.DISCORD_USER_ID}`);
    console.log(`Private DM Channel: ${this.dmChannelId}`);
    console.log(`CDP Port Lock:      Port 9222 (Single-process guarded)`);
    console.log(`Security Protocol:  Strict DM sender snowflake + Command Whitelist`);
    console.log('========================================================================\n');

    // 1. Initial greeting to user DM
    try {
      await discordDmRelay.sendMessage(
        '🛡️ **GBF Remote Cockpit Online**\n' +
        'Autonomous controller initialized and listening in secure private session.\n' +
        '• Type `/help` for available commands.\n' +
        '• Type `/run daily` to launch daily reset routine.\n' +
        '• Type `/status` to inspect running jobs.'
      );
    } catch (err: any) {
      console.warn(`[CommandGateway] Could not send initial greeting: ${err.message}`);
    }

    // 2. Start Gateway WebSocket for sub-second event triggers
    this.connectGateway();

    // 3. Start resilient REST Polling Loop (acts as failsafe if WebSocket drops)
    const pollInterval = options.pollingIntervalMs ?? 2500;
    this.startRestPolling(pollInterval);
  }

  /**
   * Connects to Discord Gateway WebSocket.
   */
  private connectGateway(): void {
    if (!this.isRunning) return;

    try {
      console.log('[CommandGateway] 🔌 Connecting to Discord Gateway...');
      this.ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

      this.ws.onopen = () => {
        console.log('[CommandGateway] 🌐 Gateway WebSocket connected.');
      };

      this.ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data.toString());
          await this.handleGatewayPayload(payload);
        } catch (err: any) {
          console.warn(`[CommandGateway] Error parsing gateway message: ${err.message}`);
        }
      };

      this.ws.onerror = (err) => {
        console.warn(`[CommandGateway] Gateway WebSocket error:`, err);
      };

      this.ws.onclose = (event) => {
        console.log(`[CommandGateway] 🔌 Gateway closed (code ${event.code}). Cleaning up...`);
        this.clearHeartbeat();
        if (this.isRunning) {
          // Reconnect with exponential backoff
          setTimeout(() => this.connectGateway(), 5000);
        }
      };
    } catch (err: any) {
      console.error(`[CommandGateway] Failed to connect Gateway WebSocket:`, err.message);
      if (this.isRunning) {
        setTimeout(() => this.connectGateway(), 10000);
      }
    }
  }

  /**
   * Handles Gateway Opcodes and Events.
   */
  private async handleGatewayPayload(payload: any): Promise<void> {
    const { op, d, t } = payload;

    // Opcode 10: HELLO -> Start Heartbeat & Identify
    if (op === 10) {
      const heartbeatInterval = d.heartbeat_interval;
      console.log(`[CommandGateway] 💓 Gateway HELLO received. Heartbeat: ${heartbeatInterval}ms`);
      this.startHeartbeat(heartbeatInterval);

      // Identify with DIRECT_MESSAGES intent (4096)
      const identifyPayload = {
        op: 2,
        d: {
          token: config.DISCORD_BOT_TOKEN,
          intents: 4096, // DIRECT_MESSAGES
          properties: {
            os: 'windows',
            browser: 'bun',
            device: 'bun'
          }
        }
      };
      this.ws?.send(JSON.stringify(identifyPayload));
    }

    // Opcode 11: Heartbeat ACK
    if (op === 11) {
      // Heartbeat acknowledged
    }

    // Event: MESSAGE_CREATE
    if (op === 0 && t === 'MESSAGE_CREATE') {
      const msg = d;
      // Gateway trigger: fetch latest message via REST to get full content and execute
      if (msg.channel_id === this.dmChannelId && msg.author?.id === config.DISCORD_USER_ID) {
        await this.processMessageById(msg.id);
      }
    }
  }

  /**
   * Starts periodic Gateway heartbeat.
   */
  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ op: 1, d: null }));
      }
    }, intervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Resilient REST Polling Loop for the operator's DM channel.
   */
  private startRestPolling(intervalMs: number): void {
    this.pollTimer = setInterval(async () => {
      if (!this.isRunning || !this.dmChannelId) return;

      try {
        const url = `${this.baseUrl}/channels/${this.dmChannelId}/messages?limit=5`;
        const res = await fetch(url, {
          headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` }
        });

        if (!res.ok) return;

        const messages = (await res.json()) as DiscordMessageResponse[];
        if (!Array.isArray(messages)) return;

        // Process oldest to newest
        const validMessages = messages
          .filter(m => m.author.id === config.DISCORD_USER_ID && !m.author.bot && !this.processedMessageIds.has(m.id))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        for (const msg of validMessages) {
          await this.handleOperatorMessage(msg);
        }
      } catch (err: any) {
        // Silently continue polling on transient network hiccups
      }
    }, intervalMs);
  }

  /**
   * Fetches a specific message by ID and processes it.
   */
  private async processMessageById(messageId: string): Promise<void> {
    if (this.processedMessageIds.has(messageId)) return;

    try {
      const url = `${this.baseUrl}/channels/${this.dmChannelId}/messages/${messageId}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` }
      });

      if (!res.ok) return;
      const msg = (await res.json()) as DiscordMessageResponse;
      await this.handleOperatorMessage(msg);
    } catch (err: any) {
      console.warn(`[CommandGateway] Error fetching message ${messageId}: ${err.message}`);
    }
  }

  /**
   * Evaluates and routes an operator command.
   */
  public async handleOperatorMessage(msg: DiscordMessageResponse): Promise<void> {
    // 1. Double verification of sender snowflake and message identity
    if (this.processedMessageIds.has(msg.id)) return;
    this.processedMessageIds.add(msg.id);

    // Prune set if it grows excessively
    if (this.processedMessageIds.size > 200) {
      const arr = Array.from(this.processedMessageIds);
      this.processedMessageIds = new Set(arr.slice(-100));
    }

    if (msg.author.id !== config.DISCORD_USER_ID || msg.author.bot) {
      return;
    }

    const text = msg.content.trim();
    if (!text) return;

    console.log(`[CommandGateway] 📩 Operator Command received: "${text}"`);

    // 2. Dispatch to command handlers
    if (text.startsWith('/run') || text.startsWith('run')) {
      await this.handleRunCommand(text);
    } else if (text === '/status' || text === 'status') {
      await this.handleStatusCommand();
    } else if (text === '/stop' || text === '/halt' || text === 'stop' || text === 'halt') {
      await this.handleStopCommand();
    } else if (text === '/reset' || text === '/next' || text === 'next' || text === 'reset') {
      await this.handleResetInfoCommand();
    } else if (text === '/help' || text === 'help') {
      await this.handleHelpCommand();
    }
  }

  /**
   * Handles `/run <target> [args]` command.
   */
  private async handleRunCommand(rawText: string): Promise<void> {
    const parts = rawText.split(/\s+/).filter(p => p.length > 0);
    // Remove leading '/run' or 'run'
    parts.shift();

    if (parts.length === 0) {
      await discordDmRelay.sendMessage(
        '⚠️ **Usage**: `/run <command>`\n\n' +
        'Example: `/run daily` or `/run gb-pbhl`\n' +
        'Type `/help` to see all available presets.'
      );
      return;
    }

    const targetKey = parts[0].toLowerCase();
    const extraArgs = parts.slice(1);

    const result = await processRunnerService.startCommand(targetKey, extraArgs);
    await discordDmRelay.sendMessage(result.message);
  }

  /**
   * Handles `/status` command.
   */
  private async handleStatusCommand(): Promise<void> {
    const status = processRunnerService.getStatus();
    const resetInfo = dailyResetScheduler.getScheduleInfo();

    if (!status.isBusy || !status.job) {
      const response = [
        '🟢 **GBF Automation Status: IDLE**',
        '• **Process**: No active automation job currently running.',
        '• **CDP Port**: 9222 (Unlocked & Ready)',
        `• **Next Daily Reset**: \`${resetInfo.nextResetJstString}\` (${resetInfo.formattedCountdown})`,
        '',
        '👉 Send `/run <command>` to launch a task, or `/help` for command list.'
      ].join('\n');

      await discordDmRelay.sendMessage(response);
      return;
    }

    const job = status.job;
    const lastOutputSnippet = job.lastOutputLines.length > 0
      ? `\`\`\`\n${job.lastOutputLines.slice(-5).join('\n')}\n\`\`\``
      : '_No output captured yet._';

    const response = [
      '🟡 **GBF Automation Status: BUSY**',
      `• **Active Job**: \`${job.key}\` (PID: \`${job.pid}\`)`,
      `• **Uptime**: \`${job.uptimeFormatted}\``,
      `• **Command**: \`bun ${job.args.join(' ')}\``,
      '',
      '**Latest Terminal Output:**',
      lastOutputSnippet,
      '',
      '👉 Send `/stop` or `/halt` if you wish to terminate this job.'
    ].join('\n');

    await discordDmRelay.sendMessage(response);
  }

  /**
   * Handles `/stop` / `/halt` command.
   */
  private async handleStopCommand(): Promise<void> {
    const result = await processRunnerService.stopActiveProcess();
    await discordDmRelay.sendMessage(result.message);
  }

  /**
   * Handles `/reset` info command.
   */
  private async handleResetInfoCommand(): Promise<void> {
    const info = dailyResetScheduler.getScheduleInfo();
    const response = [
      '⏰ **GBF Daily Server Reset Schedule**',
      `• **Next Reset**: \`${info.nextResetJstString}\``,
      `• **Time Remaining**: **${info.formattedCountdown}**`,
      '• **Cadence**: Daily 05:00:15 JST (UTC+9)',
      '• **Autonomous Pipeline**: Universal Pro Skips → Daily Raid Hosting Suite → Self-Healing Retry Pass'
    ].join('\n');

    await discordDmRelay.sendMessage(response);
  }

  /**
   * Handles `/help` command.
   */
  private async handleHelpCommand(): Promise<void> {
    const lines = [
      '📖 **GBF Remote Cockpit Commands**',
      '',
      '**Available `/run` Presets:**'
    ];

    for (const [key, preset] of Object.entries(COMMAND_WHITELIST)) {
      lines.push(`• \`/run ${key}\` — ${preset.description}`);
    }

    lines.push(
      '',
      '**System Controls:**',
      '• `/status` — View current running job, PID, uptime, and terminal output',
      '• `/stop` (or `/halt`) — Gracefully terminate active running task',
      '• `/reset` — View exact countdown until next 05:00 JST GBF daily reset',
      '• `/help` — Display this manual'
    );

    await discordDmRelay.sendMessage(lines.join('\n'));
  }

  /**
   * Dispatches summary notification upon background job completion.
   */
  private async notifyJobCompletion(job: ActiveJob, exitCode: number | null, durationMs: number): Promise<void> {
    const durationSec = Math.round(durationMs / 1000);
    const durStr = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
    const isSuccess = exitCode === 0;

    const lastLines = job.outputBuffer.slice(-4).join('\n');
    const snippet = lastLines.length > 0 ? `\`\`\`\n${lastLines}\n\`\`\`` : '';

    const lines = [
      isSuccess ? '🏁 **Automation Job Finished**' : '⚠️ **Automation Job Halted with Errors**',
      `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
      `• **Result**: ${isSuccess ? '✅ Success (Exit Code 0)' : `❌ Exit Code ${exitCode}`}`,
      `• **Duration**: \`${durStr}\``
    ];

    if (snippet) {
      lines.push('', '**Terminal Summary:**', snippet);
    }

    lines.push('', 'CDP Port 9222 is now released and ready for new commands.');

    await discordDmRelay.sendMessage(lines.join('\n'));
  }

  /**
   * Shuts down the gateway daemon.
   */
  public stop(): void {
    this.isRunning = false;
    this.clearHeartbeat();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    console.log('[CommandGateway] 🛑 Discord Command Gateway stopped.');
  }
}

export const discordCommandGatewayService = new DiscordCommandGatewayService();

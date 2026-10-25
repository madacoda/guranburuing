// src/services/discord/discord-command-gateway.service.ts
import { config } from '../../config.js';
import { discordDmRelay, DiscordMessageResponse } from '../../relay/discord-dm-relay.js';
import { processRunnerService, COMMAND_WHITELIST, ActiveJob } from './process-runner.service.js';
import { dailyResetScheduler } from '../scheduler/daily-reset.scheduler.js';
import { inventoryAuditorService } from '../behavior/inventory-auditor.service.js';

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

    // 1. Initial greeting to user DM & Start background scheduler daemon
    if (!dailyResetScheduler.getIsRunning()) {
      try {
        dailyResetScheduler.startDaemon();
      } catch (err: any) {
        console.warn(`[CommandGateway] Could not auto-start daily scheduler: ${err.message}`);
      }
    }

    try {
      const schedInfo = dailyResetScheduler.getScheduleInfo();
      await discordDmRelay.sendMessage(
        '🛡️ **GBF Remote Cockpit Online**\n' +
        'Autonomous controller initialized and listening in secure private session.\n' +
        `• **Daily Scheduler**: 🟢 ACTIVE (Next: \`${schedInfo.nextResetJstString}\` / \`${schedInfo.nextResetWibString}\` — **${schedInfo.formattedCountdown}**)\n` +
        '• **Quick Commands**:\n' +
        '  - `/gbf daily` — Launch daily Pro Skips only (Favorites, Hard+, Omega, Halo, Gacha, Casino)\n' +
        '  - `/gbf daily:host` — Launch full 16-raid Daily Hosting suite (HL, Magna 3, Dragons)\n' +
        '  - `/gbf daily:hostgb` — Host Gold Bar daily raids only (PBHL, Akasha, GOHL, Lindwurm)\n' +
        '  - `/gbf gb-akasha` — Akasha Blue Chest Gold Bar Farm\n' +
        '  - `/gbf gb-pbhl` — PBHL Blue Chest Gold Bar Farm\n' +
        '  - `/gbf scheduler:off` / `/gbf scheduler:on` — Pause/resume 21:00 JST (19:00 WIB) Peak-Hour scheduler\n' +
        '  - `/gbf status` — View active job, scheduler state, and terminal output\n' +
        '  - `/gbf stop` — Halt current active task\n' +
        '  - `/gbf help` — Display full command list'
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

    const raw = msg.content.trim();
    if (!raw) return;

    // STRICT PREFIX FILTER: Only listen to commands with prefix /gbf
    if (!/^\/gbf([\s:]+.*|$)/i.test(raw)) {
      // Silently discard any message that does not start with /gbf
      return;
    }

    console.log(`[CommandGateway] 📩 Operator Command received: "${raw}"`);

    // Extract command body after /gbf prefix
    let commandBody = raw.replace(/^\/gbf[\s:]*/i, '').trim();

    // Default to 'status' if /gbf sent alone
    if (!commandBody) {
      commandBody = 'status';
    }

    // Strip optional redundant "run" keyword (e.g. "/gbf run daily" -> "daily", "/gbf run gb-akasha" -> "gb-akasha")
    if (/^run[\s:]+/i.test(commandBody)) {
      commandBody = commandBody.replace(/^run[\s:]+/i, '').trim();
    }

    const parts = commandBody.split(/\s+/).filter(p => p.length > 0);
    const action = parts[0]?.toLowerCase() || 'status';
    const extraArgs = parts.slice(1);

    // 2. Dispatch to command handlers
    if (action === 'scheduler:off' || (action === 'scheduler' && extraArgs[0]?.toLowerCase() === 'off')) {
      await this.handleSchedulerToggle(false);
    } else if (action === 'scheduler:on' || (action === 'scheduler' && extraArgs[0]?.toLowerCase() === 'on')) {
      await this.handleSchedulerToggle(true);
    } else if (action === 'status') {
      await this.handleStatusCommand();
    } else if (action === 'stop' || action === 'halt') {
      await this.handleStopCommand();
    } else if (action === 'reset' || action === 'next') {
      await this.handleResetInfoCommand();
    } else if (action === 'logs' || action === 'log') {
      await this.handleLogsCommand();
    } else if (action === 'inventory' || action === 'supplies') {
      await this.handleInventoryCommand();
    } else if (action === 'farm:human' || action === 'human') {
      await this.handleRunCommand('farm:human', extraArgs);
    } else if (action === 'help') {
      await this.handleHelpCommand();
    } else {
      // Execute whitelisted preset or template (e.g. "daily", "gb-akasha", "gb-pbhl", "leech", "workflow")
      await this.handleRunCommand(action, extraArgs);
    }
  }

  /**
   * Handles `/gbf <target> [args]` command.
   */
  private async handleRunCommand(targetKey: string, extraArgs: string[] = []): Promise<void> {
    if (!targetKey) {
      await discordDmRelay.sendMessage(
        '⚠️ **Usage**: `/gbf <command>` (e.g. `/gbf daily`, `/gbf gb-akasha`)\n' +
        'Send `/gbf help` to view all available commands.'
      );
      return;
    }

    const result = await processRunnerService.startCommand(targetKey, extraArgs);
    await discordDmRelay.sendMessage(result.message);
  }

  /**
   * Handles `/status` command.
   */
  private async handleStatusCommand(): Promise<void> {
    const status = processRunnerService.getStatus();
    const resetInfo = dailyResetScheduler.getScheduleInfo();
    const schedulerRunning = dailyResetScheduler.getIsRunning();
    const schedStatusStr = schedulerRunning
      ? `🟢 ACTIVE (Next: \`${resetInfo.nextResetJstString}\` / \`${resetInfo.nextResetWibString}\` — **${resetInfo.formattedCountdown}**)`
      : '⏸️ PAUSED (Scheduler is OFF)';

    if (!status.isBusy || !status.job) {
      const response = [
        '🟢 **GBF Automation Status: IDLE**',
        '• **Process**: No active automation job currently running.',
        '• **CDP Port**: 9222 (Unlocked & Ready)',
        `• **Daily Scheduler**: ${schedStatusStr}`,
        '',
        '👉 Send `/gbf daily` to launch a task, or `/gbf help` for command list.'
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
      '👉 Send `/gbf stop` or `/gbf halt` if you wish to terminate this job.'
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
      '⏰ **GBF Peak-Hour Daily Routine Schedule**',
      `• **Next Execution**: \`${info.nextResetJstString}\` (\`${info.nextResetWibString}\`)`,
      `• **Time Remaining**: **${info.formattedCountdown}**`,
      '• **Cadence**: Daily 21:00:15 JST / 19:00:15 WIB (Peak Golden Time & Strike Time)',
      '• **Autonomous Pipeline**: Universal Pro Skips → Daily Raid Hosting Suite → Self-Healing Retry Pass'
    ].join('\n');

    await discordDmRelay.sendMessage(response);
  }

  /**
   * Handles scheduler on/off toggle commands.
   */
  private async handleSchedulerToggle(enable: boolean): Promise<void> {
    if (enable) {
      if (dailyResetScheduler.getIsRunning()) {
        const info = dailyResetScheduler.getScheduleInfo();
        await discordDmRelay.sendMessage(
          `🟢 **Daily Scheduler is ALREADY ACTIVE**\n• Next Execution: \`${info.nextResetJstString}\` / \`${info.nextResetWibString}\` (**${info.formattedCountdown}**)`
        );
        return;
      }
      try {
        dailyResetScheduler.startDaemon();
        const info = dailyResetScheduler.getScheduleInfo();
        await discordDmRelay.sendMessage(
          `▶️ **Daily Peak-Hour Scheduler ACTIVATED**\n• Cadence: Daily 21:00:15 JST / 19:00:15 WIB (Peak Golden Time)\n• Next Execution: \`${info.nextResetJstString}\` / \`${info.nextResetWibString}\` (**${info.formattedCountdown}**)\n• Pipeline: Universal Pro Skips → Daily 16-Raid Suite`
        );
      } catch (err: any) {
        await discordDmRelay.sendMessage(`❌ Failed to start scheduler: ${err.message}`);
      }
    } else {
      if (!dailyResetScheduler.getIsRunning()) {
        await discordDmRelay.sendMessage('⏸️ **Daily Scheduler is ALREADY PAUSED (OFF)**');
        return;
      }
      dailyResetScheduler.stopDaemon();
      await discordDmRelay.sendMessage(
        '🛑 **Daily Peak-Hour Scheduler PAUSED (OFF)**\nAutonomous 21:00 JST (19:00 WIB) triggers are suspended.\nSend `/gbf scheduler:on` to resume.'
      );
    }
  }

  /**
   * Handles `/logs` command.
   */
  private async handleLogsCommand(): Promise<void> {
    const lines = processRunnerService.getRecentLogs(15);
    const logSnippet = lines.length > 0 ? `\`\`\`text\n${lines.join('\n')}\n\`\`\`` : '_No logs captured yet._';
    await discordDmRelay.sendMessage(
      `📜 **Recent Automation Terminal Logs (last 15 lines):**\n${logSnippet}`
    );
  }

  /**
   * Handles `/inventory` command.
   */
  private async handleInventoryCommand(): Promise<void> {
    const snapshot = inventoryAuditorService.getLatestSnapshot();
    if (snapshot) {
      await discordDmRelay.sendMessage(
        inventoryAuditorService.formatSnapshotForDiscord(snapshot)
      );
    } else {
      await discordDmRelay.sendMessage(
        '🔍 No cached inventory snapshot found. Launching live in-game inventory audit job on port 9222...'
      );
      await this.handleRunCommand('inventory');
    }
  }

  /**
   * Handles `/help` command.
   */
  private async handleHelpCommand(): Promise<void> {
    const lines = [
      '📖 **GBF Remote Cockpit Commands**',
      'All commands use the unified `/gbf` prefix:',
      '',
      '**Quick Routine & Farming Commands:**',
      '• `/gbf daily` (or `/gbf run daily`) — Universal Pro Skips only (Favorites, Hard+, Omega, Halo, Gacha, Casino)',
      '• `/gbf daily:host` — Complete 16-Raid Daily Hosting Suite (HL, Magna 3, Dragons)',
      '• `/gbf daily:hostgb` — Daily Gold Bar Raids Hosting only (PBHL, Akasha, GOHL, Lindwurm)',
      '• `/gbf daily:routine` — Chained Daily Reset Routine (Pro Skips → 16 Hosts → Retry)',
      '• `/gbf gb-akasha` — Akasha HL Blue Chest Gold Bar Farm',
      '• `/gbf gb-pbhl` — Proto Bahamut HL Blue Chest Gold Bar Farm',
      '• `/gbf gb-go` — Grand Order HL Blue Chest Gold Bar Farm',
      '• `/gbf gb-farm` — Tri-Raid Blue Chest Gold Bar Rotation (PBHL → Akasha → GOHL)',
      '• `/gbf farm:human` — Human behavioral cadence farming (GB + leech + rest + audit)',
      '• `/gbf fate` — Autonomous Fate Episode Skip (10 episodes)',
      '• `/gbf inventory` — In-Game Inventory & Supply Audit (#item Gold Bars, Pots, Berries, Moons)',
      '• `/gbf goldbar` — Gold Bar drops & battle audit summary',
      '• `/gbf leech <raid>` — Fast leech raid (e.g. `/gbf leech colossus-ira`, `/gbf leech:tiamat`)',
      '• `/gbf workflow <template>` — Run template (e.g. `/gbf workflow raid-wilnas`)',
      '',
      '**Available Preset Tasks (`/gbf <preset>`):**'
    ];

    for (const [key, preset] of Object.entries(COMMAND_WHITELIST)) {
      lines.push(`• \`/gbf ${key}\` — ${preset.description}`);
    }

    lines.push(
      '',
      '**System & Scheduler Controls:**',
      '• `/gbf status` — View running job, PID, uptime, and terminal output',
      '• `/gbf stop` (or `/gbf halt`) — Gracefully terminate active running task',
      '• `/gbf scheduler:off` — Pause autonomous 21:00 JST (19:00 WIB) peak scheduler',
      '• `/gbf scheduler:on` — Resume autonomous 21:00 JST (19:00 WIB) peak scheduler',
      '• `/gbf reset` (or `/gbf next`) — View countdown to next 21:00 JST (19:00 WIB) scheduled run',
      '• `/gbf logs` — View last 15 lines of live terminal output',
      '• `/gbf help` — Display this manual'
    );

    await discordDmRelay.sendMessage(lines.join('\n'));
  }

  /**
   * Dispatches summary notification upon background job completion or mid-execution stoppage.
   * Informs operator with exact root cause, account state, and actionable recovery commands.
   */
  private async notifyJobCompletion(job: ActiveJob, exitCode: number | null, durationMs: number): Promise<void> {
    // If the job was preempted to switch tasks, the new command's response
    // already acknowledges the termination and reports the new launch.
    // Suppress redundant/confusing "Automation Stopped" DM to avoid operator spam.
    if (job.preemptedBy) {
      console.log(`[CommandGateway] ℹ️ Job \`${job.key}\` (PID ${job.pid}) was preempted by \`${job.preemptedBy}\`. Suppressing standalone exit DM.`);
      return;
    }

    const durationSec = Math.round(durationMs / 1000);
    const durStr = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
    const buffer = job.outputBuffer;

    // Detect stoppage cause from runtime output buffer and operator signals
    const isCaptchaHalt = buffer.some(l => /CAPTCHA|SENTINEL_HALT|Captcha wait timed out|VERIFICATION CHALLENGE/i.test(l));
    const isSessionExpired = buffer.some(l => /session has expired|re-authentication|could not be authenticated/i.test(l));
    const isDailyLimit = buffer.some(l => /daily host limit reached|insufficient materials|host treasure|0 daily hosts remaining/i.test(l));
    const isMaintenance = buffer.some(l => /under maintenance|Maintenance Announcement/i.test(l));
    const isOperatorStopped = !!job.stoppedByOperator || buffer.some(l => /Terminating job|Ctrl\+C detected|Stop requested/i.test(l));
    const isSuccess = exitCode === 0 && !isOperatorStopped && !isCaptchaHalt && !isSessionExpired;

    const lines: string[] = [];

    if (isOperatorStopped) {
      lines.push(
        '🛑 **Automation Stopped in Progress: Operator Cancelled**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Reason**: Stopped in the middle of execution via operator command (\`/gbf stop\`).`,
        `• **Duration**: \`${durStr}\``,
        `• **Account State**: 💤 Standby Mode (GBF tab closed, \`about:blank\` idle — 0% CPU). Session preserved.`
      );
    } else if (isCaptchaHalt) {
      lines.push(
        '🛑 **Automation Stopped in Progress: CAPTCHA Challenge Timed Out**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Reason**: Verification puzzle appeared during runs and timed out without being resolved.`,
        `• **Duration**: \`${durStr}\``,
        `• **Action Taken**: Execution halted to protect account. Browser returned safely to Homescreen (\`#mypage\`).`,
        `• **Session Status**: 🛡️ Session preserved (NOT logged out).`,
        `• **Next Steps**: Solve challenge via \`bun run vps:login\` or run next task with \`/gbf <command>\` when ready.`
      );
    } else if (isSessionExpired) {
      lines.push(
        '⚠️ **Automation Stopped in Progress: Session Expired**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Reason**: Account session expired or requires fresh authentication.`,
        `• **Duration**: \`${durStr}\``,
        `• **Next Steps**: Synchronize session from local PC with \`bun run session:sync acc1\` or log in via \`bun run vps:login\`.`
      );
    } else if (isDailyLimit) {
      lines.push(
        'ℹ️ **Automation Concluded: Daily Limits Reached**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Reason**: Daily hosting limits reached or host materials depleted for today.`,
        `• **Duration**: \`${durStr}\``,
        `• **Next Steps**: Check inventory with \`/gbf inventory\` or view next reset with \`/gbf reset\`.`
      );
    } else if (isMaintenance) {
      lines.push(
        '🛠️ **Automation Stopped: Game Under Maintenance**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Reason**: Granblue Fantasy servers are currently undergoing scheduled maintenance.`,
        `• **Duration**: \`${durStr}\``
      );
    } else if (isSuccess) {
      lines.push(
        '🏁 **Automation Completed Successfully**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Result**: ✅ Finished cleanly (Exit Code 0)`,
        `• **Duration**: \`${durStr}\``,
        `• **Account State**: 💤 Standby Mode (GBF tab closed, \`about:blank\` idle — 0% CPU).`
      );
    } else {
      lines.push(
        '⚠️ **Automation Stopped in Progress: Unexpected Error**',
        `• **Job**: \`${job.key}\` (PID \`${job.pid}\`)`,
        `• **Result**: ❌ Exited with code ${exitCode}`,
        `• **Duration**: \`${durStr}\``,
        `• **Reason**: Automation encountered an unexpected error during execution and aborted.`
      );
    }

    const lastLines = buffer.slice(-4).join('\n');
    if (lastLines.length > 0) {
      lines.push('', '**Terminal Summary:**', `\`\`\`\n${lastLines}\n\`\`\``);
    }

    lines.push('', '🔓 CDP Port 9222 is now released and ready for new commands.');

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

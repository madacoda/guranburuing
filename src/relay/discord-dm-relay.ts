// src/relay/discord-dm-relay.ts
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface DiscordMessageResponse {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  timestamp: string;
}

export interface DiscordAttachment {
  buffer: Buffer;
  filename: string;
}

export interface CaptchaContext {
  accountId?: string;
  playerName?: string;
  questName?: string;
  raidId?: string;
  runNumber?: number;
  hpPct?: number;
  players?: string;
  attempt?: number;
  maxAttempts?: number;
}

export class DiscordDmRelay {
  private dmChannelId: string | null = null;
  private readonly baseUrl = 'https://discord.com/api/v10';
  private static testMessagesSent = 0;
  private static testSessionFile = path.resolve(process.cwd(), 'data', '.test-discord-counter.json');

  /**
   * Returns how many messages have been dispatched during the current test session across all workers.
   */
  public static getTestMessageCount(): number {
    try {
      if (fs.existsSync(DiscordDmRelay.testSessionFile)) {
        const raw = fs.readFileSync(DiscordDmRelay.testSessionFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.count === 'number') return parsed.count;
      }
    } catch {}
    return DiscordDmRelay.testMessagesSent;
  }

  /**
   * Records a dispatched message during test mode and persists the counter.
   */
  public static recordTestMessageSent(): number {
    const current = DiscordDmRelay.getTestMessageCount();
    const next = current + 1;
    DiscordDmRelay.testMessagesSent = next;
    try {
      const dir = path.dirname(DiscordDmRelay.testSessionFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(DiscordDmRelay.testSessionFile, JSON.stringify({ count: next, lastSent: new Date().toISOString() }));
    } catch {}
    return next;
  }

  /**
   * Resets the test message counter for a clean test run.
   */
  public static resetTestMessageCounter(): void {
    DiscordDmRelay.testMessagesSent = 0;
    try {
      if (fs.existsSync(DiscordDmRelay.testSessionFile)) {
        fs.unlinkSync(DiscordDmRelay.testSessionFile);
      }
    } catch {}
  }

  /**
   * Checks if Discord DM relay has the required environment credentials.
   */
  public isConfigured(): boolean {
    return Boolean(config.DISCORD_BOT_TOKEN && config.DISCORD_USER_ID);
  }

  /**
   * Initializes or retrieves the cached 1-on-1 DM channel ID with the configured user.
   */
  public async getDmChannelId(): Promise<string> {
    if (this.dmChannelId) {
      return this.dmChannelId;
    }

    if (!this.isConfigured()) {
      throw new Error('[DiscordDmRelay] DISCORD_BOT_TOKEN and DISCORD_USER_ID must be set in .env');
    }

    const res = await fetch(`${this.baseUrl}/users/@me/channels`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: config.DISCORD_USER_ID }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[DiscordDmRelay] Failed to open DM channel with user ${config.DISCORD_USER_ID} (Status ${res.status}): ${errText}`);
    }

    const channelData = (await res.json()) as { id: string };
    this.dmChannelId = channelData.id;
    return this.dmChannelId;
  }

  private notifiedKeys = new Map<string, number>();
  private activeCaptchaPrompt = false;
  private static activePromptFile = path.resolve(process.cwd(), 'data', '.active-captcha-prompt.json');

  private static readonly RESERVED_CONTROLLER_COMMANDS = new Set([
    'status', 'stop', 'reset', 'next', 'logs', 'log', 'inventory', 'supplies',
    'human', 'farm:human', 'help', 'daily', 'daily:skips', 'daily:routine',
    'daily:host', 'daily:hostgb', 'daily:host:gb', 'hostgb', 'gb-pbhl',
    'gb-akasha', 'gb-go', 'gb-farm', 'farm', 'leech', 'workflow', 'faahl',
    'belial', 'bubz', 'lindwurm', 'empyreal', 'wilnas', 'fediel', 'siete',
    'seofon', 'raid-seofon', 'siete:check', 'siete:setup', 'agastia',
    'raid-agastia', 'theworld', 'db3', 'goldbar', 'eternitysand', 'sand',
    'fate', 'slime', 'shiny-slime', 'shiny-slime-search', 'scheduler',
    'scheduler:on', 'scheduler:off', 'run'
  ]);

  private setCaptchaPromptState(active: boolean, timeoutMs = 300000): void {
    this.activeCaptchaPrompt = active;
    try {
      if (active) {
        const dir = path.dirname(DiscordDmRelay.activePromptFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          DiscordDmRelay.activePromptFile,
          JSON.stringify({ pid: process.pid, expiresAt: Date.now() + timeoutMs })
        );
      } else if (fs.existsSync(DiscordDmRelay.activePromptFile)) {
        fs.unlinkSync(DiscordDmRelay.activePromptFile);
      }
    } catch {}
  }

  /**
   * Returns true while an interactive CAPTCHA DM prompt is actively awaiting an operator reply
   * (either in the current process or in a child automation process).
   */
  public isCaptchaPromptActive(): boolean {
    if (this.activeCaptchaPrompt) return true;
    try {
      if (fs.existsSync(DiscordDmRelay.activePromptFile)) {
        const raw = JSON.parse(fs.readFileSync(DiscordDmRelay.activePromptFile, 'utf8'));
        if (typeof raw?.expiresAt === 'number' && raw.expiresAt > Date.now()) {
          return true;
        }
        fs.unlinkSync(DiscordDmRelay.activePromptFile);
      }
    } catch {}
    return false;
  }

  private isTemplateCommandName(tokenLower: string): boolean {
    if (!/^[a-z0-9_.-]+$/.test(tokenLower)) return false;
    const clean = tokenLower.replace(/\.json$/i, '');
    const candidates = [clean, `raid-${clean}`, `farm-${clean}`, `leech-${clean}`, `arcarum-${clean}`];
    for (const c of candidates) {
      if (fs.existsSync(path.resolve(process.cwd(), 'templates', `${c}.json`))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Validates and extracts a player CAPTCHA reply from a raw Discord DM message.
   * Requires the `/gbf` prefix (e.g. `/gbf 8392`, `/gbf 1 3`, `/gbf captcha g4h65f`, `/gbf halt`)
   * and rejects casual chat (e.g. "gold bar dropped"), multi-word prose, and controller commands.
   */
  public parseCaptchaReply(rawContent: string): string | null {
    const trimmed = rawContent.trim().replace(/^`+|`+$/g, '').trim();
    if (!trimmed) return null;

    // Require explicit /gbf prefix with arguments
    const prefixMatch = trimmed.match(/^\/gbf[\s:]+(.+)$/i);
    if (!prefixMatch || !prefixMatch[1]) {
      return null;
    }

    let body = prefixMatch[1].trim().replace(/^`+|`+$/g, '').trim();
    if (!body) return null;

    // Strip optional explicit verification subcommand keyword (e.g. "/gbf captcha 8392")
    body = body.replace(/^(?:captcha|verify|code|solve|answer|reply)[\s:]+/i, '').trim().replace(/^`+|`+$/g, '').trim();
    if (!body) return null;

    // 1. Check for manual browser halt keywords (e.g. "/gbf halt", "/gbf pause")
    if (/^(halt|pause|manual|freeze)$/i.test(body)) {
      return 'HALT_REQUESTED';
    }

    // 2. Reject known controller commands or preset/template names
    const parts = body.split(/\s+/);
    const firstTokenLower = parts[0].toLowerCase();
    if (
      DiscordDmRelay.RESERVED_CONTROLLER_COMMANDS.has(firstTokenLower) ||
      firstTokenLower.includes(':') ||
      /^(?:gb|raid|leech|farm|daily|arcarum|shiny)-/i.test(firstTokenLower) ||
      this.isTemplateCommandName(firstTokenLower)
    ) {
      return null;
    }

    // 3. Accept valid tile grid indices (1 to 9 digits 1-9 separated by spaces/commas/hyphens, e.g. "1 3")
    if (/^[1-9](?:[\s,–#-]+[1-9]){0,8}$/.test(body)) {
      return body;
    }

    // 4. Accept single-token verification code (2-12 alphanumeric or Japanese characters, no spaces)
    if (parts.length === 1 && /^[a-zA-Z0-9\u3040-\u30ff\uFF00-\uFFEF]{2,12}$/.test(body)) {
      return body;
    }

    return null;
  }

  /**
   * Checks if an alert with this key or content has recently been dispatched.
   */
  public isDuplicateAlert(content: string, dedupeKey?: string): boolean {
    const now = Date.now();
    // Prune entries older than 24 hours
    for (const [k, ts] of this.notifiedKeys.entries()) {
      if (now - ts > 86400000) this.notifiedKeys.delete(k);
    }

    if (dedupeKey && this.notifiedKeys.has(dedupeKey)) {
      return true;
    }

    // Auto-detect raid ID in Gold Bar / Drop alerts
    const isGoldBar = content.includes('Gold Brick') || content.includes('GOLD BAR') || content.includes('ヒヒイロカネ');
    if (isGoldBar) {
      const raidMatch = content.match(/(?:\*{0,2}(?:Raid ID|Battle ID)\*{0,2}:?\s*`?|result(?:_multi)?\/|#)(\d{8,})/i);
      if (raidMatch && raidMatch[1]) {
        const key = `gold-bar-${raidMatch[1]}`;
        if (this.notifiedKeys.has(key)) return true;
      }
    }

    // Auto-detect active CAPTCHA alert: suppress secondary alerts while an active CAPTCHA prompt session is already awaiting reply
    const isCaptcha = content.includes('CAPTCHA') || content.includes('VERIFICATION CHALLENGE');
    if (isCaptcha && this.activeCaptchaPrompt && dedupeKey !== 'active-captcha-prompt') {
      return true;
    }

    return false;
  }

  public recordAlertDispatched(content: string, dedupeKey?: string): void {
    const now = Date.now();
    // Only cache regular dedupe keys (never permanently blacklist CAPTCHA challenge prompt)
    if (dedupeKey && dedupeKey !== 'active-captcha-prompt') {
      this.notifiedKeys.set(dedupeKey, now);
    }

    const isGoldBar = content.includes('Gold Brick') || content.includes('GOLD BAR') || content.includes('ヒヒイロカネ');
    if (isGoldBar) {
      const raidMatch = content.match(/(?:\*{0,2}(?:Raid ID|Battle ID)\*{0,2}:?\s*`?|result(?:_multi)?\/|#)(\d{8,})/i);
      if (raidMatch && raidMatch[1]) {
        this.notifiedKeys.set(`gold-bar-${raidMatch[1]}`, now);
      }
    }
  }

  /**
   * Sends a message to the user's private DM, optionally attaching one or more image buffers.
   * Enforces deduplication to prevent spamming multiple notifications for the same drop or CAPTCHA,
   * unless force=true is specified (e.g. for emergency interactive challenges).
   */
  public async sendMessage(
    content: string,
    attachments?: Buffer | DiscordAttachment[] | { buffer: Buffer; filename: string },
    defaultFilename = 'captcha.png',
    dedupeKey?: string,
    force = false
  ): Promise<DiscordMessageResponse> {
    // 0. Test Mode Anti-Spam Guard: strictly caps test dispatches to at most 1 message per test run
    const isTestMode = process.env.NODE_ENV === 'test' || process.env.GBF_TEST_MODE === '1';
    if (isTestMode) {
      const maxAllowed = parseInt(process.env.DISCORD_MAX_TEST_MESSAGES ?? '1', 10);
      const currentSent = DiscordDmRelay.getTestMessageCount();
      if (currentSent >= maxAllowed) {
        console.log(
          `[DiscordDmRelay] 🛡️ [TEST ANTI-SPAM] Suppressed Discord message (${currentSent}/${maxAllowed} limit reached for test run). Preview: "${content.replace(/\r?\n/g, ' ').slice(0, 60)}..."`
        );
        return {
          id: `test-suppressed-${Date.now()}`,
          content,
          author: { id: 'bot', username: 'GBF Relay (Test Guard)', bot: true },
          timestamp: new Date().toISOString()
        };
      }
      DiscordDmRelay.recordTestMessageSent();
      console.log(
        `[DiscordDmRelay] ℹ️ [TEST MODE] Dispatching allowed test message (${currentSent + 1}/${maxAllowed}). Subsequent test messages will be suppressed.`
      );
    }

    // Deduplication check (bypassed if force === true)
    if (!force && this.isDuplicateAlert(content, dedupeKey)) {
      console.log(`[DiscordDmRelay] ⏭️ Suppressing duplicate notification for DM.`);
      return {
        id: 'deduped',
        content,
        author: { id: 'bot', username: 'GBF Relay', bot: true },
        timestamp: new Date().toISOString()
      };
    }

    if (!this.isConfigured()) {
      if (isTestMode) {
        console.log(`[DiscordDmRelay] ℹ️ [TEST MODE] Credentials unconfigured in test mode. Returning mock response.`);
        return {
          id: `test-unconfigured-${Date.now()}`,
          content,
          author: { id: 'bot', username: 'GBF Relay (Test Mock)', bot: true },
          timestamp: new Date().toISOString()
        };
      }
      throw new Error('[DiscordDmRelay] DISCORD_BOT_TOKEN and DISCORD_USER_ID must be set in .env');
    }

    const channelId = await this.getDmChannelId();
    const url = `${this.baseUrl}/channels/${channelId}/messages`;
    const safeContent = content.length > 1980 ? `${content.slice(0, 1960)}\n...(truncated)` : content;

    // Determine whether non-empty attachments exist
    const hasAttachments = (): boolean => {
      if (!attachments) return false;
      if (Array.isArray(attachments)) return attachments.some((a) => a?.buffer && a.buffer.length > 0);
      if (Buffer.isBuffer(attachments)) return attachments.length > 0;
      if (attachments.buffer) return attachments.buffer.length > 0;
      return false;
    };

    let res: Response;

    if (attachments && hasAttachments()) {
      const formData = new FormData();
      formData.append('content', safeContent);

      if (Array.isArray(attachments)) {
        attachments.forEach((att, idx) => {
          if (att?.buffer && att.buffer.length > 0) {
            formData.append(`files[${idx}]`, new Blob([new Uint8Array(att.buffer)], { type: 'image/png' }), att.filename);
          }
        });
      } else if (Buffer.isBuffer(attachments)) {
        if (attachments.length > 0) {
          formData.append('files[0]', new Blob([new Uint8Array(attachments)], { type: 'image/png' }), defaultFilename);
        }
      } else if ('buffer' in attachments && attachments.buffer && attachments.buffer.length > 0) {
        formData.append('files[0]', new Blob([new Uint8Array(attachments.buffer)], { type: 'image/png' }), attachments.filename || defaultFilename);
      }

      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
        },
        body: formData,
      });
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: safeContent }),
      });
    }

    if (res.status === 429) {
      try {
        const rateLimitData = await res.json();
        const retryAfterMs = Math.ceil((rateLimitData.retry_after || 1) * 1000) + 100;
        await new Promise(r => setTimeout(r, retryAfterMs));
        return await this.sendMessage(content, attachments, defaultFilename, dedupeKey, force);
      } catch {}
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[DiscordDmRelay] Failed to send message to DM (Status ${res.status}): ${errText}`);
    }

    this.recordAlertDispatched(content, dedupeKey);
    return (await res.json()) as DiscordMessageResponse;
  }

  /**
   * Listens and polls for a reply from the user in the DM channel.
   * Only messages sent by the configured DISCORD_USER_ID after promptMessageId are accepted.
   */
  public async waitForReply(
    promptMessageId: string,
    timeoutMs = 300000,
    pollIntervalMs = 2500,
    onPollTick?: (elapsedMs: number) => Promise<boolean | void> | boolean | void
  ): Promise<string | null> {
    if (!promptMessageId || promptMessageId === 'deduped' || !/^\d{17,20}$/.test(promptMessageId)) {
      console.error(`[DiscordDmRelay] ⚠️ Invalid prompt message ID ("${promptMessageId}"). Aborting reply listener to avoid API errors.`);
      return null;
    }

    const channelId = this.isConfigured() ? await this.getDmChannelId() : null;
    const targetUserId = config.DISCORD_USER_ID || 'test-user';
    const startTime = Date.now();
    const ignoredMessageIds = new Set<string>();
    let cursorMessageId = promptMessageId;

    console.log(`[DiscordDmRelay] 👂 Listening for user DM reply with /gbf prefix (Target User ID: ${targetUserId}, Timeout: ${timeoutMs / 1000}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const elapsed = Date.now() - startTime;
      if (onPollTick) {
        const earlyBreak = await onPollTick(elapsed);
        if (earlyBreak) {
          console.log('[DiscordDmRelay] ⚡ Early resolution signaled via onPollTick.');
          return 'RESOLVED_EXTERNALLY';
        }
      }

      if (!channelId) {
        continue;
      }

      try {
        const url = `${this.baseUrl}/channels/${channelId}/messages?after=${cursorMessageId}&limit=25`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
          },
        });

        if (!res.ok) {
          const errDetail = await res.text().catch(() => '');
          console.warn(`[DiscordDmRelay] Poll request warning (Status ${res.status}): ${errDetail}`);
          continue;
        }

        const messages = (await res.json()) as DiscordMessageResponse[];
        if (Array.isArray(messages) && messages.length > 0) {
          // Sort chronologically ascending (oldest first after cursor)
          const sortedMessages = [...messages].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );

          for (const msg of sortedMessages) {
            if (msg.author.id === targetUserId && !msg.author.bot && msg.content.trim().length > 0) {
              const parsedReply = this.parseCaptchaReply(msg.content);
              if (parsedReply) {
                console.log(
                  `[DiscordDmRelay] 📩 Received valid /gbf CAPTCHA reply: "${parsedReply}" (Raw: "${msg.content.trim()}", Message ID: ${msg.id})`
                );
                return parsedReply;
              }

              if (!ignoredMessageIds.has(msg.id)) {
                ignoredMessageIds.add(msg.id);
                console.log(
                  `[DiscordDmRelay] ⏭️ Ignoring non-CAPTCHA DM message (ID: ${msg.id}): "${msg.content.trim()}" (requires "/gbf <code|tiles|halt>")`
                );
              }
            }

            if (msg?.id && /^\d{17,20}$/.test(msg.id)) {
              cursorMessageId = msg.id;
            }
          }
        }
      } catch (err: any) {
        console.warn(`[DiscordDmRelay] Transient error polling DM messages: ${err.message}`);
      }
    }

    console.error(`[DiscordDmRelay] ⏱️ Timed out waiting for DM reply after ${timeoutMs / 1000}s.`);
    return null;
  }

  /**
   * Broadcasts a CAPTCHA challenge screenshot to DM and halts execution until user replies with the code.
   * Can attach both an isolated puzzle crop (for mobile clarity) and the full viewport.
   * Formatted concisely, displaying in-game player name and clear action choices.
   */
  public async requestCaptchaResolution(
    images: Buffer | { fullScreenshot: Buffer; puzzleCrop?: Buffer },
    timeoutMs = 300000,
    onPollTick?: (elapsedMs: number) => Promise<boolean | void> | boolean | void,
    context?: CaptchaContext
  ): Promise<string | null> {
    const isRetry = Boolean(context?.attempt && context.attempt > 1);
    const playerDisplay = context?.playerName
      ? `${context.playerName}${context.accountId && context.accountId !== context.playerName ? ` (\`${context.accountId}\`)` : ''}`
      : (context?.accountId ? `\`${context.accountId}\`` : 'Player');

    const lines: string[] = [];
    if (!isRetry) {
      lines.push('🚨 **GBF CAPTCHA DETECTED**');
    } else {
      lines.push(`⚠️ **CAPTCHA NOT CLEARED (Attempt ${context?.attempt}/${context?.maxAttempts || 5})**`);
    }

    lines.push(`• **Player**: **${playerDisplay}**`);
    if (context?.questName) lines.push(`• **Quest / Raid**: **${context.questName}**`);
    if (context?.runNumber !== undefined) lines.push(`• **Run**: \`#${context.runNumber}\``);
    if (context?.raidId) lines.push(`• **Raid ID**: \`${context.raidId}\``);

    lines.push('');
    if (!isRetry) {
      lines.push(
        '👉 Reply with **`/gbf <code>`** (e.g. `/gbf 8392`) or **`/gbf <tiles>`** (e.g. `/gbf 1 3`).',
        '👉 Or reply **`/gbf halt`** to pause and solve in browser.'
      );
    } else {
      lines.push(
        'Popup still present (new puzzle capture attached above).',
        '👉 Reply with new **`/gbf <code>`** or **`/gbf <tiles>`**.',
        '👉 Or reply **`/gbf halt`** to pause and solve in browser.'
      );
    }

    const alertPrompt = lines.join('\n');

    let attachments: DiscordAttachment[] | Buffer;

    if (Buffer.isBuffer(images)) {
      attachments = images;
    } else {
      attachments = [];
      if (images.puzzleCrop && images.puzzleCrop.length > 0) {
        attachments.push({ buffer: images.puzzleCrop, filename: 'captcha-puzzle.png' });
      }
      if (images.fullScreenshot && images.fullScreenshot.length > 0) {
        attachments.push({ buffer: images.fullScreenshot, filename: 'captcha-challenge.png' });
      }
    }

    // CRITICAL: Always dispatch initial CAPTCHA prompt with force=true so it is NEVER suppressed
    const promptMessage = await this.sendMessage(
      alertPrompt,
      attachments,
      'captcha-challenge.png',
      undefined,
      true // force = true: bypass deduplication for emergency CAPTCHA prompts
    );

    console.log(`[DiscordDmRelay] 📤 CAPTCHA challenge sent to user DM (Prompt ID: ${promptMessage.id}).`);

    if (!promptMessage.id || promptMessage.id === 'deduped' || !/^\d{17,20}$/.test(promptMessage.id)) {
      console.error(`[DiscordDmRelay] ❌ Could not obtain valid Discord message ID for prompt (ID: ${promptMessage.id}). Cannot listen for replies.`);
      return null;
    }

    // Set activeCaptchaPrompt = true ONLY during reply polling window so secondary spam is throttled
    this.setCaptchaPromptState(true, timeoutMs);
    try {
      return await this.waitForReply(promptMessage.id, timeoutMs, 2500, onPollTick);
    } finally {
      this.setCaptchaPromptState(false);
    }
  }

  /**
   * Sends confirmation update message back to the DM.
   */
  public async sendConfirmation(message: string): Promise<void> {
    try {
      await this.sendMessage(message);
    } catch (err: any) {
      console.warn(`[DiscordDmRelay] Could not send confirmation DM: ${err.message}`);
    }
  }
}

export const discordDmRelay = new DiscordDmRelay();

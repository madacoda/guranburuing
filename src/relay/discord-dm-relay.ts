// src/relay/discord-dm-relay.ts
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

    const channelId = await this.getDmChannelId();
    const url = `${this.baseUrl}/channels/${channelId}/messages`;

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
      formData.append('content', content);

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
        body: JSON.stringify({ content }),
      });
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

    const channelId = await this.getDmChannelId();
    const targetUserId = config.DISCORD_USER_ID!;
    const startTime = Date.now();

    console.log(`[DiscordDmRelay] 👂 Listening for user DM reply (Target User ID: ${targetUserId}, Timeout: ${timeoutMs / 1000}s)...`);

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

      try {
        const url = `${this.baseUrl}/channels/${channelId}/messages?after=${promptMessageId}&limit=10`;
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
          // Sort chronologically ascending (oldest first after prompt)
          const validReplies = messages
            .filter((m) => m.author.id === targetUserId && !m.author.bot && m.content.trim().length > 0)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

          if (validReplies.length > 0) {
            const userMsg = validReplies[0];
            const responseText = userMsg.content.trim();
            console.log(`[DiscordDmRelay] 📩 Received user DM reply: "${responseText}" (Message ID: ${userMsg.id})`);

            // Detect manual halt request from operator
            if (/^(halt|stop|manual|pause|freeze)$/i.test(responseText)) {
              return 'HALT_REQUESTED';
            }
            return responseText;
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
        '👉 Reply with **code** (e.g. `8392`) or **tiles** (e.g. `1 3`).',
        '👉 Or reply **`halt`** to pause and solve in browser.'
      );
    } else {
      lines.push(
        'Popup still present (new puzzle capture attached above).',
        '👉 Reply with new **code** or **tiles**.',
        '👉 Or reply **`halt`** to pause and solve in browser.'
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
    this.activeCaptchaPrompt = true;
    try {
      return await this.waitForReply(promptMessage.id, timeoutMs, 2500, onPollTick);
    } finally {
      this.activeCaptchaPrompt = false;
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

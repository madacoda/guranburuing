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

  /**
   * Sends a message to the user's private DM, optionally attaching one or more image buffers.
   */
  public async sendMessage(
    content: string,
    attachments?: Buffer | DiscordAttachment[] | { buffer: Buffer; filename: string },
    defaultFilename = 'captcha.png'
  ): Promise<DiscordMessageResponse> {
    const channelId = await this.getDmChannelId();
    const url = `${this.baseUrl}/channels/${channelId}/messages`;

    let res: Response;

    if (attachments) {
      const formData = new FormData();
      formData.append('content', content);

      if (Array.isArray(attachments)) {
        attachments.forEach((att, idx) => {
          formData.append(`files[${idx}]`, new Blob([new Uint8Array(att.buffer)], { type: 'image/png' }), att.filename);
        });
      } else if (Buffer.isBuffer(attachments)) {
        formData.append('files[0]', new Blob([new Uint8Array(attachments)], { type: 'image/png' }), defaultFilename);
      } else if (attachments.buffer) {
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
    onPollTick?: (elapsedMs: number) => void
  ): Promise<string | null> {
    const channelId = await this.getDmChannelId();
    const targetUserId = config.DISCORD_USER_ID!;
    const startTime = Date.now();

    console.log(`[DiscordDmRelay] 👂 Listening for user DM reply (Target User ID: ${targetUserId}, Timeout: ${timeoutMs / 1000}s)...`);

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const elapsed = Date.now() - startTime;
      if (onPollTick) onPollTick(elapsed);

      try {
        const url = `${this.baseUrl}/channels/${channelId}/messages?after=${promptMessageId}&limit=10`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
          },
        });

        if (!res.ok) {
          console.warn(`[DiscordDmRelay] Poll request warning (Status ${res.status})`);
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
   */
  public async requestCaptchaResolution(
    images: Buffer | { fullScreenshot: Buffer; puzzleCrop?: Buffer },
    timeoutMs = 300000
  ): Promise<string | null> {
    const alertPrompt = [
      '🚨 **CRITICAL: GBF CAPTCHA / VERIFICATION CHALLENGE DETECTED!**',
      'Automation has been **hard-frozen** to protect your account.',
      '',
      '👉 Please inspect the attached picture(s) and **reply to this DM** with your answer:',
      '• **Text Code**: Enter the characters (e.g. `8392`)',
      '• **Picture / Tile Selection**: Enter the tile numbers (e.g. `1 3` or `2 4 1`)',
      '',
      `⏱️ *Waiting for your reply (Timeout: ${timeoutMs / 60000} minutes)...*`,
    ].join('\n');

    let attachments: DiscordAttachment[] | Buffer;

    if (Buffer.isBuffer(images)) {
      attachments = images;
    } else {
      attachments = [];
      if (images.puzzleCrop) {
        attachments.push({ buffer: images.puzzleCrop, filename: 'captcha-puzzle.png' });
      }
      attachments.push({ buffer: images.fullScreenshot, filename: 'viewport-context.png' });
    }

    const promptMessage = await this.sendMessage(alertPrompt, attachments, 'captcha-challenge.png');
    console.log(`[DiscordDmRelay] 📤 CAPTCHA challenge sent to user DM (Prompt ID: ${promptMessage.id}).`);

    return await this.waitForReply(promptMessage.id, timeoutMs);
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

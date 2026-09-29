import { config } from './config.js';
import { discordDmRelay } from './relay/discord-dm-relay.js';

export class AlertRelay {
  private lastAlertTimestamp = 0;
  private readonly ALERT_COOLDOWN_MS = 60000; // 1-minute deduplication window

  /**
   * Broadcasts an emergency alert with an attached screenshot to configured channels.
   */
  public async sendEmergencyAlert(message: string, screenshotBuffer: Buffer): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertTimestamp < this.ALERT_COOLDOWN_MS) {
      console.warn('[AlertRelay] Alert throttled to prevent spamming webhooks.');
      return;
    }
    this.lastAlertTimestamp = now;

    console.error(`[AlertRelay] 🚨 ${message}`);
    const promises: Promise<void>[] = [];

    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
      promises.push(this.sendTelegramPhoto(message, screenshotBuffer));
    }

    if (config.DISCORD_WEBHOOK_URL) {
      promises.push(this.sendDiscordWebhook(message, screenshotBuffer));
    }

    if (discordDmRelay.isConfigured()) {
      promises.push(
        discordDmRelay.sendMessage(message, screenshotBuffer, 'alert.png').then(() => {}).catch((err: any) => {
          console.error('[AlertRelay] Discord DM dispatch error:', err.message);
        })
      );
    }

    // Audible terminal bell
    process.stdout.write('\x07\x07\x07');

    await Promise.allSettled(promises);
  }

  private async sendTelegramPhoto(caption: string, imageBuffer: Buffer): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendPhoto`;
      const formData = new FormData();
      formData.append('chat_id', config.TELEGRAM_CHAT_ID!);
      formData.append('caption', caption);
      formData.append('photo', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'verification.png');

      const res = await fetch(url, { method: 'POST', body: formData });
      if (!res.ok) {
        console.error(`[AlertRelay] Telegram dispatch failed with status: ${res.status}`);
      } else {
        console.log('[AlertRelay] Telegram photo alert sent successfully.');
      }
    } catch (err: any) {
      console.error('[AlertRelay] Telegram send error:', err.message);
    }
  }

  private async sendDiscordWebhook(content: string, imageBuffer: Buffer): Promise<void> {
    try {
      const formData = new FormData();
      formData.append('content', `🚨 **URGENT: Granblue Fantasy Verification Triggered!**\n${content}`);
      formData.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'captcha.png');

      const res = await fetch(config.DISCORD_WEBHOOK_URL!, { method: 'POST', body: formData });
      if (!res.ok) {
        console.error(`[AlertRelay] Discord webhook failed with status: ${res.status}`);
      } else {
        console.log('[AlertRelay] Discord webhook alert sent successfully.');
      }
    } catch (err: any) {
      console.error('[AlertRelay] Discord send error:', err.message);
    }
  }
}

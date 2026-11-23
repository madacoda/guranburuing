import { config } from './config.js';
import { discordDmRelay } from './relay/discord-dm-relay.js';

export interface WhatsAppRelayConfig {
  accessToken?: string;
  phoneNumberId?: string;
  recipientPhone?: string;
  apiVersion?: string;
  templateName?: string;
  templateLang?: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  mode: 'image' | 'text' | 'template' | 'skipped' | 'failed';
  errorCode?: number;
  errorMessage?: string;
}

export interface EmergencyAlertOptions {
  force?: boolean;
  urgent?: boolean;
}

export interface CallMeBotConfig {
  phone?: string;
  apiKey?: string;
}

export interface CallMeBotSendResult {
  ok: boolean;
  status?: number;
  body?: string;
  errorMessage?: string;
  skipped?: boolean;
}

export class AlertRelay {
  private static lastAlertTimestamp = 0;
  private static notifiedAlertKeys = new Set<string>();
  private readonly ALERT_COOLDOWN_MS = 60000; // 1-minute deduplication window

  /**
   * Broadcasts an emergency alert with an optional attached screenshot to configured channels.
   */
  public async sendEmergencyAlert(
    message: string,
    screenshotBuffer?: Buffer,
    options?: EmergencyAlertOptions
  ): Promise<void> {
    const now = Date.now();
    if (!options?.force && now - AlertRelay.lastAlertTimestamp < this.ALERT_COOLDOWN_MS) {
      console.warn('[AlertRelay] Alert throttled to prevent spamming webhooks.');
      return;
    }

    // Deduplicate by raid ID if present (bypassed when force=true)
    const raidMatch = message.match(/(?:Raid ID|Battle ID|detail|#)\/?:?\s*`?(\d{8,})`?/i);
    if (!options?.force && raidMatch && raidMatch[1]) {
      const raidKey = `raid-${raidMatch[1]}`;
      if (AlertRelay.notifiedAlertKeys.has(raidKey)) {
        console.log(`[AlertRelay] ⏭️ Suppressing duplicate emergency alert for raid ${raidMatch[1]}.`);
        return;
      }
      AlertRelay.notifiedAlertKeys.add(raidKey);
    }

    AlertRelay.lastAlertTimestamp = now;

    console.error(`[AlertRelay] 🚨 ${message}`);
    const promises: Promise<void>[] = [];

    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
      promises.push(this.sendTelegramPhoto(message, screenshotBuffer));
    }

    if (config.DISCORD_WEBHOOK_URL) {
      promises.push(this.sendDiscordWebhook(message, screenshotBuffer));
    }

    // Dedicated Discord DM: only send for non-CAPTCHA and non-high-tier-drop emergency events,
    // as CAPTCHA challenges, Gold Bar drops, and Eternity Sand drops are handled by their own dedicated DM relays.
    const isCaptcha = message.includes('CAPTCHA') || message.includes('Verification CAPTCHA') || message.includes('VERIFICATION CHALLENGE');
    const isGoldBar = message.includes('Gold Brick') || message.includes('GOLD BAR') || message.includes('ヒヒイロカネ');
    const isEternitySand = message.includes('Eternity Sand') || message.includes('ETERNITY SAND') || message.includes('刻の流砂');
    const isDropAlert = isGoldBar || isEternitySand;
    const isUrgent = Boolean(options?.urgent) || isCaptcha || /SENTINEL|HALT|PAUSED|STOPPED/i.test(message);

    if (
      config.WHATSAPP_ACCESS_TOKEN &&
      config.WHATSAPP_PHONE_NUMBER_ID &&
      config.WHATSAPP_RECIPIENT_PHONE &&
      (!config.WHATSAPP_URGENT_ONLY || isUrgent || !isDropAlert)
    ) {
      promises.push(this.sendWhatsAppAlert(message, screenshotBuffer).then(() => {}));
    }

    if (
      config.CALLMEBOT_APIKEY &&
      (config.CALLMEBOT_PHONE || config.WHATSAPP_RECIPIENT_PHONE) &&
      (!config.WHATSAPP_URGENT_ONLY || isUrgent || !isDropAlert)
    ) {
      promises.push(this.sendCallMeBotAlert(message).then(() => {}));
    }

    if (discordDmRelay.isConfigured() && !isCaptcha && !isGoldBar && !isEternitySand) {
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

  /**
   * Dispatches a 1-way alert to WhatsApp Business Cloud API (image/text inside 24h window,
   * with optional pre-approved utility template fallback on error 131047).
   */
  public async sendWhatsAppAlert(
    message: string,
    imageBuffer?: Buffer,
    overrides?: Partial<WhatsAppRelayConfig> & { forceTemplate?: boolean; fetchFn?: typeof fetch }
  ): Promise<WhatsAppSendResult> {
    const accessToken = overrides?.accessToken ?? config.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = overrides?.phoneNumberId ?? config.WHATSAPP_PHONE_NUMBER_ID;
    const rawRecipient = overrides?.recipientPhone ?? config.WHATSAPP_RECIPIENT_PHONE;
    const apiVersion = overrides?.apiVersion ?? config.WHATSAPP_API_VERSION ?? 'v21.0';
    const templateName = overrides?.templateName ?? config.WHATSAPP_TEMPLATE_NAME;
    const templateLang = overrides?.templateLang ?? config.WHATSAPP_TEMPLATE_LANG ?? 'en_US';
    const fetchImpl = overrides?.fetchFn ?? fetch;

    const to = (rawRecipient || '').replace(/[^0-9]/g, '');
    if (!accessToken || !phoneNumberId || !to) {
      return { ok: false, mode: 'skipped' };
    }

    const base = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;

    const sendTemplate = async (): Promise<WhatsAppSendResult> => {
      if (!templateName) {
        return {
          ok: false,
          mode: 'failed',
          errorCode: 131047,
          errorMessage: 'Outside 24h service window and WHATSAPP_TEMPLATE_NAME is not configured.',
        };
      }
      const tplRes = await fetchImpl(`${base}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLang },
          },
        }),
      });
      if (tplRes.ok) {
        console.log(`[AlertRelay] WhatsApp template alert ("${templateName}") sent successfully.`);
        return { ok: true, mode: 'template' };
      }
      const tplErr = (await tplRes.json().catch(() => null)) as any;
      const tplCode = typeof tplErr?.error?.code === 'number' ? tplErr.error.code : undefined;
      const tplMsg = tplErr?.error?.message || `HTTP ${tplRes.status}`;
      console.error(`[AlertRelay] WhatsApp template dispatch failed (${tplCode ?? tplRes.status}): ${tplMsg}`);
      return { ok: false, mode: 'failed', errorCode: tplCode, errorMessage: tplMsg };
    };

    try {
      if (overrides?.forceTemplate) {
        return await sendTemplate();
      }

      let mediaId: string | undefined;
      if (imageBuffer && imageBuffer.length > 0) {
        const mediaForm = new FormData();
        mediaForm.append('messaging_product', 'whatsapp');
        mediaForm.append('type', 'image/png');
        mediaForm.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'alert.png');

        const mediaRes = await fetchImpl(`${base}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: mediaForm,
        }).catch(() => null);

        if (mediaRes && mediaRes.ok) {
          const mediaJson = (await mediaRes.json().catch(() => null)) as any;
          if (typeof mediaJson?.id === 'string' && mediaJson.id.length > 0) {
            mediaId = mediaJson.id;
          }
        }
      }

      const sentMode: 'image' | 'text' = mediaId ? 'image' : 'text';
      const payload = mediaId
        ? {
            messaging_product: 'whatsapp',
            to,
            type: 'image',
            image: { id: mediaId, caption: message.slice(0, 1000) },
          }
        : {
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { preview_url: false, body: message.slice(0, 4000) },
          };

      const msgRes = await fetchImpl(`${base}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (msgRes.ok) {
        console.log(`[AlertRelay] WhatsApp ${sentMode} alert sent successfully.`);
        return { ok: true, mode: sentMode };
      }

      const errJson = (await msgRes.json().catch(() => null)) as any;
      const errorCode = typeof errJson?.error?.code === 'number' ? errJson.error.code : undefined;
      const errorMessage = errJson?.error?.message || `HTTP ${msgRes.status}`;

      if (errorCode === 131047) {
        if (templateName) {
          return await sendTemplate();
        }
        console.warn(
          '[AlertRelay] WhatsApp 24h customer service window closed (error 131047). Send "hi" to your WhatsApp Business number before farming or set WHATSAPP_TEMPLATE_NAME.'
        );
      } else {
        console.error(`[AlertRelay] WhatsApp dispatch failed (${errorCode ?? msgRes.status}): ${errorMessage}`);
      }

      return { ok: false, mode: 'failed', errorCode, errorMessage };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error('[AlertRelay] WhatsApp send error:', errorMessage);
      return { ok: false, mode: 'failed', errorMessage };
    }
  }

  /**
   * Dispatches a lightweight 1-way urgent wake-up ping via CallMeBot WhatsApp API.
   */
  public async sendCallMeBotAlert(
    message: string,
    overrides?: Partial<CallMeBotConfig> & { fetchFn?: typeof fetch }
  ): Promise<CallMeBotSendResult> {
    const rawPhone = overrides?.phone ?? config.CALLMEBOT_PHONE ?? config.WHATSAPP_RECIPIENT_PHONE ?? '';
    const phone = rawPhone.replace(/[^0-9]/g, '');
    const apiKey = (overrides?.apiKey ?? config.CALLMEBOT_APIKEY ?? '').trim();
    const fetchImpl = overrides?.fetchFn ?? fetch;

    if (!phone || !apiKey) {
      return { ok: false, skipped: true };
    }

    try {
      const url = new URL('https://api.callmebot.com/whatsapp.php');
      url.searchParams.set('phone', phone);
      url.searchParams.set('text', message.slice(0, 1000));
      url.searchParams.set('apikey', apiKey);

      const res = await fetchImpl(url.toString());
      const body = await res.text().catch(() => '');
      const bodyLooksError =
        /(invalid apikey|apikey is invalid|not activated|error)/i.test(body) &&
        !/message queued/i.test(body);

      if (!res.ok || bodyLooksError) {
        const errorMessage = body.trim() || `HTTP ${res.status}`;
        console.error(`[AlertRelay] CallMeBot WhatsApp dispatch failed (${res.status}): ${errorMessage}`);
        return { ok: false, status: res.status, body, errorMessage };
      }

      console.log('[AlertRelay] CallMeBot WhatsApp alert sent successfully.');
      return { ok: true, status: res.status, body };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      console.error('[AlertRelay] CallMeBot WhatsApp send error:', errorMessage);
      return { ok: false, errorMessage };
    }
  }

  private async sendTelegramPhoto(caption: string, imageBuffer?: Buffer): Promise<void> {
    try {
      if (imageBuffer) {
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
      } else {
        const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text: caption })
        });
        if (!res.ok) {
          console.error(`[AlertRelay] Telegram message dispatch failed with status: ${res.status}`);
        }
      }
    } catch (err: any) {
      console.error('[AlertRelay] Telegram send error:', err.message);
    }
  }

  private async sendDiscordWebhook(content: string, imageBuffer?: Buffer): Promise<void> {
    try {
      const isDropAlert =
        content.includes('Gold Brick') ||
        content.includes('GOLD BAR') ||
        content.includes('ヒヒイロカネ') ||
        content.includes('Eternity Sand') ||
        content.includes('ETERNITY SAND') ||
        content.includes('刻の流砂');
      const formattedContent = isDropAlert
        ? content
        : `🚨 **URGENT: Granblue Fantasy Verification Triggered!**\n${content}`;
      const filename = isDropAlert ? 'loot-proof.png' : 'captcha.png';

      if (imageBuffer) {
        const formData = new FormData();
        formData.append('content', formattedContent);
        formData.append('file', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), filename);

        const res = await fetch(config.DISCORD_WEBHOOK_URL!, { method: 'POST', body: formData });
        if (!res.ok) {
          console.error(`[AlertRelay] Discord webhook failed with status: ${res.status}`);
        } else {
          console.log('[AlertRelay] Discord webhook alert sent successfully.');
        }
      } else {
        const res = await fetch(config.DISCORD_WEBHOOK_URL!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: formattedContent })
        });
        if (!res.ok) {
          console.error(`[AlertRelay] Discord webhook failed with status: ${res.status}`);
        }
      }
    } catch (err: any) {
      console.error('[AlertRelay] Discord send error:', err.message);
    }
  }
}

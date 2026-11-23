// tests/test-sentinel-alert.ts
import { AlertRelay, EmergencyAlertOptions } from '../src/alert-relay.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { config } from '../src/config.js';

console.log('--- Testing Sentinel Watchdog & Alert Relay ---');

const relay = new AlertRelay();
const dummyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// 1. Test alert dispatching
await relay.sendEmergencyAlert('Test alert from GBF Sentinel Watchdog verification test.', dummyPng);
console.log('Alert Relay dispatch test: PASSED');

// 2. Test Sentinel Lock / Unlock lifecycle
const mockPage = {
  $: async () => null,
  screenshot: async () => dummyPng,
  evaluate: async () => false,
} as any;

const sentinel = new SentinelWatchdog(mockPage, relay);
console.log(`Sentinel Initial Armed State: ${sentinel.isArmed}`);
if (!sentinel.isArmed) throw new Error('Sentinel should be armed initially.');

await sentinel.assertSafe();
console.log('Sentinel assertSafe on clean page: PASSED');

// Simulate CAPTCHA appearance
const mockCaptchaPage = {
  $: async (sel: string) => ({ sel }),
  screenshot: async () => dummyPng,
  evaluate: async () => true,
} as any;

const activeSentinel = new SentinelWatchdog(mockCaptchaPage, relay, { enableTwoWayDiscord: false, skipBrowserWaitOnHalt: true });
try {
  await activeSentinel.assertSafe();
  throw new Error('Sentinel should have thrown SENTINEL_HALT on captcha page!');
} catch (err: any) {
  if (err.message.includes('SENTINEL_HALT')) {
    console.log('Sentinel CAPTCHA detection & hard halt: PASSED');
  } else {
    throw err;
  }
}

console.log(`Sentinel Armed State after halt: ${activeSentinel.isArmed}`);
if (activeSentinel.isArmed) throw new Error('Sentinel should be locked after captcha detection.');

activeSentinel.unlock();
console.log(`Sentinel Armed State after unlock: ${activeSentinel.isArmed}`);
if (!activeSentinel.isArmed) throw new Error('Sentinel should be armed after unlock.');

// 3. Test WhatsApp Cloud API image upload + E.164 sanitization (mocked fetch)
{
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, init });
    if (urlStr.endsWith('/media')) {
      return new Response(JSON.stringify({ id: 'media_12345' }), { status: 200 });
    }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.mock1' }] }), { status: 200 });
  }) as typeof fetch;

  const imgRes = await relay.sendWhatsAppAlert('🚨 GBF PAUSED — Test Alert', dummyPng, {
    accessToken: 'test_token_123',
    phoneNumberId: '100020003000',
    recipientPhone: '+62 812-3456-7890',
    apiVersion: 'v21.0',
    fetchFn: mockFetch,
  });

  if (!imgRes.ok || imgRes.mode !== 'image') {
    throw new Error(`Expected WhatsApp image dispatch to succeed, got ${JSON.stringify(imgRes)}`);
  }
  if (calls.length !== 2 || !calls[0].url.includes('/media') || !calls[1].url.includes('/messages')) {
    throw new Error(`Expected 2 Graph API calls (/media then /messages), got ${calls.length}`);
  }
  const msgBody = JSON.parse(String(calls[1].init?.body || '{}'));
  if (msgBody.to !== '6281234567890' || msgBody.type !== 'image' || msgBody.image?.id !== 'media_12345') {
    throw new Error(`Unexpected WhatsApp image message payload: ${JSON.stringify(msgBody)}`);
  }
  console.log('WhatsApp Cloud API image upload & phone sanitization test: PASSED');
}

// 4. Test WhatsApp 131047 (24h window closed) automatic Utility Template fallback
{
  const payloads: any[] = [];
  const mockFallbackFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body || '{}'));
    payloads.push(parsed);
    if (payloads.length === 1) {
      return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 });
    }
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.mock_tpl' }] }), { status: 200 });
  }) as typeof fetch;

  const tplRes = await relay.sendWhatsAppAlert('🚨 GBF PAUSED — Outside 24h window', undefined, {
    accessToken: 'test_token_123',
    phoneNumberId: '100020003000',
    recipientPhone: '6281234567890',
    templateName: 'gbf_urgent_alert',
    templateLang: 'en_US',
    fetchFn: mockFallbackFetch,
  });

  if (!tplRes.ok || tplRes.mode !== 'template' || payloads.length !== 2) {
    throw new Error(`Expected 131047 template fallback success, got ${JSON.stringify(tplRes)}`);
  }
  if (payloads[1].type !== 'template' || payloads[1].template?.name !== 'gbf_urgent_alert') {
    throw new Error(`Unexpected fallback template payload: ${JSON.stringify(payloads[1])}`);
  }
  console.log('WhatsApp 131047 automatic template fallback test: PASSED');
}

// 5. Test WHATSAPP_URGENT_ONLY=true suppresses drops while dispatching urgent pause alerts
{
  const prevCfg = {
    token: config.WHATSAPP_ACCESS_TOKEN,
    phoneId: config.WHATSAPP_PHONE_NUMBER_ID,
    recipient: config.WHATSAPP_RECIPIENT_PHONE,
    urgentOnly: config.WHATSAPP_URGENT_ONLY,
    telegramToken: config.TELEGRAM_BOT_TOKEN,
    discordWebhook: config.DISCORD_WEBHOOK_URL,
  };
  const urgentRelay = new AlertRelay();
  let waCalls = 0;
  urgentRelay.sendWhatsAppAlert = async () => {
    waCalls++;
    return { ok: true, mode: 'text' };
  };

  try {
    config.WHATSAPP_ACCESS_TOKEN = 'test_token_123';
    config.WHATSAPP_PHONE_NUMBER_ID = '100020003000';
    config.WHATSAPP_RECIPIENT_PHONE = '6281234567890';
    config.WHATSAPP_URGENT_ONLY = true;
    config.TELEGRAM_BOT_TOKEN = undefined;
    config.DISCORD_WEBHOOK_URL = undefined;

    await urgentRelay.sendEmergencyAlert('🌟 Gold Brick Drop Confirmed! Raid ID: 999888777', dummyPng, { force: true });
    if (waCalls !== 0) {
      throw new Error(`Expected WHATSAPP_URGENT_ONLY=true to suppress Gold Brick drop alert, got waCalls=${waCalls}`);
    }

    await urgentRelay.sendEmergencyAlert('🚨 GBF PAUSED — Verification Challenge', dummyPng, { force: true, urgent: true });
    if (waCalls !== 1) {
      throw new Error(`Expected WHATSAPP_URGENT_ONLY=true to dispatch urgent alert, got waCalls=${waCalls}`);
    }
    console.log('WhatsApp WHATSAPP_URGENT_ONLY gating test: PASSED');
  } finally {
    config.WHATSAPP_ACCESS_TOKEN = prevCfg.token;
    config.WHATSAPP_PHONE_NUMBER_ID = prevCfg.phoneId;
    config.WHATSAPP_RECIPIENT_PHONE = prevCfg.recipient;
    config.WHATSAPP_URGENT_ONLY = prevCfg.urgentOnly;
    config.TELEGRAM_BOT_TOKEN = prevCfg.telegramToken;
    config.DISCORD_WEBHOOK_URL = prevCfg.discordWebhook;
  }
}

// 6. Test SentinelWatchdog dispatches 1-way urgent pause alert via AlertRelay on verification challenge
{
  const sentUrgent: Array<{ msg: string; opts?: EmergencyAlertOptions }> = [];
  const spyRelay = new AlertRelay();
  spyRelay.sendEmergencyAlert = async (message: string, _buf?: Buffer, opts?: EmergencyAlertOptions) => {
    sentUrgent.push({ msg: message, opts });
  };
  const haltSentinel = new SentinelWatchdog(mockCaptchaPage, spyRelay, {
    enableTwoWayDiscord: false,
    skipBrowserWaitOnHalt: true,
  });
  haltSentinel.setSessionContext({ accountId: 'acc1', playerName: 'Tester', questName: 'GW NM95' });

  await haltSentinel.assertSafe().catch(() => {});
  if (sentUrgent.length !== 1 || !sentUrgent[0].msg.includes('GBF PAUSED') || !sentUrgent[0].opts?.urgent || !sentUrgent[0].opts?.force) {
    throw new Error(`Expected SentinelWatchdog to emit urgent forced alert, got ${JSON.stringify(sentUrgent)}`);
  }
  console.log('SentinelWatchdog urgent pause AlertRelay dispatch test: PASSED');
}

// 7. Test CallMeBot WhatsApp URL building, phone sanitization & success body
{
  const capturedUrls: string[] = [];
  const mockCmbFetch = (async (url: string | URL | Request) => {
    capturedUrls.push(String(url));
    return new Response('<p><b>Message queued.</b> You will receive it in a few seconds.</p>', { status: 200 });
  }) as typeof fetch;

  const cmbRes = await relay.sendCallMeBotAlert('🚨 GBF PAUSED — Check Discord DM', {
    phone: '+62 812-3456-7890',
    apiKey: ' 123456 ',
    fetchFn: mockCmbFetch,
  });

  if (!cmbRes.ok || capturedUrls.length !== 1) {
    throw new Error(`Expected CallMeBot send to succeed, got ${JSON.stringify(cmbRes)}`);
  }
  const parsedUrl = new URL(capturedUrls[0]);
  if (
    parsedUrl.origin + parsedUrl.pathname !== 'https://api.callmebot.com/whatsapp.php' ||
    parsedUrl.searchParams.get('phone') !== '6281234567890' ||
    parsedUrl.searchParams.get('apikey') !== '123456' ||
    !parsedUrl.searchParams.get('text')?.includes('GBF PAUSED')
  ) {
    throw new Error(`Unexpected CallMeBot URL parameters: ${capturedUrls[0]}`);
  }
  console.log('CallMeBot WhatsApp URL & E.164 sanitization test: PASSED');
}

// 8. Test CallMeBot HTTP 200 error-body detection ("APIKey is invalid")
{
  const mockInvalidKeyFetch = (async () => {
    return new Response('<b>Error:</b> APIKey is invalid for your phone number.', { status: 200 });
  }) as typeof fetch;

  const badRes = await relay.sendCallMeBotAlert('Test message', {
    phone: '6281234567890',
    apiKey: '000000',
    fetchFn: mockInvalidKeyFetch,
  });

  if (badRes.ok || !badRes.errorMessage?.includes('APIKey is invalid')) {
    throw new Error(`Expected HTTP 200 error body to mark ok=false, got ${JSON.stringify(badRes)}`);
  }
  console.log('CallMeBot HTTP 200 error-body detection test: PASSED');
}

// 9. Test WHATSAPP_URGENT_ONLY=true gates CallMeBot drop spam while firing urgent pause alerts
{
  const prevCfg = {
    cmbPhone: config.CALLMEBOT_PHONE,
    cmbKey: config.CALLMEBOT_APIKEY,
    urgentOnly: config.WHATSAPP_URGENT_ONLY,
    waToken: config.WHATSAPP_ACCESS_TOKEN,
    telegramToken: config.TELEGRAM_BOT_TOKEN,
    discordWebhook: config.DISCORD_WEBHOOK_URL,
  };
  const cmbRelay = new AlertRelay();
  let cmbCalls = 0;
  cmbRelay.sendCallMeBotAlert = async () => {
    cmbCalls++;
    return { ok: true, status: 200, body: 'Message queued.' };
  };

  try {
    config.CALLMEBOT_PHONE = '6281234567890';
    config.CALLMEBOT_APIKEY = '123456';
    config.WHATSAPP_URGENT_ONLY = true;
    config.WHATSAPP_ACCESS_TOKEN = undefined;
    config.TELEGRAM_BOT_TOKEN = undefined;
    config.DISCORD_WEBHOOK_URL = undefined;

    await cmbRelay.sendEmergencyAlert('🌟 Gold Brick Drop Confirmed! Raid ID: 999888777', dummyPng, { force: true });
    if (cmbCalls !== 0) {
      throw new Error(`Expected WHATSAPP_URGENT_ONLY=true to suppress Gold Brick drop on CallMeBot, got cmbCalls=${cmbCalls}`);
    }

    await cmbRelay.sendEmergencyAlert('🚨 GBF PAUSED — Verification Challenge', dummyPng, { force: true, urgent: true });
    if (cmbCalls !== 1) {
      throw new Error(`Expected WHATSAPP_URGENT_ONLY=true to dispatch urgent alert on CallMeBot, got cmbCalls=${cmbCalls}`);
    }
    console.log('CallMeBot WHATSAPP_URGENT_ONLY gating test: PASSED');
  } finally {
    config.CALLMEBOT_PHONE = prevCfg.cmbPhone;
    config.CALLMEBOT_APIKEY = prevCfg.cmbKey;
    config.WHATSAPP_URGENT_ONLY = prevCfg.urgentOnly;
    config.WHATSAPP_ACCESS_TOKEN = prevCfg.waToken;
    config.TELEGRAM_BOT_TOKEN = prevCfg.telegramToken;
    config.DISCORD_WEBHOOK_URL = prevCfg.discordWebhook;
  }
}

console.log('\n✅ Task 03 Sentinel Watchdog & Alert Relay Tests: ALL PASSED!');

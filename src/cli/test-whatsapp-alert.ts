// src/cli/test-whatsapp-alert.ts
import { config } from '../config.js';
import { AlertRelay } from '../alert-relay.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function printSetupHelp() {
  console.error('❌ WhatsApp alert relay is not configured in .env.');
  console.error('\nOption A — CallMeBot (easiest 2-min 1-way wake-up ping):');
  console.error('   CALLMEBOT_PHONE=6281234567890');
  console.error('   CALLMEBOT_APIKEY=123456');
  console.error('\nOption B — Official Meta WhatsApp Cloud API (images + templates):');
  console.error('   WHATSAPP_ACCESS_TOKEN=your_system_user_token');
  console.error('   WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id');
  console.error('   WHATSAPP_RECIPIENT_PHONE=6281234567890');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const useTemplate = args.has('--template');
  const useImage = args.has('--image');
  const forceCallMeBot = args.has('--callmebot');
  const forceMeta = args.has('--meta');

  const callMeBotConfigured = Boolean(
    config.CALLMEBOT_APIKEY && (config.CALLMEBOT_PHONE || config.WHATSAPP_RECIPIENT_PHONE)
  );
  const metaConfigured = Boolean(
    config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID && config.WHATSAPP_RECIPIENT_PHONE
  );

  const runCallMeBot = forceCallMeBot || (!forceMeta && callMeBotConfigured);
  const runMeta = forceMeta || (!forceCallMeBot && metaConfigured);

  if (!runCallMeBot && !runMeta) {
    printSetupHelp();
    process.exit(1);
  }

  const relay = new AlertRelay();
  const msg = '🚨 GBF Test Alert — WhatsApp Urgent Relay Ready';
  let allOk = true;

  if (runCallMeBot) {
    if (!callMeBotConfigured) {
      console.error('❌ --callmebot requested, but missing CALLMEBOT_APIKEY or CALLMEBOT_PHONE in .env.');
      process.exit(1);
    }
    const targetPhone = config.CALLMEBOT_PHONE || config.WHATSAPP_RECIPIENT_PHONE;
    console.log(`[CallMeBot Test] Sending text wake-up ping to ${targetPhone}...`);
    const res = await relay.sendCallMeBotAlert(msg);
    if (res.ok) {
      const snippet = res.body ? ` | Response: "${res.body.trim().slice(0, 120)}"` : '';
      console.log(`✅ CallMeBot alert sent cleanly (status=${res.status})${snippet}`);
    } else {
      allOk = false;
      console.error(`❌ CallMeBot send failed (status=${res.status ?? 'N/A'}): ${res.errorMessage || 'Unknown error'}`);
    }
  }

  if (runMeta) {
    if (!metaConfigured) {
      console.error(
        '❌ Meta Cloud API requires WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_RECIPIENT_PHONE in .env.'
      );
      process.exit(1);
    }

    const templateName = config.WHATSAPP_TEMPLATE_NAME || (useTemplate ? 'hello_world' : undefined);
    console.log(
      `[Meta WhatsApp Test] Sending ${useTemplate ? `template ("${templateName}")` : useImage ? 'image+caption' : 'text'} test to ${config.WHATSAPP_RECIPIENT_PHONE}...`
    );

    const result = await relay.sendWhatsAppAlert(msg, useImage ? TINY_PNG : undefined, {
      forceTemplate: useTemplate,
      templateName,
    });

    if (result.ok) {
      console.log(`✅ Success! Meta WhatsApp alert delivered (mode=${result.mode}).`);
    } else {
      allOk = false;
      console.error(`❌ Meta WhatsApp send failed (code=${result.errorCode ?? 'unknown'}): ${result.errorMessage || 'Unknown error'}`);

      switch (result.errorCode) {
        case 190:
          console.error('💡 Fix (190): Access token expired or invalid. Generate a System User Permanent Token in Meta Business Settings.');
          break;
        case 131030:
          console.error('💡 Fix (131030): Recipient number is not in your test allow-list. Verify it under Meta App > WhatsApp > API Setup > To.');
          break;
        case 131047:
          console.error('💡 Fix (131047): 24h customer service window is closed. Message your bot ("hi") on WhatsApp first, or pass --template / set WHATSAPP_TEMPLATE_NAME.');
          break;
        case 132001:
          console.error('💡 Fix (132001): Template not found or wrong language. Check WHATSAPP_TEMPLATE_NAME and WHATSAPP_TEMPLATE_LANG.');
          break;
      }
    }
  }

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err?.message || err);
  process.exit(1);
});

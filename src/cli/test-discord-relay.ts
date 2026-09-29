// src/cli/test-discord-relay.ts
import { discordDmRelay } from '../relay/discord-dm-relay.js';
import { config } from '../config.js';

async function main() {
  console.log('\n============================================================');
  console.log('       🔔 DISCORD TWO-WAY DM RELAY TEST TOOL               ');
  console.log('============================================================');

  if (!discordDmRelay.isConfigured()) {
    console.error('❌ Error: DISCORD_BOT_TOKEN and DISCORD_USER_ID must be set in .env');
    process.exit(1);
  }

  console.log(`[TestRelay] Target User ID: ${config.DISCORD_USER_ID}`);
  console.log('[TestRelay] Establishing DM session with Discord API...');

  try {
    // 1. Check if the bot has joined at least 1 mutual guild
    const guildRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` },
    });
    const guilds = (await guildRes.json()) as any[];

    if (!Array.isArray(guilds) || guilds.length === 0) {
      const botRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` },
      });
      const botInfo = (await botRes.json()) as any;
      const botId = botInfo.id || '1554396837127921714';
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${botId}&permissions=8&scope=bot`;

      console.warn('\n⚠️ [Discord Policy Notice]');
      console.warn('Discord requires bots to share at least 1 mutual server with you to allow DMs.');
      console.warn(`👉 Please click this link to invite "${botInfo.username || 'Bae'}" to your private server:`);
      console.warn(`\n🔗 ${inviteUrl}\n`);
      console.log('⏳ Waiting for you to authorize the bot (checking every 3s)...');

      let joined = false;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const checkRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
          headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` },
        });
        const currentGuilds = (await checkRes.json()) as any[];
        if (Array.isArray(currentGuilds) && currentGuilds.length > 0) {
          console.log(`\n🎉 Bot joined server: "${currentGuilds[0].name}"! Mutual guild verified.`);
          joined = true;
          break;
        }
        process.stdout.write('.');
      }

      if (!joined) {
        console.error('\n❌ Timed out waiting for bot to be invited to a server.');
        process.exit(1);
      }
    }

    const channelId = await discordDmRelay.getDmChannelId();
    console.log(`[TestRelay] ✅ DM Channel successfully opened (ID: ${channelId})`);

    // 2. Connect to browser and capture real viewport screenshot
    let testAttachments: { buffer: Buffer; filename: string }[] = [];
    try {
      const puppeteer = await import('puppeteer-core');
      const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' }).catch(() => null);
      if (browser) {
        const pages = await browser.pages();
        const gbfPage = pages.find((p) => p.url().includes('granbluefantasy.jp')) || pages[0];
        if (gbfPage) {
          console.log('[TestRelay] 📸 Capturing real-time game viewport screenshot via CDP...');
          const shot = (await gbfPage.screenshot({ type: 'png' })) as Buffer;
          testAttachments.push({ buffer: shot, filename: 'game-viewport.png' });
          console.log(`[TestRelay] ✅ Captured viewport image (${shot.length} bytes)`);
        }
      }
    } catch (err: any) {
      console.warn('[TestRelay] Notice: Could not capture from CDP (will send synthetic test graphic):', err.message);
    }

    if (testAttachments.length === 0) {
      // Fallback 1x1 test image
      const fallbackPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      testAttachments.push({ buffer: fallbackPng, filename: 'test-captcha.png' });
    }

    const testContent = [
      '🖼️ **GBF Automation: Picture CAPTCHA Delivery Test**',
      '',
      'Hello! Here is the live image capture from your game runner.',
      '',
      '👉 **Please reply to this DM** with any test code (e.g. `ok`, `verified`, or `1234`).',
      'The runner will capture your response and confirm that image delivery and two-way relay are working perfectly!',
    ].join('\n');

    console.log('[TestRelay] 📤 Sending test message WITH attached picture to your Discord DM...');
    const promptMsg = await discordDmRelay.sendMessage(testContent, testAttachments);
    console.log(`[TestRelay] 📨 Image delivered to DM! (Message ID: ${promptMsg.id})`);
    console.log('\n⏳ Waiting for you to reply in Discord DM (Timeout: 120s)...');

    let dotCount = 0;
    const reply = await discordDmRelay.waitForReply(promptMsg.id, 120000, 2000, () => {
      dotCount = (dotCount + 1) % 4;
      process.stdout.write(`\r[TestRelay] Polling for your DM reply${'.'.repeat(dotCount)}${' '.repeat(4 - dotCount)}`);
    });

    console.log('\n');

    if (!reply) {
      console.error('❌ [TestRelay] Timed out waiting for reply from Discord.');
      process.exit(1);
    }

    console.log('============================================================');
    console.log(`🎉 [TestRelay] SUCCESS! RECEIVED REPLY: "${reply}"`);
    console.log('============================================================');

    console.log('[TestRelay] 📤 Sending confirmation back to your Discord DM...');
    await discordDmRelay.sendMessage(
      `✅ **Two-Way Test Successful!**\n\nThe runner received your reply: **\`${reply}\`**\nYour two-way relay is fully operational and ready to solve CAPTCHAs headlessly!`
    );

    console.log('[TestRelay] ✅ Confirmation delivered to Discord! Test complete.\n');
  } catch (err: any) {
    console.error('[TestRelay] ❌ Fatal error during test:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[TestRelay] Uncaught exception:', err);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager, safeUrl } from '../auth/account-auth.manager.js';
import { AccountConfig } from '../types/account.types.js';
import { GatewayServer } from '../gateway/server.js';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { config } from '../config.js';

const args = process.argv.slice(2);
const accountId = args.find(a => !a.startsWith('-')) || 'acc1';
const isLinux = process.platform === 'linux';
const isWindowedRequested = args.includes('--windowed') || args.includes('-w');
const isHeadlessRequested = args.includes('--headless') || (isLinux && !process.env.DISPLAY);
const forceHeadless = isWindowedRequested ? false : (isHeadlessRequested || process.env.HEADLESS === 'true');

const account = AccountRegistry.getAccountById(accountId);

if (!account) {
  console.error(`\n❌ Account [${accountId}] not found in accounts.config.json!`);
  console.log('Available accounts:', AccountRegistry.loadAccounts().map(a => a.id).join(', '));
  throw new Error(`Account [${accountId}] not found.`);
}

async function getPublicIp(): Promise<string> {
  const providers = ['https://api.ipify.org', 'https://icanhazip.com', 'https://checkip.amazonaws.com'];
  for (const p of providers) {
    try {
      const res = await fetch(p, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (ip && /^[\d.]+$/.test(ip)) return ip;
      }
    } catch {}
  }
  return process.env.PUBLIC_IP || process.env.VPS_HOST || '127.0.0.1';
}

console.log('========================================================================');
console.log(`        Assisted Account Setup & Authentication Helper                  `);
console.log(`               Account: [${account.name}] (${account.id})              `);
console.log('========================================================================');
console.log(`Service:             ${account.service.toUpperCase()}`);
console.log(`CDP Port:            ${account.cdpPort}`);
console.log(`Profile Directory:   ${account.profileDir}`);
console.log(`Browser Mode:        ${forceHeadless ? 'HEADLESS (Optimized VPS mode)' : 'WINDOWED (Desktop GUI)'}`);
console.log('========================================================================\n');

async function main(targetAccount: AccountConfig) {
  const cdp = new CdpConnectionManager();

  console.log(`Connecting to browser on port ${targetAccount.cdpPort} (Headless: ${forceHeadless})...`);
  const conn = await cdp.connectWithRetry(6, 2000, forceHeadless, {
    cdpPort: targetAccount.cdpPort,
    profileDir: targetAccount.profileDir,
    proxy: targetAccount.proxy
  });

  const page = conn.page;
  const publicIp = await getPublicIp();

  let gateway: GatewayServer | null = null;
  const midshipArgIdx = args.indexOf('--midship');
  const rawMidship = midshipArgIdx !== -1 ? args[midshipArgIdx + 1] : null;
  const fileArgIdx = args.indexOf('--file');
  const customFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;
  const jsonArgIdx = args.indexOf('--json');
  const rawJson = jsonArgIdx !== -1 ? args[jsonArgIdx + 1] : null;

  // 1. Direct Cookie Import Mode (--midship, --file, or --json)
  if (rawMidship || customFile || rawJson) {
    console.log(`[Setup] Direct cookie injection requested for account [${targetAccount.id}]...`);
    let cookiesToInject: any[] = [];

    if (rawMidship) {
      const cleanMidship = rawMidship.trim().replace(/^["']|["']$/g, '');
      const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
      cookiesToInject = [
        { name: 'midship', value: cleanMidship, domain: 'game.granbluefantasy.jp', path: '/', secure: false, httpOnly: false, expires: expiry },
        { name: 'midship', value: cleanMidship, domain: '.game.granbluefantasy.jp', path: '/', secure: false, httpOnly: false, expires: expiry },
        { name: 'midship', value: cleanMidship, domain: '.granbluefantasy.jp', path: '/', secure: false, httpOnly: false, expires: expiry }
      ];
    } else if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        cookiesToInject = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e: any) {
        console.error(`❌ Failed to parse inline --json: ${e.message}`);
        process.exit(1);
      }
    } else if (customFile) {
      const resolvedFile = path.resolve(process.cwd(), customFile);
      if (!fs.existsSync(resolvedFile)) {
        console.error(`❌ Specified cookie file not found: ${resolvedFile}`);
        process.exit(1);
      }
      const raw = fs.readFileSync(resolvedFile, 'utf-8');
      const parsed = JSON.parse(raw);
      cookiesToInject = Array.isArray(parsed) ? parsed : [parsed];
    }

    if (cookiesToInject.length > 0) {
      console.log(`[Setup] Injecting ${cookiesToInject.length} cookies via Chrome DevTools Protocol...`);
      const client = await page.target().createCDPSession();
      await client.send('Network.clearBrowserCookies');
      await client.send('Network.setCookies', { cookies: cookiesToInject });
      await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
      await new Promise(r => setTimeout(r, 2500));
    }
  }

  if (forceHeadless) {
    try {
      const sentinel = new SentinelWatchdog(page);
      gateway = new GatewayServer(page, sentinel);
      await gateway.start();
      console.log('\n========================================================================');
      console.log(' 🌐 REMOTE INTERACTIVE LOGIN COCKPIT ACTIVE FOR VPS');
      console.log('========================================================================');
      console.log(` 👉 Open in your phone or PC browser:`);
      console.log(`    http://${publicIp}:${config.PORT}/?token=${config.AUTH_TOKEN}`);
      console.log(`\n 🔒 If port ${config.PORT} is firewalled, forward it securely from your PC:`);
      console.log(`    ssh -L ${config.PORT}:localhost:${config.PORT} root@${publicIp}`);
      console.log(`    and navigate to: http://localhost:${config.PORT}/?token=${config.AUTH_TOKEN}`);
      console.log('\n 💡 FASTEST ALTERNATIVES (ZERO VNC / ZERO RAM OVERHEAD):');
      console.log(`    1. Sync session from local PC:`);
      console.log(`       bun run sync ${targetAccount.id} --remote http://${publicIp}:${config.PORT}`);
      console.log(`    2. Direct token import:`);
      console.log(`       bun run account:setup ${targetAccount.id} --midship "S%3A..."`);
      console.log('========================================================================\n');
    } catch (gwErr: any) {
      console.warn('[Setup] Companion cockpit notice:', gwErr.message);
    }
  }

  let isCleaningUp = false;
  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    console.log('\n[Setup] Shutting down setup helper...');
    if (gateway) await gateway.stop().catch(() => {});
    await cdp.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log(`Verifying in-game authentication on #profile...`);
  let profile = await AccountAuthManager.ensureAuthenticated(page, targetAccount);

  if (!profile) {
    console.log('\n========================================================================');
    console.log(' ⏳ AWAITING 1-TIME LOGIN IN REMOTE COCKPIT');
    console.log('========================================================================');
    console.log(` 👉 Open Cockpit: http://${publicIp}:${config.PORT}/?token=${config.AUTH_TOKEN}`);
    console.log(' 👉 Live browser feed is active. Tap buttons or enter OTP in your browser.');
    console.log(' 👉 Waiting for in-game profile confirmation (Ctrl+C to abort)...');
    console.log('========================================================================\n');

    while (!profile) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      const currentUrl = safeUrl(page);
      if (currentUrl.includes('granbluefantasy.jp') && !currentUrl.includes('mbga.jp') && !currentUrl.includes('mobage.jp')) {
        profile = await AccountAuthManager.getVerifiedProfile(page).catch(() => null);
      }
    }
  }

  if (profile) {
    console.log('\n========================================================================');
    console.log(`🎉 SUCCESS: Account [${targetAccount.name}] Authenticated & Verified!`);
    console.log(`   In-Game Player:   ${profile.name}`);
    console.log(`   Player Rank:      ${profile.rank}`);
    console.log(`   Granblue User ID: ${profile.id}`);
    console.log(`   Profile Storage:  ${targetAccount.profileDir}`);
    console.log('========================================================================\n');

    try {
      const client = await page.target().createCDPSession();
      const { cookies } = await client.send('Network.getAllCookies');
      const relevantCookies = cookies.filter(c => {
        const domain = (c.domain || '').toLowerCase();
        return (
          domain.includes('granbluefantasy.jp') ||
          domain.includes('mbga.jp') ||
          domain.includes('mobage.jp') ||
          domain.includes('dmm.com')
        );
      });
      const dataDir = path.resolve(process.cwd(), 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const cookieFile = path.join(dataDir, `${targetAccount.id}-cookies.json`);
      fs.writeFileSync(cookieFile, JSON.stringify(relevantCookies, null, 2), 'utf-8');
      console.log(`[Setup] 🎉 Automatically exported ${relevantCookies.length} session cookies to:`);
      console.log(`        ${cookieFile}`);
    } catch (exportErr: any) {
      console.warn('[Setup] Notice exporting cookies:', exportErr.message);
    }
  }

  if (gateway) {
    await gateway.stop();
  }
  await cdp.disconnect();
  process.exit(profile ? 0 : 1);
}

main(account).catch(err => {
  console.error('Setup Error:', err);
  process.exit(1);
});

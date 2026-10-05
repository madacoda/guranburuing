// src/cli/import-cookies.ts
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';

const args = process.argv.slice(2);
const positionalArgs = args.filter(a => !a.startsWith('-'));
const registeredAccounts = AccountRegistry.loadAccounts();

let accountId = 'acc1';
let directMidship = '';

for (const arg of positionalArgs) {
  if (registeredAccounts.some(a => a.id.toLowerCase() === arg.toLowerCase())) {
    accountId = registeredAccounts.find(a => a.id.toLowerCase() === arg.toLowerCase())!.id;
  } else if (arg.startsWith('S%3A') || arg.startsWith('S:') || arg.length > 50) {
    directMidship = arg;
  }
}

const fileArgIdx = args.indexOf('--file');
const customFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;
const jsonArgIdx = args.indexOf('--json');
const rawJson = jsonArgIdx !== -1 ? args[jsonArgIdx + 1] : null;
const isClipboard = args.includes('--clipboard') || args.includes('-c');

const midshipArgIdx = args.indexOf('--midship');
const rawMidship = midshipArgIdx !== -1 ? args[midshipArgIdx + 1] : (directMidship || null);

const account = AccountRegistry.getAccountById(accountId);
if (!account) {
  console.error(`\n❌ Account [${accountId}] not found in accounts.config.json!`);
  throw new Error(`Account [${accountId}] not found in accounts.config.json`);
}
const currentAccount = account;

const defaultFile = path.resolve(process.cwd(), 'data', `${accountId}-cookies.json`);
const targetFile = customFile ? path.resolve(process.cwd(), customFile) : defaultFile;

console.log('========================================================================');
console.log(`        Granblue Fantasy Cookie & Session Importer Helper               `);
console.log(`               Account: [${account.name}] (${account.id})              `);
console.log('========================================================================');
console.log(`CDP Port:          ${account.cdpPort}`);
console.log(`Profile Directory: ${account.profileDir}`);
console.log(`Source Mode:       ${rawMidship ? 'Direct Midship Cookie' : rawJson ? 'Inline --json' : isClipboard ? 'System Clipboard' : targetFile}`);
console.log('========================================================================\n');

function readFromClipboard(): string | null {
  try {
    if (process.platform === 'win32') {
      const ps = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard'], { encoding: 'utf-8' });
      if (ps.stdout) return ps.stdout.trim();
    } else {
      // Linux xclip / wl-paste
      const xclip = spawnSync('xclip', ['-selection', 'clipboard', '-o'], { encoding: 'utf-8' });
      if (xclip.stdout) return xclip.stdout.trim();
      const wl = spawnSync('wl-paste', [], { encoding: 'utf-8' });
      if (wl.stdout) return wl.stdout.trim();
    }
  } catch {}
  return null;
}

async function loadCookies(): Promise<any[]> {
  if (rawMidship) {
    const cleanMidship = rawMidship.trim().replace(/^["']|["']$/g, '');
    return [
      {
        name: 'midship',
        value: cleanMidship,
        domain: 'game.granbluefantasy.jp',
        path: '/',
        secure: false,
        httpOnly: false,
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
      },
      {
        name: 'midship',
        value: cleanMidship,
        domain: '.game.granbluefantasy.jp',
        path: '/',
        secure: false,
        httpOnly: false,
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
      },
      {
        name: 'midship',
        value: cleanMidship,
        domain: '.granbluefantasy.jp',
        path: '/',
        secure: false,
        httpOnly: false,
        expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600
      }
    ];
  }

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e: any) {
      throw new Error(`Failed to parse inline --json: ${e.message}`);
    }
  }

  if (isClipboard) {
    const clip = readFromClipboard();
    if (clip && (clip.startsWith('[') || clip.startsWith('{'))) {
      try {
        const parsed = JSON.parse(clip);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch (e: any) {
        throw new Error(`Clipboard contains text, but JSON parse failed: ${e.message}`);
      }
    }
    throw new Error('Clipboard does not contain valid cookie JSON.');
  }

  if (!fs.existsSync(targetFile)) {
    // Try clipboard fallback
    const clip = readFromClipboard();
    if (clip && (clip.startsWith('[') || clip.startsWith('{'))) {
      try {
        const parsed = JSON.parse(clip);
        console.log('[Import] Found valid cookie JSON in clipboard. Using clipboard content.');
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {}
    }

    console.error(`❌ Cookie file not found: ${targetFile}`);
    console.log(`\n👉 Please export cookies from your local Windows machine first using:`);
    console.log(`   powershell -ExecutionPolicy Bypass -File .\\scripts\\export-session-windows.ps1 -Account ${accountId}`);
    console.log(`   or run on Windows: bun scripts/export-session.ts ${accountId}`);
    console.log(`\n👉 Alternatively, copy your cookies JSON and import directly with:`);
    console.log(`   bun src/cli/import-cookies.ts ${accountId} --json '<pasted_json_here>'`);
    console.log(`   or with clipboard: bun src/cli/import-cookies.ts ${accountId} --clipboard`);
    process.exit(1);
  }

  const raw = fs.readFileSync(targetFile, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  const cookies = await loadCookies();
  console.log(`[Import] Loaded ${cookies.length} cookie definitions to import.`);

  // Sanitize cookies for CDP Network.setCookies
  const sanitizedCookies = cookies.map(c => {
    const item: any = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/'
    };
    if (typeof c.secure === 'boolean') item.secure = c.secure;
    if (typeof c.httpOnly === 'boolean') item.httpOnly = c.httpOnly;
    if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) {
      item.sameSite = c.sameSite;
    }
    if (typeof c.expires === 'number' && c.expires > 0) {
      item.expires = c.expires;
    }
    return item;
  });

  // Cache to disk
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(defaultFile, JSON.stringify(sanitizedCookies, null, 2), 'utf-8');
  } catch {}

  const cdp = new CdpConnectionManager();
  console.log(`[Import] Attaching to Chrome CDP (Port: ${currentAccount.cdpPort}, Headless: true)...`);
  const conn = await cdp.connectWithRetry(6, 2000, true, {
    cdpPort: currentAccount.cdpPort,
    profileDir: currentAccount.profileDir,
    proxy: currentAccount.proxy
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();

  console.log(`[Import] Clearing stale session and guest cookies...`);
  await client.send('Network.clearBrowserCookies');

  console.log(`[Import] Injecting cookies into browser session via Network.setCookies...`);
  await client.send('Network.setCookies', { cookies: sanitizedCookies });

  console.log(`[Import] Cookies successfully committed to SQLite storage.`);
  console.log(`[Import] Verifying active session on #mypage...`);

  await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
  await new Promise(r => setTimeout(r, 3000));

  // If on #top title screen, click Game Start
  const currentHash = await page.evaluate(() => window.location.hash).catch(() => '');
  if (currentHash.includes('top') || currentHash === '' || currentHash === '#') {
    await page.evaluate(() => {
      const start = document.querySelector('#start, .btn-start, [data-location-href="start"]') as HTMLElement;
      if (start) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(start).trigger('tap');
        start.click();
      }
    }).catch(() => null);
    await new Promise(r => setTimeout(r, 2500));
  }

  const profile = await AccountAuthManager.ensureAuthenticated(page, currentAccount);

  if (profile) {
    console.log('\n========================================================================');
    console.log(`🎉 SUCCESS: Account [${currentAccount.name}] Successfully Authenticated!`);
    console.log(`   Player Name:      ${profile.name}`);
    console.log(`   Player Rank:      ${profile.rank}`);
    console.log(`   Granblue User ID: ${profile.id}`);
    console.log(`   Profile Directory: ${currentAccount.profileDir}`);
    console.log('========================================================================\n');
  } else {
    console.warn('\n⚠️ Session imported, but profile verification on #profile returned empty.');
    console.warn('Please verify that the exported session is still active and valid on your local browser.');
  }

  await cdp.disconnect();
  process.exit(profile ? 0 : 1);
}

main().catch(err => {
  console.error('\n❌ Import Error:', err.message);
  process.exit(1);
});

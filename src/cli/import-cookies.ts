// src/cli/import-cookies.ts
import fs from 'fs';
import path from 'path';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { CdpConnectionManager } from '../cdp-connection.js';

const args = process.argv.slice(2);
const accountId = args.find(a => !a.startsWith('-')) || 'acc1';
const fileArgIdx = args.indexOf('--file');
const customFile = fileArgIdx !== -1 ? args[fileArgIdx + 1] : null;
const jsonArgIdx = args.indexOf('--json');
const rawJson = jsonArgIdx !== -1 ? args[jsonArgIdx + 1] : null;

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
console.log(`Source File:       ${rawJson ? 'Inline JSON String' : targetFile}`);
console.log('========================================================================\n');

async function loadCookies(): Promise<any[]> {
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e: any) {
      throw new Error(`Failed to parse inline --json: ${e.message}`);
    }
  }

  if (!fs.existsSync(targetFile)) {
    console.error(`❌ Cookie file not found: ${targetFile}`);
    console.log(`\n👉 Please export cookies from your local Windows machine first using:`);
    console.log(`   powershell -ExecutionPolicy Bypass -File .\\scripts\\export-session-windows.ps1 -Account ${accountId}`);
    console.log(`   or run on Windows: bun scripts/export-session.ts ${accountId}`);
    console.log(`\n👉 Alternatively, copy your cookies JSON and import directly with:`);
    console.log(`   bun src/cli/import-cookies.ts ${accountId} --json '<pasted_json_here>'`);
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

  const cdp = new CdpConnectionManager();
  console.log(`[Import] Attaching to Chrome CDP (Port: ${currentAccount.cdpPort}, Headless: true)...`);
  const conn = await cdp.connectWithRetry(6, 2000, true, {
    cdpPort: currentAccount.cdpPort,
    profileDir: currentAccount.profileDir,
    proxy: currentAccount.proxy
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();

  console.log(`[Import] Injecting cookies into browser session...`);
  await client.send('Network.setCookies', { cookies: sanitizedCookies });

  console.log(`[Import] Cookies successfully committed to SQLite storage.`);
  console.log(`[Import] Verifying active session on #profile...`);

  await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

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

// scripts/sync-session.ts
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { AccountRegistry } from '../src/auth/account-registry.js';
import { config } from '../src/config.js';

const args = process.argv.slice(2);
const accountId = args.find(a => !a.startsWith('-')) || 'acc1';

const remoteIdx = args.indexOf('--remote');
const customRemote = remoteIdx !== -1 ? args[remoteIdx + 1] : null;

const tokenIdx = args.indexOf('--token');
const customToken = tokenIdx !== -1 ? args[tokenIdx + 1] : null;

const fileIdx = args.indexOf('--file');
const customFile = fileIdx !== -1 ? args[fileIdx + 1] : null;

const isFresh = args.includes('--fresh') || args.includes('-f');

const account = AccountRegistry.getAccountById(accountId);
const accountName = account?.name || accountId;

// Resolve default target remote URL
let defaultRemote = process.env.REMOTE_VPS_URL || process.env.VPS_HOST || 'http://127.0.0.1:3000';
if (!defaultRemote.startsWith('http://') && !defaultRemote.startsWith('https://')) {
  defaultRemote = `http://${defaultRemote}:3000`;
}
const remoteUrl = customRemote || defaultRemote;
const authToken = customToken || config.AUTH_TOKEN;

const defaultCookieFile = path.resolve(process.cwd(), 'data', `${accountId}-cookies.json`);
const cookieFile = customFile ? path.resolve(process.cwd(), customFile) : defaultCookieFile;

console.log('========================================================================');
console.log('       Granblue Fantasy Instant Local ➔ VPS Session Synchronizer        ');
console.log(`               Account: [${accountName}] (${accountId})                `);
console.log('========================================================================');
console.log(`Source Account:      ${accountName} (${accountId})`);
console.log(`Local Cookie Cache:  ${cookieFile}`);
console.log(`Target VPS Gateway:  ${remoteUrl}`);
console.log(`Auth Token:          ${authToken.slice(0, 8)}...`);
console.log('========================================================================\n');

async function ensureLocalCookies(): Promise<any[]> {
  if (!fs.existsSync(cookieFile) || isFresh) {
    console.log(`[Sync] Cookies file not found or --fresh requested. Exporting fresh local session...`);
    const exportScript = path.resolve(process.cwd(), 'scripts', 'export-session.ts');
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('bun', [exportScript, accountId], { stdio: 'inherit' });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Session exporter exited with status ${code}`));
      });
    });
  }

  if (!fs.existsSync(cookieFile)) {
    throw new Error(`Cookie file ${cookieFile} could not be generated.`);
  }

  const raw = fs.readFileSync(cookieFile, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  const cookies = await ensureLocalCookies();
  console.log(`\n[Sync] Ready to synchronize ${cookies.length} session cookies to remote VPS...`);

  const endpoint = `${remoteUrl.replace(/\/+$/, '')}/api/cookies/import?token=${encodeURIComponent(authToken)}`;

  console.log(`[Sync] Connecting to VPS Gateway: ${remoteUrl}...`);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-token': authToken
      },
      body: JSON.stringify({
        accountId,
        cookies
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`VPS returned HTTP ${res.status}: ${errText || res.statusText}`);
    }

    const data: any = await res.json();

    if (data.success) {
      console.log('\n========================================================================');
      console.log(`🎉 SUCCESS: Account [${accountName}] Successfully Synchronized to VPS!`);
      console.log('========================================================================');
      if (data.profile) {
        console.log(`   Player Name:      ${data.profile.name}`);
        console.log(`   Player Rank:      ${data.profile.rank}`);
        console.log(`   Granblue User ID: ${data.profile.id}`);
      }
      console.log(`   Cookies Injected: ${data.count}`);
      console.log(`   Remote Status:    AUTHENTICATED & READY FOR HEADLESS FARMING`);
      console.log('========================================================================\n');
      console.log('👉 You can now run daily routines or combat workflows on the VPS:');
      console.log(`   ssh root@${new URL(remoteUrl).hostname} "cd /laragon/www/gbf || cd ~/gbf && bun run daily:${accountId}"\n`);
    } else {
      console.warn('\n⚠️ Cookies were received by VPS, but verification returned empty.');
      console.warn('Response:', data);
    }
  } catch (err: any) {
    console.error(`\n❌ Failed to connect to VPS Gateway at ${remoteUrl}:`, err.message);
    console.log('\n------------------------------------------------------------------------');
    console.log(' 💡 HOW TO RESOLVE VPS CONNECTION ISSUES:');
    console.log('------------------------------------------------------------------------');
    console.log(' 1. If port 3000 is firewalled on your VPS, create a secure SSH tunnel:');
    const host = new URL(remoteUrl).hostname || 'YOUR_VPS_IP';
    console.log(`    ssh -L 3000:localhost:3000 root@${host}`);
    console.log(`    Then run again: bun run session:sync ${accountId} --remote http://localhost:3000\n`);
    console.log(' 2. If Gateway is not yet running on VPS, launch it:');
    console.log(`    ssh root@${host} "cd ~/gbf && bun src/cli/setup-account.ts ${accountId}"\n`);
    console.log(' 3. Or import cookies manually via SSH CLI using copied JSON:');
    console.log(`    ssh root@${host} "cd ~/gbf && bun src/cli/import-cookies.ts ${accountId} --json '$(cat data/${accountId}-cookies.json)'"\n`);
    console.log('------------------------------------------------------------------------\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Sync] Fatal error:', err.message);
  process.exit(1);
});

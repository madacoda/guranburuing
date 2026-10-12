// scripts/sync-session.ts
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
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
const isSshOnly = args.includes('--ssh') || args.includes('-s');

const account = AccountRegistry.getAccountById(accountId);
const accountName = account?.name || accountId;

// Resolve default target remote URL / IP from .env
const vpsIp = process.env.VPS_IP || process.env.VPS_HOST || null;
let defaultRemote = process.env.REMOTE_VPS_URL || (vpsIp ? `http://${vpsIp}:3000` : 'http://localhost:3000');
if (!defaultRemote.startsWith('http://') && !defaultRemote.startsWith('https://')) {
  defaultRemote = `http://${defaultRemote}:3000`;
}
const remoteUrl = customRemote || defaultRemote;
const authToken = customToken || config.AUTH_TOKEN;

const defaultCookieFile = path.resolve(process.cwd(), 'data', `${accountId}-cookies.json`);
const cookieFile = customFile ? path.resolve(process.cwd(), customFile) : defaultCookieFile;

let resolvedHost = 'localhost';
try {
  resolvedHost = customRemote ? new URL(customRemote).hostname : (vpsIp || process.env.VPS_HOST || 'localhost');
} catch {
  resolvedHost = vpsIp || process.env.VPS_HOST || 'localhost';
}
const remoteWorkingDir = process.env.VPS_DIR || '/var/www/guranburuing';

console.log('========================================================================');
console.log('       Granblue Fantasy Instant Local ➔ VPS Session Synchronizer        ');
console.log(`               Account: [${accountName}] (${accountId})                `);
console.log('========================================================================');
console.log(`Source Account:      ${accountName} (${accountId})`);
console.log(`Local Cookie Cache:  ${cookieFile}`);
console.log(`Target VPS Gateway:  ${remoteUrl}`);
console.log(`Target VPS Host:     ${resolvedHost}`);
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

async function syncViaSsh(host: string): Promise<boolean> {
  console.log(`\n========================================================================`);
  console.log(` 🚀 Synchronizing session to VPS via Direct SSH/SCP (${host})...`);
  console.log(`========================================================================`);

  console.log(`[SCP] Transferring local cookies to VPS:${remoteWorkingDir}/data/${accountId}-cookies.json...`);
  const scpRes = spawnSync('scp', [
    cookieFile,
    `root@${host}:${remoteWorkingDir}/data/${accountId}-cookies.json`
  ], { stdio: 'inherit', shell: true });

  if (scpRes.status !== 0) {
    console.error(`\n❌ SCP transfer failed with exit code ${scpRes.status}.`);
    return false;
  }

  console.log(`[SSH] Invoking remote session importer on VPS...`);
  const remoteCmd = `cd ${remoteWorkingDir} && bun src/cli/import-cookies.ts ${accountId} --file data/${accountId}-cookies.json`;
  const sshRes = spawnSync('ssh', [
    `root@${host}`,
    remoteCmd
  ], { stdio: 'inherit', shell: true });

  if (sshRes.status === 0) {
    console.log('\n========================================================================');
    console.log(`🎉 SUCCESS: Account [${accountName}] Successfully Synchronized to VPS!`);
    console.log('========================================================================');
    console.log('👉 You can now run workflows directly on the VPS:');
    console.log(`   ssh root@${host} "cd ${remoteWorkingDir} && bun src/cli/run-workflow.ts ${accountId} arcarum-gilgamesh-militis"\n`);
    return true;
  } else {
    console.error(`\n❌ Remote cookie import failed with exit code ${sshRes.status}.`);
    return false;
  }
}

async function main() {
  const cookies = await ensureLocalCookies();
  console.log(`\n[Sync] Ready to synchronize ${cookies.length} session cookies to remote VPS...`);

  if (isSshOnly) {
    const ok = await syncViaSsh(resolvedHost);
    process.exit(ok ? 0 : 1);
  }

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
      signal: AbortSignal.timeout(8000)
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
      console.log(`   ssh root@${resolvedHost} "cd ${remoteWorkingDir} && bun run daily:${accountId}"\n`);
    } else {
      console.warn('\n⚠️ Cookies were received by VPS, but verification returned empty.');
      console.warn('Response:', data);
    }
  } catch (err: any) {
    console.warn(`\n⚠️ VPS Gateway at ${remoteUrl} is unreachable (${err.message}).`);
    console.log(`🔄 Automatically falling back to direct SSH/SCP synchronization to ${resolvedHost}...`);
    const sshOk = await syncViaSsh(resolvedHost);
    if (sshOk) {
      process.exit(0);
    }

    console.log('\n------------------------------------------------------------------------');
    console.log(' 💡 HOW TO RESOLVE VPS CONNECTION ISSUES:');
    console.log('------------------------------------------------------------------------');
    console.log(' 1. To start the HTTP Gateway on your VPS:');
    console.log(`    ssh root@${resolvedHost} "cd ${remoteWorkingDir} && bun run gateway"`);
    console.log('    And allow port 3000 in your firewall: ufw allow 3000/tcp\n');
    console.log(' 2. Or create a secure SSH tunnel from your local PC:');
    console.log(`    ssh -L 3000:localhost:3000 root@${resolvedHost}`);
    console.log(`    Then run: bun run sync ${accountId} --remote http://localhost:3000\n`);
    console.log(' 3. Or synchronize directly via SSH anytime with:');
    console.log(`    bun run sync ${accountId} --ssh\n`);
    console.log('------------------------------------------------------------------------\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Sync] Fatal error:', err.message);
  process.exit(1);
});

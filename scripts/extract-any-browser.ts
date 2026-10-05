import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { Database } from 'bun:sqlite';

function getMasterKey(localStatePath: string): Buffer {
  const psCmd = `
    Add-Type -AssemblyName System.Security
    $localState = Get-Content "${localStatePath.replace(/\\/g, '\\\\')}" -Raw | ConvertFrom-Json
    $encryptedKeyB64 = $localState.os_crypt.encrypted_key
    $encryptedKeyBytes = [Convert]::FromBase64String($encryptedKeyB64)
    $dpapiBytes = $encryptedKeyBytes[5..($encryptedKeyBytes.Length - 1)]
    $masterKey = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $dpapiBytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Convert]::ToBase64String($masterKey)
  `;
  const res = spawnSync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf-8' });
  if (res.error || res.status !== 0) throw new Error(res.stderr || 'Failed to get DPAPI master key');
  return Buffer.from(res.stdout.trim(), 'base64');
}

function extractFromBrowser(name: string, browserDir: string) {
  console.log(`\n=== Checking ${name} ===`);
  const localStatePath = path.join(browserDir, 'Local State');
  const cookiePath = path.join(browserDir, 'Default', 'Network', 'Cookies');

  if (!fs.existsSync(localStatePath) || !fs.existsSync(cookiePath)) {
    console.log(`Files not found for ${name}`);
    return;
  }

  let masterKey: Buffer;
  try {
    masterKey = getMasterKey(localStatePath);
    console.log(`Master key retrieved: ${masterKey.length} bytes`);
  } catch (e: any) {
    console.log(`Could not get master key: ${e.message}`);
    return;
  }

  // Copy Cookies DB to temp file because it's locked by running browser
  const tempDb = path.resolve(`.temp_${name.replace(/\s+/g, '_')}_cookies.db`);
  try {
    const psScript = path.resolve('scripts/copy-locked.ps1');
    const copyRes = spawnSync('powershell', ['-NoProfile', '-File', psScript, cookiePath, tempDb], { encoding: 'utf-8' });
    if (!fs.existsSync(tempDb)) {
      console.log(`Could not copy locked cookie DB: ${copyRes.stderr || copyRes.stdout}`);
      return;
    }

    const db = new Database(tempDb, { readonly: true });
    const rows = db.query(`
      SELECT host_key, name, path, is_secure, is_httponly, expires_utc, encrypted_value
      FROM cookies
      WHERE host_key LIKE '%granblue%' OR host_key LIKE '%mbga%' OR host_key LIKE '%mobage%'
    `).all() as any[];

    console.log(`Found ${rows.length} relevant cookies in ${name}`);

    for (const row of rows) {
      const encVal = Buffer.from(row.encrypted_value);
      const prefix = encVal.subarray(0, 3).toString('utf-8');
      if (prefix === 'v20') {
        console.log(`  [${row.host_key}] ${row.name} uses App-Bound encryption (v20)`);
        continue;
      }
      if (prefix === 'v10' || prefix === 'v11') {
        const iv = encVal.subarray(3, 15);
        const ciphertext = encVal.subarray(15, encVal.length - 16);
        const authTag = encVal.subarray(encVal.length - 16);
        try {
          const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
          decipher.setAuthTag(authTag);
          const raw = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
          const clean = raw.length > 32 ? raw.subarray(32) : raw;
          console.log(`  ✅ Decrypted [${row.host_key}] ${row.name} = "${clean.toString('utf-8').slice(0, 35)}..."`);
        } catch (e: any) {
          console.log(`  ❌ Failed decrypting ${row.name}: ${e.message}`);
        }
      }
    }
  } finally {
    try { fs.unlinkSync(tempDb); } catch {}
  }
}

const localAppData = process.env.LOCALAPPDATA || '';
extractFromBrowser('Google Chrome', path.join(localAppData, 'Google', 'Chrome', 'User Data'));
extractFromBrowser('Brave', path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'));
extractFromBrowser('Chromium', path.join(localAppData, 'Chromium', 'User Data'));

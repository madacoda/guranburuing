// scripts/extract-iron-cookies.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { Database } from 'bun:sqlite';

async function main() {
  console.log('=== Decrypting SRWare Iron Cookies ===');

  // 1. Get Master Key
  const psScript = path.resolve('scripts', 'decrypt-iron.ps1');
  const ps = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript], {
    encoding: 'utf-8'
  });

  if (ps.error || ps.status !== 0) {
    throw new Error(`Failed to decrypt DPAPI key: ${ps.stderr || ps.error?.message}`);
  }

  const masterKeyB64 = ps.stdout.trim();
  const masterKey = Buffer.from(masterKeyB64, 'base64');
  console.log(`Decrypted master key: ${masterKey.length} bytes.`);

  // 2. Open DB
  const cookiePath = path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'User Data', 'Default', 'Network', 'Cookies');
  const db = new Database(cookiePath, { readonly: true });

  const rows = db.query(`
    SELECT host_key, name, path, is_secure, is_httponly, expires_utc, encrypted_value
    FROM cookies
    WHERE host_key LIKE '%granblue%' OR host_key LIKE '%mbga%' OR host_key LIKE '%mobage%'
  `).all() as any[];

  console.log(`Found ${rows.length} relevant cookies in Iron.`);

  const decryptedCookies: any[] = [];

  for (const row of rows) {
    const encVal = Buffer.from(row.encrypted_value);
    const prefix = encVal.subarray(0, 3).toString('utf-8');

    let plaintextVal = '';
    if (prefix === 'v10' || prefix === 'v11') {
      const iv = encVal.subarray(3, 15);
      const ciphertext = encVal.subarray(15, encVal.length - 16);
      const authTag = encVal.subarray(encVal.length - 16);

      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
        decipher.setAuthTag(authTag);
        const rawDecrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        // Modern Chromium prepends 32 bytes of binding metadata
        const cleanBuffer = rawDecrypted.length > 32 ? rawDecrypted.subarray(32) : rawDecrypted;
        plaintextVal = cleanBuffer.toString('utf-8');
      } catch (e: any) {
        console.warn(`Failed decrypting ${row.name}: ${e.message}`);
      }
    } else {
      plaintextVal = encVal.toString('utf-8');
    }

    if (plaintextVal) {
      console.log(`  Decrypted [${row.host_key}] ${row.name} = "${plaintextVal.slice(0, 25)}..."`);
      decryptedCookies.push({
        name: row.name,
        value: plaintextVal,
        domain: row.host_key,
        path: row.path,
        secure: !!row.is_secure,
        httpOnly: !!row.is_httponly,
        expires: row.expires_utc > 0 ? Math.floor(row.expires_utc / 1000000) - 11644473600 : -1
      });
    }
  }

  db.close();

  const targetFile = path.resolve('data', 'iron-cookies.json');
  fs.writeFileSync(targetFile, JSON.stringify(decryptedCookies, null, 2), 'utf-8');
  console.log(`Saved ${decryptedCookies.length} decrypted cookies to: ${targetFile}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

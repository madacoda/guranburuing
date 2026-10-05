// scripts/extract-real-midship.ts
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { Database } from 'bun:sqlite';

async function main() {
  console.log('========================================================================');
  console.log('       Extracting Live GBF Cookies from Real Desktop Chrome             ');
  console.log('========================================================================');

  // 1. Get AES Master Key via DPAPI
  const psScript = path.resolve('scripts', 'decrypt-chrome-cookie.ps1');
  const ps = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript], {
    encoding: 'utf-8'
  });

  if (ps.error || ps.status !== 0) {
    throw new Error(`Failed to decrypt DPAPI master key: ${ps.stderr || ps.error?.message}`);
  }

  const masterKeyB64 = ps.stdout.trim();
  const masterKey = Buffer.from(masterKeyB64, 'base64');
  console.log(`[Extract] Decrypted AES-256-GCM master key (${masterKey.length} bytes).`);

  // 2. Temp DB copied by PowerShell script
  const tempDbPath = path.resolve('data', 'temp_extract_chrome.db');

  const db = new Database(tempDbPath, { readonly: true });
  const rows = db.query(`
    SELECT host_key, name, path, is_secure, is_httponly, expires_utc, encrypted_value
    FROM cookies
    WHERE host_key LIKE '%granbluefantasy%' OR host_key LIKE '%mobage%' OR host_key LIKE '%mbga%'
  `).all() as any[];

  console.log(`[Extract] Found ${rows.length} relevant encrypted cookies in Chrome.`);

  const decryptedCookies: any[] = [];

  for (const row of rows) {
    const encVal = Buffer.from(row.encrypted_value);
    const prefix = encVal.subarray(0, 3).toString('utf-8');

    let plaintextVal = '';
    if (prefix === 'v10' || prefix === 'v11') {
      const iv = encVal.subarray(3, 15);
      const ciphertext = encVal.subarray(15, encVal.length - 16);
      const authTag = encVal.subarray(encVal.length - 16);

      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
      decipher.setAuthTag(authTag);
      plaintextVal = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    } else {
      plaintextVal = encVal.toString('utf-8');
    }

    if (plaintextVal) {
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
  fs.unlinkSync(tempDbPath);

  const midship = decryptedCookies.find(c => c.name === 'midship');
  if (!midship) {
    throw new Error('Could not find midship cookie in Chrome Default profile.');
  }

  console.log('\n🎉 SUCCESS! Extracted REAL midship cookie:');
  console.log(`   Domain: ${midship.domain}`);
  console.log(`   Value:  ${midship.value.slice(0, 25)}...${midship.value.slice(-15)}`);

  // Write to acc1-cookies.json
  const targetFile = path.resolve('data', 'acc1-cookies.json');
  fs.writeFileSync(targetFile, JSON.stringify(decryptedCookies, null, 2), 'utf-8');
  console.log(`[Extract] Saved ${decryptedCookies.length} decrypted cookies to: ${targetFile}`);

  return midship.value;
}

main().catch(err => {
  console.error('\n❌ Extraction Error:', err.message);
  process.exit(1);
});

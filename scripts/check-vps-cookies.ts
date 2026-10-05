// scripts/check-vps-cookies.ts
import { Database } from 'bun:sqlite';
import fs from 'fs';

const paths = [
  '/var/www/acc1/Default/Cookies',
  '/var/www/acc1/Default/Network/Cookies',
  '/root/.gbf-chrome-profile/Default/Cookies'
];

for (const p of paths) {
  if (fs.existsSync(p)) {
    try {
      const db = new Database(p, { readonly: true });
      const rows = db.query("SELECT host_key, name, value, encrypted_value FROM cookies WHERE host_key LIKE '%granbluefantasy%' OR host_key LIKE '%mobage%'").all() as any[];
      console.log(`[${p}] -> Found ${rows.length} cookies:`);
      for (const r of rows) {
        let val = r.value;
        if (!val && r.encrypted_value) {
          const buf = Buffer.from(r.encrypted_value);
          const prefix = buf.subarray(0, 3).toString('utf-8');
          if (prefix === 'v10' || prefix === 'v11') {
            try {
              const crypto = await import('crypto');
              const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
              const iv = Buffer.alloc(16, ' '); // 16 spaces
              const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
              val = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]).toString('utf-8');
            } catch (err: any) {
              val = `[decrypt err: ${err.message}]`;
            }
          }
        }
        console.log(`   ${r.host_key} : ${r.name} = ${val.slice(0, 30)}...`);
      }
      db.close();
    } catch (e: any) {
      console.log(`[${p}] Error: ${e.message}`);
    }
  }
}

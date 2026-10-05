// scripts/inspect-local-cookies.ts
import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

const userProfiles = [
  'C:/Users/YOUR_USER/.gbf-iron-profile/Default/Network/Cookies',
  'C:/Users/YOUR_USER/.gbf-chrome-profile/Default/Network/Cookies',
  'C:/Users/YOUR_USER/.gbf-profiles/acc1/Default/Network/Cookies',
  'C:/Users/YOUR_USER/.gbf-profiles/acc1/Profile 1/Network/Cookies',
  'C:/Users/YOUR_USER/.gbf-profiles/acc2/Default/Network/Cookies',
];

for (const p of userProfiles) {
  if (!fs.existsSync(p)) continue;
  try {
    // Copy to temp file to avoid locking issues
    const tmp = path.resolve('data', 'temp_cookie.db');
    fs.copyFileSync(p, tmp);
    const db = new Database(tmp, { readonly: true });
    const rows = db.query(`SELECT host_key, name FROM cookies WHERE host_key LIKE '%granbluefantasy%' OR host_key LIKE '%mobage%' OR host_key LIKE '%mbga%'`).all() as any[];
    console.log(`[${p}] -> Found ${rows.length} relevant cookies`);
    const hasMidship = rows.some(r => r.name === 'midship');
    console.log(`   Has 'midship': ${hasMidship ? '✅ YES' : '❌ NO'}`);
    if (hasMidship) {
      console.log('   Cookies:', rows.map(r => `${r.host_key}:${r.name}`).join(', '));
    }
    db.close();
    fs.unlinkSync(tmp);
  } catch (e: any) {
    console.log(`[${p}] Error: ${e.message}`);
  }
}

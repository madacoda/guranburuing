// scripts/check-iron-cookies.ts
import { Database } from 'bun:sqlite';
import path from 'path';

const cookiePath = path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'User Data', 'Default', 'Network', 'Cookies');
console.log('Reading from:', cookiePath);

try {
  const db = new Database(cookiePath, { readonly: true });
  const rows = db.query(`SELECT host_key, name, path, is_secure, is_httponly, expires_utc FROM cookies WHERE host_key LIKE '%granblue%' OR host_key LIKE '%mbga%' OR host_key LIKE '%mobage%'`).all() as any[];
  console.log(`Found ${rows.length} relevant cookies in Iron:`);
  for (const r of rows) {
    console.log(`  [${r.host_key}] ${r.name}`);
  }
} catch (e: any) {
  console.error('Error:', e.message);
}

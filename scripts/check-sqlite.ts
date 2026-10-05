// scripts/check-sqlite.ts
import { Database } from 'bun:sqlite';

const db = new Database('/var/www/acc1/Default/Cookies');
const rows = db.query('SELECT host_key, name, path, is_secure, is_httponly, value FROM cookies').all() as any[];
console.log('Total cookies in SQLite:', rows.length);
for (const r of rows) {
  if (['midship', 'access_gbtk', 'SP_T', 'SP_F', 'SP_GUEST', 'CFLMS', 't'].includes(r.name)) {
    console.log(`[${r.host_key}] ${r.name} = "${r.value.slice(0, 30)}..." (path: ${r.path}, httpOnly: ${r.is_httponly}, secure: ${r.is_secure})`);
  }
}

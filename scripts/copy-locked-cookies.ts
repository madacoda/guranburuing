// scripts/copy-locked-cookies.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from 'bun:sqlite';

const src = path.join(os.homedir(), 'AppData/Local/Google/Chrome/User Data/Default/Network/Cookies');
const dst = path.resolve('data', 'chrome_default_cookies.db');

try {
  // Read in chunks
  const fd = fs.openSync(src, 'r');
  const out = fs.openSync(dst, 'w');
  const buf = Buffer.alloc(65536);
  let bytesRead = 0;
  while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
    fs.writeSync(out, buf, 0, bytesRead);
  }
  fs.closeSync(fd);
  fs.closeSync(out);

  console.log('Copied Chrome Default Cookies:', fs.statSync(dst).size, 'bytes');

  const db = new Database(dst, { readonly: true });
  const rows = db.query(`SELECT host_key, name FROM cookies WHERE host_key LIKE '%granbluefantasy%' OR host_key LIKE '%mobage%' OR host_key LIKE '%mbga%'`).all() as any[];
  console.log(`Found ${rows.length} GBF/Mobage cookies in Chrome Default profile:`);
  console.log(rows.map(r => `${r.host_key}:${r.name}`).join(', '));
  db.close();
  fs.unlinkSync(dst);
} catch (e: any) {
  console.error('Error:', e.message);
}

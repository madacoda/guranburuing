// scripts/find-gbf-profile.ts
import fs from 'fs';
import path from 'path';
import { Database } from 'bun:sqlite';

const baseDir = 'C:/Users/YOUR_USER/AppData/Local/Google/Chrome/User Data';
const dirs = fs.readdirSync(baseDir);

for (const d of dirs) {
  const cookiePath = path.join(baseDir, d, 'Network', 'Cookies');
  if (fs.existsSync(cookiePath)) {
    try {
      // Copy via non-exclusive read
      const tmp = path.resolve('data', `temp_${d.replace(/\s+/g, '_')}.db`);
      const fd = fs.openSync(cookiePath, 'r');
      const out = fs.openSync(tmp, 'w');
      const buf = Buffer.alloc(65536);
      let bytesRead = 0;
      while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        fs.writeSync(out, buf, 0, bytesRead);
      }
      fs.closeSync(fd);
      fs.closeSync(out);

      const db = new Database(tmp, { readonly: true });
      const rows = db.query("SELECT host_key, name FROM cookies WHERE host_key LIKE '%granbluefantasy%' OR host_key LIKE '%mobage%' OR host_key LIKE '%mbga%'").all() as any[];
      if (rows.length > 0) {
        console.log(`\n======================================================`);
        console.log(`Profile: [${d}] -> Found ${rows.length} cookies!`);
        console.log(`======================================================`);
        for (const r of rows) {
          console.log(`  ${r.host_key} : ${r.name}`);
        }
      }
      db.close();
      fs.unlinkSync(tmp);
    } catch (e: any) {
      console.log(`Profile [${d}] -> Locked or error: ${e.message}`);
    }
  }
}

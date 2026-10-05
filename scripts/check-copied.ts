// scripts/check-copied.ts
import { Database } from 'bun:sqlite';

for (const p of ['Profile 1', 'Profile 10']) {
  try {
    const db = new Database(`data/cookies_${p}.db`, { readonly: true });
    const rows = db.query(`SELECT host_key, name FROM cookies WHERE host_key LIKE '%granblue%' OR host_key LIKE '%mbga%'`).all() as any[];
    console.log(`[${p}] Relevant cookies:`, rows.length);
    for (const r of rows) {
      console.log(`  ${r.host_key} -> ${r.name}`);
    }
  } catch (e: any) {
    console.log(`[${p}] Error:`, e.message);
  }
}

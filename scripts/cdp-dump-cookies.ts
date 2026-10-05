import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const client = await conn.page.target().createCDPSession();
  const res = await client.send('Network.getAllCookies');
  console.log(`Total CDP cookies: ${res.cookies.length}`);
  for (const c of res.cookies) {
    if (['midship', 'access_gbtk', 'SP_T', 'SP_F', 'SP_GUEST', 'CFLMS', 't'].includes(c.name)) {
      console.log(`[${c.domain}] ${c.name} = "${c.value.slice(0, 30)}..." (httpOnly: ${c.httpOnly}, secure: ${c.secure})`);
    }
  }

  await cdp.disconnect();
}

main().catch(console.error);

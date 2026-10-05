import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  const data = await page.evaluate(async () => {
    const r1 = await fetch(`/user/status?_=${Date.now()}`);
    const t1 = await r1.text().catch(e => e.message);
    const r2 = await fetch(`/user/user_id/0?_=${Date.now()}`);
    const t2 = await r2.text().catch(e => e.message);
    return {
      statusHttp: r1.status,
      statusBody: t1.slice(0, 300),
      userHttp: r2.status,
      userBody: t2.slice(0, 300)
    };
  });

  console.log('Result:', JSON.stringify(data, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

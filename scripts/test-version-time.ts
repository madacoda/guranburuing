import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  const res = await page.evaluate(async () => {
    const t0 = Date.now();
    let version = (window as any).Game?.version;
    let waitMs = 0;
    while (!version && Date.now() - t0 < 12000) {
      await new Promise(r => setTimeout(r, 200));
      version = (window as any).Game?.version;
      waitMs = Date.now() - t0;
    }
    return {
      version,
      waitMs,
      hasGame: !!(window as any).Game,
      gameKeys: Object.keys((window as any).Game || {})
    };
  });

  console.log('Version timing:', JSON.stringify(res, null, 2));
  await cdp.disconnect();
}

main().catch(console.error);

import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  const debug = await page.evaluate(async () => {
    const g = (window as any).Game;
    let version = g?.version || (window as any).version || '';
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (version) headers['X-VERSION'] = String(version);

    const [rStatus, rUser] = await Promise.all([
      fetch(`/user/status?_=${Date.now()}`, { headers }),
      fetch(`/user/user_id/0?_=${Date.now()}`, { headers })
    ]);

    const statusText = await rStatus.text();
    const userText = await rUser.text();

    return {
      version,
      statusOk: rStatus.ok,
      statusText: statusText.slice(0, 150),
      userOk: rUser.ok,
      userText: userText.slice(0, 150),
      url: window.location.href,
      hash: window.location.hash
    };
  });

  console.log('Debug result:', JSON.stringify(debug, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  const result = await page.evaluate(async () => {
    // 1. Wait up to 10 seconds for Game.version to be available
    let version = (window as any).Game?.version;
    for (let i = 0; i < 20 && !version; i++) {
      await new Promise(r => setTimeout(r, 500));
      version = (window as any).Game?.version;
    }

    if (!version) {
      // Try to find version in DOM or scripts
      const script = Array.from(document.querySelectorAll('script')).find(s => s.src.includes('version=') || s.textContent?.includes('version'));
      version = (window as any).version || '';
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (version) headers['X-VERSION'] = String(version);

    const rStatus = await fetch(`/user/status?_=${Date.now()}`, { headers });
    const tStatus = await rStatus.text();
    let dStatus = null;
    try { dStatus = JSON.parse(tStatus); } catch {}

    const rUser = await fetch(`/user/user_id/0?_=${Date.now()}`, { headers });
    const tUser = await rUser.text();
    let dUser = null;
    try { dUser = JSON.parse(tUser); } catch {}

    return {
      version,
      statusHttp: rStatus.status,
      statusJson: dStatus,
      statusRaw: dStatus ? null : tStatus.slice(0, 300),
      userHttp: rUser.status,
      userJson: dUser,
      userRaw: dUser ? null : tUser.slice(0, 300)
    };
  });

  console.log('=== Robust API Verification ===');
  console.log(JSON.stringify(result, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  console.log('Current page URL:', page.url());
  const initialHash = await page.evaluate(() => window.location.hash);
  console.log('Initial Hash:', initialHash);

  // Click start / tap title screen
  const clickRes = await page.evaluate(() => {
    const start = document.querySelector('#start, .btn-start, [data-location-href="start"], #wrapper') as HTMLElement;
    const $ = (window as any).$ || (window as any).Zepto;
    if (start) {
      if ($) $(start).trigger('tap');
      start.click();
      return { found: true, id: start.id, className: start.className };
    }
    return { found: false };
  });
  console.log('Click result:', clickRes);

  // Also simulate mouse click in center of game canvas
  await page.mouse.click(240, 480).catch(() => null);

  await new Promise(r => setTimeout(r, 5000));

  const afterHash = await page.evaluate(() => window.location.hash);
  console.log('After Hash:', afterHash);

  // Check API
  const apiCheck = await page.evaluate(async () => {
    const g = (window as any).Game;
    let version = g?.version || (window as any).version || '';
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (version) headers['X-VERSION'] = String(version);

    const [rStatus, rUser] = await Promise.all([
      fetch(`/user/status?_=${Date.now()}`, { headers }).catch(e => ({ status: 0, text: () => e.message })),
      fetch(`/user/user_id/0?_=${Date.now()}`, { headers }).catch(e => ({ status: 0, text: () => e.message }))
    ]);
    const tStatus = await (rStatus as any).text().catch(() => '');
    const tUser = await (rUser as any).text().catch(() => '');

    return {
      version,
      hash: window.location.hash,
      status: tStatus.slice(0, 150),
      user: tUser.slice(0, 150)
    };
  });

  console.log('API state after tap:', JSON.stringify(apiCheck, null, 2));

  await page.screenshot({ path: '/var/www/guranburuing/data/tap-state.png' });
  console.log('Screenshot saved to /var/www/guranburuing/data/tap-state.png');

  await cdp.disconnect();
}

main().catch(console.error);

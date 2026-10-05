import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  page.on('response', async res => {
    const url = res.url();
    if (url.includes('/user/') || url.includes('/quest/') || url.includes('/authentication/') || url.includes('auth')) {
      console.log(`[HTTP ${res.status()}] ${url.slice(0, 100)}`);
      try {
        const text = await res.text();
        console.log(`  Body: ${text.slice(0, 200)}`);
      } catch {}
    }
  });

  console.log('Current URL:', page.url());
  console.log('Current Hash:', await page.evaluate(() => window.location.hash));

  // Inspect the start buttons on page
  const buttons = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div, a, button, span'));
    const matches = all.filter(el => {
      const cls = el.className || '';
      const id = el.id || '';
      return id.includes('start') || cls.includes('start') || id.includes('btn') || cls.includes('btn');
    }).map(el => ({
      tag: el.tagName,
      id: el.id,
      className: el.className,
      text: el.textContent?.trim().slice(0, 30),
      dataHref: el.getAttribute('data-location-href')
    }));
    return matches.slice(0, 15);
  });
  console.log('Detected buttons on #top:', JSON.stringify(buttons, null, 2));

  // Click Game Start (#start or [data-location-href="start"])
  console.log('Attempting click on Game Start...');
  const clicked = await page.evaluate(() => {
    const start = document.querySelector('#start, .btn-start, [data-location-href="start"], .prt-start') as HTMLElement;
    if (start) {
      const $ = (window as any).$ || (window as any).Zepto;
      if ($) $(start).trigger('tap');
      start.click();
      return true;
    }
    return false;
  });
  console.log('Clicked result:', clicked);

  // Wait 6 seconds
  await new Promise(r => setTimeout(r, 6000));

  console.log('New URL:', page.url());
  console.log('New Hash:', await page.evaluate(() => window.location.hash));

  const profile = await page.evaluate(() => {
    const Game = (window as any).Game;
    return {
      userId: Game?.userId || null,
      userName: Game?.userName || null
    };
  });
  console.log('Game Profile:', profile);

  await page.screenshot({ path: '/var/www/guranburuing/data/click-start.png' });
  console.log('Saved screenshot to /var/www/guranburuing/data/click-start.png');

  await cdp.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

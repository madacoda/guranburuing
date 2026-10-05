// scripts/test-mobage-button.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  page.on('response', async res => {
    const u = res.url();
    if (u.includes('connect.mobage.jp') || u.includes('/user/') || u.includes('authentication')) {
      console.log(`[HTTP ${res.status()}] ${u.slice(0, 100)}`);
    }
  });

  console.log('Navigating to https://game.granbluefantasy.jp/#authentication ...');
  await page.goto('https://game.granbluefantasy.jp/#authentication', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));

  console.log('Current URL:', page.url());
  console.log('Current Hash:', await page.evaluate(() => window.location.hash));

  // Inspect elements
  const elements = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('div, a, button, img'));
    return list.filter(el => {
      const c = el.className || '';
      const id = el.id || '';
      const h = (el as any).href || '';
      const dh = el.getAttribute('data-location-href') || '';
      return c.includes('mobage') || c.includes('platform') || c.includes('auth') || h.includes('mobage') || dh.includes('mobage');
    }).map(el => ({
      tag: el.tagName,
      className: el.className,
      id: el.id,
      text: el.textContent?.trim().slice(0, 30),
      dataHref: el.getAttribute('data-location-href')
    })).slice(0, 10);
  });
  console.log('Auth elements:', JSON.stringify(elements, null, 2));

  // Click Mobage button
  console.log('Clicking Mobage auth button...');
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('[data-location-href="auth/mobage"], .btn-auth-platform-mobage, [data-platform="mobage"], [class*="mobage"]') as HTMLElement;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  console.log('Mobage button clicked:', clicked);

  await new Promise(r => setTimeout(r, 6000));

  console.log('URL after click:', page.url());
  console.log('Hash after click:', await page.evaluate(() => window.location.hash));

  const allPages = await conn.browser.pages();
  console.log('Browser pages count:', allPages.length);
  for (const p of allPages) {
    console.log(`  Page [${await p.title()}]: ${p.url()}`);
  }

  await page.screenshot({ path: '/var/www/guranburuing/data/mobage-click.png' });
  console.log('Saved screenshot to /var/www/guranburuing/data/mobage-click.png');

  await cdp.disconnect();
}

main().catch(console.error);

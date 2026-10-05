import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const { page } = await cdp.connectWithRetry(1, 1000, true, { cdpPort: 9222, profileDir: '/var/www/acc1' });
  const dom = await page.evaluate(() => {
    return {
      canvas: !!document.querySelector('canvas'),
      loading: !!document.querySelector('#loading, .loading, .prt-loading'),
      mobage: !!document.querySelector('.prt-mobage, [class*="mobage"]'),
      start: !!document.querySelector('#start, .btn-start, [data-location-href="start"]'),
      popups: Array.from(document.querySelectorAll('[class*="pop"]')).map(el => el.className),
      buttons: Array.from(document.querySelectorAll('button, .btn, [class*="btn"]')).map(el => ({ cls: el.className, text: el.textContent?.trim().slice(0, 30) }))
    };
  });
  console.log(JSON.stringify(dom, null, 2));
  await cdp.disconnect();
}

main().catch(console.error);

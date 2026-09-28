import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  const viewport = page.viewport();
  console.log('Page viewport:', viewport);

  const rects = await page.evaluate(() => {
    const mobage = document.querySelector('.btn-auth-platform[data-platform="mobage"]')?.getBoundingClientRect();
    const ok = document.querySelector('.btn-ok')?.getBoundingClientRect();
    return {
      windowInner: { width: window.innerWidth, height: window.innerHeight },
      mobage,
      ok
    };
  });
  console.log('Rects:', JSON.stringify(rects, null, 2));

  // Let's click OK using humanized click on element handle
  const okEl = await page.$('.btn-ok');
  if (okEl) {
    console.log('Clicking okEl directly with puppeteer click...');
    await okEl.click();
  }

  await new Promise(r => setTimeout(r, 4000));
  console.log('URL after direct click:', page.url());

  const pages = await (await cdp.getBrowser()).pages();
  for (let i = 0; i < pages.length; i++) {
    console.log(`Tab [${i}]: ${pages[i].url()}`);
  }

  await cdp.disconnect();
}
main().catch(console.error);

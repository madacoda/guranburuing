import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  console.log('Tapping lit blue OK button...');
  const rect = await page.evaluate(() => {
    const ok = document.querySelector('.btn-ok:not(.disable)') as HTMLElement;
    if (!ok) return null;
    try { (window as any).$?.(ok).trigger('tap'); } catch {}
    ok.click();
    const r = ok.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (rect) {
    await page.touchscreen.tap(rect.x, rect.y);
    await page.mouse.click(rect.x, rect.y);
  }

  // Wait for navigation or popup or redirect
  await new Promise(r => setTimeout(r, 4000));
  console.log('Current page URL:', page.url());
  const pages = await (await cdp.getBrowser()).pages();
  console.log('Total open pages/tabs:', pages.length);
  for (let i = 0; i < pages.length; i++) {
    console.log(`Tab [${i}]: ${pages[i].url()}`);
  }
  await page.screenshot({ path: 'scratch-after-ok-click-2.png' });

  await cdp.disconnect();
}
main().catch(console.error);

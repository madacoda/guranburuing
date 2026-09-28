import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  console.log('Current URL:', page.url());
  if (!page.url().includes('authentication')) {
    await page.goto('https://game.granbluefantasy.jp/#authentication', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2500));
  }

  // 1. Select Mobage platform
  console.log('Step 1: Selecting Mobage platform...');
  const mobageBox = await page.evaluate(() => {
    const btn = document.querySelector('.btn-auth-platform[data-platform="mobage"]') as HTMLElement;
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  if (mobageBox) {
    await page.touchscreen.tap(mobageBox.x, mobageBox.y);
  }

  // 2. Wait for OK button to be enabled
  console.log('Step 2: Waiting for OK button to become enabled...');
  await page.waitForFunction(() => {
    const ok = document.querySelector('.btn-ok');
    return ok && !ok.classList.contains('disable');
  }, { timeout: 5000 });

  const okBox = await page.evaluate(() => {
    const ok = document.querySelector('.btn-ok') as HTMLElement;
    const r = ok.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  // 3. Tap OK button and await navigation
  console.log('Step 3: Tapping OK button at', okBox);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log('Nav note:', e.message)),
    page.touchscreen.tap(okBox.x, okBox.y)
  ]);

  await new Promise(r => setTimeout(r, 3000));
  console.log('Final URL after OK tap:', page.url());
  await page.screenshot({ path: 'scratch-mobage-login-page.png' });
  console.log('Screenshot saved to scratch-mobage-login-page.png');

  await cdp.disconnect();
}
main().catch(console.error);

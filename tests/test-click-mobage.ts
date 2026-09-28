import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: 9222,
    profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
  });
  const page = conn.page;

  console.log('Clicking Mobage platform button...');
  await page.evaluate(() => {
    const mobageBtn = document.querySelector('.btn-auth-platform[data-platform="mobage"]') as HTMLElement;
    if (mobageBtn) {
      mobageBtn.click();
    }
  });

  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'scratch-mobage-selected.png' });

  // Check state of OK button
  const okInfo = await page.evaluate(() => {
    const okBtn = document.querySelector('.btn-usual-ok, .btn-submit, [class*="ok"]') as HTMLElement;
    return {
      className: okBtn?.className,
      disabled: (okBtn as any)?.disabled,
      outerHTML: okBtn?.outerHTML
    };
  });
  console.log('OK Button Info:', okInfo);

  // Click OK button if present
  console.log('Clicking OK button...');
  await page.evaluate(() => {
    const okBtn = document.querySelector('.btn-usual-ok, [class*="ok"]') as HTMLElement;
    if (okBtn) okBtn.click();
  });

  await new Promise(r => setTimeout(r, 4000));
  console.log('URL after clicking OK:', page.url());
  await page.screenshot({ path: 'scratch-after-ok.png' });

  await cdp.disconnect();
}
main().catch(console.error);

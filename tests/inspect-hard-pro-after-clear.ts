// tests/inspect-hard-pro-after-clear.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

await page.evaluate(() => {
  const btn = document.querySelector('.btn-pro-list') as HTMLElement;
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));

const status = await page.evaluate(() => {
  const btn = document.querySelector('.pop-pro-quest-list .btn-set-quest[data-quest-id="305261"]') as HTMLElement;
  if (!btn) return 'not_found';
  return {
    className: btn.className,
    limitedCount: btn.getAttribute('data-limited_count'),
    isCleared: btn.getAttribute('data-limited_count') === '0' || btn.classList.contains('disable'),
    outerHtml: btn.outerHTML
  };
});
console.log('Hard+ Pro status after clear:', JSON.stringify(status, null, 2));

await browser.disconnect();
process.exit(0);

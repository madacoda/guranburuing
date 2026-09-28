// tests/test-click-pro-list-item.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

// Open .btn-pro-list
console.log('Opening .btn-pro-list...');
await page.evaluate(() => {
  const btn = document.querySelector('.btn-pro-list') as HTMLElement;
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));

// Inspect Hard+ Pro card
const hardProBtnInfo = await page.evaluate(() => {
  const hardBtn = document.querySelector('.pop-pro-quest-list .btn-set-quest[data-quest-name="Hard+ Pro"], .pop-pro-quest-list [data-quest-id="305261"] .btn-set-quest, .pop-pro-quest-list .btn-set-quest[data-chapter-id="30526"]');
  if (!hardBtn) return null;
  return {
    className: hardBtn.className,
    questId: hardBtn.getAttribute('data-quest-id'),
    limitedCount: hardBtn.getAttribute('data-limited_count'),
    outerHtml: hardBtn.outerHTML
  };
});
console.log('Hard+ Pro button info:', JSON.stringify(hardProBtnInfo, null, 2));

await browser.disconnect();
process.exit(0);

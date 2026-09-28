// tests/test-click-hard-pro-flow.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

// Open .btn-pro-list if not already open
await page.evaluate(() => {
  const modal = document.querySelector('.pop-pro-quest-list');
  if (!modal) {
    const btn = document.querySelector('.btn-pro-list') as HTMLElement;
    if (btn) btn.click();
  }
});
await new Promise(r => setTimeout(r, 1500));

// Click Hard+ Pro
console.log('Clicking Hard+ Pro .btn-set-quest...');
await page.evaluate(() => {
  const btn = document.querySelector('.pop-pro-quest-list .btn-set-quest[data-quest-id="305261"]') as HTMLElement;
  if (btn) {
    const $ = (window as any).$ || (window as any).Zepto;
    if ($) $(btn).trigger('tap');
    btn.click();
  }
});
await new Promise(r => setTimeout(r, 2000));

// Check what appeared
const modalState = await page.evaluate(() => {
  const popups = Array.from(document.querySelectorAll('.pop-show, .pop-usual, .prt-popup-header, .btn-usual-ok, .btn-pro-skip-start, .btn-use-item'));
  return popups.map(p => ({
    className: p.className,
    text: (p.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 150),
    outerHtml: p.outerHTML.substring(0, 200)
  }));
});
console.log('Modals after clicking Hard+ Pro:', JSON.stringify(modalState, null, 2));

// If confirm button or AP modal appeared, let's observe
const confirmBtn = await page.$('.btn-usual-ok, .btn-use-item');
console.log('Found confirm or AP recovery button:', !!confirmBtn);

await browser.disconnect();
process.exit(0);

// tests/inspect-pro-button.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

const btnInfo = await page.evaluate(() => {
  const btn = document.querySelector('.btn-pro-list') || document.querySelector('#js-pro-list-button') || document.querySelector('.prt-pro-list-wrapper');
  if (!btn) return null;
  return {
    tagName: btn.tagName,
    className: btn.className,
    outerHtml: btn.outerHTML,
    attributes: Array.from(btn.attributes).map(a => `${a.name}="${a.value}"`)
  };
});
console.log('.btn-pro-list info:', JSON.stringify(btnInfo, null, 2));

// Check if clicking triggers navigation (hash change)
const beforeHash = await page.evaluate(() => window.location.hash);
await page.evaluate(() => {
  const btn = document.querySelector('.btn-pro-list') as HTMLElement;
  if (btn) {
    const $ = (window as any).$ || (window as any).Zepto;
    if ($) $(btn).trigger('tap');
    btn.click();
  }
});
await new Promise(r => setTimeout(r, 2000));
const afterHash = await page.evaluate(() => window.location.hash);
console.log(`Hash before: ${beforeHash} -> Hash after: ${afterHash}`);

// Check all popups or new modals in DOM
const modals = await page.evaluate(() => {
  const pops = Array.from(document.querySelectorAll('.pop-show, .pop-usual, [class*="pop"], [class*="dialog"], [class*="modal"]'));
  return pops.map(p => ({
    className: p.className,
    text: (p.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 150),
    outerHtml: p.outerHTML.substring(0, 200)
  }));
});
console.log('Active modals/popups:', JSON.stringify(modals, null, 2));

await browser.disconnect();
process.exit(0);

// tests/debug-pro-modal.ts
import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const conn = await cdp.connectWithRetry(6, 2000, false, {
  cdpPort: 9222,
  profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
});
const page = conn.page;

console.log('Page URL:', page.url());

// Click .btn-pro-list using Puppeteer
const btn = await page.$('.btn-pro-list, #js-pro-list-button .btn-pro-list, .prt-pro-list-wrapper .btn-pro-list');
console.log('Found .btn-pro-list:', !!btn);
if (btn) {
  console.log('Clicking .btn-pro-list with page.click...');
  await btn.click();
  await new Promise(r => setTimeout(r, 2000));
}

// Check if .pop-pro-quest-list is in DOM
const modalInfo = await page.evaluate(() => {
  const modal = document.querySelector('.pop-pro-quest-list');
  if (!modal) return { found: false, allPopups: Array.from(document.querySelectorAll('.pop-show, [class*="pop"]')).map(p => p.className) };
  return {
    found: true,
    className: modal.className,
    style: modal.getAttribute('style'),
    childCount: modal.children.length,
    tabsCount: modal.querySelectorAll('.btn-quest-type').length,
    bannersCount: modal.querySelectorAll('.prt-quest-banner').length,
    html: modal.outerHTML.substring(0, 500)
  };
});
console.log('Modal info:', JSON.stringify(modalInfo, null, 2));

await conn.browser.disconnect();
process.exit(0);

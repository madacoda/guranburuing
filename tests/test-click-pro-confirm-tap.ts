// tests/test-click-pro-confirm-tap.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Triggering tap and click on .btn-usual-ok in .pop-pro-quest-skip...');
const result = await page.evaluate(() => {
  const okBtn = document.querySelector('.pop-pro-quest-skip .btn-usual-ok') as HTMLElement;
  if (!okBtn) return 'no_ok_btn';
  const $ = (window as any).$ || (window as any).Zepto;
  if ($) $(okBtn).trigger('tap');
  okBtn.click();
  return 'tapped_and_clicked';
});
console.log('Action result:', result);

await new Promise(r => setTimeout(r, 3000));

const afterTap = await page.evaluate(() => {
  return {
    url: window.location.href,
    popups: Array.from(document.querySelectorAll('.pop-show, .pop-usual, .se-quest-start, .btn-usual-ok, .btn-use-item')).map(el => ({
      className: el.className,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100)
    }))
  };
});
console.log('State after tap:', JSON.stringify(afterTap, null, 2));

await browser.disconnect();
process.exit(0);

// tests/test-click-pro-start.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Current URL:', page.url());
console.log('Clicking .btn-usual-ok.se-quest-start...');
const startResult = await page.evaluate(() => {
  const startBtn = document.querySelector('.btn-usual-ok.se-quest-start, .se-quest-start, .btn-usual-ok[data-type-id="28"]') as HTMLElement;
  if (!startBtn) return 'no_start_btn';
  const $ = (window as any).$ || (window as any).Zepto;
  if ($) $(startBtn).trigger('tap');
  startBtn.click();
  return 'clicked_start';
});
console.log('Start button result:', startResult);

await new Promise(r => setTimeout(r, 4000));

const afterStart = await page.evaluate(() => {
  return {
    url: window.location.href,
    popups: Array.from(document.querySelectorAll('.pop-show, .pop-usual, .prt-result-head, .btn-result-close')).map(el => ({
      className: el.className,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100)
    }))
  };
});
console.log('State after skip start:', JSON.stringify(afterStart, null, 2));

await browser.disconnect();
process.exit(0);

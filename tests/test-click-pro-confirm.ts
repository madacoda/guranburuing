// tests/test-click-pro-confirm.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Clicking .btn-usual-ok in .pop-pro-quest-skip...');
const okBtn = await page.$('.pop-pro-quest-skip .btn-usual-ok');
if (okBtn) {
  await page.evaluate(el => el.click(), okBtn);
  await new Promise(r => setTimeout(r, 2000));
}

const afterConfirm = await page.evaluate(() => {
  const currentUrl = window.location.href;
  const modals = Array.from(document.querySelectorAll('.pop-show, .pop-usual, .se-quest-start, .btn-usual-ok, .btn-use-item, .pop-pro-quest-result'));
  return {
    currentUrl,
    modals: modals.map(m => ({
      className: m.className,
      text: (m.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 150)
    }))
  };
});

console.log('State after confirm:', JSON.stringify(afterConfirm, null, 2));

await browser.disconnect();
process.exit(0);

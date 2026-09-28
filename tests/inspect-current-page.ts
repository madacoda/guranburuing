// tests/inspect-current-page.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Current URL:', page.url());
console.log('Current Hash:', await page.evaluate(() => window.location.hash));

// Let's see if result modal is showing
const modals = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.pop-show, .pop-usual, .btn-usual-ok, .btn-result-close, .prt-result-head')).map(el => ({
    className: el.className,
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100)
  }));
});
console.log('Current Modals:', JSON.stringify(modals, null, 2));

// If on result screen, let's dismiss it properly
if (page.url().includes('result')) {
  console.log('Dismissing result screen via .btn-result-close or navigating to #quest/extra...');
  await page.evaluate(() => {
    const closeBtn = document.querySelector('.btn-result-close, .btn-usual-ok, .btn-usual-close') as HTMLElement;
    if (closeBtn) closeBtn.click();
    window.location.href = 'https://game.granbluefantasy.jp/#quest/extra';
  });
  await new Promise(r => setTimeout(r, 3000));
  console.log('New URL after dismiss:', page.url());
}

await browser.disconnect();
process.exit(0);

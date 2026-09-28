// tests/test-click-omega.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { humanizedClick, logNormalDelay } from '../src/human-motor.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Current URL:', page.url());

const card = await page.$('.btn-treasure-raid[data-quest-id="300441"], img[src*="2040020000_high"]');
if (!card) {
  console.error('Could not find Omega (Impossible) card!');
  process.exit(1);
}

console.log('Clicking Omega (Impossible) card...');
await humanizedClick(page, card);
await logNormalDelay(1500, 0.2);

const modalInfo = await page.evaluate(() => {
  const popups = Array.from(document.querySelectorAll('.pop-usual, .prt-popup-header, .btn-usual-ok, .btn-usual-cancel'));
  return popups.map(p => ({
    className: p.className,
    text: (p.innerText || '').trim().replace(/\n/g, ' '),
    dataQuestId: p.getAttribute('data-quest-id'),
    dataChapterName: p.getAttribute('data-chapter-name'),
    outerHtml: p.outerHTML.substring(0, 300)
  }));
});

console.log('Popups appeared after click:', JSON.stringify(modalInfo, null, 2));

await browser.disconnect();
process.exit(0);

// tests/test-click-synopsis-ok.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { humanizedClick, logNormalDelay } from '../src/human-motor.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Clicking synopsis OK button...');
const okBtn = await page.$('.pop-synopsis .btn-usual-ok, .pop-show .btn-usual-ok');
if (okBtn) {
  await humanizedClick(page, okBtn);
  await logNormalDelay(1500, 0.2);
} else {
  console.log('Synopsis OK button not found.');
}

const modalInfo = await page.evaluate(() => {
  const popups = Array.from(document.querySelectorAll('.pop-usual, .prt-popup-header, .btn-usual-ok, .btn-usual-cancel, .pop-show'));
  return popups.map(p => ({
    className: p.className,
    text: (p.innerText || '').trim().replace(/\n/g, ' '),
    dataQuestId: p.getAttribute('data-quest-id'),
    dataChapterName: p.getAttribute('data-chapter-name'),
    outerHtml: p.outerHTML.substring(0, 300)
  }));
});

console.log('After clicking synopsis OK, active popups:', JSON.stringify(modalInfo, null, 2));

await browser.disconnect();
process.exit(0);

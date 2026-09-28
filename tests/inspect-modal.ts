// tests/inspect-modal.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest/index...');
await page.evaluate(() => { window.location.hash = '#quest/index'; });
await page.waitForSelector('.prt-list-contents, .btn-treasure-raid, .prt-noindex-list', { visible: true, timeout: 8000 }).catch(() => null);

const domCheck = await page.evaluate(() => {
  const container = document.querySelector('.prt-noindex-list');
  const allContents = Array.from(document.querySelectorAll('.prt-list-contents'));
  return {
    hasContainer: !!container,
    contentsCount: allContents.length,
    items: allContents.map(el => {
      const clickable = el.querySelector('.js-quest-list, .btn-treasure-raid, .btn-quest-list');
      return {
        name: el.getAttribute('data-quest-name'),
        proSkip: clickable?.getAttribute('data-pro-quest-skip'),
        proChapterId: clickable?.getAttribute('data-pro-chapter-id'),
        hosts: clickable?.getAttribute('data-limited_count')
      };
    })
  };
});

console.log('DOM check:', JSON.stringify(domCheck, null, 2));

await browser.disconnect();
process.exit(0);








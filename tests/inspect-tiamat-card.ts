// tests/inspect-tiamat-card.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

await page.evaluate(() => { window.location.hash = '#quest'; });
await new Promise(r => setTimeout(r, 2000));

const proCards = await page.evaluate(() => {
  const elements = Array.from(document.querySelectorAll('.prt-noindex-list .prt-list-contents [data-pro-quest-skip="true"]'));
  return elements.map(el => ({
    questName: el.getAttribute('data-quest-name'),
    proChapterId: el.getAttribute('data-pro-chapter-id'),
    questId: el.getAttribute('data-quest-id'),
    chapterId: el.getAttribute('data-chapter-id'),
    limitedCount: el.getAttribute('data-limited_count'),
    maxLimitedCount: el.getAttribute('data-max-limited-count'),
    classes: el.className
  }));
});

console.log('All Pro Skip Cards in .prt-noindex-list:', JSON.stringify(proCards, null, 2));

await page.evaluate(() => { window.location.hash = '#mypage'; });
await browser.disconnect();
process.exit(0);



















// tests/inspect-raid-list.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

const quests = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.btn-treasure-raid, .js-quest-list, [data-quest-name]'));
  return cards.map(c => ({
    name: c.getAttribute('data-quest-name'),
    questId: c.getAttribute('data-quest-id'),
    chapterId: c.getAttribute('data-chapter-id'),
    thumbnail: c.getAttribute('data-thumbnail'),
    ap: c.getAttribute('data-ap'),
    limitedCount: c.getAttribute('data-limited_count'),
    maxLimitedCount: c.getAttribute('data-max-limited-count'),
    isCleared: c.classList.contains('ico-clear'),
    className: c.className
  }));
});

console.log(`Found ${quests.length} quest cards on current page:`);
console.log(JSON.stringify(quests, null, 2));

await browser.disconnect();
process.exit(0);

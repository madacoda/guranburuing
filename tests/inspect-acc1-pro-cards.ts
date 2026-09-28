// tests/inspect-acc1-pro-cards.ts
import path from 'path';
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const conn = await cdp.connectWithRetry(6, 2000, false, {
  cdpPort: 9222,
  profileDir: path.resolve(process.env.USERPROFILE || process.env.HOME || '.', '.gbf-profiles/acc1')
});
const page = conn.page;

console.log('Navigating to #quest/extra on acc1...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2500));

// Open Pro modal
console.log('Opening .btn-pro-list...');
await page.evaluate(() => {
  const btn = document.querySelector('.btn-pro-list') as HTMLElement;
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));

// Switch to tab 1 (high)
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.pop-pro-quest-list .btn-quest-type')) as HTMLElement[];
  const highTab = tabs.find(t => t.getAttribute('data-type') === 'high' || t.getAttribute('data-tab-no') === '1');
  if (highTab) highTab.click();
});
await new Promise(r => setTimeout(r, 1000));

const cards = await page.evaluate(() => {
  const banners = Array.from(document.querySelectorAll('.pop-pro-quest-list .prt-quest-banner'));
  return banners.map(b => {
    const btn = b.querySelector('.btn-set-quest') as HTMLElement;
    const name = b.getAttribute('data-chapter-name') || b.querySelector('.txt-quest-name')?.textContent?.trim();
    const qId = b.getAttribute('data-quest-id');
    const chId = btn?.getAttribute('data-chapter-id');
    const limited = btn?.getAttribute('data-limited_count');
    const btnClasses = btn?.className || '';
    const bannerClasses = b.className || '';
    return {
      name,
      questId: qId,
      chapterId: chId,
      limitedCount: limited,
      bannerClasses,
      btnClasses,
      outerHtml: btn?.outerHTML?.substring(0, 300)
    };
  });
});

console.log('--- Pro cards on acc1 High tab: ---');
console.log(JSON.stringify(cards, null, 2));

await conn.browser.disconnect();
process.exit(0);

// tests/inspect-all-pro-tabs.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

await page.evaluate(() => {
  const btn = document.querySelector('.btn-pro-list') as HTMLElement;
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));

const allProQuests = await page.evaluate(async () => {
  const tabs = Array.from(document.querySelectorAll('.pop-pro-quest-list .btn-quest-type')) as HTMLElement[];
  const catalog: any[] = [];

  for (let t = 0; t < tabs.length; t++) {
    tabs[t].click();
    await new Promise(r => setTimeout(r, 300));

    const banners = Array.from(document.querySelectorAll('.pop-pro-quest-list .prt-quest-banner'));
    for (const b of banners) {
      const qBtn = b.querySelector('.btn-set-quest');
      const qName = b.getAttribute('data-chapter-name') || b.querySelector('.txt-quest-name')?.textContent?.trim() || '';
      const qId = b.getAttribute('data-quest-id') || qBtn?.getAttribute('data-quest-id') || '';
      const ap = b.querySelector('.txt-quest-ap')?.textContent?.trim() || qBtn?.getAttribute('data-ap') || '';
      const limitedCount = qBtn?.getAttribute('data-limited_count') || '';
      const proChapterId = qBtn?.getAttribute('data-pro-chapter-id') || '';
      const tabType = tabs[t].getAttribute('data-type') || '';
      const isLocked = b.classList.contains('locked') || b.querySelector('.btn-set-quest.disable') !== null;

      catalog.push({
        tab: tabType,
        questName: qName,
        questId: qId,
        proChapterId,
        ap,
        limitedCount,
        isLocked,
        classes: qBtn?.className || ''
      });
    }
  }

  return catalog;
});

console.log('--- ALL PRO QUESTS IN CYGAMES PRO LIST MODAL ---');
console.log(JSON.stringify(allProQuests, null, 2));

await browser.disconnect();
process.exit(0);

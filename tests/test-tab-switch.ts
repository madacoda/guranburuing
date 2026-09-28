// tests/test-tab-switch.ts
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

// Switch to tab "high"
await page.evaluate(() => {
  const tab = document.querySelector('.pop-pro-quest-list .btn-quest-type[data-type="high"], .pop-pro-quest-list .btn-quest-type[data-tab-no="1"]') as HTMLElement;
  if (tab) tab.click();
});
await new Promise(r => setTimeout(r, 1000));

const highTabQuests = await page.evaluate(() => {
  const banners = Array.from(document.querySelectorAll('.pop-pro-quest-list .prt-quest-banner'));
  return banners.map(b => {
    const btn = b.querySelector('.btn-set-quest') as HTMLElement;
    const name = b.getAttribute('data-chapter-name') || b.querySelector('.txt-quest-name')?.textContent?.trim();
    const qId = b.getAttribute('data-quest-id');
    const chId = btn?.getAttribute('data-chapter-id');
    const limited = btn?.getAttribute('data-limited_count');
    const isCompleted = btn?.classList.contains('is-completed') || btn?.classList.contains('disable') || limited === '0';
    return {
      name,
      questId: qId,
      chapterId: chId,
      limitedCount: limited,
      isCompleted,
      classes: btn?.className || ''
    };
  });
});

console.log('Quests in High tab:');
console.log(JSON.stringify(highTabQuests, null, 2));

await browser.disconnect();
process.exit(0);

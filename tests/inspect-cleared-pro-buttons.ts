// tests/inspect-cleared-pro-buttons.ts
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

// Switch to tab high
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('.pop-pro-quest-list .btn-quest-type')) as HTMLElement[];
  const highTab = tabs.find(t => t.getAttribute('data-type') === 'high' || t.getAttribute('data-tab-no') === '1');
  if (highTab) highTab.click();
});
await new Promise(r => setTimeout(r, 1000));

const proBtns = await page.evaluate(() => {
  const banners = Array.from(document.querySelectorAll('.pop-pro-quest-list .prt-quest-banner'));
  return banners.map(b => {
    const btn = b.querySelector('.btn-set-quest');
    const bannerName = b.getAttribute('data-chapter-name');
    return {
      bannerName,
      questId: b.getAttribute('data-quest-id'),
      bannerClasses: b.className,
      btnClasses: btn?.className,
      btnLimited: btn?.getAttribute('data-limited_count'),
      btnOuterHtml: btn?.outerHTML?.substring(0, 300)
    };
  });
});

console.log('All Pro Banners & Buttons on High Tab:');
console.log(JSON.stringify(proBtns, null, 2));

await browser.disconnect();
process.exit(0);

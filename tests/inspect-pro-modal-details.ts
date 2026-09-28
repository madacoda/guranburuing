// tests/inspect-pro-modal-details.ts
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

const proItems = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('.pop-pro-quest-list .prt-quest-list, .pop-pro-quest-list .prt-pro-quest-item, .pop-pro-quest-list [data-quest-id], .pop-pro-quest-list .btn-usual-quest, .pop-pro-quest-list .btn-quest-list, .pop-pro-quest-list [data-location-href], .pop-pro-quest-list .txt-popup-body *'));
  return items.map(el => ({
    tagName: el.tagName,
    className: el.className,
    questId: el.getAttribute('data-quest-id'),
    questName: el.getAttribute('data-quest-name'),
    limitedCount: el.getAttribute('data-limited_count'),
    dataLocationHref: el.getAttribute('data-location-href'),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
    outerHtml: el.outerHTML.substring(0, 300)
  })).filter(x => x.className.includes('btn') || x.className.includes('quest') || x.questId || x.dataLocationHref);
});

console.log('Items inside .pop-pro-quest-list:');
console.log(JSON.stringify(proItems.slice(0, 40), null, 2));

// Also dump the entire innerHTML of .pop-pro-quest-list
const fullHtml = await page.evaluate(() => {
  const pop = document.querySelector('.pop-pro-quest-list');
  return pop ? pop.innerHTML : 'Not found';
});
console.log('\n--- FULL HTML of .pop-pro-quest-list (first 2500 chars) ---');
console.log(fullHtml.substring(0, 2500));

await browser.disconnect();
process.exit(0);

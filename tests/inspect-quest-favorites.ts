// tests/inspect-quest-favorites.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Navigating to #quest...');
await page.evaluate(() => { window.location.hash = '#quest'; });
await new Promise(r => setTimeout(r, 2000));

const favoritesInfo = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.prt-noindex-list .prt-list-contents, .prt-list-contents'));
  return cards.map(c => {
    const proEl = c.querySelector('[data-pro-quest-skip]') || c;
    return {
      questName: c.getAttribute('data-quest-name') || proEl.getAttribute('data-quest-name') || c.querySelector('.txt-quest-title')?.textContent?.trim(),
      questId: c.getAttribute('data-quest-id') || proEl.getAttribute('data-quest-id'),
      isPro: proEl.getAttribute('data-pro-quest-skip'),
      proChapterId: proEl.getAttribute('data-pro-chapter-id'),
      limitedCount: c.getAttribute('data-limited_count') || proEl.getAttribute('data-limited_count'),
      classes: c.className,
      innerClasses: proEl.className,
      outerHtml: c.outerHTML.substring(0, 300)
    };
  });
});

console.log('All cards on #quest:');
console.log(JSON.stringify(favoritesInfo, null, 2));

// Also let's inspect clicking .btn-pro-list on #quest/extra
console.log('\nNavigating to #quest/extra...');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2000));

const proBtn = await page.$('.btn-pro-list, #js-pro-list-button');
console.log('Found .btn-pro-list on #quest/extra:', !!proBtn);

if (proBtn) {
  console.log('Clicking .btn-pro-list...');
  await page.evaluate(el => el.click(), proBtn);
  await new Promise(r => setTimeout(r, 1500));

  const popupOrList = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.pop-pro-list, .pop-usual, .prt-pro-list, .prt-popup-body, .btn-pro-skip, [data-location-href*="pro_skip"]'));
    return list.map(el => ({
      tagName: el.tagName,
      className: el.className,
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
      dataHref: el.getAttribute('data-location-href') || '',
      outerHtml: el.outerHTML.substring(0, 300)
    }));
  });
  console.log('DOM after clicking .btn-pro-list:', JSON.stringify(popupOrList, null, 2));
}

await browser.disconnect();
process.exit(0);

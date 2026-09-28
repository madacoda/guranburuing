// tests/inspect-quest-dom.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('Current URL:', page.url());
console.log('Current Title:', await page.title());

// Look for image mentioned by user
const imgMatch = await page.$('img[src*="2040020000_high"]');
console.log('Found img 2040020000_high:', !!imgMatch);

if (imgMatch) {
  const info = await page.evaluate(el => {
    // Find closest clickable ancestor or button
    const clickable = el.closest('div[class*="btn"], div[class*="quest"], a, [data-location-href]') || el.parentElement;
    return {
      tagName: clickable?.tagName,
      className: clickable?.className,
      dataHref: clickable?.getAttribute('data-location-href') || clickable?.getAttribute('data-href'),
      outerHtml: clickable?.outerHTML?.substring(0, 800),
      parentOuterHtml: clickable?.parentElement?.outerHTML?.substring(0, 800)
    };
  }, imgMatch);
  console.log('Clickable Element Info:', JSON.stringify(info, null, 2));
}

// Find all quest titles or buttons visible on page
const pageOverview = await page.evaluate(() => {
  const elements = Array.from(document.querySelectorAll('.txt-quest-title, .prt-quest-detail, .btn-usual-quest, .prt-quest-thumb, [data-location-href]'));
  return elements.map(el => ({
    tag: el.tagName,
    className: el.className,
    text: (el.innerText || '').trim().replace(/\n/g, ' ').substring(0, 80),
    dataHref: el.getAttribute('data-location-href') || ''
  })).slice(0, 20);
});
console.log('Visible Quest Elements on Page:', JSON.stringify(pageOverview, null, 2));

await browser.disconnect();
process.exit(0);

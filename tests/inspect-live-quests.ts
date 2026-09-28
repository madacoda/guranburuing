// tests/inspect-live-quests.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

console.log('--- Inspecting #quest (Favorites / Index) ---');
await page.evaluate(() => { window.location.hash = '#quest'; });
await new Promise(r => setTimeout(r, 2500));

const questIndexProCards = await page.evaluate(() => {
  const elements = Array.from(document.querySelectorAll('[data-pro-quest-skip], [data-quest-id], .btn-pro-skip, .btn-usual-quest, .prt-quest-detail'));
  return elements.map(el => ({
    tag: el.tagName,
    className: el.className,
    questId: el.getAttribute('data-quest-id'),
    questName: el.getAttribute('data-quest-name'),
    proQuestSkip: el.getAttribute('data-pro-quest-skip'),
    proChapterId: el.getAttribute('data-pro-chapter-id'),
    limitedCount: el.getAttribute('data-limited_count'),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
    dataHref: el.getAttribute('data-location-href') || el.getAttribute('data-href') || ''
  })).filter(x => x.proQuestSkip || x.proChapterId || x.text.toLowerCase().includes('pro') || x.dataHref.includes('pro'));
});
console.log('Pro cards found on #quest:', JSON.stringify(questIndexProCards, null, 2));

console.log('\n--- Inspecting #quest/extra ---');
await page.evaluate(() => { window.location.hash = '#quest/extra'; });
await new Promise(r => setTimeout(r, 2500));

const extraPageElements = await page.evaluate(() => {
  const elements = Array.from(document.querySelectorAll('[data-location-href], [data-quest-id], .btn-pro-skip, .prt-quest-detail, .prt-extra-list *'));
  return elements.map(el => ({
    tag: el.tagName,
    className: el.className,
    questId: el.getAttribute('data-quest-id'),
    questName: el.getAttribute('data-quest-name'),
    limitedCount: el.getAttribute('data-limited_count'),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
    dataHref: el.getAttribute('data-location-href') || el.getAttribute('data-href') || ''
  })).filter(x => x.text.toLowerCase().includes('pro') || x.dataHref.includes('pro') || x.className.includes('pro') || (x.questId && x.text.length > 0));
});
console.log('Pro or Quest elements on #quest/extra:', JSON.stringify(extraPageElements.slice(0, 30), null, 2));

console.log('\n--- Checking all elements matching "pro" anywhere on current page ---');
const proMatches = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('*'));
  const matching = all.filter(el => {
    const txt = (el.textContent || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    const href = (el.getAttribute('data-location-href') || '').toLowerCase();
    return cls.includes('pro') || href.includes('pro') || (el.children.length === 0 && txt.includes('pro'));
  });
  return matching.slice(0, 20).map(el => ({
    tag: el.tagName,
    className: el.className,
    dataHref: el.getAttribute('data-location-href'),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
    outerHtml: el.outerHTML.substring(0, 200)
  }));
});
console.log('All elements with "pro":', JSON.stringify(proMatches, null, 2));

await browser.disconnect();
process.exit(0);

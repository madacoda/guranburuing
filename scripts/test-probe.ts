// scripts/test-probe.ts
import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });
  const page = (await browser.pages())[0];
  const client = await page.target().createCDPSession();

  // 1. Read exported cookies
  const fs = await import('fs');
  const path = await import('path');
  const cookiePath = path.resolve('/var/www/guranburuing/data/acc1-cookies.json');
  console.log('Reading cookies from:', cookiePath);
  const rawCookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
  console.log(`Loaded ${rawCookies.length} cookies from disk.`);

  // 2. Sanitize and inject
  const sanitized = rawCookies.map((c: any) => {
    const item: any = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/'
    };
    if (typeof c.secure === 'boolean') item.secure = c.secure;
    if (typeof c.httpOnly === 'boolean') item.httpOnly = c.httpOnly;
    if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) item.sameSite = c.sameSite;
    if (typeof c.expires === 'number' && c.expires > 0) item.expires = c.expires;
    return item;
  });

  console.log('Clearing browser cookies...');
  await client.send('Network.clearBrowserCookies');

  // Filter sanitized: if duplicate name, keep only the httpOnly or dot-domain one!
  // In fact, let's keep only domain: ".game.granbluefantasy.jp" for midship
  const filtered = sanitized.filter((c: any) => {
    if (c.name === 'midship') {
      return c.httpOnly === true || c.domain.startsWith('.');
    }
    return true;
  });

  console.log(`Setting ${filtered.length} filtered cookies (only 1 midship)...`);
  await client.send('Network.setCookies', { cookies: filtered });

  // 3. Verify jar via CDP
  const allCookiesRes = await client.send('Network.getAllCookies');
  console.log(`CDP reports ${allCookiesRes.cookies.length} cookies in jar.`);
  for (const c of allCookiesRes.cookies) {
    if (c.name === 'midship' || c.name === 'access_gbtk') {
      console.log(`  [${c.domain}] ${c.name} = ${c.value.slice(0, 15)}... (httpOnly: ${c.httpOnly}, secure: ${c.secure})`);
    }
  }

  // 4. Navigate to GBF
  console.log('Navigating to https://game.granbluefantasy.jp/#profile ...');
  await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));

  console.log('Current URL:', page.url());
  const state = await page.evaluate(() => {
    const Game = (window as any).Game;
    const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
    const rankEl = document.querySelector('.prt-rank-value');
    return {
      userId: Game?.userId || null,
      userName: Game?.userName || nameEl?.textContent?.trim() || null,
      rank: rankEl?.textContent?.trim() || null,
      hash: window.location.hash
    };
  }).catch(() => null);

  console.log('Page state on #profile:', JSON.stringify(state, null, 2));
  await browser.disconnect();
}



main().catch(err => {
  console.error(err);
  process.exit(1);
});

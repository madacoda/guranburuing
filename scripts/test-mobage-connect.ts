// scripts/test-mobage-connect.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import fs from 'fs';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();

  // 1. Read cookies
  const cookiePath = '/var/www/guranburuing/data/acc1-cookies.json';
  const rawCookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));

  // 2. Prepare comprehensive cookie list
  const cookiesToSet: any[] = [];
  for (const c of rawCookies) {
    const base: any = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/'
    };
    if (typeof c.secure === 'boolean') base.secure = c.secure;
    if (typeof c.httpOnly === 'boolean') base.httpOnly = c.httpOnly;
    if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) base.sameSite = c.sameSite;
    if (typeof c.expires === 'number' && c.expires > 0) base.expires = c.expires;

    cookiesToSet.push(base);

    if (c.domain.includes('mbga.jp')) {
      cookiesToSet.push({ ...base, domain: '.mbga.jp' });
      cookiesToSet.push({ ...base, domain: '.sp.mbga.jp' });
      cookiesToSet.push({ ...base, domain: '.www.mbga.jp' });
      cookiesToSet.push({ ...base, domain: 'sp.mbga.jp' });
      cookiesToSet.push({ ...base, domain: 'connect.mobage.jp' });
    }
    if (c.domain.includes('granbluefantasy.jp')) {
      cookiesToSet.push({ ...base, domain: '.granbluefantasy.jp' });
      cookiesToSet.push({ ...base, domain: '.game.granbluefantasy.jp' });
      cookiesToSet.push({ ...base, domain: 'game.granbluefantasy.jp' });
    }
  }

  // Deduplicate
  const seen = new Set();
  const deduped = cookiesToSet.filter(c => {
    const k = `${c.domain}:${c.name}:${c.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  console.log(`Setting ${deduped.length} cookies...`);
  await client.send('Network.clearBrowserCookies');
  await client.send('Network.setCookies', { cookies: deduped });

  // Monitor network
  page.on('response', async res => {
    const u = res.url();
    if (u.includes('mobage') || u.includes('/user/') || u.includes('auth') || u.includes('login')) {
      if (!u.includes('.png') && !u.includes('.jpg') && !u.includes('.css')) {
        console.log(`[HTTP ${res.status()}] ${u.slice(0, 100)}`);
        try {
          const t = await res.text();
          console.log(`   ${t.slice(0, 200)}`);
        } catch {}
      }
    }
  });

  // Navigate to top
  console.log('Navigating to https://game.granbluefantasy.jp/#top ...');
  await page.goto('https://game.granbluefantasy.jp/#top', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));

  // Check what happens if we navigate to connect.mobage.jp directly to verify Mobage session!
  console.log('Checking Mobage session state by opening connect.mobage.jp in iframe or page...');
  const mobageState = await page.evaluate(async () => {
    try {
      const r = await fetch('https://connect.mobage.jp/connect/1.0/jssdk/session_iframe', { credentials: 'include' });
      return { status: r.status, text: (await r.text()).slice(0, 300) };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('Mobage iframe state:', JSON.stringify(mobageState, null, 2));

  // Also check https://sp.mbga.jp/_my0
  console.log('Opening https://sp.mbga.jp/_my0 on a new tab to verify Mobage login identity...');
  const mbgaTab = await conn.browser.newPage();
  await mbgaTab.goto('https://sp.mbga.jp/_my0', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log(e.message));
  await new Promise(r => setTimeout(r, 3000));
  console.log('Mobage Tab URL:', mbgaTab.url());
  const mbgaText = await mbgaTab.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : '');
  console.log('Mobage Tab Content:', mbgaText.replace(/\s+/g, ' '));
  await mbgaTab.screenshot({ path: '/var/www/guranburuing/data/mobage-test.png' });
  await mbgaTab.close();

  await cdp.disconnect();
}

main().catch(console.error);

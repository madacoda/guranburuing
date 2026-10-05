// scripts/inject-and-inspect.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import fs from 'fs';
import path from 'path';

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
  console.log(`[Inject] Read ${rawCookies.length} cookies from ${cookiePath}`);

  // 2. Prepare cookies with cross-domain mirroring
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

    // Mirror Mobage cookies to .mbga.jp and .sp.mbga.jp
    if (c.domain && c.domain.includes('mbga.jp')) {
      cookiesToSet.push({ ...base, domain: '.mbga.jp' });
      cookiesToSet.push({ ...base, domain: '.sp.mbga.jp' });
    }

    // Mirror Granblue cookies to .granbluefantasy.jp and .game.granbluefantasy.jp
    if (c.domain && c.domain.includes('granbluefantasy.jp')) {
      cookiesToSet.push({ ...base, domain: '.granbluefantasy.jp' });
      cookiesToSet.push({ ...base, domain: '.game.granbluefantasy.jp' });
    }
  }

  // Deduplicate by domain + name + path
  const seen = new Set();
  const dedupedCookies = cookiesToSet.filter(c => {
    const key = `${c.domain}:${c.name}:${c.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[Inject] Clearing browser cookies...`);
  await client.send('Network.clearBrowserCookies');

  console.log(`[Inject] Setting ${dedupedCookies.length} deduped & mirrored cookies...`);
  await client.send('Network.setCookies', { cookies: dedupedCookies });

  // 3. Monitor network responses
  page.on('response', async res => {
    const url = res.url();
    if (url.includes('/user/') || url.includes('/profile') || url.includes('/authentication') || url.includes('rest/auth')) {
      console.log(`[HTTP ${res.status()}] ${url.slice(0, 90)}`);
      try {
        const text = await res.text();
        console.log(`   Response: ${text.slice(0, 200)}`);
      } catch {}
    }
  });

  // 4. Navigate to #mypage
  console.log(`[Inject] Navigating to https://game.granbluefantasy.jp/#mypage ...`);
  await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);

  // Wait 5 seconds
  await new Promise(r => setTimeout(r, 5000));

  const currentUrl = page.url();
  const currentHash = await page.evaluate(() => window.location.hash);
  console.log(`[Inject] Landed on: ${currentUrl} (Hash: ${currentHash})`);

  if (currentHash.includes('top') || currentHash === '' || currentHash === '#') {
    console.log('[Inject] Triggering Game Start (#start) on Title screen...');
    await page.evaluate(() => {
      const start = document.querySelector('#start, .btn-start, [data-location-href="start"], #wrapper') as HTMLElement;
      if (start) {
        const $ = (window as any).$ || (window as any).Zepto;
        if ($) $(start).trigger('tap');
        start.click();
      }
    }).catch(() => null);
    await new Promise(r => setTimeout(r, 4000));
  }

  // Wait for Game object and check API
  const apiCheck = await page.evaluate(async () => {
    try {
      const g = (window as any).Game;
      let version = g?.version || (window as any).version || '';
      for (let i = 0; i < 20 && !version; i++) {
        await new Promise(r => setTimeout(r, 250));
        version = (window as any).Game?.version || (window as any).version || '';
      }

      const headers: Record<string, string> = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (version) headers['X-VERSION'] = String(version);

      const r = await fetch(`/user/user_id/0?_=${Date.now()}`, { headers });
      const data = await r.json().catch(() => null);
      
      const rStatus = await fetch(`/user/status?_=${Date.now()}`, { headers });
      const statusData = await rStatus.json().catch(() => null);

      return {
        isJson: !!data,
        userId: data?.user_id || statusData?.status?.user_id,
        userName: data?.nickname || statusData?.status?.nickname,
        level: statusData?.status?.level,
        ap: statusData?.status?.now_action_point,
        bp: statusData?.status?.now_battle_point,
        dataSnippet: data ? JSON.stringify(data).slice(0, 100) : null
      };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  console.log('[Inject] In-Game API Verification Result:', JSON.stringify(apiCheck, null, 2));

  await page.screenshot({ path: '/var/www/guranburuing/data/inject-test.png' });
  console.log('Saved screenshot to /var/www/guranburuing/data/inject-test.png');

  await cdp.disconnect();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

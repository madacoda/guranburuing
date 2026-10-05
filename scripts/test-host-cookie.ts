import { CdpConnectionManager } from '../src/cdp-connection.js';
import fs from 'fs';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();

  // 1. Clear all cookies
  console.log('Clearing cookies...');
  await client.send('Network.clearBrowserCookies');

  // 2. Load cookies from acc1-cookies.json
  const cookies = JSON.parse(fs.readFileSync('/var/www/guranburuing/data/acc1-cookies.json', 'utf-8'));
  const midshipCookie = cookies.find((c: any) => c.name === 'midship');
  console.log('Using midship:', midshipCookie.value.slice(0, 30));

  // Set host-only cookie for game.granbluefantasy.jp using Network.setCookie
  await client.send('Network.setCookie', {
    url: 'https://game.granbluefantasy.jp/',
    name: 'midship',
    value: midshipCookie.value,
    path: '/',
    secure: false,
    httpOnly: false,
    expires: Math.floor(Date.now() / 1000) + 365 * 86400
  });

  // Also set all other cookies
  for (const c of cookies) {
    if (c.name === 'midship') continue;
    await client.send('Network.setCookie', {
      url: c.domain.includes('mobage') ? 'https://connect.mobage.jp/' : 'https://game.granbluefantasy.jp/',
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      expires: c.expires || Math.floor(Date.now() / 1000) + 365 * 86400
    }).catch(() => null);
  }

  // Check what cookies exist for GBF
  const res = await client.send('Network.getCookies', { urls: ['https://game.granbluefantasy.jp/'] });
  console.log('GBF midship cookies in browser:');
  for (const c of res.cookies.filter(x => x.name === 'midship')) {
    console.log(`  domain: "${c.domain}", hostOnly: ${!c.domain.startsWith('.')}, val: ${c.value.slice(0, 30)}`);
  }

  // Navigate to #mypage
  console.log('Navigating to #mypage...');
  await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'domcontentloaded' }).catch(() => null);
  await new Promise(r => setTimeout(r, 4000));

  // Verify API
  const apiCheck = await page.evaluate(async () => {
    let version = (window as any).Game?.version || (window as any).version || '';
    for (let i = 0; i < 20 && !version; i++) {
      await new Promise(r => setTimeout(r, 200));
      version = (window as any).Game?.version || (window as any).version || '';
    }
    const headers: Record<string, string> = {
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    };
    if (version) headers['X-VERSION'] = String(version);

    const [rStatus, rUser] = await Promise.all([
      fetch(`/user/status?_=${Date.now()}`, { headers }),
      fetch(`/user/user_id/0?_=${Date.now()}`, { headers })
    ]);
    const dStatus = await rStatus.json().catch(() => null);
    const dUser = await rUser.json().catch(() => null);

    return {
      version,
      hash: window.location.hash,
      status: dStatus,
      user: dUser
    };
  });

  console.log('API Check Result:', JSON.stringify(apiCheck, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

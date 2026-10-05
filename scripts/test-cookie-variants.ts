// scripts/test-cookie-variants.ts
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

  const cookiePath = '/var/www/guranburuing/data/acc1-cookies.json';
  const rawCookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
  const rawMidship = rawCookies.find((c: any) => c.name === 'midship')?.value;
  const rawGbtk = rawCookies.find((c: any) => c.name === 'access_gbtk')?.value;

  console.log('Original midship:', rawMidship.slice(0, 30));
  console.log('Original access_gbtk:', rawGbtk);

  const variants = [
    { label: 'Original as-is', val: rawMidship },
    { label: 'Decoded (decodeURIComponent)', val: decodeURIComponent(rawMidship) },
    { label: 'Lowercase s: raw', val: rawMidship.replace(/^S%3A/i, 's%3A') },
    { label: 'Lowercase s: decoded', val: decodeURIComponent(rawMidship).replace(/^S:/i, 's:') }
  ];

  for (const v of variants) {
    console.log(`\n=== Testing Variant: ${v.label} ===`);

    await client.send('Network.setCookies', {
      cookies: [
        {
          name: 'midship',
          value: v.val,
          domain: '.granbluefantasy.jp',
          path: '/'
        },
        {
          name: 'midship',
          value: v.val,
          domain: 'game.granbluefantasy.jp',
          path: '/'
        },
        {
          name: 'access_gbtk',
          value: rawGbtk,
          domain: '.granbluefantasy.jp',
          path: '/'
        },
        {
          name: 'access_gbtk',
          value: rawGbtk,
          domain: 'game.granbluefantasy.jp',
          path: '/'
        }
      ]
    });

    const res = await page.evaluate(async () => {
      try {
        const g = (window as any).Game;
        const version = g?.version || String(Date.now());
        const r = await fetch(`/user/status?_=${Date.now()}`, {
          headers: {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'X-VERSION': version
          }
        });
        const text = await r.text();
        return { status: r.status, text: text.slice(0, 200) };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    console.log('Result /user/status:', JSON.stringify(res));
  }

  await cdp.disconnect();
}

main().catch(console.error);

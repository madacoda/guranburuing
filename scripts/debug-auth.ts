import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();
  await client.send('Network.setCookies', {
    cookies: [
      {
        name: 'midship',
        value: 'S%3AWMNT0hkryDpGUt9d5YCRTx5DOpRFZ27fJWGJN3WBOf3kDy9lnfj-OSyz6LeqX8ruPiQIFqfWTr3Y6g-NgZnSSLdnDt0t_gUGbkcScjFE3XNomA7T2tWhyie52b8txQW012k-8Kd6szS_QgNa971NVVkgYmyb3RsmQ802g15qjpA7qpvhLvPYretPNg5x_0cim-x5g4Vgm5IBXXYKxACthpQEneFlnXvuTjtyiqd7WsX8jQ%3D%3D',
        domain: 'game.granbluefantasy.jp',
        path: '/'
      },
      {
        name: 'access_gbtk',
        value: 'f7eddbb6915e1cda80e74c13f8402d60b69568eb',
        domain: 'game.granbluefantasy.jp',
        path: '/'
      }
    ]
  });

  const result = await page.evaluate(async () => {
    try {
      const g = (window as any).Game;
      const version = g?.version || '';
      console.log('Version:', version);

      const rStatus = await fetch(`/user/status?_=${Date.now()}`, {
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-VERSION': version }
      });
      const statusJson = await rStatus.json().catch(e => ({ error: e.message }));

      const rUser = await fetch(`/user/user_id/0?_=${Date.now()}`, {
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-VERSION': version }
      });
      const userJson = await rUser.json().catch(e => ({ error: e.message }));

      return {
        statusOk: rStatus.ok,
        statusJson,
        userOk: rUser.ok,
        userJson
      };
    } catch (e: any) {
      return { err: e.message };
    }
  });

  console.log('Result:', JSON.stringify(result, null, 2));
  await cdp.disconnect();
}

main().catch(console.error);

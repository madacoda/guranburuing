import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;
  const client = await page.target().createCDPSession();

  const res = await client.send('Network.getCookies', { urls: ['https://game.granbluefantasy.jp/', 'https://connect.mobage.jp/'] });
  console.log('Cookies for GBF & Mobage:', res.cookies.length);
  for (const c of res.cookies) {
    console.log(`${c.domain} | ${c.name} = ${c.value.slice(0, 25)}... (secure: ${c.secure}, httpOnly: ${c.httpOnly})`);
  }

  await cdp.disconnect();
}

main().catch(console.error);

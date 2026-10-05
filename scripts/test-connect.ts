import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  console.log('Testing CdpConnectionManager on port 9222...');
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  console.log('Page URL:', conn.page.url());
  const title = await conn.page.title();
  console.log('Page Title:', title);

  const hash = await conn.page.evaluate(() => window.location.hash);
  console.log('Current Hash:', hash);

  await cdp.disconnect();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

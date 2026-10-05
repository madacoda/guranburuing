// scripts/test-tap.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  console.log('Navigating cleanly to https://game.granbluefantasy.jp/ ...');
  await page.goto('https://game.granbluefantasy.jp/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 6000));
  await new Promise(r => setTimeout(r, 1000));
  await page.mouse.click(240, 480);
  await new Promise(r => setTimeout(r, 3000));

  const evaluation = await page.evaluate(() => {
    const Game = (window as any).Game;
    const bodyText = document.body ? document.body.innerText.slice(0, 300) : '';
    const hash = window.location.hash;
    const startBtn = document.querySelector('#start, .btn-start, [data-location-href="start"]');
    return {
      hash,
      hasGame: !!Game,
      userId: Game?.userId || null,
      userName: Game?.userName || null,
      hasStartBtn: !!startBtn,
      bodyText: bodyText.replace(/\s+/g, ' ')
    };
  });
  console.log('State:', JSON.stringify(evaluation, null, 2));

  await page.screenshot({ path: '/var/www/guranburuing/data/tap-result.png' });
  console.log('Screenshot saved to /var/www/guranburuing/data/tap-result.png');

  await cdp.disconnect();
}

main().catch(console.error);

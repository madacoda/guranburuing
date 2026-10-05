// scripts/capture-screen.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  page.on('console', msg => {
    console.log(`[Browser Console ${msg.type()}] ${msg.text()}`);
  });
  page.on('requestfailed', req => {
    console.log(`[Request Failed] ${req.url()}: ${req.failure()?.errorText}`);
  });
  console.log('Navigating to https://game.granbluefantasy.jp/#mypage...');
  await page.goto('https://game.granbluefantasy.jp/#mypage', { waitUntil: 'networkidle2', timeout: 15000 }).catch(e => console.log('Goto notice:', e.message));
  await new Promise(r => setTimeout(r, 4000));
  const hash = await page.evaluate(() => window.location.hash);
  console.log('Current Hash:', hash);

  const profile = await page.evaluate(() => {
    const Game = (window as any).Game;
    const nameEl = document.querySelector('.prt-user-name, .txt-user-name, .prt-status-user-name');
    const rankEl = document.querySelector('.prt-rank-value');
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return {
      userId: Game?.userId || null,
      userName: Game?.userName || (nameEl ? nameEl.textContent?.trim() : null),
      rank: rankEl ? rankEl.textContent?.trim() : null,
      hasGame: !!Game,
      hasStage: !!(window as any).stage,
      hasWebGL: !!gl,
      webglRenderer: gl ? (gl as any).getParameter((gl as any).RENDERER) : null
    };
  });
  console.log('In-Game Profile State:', JSON.stringify(profile, null, 2));

  await page.screenshot({ path: '/var/www/guranburuing/data/current-screen.png' });
  console.log('Screenshot saved to /var/www/guranburuing/data/current-screen.png');

  await cdp.disconnect();
}

main().catch(console.error);

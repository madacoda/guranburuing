// scripts/trace-mypage.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  console.log('Testing /user/status API from within page context...');
  const statusRes = await page.evaluate(async () => {
    try {
      const g = (window as any).Game;
      const version = g?.version || '';
      const r = await fetch(`/user/status?_=${Date.now()}`, {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-VERSION': version
        }
      });
      const data = await r.json();
      return { ok: r.ok, status: r.status, data };
    } catch (e: any) {
      return { error: e.message };
    }
  });

  console.log('/user/status result:', JSON.stringify(statusRes, null, 2));

  // Test /user/user_id/0
  const userRes = await page.evaluate(async () => {
    try {
      const g = (window as any).Game;
      const version = g?.version || '';
      const r = await fetch(`/user/user_id/0?_=${Date.now()}`, {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-VERSION': version
        }
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('/user/user_id/0 result:', JSON.stringify(userRes, null, 2));

  // Test /user/mydata
  const mydataRes = await page.evaluate(async () => {
    try {
      const g = (window as any).Game;
      const version = g?.version || '';
      const r = await fetch(`/user/mydata?_=${Date.now()}`, {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-VERSION': version
        }
      });
      return { ok: r.ok, status: r.status, data: await r.json() };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('/user/mydata result:', JSON.stringify(mydataRes, null, 2));

  // Check Game object
  const gameInfo = await page.evaluate(() => {
    const Game = (window as any).Game;
    return {
      hasGame: !!Game,
      userId: Game?.userId || null,
      userName: Game?.userName || null,
      view: Game?.view ? Object.keys(Game.view) : null
    };
  });
  console.log('Game object:', JSON.stringify(gameInfo, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

// scripts/get-profile-info.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(1, 1000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  const info = await page.evaluate(async () => {
    const g = (window as any).Game;
    const version = g?.version || '';
    
    // 1. user status
    const rStatus = await fetch(`/user/status?_=${Date.now()}`, {
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-VERSION': version }
    });
    const statusData = await rStatus.json();

    // 2. user id
    const rUser = await fetch(`/user/user_id/0?_=${Date.now()}`, {
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-VERSION': version }
    });
    const userData = await rUser.json();

    // 3. mydata
    const rMy = await fetch(`/user/mydata?_=${Date.now()}`, {
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-VERSION': version }
    });
    const myData = await rMy.json();

    return {
      userId: userData?.user_id || myData?.user_id || statusData?.status?.user_id,
      userName: userData?.nickname || myData?.nickname || myData?.user_name,
      level: statusData?.status?.level,
      ap: `${statusData?.status?.now_action_point}/${statusData?.status?.max_action_point}`,
      bp: `${statusData?.status?.now_battle_point}/${statusData?.status?.max_battle_point}`,
      userDataKeys: Object.keys(userData || {}),
      myDataKeys: Object.keys(myData || {}).slice(0, 15)
    };
  });

  console.log('=== In-Game Player Profile ===');
  console.log(JSON.stringify(info, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

// scripts/test-vps-api.ts
import fs from 'fs';
import path from 'path';

async function main() {
  const cookieFile = path.resolve(process.cwd(), 'data', 'acc1-cookies.json');
  const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf-8'));
  const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

  console.log(`Sending API request with ${cookies.length} cookies...`);
  const res = await fetch('https://game.granbluefantasy.jp/rest/mypage', {
    headers: {
      'Cookie': cookieHeader,
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': 'https://game.granbluefantasy.jp/',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    }
  });

  console.log('HTTP Status:', res.status);
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    console.log('API JSON Response:');
    console.log('  Nickname / Name:', json.user_name || json.player_name || json.nickname || json.status?.name);
    console.log('  User ID:', json.user_id || json.status?.user_id);
    console.log('  Rank:', json.level || json.status?.level);
    console.log('  Auth Status:', json.auth_status);
    console.log('  Full keys:', Object.keys(json).slice(0, 10).join(', '));
  } catch {
    console.log('Non-JSON response:', text.slice(0, 300));
  }
}

main().catch(console.error);

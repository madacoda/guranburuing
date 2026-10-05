// scripts/verify-profile-final.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { AccountAuthManager } from '../src/auth/account-auth.manager.js';
import { AccountConfig } from '../src/types/account.types.js';

async function main() {
  const cdp = new CdpConnectionManager();
  const conn = await cdp.connectWithRetry(3, 2000, true, {
    cdpPort: 9222,
    profileDir: '/var/www/acc1'
  });

  const page = conn.page;

  console.log('Navigating to #profile...');
  await page.goto('https://game.granbluefantasy.jp/#profile', { waitUntil: 'domcontentloaded' }).catch(() => null);
  await new Promise(r => setTimeout(r, 4000));

  const profile = await AccountAuthManager.getVerifiedProfile(page);
  console.log('Verified Profile Result:', JSON.stringify(profile, null, 2));

  await cdp.disconnect();
}

main().catch(console.error);

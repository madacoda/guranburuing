// src/cli/setup-account.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { AccountAuthManager } from '../auth/account-auth.manager.js';
import { AccountConfig } from '../types/account.types.js';

const args = process.argv.slice(2);
const accountId = args[0] || 'main';

const account = AccountRegistry.getAccountById(accountId);

if (!account) {
  console.error(`\n❌ Account [${accountId}] not found in accounts.config.json!`);
  console.log('Available accounts:', AccountRegistry.loadAccounts().map(a => a.id).join(', '));
  throw new Error(`Account [${accountId}] not found.`);
}

console.log('========================================================================');
console.log(`        Assisted Account Setup & Authentication Helper                  `);
console.log(`               Account: [${account.name}] (${account.id})              `);
console.log('========================================================================');
console.log(`Service:             ${account.service.toUpperCase()}`);
console.log(`CDP Port:            ${account.cdpPort}`);
console.log(`Profile Directory:   ${account.profileDir}`);
console.log(`Window Mode:         HEADFUL (Windowed for visual interaction)`);
console.log('========================================================================\n');

async function main(targetAccount: AccountConfig) {
  const cdp = new CdpConnectionManager();

  console.log(`Launching browser in Windowed mode on port ${targetAccount.cdpPort}...`);
  const conn = await cdp.connectWithRetry(6, 2000, false, {
    cdpPort: targetAccount.cdpPort,
    profileDir: targetAccount.profileDir,
    proxy: targetAccount.proxy
  });

  const page = conn.page;

  console.log(`Verifying in-game authentication on #profile...`);
  const profile = await AccountAuthManager.ensureAuthenticated(page, targetAccount);

  if (profile) {
    console.log('\n========================================================================');
    console.log(`🎉 SUCCESS: Account [${targetAccount.name}] Authenticated & Verified!`);
    console.log(`   In-Game Player:   ${profile.name}`);
    console.log(`   Player Rank:      ${profile.rank}`);
    console.log(`   Granblue User ID: ${profile.id}`);
    console.log(`   Profile Storage:  ${targetAccount.profileDir}`);
    console.log('========================================================================\n');
  } else {
    console.warn(`\n⚠️ Authentication could not be confirmed. Please check the browser.`);
  }

  await cdp.disconnect();
  process.exit(0);
}

main(account).catch(err => {
  console.error('Setup Error:', err);
  process.exit(1);
});

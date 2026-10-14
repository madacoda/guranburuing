#!/usr/bin/env bun
// src/cli/run-inventory-audit.ts
import { CdpConnectionManager } from '../cdp-connection.js';
import { AccountRegistry } from '../auth/account-registry.js';
import { inventoryAuditorService } from '../services/behavior/inventory-auditor.service.js';

async function main() {
  const args = process.argv.slice(2);
  const isOffline = args.includes('--offline') || args.includes('--cached');
  const isWindowed = args.includes('--windowed');

  const accountArg = args.find((a) => !a.startsWith('--'));
  const accountId = accountArg || 'acc1';

  const account = AccountRegistry.getAccount(accountId);
  if (!account) {
    console.error(`[Error] Account "${accountId}" not found in registry.`);
    process.exit(1);
  }

  console.log('========================================================================');
  console.log('       Granblue Fantasy - In-Game Inventory & Supply Auditor           ');
  console.log('========================================================================');
  console.log(`Target Account: ${account.name} (${account.id})`);
  console.log(`CDP Port:       ${account.cdpPort}`);
  console.log('========================================================================\n');

  if (isOffline) {
    console.log('[Audit CLI] --offline flag detected. Reading cached snapshot from disk...');
    const snapshot = inventoryAuditorService.getLatestSnapshot();
    if (!snapshot) {
      console.log('❌ No previous inventory snapshot found on disk.');
      process.exit(1);
    }
    console.log(inventoryAuditorService.formatSnapshotForDiscord(snapshot));
    process.exit(0);
  }

  const cdp = new CdpConnectionManager();

  try {
    console.log('[Audit CLI] Connecting to Chrome CDP session...');
    const { page } = await cdp.connectWithRetry(6, 2000, !isWindowed, {
      cdpPort: account.cdpPort,
      profileDir: account.profileDir
    });

    const result = await inventoryAuditorService.auditSupplies(page);
    console.log('\n' + inventoryAuditorService.formatSnapshotForDiscord(result.snapshot));
    console.log('\n✅ Audit completed successfully and saved to logs/inventory-audit.json & md.');

    await cdp.disconnect();
    process.exit(0);
  } catch (err: any) {
    console.error(`\n❌ Error during inventory audit: ${err.message}`);
    try { await cdp.disconnect(); } catch {}
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});

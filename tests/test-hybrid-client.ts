// tests/test-hybrid-client.ts
import { CdpConnectionManager } from '../src/cdp-connection.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { HybridApiClient } from '../src/engines/hybrid-client.js';

console.log('=====================================================');
console.log('       Testing Hybrid In-Page API Dispatcher         ');
console.log('=====================================================');

const cdp = new CdpConnectionManager();
const { page, browser } = await cdp.connectWithRetry();

const sentinel = new SentinelWatchdog(page);
await sentinel.assertSafe();

const hybrid = new HybridApiClient(page, sentinel);

// 1. Fetch User Status via Hybrid API
console.log('\n[1/2] Fetching User Status via page context fetch()...');
const status = await hybrid.getUserStatus();
console.log('✅ User Status Received:');
console.log(`- User ID: ${status.user_id}`);
console.log(`- Rank:    ${status.rank}`);
console.log(`- Level:   ${status.level}`);
console.log(`- AP:      ${status.now_ap} / ${status.max_ap}`);
console.log(`- EP:      ${status.now_ep} / ${status.max_ep}`);
console.log(`- Lupi:    ${status.lupi}`);
console.log(`- Crystals:${status.stone}`);

// 2. Validate Raid Code via Hybrid API
console.log('\n[2/2] Testing /rest/multiraid/quest_check with test code...');
const raidCheck = await hybrid.checkRaidCode('DEAD1234');
console.log('✅ Raid Check Response Received:');
console.log(`- Result:     ${raidCheck.result}`);
console.log(`- Error Type: ${raidCheck.error_type || 'none'}`);
console.log(`- Message:    ${raidCheck.message || 'ok'}`);

console.log('\n=====================================================');
console.log('🎉 Hybrid In-Page API tests PASSED successfully!');
console.log('=====================================================\n');

await browser.disconnect();
process.exit(0);

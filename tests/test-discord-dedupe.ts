import { discordDmRelay } from '../src/relay/discord-dm-relay.js';
import { AlertRelay } from '../src/alert-relay.js';
import { DropLogger } from '../src/engines/drop-logger.js';
import path from 'path';

console.log('Running Notification & Deduplication Unit Tests...');

// 1. Gold Bar DM Deduplication
const testRaidId = '99998888777';
const content1 = `🌟 **Gold Brick Drop Confirmed** 🌟\n• **Raid**: Test HL\n• **Raid ID**: \`${testRaidId}\`\n• **Battle Log**: https://game.granbluefantasy.jp/#result_multi/detail/${testRaidId}/1/0/0`;

if (discordDmRelay.isDuplicateAlert(content1)) {
  throw new Error('Initial alert should not be flagged as duplicate');
}

discordDmRelay.recordAlertDispatched(content1);

if (!discordDmRelay.isDuplicateAlert(content1)) {
  throw new Error('Identical alert should be detected as duplicate');
}

// Check with a slightly different wording referring to the same raid ID
const content2 = `GOLD BAR DROP CONFIRMED! • Raid: Test HL • Battle ID: ${testRaidId} • Log URL: https://game.granbluefantasy.jp/#result_multi/detail/${testRaidId}/1/0/0`;
if (!discordDmRelay.isDuplicateAlert(content2)) {
  throw new Error('Alternative wording referring to same raid ID should be detected as duplicate');
}
console.log('  ✅ [PASS] Discord DM Gold Bar deduplication by Raid ID verified');

// 2. CAPTCHA Deduplication
const captchaContent = '🚨 **CRITICAL: GBF CAPTCHA / VERIFICATION CHALLENGE DETECTED!**';
(discordDmRelay as any).activeCaptchaPrompt = true;

if (!discordDmRelay.isDuplicateAlert(captchaContent)) {
  throw new Error('CAPTCHA alert should be suppressed when another challenge prompt is active');
}
(discordDmRelay as any).activeCaptchaPrompt = false;
console.log('  ✅ [PASS] Discord DM CAPTCHA active prompt deduplication verified');

// 3. DropLogger Deduplication
const tempMd = path.resolve(process.cwd(), 'scratch/temp-dedupe-test.md');
const logger = new DropLogger(tempMd, 'Test HL');

let dmSentCount = 0;
// Mock discordDmRelay.sendMessage
const origSend = discordDmRelay.sendMessage;
(discordDmRelay as any).sendMessage = async () => {
  dmSentCount++;
  return { id: 'test', content: '', author: { id: 'b', username: 'b' }, timestamp: '' };
};

await logger.notifyGoldBarDrop({ raidId: testRaidId, honors: '1,000,000 pt', turns: 5 });
await logger.notifyGoldBarDrop({ raidId: testRaidId, honors: '1,000,000 pt', turns: 5 });

if (dmSentCount > 1) {
  throw new Error(`Expected at most 1 DM dispatch for raid ${testRaidId}, got ${dmSentCount}`);
}
console.log('  ✅ [PASS] DropLogger static raid deduplication verified');

// Restore original
(discordDmRelay as any).sendMessage = origSend;

console.log('🎉 All Notification Deduplication tests passed!\n');

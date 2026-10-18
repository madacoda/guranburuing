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

// 4. CAPTCHA Prompt Dispatch & Context Preservation (No Self-Suppression)
let dispatchedPromptContent = '';
let dispatchedForceFlag = false;

(discordDmRelay as any).sendMessage = async (content: string, att: any, def: any, key: any, force: boolean) => {
  dispatchedPromptContent = content;
  dispatchedForceFlag = Boolean(force);
  return { id: '123456789012345678', content, author: { id: 'b', username: 'b' }, timestamp: '' };
};

// Mock waitForReply so it returns immediately
const origWaitForReply = discordDmRelay.waitForReply;
(discordDmRelay as any).waitForReply = async (promptId: string) => {
  if (promptId === '123456789012345678') return 'TEST_CODE_123';
  return null;
};

const resolution = await discordDmRelay.requestCaptchaResolution(
  Buffer.from('dummy'),
  1000,
  undefined,
  {
    accountId: 'acc1',
    questName: 'GB Farm - Akasha HL',
    raidId: '46970569946',
    runNumber: 260,
    hpPct: 73,
    players: '2/18'
  }
);

if (resolution !== 'TEST_CODE_123') {
  throw new Error(`Expected resolution code 'TEST_CODE_123', got '${resolution}'`);
}
if (!dispatchedForceFlag) {
  throw new Error('CAPTCHA challenge prompt must be sent with force=true to prevent self-suppression!');
}
if (!dispatchedPromptContent.includes('• **Player**:') || !dispatchedPromptContent.includes('acc1')) {
  throw new Error('CAPTCHA prompt should contain Player metadata');
}
if (!dispatchedPromptContent.includes('• **Quest / Raid**: **GB Farm - Akasha HL**')) {
  throw new Error('CAPTCHA prompt should contain Quest / Raid metadata');
}
if (!dispatchedPromptContent.includes('• **Raid ID**: `46970569946`')) {
  throw new Error('CAPTCHA prompt should contain Raid ID metadata');
}
if (!dispatchedPromptContent.includes('• **Run**: `#260`')) {
  throw new Error('CAPTCHA prompt should contain Run number metadata');
}
console.log('  ✅ [PASS] CAPTCHA prompt delivery & context formatting (no self-suppression) verified');

// 5. Invalid Prompt ID Rejection in waitForReply (Prevents Discord API 400 Bad Request)
(discordDmRelay as any).waitForReply = origWaitForReply;
const invalidReplyResult1 = await discordDmRelay.waitForReply('deduped', 100);
if (invalidReplyResult1 !== null) {
  throw new Error('waitForReply should return null immediately when given "deduped"');
}
const invalidReplyResult2 = await discordDmRelay.waitForReply('', 100);
if (invalidReplyResult2 !== null) {
  throw new Error('waitForReply should return null immediately when given empty ID');
}
console.log('  ✅ [PASS] Invalid prompt ID rejection in waitForReply verified');

// Restore original
(discordDmRelay as any).sendMessage = origSend;

// 6. Test Mode Anti-Spam Single-Message Limit Verification
const { DiscordDmRelay } = await import('../src/relay/discord-dm-relay.js');
DiscordDmRelay.resetTestMessageCounter();
const prevEnv = process.env.NODE_ENV;
const prevLimit = process.env.DISCORD_MAX_TEST_MESSAGES;
process.env.NODE_ENV = 'test';
process.env.DISCORD_MAX_TEST_MESSAGES = '1';

// First call in test mode: records single allowed message slot
const testRes1 = await discordDmRelay.sendMessage('Test Message 1');
if (DiscordDmRelay.getTestMessageCount() !== 1) {
  throw new Error(`Expected test message count to be 1, got ${DiscordDmRelay.getTestMessageCount()}`);
}

// Second call in test mode: must be intercepted by anti-spam guard and suppressed!
const testRes2 = await discordDmRelay.sendMessage('Test Message 2');
if (!testRes2.id.startsWith('test-suppressed-')) {
  throw new Error(`Expected testRes2 to be suppressed by anti-spam guard, got ID: ${testRes2.id}`);
}
if (DiscordDmRelay.getTestMessageCount() !== 1) {
  throw new Error(`Expected test message count to stay capped at 1, got ${DiscordDmRelay.getTestMessageCount()}`);
}

// Third call with DISCORD_MAX_TEST_MESSAGES = 0: must immediately suppress
process.env.DISCORD_MAX_TEST_MESSAGES = '0';
const testRes3 = await discordDmRelay.sendMessage('Test Message 3');
if (!testRes3.id.startsWith('test-suppressed-')) {
  throw new Error(`Expected testRes3 to be suppressed when limit=0, got ID: ${testRes3.id}`);
}

// Cleanup
DiscordDmRelay.resetTestMessageCounter();
process.env.NODE_ENV = prevEnv;
if (prevLimit !== undefined) {
  process.env.DISCORD_MAX_TEST_MESSAGES = prevLimit;
} else {
  delete process.env.DISCORD_MAX_TEST_MESSAGES;
}
console.log('  ✅ [PASS] Test-mode anti-spam single message limit (max 1 dispatch) verified');

console.log('🎉 All Notification Deduplication tests passed!\n');
process.exit(0);


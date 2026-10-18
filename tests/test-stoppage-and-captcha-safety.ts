// tests/test-stoppage-and-captcha-safety.ts
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { AlertRelay } from '../src/alert-relay.js';
import { ProcessRunnerService } from '../src/services/discord/process-runner.service.js';
import { DiscordCommandGatewayService } from '../src/services/discord/discord-command-gateway.service.js';
import { discordDmRelay } from '../src/relay/discord-dm-relay.js';

console.log('========================================================================');
console.log('    Test: Mid-Execution Stoppage & Non-Logout CAPTCHA Timeout Safety    ');
console.log('========================================================================\n');

// 1. Test Sentinel Watchdog CAPTCHA timeout behavior:
// Must NOT call logout, must return safely to homescreen (#mypage), must alert Discord.
let navigatedUrl = '';
let logoutCalled = false;

const mockPage = {
  url: () => 'https://game.granbluefantasy.jp/#quest/verification',
  frames: () => [],
  evaluate: async () => true, // Simulate CAPTCHA challenge present
  $: async (sel: string) => {
    if (sel.includes('logout')) logoutCalled = true;
    return { sel };
  },
  screenshot: async () => Buffer.from('dummy'),
  bringToFront: async () => {},
  goto: async (url: string) => {
    navigatedUrl = url;
  }
} as any;

let dispatchedDiscordMessage = '';
const originalSendMessage = discordDmRelay.sendMessage;
discordDmRelay.sendMessage = async (content: string) => {
  dispatchedDiscordMessage = content;
  return { id: 'mock_msg_id', channel_id: 'mock_chan', content } as any;
};

try {
  const sentinel = new SentinelWatchdog(mockPage, new AlertRelay(), {
    enableTwoWayDiscord: false,
    skipBrowserWaitOnHalt: false,
    browserWaitTimeoutMs: 200 // Fast timeout for test
  });

  sentinel.setSessionContext({
    accountId: 'acc1',
    playerName: '『Hamada』',
    questName: 'Akasha HL'
  });

  const solved = await sentinel.waitForUserToSolveCaptcha(200);

  if (solved !== false) {
    throw new Error('Expected waitForUserToSolveCaptcha to return false on timeout.');
  }

  if (logoutCalled) {
    throw new Error('CRITICAL FAILURE: Logout was triggered during CAPTCHA timeout!');
  }
  console.log('  ✅ [PASS] No logout triggered during CAPTCHA timeout.');

  if (!navigatedUrl.includes('#mypage')) {
    throw new Error(`Expected navigation to #mypage, but got: ${navigatedUrl}`);
  }
  console.log(`  ✅ [PASS] Browser safely navigated to homescreen (${navigatedUrl}).`);

  if (!dispatchedDiscordMessage.includes('CAPTCHA Wait Timed Out') || !dispatchedDiscordMessage.includes('NOT logged out')) {
    throw new Error(`Discord DM message missing critical stoppage reason: ${dispatchedDiscordMessage}`);
  }
  console.log('  ✅ [PASS] Discord DM alerted operator that automation stopped with non-logout session preservation.');

} finally {
  discordDmRelay.sendMessage = originalSendMessage;
}

// 2. Test ProcessRunner & Discord Gateway diagnostic stoppage reason formatting
console.log('\n[Test 2] Testing Stoppage Reason Diagnostics in notifyJobCompletion...');

const gateway = new DiscordCommandGatewayService();
let lastGatewayNotification = '';
discordDmRelay.sendMessage = async (content: string) => {
  lastGatewayNotification = content;
  return { id: 'mock_msg_2', channel_id: 'mock_chan', content } as any;
};

try {
  // Scenario A: Operator stopped mid-run
  const operatorStoppedJob = {
    key: 'leech:leviathan',
    script: 'src/cli/run-leech.ts',
    args: ['src/cli/run-leech.ts', 'leviathan-mare'],
    pid: 12345,
    startedAt: new Date(Date.now() - 30000),
    process: {} as any,
    outputBuffer: ['[Workflow] In combat...', '[ProcessRunner] 🛑 Terminating job `leech:leviathan`...'],
    stoppedByOperator: true
  };
  await (gateway as any).notifyJobCompletion(operatorStoppedJob, null, 30000);
  if (!lastGatewayNotification.includes('Operator Cancelled') || !lastGatewayNotification.includes('/gbf stop')) {
    throw new Error(`Failed to diagnose operator stoppage: ${lastGatewayNotification}`);
  }
  console.log('  ✅ [PASS] Operator /gbf stop diagnosed and reported clearly.');

  // Scenario B: CAPTCHA timed out mid-run
  const captchaStoppedJob = {
    key: 'gb-akasha',
    script: 'src/cli/run-workflow.ts',
    args: ['src/cli/run-workflow.ts', 'gb-akasha'],
    pid: 12346,
    startedAt: new Date(Date.now() - 600000),
    process: {} as any,
    outputBuffer: [
      '[Sentinel] 🤖 [Attempt 1/5] Capturing CAPTCHA artifacts...',
      '[Sentinel] ❌ Captcha wait timed out after 10 minutes.',
      '[Sentinel] 🏠 Safely navigating browser to homescreen (#mypage) without logout...'
    ],
    stoppedByOperator: false
  };
  await (gateway as any).notifyJobCompletion(captchaStoppedJob, 1, 600000);
  if (!lastGatewayNotification.includes('CAPTCHA Challenge Timed Out') || !lastGatewayNotification.includes('NOT logged out')) {
    throw new Error(`Failed to diagnose CAPTCHA halt: ${lastGatewayNotification}`);
  }
  console.log('  ✅ [PASS] CAPTCHA timeout halt diagnosed with non-logout preservation.');

  // Scenario C: Session expired mid-run
  const sessionExpiredJob = {
    key: 'daily',
    script: 'src/cli/run-daily.ts',
    args: ['src/cli/run-daily.ts'],
    pid: 12347,
    startedAt: new Date(Date.now() - 5000),
    process: {} as any,
    outputBuffer: [
      '[Auth] Verifying active session for account [acc1]...',
      '[Auth] ⚠️ Account [acc1] session has expired or requires re-authentication.'
    ],
    stoppedByOperator: false
  };
  await (gateway as any).notifyJobCompletion(sessionExpiredJob, 1, 5000);
  if (!lastGatewayNotification.includes('Session Expired') || !lastGatewayNotification.includes('session:sync')) {
    throw new Error(`Failed to diagnose session expiry: ${lastGatewayNotification}`);
  }
  console.log('  ✅ [PASS] Session expiry diagnosed with sync recommendations.');

} finally {
  discordDmRelay.sendMessage = originalSendMessage;
}

console.log('\n========================================================================');
console.log('🎉 ALL MID-EXECUTION STOPPAGE & CAPTCHA SAFETY TESTS PASSED (100%)');
console.log('========================================================================\n');

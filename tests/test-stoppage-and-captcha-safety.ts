// tests/test-stoppage-and-captcha-safety.ts
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { AlertRelay } from '../src/alert-relay.js';
import { ProcessRunnerService } from '../src/services/discord/process-runner.service.js';
import { DiscordCommandGatewayService } from '../src/services/discord/discord-command-gateway.service.js';
import { discordDmRelay } from '../src/relay/discord-dm-relay.js';
import { CdpConnectionManager } from '../src/cdp-connection.js';

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

// 3. Test CDP Renderer Freeze Watchdog (Runtime.callFunctionOn timed out auto-recovery & forwarding)
console.log('\n[Test 3] Testing CDP Renderer Freeze Watchdog & Timeout Cascade Prevention...');
{
  if (!CdpConnectionManager.isProtocolTimeoutError(new Error('Runtime.callFunctionOn timed out. Increase the protocolTimeout setting'))) {
    throw new Error('Expected isProtocolTimeoutError to detect Runtime.callFunctionOn timed out.');
  }
  if (CdpConnectionManager.isProtocolTimeoutError(new Error('Execution context was destroyed'))) {
    throw new Error('Expected isProtocolTimeoutError to return false for normal context destruction.');
  }
  console.log('  ✅ [PASS] CdpConnectionManager.isProtocolTimeoutError accurately classifies protocol timeouts.');

  const cdp = new CdpConnectionManager();
  let newPageEvaluateCalls = 0;

  const recoveredPage = {
    isClosed: () => false,
    url: () => 'https://game.granbluefantasy.jp/#quest/assist',
    evaluate: async () => {
      newPageEvaluateCalls++;
      return 'RECOVERED_OK';
    }
  } as any;

  let stuckPageEvaluateCalls = 0;
  const stuckPage = {
    isClosed: () => false,
    url: () => 'https://game.granbluefantasy.jp/#result_multi/empty/47051305342',
    evaluate: async () => {
      stuckPageEvaluateCalls++;
      throw new Error("Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.");
    }
  } as any;

  let recoveryTriggered = 0;
  cdp.recoverFrozenRenderer = async () => {
    recoveryTriggered++;
    (cdp as any).gbfPage = recoveredPage;
    cdp.installRendererFreezeWatchdog(recoveredPage, 9222);
    return recoveredPage;
  };

  (cdp as any).gbfPage = stuckPage;
  cdp.installRendererFreezeWatchdog(stuckPage, 9222);

  // First call on stuckPage hits Runtime.callFunctionOn timed out -> triggers recoverFrozenRenderer -> retries on recoveredPage
  const res1 = await stuckPage.evaluate(() => window.location.hash);
  // Second call on old stuckPage reference (simulating in-flight handleConfirmResult loop) must forward directly to recoveredPage without hitting stuckPage!
  const res2 = await stuckPage.evaluate(() => window.location.hash);

  if (recoveryTriggered !== 1) {
    throw new Error(`Expected recoverFrozenRenderer to be called once, got ${recoveryTriggered}`);
  }
  if (stuckPageEvaluateCalls !== 1) {
    throw new Error(`Expected stuckPage original evaluate to only be called once before forwarding, got ${stuckPageEvaluateCalls}`);
  }
  if (res1 !== 'RECOVERED_OK' || res2 !== 'RECOVERED_OK' || newPageEvaluateCalls !== 2) {
    throw new Error(`Expected both evaluate calls to resolve via recoveredPage (res1=${res1}, res2=${res2}, calls=${newPageEvaluateCalls})`);
  }
  console.log('  ✅ [PASS] Renderer freeze watchdog recovers on first timeout and forwards subsequent evaluate calls without hanging.');
}

// 4. Test Browser Standby Mode (closing GBF tabs into about:blank while preserving verification challenges)
console.log('\n[Test 4] Testing Browser Standby Mode (putPortOnStandby & verification preservation)...');
{
  const originalFetch = globalThis.fetch;
  const closedTargetIds: string[] = [];
  let openedNewBlank = false;

  try {
    // Case A: Normal GBF tab open -> opens about:blank and closes GBF tab
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes('/json/list')) {
        return {
          ok: true,
          json: async () => [
            { id: 'gbf-tab-1', type: 'page', url: 'https://game.granbluefantasy.jp/#mypage' }
          ]
        } as any;
      }
      if (url.includes('/json/new?about:blank')) {
        openedNewBlank = true;
        return { ok: true, json: async () => ({ id: 'blank-1', type: 'page', url: 'about:blank' }) } as any;
      }
      if (url.includes('/json/close/')) {
        closedTargetIds.push(url.split('/json/close/')[1]);
        return { ok: true } as any;
      }
      return { ok: false } as any;
    }) as any;

    const stoodBy = await CdpConnectionManager.putPortOnStandby(19222, true);
    if (!stoodBy || !openedNewBlank || !closedTargetIds.includes('gbf-tab-1')) {
      throw new Error(`Expected putPortOnStandby to open about:blank and close gbf-tab-1 (stoodBy=${stoodBy}, openedNewBlank=${openedNewBlank}, closed=${closedTargetIds.join(',')})`);
    }
    console.log('  ✅ [PASS] putPortOnStandby opens about:blank standby tab and closes active GBF renderer tab.');

    // Case B: Active CAPTCHA verification tab -> preserves tab for operator
    closedTargetIds.length = 0;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes('/json/list')) {
        return {
          ok: true,
          json: async () => [
            { id: 'gbf-captcha-tab', type: 'page', url: 'https://game.granbluefantasy.jp/#quest/verification' }
          ]
        } as any;
      }
      if (url.includes('/json/close/')) {
        closedTargetIds.push(url.split('/json/close/')[1]);
        return { ok: true } as any;
      }
      return { ok: true } as any;
    }) as any;

    const preserved = await CdpConnectionManager.putPortOnStandby(19222, true);
    if (preserved !== false || closedTargetIds.length !== 0) {
      throw new Error('Expected putPortOnStandby to preserve active verification tab without closing it.');
    }
    console.log('  ✅ [PASS] putPortOnStandby safely preserves active CAPTCHA verification tab.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('\n========================================================================');
console.log('🎉 ALL MID-EXECUTION STOPPAGE & CAPTCHA SAFETY TESTS PASSED (100%)');
console.log('========================================================================\n');

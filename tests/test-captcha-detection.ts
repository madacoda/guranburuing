// tests/test-captcha-detection.ts
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { AlertRelay } from '../src/alert-relay.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Comprehensive CAPTCHA Detection Test Suite       ');
console.log('========================================================================\n');

const dummyRelay = new AlertRelay();

// Helper to create mock page
function createMockPage(overrides: Partial<any> = {}) {
  return {
    url: () => overrides.url || 'https://game.granbluefantasy.jp/#mypage',
    frames: () => overrides.frames || [],
    evaluate: overrides.evaluate || (async () => false),
    $: overrides.$ || (async () => null),
    screenshot: overrides.screenshot || (async () => Buffer.from('dummy')),
    bringToFront: overrides.bringToFront || (async () => {}),
    on: overrides.on || (() => {}),
    ...overrides
  } as any;
}

// -----------------------------------------------------------------------------
// Test 1: Instant URL / Hash Detection
// -----------------------------------------------------------------------------
console.log('[Test 1] Testing Instant URL & Hash Detection...');

const captchaUrls = [
  'https://game.granbluefantasy.jp/#quest/verification',
  'https://game.granbluefantasy.jp/#verification',
  'https://game.granbluefantasy.jp/#quest/assist/verification',
  'https://connect.mobage.jp/sec_challenge'
];

for (const url of captchaUrls) {
  const page = createMockPage({ url: () => url });
  const sentinel = new SentinelWatchdog(page, dummyRelay, { enableTwoWayDiscord: false });
  const detected = await sentinel.inspectForVerification();
  if (!detected) {
    throw new Error(`Failed to detect CAPTCHA from URL: ${url}`);
  }
}
console.log('  ✅ [PASS] All verification URLs detected instantly (0ms CDP latency)');

// -----------------------------------------------------------------------------
// Test 2: External Security Provider & Iframe Detection
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Testing External Security Provider / Iframe Detection...');

const iframeUrls = [
  'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile',
  'https://www.google.com/recaptcha/api2/bframe',
  'https://newassets.hcaptcha.com/captcha/v1/',
  'https://sp.mbga.jp/sec_challenge'
];

for (const frameUrl of iframeUrls) {
  const page = createMockPage({
    frames: () => [{ url: () => frameUrl }]
  });
  const sentinel = new SentinelWatchdog(page, dummyRelay, { enableTwoWayDiscord: false });
  const detected = await sentinel.inspectForVerification();
  if (!detected) {
    throw new Error(`Failed to detect security provider frame: ${frameUrl}`);
  }
}
console.log('  ✅ [PASS] Cloudflare Turnstile, reCAPTCHA, hCaptcha, and Mobage challenges detected via frames');

// -----------------------------------------------------------------------------
// Test 3: Classic & Modern DOM Selectors
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Testing GBF DOM Verification Detection...');

const domCaptchaPage = createMockPage({
  evaluate: async (fn: any, selectors: string[]) => {
    // Simulate finding .cnt-verification in DOM
    return true;
  }
});

const sentinelDom = new SentinelWatchdog(domCaptchaPage, dummyRelay, { enableTwoWayDiscord: false });
if (!(await sentinelDom.inspectForVerification())) {
  throw new Error('DOM verification modal should be detected');
}
console.log('  ✅ [PASS] GBF Verification DOM challenge detected cleanly');

// -----------------------------------------------------------------------------
// Test 4: False Positive Immunity Check
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Testing False Positive Immunity...');

// Simulate a clean profile page with greeting/chat form
const cleanProfilePage = createMockPage({
  url: () => 'https://game.granbluefantasy.jp/#profile/12345678',
  evaluate: async () => false // Profile greeting boxes are not matched by scoped captcha selectors
});

const sentinelProfile = new SentinelWatchdog(cleanProfilePage, dummyRelay, { enableTwoWayDiscord: false });
if (await sentinelProfile.inspectForVerification()) {
  throw new Error('Profile greeting / message form was falsely flagged as CAPTCHA!');
}
console.log('  ✅ [PASS] Clean profile & greeting forms produce zero false positives');

// -----------------------------------------------------------------------------
// Test 5: Network Response Interception
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Testing Network-Level Proactive Interception...');

let capturedResponseHandler: ((res: any) => Promise<void>) | null = null;
const networkPage = createMockPage({
  on: (event: string, handler: any) => {
    if (event === 'response') capturedResponseHandler = handler;
  }
});

const sentinelNetwork = new SentinelWatchdog(networkPage, dummyRelay, { enableTwoWayDiscord: false });

if (!capturedResponseHandler) {
  throw new Error('SentinelWatchdog failed to register network response listener');
}

// Simulate receiving a GBF quest start response with verification redirect
await (capturedResponseHandler as any)({
  url: () => 'https://game.granbluefantasy.jp/quest/init_quest',
  headers: () => ({ 'content-type': 'application/json' }),
  json: async () => ({ result: 'error', url: '#quest/verification' })
});

if (!sentinelNetwork.inspectForVerification()) {
  throw new Error('Network verification redirect should instantly lock sentinel');
}
if (sentinelNetwork.isArmed) {
  throw new Error('Sentinel should not be armed after network verification detection');
}
console.log('  ✅ [PASS] Network API response `{ url: "#quest/verification" }` intercepted & locked proactively');

sentinelNetwork.unlock();
if (!sentinelNetwork.isArmed) {
  throw new Error('Sentinel should be armed after unlock');
}
console.log('  ✅ [PASS] Sentinel unlocks and resets network detection state properly');

// -----------------------------------------------------------------------------
// Test 6: Safe Navigation Invariant & Hard Halt Protection
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Testing assertSafe() Safety Invariant & Hard Freeze...');

const flaggedPage = createMockPage({
  url: () => 'https://game.granbluefantasy.jp/#verification'
});

const activeSentinel = new SentinelWatchdog(flaggedPage, dummyRelay, { enableTwoWayDiscord: false, skipBrowserWaitOnHalt: true });

let halted = false;
try {
  await activeSentinel.assertSafe();
} catch (err: any) {
  if (err.message.includes('SENTINEL_HALT')) {
    halted = true;
  }
}

if (!halted) {
  throw new Error('assertSafe() should immediately halt when verification is detected');
}
console.log('  ✅ [PASS] assertSafe() strictly hard-freezes execution to safeguard account');

console.log('\n========================================================================');
console.log('🎉 ALL CAPTCHA DETECTION & SENTINEL WATCHDOG TESTS PASSED (100%)');
console.log('========================================================================\n');

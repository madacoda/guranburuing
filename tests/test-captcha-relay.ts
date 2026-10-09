// tests/test-captcha-relay.ts
import assert from 'assert';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { AlertRelay } from '../src/alert-relay.js';
import { discordDmRelay } from '../src/relay/discord-dm-relay.js';

console.log('========================================================================');
console.log('       Granblue Fantasy CAPTCHA Relay & Two-Way Resolution Test Suite    ');
console.log('========================================================================\n');

const dummyRelay = new AlertRelay();

function createMockPage(overrides: Partial<any> = {}) {
  let innerHtml = overrides.html || '';
  return {
    url: () => overrides.url || 'https://game.granbluefantasy.jp/#quest/supporter/12345',
    frames: () => overrides.frames || [],
    evaluate: overrides.evaluate || (async () => false),
    $: overrides.$ || (async () => null),
    screenshot: overrides.screenshot || (async () => Buffer.from('mock-png-buffer-of-full-viewport-context-320x640')),
    bringToFront: overrides.bringToFront || (async () => {}),
    on: overrides.on || (() => {}),
    keyboard: {
      down: async () => {},
      up: async () => {},
      press: async () => {},
      type: async (text: string) => {
        overrides.typedText = (overrides.typedText || '') + text;
      }
    },
    mouse: {
      click: async (x: number, y: number) => {
        overrides.mouseClicked = { x, y };
      }
    },
    touchscreen: {
      tap: async (x: number, y: number) => {
        overrides.touchTapped = { x, y };
      }
    },
    ...overrides
  } as any;
}

// -----------------------------------------------------------------------------
// Test 1: Artifact Capture Integrity (No mobacoin crop, pristine full viewport)
// -----------------------------------------------------------------------------
console.log('[Test 1] Testing CAPTCHA Artifact Capture Integrity...');

const mockPage1 = createMockPage({
  screenshot: async () => Buffer.from('pristine-viewport-screenshot')
});
const sentinel1 = new SentinelWatchdog(mockPage1, dummyRelay, { enableTwoWayDiscord: false });

const artifacts = await sentinel1.captureCaptchaArtifacts();
assert(artifacts.fullScreenshot && artifacts.fullScreenshot.length > 0, 'fullScreenshot must be present');
assert.strictEqual(artifacts.puzzleCrop, undefined, 'puzzleCrop must NOT be generated or attached (mobacoin crop bug eliminated)');
console.log('  ✅ [PASS] Full viewport captured; invalid 20x20 puzzle crop eliminated cleanly');

// -----------------------------------------------------------------------------
// Test 2: Text Input Challenge Submission & "Send" Button Detection
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Testing Text CAPTCHA Submission & Send Button Click...');

let buttonClicked = false;
let enteredVal = '';
let evalCount = 0;
const mockPage2 = createMockPage({
  evaluate: async (fn: any, arg?: any) => {
    evalCount++;
    if (evalCount === 1) {
      // Tile check -> false
      return false;
    }
    if (evalCount === 2) {
      // Text input challenge evaluate
      enteredVal = arg;
      buttonClicked = true;
      return {
        foundInput: true,
        buttonClicked: true,
        btnBox: { x: 220, y: 350, width: 80, height: 32 }
      };
    }
    // dismissErrorAlertIfPresent and other checks -> false
    return false;
  },
  $: async (sel: string) => {
    return {
      click: async () => {},
      focus: async () => {}
    };
  }
});

const sentinel2 = new SentinelWatchdog(mockPage2, dummyRelay, { enableTwoWayDiscord: false });

// Simulate modal being present during submission, then dismissed
let pollCount = 0;
sentinel2.inspectForVerification = async () => {
  pollCount++;
  // Dismissed after 2 checks
  return pollCount < 2;
};

const submitSuccess = await sentinel2.submitCaptchaCode('g4h65f');
assert.strictEqual(submitSuccess, true, 'submitCaptchaCode should succeed when modal dismisses');
assert.strictEqual(enteredVal, 'g4h65f', 'Correct captcha code must be passed to input');
assert.strictEqual(buttonClicked, true, 'Send button must be clicked');
console.log('  ✅ [PASS] Input typing & Send button coordinates triggered successfully');

// -----------------------------------------------------------------------------
// Test 3: Anti-Deadlock Live Inspection Check
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Testing Anti-Deadlock Live Inspection...');

const mockPage3 = createMockPage({
  url: () => 'https://game.granbluefantasy.jp/#quest/supporter/12345',
  evaluate: async () => false // Modal is gone
});

const sentinel3 = new SentinelWatchdog(mockPage3, dummyRelay, { enableTwoWayDiscord: false });

// Manually trigger lock
(sentinel3 as any).isLocked = true;

// With the bug, inspectForVerification() returned true because isLocked was true!
// With our fix, inspectForVerification(true) checks the live DOM and returns false!
const isPresentLive = await sentinel3.inspectForVerification(true);
assert.strictEqual(isPresentLive, false, 'inspectForVerification(true) must check live DOM/URL and return false when modal is gone');
console.log('  ✅ [PASS] Circular lock deadlock eliminated: live DOM state correctly reflects dismissal');

// -----------------------------------------------------------------------------
// Test 4: Failed Code Retry Cycle & Input Clearing
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Testing Failed Code Handling & Input Clearing for Subsequent Attempts...');

let cleared = false;
const mockPage4 = createMockPage({
  evaluate: async (fn: any) => {
    cleared = true;
    return true;
  }
});
const sentinel4 = new SentinelWatchdog(mockPage4, dummyRelay, { enableTwoWayDiscord: false });

await sentinel4.clearCaptchaInput();
assert.strictEqual(cleared, true, 'clearCaptchaInput must evaluate and wipe lingering text');
console.log('  ✅ [PASS] Lingering input text cleared to guarantee fresh screenshot on retry');

// -----------------------------------------------------------------------------
// Test 5: Discord DM Single Attachment Format
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Testing Discord DM Single High-Clarity Attachment Format...');

let sentAttachments: any = null;
const originalSendMessage = discordDmRelay.sendMessage.bind(discordDmRelay);
(discordDmRelay as any).sendMessage = async (_content: string, attachments: any) => {
  sentAttachments = attachments;
  return { id: '123456789012345678', content: _content, author: { id: 'bot', username: 'GBF' }, timestamp: '' };
};

// Dispatch challenge resolution request with single viewport
await discordDmRelay.requestCaptchaResolution(
  { fullScreenshot: Buffer.from('viewport-png') },
  50,
  async () => true // resolve early
);

assert(Array.isArray(sentAttachments), 'Attachments must be an array');
assert.strictEqual(sentAttachments.length, 1, 'Only 1 attachment must be sent (no mobacoin crop clutter)');
assert.strictEqual(sentAttachments[0].filename, 'captcha-challenge.png', 'Attachment filename must be captcha-challenge.png');
console.log('  ✅ [PASS] Discord DM receives single high-resolution captcha-challenge.png without clutter');

// Restore
(discordDmRelay as any).sendMessage = originalSendMessage;

console.log('\n========================================================================');
console.log('🎉 ALL CAPTCHA RELAY & RESOLUTION TESTS PASSED (100%)');
console.log('========================================================================\n');

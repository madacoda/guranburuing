// tests/test-captcha-relay.ts
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';
import { AlertRelay } from '../src/alert-relay.js';
import { discordDmRelay } from '../src/relay/discord-dm-relay.js';
import { CaptchaRelayStorageService } from '../src/services/telemetry/captcha-relay-storage.service.js';

const testTempRoot = path.resolve(process.cwd(), 'scratch/test-captcha-relay-storage');
if (fs.existsSync(testTempRoot)) {
  fs.rmSync(testTempRoot, { recursive: true, force: true });
}
const testRelayStorage = new CaptchaRelayStorageService({
  artifactsDir: path.join(testTempRoot, 'artifacts'),
  scratchDir: path.join(testTempRoot, 'scratch'),
  logsDir: path.join(testTempRoot, 'logs')
});
discordDmRelay.setRelayStorage(testRelayStorage);

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

// -----------------------------------------------------------------------------
// Test 6: Strict /gbf Prefix & Input Format Filtering in waitForReply
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Testing Strict /gbf Prefix & Input Validation in CAPTCHA Reply Listener...');
{
  // Rejects casual chat without /gbf prefix or invalid multi-word input
  assert.strictEqual(discordDmRelay.parseCaptchaReply('gold bar dropped'), null, 'Must ignore casual chat without /gbf prefix');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('8392'), null, 'Must ignore bare code without /gbf prefix');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('halt'), null, 'Must ignore bare halt without /gbf prefix');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf gold bar dropped'), null, 'Must ignore invalid multi-word prose even with /gbf prefix');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf status'), null, 'Must ignore /gbf status controller command');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf daily'), null, 'Must ignore /gbf daily controller command');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf gb-akasha'), null, 'Must ignore /gbf gb-akasha preset command');

  // Accepts valid /gbf prefixed player inputs
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf g4h65f'), 'g4h65f', 'Must extract valid alphanumeric code');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf 8392'), '8392', 'Must extract valid numeric code');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf 1 3'), '1 3', 'Must extract valid tile grid indices');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf captcha g4h65f'), 'g4h65f', 'Must extract code from explicit /gbf captcha subcommand');
  assert.strictEqual(discordDmRelay.parseCaptchaReply('/gbf halt'), 'HALT_REQUESTED', 'Must recognize /gbf halt as HALT_REQUESTED');

  // Simulate polling DM messages where "gold bar dropped" and "/gbf status" precede "/gbf g4h65f"
  const origFetch = globalThis.fetch;
  const origIsConfigured = discordDmRelay.isConfigured.bind(discordDmRelay);
  const origGetDmChannelId = discordDmRelay.getDmChannelId.bind(discordDmRelay);
  const targetUserId = (await import('../src/config.js')).config.DISCORD_USER_ID || 'test-user';

  (discordDmRelay as any).isConfigured = () => true;
  (discordDmRelay as any).getDmChannelId = async () => 'mock_dm_chan';

  try {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify([
          {
            id: '100000000000000001',
            content: 'gold bar dropped',
            author: { id: targetUserId, username: 'Player', bot: false },
            timestamp: '2026-11-09T10:00:01.000Z'
          },
          {
            id: '100000000000000002',
            content: '/gbf status',
            author: { id: targetUserId, username: 'Player', bot: false },
            timestamp: '2026-11-09T10:00:02.000Z'
          },
          {
            id: '100000000000000003',
            content: '/gbf g4h65f',
            author: { id: targetUserId, username: 'Player', bot: false },
            timestamp: '2026-11-09T10:00:03.000Z'
          }
        ]),
        { status: 200 }
      );
    }) as any;

    const reply = await discordDmRelay.waitForReply('123456789012345678', 500, 10);
    assert.strictEqual(reply, 'g4h65f', 'waitForReply must skip "gold bar dropped" and "/gbf status" and resolve to "g4h65f"');
    console.log('  ✅ [PASS] waitForReply ignores "gold bar dropped" & controller commands, listening strictly to valid /gbf player input');
  } finally {
    globalThis.fetch = origFetch;
    (discordDmRelay as any).isConfigured = origIsConfigured;
    (discordDmRelay as any).getDmChannelId = origGetDmChannelId;
  }
}

// -----------------------------------------------------------------------------
// Test 7: Saving /gbf <code> with ALL Images (Viewport, Puzzle, Modal, Tiles)
// -----------------------------------------------------------------------------
console.log('\n[Test 7] Testing Discord /gbf <code> Relay Persistence with All Images...');
{
  const dummyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const dummyDataUrl = `data:image/png;base64,${dummyPngB64}`;

  const mockMultiImagePage = createMockPage({
    screenshot: async () => Buffer.from('full-viewport-image-bytes'),
    evaluate: async (fn: any) => {
      const fnStr = fn.toString();
      if (fnStr.includes('candidateSelectors')) {
        return [
          {
            label: 'puzzle',
            dataUrl: dummyDataUrl,
            width: 220,
            height: 80,
            src: 'https://game.granbluefantasy.jp/c/i?t=123'
          },
          {
            label: 'tile-1',
            dataUrl: dummyDataUrl,
            width: 64,
            height: 64,
            src: 'https://game.granbluefantasy.jp/c/i?tile=1'
          }
        ];
      }
      return true;
    },
    $: async () => ({
      screenshot: async () => Buffer.from('modal-container-image-bytes')
    })
  });

  const sentinelMulti = new SentinelWatchdog(mockMultiImagePage, dummyRelay, { enableTwoWayDiscord: true });
  const multiArtifacts = await sentinelMulti.captureCaptchaArtifacts();

  assert(Array.isArray(multiArtifacts.allImages), 'allImages array must be populated');
  assert.strictEqual(multiArtifacts.allImages!.length, 4, 'Must capture viewport, puzzle, tile-1, and modal images');

  const origFetch = globalThis.fetch;
  const origIsConfigured = discordDmRelay.isConfigured.bind(discordDmRelay);
  const origGetDmChannelId = discordDmRelay.getDmChannelId.bind(discordDmRelay);
  const origSendMessage = discordDmRelay.sendMessage.bind(discordDmRelay);
  const targetUserId = (await import('../src/config.js')).config.DISCORD_USER_ID || 'test-user';

  (discordDmRelay as any).isConfigured = () => true;
  (discordDmRelay as any).getDmChannelId = async () => 'mock_dm_chan';
  (discordDmRelay as any).sendMessage = async (_content: string) => ({
    id: '223456789012345678',
    content: _content,
    author: { id: 'bot', username: 'GBF' },
    timestamp: new Date().toISOString()
  });

  try {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify([
          {
            id: '200000000000000099',
            content: '/gbf k9m4x2',
            author: { id: targetUserId, username: 'Player', bot: false },
            timestamp: '2026-11-24T00:10:00.000Z'
          }
        ]),
        { status: 200 }
      );
    }) as any;

    const codeReply = await discordDmRelay.requestCaptchaResolution(
      multiArtifacts,
      500,
      undefined,
      {
        accountId: 'acc1',
        playerName: 'Gran',
        questName: 'Akasha HL',
        raidId: '47208148161',
        runNumber: 7,
        attempt: 1,
        maxAttempts: 5
      }
    );

    assert.strictEqual(codeReply, 'k9m4x2', 'Must resolve /gbf k9m4x2');

    // Update verification status to true (as SentinelWatchdog does after submitCaptchaCode)
    const updatedRecord = discordDmRelay.updateLastSavedRelayVerification(true);
    assert(updatedRecord !== null, 'Saved relay record must exist');
    assert.strictEqual(updatedRecord!.code, 'k9m4x2', 'Saved record must preserve exact code');
    assert.strictEqual(updatedRecord!.rawMessage, '/gbf k9m4x2', 'Saved record must preserve raw Discord command');
    assert.strictEqual(updatedRecord!.verified, true, 'Saved record must reflect verified status');
    assert.strictEqual(updatedRecord!.images.length, 4, 'All 4 images (viewport, puzzle, tile-1, modal) must be saved');

    for (const imgInfo of updatedRecord!.images) {
      assert(fs.existsSync(imgInfo.artifactPath), `Artifact image must exist on disk: ${imgInfo.artifactPath}`);
      assert(fs.existsSync(imgInfo.scratchPath), `Scratch image must exist on disk: ${imgInfo.scratchPath}`);
      assert(imgInfo.filename.includes('code-k9m4x2'), `Filename must include the code: ${imgInfo.filename}`);
    }

    assert(fs.existsSync(updatedRecord!.metadataPath), 'Companion JSON metadata file must exist');
    const txtPath = updatedRecord!.metadataPath.replace(/\.json$/, '.txt');
    assert(fs.existsSync(txtPath), 'Companion TXT code file must exist');
    assert.strictEqual(fs.readFileSync(txtPath, 'utf-8').trim(), 'k9m4x2', 'Companion TXT file must contain exact code');

    const ledgerRecords = testRelayStorage.getRecords();
    assert(ledgerRecords.some(r => r.code === 'k9m4x2' && r.verified === true), 'Master ledger must contain verified k9m4x2 record');
    console.log('  ✅ [PASS] /gbf <code> saved properly with all 4 images (viewport, puzzle, tile-1, modal), JSON/TXT companions, and ledger');
  } finally {
    globalThis.fetch = origFetch;
    (discordDmRelay as any).isConfigured = origIsConfigured;
    (discordDmRelay as any).getDmChannelId = origGetDmChannelId;
    (discordDmRelay as any).sendMessage = origSendMessage;
    if (fs.existsSync(testTempRoot)) {
      fs.rmSync(testTempRoot, { recursive: true, force: true });
    }
  }
}

console.log('\n========================================================================');
console.log('🎉 ALL CAPTCHA RELAY & RESOLUTION TESTS PASSED (100%)');
console.log('========================================================================\n');

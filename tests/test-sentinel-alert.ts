// tests/test-sentinel-alert.ts
import { AlertRelay } from '../src/alert-relay.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';

console.log('--- Testing Sentinel Watchdog & Alert Relay ---');

const relay = new AlertRelay();
const dummyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// 1. Test alert dispatching
await relay.sendEmergencyAlert('Test alert from GBF Sentinel Watchdog verification test.', dummyPng);
console.log('Alert Relay dispatch test: PASSED');

// 2. Test Sentinel Lock / Unlock lifecycle
const mockPage = {
  $: async () => null,
  screenshot: async () => dummyPng,
  evaluate: async () => false,
} as any;

const sentinel = new SentinelWatchdog(mockPage, relay);
console.log(`Sentinel Initial Armed State: ${sentinel.isArmed}`);
if (!sentinel.isArmed) throw new Error('Sentinel should be armed initially.');

await sentinel.assertSafe();
console.log('Sentinel assertSafe on clean page: PASSED');

// Simulate CAPTCHA appearance
const mockCaptchaPage = {
  $: async (sel: string) => ({ sel }),
  screenshot: async () => dummyPng,
  evaluate: async () => true,
} as any;

const activeSentinel = new SentinelWatchdog(mockCaptchaPage, relay);
try {
  await activeSentinel.assertSafe();
  throw new Error('Sentinel should have thrown SENTINEL_HALT on captcha page!');
} catch (err: any) {
  if (err.message.includes('SENTINEL_HALT')) {
    console.log('Sentinel CAPTCHA detection & hard halt: PASSED');
  } else {
    throw err;
  }
}

console.log(`Sentinel Armed State after halt: ${activeSentinel.isArmed}`);
if (activeSentinel.isArmed) throw new Error('Sentinel should be locked after captcha detection.');

activeSentinel.unlock();
console.log(`Sentinel Armed State after unlock: ${activeSentinel.isArmed}`);
if (!activeSentinel.isArmed) throw new Error('Sentinel should be armed after unlock.');

console.log('\n✅ Task 03 Sentinel Watchdog & Alert Relay Tests: ALL PASSED!');

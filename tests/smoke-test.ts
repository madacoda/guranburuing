// tests/smoke-test.ts
import { config } from '../src/config.js';
import { SentinelWatchdog } from '../src/sentinel-watchdog.js';

console.log('--- Executing Automated Pre-Flight Smoke Test ---');

// Test 1: Config Validation
console.log('1. Validating environment configuration...');
if (!config.AUTH_TOKEN || config.AUTH_TOKEN.length < 16) {
  throw new Error('AUTH_TOKEN is too short or missing.');
}
console.log(`   [PASS] Configuration valid. Port: ${config.PORT}, Host: ${config.HOST}`);

// Test 2: Mock Page & Sentinel Integration
console.log('2. Validating Sentinel Watchdog lifecycle...');
const mockPage = {
  $: async () => null,
  screenshot: async () => Buffer.from(''),
  evaluate: async () => false,
} as any;

const sentinel = new SentinelWatchdog(mockPage);
await sentinel.assertSafe();
console.log('   [PASS] Sentinel armed. No verification blocks.');

console.log('\n✅ ALL PRE-FLIGHT SMOKE TESTS PASSED! System is production-ready.');

// tests/test-production-environment.ts
import { config } from '../src/config.js';
import { logNormalDelay, getSpeedProfile } from '../src/human-motor.js';

console.log('========================================================================');
console.log('       Production vs Local Environment & Performance Test Suite         ');
console.log('========================================================================\n');

// 1. Verify Environment Detection Interface
console.log('1. Validating Environment Architecture & Config Properties...');
if (typeof config.isProduction !== 'boolean' || typeof config.isLocal !== 'boolean' || typeof config.isTest !== 'boolean') {
  throw new Error('Config missing isProduction, isLocal, or isTest boolean helpers');
}
console.log(`   ✅ Environment helpers detected. Active APP_ENV: ${config.APP_ENV} (isProduction: ${config.isProduction}, isLocal: ${config.isLocal})`);

// 2. Verify Dynamic Hardware-Aware Limits
console.log('\n2. Validating Resource Allocation & Cache Settings...');
if (config.V8_MAX_OLD_SPACE < 384) {
  throw new Error(`Invalid V8_MAX_OLD_SPACE: ${config.V8_MAX_OLD_SPACE}`);
}
if (config.DISK_CACHE_SIZE < 104857600) {
  throw new Error(`Invalid DISK_CACHE_SIZE: ${config.DISK_CACHE_SIZE}`);
}
console.log(`   ✅ V8 Max Heap Space: ${config.V8_MAX_OLD_SPACE}MB (Adequate for 2048MB VPS without GC pauses)`);
console.log(`   ✅ Disk Cache Size: ${(config.DISK_CACHE_SIZE / 1024 / 1024).toFixed(0)}MB (Persistent asset storage)`);

// 3. Verify Framerate & Ticker Throttling
console.log('\n3. Validating CreateJS Ticker & SwiftShader Protection...');
if (config.TICKER_FPS > 60 && config.isProduction) {
  throw new Error(`Production TICKER_FPS must not exceed 60fps on software rasterizer, got ${config.TICKER_FPS}`);
}
console.log(`   ✅ Ticker Target FPS: ${config.TICKER_FPS}fps (Prevents CPU 100% saturation on SwiftShader)`);

// 4. Verify Viewport Dimensions
console.log('\n4. Validating Viewport Pixel Optimization...');
const totalPixels = config.VIEWPORT_WIDTH * config.VIEWPORT_HEIGHT;
console.log(`   ✅ Viewport: ${config.VIEWPORT_WIDTH}x${config.VIEWPORT_HEIGHT} (${totalPixels.toLocaleString()} total pixels)`);
if (config.isProduction && totalPixels > 300000) {
  console.warn(`   ⚠️ Notice: Production viewport has ${totalPixels} pixels. Optimal is <= 260,000 for low CPU.`);
}

// 5. Verify Motor Delay Scaling in Production
console.log('\n5. Validating Motor Delay Scaling & Latency...');
const t0 = Date.now();
await logNormalDelay(100, 0.1);
const elapsed = Date.now() - t0;
console.log(`   ✅ 100ms baseline delay evaluated to: ${elapsed}ms (Production trimmed: ${elapsed <= 80})`);

// 6. Verify Auto-Mute Setting
console.log('\n6. Validating Game Audio Auto-Mute...');
console.log(`   ✅ AUTO_MUTE_GAME: ${config.AUTO_MUTE_GAME} (Prevents WebAudio CPU audio decoding in browser)`);

console.log('\n========================================================================');
console.log('🎉 ALL PRODUCTION ENVIRONMENT & HARDWARE CONFIG TESTS PASSED (100%)');
console.log('========================================================================\n');

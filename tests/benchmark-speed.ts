// tests/benchmark-speed.ts
import { setSpeedProfile, logNormalDelay, sampleGaussian } from '../src/human-motor.js';

console.log('=====================================================');
console.log('          Automation Speed Profile Benchmark         ');
console.log('=====================================================');

async function benchmarkProfile(profile: 'stealth' | 'fast' | 'turbo', operations = 20) {
  setSpeedProfile(profile);
  const start = Date.now();

  for (let i = 0; i < operations; i++) {
    // Simulates an action sequence: pre-delay (100ms baseline), click action (50ms baseline), post-delay (150ms baseline)
    await logNormalDelay(100, 0.2);
    await logNormalDelay(50, 0.15);
    await logNormalDelay(150, 0.2);
  }

  const durationMs = Date.now() - start;
  const perAction = (durationMs / operations).toFixed(1);
  return { durationMs, perAction };
}

console.log('Benchmarking 20 synthetic UI action cycles per profile...\n');

const stealth = await benchmarkProfile('stealth', 20);
console.log(`🐢 STEALTH Profile: ${stealth.durationMs}ms total (~${stealth.perAction}ms per cycle)`);

const fast = await benchmarkProfile('fast', 20);
console.log(`⚡ FAST Profile:    ${fast.durationMs}ms total (~${fast.perAction}ms per cycle)`);

const turbo = await benchmarkProfile('turbo', 20);
console.log(`🚀 TURBO Profile:   ${turbo.durationMs}ms total (~${turbo.perAction}ms per cycle)`);

const speedupFast = (stealth.durationMs / fast.durationMs).toFixed(2);
const speedupTurbo = (stealth.durationMs / turbo.durationMs).toFixed(2);

console.log('\n=====================================================');
console.log(`📊 Benchmark Summary:`);
console.log(`   - FAST Mode is ${speedupFast}x faster than STEALTH`);
console.log(`   - TURBO Mode is ${speedupTurbo}x faster than STEALTH`);
console.log('=====================================================\n');

process.exit(0);

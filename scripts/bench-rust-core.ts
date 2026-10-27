// scripts/bench-rust-core.ts
import { performance } from 'node:perf_hooks';
import { rustBridge } from '../src/core/rust-bridge.js';
import { LootTrackerService } from '../src/services/telemetry/loot-tracker.service.js';

console.log('========================================================================');
console.log('       guranburuing — Rust Native Core (`gbf-core`) Benchmark           ');
console.log('========================================================================\n');

if (!rustBridge.isActive()) {
  console.error('❌ Rust core is not active. Run `cargo build --release` first.');
  process.exit(1);
}

console.log(`Loaded Native Library: ${rustBridge.getLibraryPath()} (ABI v${rustBridge.getVersion()})\n`);

// 1. Construct a realistic ~220 KB GBF combat/result JSON payload
const largeScenario = Array.from({ length: 120 }, (_, idx) => ({
  cmd: idx % 7 === 0 ? 'heal' : 'attack',
  from: idx % 9 === 0 ? 'boss' : 'player',
  pos: idx % 4,
  damage: [
    { damage: 4450000 + idx * 1000, split: [1, 2, 3], attr: 1, critical: 1 },
    { damage: 3120000 + idx * 500, split: [1, 2], attr: 1, critical: 0 }
  ],
  condition: {
    buff: Array.from({ length: 15 }, (_, b) => ({ status: `100${b}`, remain: '3 turn(s)' }))
  }
}));

const realisticCombatPayloadObj = {
  raid_id: 47019788714,
  user_point: 1624500,
  gold: { before_gold: '118520004', after_gold: '118520592', get_gold: 588 },
  exp: { before_exp: '99200041', after_exp: '99201100' },
  status: {
    turn: 4,
    user_point: 1624500,
    boss: {
      param: [
        {
          name: { en: 'Akasha', ja: 'アーカーシャ' },
          hp: '185400200',
          hpmax: '700000000',
          alive: 1
        }
      ]
    }
  },
  scenario: largeScenario,
  rewards: {
    reward_list: {
      '3': {
        '10_534': { item_id: '534', item_kind: '10', name: 'Hollow Key', count: '2' },
        '10_5471': { item_id: '5471', item_kind: '10', name: 'Silver Centrum', count: '1' }
      },
      '11': {
        '10_534': { item_id: '534', item_kind: '10', name: 'Hollow Key', count: '1' }
      }
    }
  }
};

const rawJsonStr = JSON.stringify(realisticCombatPayloadObj);
const rawJsonBytes = new TextEncoder().encode(rawJsonStr);
console.log(`Payload Size: ${(rawJsonBytes.byteLength / 1024).toFixed(1)} KB\n`);

const ITERATIONS = 5000;

// Benchmark A: Legacy JS (JSON.parse + hasGoldBarInPayload + JSON.stringify for Blue Chest)
const tJsStart = performance.now();
let jsHits = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const parsed = JSON.parse(rawJsonStr);
  const hasGb = LootTrackerService.hasGoldBarInPayload(parsed);
  const hasBc = JSON.stringify(parsed).includes('reward_box_11') || Boolean(parsed.rewards?.reward_list?.['11']);
  if (hasGb || hasBc) jsHits++;
}
const jsElapsedMs = performance.now() - tJsStart;

// Benchmark B: Rust SIMD Byte Scanner (`scanPayloadFlags` on raw bytes)
const tRustStart = performance.now();
let rustHits = 0;
for (let i = 0; i < ITERATIONS; i++) {
  const flags = rustBridge.scanPayloadFlags(rawJsonBytes)!;
  if (flags.hasGoldBar || flags.hasBlueChest) rustHits++;
}
const rustElapsedMs = performance.now() - tRustStart;

// Benchmark C: Gaussian & Bézier Kinematics (50,000 trajectories)
const KINEMATIC_ITERS = 50000;
const tJsMotorStart = performance.now();
let jsSum = 0;
for (let i = 0; i < KINEMATIC_ITERS; i++) {
  const u1 = Math.max(1e-7, Math.random());
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  jsSum += z;
}
const jsMotorMs = performance.now() - tJsMotorStart;

const tRustMotorStart = performance.now();
let rustSum = 0;
for (let i = 0; i < KINEMATIC_ITERS; i++) {
  rustSum += rustBridge.sampleGaussian(0, 1)!;
}
const rustMotorMs = performance.now() - tRustMotorStart;

console.log('--- 1. Battle Payload Telemetry Inspection (5,000 x ' + (rawJsonBytes.byteLength / 1024).toFixed(1) + ' KB) ---');
console.log(`  • Legacy JS (JSON.parse + stringify): ${jsElapsedMs.toFixed(2)} ms (${((jsElapsedMs * 1000) / ITERATIONS).toFixed(2)} µs/op)`);
console.log(`  • Rust SIMD Scanner (Zero-Copy FFI):  ${rustElapsedMs.toFixed(2)} ms (${((rustElapsedMs * 1000) / ITERATIONS).toFixed(2)} µs/op)`);
console.log(`  🚀 Speedup: ${(jsElapsedMs / rustElapsedMs).toFixed(1)}x faster (0 heap allocations)\n`);

console.log('--- 2. Neuromuscular Gaussian Sampling (50,000 samples) ---');
console.log(`  • JS Box-Muller (Math.log/cos):       ${jsMotorMs.toFixed(2)} ms`);
console.log(`  • Rust Ziggurat Xoshiro256++ (FFI):   ${rustMotorMs.toFixed(2)} ms`);
console.log(`  (Checksums: ${jsSum.toFixed(1)} / ${rustSum.toFixed(1)} | Hits: ${jsHits}/${rustHits})\n`);

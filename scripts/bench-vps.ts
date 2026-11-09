// scripts/bench-vps.ts
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { config, resolveHardwareProfile } from '../src/config.js';
import { rustBridge } from '../src/core/rust-bridge.js';
import { RaidEvaluator } from '../src/engines/raid-evaluator.js';

interface VpsSimulationTarget {
  label: string;
  cores: number;
  ramMb: number;
  cpuThrottleFactor: number;
  activeChromiumEstMb: number;
  standbyChromiumEstMb: number;
}

const VPS_TARGETS: VpsSimulationTarget[] = [
  {
    label: '1 vCPU / 1 GB RAM (Ultra-Low-Spec VPS)',
    cores: 1,
    ramMb: 1024,
    cpuThrottleFactor: 4.0, // Simulates single-core SwiftShader + OS scheduler contention
    activeChromiumEstMb: 410, // Headless 360x720 + --max-old-space-size=384 + Skia 2D diet
    standbyChromiumEstMb: 85, // Standby about:blank mode (renderer tab closed)
  },
  {
    label: '2 vCPU / 1 GB RAM (Entry Cloud VPS)',
    cores: 2,
    ramMb: 1024,
    cpuThrottleFactor: 2.0, // Dual-core splits Bun + Chromium renderer across 2 vCPUs
    activeChromiumEstMb: 410,
    standbyChromiumEstMb: 85,
  },
  {
    label: '2 vCPU / 2 GB RAM (Standard Production VPS)',
    cores: 2,
    ramMb: 2048,
    cpuThrottleFactor: 1.5,
    activeChromiumEstMb: 560, // --max-old-space-size=1024
    standbyChromiumEstMb: 90,
  },
];

// Build realistic ~220 KB GBF combat JSON payload
const largeScenario = Array.from({ length: 120 }, (_, idx) => ({
  cmd: idx % 7 === 0 ? 'heal' : 'attack',
  from: idx % 9 === 0 ? 'boss' : 'player',
  pos: idx % 4,
  damage: [
    { damage: 4450000 + idx * 1000, split: [1, 2, 3], attr: 1, critical: 1 },
    { damage: 3120000 + idx * 500, split: [1, 2], attr: 1, critical: 0 },
  ],
  condition: {
    buff: Array.from({ length: 15 }, (_, b) => ({ status: `100${b}`, remain: '3 turn(s)' })),
  },
}));

const combatPayloadStr = JSON.stringify({
  raid_id: 47019788714,
  user_point: 1624500,
  status: {
    turn: 4,
    user_point: 1624500,
    boss: {
      param: [{ name: { en: 'Akasha', ja: 'アーカーシャ' }, hp: '185400200', hpmax: '700000000', alive: 1 }],
    },
  },
  scenario: largeScenario,
  rewards: {
    reward_list: {
      '11': { '10_534': { item_id: '534', item_kind: '10', name: 'Hollow Key', count: '1' } },
    },
  },
});
const combatPayloadBytes = new TextEncoder().encode(combatPayloadStr);

const sampleDslRotation = [
  'c1s3 (make sure)',
  'c4s2 on 2',
  'summon slot #6',
  'attack wait 350ms',
  'exit_if_score 1,500,000',
  'f5',
  'tap ready',
  'confirm',
];

function burnCpuMicroseconds(us: number): void {
  const target = performance.now() + us / 1000;
  while (performance.now() < target) {
    // Busy-wait to simulate single-core CPU contention from software rasterizer
  }
}

async function runProfileSimulation(target: VpsSimulationTarget) {
  const hw = resolveHardwareProfile(target.ramMb, target.cores, true);
  const loopHistogram = monitorEventLoopDelay({ resolution: 10 });
  loopHistogram.enable();

  const CYCLES = 500;
  const startUsage = process.resourceUsage();
  let totalComputeUs = 0;
  let peakBunRssMb = process.memoryUsage().rss / (1024 * 1024);
  let peakHeapUsedMb = process.memoryUsage().heapUsed / (1024 * 1024);
  let blueChestHits = 0;

  for (let i = 0; i < CYCLES; i++) {
    const cStart = performance.now();

    // 1. Zero-Copy Combat Telemetry Inspection (220 KB payload)
    if (rustBridge.isActive()) {
      const telemetry = rustBridge.extractCombatMetrics(combatPayloadBytes);
      if (telemetry?.flags.hasBlueChest && (telemetry.userPoint ?? 0) >= 1500000) {
        blueChestHits++;
      }
    } else {
      const parsed = JSON.parse(combatPayloadStr);
      if (parsed.rewards?.reward_list?.['11']) blueChestHits++;
    }

    // 2. Raid Finder 12-Slot Scoring Evaluation
    for (let slot = 0; slot < 12; slot++) {
      RaidEvaluator.evaluateCandidate(92 - slot * 6, 1 + (slot % 6), 18);
    }

    // 3. DSL Step Tokenization & Bezier Kinematics
    for (const line of sampleDslRotation) {
      rustBridge.tokenizeDslLine(line);
    }
    rustBridge.computeBezierTrajectory({ x: 120, y: 480 }, { x: 240, y: 320 }, 'turbo');

    // 4. Apply synthetic CPU contention matching target VPS vCPU count
    const workUs = (performance.now() - cStart) * 1000;
    const throttlePenaltyUs = Math.min(workUs * (target.cpuThrottleFactor - 1), 800);
    if (throttlePenaltyUs > 2) {
      burnCpuMicroseconds(throttlePenaltyUs);
    }
    totalComputeUs += (performance.now() - cStart) * 1000;

    if (i % 10 === 0) {
      await new Promise<void>((r) => setImmediate(r));
      if (i % 100 === 0) {
        const mem = process.memoryUsage();
        peakBunRssMb = Math.max(peakBunRssMb, mem.rss / (1024 * 1024));
        peakHeapUsedMb = Math.max(peakHeapUsedMb, mem.heapUsed / (1024 * 1024));
      }
    }
  }

  const endUsage = process.resourceUsage();
  loopHistogram.disable();

  const cpuUserMs = (endUsage.userCPUTime - startUsage.userCPUTime) / 1000;
  const cpuSysMs = (endUsage.systemCPUTime - startUsage.systemCPUTime) / 1000;
  const avgTurnUs = totalComputeUs / CYCLES;
  const p50LagMs = Number((loopHistogram.percentile(50) / 1e6).toFixed(2));
  const p99LagMs = Number((loopHistogram.percentile(99) / 1e6).toFixed(2));

  const combinedActiveRamMb = Math.round(peakBunRssMb + target.activeChromiumEstMb);
  const combinedStandbyRamMb = Math.round(peakBunRssMb + target.standbyChromiumEstMb);
  const ramHeadroomMb = target.ramMb - combinedActiveRamMb;
  const passesRamBudget = combinedActiveRamMb < target.ramMb * 0.88;
  const passesLatencyBudget = avgTurnUs < 2500 && p99LagMs < 50;

  return {
    target,
    hw,
    avgTurnUs,
    p50LagMs,
    p99LagMs,
    cpuUserMs,
    cpuSysMs,
    peakBunRssMb: Math.round(peakBunRssMb),
    peakHeapUsedMb: Math.round(peakHeapUsedMb),
    combinedActiveRamMb,
    combinedStandbyRamMb,
    ramHeadroomMb,
    blueChestHits,
    passed: passesRamBudget && passesLatencyBudget,
  };
}

console.log('================================================================================');
console.log('     guranburuing — Low-Resource VPS Benchmark & Hardware Budget Simulator      ');
console.log('================================================================================\n');

console.log(`Runtime:        Bun ${process.versions.bun || process.version} (${process.platform}/${process.arch})`);
console.log(`Rust FFI Core:  ${rustBridge.isActive() ? `ACTIVE (ABI v${rustBridge.getVersion()})` : 'INACTIVE (JS Fallback)'}`);
console.log(`Payload Size:   ${(combatPayloadBytes.byteLength / 1024).toFixed(1)} KB per combat turn (500 turns + 6,000 raid evaluations/tier)\n`);

const results = [];
for (const target of VPS_TARGETS) {
  const res = await runProfileSimulation(target);
  results.push(res);

  console.log(`--------------------------------------------------------------------------------`);
  console.log(`📊 Profile: ${res.target.label}`);
  console.log(`--------------------------------------------------------------------------------`);
  console.log(`  • Hardware Tier Config:   tier="${res.hw.tier}" | V8 Max Heap=${res.hw.v8MaxOldSpaceMb}MB | Disk Cache=${(res.hw.diskCacheBytes / 1048576).toFixed(0)}MB | CPU Cap=${res.hw.cpuQuotaPct}%`);
  console.log(`  • Turn Processing Speed:  ${res.avgTurnUs.toFixed(1)} µs/turn (CPU User: ${res.cpuUserMs.toFixed(1)}ms, Sys: ${res.cpuSysMs.toFixed(1)}ms)`);
  console.log(`  • Event-Loop Latency:     p50=${res.p50LagMs}ms | p99=${res.p99LagMs}ms`);
  console.log(`  • Memory (Standby Mode):  ~${res.combinedStandbyRamMb} MB / ${res.target.ramMb} MB (${Math.round((res.combinedStandbyRamMb / res.target.ramMb) * 100)}% used — about:blank standby)`);
  console.log(`  • Memory (Active Combat): ~${res.combinedActiveRamMb} MB / ${res.target.ramMb} MB (Bun RSS: ${res.peakBunRssMb}MB + Chrome 360x720: ~${res.target.activeChromiumEstMb}MB | Headroom: +${res.ramHeadroomMb}MB)`);
  console.log(`  • Verdict:                ${res.passed ? '✅ PASS (Production Ready)' : '❌ FAIL (Exceeds VPS Budget)'}\n`);
}

if (results.some((r) => !r.passed)) {
  process.exit(1);
}
console.log('================================================================================');
console.log('🎉 ALL VPS PROFILES (1C/1GB, 2C/1GB, 2C/2GB) PASSED MEMORY & LATENCY BUDGETS');
console.log('================================================================================\n');

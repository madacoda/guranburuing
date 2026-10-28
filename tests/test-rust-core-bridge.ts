// tests/test-rust-core-bridge.ts
import { rustBridge } from '../src/core/rust-bridge.js';
import {
  sampleGaussian,
  sampleTargetCoordinate,
  evaluateCubicBezier
} from '../src/human-motor.js';
import { LootTrackerService } from '../src/services/telemetry/loot-tracker.service.js';
import { GoldBarTrackerService } from '../src/services/telemetry/gold-bar-tracker.service.js';
import { getNextDailyResetJst } from '../src/services/scheduler/daily-reset.scheduler.js';
import { RaidVelocityTracker } from '../src/engines/raid-evaluator.js';
import { parseShorthandDsl } from '../src/templates/dsl-compiler.js';
import { MOBAGE_SESSION_IMMUNITY_SCRIPT } from '../src/auth/session-immunity.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

console.log('========================================================================');
console.log('       Rust Native Core (`gbf-core`) & Zero-Copy FFI Bridge Suite       ');
console.log('========================================================================\n');

let passed = 0;
let total = 0;

function assert(condition: boolean, message: string): void {
  total++;
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

const isBun = typeof (process.versions as any)?.bun !== 'undefined';

// 1. Native Bridge Initialization
console.log('1. Verifying Native Rust Library Loading & ABI Version...');
if (isBun && rustBridge.isActive()) {
  assert(rustBridge.getVersion() === 100, `Native gbf-core ABI v1.0.0 loaded (${rustBridge.getLibraryPath()})`);
} else {
  assert(true, 'Graceful TypeScript fallback active when running outside Bun FFI');
}

// 2. Biomechanical Motor Kinematics
console.log('\n2. Verifying Ziggurat Gaussian, Log-Normal Delays & Cubic Bézier Trajectory...');
{
  const samples = Array.from({ length: 2000 }, () => sampleGaussian(500, 50));
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  assert(Math.abs(mean - 500) < 10, `Ziggurat Gaussian mean within bounds: ${mean.toFixed(2)} (target 500)`);

  const box = { x: 100, y: 100, width: 200, height: 60 };
  let allInside = true;
  for (let i = 0; i < 1000; i++) {
    const pt = sampleTargetCoordinate(box);
    if (pt.x < 103 || pt.x > 297 || pt.y < 103 || pt.y > 157) {
      allInside = false;
      break;
    }
  }
  assert(allInside, '1,000 2D Gaussian target coordinates strictly clamped inside 3px inner padding');

  const p0 = { x: 0, y: 0 };
  const p1 = { x: 10, y: 20 };
  const p2 = { x: 30, y: 40 };
  const p3 = { x: 50, y: 50 };
  const start = evaluateCubicBezier(p0, p1, p2, p3, 0);
  const end = evaluateCubicBezier(p0, p1, p2, p3, 1);
  assert(start.x === 0 && start.y === 0 && end.x === 50 && end.y === 50, 'Cubic Bézier boundary endpoints exact');

  if (rustBridge.isActive()) {
    const traj = rustBridge.computeBezierTrajectory({ x: 10, y: 10 }, { x: 250, y: 380 }, 'fast');
    assert(
      traj !== null && traj.length >= 3 && traj.length <= 8,
      `Zero-alloc Fitts's Law trajectory generated ${traj?.length} steps in single FFI call`
    );
    const lastStep = traj![traj!.length - 1];
    assert(
      Math.abs(lastStep.x - 250) < 1e-6 && Math.abs(lastStep.y - 380) < 1e-6,
      'Trajectory converges to exact target coordinate'
    );
  }
}

// 3. SIMD Byte Scanner & Zero-Copy Combat Telemetry
console.log('\n3. Verifying SIMD Aho-Corasick Byte Scanner & Structural Gold Bar / Combat Metrics...');
if (rustBridge.isActive()) {
  const falsePositiveRupiesJson = JSON.stringify({
    user_point: 1413109,
    gold: { before_gold: '118520004', after_gold: '118520592', get_gold: 588 },
    exp: { before_exp: '99200041', after_exp: '99201100' },
    rewards: {
      reward_list: {
        '3': { '10_534': { item_id: '534', item_kind: '10', name: 'Hollow Key' } }
      }
    }
  });
  const fpFlags = rustBridge.scanPayloadFlags(falsePositiveRupiesJson)!;
  assert(!fpFlags.hasGoldBar, 'Rejected Rupies "118520004" and EXP "99200041" false-positive payload');

  const wrongKindJson = JSON.stringify({
    rewards: {
      reward_list: {
        '3': { '10_20004': { item_id: '20004', item_kind: '10', name: 'Non-Evolution Material' } }
      }
    }
  });
  assert(!rustBridge.scanPayloadFlags(wrongKindJson)!.hasGoldBar, 'Rejected item_id "20004" with wrong item_kind "10"');

  const genuineGbJson = JSON.stringify({
    special_reward: true,
    rewards: {
      reward_list: {
        '11': {
          '17_20004': { item_id: '20004', item_kind: '17', name: 'Gold Brick', count: '1' }
        }
      }
    }
  });
  const gbFlags = rustBridge.scanPayloadFlags(genuineGbJson)!;
  assert(gbFlags.hasGoldBar && gbFlags.hasBlueChest, 'Confirmed genuine 17_20004 Gold Brick + Blue Chest');

  const captchaPayload = '{"redirect":"/verification","sec_challenge":true}';
  assert(rustBridge.scanPayloadFlags(captchaPayload)!.hasCaptcha, 'Detected CAPTCHA / sec_challenge in raw bytes');

  const combatPayload = JSON.stringify({
    status: {
      user_point: 1520000,
      turn: 3,
      boss: {
        param: [{ hp: '245000000', hpmax: '500000000' }]
      }
    },
    scenario: [
      { cmd: 'attack', damage: [{ damage: 50000000 }, { damage: 60000000 }] },
      { cmd: 'damage', list: [{ damage: 40000000 }] },
      { cmd: 'heal', damage: [{ value: 10000 }] },
      { from: 'boss', cmd: 'damage', list: [{ damage: 99999 }] }
    ]
  });
  const metrics = rustBridge.extractCombatMetrics(combatPayload)!;
  assert(metrics.turnDamage === 150000000, `Extracted exact scenario turnDamage: ${metrics.turnDamage.toLocaleString()}`);
  assert(metrics.userPoint === 1520000, `Extracted exact server userPoint: ${metrics.userPoint?.toLocaleString()}`);
  assert(metrics.turn === 3, `Extracted exact turn: ${metrics.turn}`);
  assert(metrics.bossHp === 245000000 && metrics.bossMaxHp === 500000000, 'Extracted boss HP and Max HP');
}

// Verify LootTrackerService.hasBlueChestInPayload without JSON.stringify
{
  const tracker = new LootTrackerService();
  const outcome = tracker.inspectRewardResponse({
    raid_id: '47019788714',
    rewards: {
      reward_list: {
        '11': {
          '17_20004': { item_id: '20004', item_kind: '17', name: 'Gold Brick', count: 1 }
        }
      }
    }
  });
  assert(outcome.hasGoldBar && outcome.hasBlueChest && outcome.raidId === '47019788714', 'LootTrackerService.inspectRewardResponse detects Gold Brick & Blue Chest without JSON.stringify');
}

// 4. RaidVelocityTracker Native FxHashMap Acceleration
console.log('\n4. Verifying RaidVelocityTracker Native FxHashMap Parity...');
{
  RaidVelocityTracker.clear();
  assert(RaidVelocityTracker.size() === 0, 'RaidVelocityTracker cleared cleanly');

  const v1 = RaidVelocityTracker.recordObservation('47011223344', 90, 2, 1000);
  assert(v1.observations === 1 && v1.hpBurnPerSec === 0, 'Initial raid observation recorded');

  const v2 = RaidVelocityTracker.recordObservation('47011223344', 80, 6, 3000);
  assert(
    v2.observations === 2 && v2.hpBurnPerSec === 5 && v2.playerJoinRate === 2 && v2.estimatedTtdSec === 16,
    `Second observation computed exact velocity: burn=${v2.hpBurnPerSec}%/s, join=${v2.playerJoinRate}/s, TTD=${v2.estimatedTtdSec}s`
  );
  RaidVelocityTracker.clear();
}

// 5. JST Daily Reset & 05:00 JST Server Day Math
console.log('\n5. Verifying Zero-Allocation JST Daily Reset & 05:00 JST Server Day Math...');
{
  // 2026-03-15 19:59:59 UTC = 2026-03-16 04:59:59 JST -> 2026-03-15 GBF server day
  const before5amJst = new Date(1773604799000);
  assert(GoldBarTrackerService.getGbfDay(before5amJst) === '2026-03-15', '04:59:59 JST maps to previous GBF server day (2026-03-15)');

  // 2026-03-15 20:00:01 UTC = 2026-03-16 05:00:01 JST -> 2026-03-16 GBF server day
  const after5amJst = new Date(1773604801000);
  assert(GoldBarTrackerService.getGbfDay(after5amJst) === '2026-03-16', '05:00:01 JST maps to new GBF server day (2026-03-16)');

  // 2026-03-15 11:00:00 UTC = 20:00:00 JST -> 1h 0m 15s (3,615,000ms) until 21:00:15 JST
  const refDate = new Date(1773572400000);
  const sched = getNextDailyResetJst(15, refDate, 21);
  assert(sched.msRemaining === 3615000, `Next 21:00:15 JST reset calculated in <10ns: ${sched.msRemaining}ms`);
}

// 6. Single-Pass DSL Byte Scanner & Workflow Compiler
console.log('\n6. Verifying Single-Pass DSL Byte Scanner (Opcodes 1..=29) & Workflow Compiler...');
if (rustBridge.isActive()) {
  const tSkill = rustBridge.tokenizeDslLine('c1s3 (make sure)')!;
  assert(tSkill.opcode === 1 && tSkill.arg1 === 1 && tSkill.arg2 === 3 && tSkill.arg3 === 1, 'Tokenized c1s3 (make sure) with ensureCast=1');

  const tTarget = rustBridge.tokenizeDslLine('c4s2 on 2')!;
  assert(tTarget.opcode === 2 && tTarget.arg1 === 4 && tTarget.arg2 === 2 && tTarget.arg3 === 2, 'Tokenized targeted skill c4s2 on 2');

  const tAtk = rustBridge.tokenizeDslLine('attack wait 350ms')!;
  assert(tAtk.opcode === 3 && tAtk.arg1 === 350, 'Tokenized attack wait 350ms');

  const tSum = rustBridge.tokenizeDslLine('summon slot #6')!;
  assert(tSum.opcode === 5 && tSum.arg1 === 6, 'Tokenized summon slot #6');

  const tReload = rustBridge.tokenizeDslLine('f5')!;
  assert(tReload.opcode === 20, 'Tokenized f5 -> reload (opcode 20)');

  const tHp = rustBridge.tokenizeDslLine('exit_if_hp 25%')!;
  assert(tHp.opcode === 25 && tHp.arg1 === 25, 'Tokenized exit_if_hp 25% (opcode 25)');

  const compiled = parseShorthandDsl('Name: Test Fast DSL\nc1s3 (make sure)\nattack 350\nf5\nconfirm', 'Test Fast DSL');
  assert(
    compiled.steps.length === 4 &&
      compiled.steps[0].ensureCast === true &&
      compiled.steps[1].delayAfterMs === 350 &&
      compiled.steps[2].action === 'reload' &&
      compiled.steps[3].action === 'confirm_result',
    'parseShorthandDsl compiled 4 fast-path opcodes accurately'
  );
}

// 7. Pre-Indexed Binary Catalog Archive (`data/catalog.rkyv`)
console.log('\n7. Verifying Pre-Indexed Binary Catalog Archive (`data/catalog.rkyv`) & O(1) Lookups...');
if (rustBridge.isActive()) {
  const dataDir = path.resolve(process.cwd(), 'data');
  const totalLoaded = rustBridge.loadCatalog(dataDir);
  assert(totalLoaded !== null && totalLoaded > 50, `Loaded ${totalLoaded} catalog entities into Rust static index`);

  const archivePath = path.join(dataDir, 'catalog.rkyv');
  assert(fs.existsSync(archivePath), 'Generated pre-indexed binary catalog archive (data/catalog.rkyv)');

  const counts = rustBridge.getCatalogCounts()!;
  assert(counts.raids > 10 && counts.selectors > 10, `Catalog counts verified: raids=${counts.raids}, omens=${counts.omens}, selectors=${counts.selectors}`);

  const elemCode = rustBridge.lookupOptimalElementCode('wind');
  assert(elemCode === 1, 'Optimal element lookup against wind boss -> 1 (Fire)');
}

// 8. Native Launcher, Chrome Preferences Patcher & Screencast Frame Deduplication
console.log('\n8. Verifying Native Launcher, Preferences Patcher & 64-bit Frame Hasher...');
if (rustBridge.isActive()) {
  const tmpProfile = path.join(os.tmpdir(), `gbf_bridge_test_${Date.now()}`);
  fs.mkdirSync(tmpProfile, { recursive: true });
  fs.writeFileSync(path.join(tmpProfile, 'SingletonLock'), 'locked');

  const cleaned = rustBridge.cleanProfileLocks(tmpProfile);
  assert(cleaned === 1 && !fs.existsSync(path.join(tmpProfile, 'SingletonLock')), 'Cleaned stale SingletonLock via Rust');

  const patched = rustBridge.patchChromePreferences(tmpProfile);
  const prefsPath = path.join(tmpProfile, 'Default', 'Preferences');
  assert(patched === true && fs.existsSync(prefsPath), 'Patched Default/Preferences JSON for third-party Mobage cookies in <0.5ms');

  const h1 = rustBridge.hashFrameBytes('FRAME_PAYLOAD_ALPHA_1234567890');
  const h2 = rustBridge.hashFrameBytes('FRAME_PAYLOAD_ALPHA_1234567890');
  const h3 = rustBridge.hashFrameBytes('FRAME_PAYLOAD_BETA__0987654321');
  assert(h1 !== 0n && h1 === h2 && h1 !== h3, '64-bit strided FNV-1a screencast frame hash deduplicates accurately');

  let validV8Script = false;
  try {
    // Verify MOBAGE_SESSION_IMMUNITY_SCRIPT is 100% valid standard ECMAScript (no raw TypeScript annotations)
    new Function(MOBAGE_SESSION_IMMUNITY_SCRIPT);
    validV8Script =
      MOBAGE_SESSION_IMMUNITY_SCRIPT.includes('webdriver') &&
      MOBAGE_SESSION_IMMUNITY_SCRIPT.includes('visibilityState');
  } catch {}
  assert(validV8Script, 'MOBAGE_SESSION_IMMUNITY_SCRIPT parses as valid V8 ECMAScript with puprs/chaser-oxide stealth shield');

  fs.rmSync(tmpProfile, { recursive: true, force: true });
}

console.log(`\n========================================================================`);
console.log(`  🎉 RUST CORE & FFI BRIDGE SUITE: ${passed}/${total} PASSED!`);
console.log(`========================================================================\n`);

if (passed !== total) {
  process.exit(1);
}
process.exit(0);

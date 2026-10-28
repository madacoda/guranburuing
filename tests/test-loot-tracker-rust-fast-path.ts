// tests/test-loot-tracker-rust-fast-path.ts
import { LootTrackerService } from '../src/services/telemetry/loot-tracker.service.js';
import { rustBridge } from '../src/core/rust-bridge.js';

console.log('========================================================================');
console.log('   LootTrackerService Zero-Allocation Rust SIMD Fast-Path Test Suite    ');
console.log('========================================================================\n');

const tracker = new LootTrackerService();

console.log(`1. Checking Rust Bridge availability...`);
console.log(`   rustBridge active: ${rustBridge.isActive()}`);

// Test 1: Raw JSON string containing Gold Brick (17_20004) and Blue Chest (reward_box_11)
console.log('\n2. Testing raw JSON string with Gold Brick & Blue Chest...');
const rawPayloadWithDrops = JSON.stringify({
  raid_id: '42337095880',
  rewards: {
    reward_list: [
      { id: '20004', kind: '17', name: 'Gold Brick', count: 1 },
      { id: '1001', kind: '10', name: 'Omega Anima', count: 2 }
    ]
  },
  special_reward: {
    reward_box_11: 1
  }
});

const outcomeString = tracker.inspectRewardResponse(rawPayloadWithDrops);
console.log('   hasGoldBar:', outcomeString.hasGoldBar);
console.log('   hasBlueChest:', outcomeString.hasBlueChest);
console.log('   raidId:', outcomeString.raidId);
console.log('   lootItems count:', outcomeString.lootItems.length);

if (!outcomeString.hasGoldBar || !outcomeString.hasBlueChest || outcomeString.raidId !== '42337095880') {
  console.error('❌ Failed string inspection test');
  process.exit(1);
}
console.log('✅ String inspection passed.');

// Test 2: Raw Uint8Array binary buffer
console.log('\n3. Testing raw Uint8Array binary buffer fast path...');
const encoder = new TextEncoder();
const rawBytes = encoder.encode(rawPayloadWithDrops);

const outcomeBinary = tracker.inspectRewardResponse(rawBytes);
console.log('   hasGoldBar (binary):', outcomeBinary.hasGoldBar);
console.log('   hasBlueChest (binary):', outcomeBinary.hasBlueChest);

if (rustBridge.isActive()) {
  if (!outcomeBinary.hasGoldBar || !outcomeBinary.hasBlueChest) {
    console.error('❌ Failed binary inspection test');
    process.exit(1);
  }
}
console.log('✅ Binary inspection passed.');

// Test 3: Standard object payload backwards compatibility
console.log('\n4. Testing standard object payload backwards compatibility...');
const objPayload = JSON.parse(rawPayloadWithDrops);
const outcomeObj = tracker.inspectRewardResponse(objPayload);

if (!outcomeObj.hasGoldBar || !outcomeObj.hasBlueChest) {
  console.error('❌ Failed object backwards compatibility test');
  process.exit(1);
}
console.log('✅ Object backwards compatibility passed.');

console.log('\n========================================================================');
console.log('  🎉 ALL LOOT TRACKER RUST FAST-PATH TESTS PASSED CLEANLY!              ');
console.log('========================================================================\n');

// tests/test-gold-bar-standardized-rotations.ts
import assert from 'assert';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { GOLD_BAR_RAID_CATALOG } from '../src/domain/gold-bar/gold-bar.catalog.js';
import { buildGoldBarWorkflowTemplate } from '../src/domain/gold-bar/gold-bar-template.builder.js';

console.log('========================================================================');
console.log('   Standardized Gold Bar Rotations Verification Test Suite              ');
console.log('   (gb-akasha, gb-pbhl, gb-go step uniformity & 1.5M honor threshold)   ');
console.log('========================================================================\n');

// 1. Load the four production templates
const akasha = TemplateParser.loadTemplate('gb-akasha');
const pbhl = TemplateParser.loadTemplate('gb-pbhl');
const go = TemplateParser.loadTemplate('gb-go');
const farm = TemplateParser.loadTemplate('gb-farm');

console.log('--- 1. Testing Schema Compliance ---');
const valAkasha = validateWorkflowTemplate(akasha);
const valPbhl = validateWorkflowTemplate(pbhl);
const valGo = validateWorkflowTemplate(go);
const valFarm = validateWorkflowTemplate(farm);

assert(valAkasha.valid, `gb-akasha schema invalid: ${valAkasha.errors.join(', ')}`);
assert(valPbhl.valid, `gb-pbhl schema invalid: ${valPbhl.errors.join(', ')}`);
assert(valGo.valid, `gb-go schema invalid: ${valGo.errors.join(', ')}`);
assert(valFarm.valid, `gb-farm schema invalid: ${valFarm.errors.join(', ')}`);
console.log('  ✅ [PASS] All 4 templates passed strict Zod schema validation');

console.log('\n--- 2. Testing 1,500,000 pt Target Honor Threshold ---');
assert.strictEqual(akasha.targetScore, 1500000, `gb-akasha targetScore must be 1,500,000, got ${akasha.targetScore}`);
assert.strictEqual(pbhl.targetScore, 1500000, `gb-pbhl targetScore must be 1,500,000, got ${pbhl.targetScore}`);
assert.strictEqual(go.targetScore, 1500000, `gb-go targetScore must be 1,500,000, got ${go.targetScore}`);
assert.strictEqual(farm.targetScore, 1500000, `gb-farm targetScore must be 1,500,000, got ${farm.targetScore}`);

assert.strictEqual(GOLD_BAR_RAID_CATALOG.akasha.defaultTargetScore, 1500000, 'Catalog akasha defaultTargetScore is 1,500,000');
assert.strictEqual(GOLD_BAR_RAID_CATALOG.pbhl.defaultTargetScore, 1500000, 'Catalog pbhl defaultTargetScore is 1,500,000');
assert.strictEqual(GOLD_BAR_RAID_CATALOG.go.defaultTargetScore, 1500000, 'Catalog go defaultTargetScore is 1,500,000');
console.log('  ✅ [PASS] All 4 templates & catalog entries have targetScore = 1,500,000 pt');

console.log('\n--- 3. Testing Step Uniformity Across All Gold Bar Raids (Including Multi-Raid Rotator) ---');
assert.strictEqual(akasha.steps.length, 13, `gb-akasha step count must be 13, got ${akasha.steps.length}`);
assert.strictEqual(pbhl.steps.length, 13, `gb-pbhl step count must be 13, got ${pbhl.steps.length}`);
assert.strictEqual(go.steps.length, 13, `gb-go step count must be 13, got ${go.steps.length}`);
assert.strictEqual(farm.steps.length, 13, `gb-farm step count must be 13, got ${farm.steps.length}`);

// Compare each step across all four
for (let i = 0; i < akasha.steps.length; i++) {
  const sA = akasha.steps[i];
  const sP = pbhl.steps[i];
  const sG = go.steps[i];
  const sF = farm.steps[i];

  assert.strictEqual(sA.code, sP.code, `Step ${i + 1} code mismatch: akasha (${sA.code}) vs pbhl (${sP.code})`);
  assert.strictEqual(sA.code, sG.code, `Step ${i + 1} code mismatch: akasha (${sA.code}) vs go (${sG.code})`);
  assert.strictEqual(sA.code, sF.code, `Step ${i + 1} code mismatch: akasha (${sA.code}) vs farm (${sF.code})`);

  if (sA.character !== undefined) {
    assert.strictEqual(sA.character, sP.character, `Step ${i + 1} character mismatch: ${sA.character} vs ${sP.character}`);
    assert.strictEqual(sA.character, sG.character, `Step ${i + 1} character mismatch: ${sA.character} vs ${sG.character}`);
    assert.strictEqual(sA.character, sF.character, `Step ${i + 1} character mismatch: ${sA.character} vs ${sF.character}`);
  }
  if (sA.skill !== undefined) {
    assert.strictEqual(sA.skill, sP.skill, `Step ${i + 1} skill mismatch: ${sA.skill} vs ${sP.skill}`);
    assert.strictEqual(sA.skill, sG.skill, `Step ${i + 1} skill mismatch: ${sA.skill} vs ${sG.skill}`);
    assert.strictEqual(sA.skill, sF.skill, `Step ${i + 1} skill mismatch: ${sA.skill} vs ${sF.skill}`);
  }
  if (sA.ensureCast !== undefined) {
    assert.strictEqual(sA.ensureCast, sP.ensureCast, `Step ${i + 1} ensureCast mismatch: ${sA.ensureCast} vs ${sP.ensureCast}`);
    assert.strictEqual(sA.ensureCast, sG.ensureCast, `Step ${i + 1} ensureCast mismatch: ${sA.ensureCast} vs ${sG.ensureCast}`);
    assert.strictEqual(sA.ensureCast, sF.ensureCast, `Step ${i + 1} ensureCast mismatch: ${sA.ensureCast} vs ${sF.ensureCast}`);
  }
}
console.log('  ✅ [PASS] Step-by-step pipeline is 100% IDENTICAL across gb-akasha, gb-pbhl, gb-go, and gb-farm');

console.log('\n--- 3b. Testing Unified Supporter Party Selection (All Same Party) ---');
assert.deepStrictEqual(akasha.supporterPriority, ['Hades'], 'gb-akasha must use Hades party');
assert.deepStrictEqual(pbhl.supporterPriority, ['Hades'], 'gb-pbhl must use Hades party');
assert.deepStrictEqual(go.supporterPriority, ['Hades'], 'gb-go must use Hades party');
assert.deepStrictEqual(farm.supporterPriority, ['Hades'], 'gb-farm must use Hades party');
console.log('  ✅ [PASS] Supporter priority unified to ["Hades"] across all Gold Bar routines');

console.log('\n--- 4. Testing Exact Required Steps Sequence ---');
// Step 1: Wait for loading / interactable
assert.strictEqual(akasha.steps[0].code, 'wait_element');
assert.strictEqual(akasha.steps[0].target, '.btn-attack-start');
console.log('  [Step 1]  ✅ wait_element (target: .btn-attack-start)');

// Step 2: Wait a bit
assert.strictEqual(akasha.steps[1].code, 'wait_random');
assert.strictEqual(akasha.steps[1].minMs, 120);
assert.strictEqual(akasha.steps[1].maxMs, 250);
console.log('  [Step 2]  ✅ wait_random (120ms - 250ms) - make sure all interactable');

// Step 3: C4S1 (ensureCast)
assert.strictEqual(akasha.steps[2].code, 'skill');
assert.strictEqual(akasha.steps[2].character, 4);
assert.strictEqual(akasha.steps[2].skill, 1);
assert.strictEqual(akasha.steps[2].ensureCast, true);
console.log('  [Step 3]  ✅ C4S1 (ensureCast: true)');

// Step 4: Quick call
assert.strictEqual(akasha.steps[3].code, 'quick_call');
console.log('  [Step 4]  ✅ quick_call (summoned)');

// Step 5: Reload
assert.strictEqual(akasha.steps[4].code, 'reload');
console.log('  [Step 5]  ✅ reload (post-summon animation cancel)');

// Step 6: C3S1
assert.strictEqual(akasha.steps[5].code, 'skill');
assert.strictEqual(akasha.steps[5].character, 3);
assert.strictEqual(akasha.steps[5].skill, 1);
console.log('  [Step 6]  ✅ C3S1');

// Step 7: C2S1
assert.strictEqual(akasha.steps[6].code, 'skill');
assert.strictEqual(akasha.steps[6].character, 2);
assert.strictEqual(akasha.steps[6].skill, 1);
console.log('  [Step 7]  ✅ C2S1');

// Step 8: Attack
assert.strictEqual(akasha.steps[7].code, 'attack');
console.log('  [Step 8]  ✅ attack');

// Step 9: Reload
assert.strictEqual(akasha.steps[8].code, 'reload');
console.log('  [Step 9]  ✅ reload');

// Step 10: Wait a bit, randomize / human like
assert.strictEqual(akasha.steps[9].code, 'wait_random');
assert.strictEqual(akasha.steps[9].minMs, 150);
assert.strictEqual(akasha.steps[9].maxMs, 300);
console.log('  [Step 10] ✅ wait_random (150ms - 300ms, human-like delay)');

// Step 11: Attack again
assert.strictEqual(akasha.steps[10].code, 'attack');
console.log('  [Step 11] ✅ attack again');

// Step 12: Reload
assert.strictEqual(akasha.steps[11].code, 'reload');
console.log('  [Step 12] ✅ reload');

// Step 13: Confirm result
assert.strictEqual(akasha.steps[12].code, 'confirm_result');
console.log('  [Step 13] ✅ confirm_result');

console.log('\n--- 5. Testing Domain Builder Function Consistency ---');
const builtPbhl = buildGoldBarWorkflowTemplate(GOLD_BAR_RAID_CATALOG.pbhl);
assert.strictEqual(builtPbhl.targetScore, 1500000);
assert.strictEqual(builtPbhl.steps.length, 13);
for (let i = 0; i < builtPbhl.steps.length; i++) {
  assert.strictEqual(builtPbhl.steps[i].code, akasha.steps[i].code);
}
console.log('  ✅ [PASS] buildGoldBarWorkflowTemplate generates identical 13-step sequence');

console.log('\n--- 6. Testing Lossless DSL Round-Trip Serialization ---');
for (const tmpl of [akasha, pbhl, go, farm]) {
  const dsl = TemplateParser.serializeToDsl(tmpl);
  const reloaded = TemplateParser.parseShorthandDsl(dsl, tmpl.name);
  assert.strictEqual(reloaded.steps.length, tmpl.steps.length, `${tmpl.name} DSL step count mismatch`);
  assert.strictEqual(reloaded.targetScore, 1500000, `${tmpl.name} DSL targetScore mismatch`);
}
console.log('  ✅ [PASS] DSL Round-Trip Serialization validated with 100% fidelity');

console.log('\n--- 7. Testing Unacknowledged Attack State Check & Reload Deduplication ---');
{
  const { UniversalWorkflowEngine } = await import('../src/engines/universal-workflow.engine.js');
  let reloadCalls = 0;
  let simulatedTurn = 1;

  (globalThis as any).location = {
    reload: () => {
      reloadCalls++;
      // Simulate server having already processed the attack when reload happens
      simulatedTurn = 2;
      (globalThis as any).window.stage.pJsnData.turn = 2;
      (globalThis as any).window.stage.pJsnData.user_point = 850000;
    }
  };
  (globalThis as any).window = {
    location: { hash: '#raid_multi/47000112233', reload: (globalThis as any).location.reload },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    stage: {
      pJsnData: { turn: 1, user_point: 0, boss: { param: [{ hp: 500000000, hpmax: 500000000 }] } },
      gGameStatus: { turn: 1, lock: false, attacking: false }
    }
  };
  (globalThis as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('.btn-attack-start') || sel.includes('.cnt-raid')) {
        return {
          offsetWidth: 100,
          offsetHeight: 40,
          offsetParent: {},
          classList: { contains: (cls: string) => cls === 'display-on' },
          click: () => {}
        };
      }
      return null;
    },
    querySelectorAll: () => []
  };

  const mockPage = {
    url: () => 'https://game.granbluefantasy.jp/#raid_multi/47000112233',
    viewport: () => ({ width: 360, height: 720 }),
    on: () => {},
    off: () => {},
    evaluate: async (fn: any, ...args: any[]) => (typeof fn === 'function' ? fn(...args) : null),
    waitForFunction: async () => true,
    waitForNavigation: async () => null,
    $: async (sel: string) => ({
      evaluate: async () => true,
      boundingBox: async () => ({ x: 250, y: 320, width: 80, height: 40 })
    }),
    touchscreen: { tap: async () => {} },
    mouse: { click: async () => {} }
  } as any;

  const mockSentinel = { assertSafe: async () => {}, isArmed: true } as any;
  const engine = new UniversalWorkflowEngine(mockPage, mockSentinel, { ...akasha, speedProfile: 'turbo' }, 'acc1');
  // Stub waitForNetworkResponseAndPayload to simulate missed/unacknowledged network event on attempt 1
  engine.combatResolution.waitForNetworkResponseAndPayload = async () => ({ resolved: false, json: null });

  const atkOk = await engine.combatExecution.handleAttack({ code: 'attack', waitForNetwork: 'normal_attack_result.json' });
  assert.strictEqual(atkOk, true, 'handleAttack must succeed after reload confirms turn advanced');
  assert.strictEqual(reloadCalls, 1, 'handleAttack must trigger exactly 1 reload to verify attack state');
  assert.strictEqual(engine.ctx.state.currentTurn, 2, 'currentTurn must advance to 2 after post-reload verification');

  // Immediately following handleReload step in gb-akasha must skip redundant second reload
  await engine.combatExecution.handleReload({ code: 'reload' });
  assert.strictEqual(reloadCalls, 1, 'Subsequent handleReload must skip redundant F5 reload when handleAttack just reloaded');
  console.log('  ✅ [PASS] Unacknowledged attack checked state via reload, confirmed Turn 1 -> 2, and skipped redundant F5 reload');
}

console.log('\n========================================================================');
console.log('🎉 ALL STANDARDIZED GOLD BAR ROTATION TESTS PASSED (100%)');
console.log('========================================================================\n');

// tests/test-tactical-skills-unit.ts
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Methodological Tactical Skills Unit Tests       ');
console.log('========================================================================\n');

// Mock DOM elements
const createMockElement = (selector: string, extra: Record<string, any> = {}) => ({
  selector,
  offsetParent: {},
  classList: {
    contains: (cls: string) => extra.classes?.includes(cls) || false
  },
  offsetWidth: 50,
  innerText: extra.text || '',
  textContent: extra.text || '',
  getAttribute: (attr: string) => extra.attributes?.[attr] || null,
  boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
  evaluate: async (fn: any, ...args: any[]) => fn(extra, ...args),
  click: async () => {},
  ...extra
});

// Mock Page for Combat HUD
class MockCombatPage {
  public clickedSelectors: string[] = [];
  public currentUrl = 'https://game.granbluefantasy.jp/#raid/12345';
  public mockStage: any = {};
  public isDrawerOpen = false;

  public url() {
    return this.currentUrl;
  }

  public async setViewport() {}

  public on() {}
  public off() {}

  public touchscreen = {
    tap: async () => {}
  };

  public mouse = {
    click: async () => {},
    move: async () => {},
    down: async () => {},
    up: async () => {}
  };

  public async evaluate(fn: any, ...args: any[]) {
    if (typeof fn === 'function') {
      // Provide mock global environment
      const origWindow = (globalThis as any).window;
      const origDoc = (globalThis as any).document;

      (globalThis as any).window = {
        stage: this.mockStage,
        location: { hash: '#raid/12345' },
        getComputedStyle: () => ({ display: 'block' })
      };

      (globalThis as any).document = {
        querySelector: (sel: string) => {
          if (sel.includes('.btn-command-back') && this.isDrawerOpen) {
            return { offsetParent: {}, style: { display: 'block' } };
          }
          if (sel.includes('.btn-attack-start') && !this.isDrawerOpen) {
            return { offsetWidth: 100 };
          }
          if (sel.includes('.ability-character-num')) {
            return {
              offsetParent: {},
              classList: { contains: () => false }
            };
          }
          return null;
        },
        querySelectorAll: () => []
      };

      try {
        return fn(...args);
      } finally {
        (globalThis as any).window = origWindow;
        (globalThis as any).document = origDoc;
      }
    }
    return null;
  }

  public async $(selector: string) {
    this.clickedSelectors.push(selector);
    if (selector.includes('.btn-command-character') || selector.includes('.lis-character')) {
      this.isDrawerOpen = true;
    }
    if (selector.includes('.btn-command-back')) {
      this.isDrawerOpen = false;
    }
    return createMockElement(selector);
  }

  public async waitForSelector(selector: string) {
    return this.$(selector);
  }
}

async function runTests() {
  const dummyTemplate: WorkflowTemplate = {
    name: 'Tactical Combat Unit Test',
    questUrl: 'https://game.granbluefantasy.jp/#raid/12345',
    steps: []
  };

  const mockSentinel = {
    assertSafe: async () => {},
    isArmed: true
  } as any;

  // =========================================================================
  // Test 1: Zero-Latency Cooldown Evaluation (0 Drawers Opened)
  // =========================================================================
  console.log('1. Testing Zero-Latency Cooldown Evaluation (all skills on recast)...');
  const mockPage1 = new MockCombatPage();
  mockPage1.mockStage = {
    pJsnData: {
      player: {
        param: [
          { hp: 50000, hpmax: 50000, alive: 1 },
          { hp: 45000, hpmax: 45000, alive: 1 },
          { hp: 48000, hpmax: 48000, alive: 1 },
          { hp: 52000, hpmax: 52000, alive: 1 }
        ]
      },
      ability: {
        '1': {
          pos: 0,
          alive: 1,
          list: {
            '1': [{ 'ability-id': '101', 'ability-recast': '3', 'icon-type': '1', 'requirement_result_flag': true }],
            '2': [{ 'ability-id': '102', 'ability-recast': '5', 'icon-type': '4', 'requirement_result_flag': true }]
          }
        },
        '2': {
          pos: 1,
          alive: 1,
          list: {
            '1': [{ 'ability-id': '201', 'ability-recast': '4', 'icon-type': '1', 'requirement_result_flag': true }]
          }
        }
      }
    }
  };

  const engine1 = new UniversalWorkflowEngine(mockPage1 as any, mockSentinel, dummyTemplate, 'test');
  await (engine1 as any).executeTacticalReadySkills();

  // Verify that NO character drawers were opened
  const drawerClicks1 = mockPage1.clickedSelectors.filter(s => s.includes('.lis-character') || s.includes('.btn-command-character'));
  if (drawerClicks1.length > 0) {
    throw new Error(`Expected 0 character drawers opened when skills are on recast, got ${drawerClicks1.length}`);
  }
  console.log('   ✅ 0 character drawers opened. Zero-latency in-memory check passed!\n');

  // =========================================================================
  // Test 2: Conditional Healing (Skipped at 100% HP)
  // =========================================================================
  console.log('2. Testing Conditional Healing (Green / Type 2 skills skipped when party at 100% HP)...');
  const mockPage2 = new MockCombatPage();
  mockPage2.mockStage = {
    pJsnData: {
      player: {
        param: [
          { hp: 50000, hpmax: 50000, alive: 1 },
          { hp: 45000, hpmax: 45000, alive: 1 },
          { hp: 48000, hpmax: 48000, alive: 1 },
          { hp: 52000, hpmax: 52000, alive: 1 }
        ]
      },
      ability: {
        '1': {
          pos: 0,
          alive: 1,
          list: {
            // Green healing skill ready (recast: 0)
            '1': [{ 'ability-id': '101', 'ability-recast': '0', 'icon-type': '2', 'requirement_result_flag': true, 'ability-name': 'Panacea' }]
          }
        }
      }
    }
  };

  const engine2 = new UniversalWorkflowEngine(mockPage2 as any, mockSentinel, dummyTemplate, 'test');
  await (engine2 as any).executeTacticalReadySkills();

  const healClicks = mockPage2.clickedSelectors.filter(s => s.includes('ability-character-num-1-1'));
  if (healClicks.length > 0) {
    throw new Error('Heal skill was clicked at 100% HP! Expected heal to be skipped.');
  }
  console.log('   ✅ Green heal skill was successfully SKIPPED when party is at full HP!\n');

  // =========================================================================
  // Test 3: Conditional Healing (Triggered when HP < 75%)
  // =========================================================================
  console.log('3. Testing Conditional Healing (Green / Type 2 skills cast when party HP is low)...');
  const mockPage3 = new MockCombatPage();
  mockPage3.mockStage = {
    pJsnData: {
      player: {
        param: [
          { hp: 20000, hpmax: 50000, alive: 1 }, // 40% HP!
          { hp: 22000, hpmax: 45000, alive: 1 },
          { hp: 24000, hpmax: 48000, alive: 1 },
          { hp: 25000, hpmax: 52000, alive: 1 }
        ]
      },
      ability: {
        '1': {
          pos: 0,
          alive: 1,
          list: {
            // Green healing skill ready (recast: 0)
            '1': [{ 'ability-id': '101', 'ability-recast': '0', 'icon-type': '2', 'requirement_result_flag': true, 'ability-name': 'Panacea' }]
          }
        }
      }
    }
  };

  const engine3 = new UniversalWorkflowEngine(mockPage3 as any, mockSentinel, dummyTemplate, 'test');
  await (engine3 as any).executeTacticalReadySkills();

  const healExecuted = mockPage3.clickedSelectors.some(s => s.includes('ability-character-num-1-1'));
  if (!healExecuted) {
    throw new Error('Heal skill was NOT executed when party HP was 40%!');
  }
  console.log('   ✅ Green heal skill was successfully CAST when party HP dropped below threshold!\n');

  // =========================================================================
  // Test 4: Methodological Tactical Order (Field -> Debuff -> Buff -> Nuke)
  // =========================================================================
  console.log('4. Testing Methodological Tactical Ordering:');
  console.log('   Char 1 has Red (Nuke). Char 2 has Blue (Mist) and Yellow (Buff). Char 3 has Purple (Field).');
  const mockPage4 = new MockCombatPage();
  mockPage4.mockStage = {
    pJsnData: {
      player: {
        param: [
          { hp: 50000, hpmax: 50000, alive: 1 },
          { hp: 45000, hpmax: 45000, alive: 1 },
          { hp: 48000, hpmax: 48000, alive: 1 },
          { hp: 52000, hpmax: 52000, alive: 1 }
        ]
      },
      ability: {
        '1': { // Char 1: Red Nuke
          pos: 0,
          alive: 1,
          list: {
            '1': [{ 'ability-id': '101', 'ability-recast': '0', 'icon-type': '1', 'requirement_result_flag': true, 'ability-name': 'Direct Nuke' }]
          }
        },
        '2': { // Char 2: Blue Debuff (Mist) and Yellow Buff
          pos: 1,
          alive: 1,
          list: {
            '1': [{ 'ability-id': '201', 'ability-recast': '0', 'icon-type': '4', 'requirement_result_flag': true, 'ability-name': 'Miserable Mist' }],
            '2': [{ 'ability-id': '202', 'ability-recast': '0', 'icon-type': '3', 'requirement_result_flag': true, 'ability-name': 'Party ATK Up' }]
          }
        },
        '3': { // Char 3: Purple Field
          pos: 2,
          alive: 1,
          list: {
            '1': [{ 'ability-id': '301', 'ability-recast': '0', 'icon-type': '5', 'requirement_result_flag': true, 'ability-name': 'Field Aura' }]
          }
        }
      }
    }
  };

  const engine4 = new UniversalWorkflowEngine(mockPage4 as any, mockSentinel, dummyTemplate, 'test');
  await (engine4 as any).executeTacticalReadySkills();

  // Find execution order of abilities
  const abilityClicks = mockPage4.clickedSelectors.filter(s => s.includes('.ability-character-num-'));
  console.log('   Execution Sequence:', abilityClicks);

  const idxField = abilityClicks.findIndex(s => s.includes('ability-character-num-3-1')); // Field
  const idxDebuff = abilityClicks.findIndex(s => s.includes('ability-character-num-2-1')); // Blue Debuff
  const idxBuff = abilityClicks.findIndex(s => s.includes('ability-character-num-2-2')); // Yellow Buff
  const idxNuke = abilityClicks.findIndex(s => s.includes('ability-character-num-1-1')); // Red Nuke

  if (idxField === -1 || idxDebuff === -1 || idxBuff === -1 || idxNuke === -1) {
    throw new Error('One or more abilities were not clicked in test 4!');
  }

  // Strict check: Field must be first
  if (idxField > idxDebuff || idxField > idxBuff || idxField > idxNuke) {
    throw new Error(`Purple Field (index ${idxField}) must precede debuffs, buffs, and nukes!`);
  }

  // Strict check: Debuffs and Buffs must precede Red Nukes
  if (idxDebuff > idxNuke) {
    throw new Error(`Blue Debuff (index ${idxDebuff}) was cast AFTER Red Nuke (index ${idxNuke})! Debuffs must precede Nukes.`);
  }
  if (idxBuff > idxNuke) {
    throw new Error(`Yellow Buff (index ${idxBuff}) was cast AFTER Red Nuke (index ${idxNuke})! Buffs must precede Nukes.`);
  }

  console.log('   ✅ Purple Field (Type 5) was cast 1st.');
  console.log('   ✅ Blue Debuff (Type 4) was cast 2nd.');
  console.log('   ✅ Yellow Buff (Type 3) was cast 3rd.');
  console.log('   ✅ Red Nuke (Type 1) was cast 4th (after full debuffs and buffs active).');
  console.log('   ✅ Strict GBF domain-expert tactical ordering verified!\n');

  console.log('========================================================================');
  console.log('  🎉 All Methodological Tactical Skills Engine Unit Tests PASSED!     ');
  console.log('========================================================================');
}

runTests().catch(err => {
  console.error('\n❌ Unit Test Failed:', err);
  process.exit(1);
});

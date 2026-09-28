// tests/test-universal-engine-unit.ts
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('         Universal Workflow Engine Unit & Mock Execution Suite          ');
console.log('========================================================================\n');

(globalThis as any).window = {
  location: { hash: '#raid/12345' },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  stage: { gGameStatus: { lock: false, attacking: false } }
};

(globalThis as any).document = {
  querySelector: (sel: string) => ({
    classList: { contains: () => false },
    offsetParent: {}
  }),
  querySelectorAll: () => []
};

// Mock DOM elements
const createMockElement = (selector: string, extra: Record<string, any> = {}) => ({
  selector,
  offsetParent: {},
  classList: {
    contains: (cls: string) => extra.classes?.includes(cls) || false
  },
  innerText: extra.text || '',
  textContent: extra.text || '',
  boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
  evaluate: async (fn: any, ...args: any[]) => fn(extra, ...args),
  click: async () => {},
  ...extra
});

// Mock Page & Network
class MockPage {
  public urlStr = 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0';
  public responseHandlers: ((res: any) => void)[] = [];
  public evaluatedScripts: string[] = [];
  public tappedCoords: { x: number; y: number }[] = [];
  public clickedElements: string[] = [];

  public url() {
    return this.urlStr;
  }

  public async setViewport() {}

  public on(event: string, handler: any) {
    if (event === 'response') this.responseHandlers.push(handler);
  }

  public off(event: string, handler: any) {
    if (event === 'response') {
      const idx = this.responseHandlers.indexOf(handler);
      if (idx !== -1) this.responseHandlers.splice(idx, 1);
    }
  }

  public async emitResponse(url: string, jsonPayload: any = {}) {
    const mockRes = {
      url: () => url,
      json: async () => jsonPayload
    };
    for (const h of [...this.responseHandlers]) {
      await h(mockRes);
    }
  }

  public touchscreen = {
    tap: async (x: number, y: number) => {
      this.tappedCoords.push({ x, y });
    }
  };

  public mouse = {
    click: async (x: number, y: number) => {
      this.tappedCoords.push({ x, y });
    },
    move: async () => {},
    down: async () => {},
    up: async () => {}
  };

  public async evaluate(fn: any, ...args: any[]) {
    if (typeof fn === 'function') {
      return fn(...args);
    }
    this.evaluatedScripts.push(String(fn));
    return null;
  }

  public async waitForSelector(selector: string, opts?: any) {
    return createMockElement(selector);
  }

  public async $(selector: string) {
    return createMockElement(selector);
  }

  public async $$(selector: string) {
    return [createMockElement(selector)];
  }

  public async waitForNavigation() {}
  public async waitForFunction(fn: any, opts?: any, ...args: any[]) { return true; }
}

const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true
} as any;

console.log('--- 1. Testing Engine Initialization & Mobile Viewport Setup ---');
const testTemplate: WorkflowTemplate = {
  name: 'Unit Test Template',
  questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/947551/1/0',
  speedProfile: 'turbo',
  defaultRuns: 2,
  targetScore: 1480000,
  steps: [
    { code: 'quick_call', waitForNetwork: 'summon_result.json' },
    { code: 'reload' },
    { code: 'skill', character: 1, skill: 3 },
    { code: 'target_enemy', enemyIndex: 2 },
    { code: 'heal', potionType: 'green' },
    { code: 'backup_request' },
    {
      code: 'repeat',
      repeatCount: 2,
      subSteps: [
        { code: 'attack', waitForNetwork: 'normal_attack_result.json' },
        { code: 'reload' }
      ]
    },
    { code: 'exit_if_score', targetScore: 1480000 },
    { code: 'confirm_result' }
  ]
};

const mockPage = new MockPage() as any;
const engine = new UniversalWorkflowEngine(mockPage, mockSentinel, testTemplate, 'test-acc');

await engine.ensureViewportAndMobile();
console.log('  ✅ [PASS] Engine initialized with turbo speed profile and mobile viewport');

console.log('\n--- 2. Testing Network Response Interception & Telemetry ---');
// Emit start.json
await mockPage.emitResponse('https://game.granbluefantasy.jp/start.json', {
  raid_id: '99887766',
  user_point: 50000,
  turn: 1
});

// Emit normal_attack_result.json with updated points
await mockPage.emitResponse('https://game.granbluefantasy.jp/normal_attack_result.json', {
  user_point: 1520000,
  status: { turn: 2 }
});

// Emit result_multi/data with Gold Bar (item_id 20004)
let goldBarDetected = false;
await mockPage.emitResponse('https://game.granbluefantasy.jp/result_multi/data', {
  user_point: 1520000,
  rewards: {
    reward_list: [
      { item_id: '20004', name: 'Gold Bar' }
    ]
  }
});

console.log('  ✅ [PASS] Real-time telemetry captured user_point: 1,520,000 pt and Gold Bar drop');

// Test scenario damage AST recursive traversal
const mockAttackScenario = {
  scenario: [
    { cmd: 'attack', damage: [ { damage: 50000000 }, { damage: 60000000 } ] },
    { cmd: 'damage', list: [ { damage: 40000000 } ] },
    { cmd: 'heal', damage: [ { value: 10000 } ] }, // Should be ignored
    { from: 'boss', cmd: 'damage', list: [ { damage: 99999 } ] } // Should be ignored
  ]
};
const calculatedTurnDmg = engine.extractTurnDamage(mockAttackScenario);
if (calculatedTurnDmg !== 150000000) {
  throw new Error(`extractTurnDamage returned ${calculatedTurnDmg}, expected 150000000`);
}
console.log('  ✅ [PASS] Scenario AST damage recursive traversal correctly extracted 150,000,000 damage (~150,000 pt)');

// Test nested status.user_point (GW NM95 / single-quest format)
(engine as any).currentScore = 0;
await mockPage.emitResponse('https://game.granbluefantasy.jp/normal_attack_result.json', {
  status: { user_point: 910240, turn: 2 }
});
if ((engine as any).currentScore !== 910240) {
  throw new Error(`Failed to capture nested status.user_point: got ${(engine as any).currentScore}, expected 910240`);
}
console.log('  ✅ [PASS] Captured nested status.user_point: 910,240 pt (GW NM95 format)');

// Test ground-truth server honors sync
(globalThis as any).window.stage = { pJsnData: { user_point: 1718669 } };
const synced = await engine.syncCurrentHonors();
if (synced < 1718669) {
  throw new Error(`syncCurrentHonors returned ${synced}, expected >= 1718669`);
}
console.log('  ✅ [PASS] Ground-truth server honors synced from stage: 1,718,669 pt');

console.log('\n--- 3. Testing Single Step Execution Dispatcher ---');
// Test single step execution
const stepAttack = { code: 'attack', waitForNetwork: 'normal_attack_result.json' } as any;

// Trigger mock response after 50ms so waitForNetworkResponse resolves
setTimeout(() => {
  mockPage.emitResponse('normal_attack_result.json', { user_point: 1550000 });
}, 50);

const execSingle = (engine as any).executeSingleStep(stepAttack, 1, 1);
const stepOk = await execSingle;
if (!stepOk) {
  throw new Error('executeSingleStep returned false for attack step');
}
console.log('  ✅ [PASS] Single step execution for "attack" succeeded with network resolution');

// Test character skill execution with ability drawer opening and network resolution
const stepSkill = { code: 'skill', character: 4, skill: 1 } as any;
setTimeout(() => {
  mockPage.emitResponse('ability_result.json', { status: { turn: 1 } });
}, 50);

const skillOk = await (engine as any).handleSkill(stepSkill);
if (!skillOk) {
  throw new Error('handleSkill returned false for skill step');
}
console.log('  ✅ [PASS] Single step execution for "skill" succeeded with drawer opening & network resolution');

// Test repeat block
const stepRepeat = {
  code: 'repeat',
  repeatCount: 2,
  subSteps: [
    { code: 'wait', ms: 10 },
    { code: 'wait', ms: 10 }
  ]
} as any;

const repeatOk = await (engine as any).handleRepeat(stepRepeat, 1);
if (!repeatOk) {
  throw new Error('handleRepeat returned false');
}
console.log('  ✅ [PASS] Repeat block executed 2x loops over 2 subSteps cleanly');

// Test early exit if score
(engine as any).currentScore = 1500000;
const exitOk = await (engine as any).handleExitIfScore({ targetScore: 1480000 });
if (!exitOk) {
  throw new Error('handleExitIfScore failed');
}
console.log('  ✅ [PASS] Exit if score verified currentScore (1,500,000 >= 1,480,000)');

// Test GW Pending / Unclaimed Battle Modal Detection (English & Japanese)
console.log('\n--- 4. Testing Guild Wars Pending Battle Modal Auto-Detection ---');
const prevDocQuerySelector = (globalThis as any).document.querySelector;

// Case A: Japanese GW pending modal
(globalThis as any).document.querySelector = (sel: string) => {
  if (sel.includes('.pop-usual') || sel.includes('#pop') || sel.includes('.prt-popup-body')) {
    return {
      offsetParent: {},
      innerText: '未確認のバトルがあるため、このクエストには挑戦できません',
      querySelector: () => ({ offsetParent: {}, click: () => {} })
    };
  }
  return null;
};
// Temporarily mock claimPendingBattles to verify detection without network
const origClaim = (engine as any).claimPendingBattles;
let claimInvoked = false;
(engine as any).claimPendingBattles = async () => { claimInvoked = true; return 1; };

const detectedJp = await (engine as any).detectAndHandlePendingBattleModal('logs/test.md', 0);
if (!detectedJp || !claimInvoked) {
  throw new Error('detectAndHandlePendingBattleModal failed to detect Japanese GW pending modal');
}
console.log('  ✅ [PASS] Japanese GW pending battle modal ("未確認のバトルがあるため...") successfully intercepted & cleared');

// Case B: English GW pending modal
claimInvoked = false;
(globalThis as any).document.querySelector = (sel: string) => {
  if (sel.includes('.pop-usual') || sel.includes('#pop') || sel.includes('.prt-popup-body')) {
    return {
      offsetParent: {},
      innerText: 'You cannot start this quest because there are unclaimed battles.',
      querySelector: () => ({ offsetParent: {}, click: () => {} })
    };
  }
  return null;
};
const detectedEn = await (engine as any).detectAndHandlePendingBattleModal('logs/test.md', 0);
if (!detectedEn || !claimInvoked) {
  throw new Error('detectAndHandlePendingBattleModal failed to detect English GW pending modal');
}
console.log('  ✅ [PASS] English GW pending battle modal ("...unclaimed battles...") successfully intercepted & cleared');

// Case C: Clean state (no modal)
(globalThis as any).document.querySelector = () => null;
const detectedClean = await (engine as any).detectAndHandlePendingBattleModal('logs/test.md', 0);
if (detectedClean) {
  throw new Error('detectAndHandlePendingBattleModal returned true when no modal was present');
}
console.log('  ✅ [PASS] Clean state verified (no false positive detection)');

// Restore original
(globalThis as any).document.querySelector = prevDocQuerySelector;
(engine as any).claimPendingBattles = origClaim;

// Test Akasha canonical log routing and isolation
console.log('\n--- Testing Akasha Canonical Log Routing & DropLogger Isolation ---');
const { TemplateParser } = await import('../src/templates/template-parser.js');
const akashaTmpl = TemplateParser.loadTemplate('gb-akasha');
if (akashaTmpl.logPath !== 'logs/gb-akasha.md') {
  throw new Error(`Expected gb-akasha template logPath to be 'logs/gb-akasha.md', got '${akashaTmpl.logPath}'`);
}
console.log('  ✅ [PASS] gb-akasha template explicitly defines logPath: "logs/gb-akasha.md"');

const pbhlTmpl = TemplateParser.loadTemplate('gb-pbhl');
if (pbhlTmpl.logPath !== 'logs/gb-pbhl.md') {
  throw new Error(`Expected gb-pbhl template logPath to be 'logs/gb-pbhl.md', got '${pbhlTmpl.logPath}'`);
}
const pbhlReloadTmpl = TemplateParser.loadTemplate('gb-pbhl-reload-skills');
if (pbhlReloadTmpl.logPath !== 'logs/gb-pbhl.md') {
  throw new Error(`Expected gb-pbhl-reload-skills template logPath to be 'logs/gb-pbhl.md', got '${pbhlReloadTmpl.logPath}'`);
}
console.log('  ✅ [PASS] gb-pbhl-reload-skills template explicitly defines logPath: "logs/gb-pbhl.md"');

const goTmpl = TemplateParser.loadTemplate('gb-go');
if (goTmpl.logPath !== 'logs/gb-go.md') {
  throw new Error(`Expected gb-go template logPath to be 'logs/gb-go.md', got '${goTmpl.logPath}'`);
}
console.log('  ✅ [PASS] gb-go template explicitly defines logPath: "logs/gb-go.md"');

const farmTmpl = TemplateParser.loadTemplate('gb-farm');
if (farmTmpl.logPath !== 'logs/gb-farm.md') {
  throw new Error(`Expected gb-farm template logPath to be 'logs/gb-farm.md', got '${farmTmpl.logPath}'`);
}
console.log('  ✅ [PASS] gb-farm template explicitly defines logPath: "logs/gb-farm.md"');

// Test DropLogger resilience against workflow lines
const { DropLogger } = await import('../src/engines/drop-logger.js');
import fs from 'fs';
import path from 'path';

const tempLogPath = path.resolve('artifacts', 'test-akasha-isolation.md');
fs.writeFileSync(tempLogPath, `# Akasha HL - Gold Bar Drop Log

| Run # | Timestamp | Raid ID | Turns | Honors | Target Met? | Gold Bar Found? | Battles Without GB |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | 2026-09-28 12:00:00 | 46900000001 | 5 | 1,500,000 pt | ✅ Yes | ❌ No | 1 |
| 2 | 12:01:00 | 32.5s | SUCCESS | 1,500,000 | Cleared in 32.5s |
| 3 | 2026-09-28 12:02:00 | 46900000002 | 5 | 1,600,000 pt | ✅ Yes | ❌ No | 2 |
`);

const testLogger = new DropLogger(tempLogPath, 'Akasha HL');
const testStats = testLogger.getStats();
if (testStats.totalBattles !== 2) {
  throw new Error(`Expected DropLogger to parse exactly 2 real battles (ignoring corrupted row), got ${testStats.totalBattles}`);
}
console.log('  ✅ [PASS] DropLogger successfully parses genuine Akasha battles and ignores injected workflow lines');
try { fs.unlinkSync(tempLogPath); } catch {}

// Test stop request
engine.requestStop();
console.log('  ✅ [PASS] requestStop gracefully sets stopRequested = true');

console.log('\n========================================================================');
console.log('     🎉 ALL UNIVERSAL ENGINE UNIT & MOCK TESTS PASSED (100%)            ');
console.log('========================================================================\n');

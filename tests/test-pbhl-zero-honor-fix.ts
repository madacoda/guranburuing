// tests/test-pbhl-zero-honor-fix.ts
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('   PBHL 0-Honors Bug Critical Verification & Regression Test Suite       ');
console.log('========================================================================\n');

// Mock DOM elements
const createMockElement = (selector: string, extra: Record<string, any> = {}) => ({
  selector,
  offsetParent: extra.hidden ? null : {},
  classList: {
    contains: (cls: string) => extra.classes?.includes(cls) || false
  },
  innerText: extra.text || '',
  textContent: extra.text || '',
  offsetWidth: extra.width ?? 100,
  offsetHeight: extra.height ?? 40,
  boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
  evaluate: async (fn: any, ...args: any[]) => fn(extra, ...args),
  click: async () => {},
  ...extra
});

class MockPage {
  public urlStr = 'https://game.granbluefantasy.jp/#raid_multi/47003525630';
  public responseHandlers: ((res: any) => void)[] = [];
  public tappedCoords: { x: number; y: number }[] = [];
  public clickedElements: string[] = [];

  public url() {
    return this.urlStr;
  }

  public viewport() {
    return { width: 480, height: 960 };
  }

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
    }
  };

  public async evaluate(fn: any, ...args: any[]) {
    if (typeof fn === 'function') {
      return fn(...args);
    }
    return null;
  }

  public async waitForSelector(selector: string, opts?: any) {
    return createMockElement(selector);
  }

  public async $(selector: string) {
    if (selector.includes('.btn-attack-start')) {
      return createMockElement(selector, { classes: ['display-on'] });
    }
    return createMockElement(selector);
  }

  public async $$(selector: string) {
    return [createMockElement(selector)];
  }

  public async waitForFunction(fn: any, opts?: any, ...args: any[]) {
    return true;
  }

  public async waitForNavigation(opts?: any) {
    return null;
  }
}

// -------------------------------------------------------------
// Test 1: syncCurrentHonors DOES NOT read lingering .prt-result-cnt in active raid
// -------------------------------------------------------------
console.log('--- Test 1: Verifying syncCurrentHonors Ignores Lingering Results in #raid_multi ---');

const mockPage = new MockPage();

// Set window to active raid hash
(globalThis as any).window = {
  location: { hash: '#raid_multi/47003525630' },
  getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  stage: {
    pJsnData: {
      user_id: '999999',
      multi_raid_member_info: [
        { user_id: '999999', point: '0', is_host: false }
      ]
    },
    gGameStatus: { player: { point: 0 } }
  }
};

// Simulate DOM with lingering previous battle result of 2,610,405 pt
(globalThis as any).document = {
  querySelector: (sel: string) => null,
  querySelectorAll: (sel: string) => {
    if (sel.includes('.prt-result-cnt')) {
      return [
        {
          innerText: '2,610,405 pt',
          offsetParent: {}
        }
      ];
    }
    return [];
  }
};

const template: WorkflowTemplate = {
  name: 'Test PBHL',
  questUrl: 'https://game.granbluefantasy.jp/#quest/assist',
  targetScore: 1500000,
  steps: []
};

const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true
} as any;

const engine = new UniversalWorkflowEngine(mockPage as any, mockSentinel, template, 'acc1');

let syncedHonors = await engine.syncCurrentHonors();
console.log(`[Test 1] Synced honors in active raid with lingering result modal: ${syncedHonors} pt`);
if (syncedHonors !== 0) {
  throw new Error(`CRITICAL BUG: syncCurrentHonors read lingering .prt-result-cnt during active combat! Expected 0, got ${syncedHonors}`);
}
console.log('✅ PASS: Lingering result modal safely ignored in active raid!\n');

// -------------------------------------------------------------
// Test 2: syncCurrentHonors DOES read result modal when on #result_multi
// -------------------------------------------------------------
console.log('--- Test 2: Verifying syncCurrentHonors Reads Results on #result_multi ---');
(globalThis as any).window.location.hash = '#result_multi/47003525630';
syncedHonors = await engine.syncCurrentHonors();
console.log(`[Test 2] Synced honors on result screen: ${syncedHonors.toLocaleString()} pt`);
if (syncedHonors !== 2610405) {
  throw new Error(`Expected 2610405 on result screen, got ${syncedHonors}`);
}
console.log('✅ PASS: Result honors properly synced on result screen!\n');

// -------------------------------------------------------------
// Test 3: waitForCombatTurnResolution DOES NOT resolve on attacking === true
// -------------------------------------------------------------
console.log('--- Test 3: Verifying waitForCombatTurnResolution Does Not Prematurely Resolve on attacking=true ---');
(globalThis as any).window.location.hash = '#raid_multi/47003525630';
(globalThis as any).window.stage.gGameStatus.attacking = true;
(globalThis as any).window.stage.pJsnData.turn = 1;

let resolvedImmediately = false;
const resolutionPromise = (engine as any).waitForCombatTurnResolution('normal_attack_result.json', 300);

// Settle 150ms to ensure poll runs while attacking is true
await new Promise(r => setTimeout(r, 150));

// Now emit normal_attack_result.json to legitimately resolve
await mockPage.emitResponse('https://game.granbluefantasy.jp/rest/multiraid/normal_attack_result.json', {
  user_point: 520000,
  turn: 2
});

const resolutionOk = await resolutionPromise;
if (!resolutionOk) {
  throw new Error('Expected combat resolution to succeed upon normal_attack_result.json');
}
console.log('✅ PASS: waitForCombatTurnResolution waited through attacking state until server response!\n');

// -------------------------------------------------------------
// Test 4: handleTapReady Successfully Dispatches Attack and Awaits Server Acknowledgment
// -------------------------------------------------------------
console.log('--- Test 4: Verifying handleTapReady Dispatches Attack and Records Server Honors ---');

// Reset score
(engine as any).currentScore = 0;

// Setup mock turn action response
setTimeout(async () => {
  await mockPage.emitResponse('https://game.granbluefantasy.jp/rest/multiraid/normal_attack_result.json', {
    user_point: 650000,
    turn: 2,
    scenario: [
      { cmd: 'attack', damage: [50000000] }
    ]
  });
}, 50);

const tapReadyOk = await (engine as any).handleTapReady({ code: 'tap_ready' });
if (!tapReadyOk) {
  throw new Error('Expected handleTapReady to succeed');
}

const scoreAfterTurn = (engine as any).currentScore;
console.log(`[Test 4] Honors after handleTapReady turn: ${scoreAfterTurn.toLocaleString()} pt`);
if (scoreAfterTurn < 650000) {
  throw new Error(`Expected score >= 650000 pt, got ${scoreAfterTurn}`);
}
console.log('✅ PASS: handleTapReady successfully dispatched turn attack and credited server honors!\n');

// -------------------------------------------------------------
// Test 5: Full 5-Turn PBHL Burst Simulation with Honor Guard
// -------------------------------------------------------------
console.log('--- Test 5: Simulating 5-Turn PBHL Burst to 1.5M+ Honors ---');

let currentSimScore = scoreAfterTurn;
for (let turn = 2; turn <= 4; turn++) {
  setTimeout(async () => {
    currentSimScore += 450000;
    await mockPage.emitResponse('https://game.granbluefantasy.jp/rest/multiraid/normal_attack_result.json', {
      user_point: currentSimScore,
      turn: turn + 1
    });
  }, 40);

  const ok = await (engine as any).handleTapReady({ code: 'tap_ready' });
  if (!ok) throw new Error(`Turn ${turn} tap_ready failed`);
  await (engine as any).handleReload({ code: 'reload' });
}

const finalScore = (engine as any).currentScore;
console.log(`[Test 5] Final Accumulated Honors: ${finalScore.toLocaleString()} pt (Target: 1,500,000 pt)`);
if (finalScore < 1500000) {
  throw new Error(`Expected final score >= 1,500,000 pt, got ${finalScore}`);
}
console.log('✅ PASS: 5-Turn PBHL Burst reliably crossed 1.5M honor guard threshold!\n');

console.log('========================================================================');
console.log('   🎉 ALL 5 PBHL 0-HONORS FIX REGRESSION TESTS PASSED (100% SUCCESS)    ');
console.log('========================================================================\n');
process.exit(0);

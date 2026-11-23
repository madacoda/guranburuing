// tests/test-step-monitor-and-enforcer.ts
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { CombatActionService } from '../src/services/combat/combat-action.service.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('   Step Execution Monitor & Closed-Loop Cast Enforcer Test Suite        ');
console.log('========================================================================\n');

const createMockElement = (selector: string, extra: Record<string, any> = {}) => ({
  selector,
  offsetParent: {},
  offsetWidth: 50,
  classList: {
    contains: (cls: string) => extra.classes?.includes(cls) || false
  },
  getAttribute: (attr: string) => extra.attributes?.[attr] ?? null,
  querySelector: () => null,
  closest: () => null,
  innerText: extra.text || '',
  textContent: extra.text || '',
  boundingBox: async () => ({ x: 100, y: 100, width: 100, height: 40 }),
  evaluate: async (fn: any, ...args: any[]) => fn(extra, ...args),
  click: async () => {},
  ...extra
});

class EnforcerMockPage {
  public urlStr = 'https://game.granbluefantasy.jp/#raid_multi/123456';
  public responseHandlers: ((res: any) => void)[] = [];
  public requestHandlers: ((req: any) => void)[] = [];
  public mockStage: any = {};
  public domAbilities: Record<string, { recast: string; available: boolean; name: string; id: string }> = {};
  public popupOpen = false;
  public targetPopupOpen = false;
  public targetPickedIndex: number | null = null;
  public skillTapCount = 0;
  public onSkillTap?: () => void;
  public customAtkBtn: any = null;

  public url() {
    return this.urlStr;
  }

  public async setViewport() {}

  public on(event: string, handler: any) {
    if (event === 'response') this.responseHandlers.push(handler);
    if (event === 'request') this.requestHandlers.push(handler);
  }

  public off(event: string, handler: any) {
    if (event === 'response') {
      const idx = this.responseHandlers.indexOf(handler);
      if (idx !== -1) this.responseHandlers.splice(idx, 1);
    }
    if (event === 'request') {
      const idx = this.requestHandlers.indexOf(handler);
      if (idx !== -1) this.requestHandlers.splice(idx, 1);
    }
  }

  public async emitRequest(url: string) {
    const mockReq = {
      url: () => url
    };
    for (const h of [...this.requestHandlers]) {
      await h(mockReq);
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
    tap: async () => {}
  };

  public mouse = {
    click: async () => {},
    move: async () => {},
    down: async () => {},
    up: async () => {}
  };

  public async $(selector: string) {
    return createMockElement(selector);
  }

  public async $$(selector: string) {
    return [createMockElement(selector)];
  }

  public async waitForSelector(selector: string) {
    return createMockElement(selector);
  }

  public async waitForNavigation() {}
  public async waitForFunction() {
    return true;
  }

  public async evaluate(fn: any, ...args: any[]) {
    if (typeof fn !== 'function') return null;

    const origWindow = (globalThis as any).window;
    const origDoc = (globalThis as any).document;
    const self = this;

    (globalThis as any).window = {
      location: { hash: '#raid_multi/123456' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      stage: this.mockStage
    };

    const makeAbilityNode = (key: string) => {
      const state = self.domAbilities[key] || { recast: '0', available: true, name: 'Test Skill', id: '9001' };
      const node: any = {
        offsetParent: {},
        offsetWidth: 60,
        classList: {
          contains: (cls: string) => {
            if (cls === 'btn-ability-available') return state.available;
            if (cls === 'btn-ability-unavailable' || cls === 'tmp-unusable') return !state.available;
            return false;
          }
        },
        getAttribute: (attr: string) => {
          if (attr === 'ability-recast') return state.recast;
          if (attr === 'ability-name') return state.name;
          if (attr === 'ability-id') return state.id;
          return null;
        },
        closest: () => node,
        querySelector: (subSel: string) => {
          if (subSel.includes('btn-ability-available') && state.available) return node;
          if (subSel.includes('btn-ability-unavailable') && !state.available) return node;
          return null;
        },
        click: () => {
          self.skillTapCount++;
          self.onSkillTap?.();
        }
      };
      return node;
    };

    (globalThis as any).document = {
      querySelector: (sel: string) => {
        const abMatch = sel.match(/\.ability-character-num-(\d+)-(\d+)/);
        if (abMatch) {
          return makeAbilityNode(`${abMatch[1]}-${abMatch[2]}`);
        }
        if (sel.includes('.prt-command-chara')) {
          return { offsetParent: {}, offsetWidth: 200, classList: { contains: () => true } };
        }
        if (sel.includes('.pop-processing') && self.popupOpen) {
          return {
            offsetParent: {},
            offsetWidth: 200,
            querySelector: () => ({
              offsetParent: {},
              click: () => {
                self.popupOpen = false;
              }
            })
          };
        }
        if (sel.includes('.btn-attack-start')) {
          if (self.customAtkBtn) return self.customAtkBtn;
          return {
            offsetParent: {},
            offsetWidth: 100,
            classList: { contains: (c: string) => c === 'display-on' },
            click: () => {}
          };
        }
        if (sel.includes('.lis-character0')) {
          return {
            offsetParent: {},
            offsetWidth: 60,
            classList: { contains: () => false },
            click: () => {
              self.targetPickedIndex = 0;
              self.targetPopupOpen = false;
            }
          };
        }
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel.includes('.pop-select-member') && self.targetPopupOpen) {
          return [
            {
              offsetParent: {},
              offsetWidth: 240,
              querySelector: (sub: string) => {
                if (sub.includes('0')) {
                  return {
                    offsetParent: {},
                    click: () => {
                      self.targetPickedIndex = 0;
                      self.targetPopupOpen = false;
                    }
                  };
                }
                return null;
              }
            }
          ];
        }
        return [];
      }
    };

    try {
      return await fn(...args);
    } finally {
      (globalThis as any).window = origWindow;
      (globalThis as any).document = origDoc;
    }
  }
}

const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true
} as any;

async function runTests() {
  // =========================================================================
  // Test 1: Closed-Loop Enforcer Lockout Popup Recovery (Attempt 1 Lockout -> Attempt 2 Confirmed)
  // =========================================================================
  console.log('1. Testing Closed-Loop Enforcer Recovery on Server Lockout Popup...');
  const page1 = new EnforcerMockPage();
  page1.domAbilities['4-3'] = { recast: '0', available: true, name: 'Radiantaza', id: '4003' };
  page1.mockStage = {
    gGameStatus: { lock: false, attacking: false, turn: 1, boss: { param: [{ hp: 500000000, hpmax: 500000000 }] } },
    pJsnData: {
      turn: 1,
      boss: { param: [{ hp: 500000000, hpmax: 500000000 }] },
      ability: {
        '4': {
          pos: 3,
          list: {
            '3': [{ 'ability-id': '4003', 'ability-name': 'Radiantaza', 'ability-recast': '0', requirement_result_flag: true }]
          }
        }
      }
    }
  };

  const tmpl1: WorkflowTemplate = {
    name: 'Enforcer Lockout Test',
    questUrl: 'https://game.granbluefantasy.jp/#quest/assist',
    speedProfile: 'turbo',
    steps: [
      { code: 'skill', character: 4, skill: 3, ensureCast: true, waitForNetwork: 'ability_result.json' }
    ]
  };

  const engine1 = new UniversalWorkflowEngine(page1 as any, mockSentinel, tmpl1, 'test-acc');
  engine1.stepMonitor.beginRun(1);

  // First response at 40ms is a server lockout popup (no scenario); second response at 260ms is the actual cast
  setTimeout(() => {
    page1.popupOpen = true;
    page1.emitResponse('https://game.granbluefantasy.jp/rest/raid/ability_result.json', {
      popup: { body: 'Waiting for last turn to be processed.' }
    });
  }, 40);

  setTimeout(() => {
    page1.domAbilities['4-3'].recast = '6';
    page1.domAbilities['4-3'].available = false;
    page1.mockStage.pJsnData.ability['4'].list['3'][0]['ability-recast'] = '6';
    page1.emitResponse('https://game.granbluefantasy.jp/rest/raid/ability_result.json', {
      status: { turn: 1 },
      scenario: [{ cmd: 'ability', name: 'Radiantaza' }, { cmd: 'damage', list: [{ damage: 8500000 }] }]
    });
  }, 260);

  const ok1 = await engine1.executeSingleStep(tmpl1.steps[0], 1, 1);
  if (!ok1) {
    throw new Error('Expected handleSkill to recover from lockout popup and return true');
  }

  const receipt1 = engine1.ctx.state.lastStepReceipt;
  if (!receipt1 || !receipt1.verified || receipt1.status !== 'CONFIRMED_NETWORK') {
    throw new Error(`Expected CONFIRMED_NETWORK receipt after lockout recovery, got ${JSON.stringify(receipt1)}`);
  }
  if (receipt1.attempts < 2) {
    throw new Error(`Expected attempts >= 2 after lockout popup retry, got ${receipt1.attempts}`);
  }
  if (receipt1.recastTransition !== '0->6') {
    throw new Error(`Expected recastTransition "0->6", got "${receipt1.recastTransition}"`);
  }
  if (receipt1.damageDealt !== 8500000) {
    throw new Error(`Expected damageDealt 8500000, got ${receipt1.damageDealt}`);
  }
  console.log(`   ✅ Lockout popup recovered on Attempt ${receipt1.attempts} | Recast: ${receipt1.recastTransition} | Dmg: ${receipt1.damageDealt.toLocaleString()}\n`);

  // =========================================================================
  // Test 2: Authoritative In-Game State Mutation Proof (When Network Event Coalesced)
  // =========================================================================
  console.log('2. Testing In-Game State Mutation Proof (recast 0 -> 7 transition without XHR event)...');
  const page2 = new EnforcerMockPage();
  page2.domAbilities['1-3'] = { recast: '0', available: true, name: ' splitting_spirit ', id: '1003' };
  page2.mockStage = {
    gGameStatus: { lock: false, attacking: false, turn: 1 },
    pJsnData: {
      turn: 1,
      ability: {
        '1': {
          pos: 0,
          list: {
            '3': [{ 'ability-id': '1003', 'ability-name': 'Splitting Spirit', 'ability-recast': '0', requirement_result_flag: true }]
          }
        }
      }
    }
  };

  const engine2 = new UniversalWorkflowEngine(page2 as any, mockSentinel, tmpl1, 'test-acc');
  engine2.stepMonitor.beginRun(1);

  // Mutate in-game state to cooldown after 80ms WITHOUT emitting ability_result.json
  setTimeout(() => {
    page2.domAbilities['1-3'].recast = '7';
    page2.domAbilities['1-3'].available = false;
    page2.mockStage.pJsnData.ability['1'].list['3'][0]['ability-recast'] = '7';
  }, 80);

  const step2 = { code: 'skill' as const, character: 1, skill: 3, ensureCast: true };
  const ok2 = await engine2.executeSingleStep(step2, 1, 1);
  if (!ok2) {
    throw new Error('Expected handleSkill to confirm cast via in-game cooldown state mutation');
  }

  const receipt2 = engine2.ctx.state.lastStepReceipt;
  if (!receipt2 || receipt2.status !== 'CONFIRMED_STATE_MUTATION' || !receipt2.verified) {
    throw new Error(`Expected CONFIRMED_STATE_MUTATION receipt, got ${JSON.stringify(receipt2)}`);
  }
  if (receipt2.recastTransition !== '0->7') {
    throw new Error(`Expected recastTransition "0->7", got "${receipt2.recastTransition}"`);
  }
  console.log(`   ✅ State mutation verified (${receipt2.status}, Recast: ${receipt2.recastTransition})!\n`);

  // =========================================================================
  // Test 3: Tactical Auto Targeted Skill (requiresPick) Target Selection Before Network Wait
  // =========================================================================
  console.log('3. Testing Tactical Auto requiresPick Target Selection Ordering...');
  const page3 = new EnforcerMockPage();
  page3.targetPopupOpen = true;
  page3.domAbilities['2-1'] = { recast: '0', available: true, name: 'Hinrichten', id: '2001' };
  page3.mockStage = {
    pJsnData: {
      player: {
        param: [
          { hp: 50000, hpmax: 50000, alive: 1 },
          { hp: 50000, hpmax: 50000, alive: 1 }
        ]
      },
      ability: {
        '2': {
          pos: 1,
          alive: 1,
          list: {
            '1': [
              {
                'ability-id': '2001',
                'ability-name': 'Hinrichten',
                'ability-recast': '0',
                'icon-type': '3',
                'select_flag': 1,
                requirement_result_flag: true
              }
            ]
          }
        }
      }
    }
  };

  const engine3 = new UniversalWorkflowEngine(page3 as any, mockSentinel, tmpl1, 'test-acc');

  // Only emit ability_result.json AFTER targetPickedIndex === 0
  const watcher = setInterval(() => {
    if (page3.targetPickedIndex === 0) {
      clearInterval(watcher);
      page3.emitResponse('https://game.granbluefantasy.jp/rest/raid/ability_result.json', {
        status: { turn: 1 },
        scenario: [{ cmd: 'ability' }]
      });
    }
  }, 20);

  const t0 = Date.now();
  await engine3.combatExecution.executeTacticalReadySkills();
  clearInterval(watcher);
  const elapsed3 = Date.now() - t0;

  if (page3.targetPickedIndex !== 0) {
    throw new Error('Expected executeTacticalReadySkills to pick target character 0 for requiresPick skill');
  }
  if (elapsed3 > 2000) {
    throw new Error(`Expected requiresPick skill to resolve immediately after target pick (<2000ms), took ${elapsed3}ms`);
  }
  console.log(`   ✅ Targeted tactical skill picked target C1 first and resolved in ${elapsed3}ms!\n`);

  // =========================================================================
  // Test 4: Run Execution Audit Report & Degraded Detection
  // =========================================================================
  console.log('4. Testing RunExecutionAuditReport & Degraded Step Detection...');
  const report1 = engine1.stepMonitor.finalizeRun(1, 1);
  if (!report1.perfectExecution || report1.confirmedSteps !== 1 || report1.retriedSteps !== 1) {
    throw new Error(`Unexpected audit report for engine1: ${JSON.stringify(report1)}`);
  }

  // Record an unacknowledged step and verify perfectExecution becomes false
  engine2.stepMonitor.recordStepReceipt({
    runNumber: 2,
    stepNumber: 2,
    step: { code: 'skill', character: 3, skill: 2 },
    status: 'UNACKNOWLEDGED_CONTINUED',
    verified: false,
    attempts: 3,
    durationMs: 1200,
    networkConfirmed: false,
    stateMutated: false,
    reason: 'Simulated unacknowledged skill'
  });
  const report2 = engine2.stepMonitor.finalizeRun(2, 2);
  if (report2.perfectExecution !== false || report2.unacknowledgedSteps !== 1) {
    throw new Error(`Expected perfectExecution: false and unacknowledgedSteps: 1, got ${JSON.stringify(report2)}`);
  }
  console.log('   ✅ RunExecutionAuditReport accurately distinguishes PERFECT vs DEGRADED runs!\n');

  // =========================================================================
  // Test 5: CombatActionService Closed-Loop triggerSkill
  // =========================================================================
  console.log('5. Testing CombatActionService.triggerSkill Closed-Loop Verification...');
  const page5 = new EnforcerMockPage();
  page5.domAbilities['1-1'] = { recast: '0', available: true, name: 'Engage', id: '1001' };
  const actionSvc = new CombatActionService(page5 as any);
  const outcome5 = await actionSvc.triggerSkill({ character: 1, skill: 1, ensureCast: true });
  if (!outcome5.success || !outcome5.queued) {
    throw new Error(`Expected triggerSkill to succeed, got ${JSON.stringify(outcome5)}`);
  }
  console.log('   ✅ CombatActionService.triggerSkill verified queue/recast cleanly!\n');

  // =========================================================================
  // Test 6: In-Flight Request Tracking Prevents Spam Re-Presses Under Latency
  // =========================================================================
  console.log('6. Testing In-Flight ability_result.json Request Guard (Zero Spam on Slow Response)...');
  const page6 = new EnforcerMockPage();
  page6.domAbilities['2-1'] = { recast: '0', available: true, name: 'War Eternal +', id: '2001' };
  page6.mockStage = {
    gGameStatus: { lock: false, attacking: false, turn: 1, boss: { param: [{ hp: 131250000, hpmax: 131250000 }] } },
    pJsnData: {
      turn: 1,
      boss: { param: [{ hp: 131250000, hpmax: 131250000 }] },
      ability: {
        '2': {
          pos: 1,
          list: {
            '1': [{ 'ability-id': '2001', 'ability-name': 'War Eternal +', 'ability-recast': '0', requirement_result_flag: true }]
          }
        }
      }
    }
  };
  page6.onSkillTap = () => {
    setTimeout(() => {
      page6.emitRequest('https://game.granbluefantasy.jp/rest/raid/ability_result.json');
    }, 30);
    setTimeout(() => {
      page6.domAbilities['2-1'].recast = '6';
      page6.domAbilities['2-1'].available = false;
      page6.mockStage.pJsnData.ability['2'].list['1'][0]['ability-recast'] = '6';
      page6.emitResponse('https://game.granbluefantasy.jp/rest/raid/ability_result.json', {
        status: { turn: 1 },
        scenario: [{ cmd: 'ability', name: 'War Eternal +' }]
      });
    }, 900);
  };

  const tmpl6: WorkflowTemplate = {
    name: 'Enforcer In-Flight Request Guard Test',
    questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/980681/1/0/10116',
    speedProfile: 'turbo',
    humanMotor: true,
    steps: [
      { code: 'skill', character: 2, skill: 1, ensureCast: true, waitForNetwork: 'ability_result.json' }
    ]
  };

  const engine6 = new UniversalWorkflowEngine(page6 as any, mockSentinel, tmpl6, 'test-acc');
  engine6.stepMonitor.beginRun(1);
  const ok6 = await engine6.executeSingleStep(tmpl6.steps[0], 1, 1);
  if (!ok6) {
    throw new Error('Expected handleSkill to confirm slow response after in-flight request');
  }
  const receipt6 = engine6.ctx.state.lastStepReceipt;
  if (!receipt6 || receipt6.status !== 'CONFIRMED_NETWORK' || receipt6.attempts !== 1) {
    throw new Error(`Expected attempts === 1 and CONFIRMED_NETWORK, got ${JSON.stringify(receipt6)}`);
  }
  if (page6.skillTapCount !== 1) {
    throw new Error(`Expected exactly 1 skill tap with in-flight request active, got ${page6.skillTapCount}`);
  }
  if (page6.requestHandlers.length !== 0) {
    throw new Error(`Expected request listener detached after handleSkill, remaining: ${page6.requestHandlers.length}`);
  }
  console.log('   ✅ In-flight request prevented re-tap spam across 900ms latency (1 tap, 1 attempt)!\n');

  // =========================================================================
  // Test 7: waitForBattleToMount Waits For Hydrated Stage After Reload
  // =========================================================================
  console.log('7. Testing waitForBattleToMount Post-Reload Hydration Gate...');
  const page7 = new EnforcerMockPage();
  page7.mockStage = { gGameStatus: {} };
  page7.customAtkBtn = {
    offsetParent: null,
    offsetWidth: 0,
    classList: { contains: (c: string) => c === 'display-off' },
    click: () => {}
  };
  const engine7 = new UniversalWorkflowEngine(page7 as any, mockSentinel, tmpl6, 'test-acc');
  let mounted7 = false;
  const mountPromise7 = engine7.combatResolution.waitForBattleToMount(2500).then(val => {
    mounted7 = val;
    return val;
  });

  await new Promise(r => setTimeout(r, 180));
  if (mounted7) {
    throw new Error('waitForBattleToMount prematurely resolved on unhydrated stage + hidden attack button');
  }

  page7.mockStage.pJsnData = {
    turn: 1,
    boss: { param: [{ hp: 131250000, hpmax: 131250000 }] }
  };
  const finalMounted7 = await mountPromise7;
  if (!finalMounted7) {
    throw new Error('Expected waitForBattleToMount to resolve true once boss.param hydrated');
  }
  console.log('   ✅ waitForBattleToMount waited for hydrated stage before mounting!\n');

  console.log('========================================================================');
  console.log('🎉 ALL STEP EXECUTION MONITOR & ENFORCER TESTS PASSED (100%)');
  console.log('========================================================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

// tests/test-gw-meat-dark.ts
import assert from 'assert';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';

console.log('========================================================================');
console.log('      Guild War (Unite and Fight) Dark Meat Farm Workflow Test Suite     ');
console.log('========================================================================\n');

// -------------------------------------------------------------
// 1. Validate Production Template "gw-meat-dark" & Aliases
// -------------------------------------------------------------
console.log('--- 1. Verifying "gw-meat-dark" Template Schema & Aliases ---');
const template = TemplateParser.loadTemplate('gw-meat-dark');
assert.strictEqual(template.questUrl, 'https://game.granbluefantasy.jp/#quest/supporter/980651/1/0');
assert.strictEqual(template.questId, '980651');
assert.strictEqual(template.element, 'Dark');
assert.strictEqual(template.defaultRuns, 1000);
assert.deepStrictEqual(template.supporterPriority, ['Hades']);
assert.strictEqual(template.steps.length, 4);
assert.strictEqual(template.steps[0].code, 'tap_ready');
assert.strictEqual(template.steps[0].waitForNetwork, 'normal_attack_result.json');
assert.strictEqual(template.steps[1].code, 'attack');
assert.strictEqual(template.steps[1].waitForNetwork, 'normal_attack_result.json');
assert.strictEqual(template.steps[2].code, 'reload');
assert.strictEqual(template.steps[3].code, 'confirm_result');

const validation = validateWorkflowTemplate(template);
assert(validation.valid, `Schema validation failed: ${validation.errors.join(', ')}`);

for (const alias of ['gw-dark-meat', 'gw-dark-meat-farm', 'gw-meat-farm-dark', 'dark-meat', 'dark-meat-farm']) {
  const resolved = TemplateParser.loadTemplate(alias);
  assert.strictEqual(resolved.questUrl, template.questUrl, `Alias ${alias} must resolve to gw-meat-dark`);
}
console.log('  ✅ [PASS] "gw-meat-dark" template and all canonical aliases validated');

// -------------------------------------------------------------
// 2. Natural Language DSL Compilation & Round-Trip Verification
// -------------------------------------------------------------
console.log('\n--- 2. Verifying Natural Language Shorthand DSL Compilation ---');
const rawUserPromptDsl = `
url https://game.granbluefantasy.jp/#quest/supporter/980651/1/0
summon: hades
step:
click on screen tap to the screen to enable/disable auto attack
confirm the attack (if not then click button attack manually after fully loaded screen)
reload

rerun
`;

const compiledFromNaturalDsl = TemplateParser.parseShorthandDsl(rawUserPromptDsl, 'gw-meat-dark');
assert.strictEqual(compiledFromNaturalDsl.questUrl, 'https://game.granbluefantasy.jp/#quest/supporter/980651/1/0');
assert.deepStrictEqual(compiledFromNaturalDsl.supporterPriority, ['Hades']);
assert.strictEqual(compiledFromNaturalDsl.steps.length, 4);
assert.strictEqual(compiledFromNaturalDsl.steps[0].code, 'tap_ready');
assert.strictEqual(compiledFromNaturalDsl.steps[0].waitForNetwork, 'normal_attack_result.json');
assert.strictEqual(compiledFromNaturalDsl.steps[1].code, 'attack');
assert.strictEqual(compiledFromNaturalDsl.steps[1].waitForNetwork, 'normal_attack_result.json');
assert.strictEqual(compiledFromNaturalDsl.steps[2].code, 'reload');
assert.strictEqual(compiledFromNaturalDsl.steps[3].code, 'confirm_result');

const serializedDsl = TemplateParser.serializeToDsl(template);
const reparsedDsl = TemplateParser.parseShorthandDsl(serializedDsl, 'gw-meat-dark');
assert.strictEqual(reparsedDsl.steps.length, template.steps.length);
console.log('  ✅ [PASS] Natural language DSL compiled into exact 4-step pipeline and passed round-trip');

// -------------------------------------------------------------
// 3. Runtime Scenario A & B Mock Verification
// -------------------------------------------------------------
console.log('\n--- 3. Verifying Runtime Execution: Auto-Attack from READY Tap vs Manual Attack Fallback ---');

class GwMeatDarkMockPage {
  public responseHandlers: ((res: any) => void)[] = [];
  public readyVisible = true;
  public autoAttackTriggeredByReady = true;
  public manualAttackClicks = 0;
  public readyTaps = 0;
  public reloadCalls = 0;
  public mouseMoves = 0;
  public mouseDowns = 0;
  public mouseUps = 0;
  public bossHp = 25400000;
  public currentHash = '#raid_multi/980651001';
  public tappedReadyCoords: { x: number; y: number }[] = [];

  public url() {
    return `https://game.granbluefantasy.jp/${this.currentHash}`;
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
      this.tappedReadyCoords.push({ x, y });
    }
  };

  public mouse = {
    click: async () => {},
    move: async () => {
      this.mouseMoves++;
    },
    down: async () => {
      this.mouseDowns++;
    },
    up: async () => {
      this.mouseUps++;
    }
  };

  public async waitForNavigation() {
    return null;
  }

  public async waitForFunction(fn: any, _opts?: any, ...args: any[]) {
    return this.evaluate(fn, ...args);
  }

  public async waitForSelector(sel: string) {
    return this.$(sel);
  }

  public async $(sel: string) {
    if (sel.includes('.btn-attack-start')) {
      const self = this;
      return {
        offsetParent: {},
        offsetWidth: 100,
        offsetHeight: 40,
        classList: { contains: (c: string) => c === 'display-on' },
        boundingBox: async () => ({ x: 320, y: 400, width: 100, height: 40 }),
        evaluate: async (fn: any) =>
          fn({
            offsetParent: {},
            classList: { contains: (c: string) => c === 'display-on' },
            click: () => {
              self.manualAttackClicks++;
              setTimeout(() => {
                self.bossHp = 0;
                self.emitResponse('https://game.granbluefantasy.jp/rest/multiraid/normal_attack_result.json', {
                  user_point: 126120,
                  turn: 2,
                  scenario: [{ cmd: 'attack', damage: [{ damage: 25400000 }] }]
                });
              }, 20);
            }
          }),
        click: async () => {}
      };
    }
    return null;
  }

  public async $$(sel: string) {
    const el = await this.$(sel);
    return el ? [el] : [];
  }

  public async evaluate(fn: any, ...args: any[]) {
    if (typeof fn !== 'function') return null;
    const self = this;
    const origWin = (globalThis as any).window;
    const origDoc = (globalThis as any).document;

    (globalThis as any).window = {
      location: {
        hash: self.currentHash,
        reload: () => {
          self.reloadCalls++;
          if (self.bossHp <= 0) {
            self.currentHash = '#result_multi/980651001';
          }
        }
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
      stage: {
        gGameStatus: { lock: false, attacking: false, turn: 1, boss: { param: [{ hp: self.bossHp, hpmax: 25400000 }] } },
        pJsnData: { turn: 1, boss: { param: [{ hp: self.bossHp, hpmax: 25400000 }] } }
      }
    };
    (globalThis as any).location = (globalThis as any).window.location;

    (globalThis as any).document = {
      elementFromPoint: () => null,
      querySelector: (sel: string) => {
        if (sel.includes('.prt-ready') && self.readyVisible) {
          return {
            offsetParent: {},
            offsetWidth: 240,
            click: () => {
              self.readyTaps++;
              self.readyVisible = false;
              if (self.autoAttackTriggeredByReady) {
                setTimeout(() => {
                  self.bossHp = 0;
                  self.emitResponse('https://game.granbluefantasy.jp/rest/multiraid/normal_attack_result.json', {
                    user_point: 126120,
                    turn: 2,
                    scenario: [{ cmd: 'attack', damage: [{ damage: 25400000 }] }]
                  });
                }, 30);
              }
            }
          };
        }
        if (sel.includes('.btn-attack-start')) {
          return {
            offsetParent: {},
            offsetWidth: 100,
            classList: { contains: (c: string) => c === 'display-on' },
            click: () => {
              self.manualAttackClicks++;
            }
          };
        }
        return null;
      },
      querySelectorAll: () => []
    };

    try {
      return await fn(...args);
    } finally {
      (globalThis as any).window = origWin;
      (globalThis as any).document = origDoc;
    }
  }
}

const mockSentinel = { assertSafe: async () => {}, isArmed: true } as any;

// Scenario A: Tapping READY screen enables Auto Attack -> normal_attack_result.json fires automatically
const pageA = new GwMeatDarkMockPage();
pageA.readyVisible = true;
pageA.autoAttackTriggeredByReady = true;
const engineA = new UniversalWorkflowEngine(pageA as any, mockSentinel, template, 'acc1');

const pipelineA = await (engineA as any).executeStepPipeline(1);
assert.strictEqual(pipelineA, true, 'Pipeline A should succeed');
assert.strictEqual(pageA.readyTaps, 1, 'Scenario A should tap READY screen once');
assert(pageA.mouseMoves > 0, 'Scenario A should execute cubic Bezier cursor trajectory (moveMouseSmoothly) on tap_ready');
assert.strictEqual(pageA.mouseDowns, 1, 'Scenario A should execute physical mouse.down() hold on tap_ready');
assert.strictEqual(pageA.mouseUps, 1, 'Scenario A should execute physical mouse.up() release on tap_ready');
assert.strictEqual(pageA.tappedReadyCoords.length, 1, 'Scenario A should record Gaussian-jittered touchscreen tap on READY');
assert.strictEqual(pageA.manualAttackClicks, 0, 'Scenario A should NOT need manual attack click when READY tap auto-attacks');
assert.strictEqual(pageA.reloadCalls, 1, 'Scenario A should reload once after attack confirmation');
console.log(`  ✅ [PASS] Scenario A (Auto-Attack enabled via READY tap): human motor Bezier moves=${pageA.mouseMoves}, tap=(${pageA.tappedReadyCoords[0].x}, ${pageA.tappedReadyCoords[0].y}), confirmed attack & reloaded`);

// Scenario B: Tapping READY screen disables Auto Attack -> falls back to clicking Attack button manually after screen loads
const pageB = new GwMeatDarkMockPage();
pageB.readyVisible = true;
pageB.autoAttackTriggeredByReady = false;
const engineB = new UniversalWorkflowEngine(pageB as any, mockSentinel, template, 'acc1');

const pipelineB = await (engineB as any).executeStepPipeline(2);
assert.strictEqual(pipelineB, true, 'Pipeline B should succeed');
assert.strictEqual(pageB.readyTaps, 1, 'Scenario B should tap READY screen once');
assert(pageB.manualAttackClicks >= 1, 'Scenario B must click Attack button manually when READY tap disables auto-attack');
assert.strictEqual(pageB.reloadCalls, 1, 'Scenario B should reload once after manual attack confirmation');
console.log('  ✅ [PASS] Scenario B (Auto-Attack disabled via READY tap): waited for full screen load, clicked Attack button manually, confirmed attack, and reloaded');

console.log('\n========================================================================');
console.log('     🎉 ALL GW DARK MEAT FARM WORKFLOW TESTS PASSED (100% SUCCESS)      ');
console.log('========================================================================\n');

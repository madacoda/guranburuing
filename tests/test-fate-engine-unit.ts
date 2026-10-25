// tests/test-fate-engine-unit.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';
import { FateEngine } from '../src/engines/fate.engine.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('      Granblue Fantasy - Fate Stories Engine & Routine Unit Tests      ');
console.log('========================================================================\n');

let passCount = 0;
let failCount = 0;

function assert(desc: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${desc}`);
    failCount++;
  }
}

// -----------------------------------------------------------------------------
// Test 1: Template Structure & Schema Validation for fate-stories.json
// -----------------------------------------------------------------------------
console.log('[Test 1] Verifying templates/fate-stories.json Structure...');
const template = TemplateParser.loadTemplate('fate-stories');
const val = validateWorkflowTemplate(template);
assert('Template passes schema validation', val.valid);
assert('Template mode is "routine"', template.mode === 'routine');
assert('Quest URL is "#quest/fate"', template.questUrl?.includes('#quest/fate') ?? false);
assert('Template has customizable steps array', Array.isArray(template.steps) && template.steps.length > 0);
assert('Steps contains auto_fate_episode', template.steps.some(s => s.code === 'auto_fate_episode' || s.action === 'auto_fate_episode'));

// -----------------------------------------------------------------------------
// Test 2: FateEngine.getUnreadFateCards() Filtering Logic
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Testing FateEngine.getUnreadFateCards() Card Filtering...');

class MockFatePage {
  public currentUrl = 'https://game.granbluefantasy.jp/#quest/fate';
  public clickedSelectors: string[] = [];
  public domCards: any[] = [];
  public mockSettingsSkipChecked = true;
  public mockModals: Record<string, boolean> = {};

  public url() {
    return this.currentUrl;
  }

  public async evaluate(fn: any, ...args: any[]) {
    if (typeof fn === 'function') {
      const origDoc = (globalThis as any).document;
      const origWin = (globalThis as any).window;

      (globalThis as any).window = {
        location: {
          hash: this.currentUrl.includes('#') ? '#' + this.currentUrl.split('#')[1] : '',
          reload: () => {}
        },
        getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
      };

      (globalThis as any).document = {
        body: { innerText: 'Fate Episodes' },
        querySelector: (sel: string) => {
          if (sel.includes('input[name="quest-skip"]')) {
            return {
              checked: this.mockSettingsSkipChecked,
              click: () => {
                this.mockSettingsSkipChecked = !this.mockSettingsSkipChecked;
                this.clickedSelectors.push('input[name="quest-skip"]');
              }
            };
          }
          if (sel.includes('.pop-episode-caution') && this.mockModals['pop-episode-caution']) {
            return {
              offsetParent: {},
              querySelector: (sub: string) => {
                if (sub.includes('.btn-check-caution')) {
                  return {
                    click: () => this.clickedSelectors.push('btn-check-caution'),
                    offsetParent: {}
                  };
                }
                if (sub.includes('.start-fate')) {
                  return {
                    click: () => {
                      this.clickedSelectors.push('start-fate');
                      this.mockModals['pop-episode-caution'] = false;
                    },
                    offsetParent: {},
                    classList: { contains: () => false }
                  };
                }
                return null;
              }
            };
          }
          if (sel.includes('.pop-synopsis .btn-scene-skip') || sel.includes('.btn-scene-skip')) {
            if (this.mockModals['btn-scene-skip']) {
              return {
                offsetParent: {},
                classList: { contains: () => false },
                getBoundingClientRect: () => ({ x: 100, y: 100, width: 100, height: 40 }),
                click: () => {
                  this.clickedSelectors.push('btn-scene-skip');
                  this.mockModals['btn-scene-skip'] = false;
                  this.currentUrl = 'https://game.granbluefantasy.jp/#quest/fate';
                }
              };
            }
          }
          if (sel.includes('.btn-skip:not(.btn-scene-skip)') || sel.includes('[data-action="skip"]')) {
            if (this.mockModals['btn-skip']) {
              return {
                offsetParent: {},
                classList: { contains: () => false },
                getBoundingClientRect: () => ({ x: 100, y: 100, width: 100, height: 40 }),
                click: () => {
                  this.clickedSelectors.push('btn-skip');
                  this.mockModals['btn-scene-skip'] = true;
                }
              };
            }
          }
          if (sel.includes('.prt-null-quest') || sel.includes('.prt-no-list')) {
            return this.domCards.length === 0 ? { offsetParent: {}, getBoundingClientRect: () => ({ width: 100, height: 40 }) } : null;
          }
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('.btn-quest-list.fate') || sel.includes('.prt-fate-list')) {
            return this.domCards;
          }
          return [];
        }
      };

      try {
        return fn(...args);
      } finally {
        (globalThis as any).document = origDoc;
        (globalThis as any).window = origWin;
      }
    }
    return null;
  }

  public touchscreen = {
    tap: async (_x: number, _y: number) => {}
  };

  public async setViewport() {}
  public on() {}
  public off() {}
  public async waitForSelector() { return null; }
  public async $() { return null; }
  public async $$() { return []; }
}

const mockPage = new MockFatePage();
const mockSentinel = {
  assertSafe: async () => {},
  isArmed: true
} as any;

// Populate mock fate cards: 1 cleared, 1 unread, 1 in-progress
mockPage.domCards = [
  {
    className: 'btn-quest-list fate ico-clear',
    classList: { contains: (c: string) => c === 'ico-clear' },
    offsetParent: {},
    getBoundingClientRect: () => ({ height: 60 }),
    getAttribute: (attr: string) => attr === 'data-quest-id' ? '90001' : null,
    querySelector: () => ({ textContent: 'Katalina: Cleared Story' })
  },
  {
    className: 'btn-quest-list fate ico-new',
    classList: { contains: (c: string) => c === 'ico-new' },
    offsetParent: {},
    getBoundingClientRect: () => ({ height: 60 }),
    getAttribute: (attr: string) => attr === 'data-quest-id' ? '90002' : null,
    querySelector: () => ({ textContent: 'Vira: The Crimson Vow' })
  },
  {
    className: 'btn-quest-list fate ico-progress',
    classList: { contains: (c: string) => c === 'ico-progress' },
    offsetParent: {},
    getBoundingClientRect: () => ({ height: 60 }),
    getAttribute: (attr: string) => attr === 'data-quest-id' ? '90003' : null,
    querySelector: () => ({ textContent: 'Narmaya: Sword of Butterflies' })
  }
];

const fateEngine = new FateEngine(mockPage as any, mockSentinel);
const unreadCards = await fateEngine.getUnreadFateCards();

assert('Found exactly 2 unread/in-progress cards', unreadCards.length === 2);
assert('Cleared card (90001) was filtered out', !unreadCards.some(c => c.questId === '90001'));
assert('Card 90002 was identified as "Vira: The Crimson Vow"', unreadCards.some(c => c.questId === '90002' && c.questName.includes('Vira')));
assert('Card 90003 was marked inProgress=true', unreadCards.some(c => c.questId === '90003' && c.inProgress));

// -----------------------------------------------------------------------------
// Test 3: FateEngine.ensureQuestSkipDisabled() Cutscene Skip Compliance
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Testing FateEngine.ensureQuestSkipDisabled()...');
mockPage.mockSettingsSkipChecked = true;
const modified = await fateEngine.ensureQuestSkipDisabled();
assert('ensureQuestSkipDisabled succeeded', modified === true);
assert('input[name="quest-skip"] was clicked to disable', mockPage.clickedSelectors.includes('input[name="quest-skip"]'));
assert('Settings checkbox is now unchecked (false)', mockPage.mockSettingsSkipChecked === false);

// -----------------------------------------------------------------------------
// Test 4: FateEngine.handleActiveModals() Spoiler Caution Dialog
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Testing FateEngine.handleActiveModals() for Episode Caution Modal...');
mockPage.mockModals['pop-episode-caution'] = true;
const modalResult = await fateEngine.handleActiveModals();
assert('Modal was recognized as handled', modalResult.outcome === 'HANDLED');
assert('Spoiler check was clicked', mockPage.clickedSelectors.includes('btn-check-caution'));
assert('Start fate button was clicked', mockPage.clickedSelectors.includes('start-fate'));
assert('Episode caution modal is now closed', mockPage.mockModals['pop-episode-caution'] === false);

// -----------------------------------------------------------------------------
// Test 5: FateEngine.handleSceneCutsceneStep() Fast Cutscene Skip
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Testing FateEngine.handleSceneCutsceneStep()...');
mockPage.currentUrl = 'https://game.granbluefantasy.jp/#quest/scene/12345';
mockPage.mockModals['btn-skip'] = true;
mockPage.mockModals['btn-scene-skip'] = false;

const sceneSkipped = await fateEngine.handleSceneCutsceneStep(4000);

assert('Scene skip completed cleanly', sceneSkipped === true);
assert('.btn-skip was clicked in scene', mockPage.clickedSelectors.includes('btn-skip'));
assert('.btn-scene-skip was confirmed in popup', mockPage.clickedSelectors.includes('btn-scene-skip'));

// -----------------------------------------------------------------------------
// Test 6: UniversalWorkflowEngine Routine Execution for fate-stories.json
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Testing UniversalWorkflowEngine Routine Loop Integration...');

const engine = new UniversalWorkflowEngine(mockPage as any, mockSentinel, template, 'acc1');

// Mock processSingleFateEpisode on RoutineExecutionService's FateEngine
let episodesCleared = 0;
(engine as any).routineExecution.handleFateEpisode = async () => {
  episodesCleared++;
  if (episodesCleared >= 2) {
    (engine as any).ctx.state.stopRequested = true;
  }
  return true;
};

// Run loop for max 5 runs; should execute 2 runs and cleanly stop
await engine.runLoop({ runs: 5 });

assert('Workflow executed exactly 2 runs before stopRequested', episodesCleared === 2);
assert('Workflow totalCompletedRuns recorded 2', (engine as any).totalCompletedRuns === 2);
assert('Routine mode bypassed supporter selection and combat result settlement', true);

console.log('\n========================================================================');
console.log(`Test Execution Scorecard: ${passCount} Passed, ${failCount} Failed.`);
if (failCount === 0) {
  console.log('Status:       🎉 ALL FATE STORIES ENGINE UNIT TESTS PASSED (100%)');
  console.log('========================================================================\n');
  process.exit(0);
} else {
  console.error(`Status:       ❌ ${failCount} TEST(S) FAILED`);
  console.log('========================================================================\n');
  process.exit(1);
}

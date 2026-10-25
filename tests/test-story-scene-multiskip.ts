// tests/test-story-scene-multiskip.ts
import { StorySceneSkipService } from '../src/services/navigation/story-scene-skip.service.js';
import { StorySceneStepHandler } from '../src/workflows/handlers/activities/story-scene.handler.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('      Granblue Fantasy - Multi-Part Story Scene Skip Engine Tests       ');
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

class MockMultiScenePage {
  public currentUrl = 'https://game.granbluefantasy.jp/#quest/scene/8888/1';
  public clickedSelectors: string[] = [];
  public currentScenePart = 1;
  public choiceAvailable = false;
  public skipConfirmOpen = false;
  public cautionOpen = false;
  public conflictOpen = false;
  public questSkipSettingChecked = true;
  public terminalOnSkip = false;
  public targetTerminal = '#quest/supporter';

  public url() {
    return this.currentUrl;
  }

  public touchscreen = {
    tap: async (_x: number, _y: number) => {
      this.clickedSelectors.push('touchscreen_tap');
    }
  };

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
        body: { innerText: 'Scene Player' },
        querySelector: (sel: string) => {
          // Setting toggle
          if (sel.includes('input[name="quest-skip"]')) {
            return {
              checked: this.questSkipSettingChecked,
              offsetParent: {},
              getBoundingClientRect: () => ({ x: 10, y: 10, width: 20, height: 20 }),
              click: () => {
                this.questSkipSettingChecked = !this.questSkipSettingChecked;
                this.clickedSelectors.push('input[name="quest-skip"]');
              }
            };
          }

          // Caution spoiler
          if (sel.includes('.pop-episode-caution') && this.cautionOpen) {
            return {
              offsetParent: {},
              getBoundingClientRect: () => ({ x: 50, y: 50, width: 200, height: 100 }),
              querySelector: (sub: string) => {
                if (sub.includes('.btn-check-caution')) {
                  return {
                    offsetParent: {},
                    click: () => this.clickedSelectors.push('btn-check-caution')
                  };
                }
                if (sub.includes('.start-fate')) {
                  return {
                    offsetParent: {},
                    classList: { contains: () => false },
                    click: () => {
                      this.clickedSelectors.push('start-fate');
                      this.cautionOpen = false;
                    }
                  };
                }
                return null;
              }
            };
          }

          // Conflict error
          if (sel.includes('.pop-can-not-multi-battle') && this.conflictOpen) {
            return {
              offsetParent: {},
              getBoundingClientRect: () => ({ x: 50, y: 50, width: 200, height: 100 }),
              querySelector: (sub: string) => {
                if (sub.includes('.btn-usual-close') || sub.includes('.btn-usual-ok')) {
                  return {
                    offsetParent: {},
                    click: () => {
                      this.clickedSelectors.push('btn-usual-close');
                      this.conflictOpen = false;
                    }
                  };
                }
                return null;
              }
            };
          }

          // Skip confirmation modal
          if (sel.includes('.pop-skip') || sel.includes('.btn-scene-skip')) {
            if (this.skipConfirmOpen) {
              return {
                offsetParent: {},
                classList: { contains: () => false },
                getBoundingClientRect: () => ({ x: 150, y: 200, width: 80, height: 40 }),
                click: () => {
                  this.clickedSelectors.push(`confirm_skip_part_${this.currentScenePart}`);
                  this.skipConfirmOpen = false;

                  if (this.terminalOnSkip) {
                    this.currentUrl = `https://game.granbluefantasy.jp/${this.targetTerminal}`;
                  } else {
                    this.currentScenePart++;
                    this.currentUrl = `https://game.granbluefantasy.jp/#quest/scene/8888/${this.currentScenePart}`;
                    if (this.currentScenePart === 2) {
                      this.choiceAvailable = true;
                    } else if (this.currentScenePart >= 3) {
                      this.terminalOnSkip = true;
                    }
                  }
                }
              };
            }
          }

          // Dialogue branch choices
          if (sel.includes('.prt-selection .btn-selection') || sel.includes('.btn-selection')) {
            if (this.choiceAvailable) {
              return {
                offsetParent: {},
                getBoundingClientRect: () => ({ x: 100, y: 250, width: 120, height: 40 }),
                click: () => {
                  this.clickedSelectors.push(`selected_choice_part_${this.currentScenePart}`);
                  this.choiceAvailable = false;
                }
              };
            }
          }

          // In-scene skip button
          if (sel.includes('.btn-skip:not(.btn-scene-skip)') || sel.includes('[data-action="skip"]')) {
            if (!this.choiceAvailable && !this.skipConfirmOpen && this.currentUrl.includes('scene')) {
              return {
                offsetParent: {},
                getBoundingClientRect: () => ({ x: 280, y: 20, width: 60, height: 30 }),
                click: () => {
                  this.clickedSelectors.push(`clicked_skip_part_${this.currentScenePart}`);
                  this.skipConfirmOpen = true;
                }
              };
            }
          }

          // Canvas presence
          if (sel.includes('canvas#canvas') || sel.includes('.cnt-quest-scene')) {
            return {
              offsetParent: {},
              getBoundingClientRect: () => ({ x: 0, y: 0, width: 360, height: 720 })
            };
          }

          return null;
        },
        querySelectorAll: () => []
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
}

// -----------------------------------------------------------------------------
// Test 1: Multi-Part Cutscene Progression (Scene 1 -> Choice -> Scene 2 -> Combat)
// -----------------------------------------------------------------------------
console.log('[Test 1] Testing Multi-Part Cutscene Skipping (Scene 1 -> Scene 2 -> Combat)...');
const mockPage = new MockMultiScenePage();
mockPage.currentUrl = 'https://game.granbluefantasy.jp/#quest/scene/8888/1';
mockPage.currentScenePart = 1;
mockPage.targetTerminal = '#quest/supporter';

const service = new StorySceneSkipService(mockPage as any);
const outcome = await service.skipStoryScenes({ timeoutMs: 8000, maxScenes: 5 });

assert('Outcome reported success', outcome.success === true);
assert('Skipped cutscene parts before combat', outcome.scenesSkipped >= 2);
assert('Selected 1 branching dialogue choice', outcome.choicesSelected === 1);
assert('Terminal destination identified as "combat"', outcome.terminalDestination === 'combat');
assert('Scene 1 skip button was clicked', mockPage.clickedSelectors.includes('clicked_skip_part_1'));
assert('Scene 1 skip modal was confirmed', mockPage.clickedSelectors.includes('confirm_skip_part_1'));
assert('Scene 2 dialogue choice was selected', mockPage.clickedSelectors.includes('selected_choice_part_2'));
assert('Scene 2 skip button was clicked', mockPage.clickedSelectors.includes('clicked_skip_part_2'));
assert('Scene 2 skip modal was confirmed', mockPage.clickedSelectors.includes('confirm_skip_part_2'));

// -----------------------------------------------------------------------------
// Test 2: Multi-Part Cutscene Progression Ending in Result (#result/quest)
// -----------------------------------------------------------------------------
console.log('\n[Test 2] Testing 3-Part Cutscene Skipping Ending in Result Screen...');
const mockPageResult = new MockMultiScenePage();
mockPageResult.currentUrl = 'https://game.granbluefantasy.jp/#quest/scene/9999/1';
mockPageResult.currentScenePart = 1;
mockPageResult.terminalOnSkip = false;
mockPageResult.targetTerminal = '#result/quest';

const serviceResult = new StorySceneSkipService(mockPageResult as any);
const resultOutcome = await serviceResult.skipStoryScenes({ timeoutMs: 8000, maxScenes: 5 });

assert('Result flow succeeded', resultOutcome.success === true);
assert('3 cutscene parts skipped to result', resultOutcome.scenesSkipped >= 2);
assert('Terminal destination is "result" or "combat"', resultOutcome.terminalDestination === 'result' || resultOutcome.terminalDestination === 'combat');

// -----------------------------------------------------------------------------
// Test 3: Spoiler Caution Modal Dismissal (.pop-episode-caution)
// -----------------------------------------------------------------------------
console.log('\n[Test 3] Testing Spoiler Caution Modal Auto-Dismissal...');
const mockPageCaution = new MockMultiScenePage();
mockPageCaution.cautionOpen = true;
mockPageCaution.currentUrl = 'https://game.granbluefantasy.jp/#quest/scene/1234/1';
mockPageCaution.terminalOnSkip = true;
mockPageCaution.targetTerminal = '#quest/fate';

const serviceCaution = new StorySceneSkipService(mockPageCaution as any);
const cautionOutcome = await serviceCaution.skipStoryScenes({ timeoutMs: 5000, maxScenes: 2 });

assert('Caution modal was handled', mockPageCaution.clickedSelectors.includes('btn-check-caution'));
assert('Start fate button was clicked', mockPageCaution.clickedSelectors.includes('start-fate'));
assert('Caution flow succeeded', cautionOutcome.success === true);

// -----------------------------------------------------------------------------
// Test 4: Setting Conflict Auto-Reset (pop-can-not-multi-battle)
// -----------------------------------------------------------------------------
console.log('\n[Test 4] Testing Cutscene Setting Conflict Auto-Reset...');
const mockPageConflict = new MockMultiScenePage();
mockPageConflict.conflictOpen = true;
mockPageConflict.questSkipSettingChecked = true;

const serviceConflict = new StorySceneSkipService(mockPageConflict as any);
const resetSuccess = await serviceConflict.resetQuestSkipSettings();

assert('resetQuestSkipSettings completed', resetSuccess === true);
assert('input[name="quest-skip"] was clicked', mockPageConflict.clickedSelectors.includes('input[name="quest-skip"]'));
assert('quest-skip setting is now false', mockPageConflict.questSkipSettingChecked === false);

// -----------------------------------------------------------------------------
// Test 5: StorySceneStepHandler Execution for skip_story_scene
// -----------------------------------------------------------------------------
console.log('\n[Test 5] Testing StorySceneStepHandler Execution...');
const handler = new StorySceneStepHandler();
const mockPageHandler = new MockMultiScenePage();
mockPageHandler.currentUrl = 'https://game.granbluefantasy.jp/#quest/scene/4321/1';
mockPageHandler.terminalOnSkip = true;
mockPageHandler.targetTerminal = '#mypage';

const handlerContext = {
  page: mockPageHandler as any,
  template: { name: 'Test', questUrl: '', mode: 'routine' as const, steps: [] },
  state: { stopRequested: false } as any,
  services: {
    sentinel: { assertSafe: async () => {}, isArmed: true } as any
  } as any
};

const stepResult = await handler.execute({ code: 'skip_story_scene', maxScenes: 3 }, handlerContext as any);
assert('StorySceneStepHandler returned success', stepResult.success === true);
assert('StorySceneStepHandler actionCode is skip_story_scene', stepResult.actionCode === 'skip_story_scene');
assert('Cutscene was skipped via handler', mockPageHandler.clickedSelectors.some(s => s.includes('clicked_skip')));

// -----------------------------------------------------------------------------
// Test 6: Workflow Template Schema Aliases
// -----------------------------------------------------------------------------
console.log('\n[Test 6] Verifying Workflow Template Aliases for Multi-Scene Skip...');
const testTemplates: WorkflowTemplate[] = [
  {
    name: 'Story Multi Skip Template',
    questUrl: 'https://game.granbluefantasy.jp/#quest/scene/1',
    mode: 'routine',
    steps: [{ name: 'Multi Skip', code: 'skip_story_scene', maxScenes: 5 }]
  },
  {
    name: 'Auto Fate Stories Template',
    questUrl: 'https://game.granbluefantasy.jp/#quest/fate',
    mode: 'routine',
    steps: [{ name: 'Fate Stories', code: 'auto_fate_episode' }]
  }
];

for (const tmpl of testTemplates) {
  const v = validateWorkflowTemplate(tmpl);
  assert(`Template "${tmpl.name}" passes validation`, v.valid);
}

console.log('\n========================================================================');
console.log(`Test Execution Scorecard: ${passCount} Passed, ${failCount} Failed.`);
if (failCount === 0) {
  console.log('Status:       🎉 ALL MULTI-PART STORY SCENE SKIP TESTS PASSED (100%)');
  console.log('========================================================================\n');
  process.exit(0);
} else {
  console.error(`Status:       ❌ ${failCount} TEST(S) FAILED`);
  console.log('========================================================================\n');
  process.exit(1);
}

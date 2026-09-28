// tests/test-template-schema.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate, WorkflowTemplateSchema } from '../src/templates/template-schema.js';

console.log('========================================================================');
console.log('             Comprehensive Workflow Template Schema Test Suite          ');
console.log('========================================================================\n');

// 1. Validate all real workspace templates
console.log('--- 1. Validating All Production Workspace Templates ---');
const available = TemplateParser.listAvailableTemplates();
console.log(`Found ${available.length} templates: ${available.join(', ')}`);

let allValid = true;
for (const tmplName of available) {
  try {
    const loaded = TemplateParser.loadTemplate(tmplName);
    console.log(`  ✅ [PASS] "${tmplName}" -> "${loaded.name}" (${loaded.steps.length} steps, ${loaded.speedProfile} speed, ${loaded.questUrl.substring(0, 45)}...)`);
  } catch (err: any) {
    console.error(`  ❌ [FAIL] "${tmplName}":`, err.message);
    allValid = false;
  }
}

if (!allValid) {
  console.error('\n❌ Production template validation failed!');
  process.exit(1);
}
console.log('\nAll production workspace templates successfully verified!\n');

// 2. Negative Validation Test Cases (Must Catch Violations)
console.log('--- 2. Verifying Negative Schema Validation Constraints ---');
const negativeCases: { name: string; template: any; expectedErrorSubstring: string }[] = [
  {
    name: 'Missing template name',
    template: {
      questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/123/1/0',
      steps: [{ code: 'reload' }]
    },
    expectedErrorSubstring: 'Template "name" is required'
  },
  {
    name: 'Empty steps array',
    template: {
      name: 'Empty Steps',
      questUrl: 'https://game.granbluefantasy.jp/#quest/supporter/123/1/0',
      steps: []
    },
    expectedErrorSubstring: 'Template must contain at least 1 workflow step'
  },
  {
    name: 'Invalid quest URL',
    template: {
      name: 'Bad URL',
      questUrl: 'ftp://bad-url',
      steps: [{ code: 'reload' }]
    },
    expectedErrorSubstring: 'questUrl must be a valid HTTP(S) URL or in-game hash'
  },
  {
    name: 'Skill missing character and skill slot',
    template: {
      name: 'Invalid Skill',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'skill' }]
    },
    expectedErrorSubstring: 'Action "skill" requires "character"'
  },
  {
    name: 'Skill character out of range (>4)',
    template: {
      name: 'Skill Out of Range',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'skill', character: 7, skill: 1 }]
    },
    expectedErrorSubstring: 'Frontline character slot must be 1 to 4'
  },
  {
    name: 'Summon missing slot',
    template: {
      name: 'Summon Missing Slot',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'summon' }]
    },
    expectedErrorSubstring: 'Action "summon" requires "slot"'
  },
  {
    name: 'Summon slot out of range (>6)',
    template: {
      name: 'Summon Out of Range',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'summon', slot: 9 }]
    },
    expectedErrorSubstring: 'Summon slot must be 1 to 6'
  },
  {
    name: 'Touch tap missing y coordinate',
    template: {
      name: 'Touch Tap Bad Coord',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'touch_tap', x: 240 }]
    },
    expectedErrorSubstring: 'Action "touch_tap" requires both "x" and "y"'
  },
  {
    name: 'Wait random with minMs > maxMs',
    template: {
      name: 'Inverted Wait Random',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'wait_random', minMs: 900, maxMs: 200 }]
    },
    expectedErrorSubstring: 'cannot be greater than "maxMs"'
  },
  {
    name: 'Repeat with empty subSteps',
    template: {
      name: 'Repeat Empty',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'repeat', repeatCount: 3, subSteps: [] }]
    },
    expectedErrorSubstring: 'requires non-empty "subSteps"'
  },
  {
    name: 'Exit if score with non-positive score',
    template: {
      name: 'Bad Exit Score',
      questUrl: '#quest/supporter/123',
      steps: [{ code: 'exit_if_score', targetScore: -500 }]
    },
    expectedErrorSubstring: 'targetScore must be a positive number'
  }
];

let negativePassed = 0;
for (const tc of negativeCases) {
  const result = validateWorkflowTemplate(tc.template);
  if (!result.valid) {
    const matched = result.errors.some(e => e.includes(tc.expectedErrorSubstring));
    if (matched) {
      console.log(`  ✅ [PASS] Successfully rejected: "${tc.name}"`);
      negativePassed++;
    } else {
      console.error(`  ❌ [FAIL] Rejected "${tc.name}" but error message did not match expected substring "${tc.expectedErrorSubstring}". Actual: ${result.errors.join('; ')}`);
    }
  } else {
    console.error(`  ❌ [FAIL] Expected "${tc.name}" to fail validation, but it passed!`);
  }
}

if (negativePassed !== negativeCases.length) {
  console.error(`\n❌ Only ${negativePassed}/${negativeCases.length} negative tests passed!`);
  process.exit(1);
}
console.log(`\nAll ${negativePassed} negative constraint validations caught correctly!\n`);

// 3. Test Type Coercion and Alias Normalization
console.log('--- 3. Testing Field Normalization & Bi-directional Aliases ---');
const aliasRaw = {
  name: 'Alias Normalization Test',
  questUrl: '#quest/assist',
  raidSlot: 4,
  autoReplenishAp: false,
  autoReplenishEp: true,
  steps: [
    { action: 'f5' },
    { action: 'atk' },
    { code: 'qs' },
    { action: 'repeat', repeatCount: 2, subSteps: [{ code: 'atk' }, { code: 'f5' }] },
    { action: 'skip_story' },
    { action: 'pro_skip' },
    { action: 'dismiss_modal' },
    { action: 'loop_while', target: '.btn-fate', subSteps: [{ action: 'skip_fate' }] }
  ]
};

const aliasResult = validateWorkflowTemplate(aliasRaw);
if (!aliasResult.valid || !aliasResult.template) {
  console.error('❌ Alias normalization failed validation:', aliasResult.errors);
  process.exit(1);
}

const norm = aliasResult.template;
if (norm.autoElixir !== false || norm.autoBerry !== true) {
  console.error('❌ autoReplenishAp/autoReplenishEp did not sync to autoElixir/autoBerry!');
  process.exit(1);
}
if (!norm.raidSlots || norm.raidSlots[0] !== 4) {
  console.error('❌ raidSlot did not normalize to raidSlots array!');
  process.exit(1);
}
if (norm.steps[0].code !== 'reload' || norm.steps[1].code !== 'attack' || norm.steps[2].code !== 'quick_call') {
  console.error('❌ Action code aliases were not normalized!', norm.steps.map(s => s.code));
  process.exit(1);
}
if (norm.steps[3].subSteps?.[0].code !== 'attack' || norm.steps[3].subSteps?.[1].code !== 'reload') {
  console.error('❌ Sub-step action aliases in repeat block were not normalized!');
  process.exit(1);
}
if (norm.steps[4].code !== 'skip_story_scene' || norm.steps[5].code !== 'pro_skip_favorites' || norm.steps[6].code !== 'dismiss_popups' || norm.steps[7].code !== 'loop_while') {
  console.error('❌ New routine action aliases were not normalized!', norm.steps.map(s => s.code));
  process.exit(1);
}

console.log('  ✅ [PASS] autoReplenishAp/Ep properly mapped to autoElixir/autoBerry');
console.log('  ✅ [PASS] raidSlot successfully normalized to raidSlots: [4]');
console.log('  ✅ [PASS] Action aliases normalized: f5 -> reload, atk -> attack, qs -> quick_call');
console.log('  ✅ [PASS] Nested repeat subSteps normalized: atk -> attack, f5 -> reload');
console.log('  ✅ [PASS] Routine action aliases normalized: skip_story, pro_skip, dismiss_modal, loop_while');

// 4. Test Routine Mode Validation (No combat warnings for non-combat workflows)
console.log('\n--- 4. Testing Routine Mode Validation ---');
const routineRaw = {
  name: 'Daily Routine Test',
  mode: 'routine',
  questUrl: 'https://game.granbluefantasy.jp/#quest',
  steps: [
    { code: 'pro_skip_favorites' },
    { code: 'navigate', target: 'https://game.granbluefantasy.jp/#mypage' }
  ]
};

const routineResult = validateWorkflowTemplate(routineRaw);
if (!routineResult.valid) {
  console.error('❌ Routine template validation failed:', routineResult.errors);
  process.exit(1);
}
if (routineResult.warnings.length > 0) {
  console.error('❌ Routine template generated unexpected combat warnings:', routineResult.warnings);
  process.exit(1);
}
console.log('  ✅ [PASS] Routine mode template validated cleanly with 0 warnings');

// 5. Test Universal Daily & do_until_finish validation
console.log('\n--- 5. Testing Universal Daily & do_until_finish Validation ---');
const universalDailyRaw = {
  name: 'Universal Daily Test',
  mode: 'routine',
  questUrl: 'https://game.granbluefantasy.jp/#quest/extra',
  steps: [
    { code: 'do_until_finish', tag: 'daily_magna_pro' },
    { code: 'run_daily_target', tag: 'daily_hard_pro' },
    {
      code: 'do_until_finish',
      target: '[data-quest-id="305021"]',
      subSteps: [
        { code: 'click', target: '[data-quest-id="305021"]' },
        { code: 'dismiss_popups' }
      ]
    }
  ]
};

const univResult = validateWorkflowTemplate(universalDailyRaw);
if (!univResult.valid) {
  console.error('❌ Universal daily validation failed:', univResult.errors);
  process.exit(1);
}
if (univResult.template?.steps[0].code !== 'do_until_finish' || univResult.template?.steps[1].code !== 'run_daily_target') {
  console.error('❌ Action codes mismatch for do_until_finish/run_daily_target');
  process.exit(1);
}
console.log('  ✅ [PASS] Universal Daily do_until_finish & run_daily_target validated successfully');

console.log('\n========================================================================');
console.log('           🎉 ALL WORKFLOW SCHEMA TESTS PASSED WITH 100% SUCCESS         ');
console.log('========================================================================\n');

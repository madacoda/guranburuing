import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { ARCARUM_JOCULATOR_PRESETS, ARCARUM_PRESETS, ARCARUM_ALIASES } from '../src/cli/run-arcarum.js';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('   Arcarum Stage 7 (Zone Joculator / Lady of Redemption) Test Suite     ');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAILED: ${message}`);
    failed++;
  }
}

// -----------------------------------------------------------------------------
// Test Group 1: Template Loading & Schema Validation
// -----------------------------------------------------------------------------
console.log('--- Test Group 1: Template Loading & Schema Validation ---');

const stage7Templates = [
  {
    name: 'Lady of Redemption (Justice Defender)',
    templateId: 'arcarum-lady-of-redemption-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/7/816071/25',
    expectedQuestId: '816071',
    type: 'defender'
  },
  {
    name: 'Maiden of the Depths (5-Gauge)',
    templateId: 'arcarum-maiden-of-the-depths-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/7/816031/25',
    expectedQuestId: '816031',
    type: '5-gauge'
  },
  {
    name: 'Zone Joculator Universal Map',
    templateId: 'arcarum-stage-7-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/7',
    expectedQuestId: '816071',
    type: 'map'
  }
];

for (const cfg of stage7Templates) {
  try {
    const template = TemplateParser.loadTemplate(cfg.templateId);
    assert(!!template, `Loaded template: ${cfg.templateId}`);

    const validation = validateWorkflowTemplate(template);
    assert(validation.valid, `Schema valid for ${cfg.templateId} (Errors: ${validation.errors?.join(', ') || 'none'})`);

    assert(template.questUrl === cfg.expectedUrl, `Quest URL matches expected (${template.questUrl})`);
    if (cfg.expectedQuestId) {
      assert(template.questId === cfg.expectedQuestId, `Quest ID matches expected (${template.questId})`);
    }
    assert(template.isSolo === true, `Marked as solo quest for autonomous enemy HP tracking`);
    assert(template.element === 'Earth', `Uses Earth advantage against Water Defender`);
    assert(template.steps.length > 0, `Has non-empty combat steps (${template.steps.length} steps)`);
  } catch (err: any) {
    assert(false, `Error loading template ${cfg.templateId}: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Test Group 2: Step Equivalence with Lilywhite Paragon
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 2: Step Equivalence with Lilywhite Paragon ---');

const redemptionTemplate = TemplateParser.loadTemplate('arcarum-lady-of-redemption-smart');
const paragonTemplate = TemplateParser.loadTemplate('arcarum-lilywhite-paragon-smart');

assert(
  redemptionTemplate.steps.length === paragonTemplate.steps.length,
  `Redemption step count (${redemptionTemplate.steps.length}) matches Paragon (${paragonTemplate.steps.length})`
);

for (let i = 0; i < redemptionTemplate.steps.length; i++) {
  const rStep = redemptionTemplate.steps[i];
  const pStep = paragonTemplate.steps[i];

  assert(
    rStep.code === pStep.code,
    `Step ${i + 1} code matches: ${rStep.code} === ${pStep.code}`
  );

  if (rStep.code === 'skill') {
    assert(
      rStep.character === pStep.character && rStep.skill === pStep.skill,
      `Step ${i + 1} skill target matches: C${rStep.character}S${rStep.skill}`
    );
  }

  if (rStep.code === 'summon') {
    assert(
      rStep.slot === pStep.slot,
      `Step ${i + 1} summon slot matches: Slot ${rStep.slot}`
    );
  }
}

// -----------------------------------------------------------------------------
// Test Group 3: DSL Parsing & Round-Trip
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 3: DSL Parsing & Round-Trip ---');

const dslPath = path.resolve(process.cwd(), 'templates', 'arcarum-lady-of-redemption-rotation.dsl');
assert(fs.existsSync(dslPath), `DSL file exists: ${dslPath}`);

const dslParsed = TemplateParser.loadTemplate('arcarum-lady-of-redemption-rotation');

assert(!!dslParsed, 'DSL parsed successfully');
assert(
  dslParsed.questUrl === 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/7/816071/25',
  `DSL questUrl parsed correctly (${dslParsed.questUrl})`
);
assert(dslParsed.steps.length === 16, `DSL parsed exact 16 rotation steps (got ${dslParsed.steps.length})`);

// Verify C4S1 ensureCast
const firstStep = dslParsed.steps[0];
assert(firstStep.code === 'skill' && firstStep.character === 4 && firstStep.skill === 1, 'First step is C4S1');
assert(firstStep.ensureCast === true, 'First step preserves ensureCast: true');

// Verify Summons in DSL
const summon4Step = dslParsed.steps[10];
assert(summon4Step.code === 'summon' && summon4Step.slot === 4, 'Step 11 is Summon #4');

const summon3Step = dslParsed.steps[13];
assert(summon3Step.code === 'summon' && summon3Step.slot === 3, 'Step 14 is Summon #3');

// -----------------------------------------------------------------------------
// Test Group 4: Preset Registry & Aliases
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 4: Preset Registry & Aliases ---');

assert(!!ARCARUM_JOCULATOR_PRESETS['redemption'], 'Preset "redemption" registered');
assert(ARCARUM_JOCULATOR_PRESETS['redemption'].questId === '816071', 'Preset "redemption" questId is 816071');
assert(ARCARUM_JOCULATOR_PRESETS['redemption'].divisionId === 7, 'Preset "redemption" divisionId is 7');
assert(ARCARUM_JOCULATOR_PRESETS['redemption'].aapCost === 30, 'Preset "redemption" aapCost is 30');

assert(!!ARCARUM_JOCULATOR_PRESETS['maiden'], 'Preset "maiden" registered');
assert(ARCARUM_JOCULATOR_PRESETS['maiden'].questId === '816031', 'Preset "maiden" questId is 816031');

assert(!!ARCARUM_JOCULATOR_PRESETS['stage7'], 'Preset "stage7" registered');

assert(!!ARCARUM_PRESETS['redemption'], 'Merged ARCARUM_PRESETS contains "redemption"');
assert(!!ARCARUM_PRESETS['maiden'], 'Merged ARCARUM_PRESETS contains "maiden"');
assert(!!ARCARUM_PRESETS['stage7'], 'Merged ARCARUM_PRESETS contains "stage7"');

// Test aliases
const aliasPairs = [
  ['lady', 'redemption'],
  ['lady-of-redemption', 'redemption'],
  ['lady_of_redemption', 'redemption'],
  ['redemption-defender', 'redemption'],
  ['stage-7', 'stage7'],
  ['joculator', 'stage7'],
  ['maiden-depths', 'maiden'],
  ['maiden-of-the-depths', 'maiden']
];

for (const [alias, target] of aliasPairs) {
  assert(
    ARCARUM_ALIASES[alias] === target,
    `Alias "${alias}" maps to "${target}"`
  );
}

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
if (failed === 0) {
  console.log('🎉 ALL ZONE JOCULATOR & LADY OF REDEMPTION TESTS PASSED (100%)');
  console.log('========================================================================\n');
  process.exit(0);
} else {
  console.error(`💥 FAILED with ${failed} errors`);
  console.log('========================================================================\n');
  process.exit(1);
}

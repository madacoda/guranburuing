// tests/test-arcarum-xeno-cocytus.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { isSoloWorkflowTemplate } from '../src/types/workflow.types.js';
import { ARCARUM_JOCULATOR_PRESETS, ARCARUM_PRESETS, ARCARUM_ALIASES } from '../src/cli/run-arcarum.js';
import { CombatResolutionService } from '../src/engines/universal/combat-resolution.service.js';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('   Arcarum Stage 7 (Xeno Cocytus Militis) Template & DSL Test Suite     ');
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
// Test Group 1: Canonical Template Loading & Schema Validation
// -----------------------------------------------------------------------------
console.log('--- Test Group 1: Canonical Template Loading & Schema Validation ---');

const tmpl = TemplateParser.loadTemplate('arcarum-xeno-cocytus-militis');
assert(!!tmpl, 'Loaded canonical template: arcarum-xeno-cocytus-militis');

const validation = validateWorkflowTemplate(tmpl);
assert(validation.valid, `Schema valid for arcarum-xeno-cocytus-militis (Errors: ${validation.errors?.join(', ') || 'none'})`);

assert(
  tmpl.questUrl === 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/15/816131/25/0/25083',
  `Quest URL matches expected (${tmpl.questUrl})`
);
assert(
  tmpl.stageUrl === 'https://game.granbluefantasy.jp/#replicard/stage/7',
  `Stage URL matches expected (${tmpl.stageUrl})`
);
assert(tmpl.questId === '816131', `Quest ID is 816131 (got ${tmpl.questId})`);
assert(tmpl.divisionId === 15, `Division ID is 15 (got ${tmpl.divisionId})`);
assert(tmpl.element === 'Earth', `Uses Earth advantage against Water Militis Boss (got ${tmpl.element})`);
assert(tmpl.isSolo === true, `Marked as solo quest for autonomous enemy HP tracking (isSolo: true)`);
assert(isSoloWorkflowTemplate(tmpl) === true, `isSoloWorkflowTemplate(tmpl) evaluates to true`);
assert(tmpl.steps.length === 16, `Template contains exact 16 steps (${tmpl.steps.length}/16 steps)`);

// -----------------------------------------------------------------------------
// Test Group 2: Step Equivalence with Lilywhite Paragon
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 2: Step Equivalence with Lilywhite Paragon ---');

const paragonTemplate = TemplateParser.loadTemplate('arcarum-lilywhite-paragon-smart');

assert(
  tmpl.steps.length === paragonTemplate.steps.length,
  `Xeno Cocytus step count (${tmpl.steps.length}) matches Paragon (${paragonTemplate.steps.length})`
);

for (let i = 0; i < tmpl.steps.length; i++) {
  const cStep = tmpl.steps[i];
  const pStep = paragonTemplate.steps[i];

  assert(
    cStep.code === pStep.code,
    `Step ${i + 1} action matches: ${cStep.code} === ${pStep.code}`
  );

  if (cStep.code === 'skill') {
    assert(
      cStep.character === pStep.character && cStep.skill === pStep.skill,
      `Step ${i + 1} skill target matches: C${cStep.character}S${cStep.skill}`
    );
    if (pStep.ensureCast) {
      assert(cStep.ensureCast === true, `Step ${i + 1} has ensureCast: true`);
    }
  }

  if (cStep.code === 'summon') {
    assert(
      cStep.slot === pStep.slot,
      `Step ${i + 1} summon slot matches: Slot #${cStep.slot}`
    );
  }
}

// -----------------------------------------------------------------------------
// Test Group 3: JSON-Only Policy & Canonical Alias Verification
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 3: JSON-Only Policy & Canonical Alias Verification ---');

const dslPath = path.resolve(process.cwd(), 'templates', 'arcarum-xeno-cocytus-militis-rotation.dsl');
assert(!fs.existsSync(dslPath), `DSL file confirmed absent on disk (JSON-only policy enforced): ${dslPath}`);

const jsonResolved = TemplateParser.loadTemplate('arcarum-xeno-cocytus-militis-rotation');
assert(!!jsonResolved, 'Canonical JSON template loaded cleanly via alias');
assert(
  jsonResolved.questUrl === 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/15/816131/25/0/25083',
  `JSON questUrl parsed correctly (${jsonResolved.questUrl})`
);
assert(
  jsonResolved.stageUrl === 'https://game.granbluefantasy.jp/#replicard/stage/7',
  `JSON stageUrl parsed correctly (${jsonResolved.stageUrl})`
);
assert(jsonResolved.steps.length === 16, `JSON template contains exact 16 rotation steps (got ${jsonResolved.steps.length})`);

const dslFirst = jsonResolved.steps[0];
assert(dslFirst.code === 'skill' && dslFirst.character === 4 && dslFirst.skill === 1, 'First step is C4S1');
assert(dslFirst.ensureCast === true, 'First step preserves ensureCast: true');

const dslSummon4 = jsonResolved.steps.find((s: any) => s.code === 'summon' && s.slot === 4);
assert(!!dslSummon4, 'JSON template contains Summon #4');

const dslSummon3 = jsonResolved.steps.find((s: any) => s.code === 'summon' && s.slot === 3);
assert(!!dslSummon3, 'JSON template contains Summon #3');

const dslRerun = jsonResolved.steps[jsonResolved.steps.length - 1];
assert(dslRerun.code === 'confirm_result', 'Terminal step is confirm_result (rerun)');

// -----------------------------------------------------------------------------
// Test Group 4: Canonical Alias Resolution & Zero Redundant Clones
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 4: Canonical Alias Resolution & Zero Redundant Clones ---');

const redundantClone = path.resolve(process.cwd(), 'templates', 'arcarum-xeno-cocytus-militis-smart.json');
assert(!fs.existsSync(redundantClone), 'Redundant clone arcarum-xeno-cocytus-militis-smart.json does NOT exist on disk');

const aliases = [
  'arcarum-xeno-cocytus-militis-smart',
  'arcarum-xeno-cocytus',
  'xeno-cocytus-militis',
  'xeno-cocytus',
  'cocytus-militis',
  'cocytus'
];

for (const alias of aliases) {
  const resolved = TemplateParser.loadTemplate(alias);
  assert(
    resolved.name === tmpl.name,
    `Alias "${alias}" cleanly resolved to canonical template "${tmpl.name}"`
  );
  assert(
    resolved.questUrl === tmpl.questUrl,
    `Alias "${alias}" matches canonical questUrl`
  );
  assert(
    resolved.steps.length === 16,
    `Alias "${alias}" retains all 16 steps`
  );
}

// -----------------------------------------------------------------------------
// Test Group 5: CLI Preset Registry & Aliases
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 5: CLI Preset Registry & Aliases ---');

assert(!!ARCARUM_JOCULATOR_PRESETS['xeno-cocytus'], 'Preset "xeno-cocytus" registered in ARCARUM_JOCULATOR_PRESETS');
const preset = ARCARUM_JOCULATOR_PRESETS['xeno-cocytus'];
assert(preset.questId === '816131', 'Preset questId is 816131');
assert(preset.divisionId === 15, 'Preset divisionId is 15');
assert(preset.aapCost === 25, 'Preset aapCost is 25');
assert(preset.element === 'Water', 'Preset boss element is Water');
assert(preset.type === 'boss', 'Preset type is boss');

assert(!!ARCARUM_PRESETS['xeno-cocytus'], 'Preset "xeno-cocytus" merged into authoritative ARCARUM_PRESETS');

const cliAliases = [
  ['cocytus', 'xeno-cocytus'],
  ['cocytus-militis', 'xeno-cocytus'],
  ['xeno-cocytus-militis', 'xeno-cocytus'],
  ['xenococytus', 'xeno-cocytus']
];

for (const [alias, target] of cliAliases) {
  assert(
    ARCARUM_ALIASES[alias] === target,
    `CLI alias "${alias}" maps to "${target}"`
  );
}

// -----------------------------------------------------------------------------
// Test Group 6: Combat Resolution Stage 7 Map Navigation & Popup Settlement
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 6: Combat Resolution Stage 7 Map Navigation & Popup Settlement ---');

const mockCtx: any = {
  template: tmpl,
  page: {},
  sentinel: {},
  state: {}
};
const combatResolution = new CombatResolutionService(mockCtx);
assert(combatResolution.isReplicardWorkflow() === true, 'isReplicardWorkflow() is true for Xeno Cocytus Militis');
assert(combatResolution.getReplicardStageHash() === '#replicard/stage/7', 'getReplicardStageHash() returns #replicard/stage/7');

// Fallback extraction when stageUrl is omitted but supporter URL has stage pattern
const fallbackCtx: any = {
  template: {
    questUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/15/816131/25/0/25083',
    steps: []
  },
  page: {},
  sentinel: {},
  state: {}
};
const fallbackResolution = new CombatResolutionService(fallbackCtx);
assert(fallbackResolution.getReplicardStageHash() === '#replicard/stage/7', 'Fallback extraction resolves #replicard/stage/7 from supporter URL pattern');
assert(fallbackResolution.isReplicardWorkflow() === true, 'Fallback context identifies as Replicard workflow');

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
if (failed === 0) {
  console.log('🎉 ALL XENO COCYTUS MILITIS TESTS PASSED (100% SUCCESS)');
  console.log('========================================================================\n');
  process.exit(0);
} else {
  console.error(`💥 FAILED with ${failed} errors`);
  console.log('========================================================================\n');
  process.exit(1);
}

// tests/test-arcarum-xeno-ifrit.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { isSoloWorkflowTemplate } from '../src/types/workflow.types.js';
import { ARCARUM_KALENDAE_PRESETS, ARCARUM_PRESETS, ARCARUM_ALIASES } from '../src/cli/run-arcarum.js';
import { CombatResolutionService } from '../src/engines/universal/combat-resolution.service.js';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('    Arcarum Stage 6 (Xeno Ifrit Militis) Template & Test Suite          ');
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

const tmpl = TemplateParser.loadTemplate('arcarum-xeno-ifrit-militis');
assert(!!tmpl, 'Loaded canonical template: arcarum-xeno-ifrit-militis');

const validation = validateWorkflowTemplate(tmpl);
assert(validation.valid, `Schema valid for arcarum-xeno-ifrit-militis (Errors: ${validation.errors?.join(', ') || 'none'})`);

assert(
  tmpl.questUrl === 'https://game.granbluefantasy.jp/#replicard/supporter/6/6/14/815131/25/0/25083',
  `Quest URL matches expected (${tmpl.questUrl})`
);
assert(
  tmpl.stageUrl === 'https://game.granbluefantasy.jp/#replicard/stage/6',
  `Stage URL matches expected (${tmpl.stageUrl})`
);
assert(tmpl.questId === '815131', `Quest ID is 815131 (got ${tmpl.questId})`);
assert(tmpl.divisionId === 14, `Division ID is 14 (got ${tmpl.divisionId})`);
assert(tmpl.element === 'Water', `Uses Water advantage against Fire Militis Boss (got ${tmpl.element})`);
assert(tmpl.isSolo === true, `Marked as solo quest for autonomous enemy HP tracking (isSolo: true)`);
assert(isSoloWorkflowTemplate(tmpl) === true, `isSoloWorkflowTemplate(tmpl) evaluates to true`);
assert(tmpl.steps.length === 18, `Template contains exact 18 steps (2 pre-skill + 16 rotation) (got ${tmpl.steps.length})`);

// -----------------------------------------------------------------------------
// Test Group 2: Pre-Skill Screen Load Guard & Equivalence with Xeno Cocytus
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 2: Pre-Skill Screen Load Guard & Equivalence with Xeno Cocytus ---');

// Pre-skill guards
const step1 = tmpl.steps[0];
assert(step1.code === 'wait_element', 'Step 1 is wait_element for combat screen fully loaded');
assert(step1.target?.includes('.btn-attack-start') === true, `Step 1 target includes .btn-attack-start (${step1.target})`);
assert((step1.timeoutMs || 0) >= 5000, `Step 1 timeout is safe (${step1.timeoutMs}ms)`);

const step2 = tmpl.steps[1];
assert(step2.code === 'wait_random', 'Step 2 is wait_random human delay before actions');
assert((step2.minMs || 0) >= 400 && (step2.maxMs || 0) <= 2000, `Step 2 randomized delay is well-bounded (${step2.minMs}-${step2.maxMs}ms)`);

// Step 3 is ensured C4S1
const step3 = tmpl.steps[2];
assert(step3.code === 'skill' && step3.character === 4 && step3.skill === 1, 'Step 3 is Character 4 Skill 1');
assert(step3.ensureCast === true, 'Step 3 preserves ensureCast: true');

// Compare subsequent rotation steps with Xeno Cocytus Militis
const cocytusTemplate = TemplateParser.loadTemplate('arcarum-xeno-cocytus-militis');
assert(
  tmpl.steps.length === cocytusTemplate.steps.length + 2,
  `Xeno Ifrit step count (${tmpl.steps.length}) is exactly Cocytus (${cocytusTemplate.steps.length}) + 2 pre-skill guards`
);

for (let i = 0; i < cocytusTemplate.steps.length; i++) {
  const iStep = tmpl.steps[i + 2]; // Offset by 2 pre-action steps
  const cStep = cocytusTemplate.steps[i];

  assert(
    iStep.code === cStep.code,
    `Rotation step ${i + 1} action matches: ${iStep.code} === ${cStep.code}`
  );

  if (iStep.code === 'skill') {
    assert(
      iStep.character === cStep.character && iStep.skill === cStep.skill,
      `Rotation step ${i + 1} skill target matches: C${iStep.character}S${iStep.skill}`
    );
    if (cStep.ensureCast) {
      assert(iStep.ensureCast === true, `Rotation step ${i + 1} has ensureCast: true`);
    }
  }

  if (iStep.code === 'summon') {
    assert(
      iStep.slot === cStep.slot,
      `Rotation step ${i + 1} summon slot matches: Slot #${iStep.slot}`
    );
  }
}

// -----------------------------------------------------------------------------
// Test Group 3: Canonical Alias Resolution & Zero Redundant Clones
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 3: Canonical Alias Resolution & Zero Redundant Clones ---');

const dslPath = path.resolve(process.cwd(), 'templates', 'arcarum-xeno-ifrit-militis-rotation.dsl');
assert(!fs.existsSync(dslPath), `DSL file confirmed absent on disk (JSON-only policy enforced): ${dslPath}`);

const redundantClone = path.resolve(process.cwd(), 'templates', 'arcarum-xeno-ifrit-militis-smart.json');
assert(!fs.existsSync(redundantClone), 'Redundant clone arcarum-xeno-ifrit-militis-smart.json does NOT exist on disk');

const aliases = [
  'arcarum-xeno-ifrit-militis-rotation',
  'arcarum-xeno-ifrit-militis-smart',
  'arcarum-xeno-ifrit',
  'xeno-ifrit-militis',
  'xeno-ifrit',
  'ifrit-militis',
  'ifrit'
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
    resolved.steps.length === 18,
    `Alias "${alias}" retains all 18 steps`
  );
}

// -----------------------------------------------------------------------------
// Test Group 4: CLI Preset Registry & Aliases
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 4: CLI Preset Registry & Aliases ---');

assert(!!ARCARUM_KALENDAE_PRESETS['xeno-ifrit'], 'Preset "xeno-ifrit" registered in ARCARUM_KALENDAE_PRESETS');
const preset = ARCARUM_KALENDAE_PRESETS['xeno-ifrit'];
assert(preset.questId === '815131', 'Preset questId is 815131');
assert(preset.divisionId === 14, 'Preset divisionId is 14');
assert(preset.aapCost === 25, 'Preset aapCost is 25');
assert(preset.element === 'Fire', 'Preset boss element is Fire');
assert(preset.type === 'boss', 'Preset type is boss');

assert(!!ARCARUM_PRESETS['xeno-ifrit'], 'Preset "xeno-ifrit" merged into authoritative ARCARUM_PRESETS');

const cliAliases = [
  ['ifrit', 'xeno-ifrit'],
  ['ifrit-militis', 'xeno-ifrit'],
  ['xeno-ifrit-militis', 'xeno-ifrit'],
  ['xenoifrit', 'xeno-ifrit']
];

for (const [alias, target] of cliAliases) {
  assert(
    ARCARUM_ALIASES[alias] === target,
    `CLI alias "${alias}" maps to "${target}"`
  );
}

// -----------------------------------------------------------------------------
// Test Group 5: Combat Resolution Stage 6 Map Navigation & Popup Settlement
// -----------------------------------------------------------------------------
console.log('\n--- Test Group 5: Combat Resolution Stage 6 Map Navigation & Popup Settlement ---');

const mockCtx: any = {
  template: tmpl,
  page: {},
  sentinel: {},
  state: {}
};
const combatResolution = new CombatResolutionService(mockCtx);
assert(combatResolution.isReplicardWorkflow() === true, 'isReplicardWorkflow() is true for Xeno Ifrit Militis');
assert(combatResolution.getReplicardStageHash() === '#replicard/stage/6', 'getReplicardStageHash() returns #replicard/stage/6');

// Fallback extraction when stageUrl is omitted but supporter URL has stage pattern
const fallbackCtx: any = {
  template: {
    questUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/6/6/14/815131/25/0/25083',
    steps: []
  },
  page: {},
  sentinel: {},
  state: {}
};
const fallbackResolution = new CombatResolutionService(fallbackCtx);
assert(fallbackResolution.getReplicardStageHash() === '#replicard/stage/6', 'Fallback extraction resolves #replicard/stage/6 from supporter URL pattern');
assert(fallbackResolution.isReplicardWorkflow() === true, 'Fallback context identifies as Replicard workflow');

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------
console.log('\n========================================================================');
console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
if (failed === 0) {
  console.log('🎉 ALL XENO IFRIT MILITIS TESTS PASSED (100% SUCCESS)');
  console.log('========================================================================\n');
  process.exit(0);
} else {
  console.error(`💥 FAILED with ${failed} errors`);
  console.log('========================================================================\n');
  process.exit(1);
}

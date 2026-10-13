import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { ARCARUM_GOLIATH_PRESETS, ARCARUM_FAYM_PRESETS, ARCARUM_PRESETS, ARCARUM_ALIASES } from '../src/cli/run-arcarum.js';

console.log('========================================================================');
console.log('   Arcarum Stage 3 (Zone Goliath & Zone Faym) Comprehensive Test Suite  ');
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

// 1. Expected Stage 3 templates (Goliath & Faym)
const stage3Templates = [
  // Zone Goliath
  {
    name: 'Zone Goliath Universal Map',
    templateId: 'arcarum-stage-3-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: 'map'
  },
  {
    name: 'Goliath Triune (Zone Boss)',
    templateId: 'arcarum-goliath-triune-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: 'boss'
  },
  {
    name: 'Avatar of Avarice (The Hanged Man Defender)',
    templateId: 'arcarum-avatar-of-avarice-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: 'defender'
  },
  {
    name: 'Goliath Keeper (The Tower Defender)',
    templateId: 'arcarum-goliath-keeper-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: 'defender'
  },
  {
    name: 'Frenzied Howler (Death Defender)',
    templateId: 'arcarum-frenzied-howler-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: 'defender'
  },
  {
    name: 'Zone Goliath Sephira Heralds',
    templateId: 'arcarum-goliath-herald-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: 'herald'
  },
  {
    name: 'Earthshaking Panther (Green 5-Gauge)',
    templateId: 'arcarum-goliath-panther-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: '5-gauge'
  },
  {
    name: 'Bloodstained Barbarian (Pink 5-Gauge)',
    templateId: 'arcarum-goliath-barbarian-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: '5-gauge'
  },
  {
    name: 'Writhing Despair (Yellow 5-Gauge)',
    templateId: 'arcarum-goliath-despair-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/3',
    type: '5-gauge'
  },
  // Zone Faym
  {
    name: 'Lilywhite Paragon (The Moon Defender)',
    templateId: 'arcarum-lilywhite-paragon-smart',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/3/3/10/812111/25',
    type: 'defender'
  },
  {
    name: 'Faymian Fortress (The Moon 5-Gauge)',
    templateId: 'arcarum-faymian-fortress',
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/3/3/10/812051/25',
    type: '5-gauge'
  }
];

console.log('--- Test Group 1: Template Loading & Schema Validation ---');
for (const cfg of stage3Templates) {
  try {
    const template = TemplateParser.loadTemplate(cfg.templateId);
    assert(!!template, `Loaded template: ${cfg.templateId}`);

    const validation = validateWorkflowTemplate(template);
    assert(validation.valid, `Schema valid: ${cfg.templateId} (Errors: ${validation.errors.join(', ') || 'None'})`);

    assert(template.questUrl === cfg.expectedUrl, `Quest URL matches expected: ${template.questUrl}`);
    assert(template.autoElixir === true, `autoElixir enabled for AAP recovery: ${cfg.templateId}`);
    assert(template.humanMotor === true, `humanMotor enabled: ${cfg.templateId}`);
    assert(template.stopOnCaptcha === true, `stopOnCaptcha sentinel enabled: ${cfg.templateId}`);

    const hasCombatSteps = template.steps.some((s: any) => s.code === 'smart_full_auto' || s.code === 'attack' || s.code === 'skill');
    assert(hasCombatSteps, `Contains valid combat steps: ${cfg.templateId}`);

    const hasConfirm = template.steps.some((s: any) => s.code === 'confirm_result');
    assert(hasConfirm, `Contains confirm_result step: ${cfg.templateId}`);
  } catch (err: any) {
    assert(false, `Error testing ${cfg.templateId}: ${err.message}`);
  }
}

console.log('\n--- Test Group 2: CLI Preset & Alias Resolution ---');
const expectedGoliathPresets = ['stage3', 'triune', 'avarice', 'keeper', 'howler', 'goliath-herald', 'panther', 'barbarian', 'despair'];
for (const pKey of expectedGoliathPresets) {
  const p = ARCARUM_GOLIATH_PRESETS[pKey];
  assert(!!p, `Preset registered in ARCARUM_GOLIATH_PRESETS: ${pKey}`);
  assert(p.aapCost > 0, `Preset ${pKey} has valid aapCost (${p?.aapCost})`);

  const merged = ARCARUM_PRESETS[pKey];
  assert(!!merged, `Preset accessible via merged ARCARUM_PRESETS: ${pKey}`);
}

const expectedFaymPresets = ['paragon', 'fortress'];
for (const pKey of expectedFaymPresets) {
  const p = ARCARUM_FAYM_PRESETS[pKey];
  assert(!!p, `Preset registered in ARCARUM_FAYM_PRESETS: ${pKey}`);
  assert(p.aapCost > 0, `Preset ${pKey} has valid aapCost (${p?.aapCost})`);

  const merged = ARCARUM_PRESETS[pKey];
  assert(!!merged, `Preset accessible via merged ARCARUM_PRESETS: ${pKey}`);
}

const aliasTests = [
  // Goliath
  { alias: 'goliath', expected: 'stage3' },
  { alias: 'stage-3', expected: 'stage3' },
  { alias: 'goliath-triune', expected: 'triune' },
  { alias: 'avatar-of-avarice', expected: 'avarice' },
  { alias: 'avatar', expected: 'avarice' },
  { alias: 'goliath-keeper', expected: 'keeper' },
  { alias: 'frenzied-howler', expected: 'howler' },
  { alias: 'earthshaking-panther', expected: 'panther' },
  { alias: 'bloodstained-barbarian', expected: 'barbarian' },
  { alias: 'writhing-despair', expected: 'despair' },
  // Faym
  { alias: 'lilywhite', expected: 'paragon' },
  { alias: 'lilywhite-paragon', expected: 'paragon' },
  { alias: 'faymian-fortress', expected: 'fortress' },
  { alias: 'faymian', expected: 'fortress' },
  { alias: 'faym-fortress', expected: 'fortress' }
];

for (const at of aliasTests) {
  const resolved = ARCARUM_ALIASES[at.alias];
  assert(resolved === at.expected, `Alias "${at.alias}" correctly resolves to "${at.expected}"`);
  assert(!!ARCARUM_PRESETS[resolved], `Resolved alias "${at.alias}" -> "${resolved}" maps to valid preset`);
}

console.log('\n--- Test Group 3: Lilywhite Paragon Custom Rotation & DSL Verification ---');
try {
  // 1. JSON Template Verification
  const paragonJson = TemplateParser.loadTemplate('arcarum-lilywhite-paragon-smart');
  assert(!!paragonJson, 'Loaded arcarum-lilywhite-paragon-smart template');
  assert(paragonJson.isSolo === true, 'arcarum-lilywhite-paragon-smart has isSolo: true');
  assert(paragonJson.steps.length === 16, `Contains exact 16-step rotation without redundant HP step clutter (${paragonJson.steps.length}/16 steps)`);

  const c4s1Step = paragonJson.steps.find((s: any) => s.code === 'skill' && s.character === 4 && s.skill === 1);
  assert(!!c4s1Step, 'Contains C4S1 step');
  assert(c4s1Step?.ensureCast === true, 'C4S1 has ensureCast: true (guarantees click & cast)');

  const quickCallStep = paragonJson.steps.find((s: any) => s.code === 'quick_call');
  assert(!!quickCallStep, 'Contains quick_call step');

  const summon4Step = paragonJson.steps.find((s: any) => s.code === 'summon' && s.slot === 4);
  assert(!!summon4Step, 'Contains summon slot 4 step');

  const summon3Step = paragonJson.steps.find((s: any) => s.code === 'summon' && s.slot === 3);
  assert(!!summon3Step, 'Contains summon slot 3 step');

  const rerunStep = paragonJson.steps[paragonJson.steps.length - 1];
  assert(rerunStep.code === 'confirm_result', 'Terminal step is confirm_result (handles rerun & next battle loop)');

  // 2. DSL Template Verification
  const paragonDsl = TemplateParser.loadTemplate('arcarum-lilywhite-paragon-rotation');
  assert(!!paragonDsl, 'Compiled arcarum-lilywhite-paragon-rotation.dsl successfully');
  assert(paragonDsl.isSolo === true, 'DSL has isSolo: true via header declaration');
  assert(paragonDsl.steps.length === 16, `DSL compiled to exact 16-step rotation (${paragonDsl.steps.length}/16 steps)`);

  const dslValidation = validateWorkflowTemplate(paragonDsl);
  assert(dslValidation.valid, `DSL schema validation passed (Errors: ${dslValidation.errors.join(', ') || 'None'})`);

  const dslC4s1 = paragonDsl.steps[0];
  assert(dslC4s1.code === 'skill' && dslC4s1.character === 4 && dslC4s1.skill === 1, 'DSL Step 0 parsed as Character 4 Skill 1');
  assert(dslC4s1.ensureCast === true, 'DSL "c4s1 (make sure clicked or casted)" compiled with ensureCast: true');

  const dslSummon4 = paragonDsl.steps.find((s: any) => s.code === 'summon' && s.slot === 4);
  assert(!!dslSummon4, 'DSL "summon #4" correctly compiled to summon slot 4');

  const dslSummon3 = paragonDsl.steps.find((s: any) => s.code === 'summon' && s.slot === 3);
  assert(!!dslSummon3, 'DSL "summon #3" correctly compiled to summon slot 3');

  const dslRerun = paragonDsl.steps[paragonDsl.steps.length - 1];
  assert(dslRerun.code === 'confirm_result', 'DSL "rerun" correctly compiled to confirm_result');

  // 3. DSL Exit If Dead / Exit If HP compilation check
  const testDslCode = `
name: Test Solo Exit DSL
start: https://game.granbluefantasy.jp/#replicard/stage/3
solo: true
exit_if_dead
attack
exit_if_hp 25%
reload
`;
  const compiledTest = TemplateParser.parseDsl(testDslCode);
  assert(compiledTest.isSolo === true, 'Test DSL parsed isSolo: true');
  assert(compiledTest.steps.some((s: any) => s.code === 'exit_if_dead'), 'DSL supports exit_if_dead');
  const hpExit = compiledTest.steps.find((s: any) => s.code === 'exit_if_hp');
  assert(!!hpExit && hpExit.targetHpPct === 25, 'DSL supports exit_if_hp 25%');
} catch (err: any) {
  assert(false, `Error testing Lilywhite Paragon custom rotation: ${err.message}`);
}

console.log('\n========================================================================');
console.log(`Scorecard: ${passed} Passed | ${failed} Failed`);
console.log('========================================================================\n');

if (failed > 0) {
  console.error(`💥 ${failed} tests failed!`);
  process.exit(1);
} else {
  console.log('🎉 All Arcarum Stage 3 (Goliath & Faym) Tests Passed Successfully!');
  process.exit(0);
}

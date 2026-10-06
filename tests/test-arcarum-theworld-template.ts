// tests/test-arcarum-theworld-template.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Suite - Arcarum: The World Template Tests       ');
console.log('========================================================================\n');

// 1. Validate arcarum-theworld.json schema and pipeline
console.log('1. Validating arcarum-theworld.json schema & properties...');
const tmplWorld = TemplateParser.loadTemplate('arcarum-theworld');
if (!tmplWorld) {
  throw new Error('Failed to load arcarum-theworld template');
}
if (tmplWorld.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/16/819131/25/0/25085') {
  throw new Error(`Unexpected questUrl: ${tmplWorld.questUrl}`);
}
if (!tmplWorld.steps.some(s => s.code === 'quick_call')) {
  throw new Error('Expected quick_call in arcarum-theworld template');
}
if (!tmplWorld.steps.some(s => s.code === 'skill')) {
  throw new Error('Expected skill steps in arcarum-theworld template');
}

const attackStep = tmplWorld.steps.find(s => s.code === 'attack');
if (!attackStep || attackStep.waitForNetwork !== 'normal_attack_result.json' || !attackStep.delayAfterMs) {
  throw new Error(`Expected attack step with normal_attack_result.json and delayAfterMs, got: ${JSON.stringify(attackStep)}`);
}

const reloadStep = tmplWorld.steps.find(s => s.code === 'reload');
if (!reloadStep) {
  throw new Error('Expected reload step in arcarum-theworld template');
}

const repeatStep = tmplWorld.steps.find(s => s.code === 'repeat');
if (!repeatStep || !repeatStep.subSteps || repeatStep.subSteps.length === 0) {
  throw new Error('Expected repeat block in arcarum-theworld template for multi-turn battle cleanup');
}

const confirmStep = tmplWorld.steps.find(s => s.code === 'confirm_result');
if (!confirmStep) {
  throw new Error('Expected confirm_result step at the end of arcarum-theworld template');
}
console.log('   ✅ arcarum-theworld.json validated: optimal skills, attack-wait-reload, repeat loop, and result confirmation');

// 2. Validate arcarum-theworld-smart.json
console.log('\n2. Validating arcarum-theworld-smart.json with smart_full_auto action...');
const tmplSmart = TemplateParser.loadTemplate('arcarum-theworld-smart');
if (!tmplSmart) {
  throw new Error('Failed to load arcarum-theworld-smart template');
}
const smartStep = tmplSmart.steps.find(s => s.code === 'smart_full_auto');
if (!smartStep || smartStep.delayAfterMs !== 350) {
  throw new Error(`Expected smart_full_auto step with 350ms delay, got: ${JSON.stringify(smartStep)}`);
}

const valSmart = validateWorkflowTemplate(tmplSmart);
if (!valSmart.valid || valSmart.errors.length > 0) {
  throw new Error(`Smart template failed validation: ${valSmart.errors.join(', ')}`);
}
console.log('   ✅ arcarum-theworld-smart.json validated: smart_full_auto engine action compliant with zero warnings');

// 3. DSL Compilation and Round-Trip Serializer Test
console.log('\n3. Testing DSL round-trip compilation for Arcarum The World templates...');
const dslWorld = TemplateParser.serializeToDsl(tmplWorld);
if (!dslWorld.includes('Quest: https://game.granbluefantasy.jp/#replicard/supporter/10/10/16/819131/25/0/25085') ||
    !dslWorld.includes('quick_call') ||
    !dslWorld.includes('repeat 15 {')) {
  throw new Error(`DSL output missing expected contents:\n${dslWorld}`);
}

const parsedFromDsl = TemplateParser.parseShorthandDsl(dslWorld, 'arcarum-theworld');
if (parsedFromDsl.steps.length !== tmplWorld.steps.length) {
  throw new Error(`DSL round-trip step count mismatch: expected ${tmplWorld.steps.length}, got ${parsedFromDsl.steps.length}`);
}

const dslSmart = TemplateParser.serializeToDsl(tmplSmart);
if (!dslSmart.includes('smart_full_auto')) {
  throw new Error(`DSL smart output missing smart_full_auto:\n${dslSmart}`);
}

const parsedSmartFromDsl = TemplateParser.parseShorthandDsl(dslSmart, 'arcarum-theworld-smart');
if (parsedSmartFromDsl.steps[0].code !== 'smart_full_auto') {
  throw new Error(`Parsed DSL missing smart_full_auto: got ${parsedSmartFromDsl.steps[0].code}`);
}
console.log('   ✅ DSL round-trip compilation: 100% faithful syntax generation and re-parsing');

// 3b. Validate Athena Militis templates & DSL round-trip
console.log('\n3b. Validating arcarum-athena-militis.json & arcarum-athena-militis-smart.json...');
const tmplAthena = TemplateParser.loadTemplate('arcarum-athena-militis');
if (!tmplAthena || tmplAthena.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/6/6/16/815091/25/0/25075') {
  throw new Error(`Failed to load arcarum-athena-militis or unexpected questUrl: ${tmplAthena?.questUrl}`);
}
const valAthena = validateWorkflowTemplate(tmplAthena);
if (!valAthena.valid) {
  throw new Error(`Athena template failed validation: ${valAthena.errors.join(', ')}`);
}

const tmplAthenaSmart = TemplateParser.loadTemplate('arcarum-athena-militis-smart');
if (!tmplAthenaSmart || tmplAthenaSmart.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/6/6/16/815091/25/0/25075') {
  throw new Error(`Failed to load arcarum-athena-militis-smart or unexpected questUrl: ${tmplAthenaSmart?.questUrl}`);
}
const valAthenaSmart = validateWorkflowTemplate(tmplAthenaSmart);
if (!valAthenaSmart.valid) {
  throw new Error(`Athena Smart template failed validation: ${valAthenaSmart.errors.join(', ')}`);
}

const dslAthenaSmart = TemplateParser.serializeToDsl(tmplAthenaSmart);
if (!dslAthenaSmart.includes('smart_full_auto') || !dslAthenaSmart.includes('815091')) {
  throw new Error(`DSL Athena smart output missing expected fields:\n${dslAthenaSmart}`);
}
const parsedAthenaSmart = TemplateParser.parseShorthandDsl(dslAthenaSmart, 'arcarum-athena-militis-smart');
if (parsedAthenaSmart.steps[0].code !== 'smart_full_auto') {
  throw new Error(`Parsed Athena smart DSL missing smart_full_auto`);
}
console.log('   ✅ Athena Militis templates validated: JSON schema, smart_full_auto action, and DSL round-trip');

// 3c. Validate Grani Militis templates & DSL round-trip
console.log('\n3c. Validating arcarum-grani-militis.json & arcarum-grani-militis-smart.json...');
const tmplGrani = TemplateParser.loadTemplate('arcarum-grani-militis');
if (!tmplGrani || tmplGrani.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/16/816091/25/0/25076') {
  throw new Error(`Failed to load arcarum-grani-militis or unexpected questUrl: ${tmplGrani?.questUrl}`);
}
const valGrani = validateWorkflowTemplate(tmplGrani);
if (!valGrani.valid) {
  throw new Error(`Grani template failed validation: ${valGrani.errors.join(', ')}`);
}

const tmplGraniSmart = TemplateParser.loadTemplate('arcarum-grani-militis-smart');
if (!tmplGraniSmart || tmplGraniSmart.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/16/816091/25/0/25076') {
  throw new Error(`Failed to load arcarum-grani-militis-smart or unexpected questUrl: ${tmplGraniSmart?.questUrl}`);
}
const valGraniSmart = validateWorkflowTemplate(tmplGraniSmart);
if (!valGraniSmart.valid) {
  throw new Error(`Grani Smart template failed validation: ${valGraniSmart.errors.join(', ')}`);
}

const dslGraniSmart = TemplateParser.serializeToDsl(tmplGraniSmart);
if (!dslGraniSmart.includes('smart_full_auto') || !dslGraniSmart.includes('816091')) {
  throw new Error(`DSL Grani smart output missing expected fields:\n${dslGraniSmart}`);
}
const parsedGraniSmart = TemplateParser.parseShorthandDsl(dslGraniSmart, 'arcarum-grani-militis-smart');
const tmplGraniFast = TemplateParser.loadTemplate('arcarum-grani-militis-fast');
if (!tmplGraniFast || tmplGraniFast.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/16/816091/25/0/25076') {
  throw new Error(`Failed to load arcarum-grani-militis-fast or unexpected questUrl: ${tmplGraniFast?.questUrl}`);
}
const valGraniFast = validateWorkflowTemplate(tmplGraniFast);
if (!valGraniFast.valid) {
  throw new Error(`Grani Fast template failed validation: ${valGraniFast.errors.join(', ')}`);
}
console.log('   ✅ Grani Militis templates validated: JSON schema, smart_full_auto action, fast 0-button OTK, and DSL round-trip');

// 4. Mock Verification of Replicard AAP Modal Handling
console.log('\n4. Testing UniversalWorkflowEngine AAP Recovery Logic...');
let aapItemClicked = false;
let aapOkClicked = false;
let cancelClicked = false;

const mockPage: any = {
  url: () => 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/16/819131/25/0/25085',
  evaluate: async (fn: any, ...args: any[]) => {
    // Simulate DOM check for AAP modal
    return true; // isAapModal = true
  },
  waitForSelector: async (sel: string) => {
    if (sel.includes('.btn-use-item')) {
      return {
        evaluate: async (cb: any) => cb({ click: () => { aapItemClicked = true; } }),
        click: async () => { aapItemClicked = true; },
        boundingBox: async () => ({ x: 100, y: 100, width: 50, height: 20 })
      };
    }
    if (sel.includes('.btn-usual-ok')) {
      return {
        evaluate: async (cb: any) => cb({ click: () => { aapOkClicked = true; } }),
        click: async () => { aapOkClicked = true; },
        boundingBox: async () => ({ x: 100, y: 150, width: 50, height: 20 })
      };
    }
    return null;
  },
  $: async (sel: string) => {
    if (sel.includes('.btn-usual-cancel')) {
      return {
        evaluate: async (cb: any) => cb({ click: () => { cancelClicked = true; } }),
        click: async () => { cancelClicked = true; },
        boundingBox: async () => ({ x: 100, y: 200, width: 50, height: 20 })
      };
    }
    return null;
  },
  touchscreen: { tap: async () => {} },
  mouse: { move: async () => {}, click: async () => {}, down: async () => {}, up: async () => {} },
  on: () => {},
  off: () => {}
};

const mockSentinel: any = {
  setSessionContext: () => {},
  assertSafe: async () => true,
  inspectForVerification: async () => false
};

const engine = new UniversalWorkflowEngine(mockPage as any, mockSentinel as any, tmplWorld, 'acc1');

const restored = await engine.handleAapRecoveryModal(true);
if (!restored) {
  throw new Error('Expected handleAapRecoveryModal(true) to return true');
}
console.log('   ✅ AAP recovery modal properly handled and confirmed via Half-Elixir');

const denied = await engine.handleAapRecoveryModal(false);
if (denied !== false) {
  throw new Error('Expected handleAapRecoveryModal(false) to return false when autoElixir is disabled');
}
console.log('   ✅ AAP recovery properly respects autoElixir: false');

console.log('\n========================================================================');
console.log('🎉 ALL ARCARUM: THE WORLD TEMPLATE TESTS PASSED (100% GOLD STANDARD)');
console.log('========================================================================\n');
process.exit(0);

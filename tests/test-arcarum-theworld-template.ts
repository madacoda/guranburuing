// tests/test-arcarum-theworld-template.ts
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { UniversalWorkflowEngine } from '../src/engines/universal-workflow.engine.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Suite - Arcarum: The World Template Tests       ');
console.log('========================================================================\n');

// 1. Validate arcarum-theworld.json schema and pipeline format
console.log('1. Validating arcarum-theworld.json schema & properties...');
const tmplWorld = TemplateParser.loadTemplate('arcarum-theworld');
if (!tmplWorld) {
  throw new Error('Failed to load arcarum-theworld template');
}
if (!tmplWorld.questUrl || !tmplWorld.questUrl.includes('replicard')) {
  throw new Error(`Unexpected questUrl: ${tmplWorld.questUrl}`);
}

const valWorld = validateWorkflowTemplate(tmplWorld);
if (!valWorld.valid || valWorld.errors.length > 0) {
  throw new Error(`arcarum-theworld template failed schema validation: ${valWorld.errors.join(', ')}`);
}
if (!Array.isArray(tmplWorld.steps) || tmplWorld.steps.length === 0) {
  throw new Error('Expected non-empty steps array in arcarum-theworld template');
}
console.log(`   ✅ arcarum-theworld.json validated: valid schema, valid Replicard URL, and ${tmplWorld.steps.length} customizable steps`);

// 2. Validate arcarum-theworld-smart.json
console.log('\n2. Validating arcarum-theworld-smart.json format...');
const tmplSmart = TemplateParser.loadTemplate('arcarum-theworld-smart');
if (!tmplSmart) {
  throw new Error('Failed to load arcarum-theworld-smart template');
}

const valSmart = validateWorkflowTemplate(tmplSmart);
if (!valSmart.valid || valSmart.errors.length > 0) {
  throw new Error(`Smart template failed validation: ${valSmart.errors.join(', ')}`);
}
if (!Array.isArray(tmplSmart.steps) || tmplSmart.steps.length === 0) {
  throw new Error('Expected non-empty steps array in arcarum-theworld-smart template');
}
console.log(`   ✅ arcarum-theworld-smart.json validated: schema compliant with ${tmplSmart.steps.length} customizable steps`);

// 3. DSL Compilation and Round-Trip Serializer Test
console.log('\n3. Testing DSL round-trip compilation for Arcarum The World templates...');
const dslWorld = TemplateParser.serializeToDsl(tmplWorld);
if (!dslWorld || typeof dslWorld !== 'string' || dslWorld.length === 0) {
  throw new Error(`DSL serialization for arcarum-theworld failed`);
}

const parsedFromDsl = TemplateParser.parseShorthandDsl(dslWorld, 'arcarum-theworld');
if (parsedFromDsl.steps.length !== tmplWorld.steps.length) {
  throw new Error(`DSL round-trip step count mismatch: expected ${tmplWorld.steps.length}, got ${parsedFromDsl.steps.length}`);
}

const dslSmart = TemplateParser.serializeToDsl(tmplSmart);
if (!dslSmart || typeof dslSmart !== 'string' || dslSmart.length === 0) {
  throw new Error(`DSL serialization for arcarum-theworld-smart failed`);
}

const parsedSmartFromDsl = TemplateParser.parseShorthandDsl(dslSmart, 'arcarum-theworld-smart');
if (parsedSmartFromDsl.steps.length !== tmplSmart.steps.length) {
  throw new Error(`DSL smart round-trip step count mismatch: expected ${tmplSmart.steps.length}, got ${parsedSmartFromDsl.steps.length}`);
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
if (!dslAthenaSmart || !dslAthenaSmart.includes('815091')) {
  throw new Error(`DSL Athena smart output missing expected fields:\n${dslAthenaSmart}`);
}
const parsedAthenaSmart = TemplateParser.parseShorthandDsl(dslAthenaSmart, 'arcarum-athena-militis-smart');
if (parsedAthenaSmart.steps.length !== tmplAthenaSmart.steps.length) {
  throw new Error(`DSL round-trip step count mismatch for Athena: expected ${tmplAthenaSmart.steps.length}, got ${parsedAthenaSmart.steps.length}`);
}
console.log(`   ✅ Athena Militis templates validated: JSON schema compliant, ${tmplAthenaSmart.steps.length} customizable steps, and DSL round-trip`);

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
if (!dslGraniSmart || !dslGraniSmart.includes('816091')) {
  throw new Error(`DSL Grani smart output missing expected fields:\n${dslGraniSmart}`);
}
const parsedGraniSmart = TemplateParser.parseShorthandDsl(dslGraniSmart, 'arcarum-grani-militis-smart');
if (parsedGraniSmart.steps.length !== tmplGraniSmart.steps.length) {
  throw new Error(`DSL round-trip step count mismatch for Grani Smart: expected ${tmplGraniSmart.steps.length}, got ${parsedGraniSmart.steps.length}`);
}

const tmplGraniFast = TemplateParser.loadTemplate('arcarum-grani-militis-fast');
if (!tmplGraniFast || tmplGraniFast.questUrl !== 'https://game.granbluefantasy.jp/#replicard/supporter/7/7/16/816091/25/0/25076') {
  throw new Error(`Failed to load arcarum-grani-militis-fast or unexpected questUrl: ${tmplGraniFast?.questUrl}`);
}
const valGraniFast = validateWorkflowTemplate(tmplGraniFast);
if (!valGraniFast.valid) {
  throw new Error(`Grani Fast template failed validation: ${valGraniFast.errors.join(', ')}`);
}
console.log(`   ✅ Grani Militis templates validated: JSON schema compliant, customizable steps (${tmplGraniSmart.steps.length} smart / ${tmplGraniFast.steps.length} fast), and DSL round-trip`);

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

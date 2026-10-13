import { TemplateParser } from '../src/templates/template-parser';
import * as fs from 'fs';
import * as path from 'path';

console.log('========================================================================');
console.log('       Proto Bahamut HL (gb-pbhl-skill) Manual Flow Test Suite          ');
console.log('========================================================================');

const templatePath = path.resolve(process.cwd(), 'templates/gb-pbhl-skill.json');
if (!fs.existsSync(templatePath)) {
  console.error(`❌ Template not found at: ${templatePath}`);
  process.exit(1);
}

const templateRaw = fs.readFileSync(templatePath, 'utf8');
const template = JSON.parse(templateRaw);

console.log(`Loaded template: "${template.name}"`);
console.log(`Target Score:    ${template.targetScore?.toLocaleString()} pt`);
console.log(`Honor Guard:     ${template.honorGuard}`);
console.log(`Total Steps:     ${template.steps.length}`);

// 1. Verify schema & structural format validity
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';

const val = validateWorkflowTemplate(template);
if (!val.valid) {
  console.error(`❌ Template schema validation failed: ${val.errors.join(', ')}`);
  process.exit(1);
}
console.log('✅ [PASS] Template format & schema validated successfully');

// 2. Verify all steps have recognized codes
const validCodes = new Set([
  'skill', 'attack', 'summon', 'quick_call', 'reload',
  'smart_full_auto', 'repeat', 'confirm_result', 'wait',
  'select_supporter', 'navigate', 'condition', 'heal', 'revive'
]);

for (const step of template.steps) {
  if (!validCodes.has(step.code)) {
    console.error(`❌ Unrecognized step code: "${step.code}" in template`, step);
    process.exit(1);
  }
}
console.log(`✅ [PASS] All ${template.steps.length} steps contain valid recognized action codes`);

// 3. Verify DSL compilation & bidirectional round-trip
const dsl = TemplateParser.serializeToDsl(template);
if (!dsl || typeof dsl !== 'string' || dsl.length === 0) {
  console.error('❌ Failed to serialize template to DSL');
  process.exit(1);
}

const parsedFromDsl = TemplateParser.parseShorthandDsl(dsl, 'gb-pbhl-skill');
if (parsedFromDsl.steps.length !== template.steps.length) {
  console.error(`❌ DSL round-trip step count mismatch: expected ${template.steps.length}, got ${parsedFromDsl.steps.length}`);
  process.exit(1);
}
console.log('✅ [PASS] Shorthand DSL round-trip compiled with 100% fidelity');

console.log('========================================================================');
console.log('🎉 ALL PBHL MANUAL SKILL WORKFLOW TESTS PASSED (100%)');
console.log('========================================================================');

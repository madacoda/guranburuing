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

// 1. Verify no tap_ready, auto, or smart_full_auto steps exist
const automatedSteps = template.steps.filter((s: any) =>
  s.code === 'tap_ready' || s.action === 'tap_ready' ||
  s.code === 'auto' || s.action === 'auto' ||
  s.code === 'smart_full_auto' || s.action === 'smart_full_auto'
);

if (automatedSteps.length > 0) {
  console.error(`❌ Found automated steps in gb-pbhl-skill:`, automatedSteps);
  process.exit(1);
}
console.log('✅ [PASS] No tap_ready or Auto steps found in template');

// 2. Verify all skills and summon have optional: true
const skillAndSummonSteps = template.steps.filter((s: any) => s.code === 'skill' || s.code === 'summon' || s.code === 'quick_call');
for (const step of skillAndSummonSteps) {
  if (step.optional !== true) {
    console.error(`❌ Step ${step.code} missing optional: true:`, step);
    process.exit(1);
  }
}
console.log(`✅ [PASS] All ${skillAndSummonSteps.length} skill/summon steps have optional: true`);

// 3. Verify honorGuard is explicitly false
if (template.honorGuard !== false) {
  console.error(`❌ Expected honorGuard to be false, got: ${template.honorGuard}`);
  process.exit(1);
}
console.log('✅ [PASS] honorGuard is explicitly false');

// 4. Verify rotation order:
// C4S3 -> Quick Call -> Reload -> C4S4 -> C1S3 -> Reload -> C2S3 -> Reload -> Attack -> Reload -> Summon 2 -> Attack -> Reload -> Confirm Result
const stepCodes = template.steps.map((s: any) => {
  if (s.code === 'skill') return `C${s.character}S${s.skill}`;
  if (s.code === 'summon') return `Summon${s.slot}`;
  return s.code;
});

console.log('Step sequence:');
console.log(stepCodes.join(' -> '));

const expected = [
  'C4S3',
  'reload',
  'quick_call',
  'reload',
  'C4S4',
  'reload',
  'C1S3',
  'reload',
  'C2S3',
  'reload',
  'attack',
  'reload',
  'Summon2',
  'attack',
  'reload',
  'confirm_result'
];

if (JSON.stringify(stepCodes) !== JSON.stringify(expected)) {
  console.error('❌ Step sequence does not match expected rotation!');
  console.error('Expected:', expected);
  console.error('Received:', stepCodes);
  process.exit(1);
}
console.log('✅ [PASS] Full manual rotation verified 100% compliant!');

console.log('========================================================================');
console.log('🎉 ALL PBHL MANUAL SKILL WORKFLOW TESTS PASSED (100%)');
console.log('========================================================================');

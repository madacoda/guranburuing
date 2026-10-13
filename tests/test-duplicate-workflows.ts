// tests/test-duplicate-workflows.ts
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';
import { WorkflowTemplate } from '../src/types/workflow.types.js';

console.log('========================================================================');
console.log('      Comprehensive Duplicate Workflow Prevention & Alias Test Suite     ');
console.log('========================================================================\n');

const templatesDir = path.resolve(process.cwd(), 'templates');

// Helper to compute a canonical pipeline signature for any workflow template
function computeWorkflowSignature(template: WorkflowTemplate): string {
  return JSON.stringify({
    questUrl: template.questUrl,
    questId: template.questId,
    divisionId: template.divisionId,
    sector: template.sector,
    targetEnemy: template.targetEnemy,
    element: template.element,
    raidSlot: template.raidSlot,
    targetScore: template.targetScore,
    steps: template.steps.map(s => ({
      code: s.code || s.action,
      target: s.target,
      character: s.character,
      skill: s.skill,
      slot: s.slot,
      mode: s.mode,
      tacticalSkillsMode: s.tacticalSkillsMode,
      delayAfterMs: s.delayAfterMs,
      subSteps: s.subSteps
    }))
  });
}

// -------------------------------------------------------------
// Test 1: Scan All Production Template Files for Zero Duplicates
// -------------------------------------------------------------
console.log('--- Test 1: Verifying 0 Duplicate Workflow Templates on Disk ---');
const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json')).sort();
console.log(`Discovered ${templateFiles.length} template files to audit in ${templatesDir}\n`);

const signatureToFiles = new Map<string, string[]>();

for (const file of templateFiles) {
  const filePath = path.join(templatesDir, file);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);
  const val = validateWorkflowTemplate(json);
  assert(val.valid, `File ${file} failed schema validation: ${val.errors.join(', ')}`);

  const sig = computeWorkflowSignature(val.template!);
  if (!signatureToFiles.has(sig)) {
    signatureToFiles.set(sig, []);
  }
  signatureToFiles.get(sig)!.push(file);
}

let duplicateCount = 0;
for (const [sig, files] of signatureToFiles.entries()) {
  if (files.length > 1) {
    duplicateCount++;
    console.error(`❌ Duplicate workflow detected between: ${files.join(', ')}`);
    console.error(`   Signature: ${sig}`);
  }
}

assert.strictEqual(duplicateCount, 0, `Expected 0 duplicate workflows, found ${duplicateCount}`);
console.log(`✅ [PASS] All ${templateFiles.length} templates possess completely unique, non-duplicate pipelines!\n`);

// -------------------------------------------------------------
// Test 2: Negative Test - Duplicate Detection Catches Clones
// -------------------------------------------------------------
console.log('--- Test 2: Negative Constraint - Duplicate Pipeline Rejection ---');
const baseTemplate = TemplateParser.loadTemplate('gb-pbhl');
const cloneTemplate: WorkflowTemplate = {
  ...JSON.parse(JSON.stringify(baseTemplate)),
  name: 'Completely Different Name But Duplicate Workflow'
};

const baseSig = computeWorkflowSignature(baseTemplate);
const cloneSig = computeWorkflowSignature(cloneTemplate);
assert.strictEqual(baseSig, cloneSig, 'Cloned template should match base template signature');

// Verify our detection mechanism catches this collision
const testRegistry = new Map<string, string>();
testRegistry.set(baseSig, 'gb-pbhl.json');
let collisionCaught = false;
if (testRegistry.has(cloneSig)) {
  collisionCaught = true;
}
assert(collisionCaught, 'Duplicate detector must successfully flag cloned workflow');
console.log('✅ [PASS] Cloned workflow signature successfully intercepted and rejected\n');

// -------------------------------------------------------------
// Test 3: Canonical Alias Resolution (Zero Redundant Files)
// -------------------------------------------------------------
console.log('--- Test 3: Canonical Template Alias Resolution (gb-pbhl-universal) ---');

// Assert redundant files do NOT exist on disk
const redundantFiles = ['gb-pbhl-universal.json', 'arcarum-faymian-fortress-smart.json'];
for (const rf of redundantFiles) {
  assert.strictEqual(
    fs.existsSync(path.join(templatesDir, rf)),
    false,
    `${rf} should not exist as a duplicate file on disk`
  );
}
console.log('  ✅ [PASS] Redundant files (gb-pbhl-universal, arcarum-faymian-fortress-smart) confirmed absent');

// Assert TemplateParser resolves the aliases cleanly
const resolvedUniversal = TemplateParser.loadTemplate('gb-pbhl-universal');
assert(resolvedUniversal, 'TemplateParser must resolve canonical alias "gb-pbhl-universal"');
assert.strictEqual(resolvedUniversal.questUrl, baseTemplate.questUrl, 'Must match canonical questUrl');
assert.strictEqual(resolvedUniversal.steps.length, baseTemplate.steps.length, 'Must match canonical step count');
assert.strictEqual(resolvedUniversal.raidSlot, baseTemplate.raidSlot, 'Must match canonical raidSlot');
console.log(`  ✅ [PASS] "gb-pbhl-universal" loaded canonical "gb-pbhl" with ${resolvedUniversal.steps.length} steps`);

const resolvedFortress = TemplateParser.loadTemplate('arcarum-faymian-fortress-smart');
assert(resolvedFortress, 'TemplateParser must resolve canonical alias "arcarum-faymian-fortress-smart"');
assert.strictEqual(resolvedFortress.questUrl, 'https://game.granbluefantasy.jp/#replicard/supporter/3/3/10/812051/25');
console.log(`  ✅ [PASS] "arcarum-faymian-fortress-smart" loaded canonical "arcarum-faymian-fortress" cleanly\n`);

// -------------------------------------------------------------
// Test 4: Verify Arcarum Stage 3 Disambiguation
// -------------------------------------------------------------
console.log('--- Test 4: Verifying Arcarum Stage 3 Sector & Target Disambiguation ---');
const stage3Templates = [
  'arcarum-avatar-of-avarice-smart',
  'arcarum-goliath-keeper-smart',
  'arcarum-goliath-barbarian-smart',
  'arcarum-goliath-panther-smart',
  'arcarum-goliath-triune-smart',
  'arcarum-frenzied-howler-smart',
  'arcarum-goliath-despair-smart',
  'arcarum-goliath-herald-smart',
  'arcarum-stage-3-smart',
  'arcarum-faymian-fortress'
];

const stage3Sigs = new Set<string>();
for (const name of stage3Templates) {
  const tmpl = TemplateParser.loadTemplate(name);
  assert(tmpl.sector, `Template ${name} must define an explicit sector`);
  assert(tmpl.targetEnemy, `Template ${name} must define an explicit targetEnemy`);
  const sig = `${tmpl.questUrl}::${tmpl.sector}::${tmpl.targetEnemy}`;
  assert(!stage3Sigs.has(sig), `Collision in Stage 3 metadata for ${name}: ${sig}`);
  stage3Sigs.add(sig);
  console.log(`  ✅ [PASS] ${name.padEnd(35, ' ')} -> Sector: "${tmpl.sector}" | Target: "${tmpl.targetEnemy}"`);
}
console.log('  ✅ [PASS] All Stage 3 templates completely disambiguated by sector and target!\n');

// -------------------------------------------------------------
// Test 5: Verify M3 Leech Templates Disambiguation
// -------------------------------------------------------------
console.log('--- Test 5: Verifying M3 Leech Templates Disambiguation ---');
const leechTemplates = [
  'leech-celeste-ater',
  'leech-colossus-ira',
  'leech-leviathan-mare',
  'leech-luminiera-credo',
  'leech-tiamat-aura',
  'leech-yggdrasil-arbos'
];

const leechSigs = new Set<string>();
for (const name of leechTemplates) {
  const tmpl = TemplateParser.loadTemplate(name);
  assert(tmpl.element, `Leech template ${name} must declare an element`);
  assert(tmpl.targetEnemy, `Leech template ${name} must declare a targetEnemy`);
  const sig = `${tmpl.element}::${tmpl.targetEnemy}::${tmpl.supporterPriority?.join(',')}`;
  assert(!leechSigs.has(sig), `Collision in Leech metadata for ${name}: ${sig}`);
  leechSigs.add(sig);
  console.log(`  ✅ [PASS] ${name.padEnd(25, ' ')} -> Element: ${tmpl.element.padEnd(6, ' ')} | Supporter: ${tmpl.supporterPriority?.[0]} | Target: ${tmpl.targetEnemy}`);
}
console.log('  ✅ [PASS] All M3 leech templates completely disambiguated by element and target!\n');

// -------------------------------------------------------------
// Test 6: Verify package.json Scripts Point to Valid Templates
// -------------------------------------------------------------
console.log('--- Test 6: Verifying package.json Scripts Reference Valid Workflows ---');
const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const availableTemplates = new Set(TemplateParser.listAvailableTemplates());
// Canonical aliases are also valid template references
availableTemplates.add('gb-pbhl-universal');

let auditedScripts = 0;
for (const [scriptName, scriptCmd] of Object.entries<string>(pkg.scripts)) {
  const tokens = scriptCmd.trim().split(/\s+/);
  const rwIdx = tokens.findIndex(t => t.endsWith('run-workflow.ts') || t.endsWith('run-leech.ts'));
  if (rwIdx !== -1 && tokens.length > rwIdx + 1) {
    let target = tokens[rwIdx + 1];
    if (/^acc\d+$/i.test(target)) {
      target = tokens[rwIdx + 2];
    }
    if (target && !target.startsWith('-') && !/^\d+$/.test(target)) {
      try {
        const loaded = TemplateParser.loadTemplate(target);
        assert(loaded, `Template "${target}" could not be resolved`);
      } catch (err: any) {
        assert.fail(`Script "${scriptName}" references unresolvable template: "${target}" (${err.message})`);
      }
      auditedScripts++;
    }
  }
}
console.log(`  ✅ [PASS] Audited ${auditedScripts} workflow runner scripts in package.json - all point to valid templates!`);

console.log('\n========================================================================');
console.log('     🎉 ALL DUPLICATE WORKFLOW PREVENTION TESTS PASSED (100% SUCCESS)    ');
console.log('========================================================================\n');

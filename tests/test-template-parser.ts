// tests/test-template-parser.ts
import { TemplateParser } from '../src/templates/template-parser.js';

console.log('--- 1. Testing Standard Template Loading ---');
const loaded = TemplateParser.loadTemplate('gw-meat-light');
console.log('Successfully loaded gw-meat-light:');
console.log(`Name: ${loaded.name}`);
console.log(`Quest URL: ${loaded.questUrl}`);
console.log(`Steps count: ${loaded.steps.length}`);
loaded.steps.forEach((s, idx) => {
  console.log(`  [${idx + 1}] ${s.name} (${s.action})`);
});

console.log('\n--- 2. Testing Shorthand DSL with All Advanced Actions ---');
const dslSample = `
Start: https://game.granbluefantasy.jp/#quest/supporter/947551/1/0
---
Tab ready: click
wait_random 300 650
F5
skill 1-3
summon 1
guard all
full_auto
touch_tap 240 370
wait_network normal_attack_result.json
wait 400
F5
Confirm a bit
-----
`;

// Test in-memory compilation and JSON round-trip validation
const parsedDsl = TemplateParser.parseShorthandDsl(dslSample, 'test-advanced-dsl');
const jsonSerialized = TemplateParser.serializeToJson(parsedDsl, true);
const validatedJson = TemplateParser.validate(JSON.parse(jsonSerialized));
if (!validatedJson.valid || !validatedJson.template) {
  throw new Error(`JSON validation failed: ${validatedJson.errors.join(', ')}`);
}

console.log(`Compiled and validated JSON workflow successfully with ${validatedJson.template.steps.length} steps:`);
validatedJson.template.steps.forEach((s, idx) => {
  console.log(`  [${idx + 1}] ${s.name} -> Action: ${s.action} ${s.minMs ? `(${s.minMs}-${s.maxMs}ms)` : ''}`);
});

const actions = validatedJson.template.steps.map(s => s.action);
const expected = ['tap_ready', 'wait_random', 'reload', 'skill', 'summon', 'guard', 'auto', 'touch_tap', 'wait_network', 'wait', 'reload', 'confirm_result'];

const allMatch = expected.every(act => actions.includes(act as any));
if (allMatch) {
  console.log('\n✅ All advanced actions compiled to JSON and verified successfully!');
} else {
  console.error('\n❌ Missing actions in compiled JSON output:', actions);
  process.exit(1);
}

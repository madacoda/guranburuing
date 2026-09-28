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

// Test parsing of full DSL
const dummyFile = 'templates/test-advanced-dsl.txt';
import fs from 'fs';
fs.writeFileSync(dummyFile, dslSample, 'utf-8');

try {
  const parsedDsl = TemplateParser.loadTemplate('test-advanced-dsl');
  console.log(`Parsed Advanced DSL successfully with ${parsedDsl.steps.length} steps:`);
  parsedDsl.steps.forEach((s, idx) => {
    console.log(`  [${idx + 1}] ${s.name} -> Action: ${s.action} ${s.minMs ? `(${s.minMs}-${s.maxMs}ms)` : ''}`);
  });

  const actions = parsedDsl.steps.map(s => s.action);
  const expected = ['tap_ready', 'wait_random', 'reload', 'skill', 'summon', 'guard', 'auto', 'touch_tap', 'wait_network', 'wait', 'reload', 'confirm_result'];
  
  const allMatch = expected.every(act => actions.includes(act as any));
  if (allMatch) {
    console.log('\n✅ All advanced actions parsed and verified successfully!');
  } else {
    console.error('\n❌ Missing actions in parsed output:', actions);
    process.exit(1);
  }
} finally {
  if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
}

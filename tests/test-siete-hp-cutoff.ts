// tests/test-siete-hp-cutoff.ts
import assert from 'node:assert';
import { ExitIfHpStepHandler } from '../src/workflows/handlers/control-flow/exit-if-hp.handler.js';
import { createDefaultStepHandlerRegistry } from '../src/workflows/registry/default-registry.factory.js';
import { TemplateParser } from '../src/templates/template-parser.js';
import { WorkflowTemplateSchema } from '../src/templates/template-schema.js';

async function run() {
  console.log('------------------------------------------------------------------------');
  console.log('Test Suite: Siete (Seofon HL) 12% / 10% HP Cutoff & Early Exit Guard');
  console.log('------------------------------------------------------------------------\n');

  // [1] Verify ExitIfHpStepHandler logic
  console.log('[1/4] Testing ExitIfHpStepHandler with mock context...');
  const handler = new ExitIfHpStepHandler();
  assert(handler.supportedActions.includes('exit_if_hp'), 'Supports exit_if_hp action');

  // Test Case A: Boss HP at 10% (trigger threshold) with 12% cutoff
  const mockPage10Pct = {
    evaluate: async () => ({ hpPct: 10.0, isDefeated: false })
  } as any;
  const res10Pct = await handler.execute(
    { code: 'exit_if_hp', targetHpPct: 12 },
    { page: mockPage10Pct, template: { exitIfHpPct: 12 } } as any
  );
  assert(res10Pct.shouldExitEarly === true, 'Exits early when HP is 10% <= 12%');
  assert(res10Pct.message.includes('10.0% <= 12%'), 'Informative message on early exit');

  // Test Case B: Boss HP at 12% with 12% cutoff
  const mockPage12Pct = {
    evaluate: async () => ({ hpPct: 12.0, isDefeated: false })
  } as any;
  const res12Pct = await handler.execute(
    { code: 'exit_if_hp', targetHpPct: 12 },
    { page: mockPage12Pct, template: { exitIfHpPct: 12 } } as any
  );
  assert(res12Pct.shouldExitEarly === true, 'Exits early when HP is exactly 12% <= 12%');

  // Test Case C: Boss HP at 25% with 12% cutoff
  const mockPage25Pct = {
    evaluate: async () => ({ hpPct: 25.0, isDefeated: false })
  } as any;
  const res25Pct = await handler.execute(
    { code: 'exit_if_hp', targetHpPct: 12 },
    { page: mockPage25Pct, template: { exitIfHpPct: 12 } } as any
  );
  assert(res25Pct.shouldExitEarly === false, 'Continues combat when HP is 25% > 12%');
  console.log('  ✅ ExitIfHpStepHandler correctly differentiates HP <= 12% and HP > 12%');

  // [2] Verify Default Step Handler Registry integration
  console.log('\n[2/4] Testing StepHandlerRegistry includes ExitIfHpStepHandler...');
  const registry = createDefaultStepHandlerRegistry();
  const registeredHandler = registry.get('exit_if_hp');
  assert(registeredHandler !== undefined, 'exit_if_hp is registered in DefaultStepHandlerRegistry');
  assert(registeredHandler instanceof ExitIfHpStepHandler, 'Resolved handler is ExitIfHpStepHandler instance');
  console.log('  ✅ StepHandlerRegistry resolved ExitIfHpStepHandler');

  // [3] Verify raid-seofon.json template structure and exit_if_hp step placement
  console.log('\n[3/4] Verifying raid-seofon.json template properties and steps...');
  const tpl = TemplateParser.loadTemplate('raid-seofon');
  assert(tpl.exitIfHpPct === 12, 'raid-seofon has exitIfHpPct: 12');
  assert(tpl.targetEnemy === 'Seofon', 'raid-seofon targetEnemy is Seofon');
  assert(tpl.targetRaidQuestId === '305411', 'raid-seofon targetRaidQuestId is 305411');

  const hpExitSteps = tpl.steps.filter(s => (s.code || s.action) === 'exit_if_hp');
  assert(hpExitSteps.length === 5, `raid-seofon has 5 exit_if_hp steps (found: ${hpExitSteps.length})`);
  assert(hpExitSteps.every(s => s.targetHpPct === 12), 'All exit_if_hp steps have targetHpPct: 12');

  // Verify placement: Step 3 is on entry (after reload), and each attack is preceded by an exit_if_hp step
  const attackIndices = tpl.steps
    .map((s, idx) => ((s.code || s.action) === 'attack' ? idx : -1))
    .filter(idx => idx !== -1);
  assert(attackIndices.length === 4, `Found 4 attack steps across turns 1-4 (found ${attackIndices.length})`);

  for (const atkIdx of attackIndices) {
    const precedingStep = tpl.steps[atkIdx - 1];
    assert(
      (precedingStep.code || precedingStep.action) === 'exit_if_hp',
      `Attack at step index ${atkIdx} is preceded by an exit_if_hp check`
    );
  }
  console.log('  ✅ All 4 attack turns in raid-seofon are protected by pre-attack exit_if_hp 12% checks');
  console.log('  ✅ Entry is protected by early exit_if_hp 12% check');

  // [4] Verify Template Schema and DSL serialization with exitIfHpPct
  console.log('\n[4/4] Verifying WorkflowTemplateSchema validation and DSL round-trip...');
  const parsed = WorkflowTemplateSchema.safeParse(tpl);
  assert(parsed.success === true, 'raid-seofon passes strict WorkflowTemplateSchema validation');
  assert(parsed.data.exitIfHpPct === 12, 'Parsed template preserves exitIfHpPct: 12');

  const dsl = TemplateParser.serializeToDsl(tpl);
  assert(dsl.includes('Exit HP: 12'), 'DSL output contains Exit HP: 12');
  assert(dsl.includes('exit_if_hp 12'), 'DSL output contains step exit_if_hp 12');

  const roundTripped = TemplateParser.parseShorthandDsl(dsl, 'raid-seofon');
  assert(roundTripped.exitIfHpPct === 12, 'Round-tripped template preserves exitIfHpPct: 12');
  assert(roundTripped.steps.length === tpl.steps.length, 'Round-tripped step count matches original exactly');
  console.log('  ✅ DSL round-trip preserves exitIfHpPct and all exit_if_hp steps');

  console.log('\n🎉 ALL SIETE 12%/10% HP CUTOFF TESTS PASSED (100% SUCCESS)!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

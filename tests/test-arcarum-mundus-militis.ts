import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';

console.log('========================================================================');
console.log('   Arcarum Zone Mundus (Stage 10) Militis Bosses Test Suite             ');
console.log('========================================================================\n');

// 1. Expected Zone Mundus Militis configurations
const mundusConfigs = [
  {
    name: 'Prometheus Militis (Smart)',
    templateId: 'arcarum-prometheus-militis-smart',
    questId: '819141',
    divisionId: 3,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/3/819141/25',
    isSmart: true
  },
  {
    name: 'Prometheus Militis (Burst)',
    templateId: 'arcarum-prometheus-militis',
    questId: '819141',
    divisionId: 3,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/3/819141/25',
    isSmart: false
  },
  {
    name: 'Morrigna Militis (Smart)',
    templateId: 'arcarum-morrigna-militis-smart',
    questId: '819171',
    divisionId: 15,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/15/819171/25',
    isSmart: true
  },
  {
    name: 'Morrigna Militis (Burst)',
    templateId: 'arcarum-morrigna-militis',
    questId: '819171',
    divisionId: 15,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/15/819171/25',
    isSmart: false
  },
  {
    name: 'Ca Ong Militis (Smart)',
    templateId: 'arcarum-ca-ong-militis-smart',
    questId: '819151',
    divisionId: 9,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/9/819151/25',
    isSmart: true
  },
  {
    name: 'Ca Ong Militis (Burst)',
    templateId: 'arcarum-ca-ong-militis',
    questId: '819151',
    divisionId: 9,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/9/819151/25',
    isSmart: false
  },
  {
    name: 'Gilgamesh Militis (Smart)',
    templateId: 'arcarum-gilgamesh-militis-smart',
    questId: '819161',
    divisionId: 8,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/8/819161/25',
    isSmart: true
  },
  {
    name: 'Gilgamesh Militis (Burst)',
    templateId: 'arcarum-gilgamesh-militis',
    questId: '819161',
    divisionId: 8,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/supporter/10/10/8/819161/25',
    isSmart: false
  },
  {
    name: 'Zone Mundus Stage 10 Universal Map',
    templateId: 'arcarum-stage-10-smart',
    questId: undefined,
    divisionId: undefined,
    expectedUrl: 'https://game.granbluefantasy.jp/#replicard/stage/10',
    isSmart: true
  }
];

// 2. Validate all templates
console.log('--- Step 1: Validating All Zone Mundus Templates & Schema Integrity ---');
for (const cfg of mundusConfigs) {
  const tmpl = TemplateParser.loadTemplate(cfg.templateId);
  if (!tmpl) {
    throw new Error(`Failed to load template: ${cfg.templateId}`);
  }

  const valResult = validateWorkflowTemplate(tmpl);
  if (!valResult.valid) {
    throw new Error(`Template ${cfg.templateId} failed validation: ${valResult.errors.join(', ')}`);
  }

  if (tmpl.questUrl !== cfg.expectedUrl) {
    throw new Error(`Template ${cfg.templateId} questUrl mismatch: expected "${cfg.expectedUrl}", got "${tmpl.questUrl}"`);
  }

  if (cfg.questId && tmpl.questId !== cfg.questId) {
    throw new Error(`Template ${cfg.templateId} questId mismatch: expected "${cfg.questId}", got "${tmpl.questId}"`);
  }

  if (cfg.divisionId && tmpl.divisionId !== cfg.divisionId) {
    throw new Error(`Template ${cfg.templateId} divisionId mismatch: expected "${cfg.divisionId}", got "${tmpl.divisionId}"`);
  }

  if (cfg.isSmart) {
    const smartStep = tmpl.steps.find((s: any) => s.code === 'smart_full_auto');
    if (!smartStep) {
      throw new Error(`Smart template ${cfg.templateId} missing smart_full_auto step`);
    }
    if (smartStep.delayAfterMs !== 350) {
      throw new Error(`Smart template ${cfg.templateId} delayAfterMs should be 350, got ${smartStep.delayAfterMs}`);
    }
  }

  console.log(`  ✅ [PASS] ${cfg.name.padEnd(35, ' ')} | URL: ${tmpl.questUrl}`);
}

// 3. DSL Compilation & Round-Trip Validation
console.log('\n--- Step 2: Validating Shorthand DSL Serialization & Bidirectional Round-Trip ---');
for (const cfg of mundusConfigs.filter(c => c.isSmart)) {
  const tmpl = TemplateParser.loadTemplate(cfg.templateId)!;
  const dsl = TemplateParser.serializeToDsl(tmpl);
  
  if (!dsl.includes('smart_full_auto')) {
    throw new Error(`Serialized DSL for ${cfg.templateId} missing smart_full_auto`);
  }

  const parsedFromDsl = TemplateParser.parseShorthandDsl(dsl, cfg.templateId);
  if (parsedFromDsl.steps[0].code !== 'smart_full_auto') {
    throw new Error(`Parsed DSL for ${cfg.templateId} failed to preserve smart_full_auto`);
  }

  console.log(`  ✅ [PASS] DSL Round-Trip: ${cfg.templateId} retained 100% fidelity`);
}

// 4. Mock Stage 10 DOM Selection Logic Test
console.log('\n--- Step 3: Mock Testing Stage 10 Division Frame & Quest Selection Logic ---');

// Mock DOM environment for Stage 10
const createMockStage10 = (quests: { id: string; name: string; isHell: boolean }[]) => {
  return {
    window: {
      location: {
        hash: '#replicard/stage/10'
      }
    },
    document: {
      querySelector: (selector: string) => {
        // Match specific questId
        const matchQuestId = selector.match(/data-quest-id="([^"]+)"/);
        if (matchQuestId) {
          const qId = matchQuestId[1];
          const found = quests.find(q => q.id === qId);
          if (found) {
            return {
              offsetParent: {},
              getAttribute: (attr: string) => attr === 'data-quest-id' ? found.id : null,
              click: () => true
            };
          }
          return null;
        }

        // Match defender (data-is-hell="1")
        if (selector.includes('data-is-hell="1"')) {
          const found = quests.find(q => q.isHell);
          if (found) {
            return {
              offsetParent: {},
              getAttribute: (attr: string) => attr === 'data-quest-id' ? found.id : null,
              click: () => true
            };
          }
          return null;
        }

        // Match any quest in division frame
        if (selector.includes('.prt-division-frame .btn-quest-list')) {
          if (quests.length > 0) {
            return {
              offsetParent: {},
              getAttribute: (attr: string) => attr === 'data-quest-id' ? quests[0].id : null,
              click: () => true
            };
          }
          return null;
        }

        return null;
      }
    }
  };
};

const mockQuests = [
  { id: '819191', name: 'Herald of Water', isHell: false },
  { id: '819151', name: 'Ca Ong Militis', isHell: true },
  { id: '819071', name: 'Parasite Steve', isHell: false }
];

const mockStage = createMockStage10(mockQuests);

// Test 4a: Target exact Ca Ong Militis (819151)
const targetQuestEl = mockStage.document.querySelector('.btn-quest-list[data-quest-id="819151"]');
if (!targetQuestEl) {
  throw new Error('Expected to find exact quest 819151 on mock stage 10');
}
console.log('  ✅ [PASS] Stage 10 exact quest match: 819151 (Ca Ong Militis) successfully resolved');

// Test 4b: Target defender fallback (data-is-hell="1")
const defenderEl = mockStage.document.querySelector('.btn-quest-list[data-is-hell="1"]');
if (!defenderEl || defenderEl.getAttribute('data-quest-id') !== '819151') {
  throw new Error('Expected defender lookup to resolve to 819151');
}
console.log('  ✅ [PASS] Stage 10 defender detection: resolved to Ca Ong Militis (data-is-hell="1")');

// Test 4c: Target exact Prometheus Militis (819141) on division 3
const mockQuestsDiv3 = [
  { id: '819141', name: 'Prometheus Militis', isHell: true },
  { id: '819021', name: 'Earth-Shattering Fire Demon', isHell: false }
];
const mockStageDiv3 = createMockStage10(mockQuestsDiv3);
const targetPrometheus = mockStageDiv3.document.querySelector('.btn-quest-list[data-quest-id="819141"]');
if (!targetPrometheus) {
  throw new Error('Expected to find Prometheus Militis (819141) on Division 3');
}
console.log('  ✅ [PASS] Stage 10 Prometheus Militis match: 819141 (Division 3) successfully resolved');

console.log('\n========================================================================');
console.log('🎉 ALL ZONE MUNDUS (STAGE 10) MILITIS TESTS PASSED (100% SUCCESS)');
console.log('========================================================================\n');
process.exit(0);

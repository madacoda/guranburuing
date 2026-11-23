// tests/test-gw-nm95-dark-setup.ts
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import type { Page } from 'puppeteer-core';
import { DataCatalogService } from '../src/domain/data/index.js';
import {
  buildDefaultOfflineDeck133Snapshot,
  GW_NM95_DARK_BOSS_HP,
  GwNm95DarkSetupService
} from '../src/services/gw/gw-nm95-dark-setup.service.js';
import { TemplateParser } from '../src/templates/template-parser.js';
import { validateWorkflowTemplate } from '../src/templates/template-schema.js';

console.log('========================================================================');
console.log('      GW NM95 Dark KMS Vol. 23, Deck Audit & Optimizer Test Suite       ');
console.log('========================================================================\n');

async function run() {
  // -----------------------------------------------------------------------
  // 1. KMS Volume 23 Documentation & DataCatalogService Integration
  // -----------------------------------------------------------------------
  console.log('--- [1/5] Verifying KMS Vol. 23 Documentation & DataCatalogService ---');
  const kmsDocPath = path.resolve(
    process.cwd(),
    'data/23_gw_nm95_dark_yatima_ereshkigal_optimization_kms.md'
  );
  assert.strictEqual(fs.existsSync(kmsDocPath), true, 'Volume 23 KMS markdown document must exist');

  const catalog = DataCatalogService.getInstance();
  const fullCatalog = catalog.getGwNm95DarkCatalog();
  assert(fullCatalog !== null, 'DataCatalogService loads gw-nm95-dark catalog');

  const bossSpec = catalog.getGwNm95DarkBossSpec();
  assert.strictEqual(bossSpec?.questId, '980681', 'NM95 Dark questId must be 980681');
  assert.strictEqual(bossSpec?.bossHp, 131_250_000, 'Demeter HP must be 131,250,000');
  assert.strictEqual(
    bossSpec?.honorsBreakdown.totalFullRotationHonors,
    910_385,
    'Full NM95 honor yield must be 910,385'
  );

  const archetypes = catalog.getAllGwNm95DarkArchetypes();
  assert.strictEqual(archetypes.length, 3, 'Catalog must contain all 3 NM95 rotation archetypes');
  const fastArch = catalog.getGwNm95DarkArchetype('nm95_dark_yatima_5skill_turbo');
  assert(fastArch && fastArch.skillCount === 5, 'Fast 5-skill turbo archetype must exist');

  const skillRoi = catalog.getGwNm95DarkSkillRoi();
  assert(
    skillRoi.some(r => r.skillCode === 'C2S3' && r.verdict === 'ADD_HIGH_ROI'),
    'Skill ROI catalog must record C2S3 Diva Satanica Triple Strike'
  );
  assert(
    skillRoi.some(r => r.skillCode === 'C3S2' && r.verdict === 'CUT_LOW_ROI'),
    'Skill ROI catalog must record C3S2 Thunderflash +++ cut'
  );
  console.log('  ✅ [PASS] KMS Vol. 23 files and DataCatalogService verified');

  // -----------------------------------------------------------------------
  // 2. Deck Auditor Positive & Negative Gates
  // -----------------------------------------------------------------------
  console.log('\n--- [2/5] Verifying Deck Auditor Positive & Negative Gates ---');
  const baseDeck = buildDefaultOfflineDeck133Snapshot();
  const baseAudit = GwNm95DarkSetupService.auditDeckData(baseDeck);
  assert.strictEqual(baseAudit.yatimaPoolDeterministic, true, 'Baseline Deck 133 Yatima pool is deterministic');
  assert.strictEqual(baseAudit.axeCount, 4, 'Baseline Deck 133 has 4 Axes for Eternal Signature');
  assert.strictEqual(baseAudit.partyOrderValid, true, 'Baseline party order places Ewiyar Slot 3 -> Nier Slot 4');
  assert.strictEqual(baseAudit.hasSummerBelialSub, true, 'Detects Summer Belial Lv40 in Sub Slot 2');
  assert.strictEqual(baseAudit.hasBelialSub, true, 'Detects Belial Lv150 in Sub Slot 5');
  assert.strictEqual(baseAudit.hasDeathSub, true, 'Detects Death Lv200 in Sub Slot 3');
  assert.strictEqual(baseAudit.hasVersusiaSub, true, 'Detects Versusia Lv150 in Sub Slot 4');

  const baseFindingIds = new Set(baseAudit.findings.map(f => f.id));
  assert(baseFindingIds.has('subaura_beelzebub_wasted'), 'Flags Beelzebub Lv150 in Sub-Aura Slot 1');
  assert(baseFindingIds.has('subaura_bahamut_wasted'), 'Flags Bahamut Lv250 in Sub-Aura Slot 2');
  assert(baseFindingIds.has('opus_alpha_wasted'), 'Flags Dark Opus Alpha key wasted under Ereshkigal');
  assert(baseFindingIds.has('fallen_sword_awakening'), 'Flags Fallen Sword Multiattack Lv1 awakening');

  // Negative Test A: Contaminate Yatima Sub Slots 2-5 with callable Hades
  const pollutedDeck = JSON.parse(JSON.stringify(baseDeck));
  pollutedDeck.pc.summons['2'] = { param: { id: '764643670', level: '200' }, master: { id: '2040090000', name: 'Hades' } };
  const pollutedAudit = GwNm95DarkSetupService.auditDeckData(pollutedDeck);
  assert.strictEqual(pollutedAudit.yatimaPoolDeterministic, false, 'Callable summon in Sub 2-5 breaks Yatima pool');
  assert(
    pollutedAudit.findings.some(f => f.id === 'yatima_pool_contaminated' && f.severity === 'CRITICAL_BLOCKER'),
    'Contaminated Yatima pool raises CRITICAL_BLOCKER'
  );

  // Negative Test B: Break Eternal Signature 4-Axe requirement
  const lowAxeDeck = JSON.parse(JSON.stringify(baseDeck));
  lowAxeDeck.pc.weapons['10'] = {
    param: { id: '3419089005', level: '200' },
    master: { id: '1040612500', name: 'Claws of Terror', kind: '7' }
  };
  const lowAxeAudit = GwNm95DarkSetupService.auditDeckData(lowAxeDeck);
  assert.strictEqual(lowAxeAudit.axeCount, 3, 'Dropping Scythe of Darkherald reduces Axe count to 3');
  assert(
    lowAxeAudit.findings.some(f => f.id === 'eternal_signature_axe_count' && f.severity === 'CRITICAL_BLOCKER'),
    'Under-4 Axes with Eternal Signature raises CRITICAL_BLOCKER'
  );

  // Negative Test C: Wrong party order (Nier Slot 3 instead of Ewiyar)
  const badOrderDeck = JSON.parse(JSON.stringify(baseDeck));
  badOrderDeck.npc['3'] = { param: { id: '158453965', level: '100' }, master: { id: '3040169000', name: 'Nier' } };
  badOrderDeck.npc['4'] = { param: { id: '249737739', level: '80' }, master: { id: '3040680000', name: 'Ewiyar' } };
  const badOrderAudit = GwNm95DarkSetupService.auditDeckData(badOrderDeck);
  assert.strictEqual(badOrderAudit.partyOrderValid, false, 'Swapped Ewiyar/Nier invalidates Death swap order');
  assert(
    badOrderAudit.findings.some(f => f.id === 'party_slot_order' && f.severity === 'CRITICAL_BLOCKER'),
    'Wrong party slot order raises CRITICAL_BLOCKER'
  );

  // Positive Test D: Fully upgraded Deck 133 has 0 findings
  const idealDeck = JSON.parse(JSON.stringify(baseDeck));
  idealDeck.pc.sub_summons = {
    '1': { param: { id: '977961317', level: '150' }, master: { id: '2040327000', name: 'Sariel' } },
    '2': { param: { id: '1510948871', level: '40' }, master: { id: '2040418000', name: 'Fediel' } }
  };
  idealDeck.pc.weapons['7'].skill2 = { name: 'β Revelation' };
  idealDeck.pc.weapons['5'].param.arousal = { level: 4, form_name: 'Attack' };
  const idealAudit = GwNm95DarkSetupService.auditDeckData(idealDeck);
  assert.strictEqual(idealAudit.findings.length, 0, 'Fully upgraded Deck 133 passes with 0 defects');
  console.log('  ✅ [PASS] All positive and negative deck audit gates verified');

  // -----------------------------------------------------------------------
  // 3. Damage & Time Simulation Engine
  // -----------------------------------------------------------------------
  console.log('\n--- [3/5] Verifying Damage & Time Simulator Math ---');
  const legacySim = GwNm95DarkSetupService.simulateRotation(baseAudit, 'legacy');
  assert.strictEqual(
    legacySim.projectedPlayerPhaseDamage,
    125_339_038,
    'Legacy simulation matches live captured 125,339,038 player-phase damage'
  );
  assert.strictEqual(legacySim.killsInPlayerPhase, false, 'Legacy fails pure player-phase kill (needs counters)');

  // Only Sub-Auras upgraded (Sariel + Fediel) -> 6-skill Safe wins comfortably; recommend Safe
  const subAuraOnlyDeck = JSON.parse(JSON.stringify(baseDeck));
  subAuraOnlyDeck.pc.sub_summons = idealDeck.pc.sub_summons;
  const subAuraOnlyAudit = GwNm95DarkSetupService.auditDeckData(subAuraOnlyDeck);
  const safeSubOnlySim = GwNm95DarkSetupService.simulateRotation(subAuraOnlyAudit, 'safe');
  assert(
    safeSubOnlySim.projectedPlayerPhaseDamage > GW_NM95_DARK_BOSS_HP + 9_000_000,
    `Safe 6-skill w/ Sariel+Fediel exceeds 140M (got ${safeSubOnlySim.projectedPlayerPhaseDamage.toLocaleString()})`
  );
  assert.strictEqual(safeSubOnlySim.killsInPlayerPhase, true, 'Safe 6-skill kills in player phase');
  assert.strictEqual(safeSubOnlySim.speedProfile, 'turbo', 'Safe optimized template uses turbo profile');

  const fastFullSim = GwNm95DarkSetupService.simulateRotation(idealAudit, 'fast');
  assert(
    fastFullSim.projectedPlayerPhaseDamage > GW_NM95_DARK_BOSS_HP + 5_000_000,
    `Fast 5-skill w/ Sariel+Opus Beta exceeds 136M (got ${fastFullSim.projectedPlayerPhaseDamage.toLocaleString()})`
  );
  assert.strictEqual(fastFullSim.estimatedClearSecMin, 18, 'Fast 5-skill min time is 18s');
  assert.strictEqual(fastFullSim.estimatedClearSecMax, 23, 'Fast 5-skill max time is 23s');
  assert.strictEqual(
    GwNm95DarkSetupService.recommendProfile([
      GwNm95DarkSetupService.simulateRotation(idealAudit, 'legacy'),
      GwNm95DarkSetupService.simulateRotation(idealAudit, 'safe'),
      fastFullSim
    ]),
    'fast',
    'Optimizer auto-recommends fast 5-skill when Opus Beta / Atk Lv4 gives >= 4.5M overkill'
  );
  assert(
    fastFullSim.projectedHonorsPerHour > safeSubOnlySim.projectedHonorsPerHour &&
      safeSubOnlySim.projectedHonorsPerHour > legacySim.projectedHonorsPerHour,
    'Honors/hour strictly monotonic: Fast > Safe > Legacy'
  );
  console.log('  ✅ [PASS] Damage & time simulation calibrated and verified');

  // -----------------------------------------------------------------------
  // 4. Template Builder, Zod Validation & DSL Round-Trip
  // -----------------------------------------------------------------------
  console.log('\n--- [4/5] Verifying Optimized Templates & DSL Round-Trip ---');
  const existingTemplate = TemplateParser.loadTemplate('gw-nm95-dark');
  const fastTemplate = GwNm95DarkSetupService.buildOptimizedTemplate('fast', 'turbo', existingTemplate);
  const safeTemplate = GwNm95DarkSetupService.buildOptimizedTemplate('safe', 'turbo', existingTemplate);

  const fastVal = validateWorkflowTemplate(fastTemplate);
  const safeVal = validateWorkflowTemplate(safeTemplate);
  assert(fastVal.valid, `Fast template failed Zod schema: ${fastVal.errors.join(', ')}`);
  assert(safeVal.valid, `Safe template failed Zod schema: ${safeVal.errors.join(', ')}`);

  assert.strictEqual(fastTemplate.steps.length, 10, 'Fast 5-skill template must have exactly 10 steps');
  assert.strictEqual(safeTemplate.steps.length, 11, 'Safe 6-skill template must have exactly 11 steps');
  assert.strictEqual(fastTemplate.speedProfile, 'turbo', 'Fast template sets speedProfile=turbo');
  assert.strictEqual(safeTemplate.steps[0].character, 4, 'Safe template prepends C4S2');
  assert.strictEqual(safeTemplate.steps[0].skill, 2, 'Safe template prepends C4S2');

  // Verify C2S3 immediately follows C2S1 and zero Last Love / Thunderflash
  const c2s1Idx = fastTemplate.steps.findIndex(s => s.character === 2 && s.skill === 1);
  assert(c2s1Idx !== -1, 'Fast template contains C2S1 War Eternal');
  assert.strictEqual(fastTemplate.steps[c2s1Idx + 1]?.character, 2, 'C2S3 immediately follows C2S1');
  assert.strictEqual(fastTemplate.steps[c2s1Idx + 1]?.skill, 3, 'C2S3 Diva Satanica immediately follows C2S1');
  assert(
    !fastTemplate.steps.some(s => (s.character === 4 && s.skill === 3) || (s.character === 3 && s.skill === 2)),
    'Fast template removes slow Last Love (C4S3) and T1-zero Thunderflash (C3S2)'
  );

  for (const [label, tpl] of [
    ['fast', fastTemplate],
    ['safe', safeTemplate]
  ] as const) {
    const dsl = TemplateParser.serializeToDsl(tpl);
    const reparsed = TemplateParser.parseShorthandDsl(dsl, `test-nm95-${label}`);
    assert.strictEqual(
      reparsed.steps.length,
      tpl.steps.length,
      `DSL round-trip for ${label} preserves all ${tpl.steps.length} steps`
    );
  }
  console.log('  ✅ [PASS] Both optimized templates pass Zod validation & DSL round-trip');

  // -----------------------------------------------------------------------
  // 5. Active Workflow Conflict Guard & Mock CDP executeSetup
  // -----------------------------------------------------------------------
  console.log('\n--- [5/5] Verifying Active Workflow Conflict Guard & Mock CDP Setup ---');
  const detectedConflict = GwNm95DarkSetupService.detectActiveWorkflowConflictFromProcessList(
    [
      '"C:\\Users\\user\\.bun\\bin\\bun.exe" run dev',
      'C:\\Users\\user\\.bun\\bin\\bun.exe src/cli/run-workflow.ts acc1 gw-nm95-dark 3000'
    ],
    'acc1'
  );
  assert.strictEqual(detectedConflict.hasConflict, true, 'Detects active acc1 gw-nm95-dark workflow');

  const noConflict = GwNm95DarkSetupService.detectActiveWorkflowConflictFromProcessList(
    [
      '"bun.exe" run dev',
      'bun.exe src/cli/run-gw-nm95-setup.ts --apply',
      'bun.exe src/cli/run-workflow.ts acc2 gw-meat-dark 500'
    ],
    'acc1'
  );
  assert.strictEqual(noConflict.hasConflict, false, 'Ignores setup script itself, dev server, and acc2');

  const createMockPage = () => {
    const stateDeck = buildDefaultOfflineDeck133Snapshot();
    const calls: Array<{ endpoint: string; method: string; body?: any }> = [];
    const page = {
      evaluate: async (_fn: any, arg: { p: string; m: string; b?: any }) => {
        calls.push({ endpoint: arg.p, method: arg.m, body: arg.b });
        if (arg.p === 'party/deck/133' && arg.m === 'GET') {
          return { ok: true, status: 200, data: { deck: JSON.parse(JSON.stringify(stateDeck)) } };
        }
        if (arg.p === 'party/update_equipment' && arg.m === 'POST') {
          const b = arg.b || {};
          if (b.equipment === 'sub_summon') {
            const slotKey = String(b.set_num);
            if (!b.equipment_id) {
              delete stateDeck.pc.sub_summons[slotKey];
            } else if (String(b.equipment_id) === '977961317') {
              stateDeck.pc.sub_summons[slotKey] = {
                param: { id: '977961317', level: '150' },
                master: { id: '2040327000', name: 'Sariel' }
              };
            } else if (String(b.equipment_id) === '1510948871') {
              stateDeck.pc.sub_summons[slotKey] = {
                param: { id: '1510948871', level: '40' },
                master: { id: '2040418000', name: 'Fediel' }
              };
            }
          }
          return { ok: true, status: 200, data: { success: true } };
        }
        return { ok: false, status: 404, data: null };
      }
    } as unknown as Page;
    return { page, calls, stateDeck };
  };

  const svc = new GwNm95DarkSetupService();

  // 5A: Blocked on active conflict (0 POST calls)
  const blockedMock = createMockPage();
  const blockedRes = await svc.executeSetup(blockedMock.page, {
    accountId: 'acc1',
    deckPriority: 133,
    dryRun: false,
    syncTemplate: false,
    activeProcessCommands: ['bun src/cli/run-workflow.ts acc1 gw-nm95-dark 3000']
  });
  assert.strictEqual(blockedRes.mode, 'blocked_conflict', 'Active workflow blocks live mutation');
  assert.strictEqual(blockedRes.blockedByActiveWorkflow, true, 'Sets blockedByActiveWorkflow=true');
  assert.strictEqual(
    blockedMock.calls.filter(c => c.method === 'POST').length,
    0,
    'Blocked run dispatches 0 POST calls'
  );

  // 5B: Dry-run dispatches 0 POST calls
  const dryMock = createMockPage();
  const dryRes = await svc.executeSetup(dryMock.page, {
    accountId: 'acc1',
    deckPriority: 133,
    dryRun: true,
    activeProcessCommands: []
  });
  assert.strictEqual(dryRes.mode, 'dry_run', 'Dry-run mode executes cleanly');
  assert.strictEqual(dryMock.calls.length, 1, 'Dry-run executes exactly 1 GET call');
  assert.strictEqual(dryMock.calls[0].method, 'GET', 'Dry-run never writes');

  // 5C: Live apply swaps Sub-Aura 1 -> Sariel and Sub-Aura 2 -> Fediel ONLY
  const applyMock = createMockPage();
  const applyRes = await svc.executeSetup(applyMock.page, {
    accountId: 'acc1',
    deckPriority: 133,
    dryRun: false,
    syncTemplate: false,
    activeProcessCommands: []
  });
  assert.strictEqual(applyRes.mode, 'live_apply', 'Live apply succeeds when unblocked');
  assert.strictEqual(applyRes.subAuraMutations.length, 2, 'Applies 2 Sub-Aura mutations');
  assert.strictEqual(applyRes.postMutationAudit.hasSarielSubAura, true, 'Post-mutation audit confirms Sariel Lv150');
  assert.strictEqual(
    applyRes.postMutationAudit.hasFedielOrUlbHadesSubAura,
    true,
    'Post-mutation audit confirms Fediel Lv40'
  );
  assert.strictEqual(
    applyRes.postMutationAudit.yatimaPoolDeterministic,
    true,
    'Yatima Death+Versusia Main/Sub 1-5 pool remains 100% untouched'
  );
  const postCalls = applyMock.calls.filter(c => c.method === 'POST');
  assert(
    postCalls.every(c => c.body?.equipment === 'sub_summon'),
    'Every POST mutation touches sub_summon ONLY (never main summons, weapons, or party)'
  );

  const reportText = GwNm95DarkSetupService.formatReport(applyRes);
  assert(reportText.includes('Sariel Lv150') && reportText.includes('Fediel Lv40'), 'Report renders Sub-Aura targets');
  console.log('  ✅ [PASS] Conflict guard and non-destructive Sub-Aura mutation verified');

  console.log('\n🎉 ALL GW NM95 DARK OPTIMIZER TESTS PASSED (5/5)!');
}

run().catch(err => {
  console.error('❌ Fatal test error:', err);
  process.exit(1);
});

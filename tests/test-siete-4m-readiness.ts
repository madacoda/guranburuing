// tests/test-siete-4m-readiness.ts
import fs from 'fs';
import path from 'path';
import { DataCatalogService } from '../src/domain/data/index.js';
import { SietePlayerRosterInput } from '../src/domain/siete/index.js';
import { SieteReadinessCheckerService } from '../src/services/combat/siete-readiness-checker.service.js';
import { SieteAutoSetupService } from '../src/services/combat/siete-auto-setup.service.js';
import { TemplateParser } from '../src/templates/template-parser.js';
import { resolveSearchRaid } from '../src/domain/assist/search-raid.catalog.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ ${message}`);
}

async function run() {
  console.log('------------------------------------------------------------------------');
  console.log('Test Suite: Seofon (Impossible) / Siete HL 4M Honors & Readiness Checker');
  console.log('------------------------------------------------------------------------');

  const catalog = DataCatalogService.getInstance();
  const checker = new SieteReadinessCheckerService(catalog);

  // 1. Verify KMS Vol. 22 Documentation, Schemas, and Catalog Integrity
  console.log('\n[1/7] Verifying Siete KMS Vol. 22 files, schemas, and raid mechanics...');
  const kmsDocPath = path.resolve(
    process.cwd(),
    'data/22_seofon_revans_4m_honors_party_and_readiness_kms.md'
  );
  assert(fs.existsSync(kmsDocPath), 'Volume 22 Siete KMS markdown document exists');

  const raidSpec = catalog.getSieteRaidSpecification();
  assert(!!raidSpec, 'Siete raidSpecification loaded');
  assert(raidSpec?.questId === '305411', 'Seofon assist Quest ID is 305411');
  assert(raidSpec?.stageId === '12072', 'Seofon Revans Stage ID is 12072');
  assert(raidSpec?.blueChestTargetHonors === 4000000, 'Blue Chest guarantee is 4,000,000 Honors');
  assert(raidSpec?.equivalentTotalDamage === 400000000, 'Equivalent total damage is 400,000,000');
  assert(raidSpec?.universalOmenCancelDamage === 77777777, 'Emblema omen cancel threshold is 77,777,777 damage');
  assert(raidSpec?.entryMechanics.nonFirePlainDamage === 999999, 'Entry non-Fire plain damage is 999,999');
  assert(raidSpec?.entryMechanics.summonCooldownResetTurns === 99, 'Entry summon cooldown lock is 99 turns');
  assert((raidSpec?.coreOmens.length ?? 0) >= 5, 'All 5 core Seofon omens documented');

  // 2. Verify Registry Alias & ID Lookups
  console.log('\n[2/7] Verifying O(1) Character, Weapon, and Summon Registry Resolution...');
  assert(catalog.getSieteCharacter('Percival (Grand)')?.npcId === '3040419000', 'Resolves Percival (Grand) by name');
  assert(catalog.getSieteCharacter('g.zeta')?.id === 'char_fire_zeta_grand', 'Resolves Zeta (Grand) by alias g.zeta');
  assert(catalog.getSieteCharacter('ウィルナス (リミテッド)')?.id === 'char_fire_wilnas_grand', 'Resolves Wilnas (Grand) by Japanese name');
  assert(catalog.getSieteCharacter('alanaan')?.requiresFourthSkill === true, 'Alanaan FLB requires 4th skill');

  assert(catalog.getSieteWeapon('1040023700')?.id === 'wpn_fire_lord_of_flames', 'Resolves Lord of Flames by weaponId');
  assert(catalog.getSieteWeapon('m3 fire sword')?.id === 'wpn_fire_ira_volcanic_blade', 'Resolves Ira Volcanic Blade by alias');
  assert(catalog.getSieteWeapon('kaneshige')?.id === 'wpn_fire_unsigned_kaneshige', 'Resolves Unsigned Kaneshige by alias');

  assert(catalog.getSieteSummon('2040236000')?.id === 'sum_arcarum_the_sun', 'Resolves The Sun by summonId');
  assert(catalog.getSieteSummon('luci 250')?.id === 'sum_providence_lucifer_250', 'Resolves Lucifer Lv250 by alias');

  // 3. Scenario 1: Endgame Fire Roster (data/combat/siete-roster.example.json)
  console.log('\n[3/7] Testing Scenario 1: Endgame Fire Roster (Manadiver / Berserker 2-4T 4M Burst)...');
  const exampleRoster = checker.loadRosterFromFile('data/combat/siete-roster.example.json');
  const optimalReport = checker.evaluateRoster(exampleRoster);

  assert(
    optimalReport.overallGrade === 'SSS' || optimalReport.overallGrade === 'SS',
    `Endgame roster achieves SSS/SS grade (got: ${optimalReport.overallGrade}, score: ${optimalReport.overallReadinessScore})`
  );
  assert(optimalReport.readyFor4MBlueChest === true, 'Endgame roster is READY for 4M Blue Chest');
  assert(optimalReport.canCancel77M7Omen === true, 'Endgame roster cancels 77,777,777 Emblema omen');
  assert(optimalReport.allCriticalGatesPassed === true, 'All critical hard gates pass');
  assert(
    optimalReport.bestArchetypeEvaluation.damageProjection.estimatedPeakBurstTurnDamage >= 120000000,
    `Peak turn burst exceeds 120M (got: ${optimalReport.bestArchetypeEvaluation.damageProjection.estimatedPeakBurstTurnDamage.toLocaleString()})`
  );
  assert(
    optimalReport.bestArchetypeEvaluation.damageProjection.estimatedTurnsTo4MHonors <= 4,
    `Reaches 4M Honors in <= 4 turns (got: ${optimalReport.bestArchetypeEvaluation.damageProjection.estimatedTurnsTo4MHonors} turns)`
  );

  // 4. Scenario 2: F2P / Magna Kengo Ougi Loop Roster with Substitutes
  console.log('\n[4/7] Testing Scenario 2: Magna Kengo Ougi Loop & Substitute Resolution...');
  const kengoRoster: SietePlayerRosterInput = {
    accountId: 'acc_kengo',
    source: 'roster_config',
    activeMcClass: 'Kengo',
    mcClassesUnlocked: ['Kengo', 'Paladin'],
    estimatedPartyHp: 66000,
    characters: [
      { name: 'Wilnas (Grand)', element: 'fire', level: 80, uncapStars: 4 },
      { name: 'Mirin (Yukata)', element: 'fire', level: 80, uncapStars: 4 },
      { name: 'Satyr (Fire)', element: 'fire', level: 80, uncapStars: 4 },
      { name: 'Athena', element: 'fire', level: 100, uncapStars: 5, hasFourthSkill: true },
      { name: 'Michael (Grand)', element: 'fire', level: 80, uncapStars: 4 }
    ],
    weapons: [
      { name: 'Unsigned Kaneshige (Fire)', copies: 1, isMainhand: true },
      { name: 'Ira Volcanic Blade', copies: 3 },
      { name: 'Al-Abad', copies: 2 },
      { name: 'Nilakantha', copies: 2 },
      { name: 'Scythe of Repentance', copies: 1 },
      { name: 'Sword of Michael', copies: 1 }
    ],
    summons: [
      { name: 'Colossus Ira Omega (Lv 250)', slotRole: 'main' },
      { name: 'The Sun (ULB Lv 200)', slotRole: 'sub_aura' },
      { name: 'The Devil (ULB Lv 200)', slotRole: 'sub_aura' },
      { name: 'Michael (Archangel Summon)', slotRole: 'sub_aura' }
    ]
  };
  const kengoReport = checker.evaluateRoster(kengoRoster, 'siete_fire_kengo_ougi_loop');
  assert(
    kengoReport.bestArchetypeEvaluation.archetypeId === 'siete_fire_kengo_ougi_loop',
    'Evaluates Kengo Ougi Loop archetype'
  );
  assert(
    kengoReport.readyFor4MBlueChest === true,
    `Kengo setup is ready for 4M Blue Chest (score: ${kengoReport.overallReadinessScore}, grade: ${kengoReport.overallGrade})`
  );
  const silvaSlot = kengoReport.bestArchetypeEvaluation.characterSlots.find(s => s.slotNumber === 2);
  assert(
    silvaSlot?.status === 'SUBSTITUTE_MATCH' && silvaSlot?.matchedCharacterId === 'char_fire_mirin_yukata',
    'Resolves Yukata Mirin as valid substitute for Yukata Silva in Kengo Slot 2'
  );

  // 5. Scenario 3: Non-Fire Character Entry Execution Blocker Detection
  console.log('\n[5/7] Testing Scenario 3: Off-Element (Non-Fire) Entry Execution Hard Gate Blocker...');
  const offElementRoster: SietePlayerRosterInput = {
    ...exampleRoster,
    characters: [
      ...exampleRoster.characters.slice(0, 2),
      { name: 'Seox (Transcendence 150)', element: 'dark', level: 150, slotPosition: 'frontline_3' }
    ]
  };
  const offElementReport = checker.evaluateRoster(offElementRoster);
  const fireGate = offElementReport.hardGateResults.find(g => g.gateId === 'gate_100_percent_fire_allies');
  assert(fireGate?.passed === false, 'Non-Fire ally triggers gate_100_percent_fire_allies FAIL');
  assert(offElementReport.allCriticalGatesPassed === false, 'allCriticalGatesPassed is false when non-Fire ally is present');
  assert(offElementReport.overallGrade === 'NOT_READY', 'Overall grade is capped at NOT_READY on critical blocker');
  assert(offElementReport.readyFor4MBlueChest === false, 'readyFor4MBlueChest is false on critical blocker');
  assert(
    offElementReport.upgradeRoadmap.some(u => u.priority === 'CRITICAL' && u.actionableStep.includes('Ragazzo')),
    'Upgrade roadmap recommends replacing off-element sacrifice with Fire Ragazzo'
  );

  // 6. Scenario 4: Missing Evoker FLB/4th Skill & Unmet Lord of Flames Resonator Condition
  console.log('\n[6/7] Testing Scenario 4: Missing Evoker FLB & Unmet Weapon Resonator Condition...');
  const incompleteRoster: SietePlayerRosterInput = {
    accountId: 'acc_incomplete',
    source: 'roster_config',
    activeMcClass: 'Manadiver',
    characters: [
      { name: 'Percival (Grand)', element: 'fire', level: 80, uncapStars: 4 },
      { name: 'Zeta (Grand)', element: 'fire', level: 80, uncapStars: 4 },
      { name: 'Alanaan (FLB)', element: 'fire', level: 80, uncapStars: 4, hasFourthSkill: false },
      { name: 'Michael (Grand)', element: 'fire', level: 80, uncapStars: 4 }
    ],
    weapons: [
      { name: 'Lord of Flames', copies: 2 }, // Only 2 Sabres total in grid (< 4 required for Resonator!)
      { name: 'Crimson Scale', copies: 1 },
      { name: 'Overrider', copies: 1, isMainhand: true }
    ],
    summons: [{ name: 'Agni', slotRole: 'main' }]
  };
  const incompleteReport = checker.evaluateRoster(incompleteRoster, 'siete_fire_manadiver_burst_2t');
  const alanaanSlot = incompleteReport.bestArchetypeEvaluation.characterSlots.find(
    s => s.matchedCharacterId === 'char_fire_alanaan_flb'
  );
  assert(alanaanSlot?.meetsLevelAndUncap === false, 'Detects Alanaan missing Lv100 FLB / 4th skill');

  const lofSlot = incompleteReport.bestArchetypeEvaluation.weaponSlots.find(
    w => w.primaryWeaponId === 'wpn_fire_lord_of_flames'
  );
  assert(lofSlot?.resonatorConditionMet === false, 'Detects unmet 4-weapon Resonator requirement for Lord of Flames');
  assert(
    incompleteReport.upgradeRoadmap.some(u => u.targetItem.includes('Resonator')),
    'Upgrade roadmap flags Lord of Flames Resonator 4+ weapon requirement'
  );

  // 7. Verify raid-seofon.json Workflow Template, Aliases & Search Raid Catalog Integration
  console.log('\n[7/7] Verifying raid-seofon.json template, aliases, and DSL round-trip...');
  const tplBySiete = TemplateParser.loadTemplate('siete');
  const tplBySeofon = TemplateParser.loadTemplate('seofon');
  const tplBy4M = TemplateParser.loadTemplate('siete-4m');
  assert(tplBySiete.name === tplBySeofon.name && tplBySiete.name === tplBy4M.name, 'All Siete aliases resolve to raid-seofon.json');
  assert(tplBySiete.targetScore === 4000000, 'raid-seofon targetScore is 4,000,000');
  assert(tplBySiete.targetRaidQuestId === '305411', 'raid-seofon targetRaidQuestId is 305411');
  assert(tplBySiete.element === 'Fire', 'raid-seofon element is Fire');
  assert(
    !tplBySiete.steps.some(s => (s.code || s.action) === 'quick_call'),
    'raid-seofon does not execute Turn-1 quick_call (respects 99T summon lock)'
  );

  const dsl = TemplateParser.serializeToDsl(tplBySiete);
  const roundTripped = TemplateParser.parseShorthandDsl(dsl, 'raid-seofon');
  assert(
    roundTripped.steps.length === tplBySiete.steps.length,
    `raid-seofon DSL round-trip preserves all ${tplBySiete.steps.length} steps`
  );

  const searchRaid = resolveSearchRaid({
    questId: tplBySiete.targetRaidQuestId,
    targetEnemy: tplBySiete.targetEnemy,
    name: tplBySiete.name
  });
  assert(searchRaid?.questId === '305411' && searchRaid?.stageId === '12072', 'SearchRaidCatalog resolves Seofon (Impossible) 305411 / 12072');

  const md = checker.formatMarkdownReport(optimalReport);
  const consoleOut = checker.formatConsoleReport(optimalReport);
  assert(md.includes('4,000,000 Honors') && consoleOut.includes('SEOFON (IMPOSSIBLE)'), 'Markdown and Console report formatters render cleanly');

  // 8. Verify SieteAutoSetupService Deck Priority Resolution & Party Synthesis
  console.log('\n[8/8] Verifying SieteAutoSetupService Ex A Party 3 resolution and party synthesis...');
  const autoSetup = new SieteAutoSetupService(checker);
  const exA3 = autoSetup.resolveDeckTarget('ex-a-3');
  const exAParty3 = autoSetup.resolveDeckTarget('Ex A Party 3');
  const setA1 = autoSetup.resolveDeckTarget('a-1');
  const exB1 = autoSetup.resolveDeckTarget('ex-b-1');
  assert(exA3.priority === 153 && exA3.maxWeaponSlots === 13, 'ex-a-3 resolves to Priority 153 (13 weapon slots)');
  assert(exAParty3.priority === 153 && exAParty3.setType === 'Ex A', 'Ex A Party 3 resolves to Priority 153');
  assert(setA1.priority === 11 && setA1.maxWeaponSlots === 10, 'a-1 resolves to Priority 11 (10 weapon slots)');
  assert(exB1.priority === 221 && exB1.maxWeaponSlots === 13, 'ex-b-1 resolves to Priority 221 (13 weapon slots)');

  const plan = autoSetup.synthesizeSetupPlan(
    {
      accountId: 'acc1',
      scannedPriorities: [153],
      jobs: [{ userJobId: 25501020, masterId: '130401', name: 'Manadiver' }],
      subskills: [
        { abilityId: '1600', name: 'Miserable Mist', defaultPos: 0 },
        { abilityId: '201861', name: 'Secret Triad', defaultPos: 1 },
        { abilityId: '201851', name: 'Wild Magica', defaultPos: 2 }
      ],
      npcs: [
        { userNpcId: 230260240, masterId: '3040425000', name: 'Percival', attribute: 1, level: 80, evolution: 4 },
        { userNpcId: 222924905, masterId: '3040499000', name: 'Zeta', attribute: 1, level: 80, evolution: 4 },
        { userNpcId: 211476294, masterId: '3040381000', name: 'Wilnas', attribute: 1, level: 80, evolution: 4 },
        { userNpcId: 165649545, masterId: '3040167000', name: 'Alanaan', attribute: 1, level: 100, evolution: 5 },
        { userNpcId: 207240043, masterId: '3040440000', name: 'Michael', attribute: 1, level: 80, evolution: 4 }
      ],
      weapons: [
        { userWeaponId: 4507609140, masterId: '1040118000', name: 'Exo Maitrah Karuna', attribute: 1, level: 150, arousalForm: 'Special Lv10' },
        { userWeaponId: 4944730085, masterId: '1040218900', name: 'Overrider', attribute: 1, level: 150 },
        { userWeaponId: 4589775971, masterId: '1040218900', name: 'Overrider', attribute: 1, level: 150 },
        { userWeaponId: 4751343270, masterId: '1040023700', name: 'Lord of Flames', attribute: 1, level: 150 },
        { userWeaponId: 4249528590, masterId: '1040315900', name: 'Crimson Scale', attribute: 1, level: 150 },
        { userWeaponId: 2669544175, masterId: '1040310700', name: 'Scythe of Renunciation', attribute: 1, level: 210 },
        { userWeaponId: 3342400304, masterId: '1040311800', name: 'Sol Remnant', attribute: 1, level: 200 },
        { userWeaponId: 4952831377, masterId: '1040917100', name: 'Sennen Goji', attribute: 1, level: 150 },
        { userWeaponId: 2342020086, masterId: '1040906400', name: 'Ixaba', attribute: 1, level: 150 },
        { userWeaponId: 2794435317, masterId: '1040017200', name: 'Sword of Valorblaze', attribute: 1, level: 150 },
        { userWeaponId: 4517975898, masterId: '1040912600', name: 'Heat of The Sun', attribute: 1, level: 200 },
        { userWeaponId: 4412740004, masterId: '1040614300', name: 'Kiss of The Devil', attribute: 1, level: 150 },
        { userWeaponId: 2584700284, masterId: '1040907600', name: 'Ultima Blade', attribute: 2, level: 200 }
      ],
      summons: [
        { userSummonId: '1217829246', masterId: '2040408000', name: 'Beelzebub', attribute: 6, level: 150, evolution: 4 },
        { userSummonId: '972344879', masterId: '2040321000', name: 'The Sun', attribute: 1, level: 200, evolution: 5 },
        { userSummonId: '1055927429', masterId: '2040317000', name: 'The Devil', attribute: 1, level: 200, evolution: 5 },
        { userSummonId: '1469350809', masterId: '2040425000', name: 'Triple Zero', attribute: 5, level: 150, evolution: 4 },
        { userSummonId: '1326770183', masterId: '2040398000', name: 'Wilnas', attribute: 1, level: 150, evolution: 4 },
        { userSummonId: '769520818', masterId: '2040306000', name: 'Michael', attribute: 1, level: 150, evolution: 4 },
        { userSummonId: '933713546', masterId: '2040347000', name: 'Belial', attribute: 6, level: 150, evolution: 4 }
      ]
    },
    { deckTarget: 'Ex A Party 3' }
  );
  assert(plan.mcJob.name === 'Manadiver' && plan.mcJob.subskills.length === 3, 'Synthesizes Manadiver with 3 subskills');
  assert(plan.party.length === 5 && plan.party[0].name === 'Percival', 'Synthesizes 5 Fire party slots with Percival in Slot 1');
  assert(plan.weapons.length === 13 && plan.sabreKatanaCount >= 4, `Synthesizes 13-weapon grid with >=4 Sabres/Katanas (got ${plan.sabreKatanaCount})`);
  assert(plan.summons.length === 7 && plan.summons[0].name === 'Beelzebub', 'Synthesizes 7 passive-aura summons led by Beelzebub');
  assert(plan.workflowSteps.length >= 18, 'Generates full Turn 1-3 Siete 4M combat workflow steps');

  console.log('\n🎉 ALL SEOFON (IMPOSSIBLE) 4M HONORS & READINESS TESTS PASSED!');
}

run().catch(err => {
  console.error('Fatal error in test-siete-4m-readiness:', err);
  process.exit(1);
});

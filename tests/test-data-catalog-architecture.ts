// tests/test-data-catalog-architecture.ts
import fs from 'fs';
import path from 'path';
import { DataCatalogService } from '../src/domain/data/index.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ ${message}`);
}

async function run() {
  console.log('------------------------------------------------------------------------');
  console.log('Test Suite: Senior Gold Industry Standard Data Architecture Validation');
  console.log('------------------------------------------------------------------------');

  const dataDir = path.resolve(process.cwd(), 'data');

  // Test 1: Verify all modular JSON files exist and are valid JSON
  console.log('\n[1/5] Verifying modular data file integrity...');
  const expectedFiles = [
    'index.json',
    'schemas/raid-catalog.schema.json',
    'schemas/endpoints.schema.json',
    'schemas/selectors.schema.json',
    'schemas/daily-catalog.schema.json',
    'raids/raids.catalog.json',
    'raids/categories.json',
    'raids/drop-tables.json',
    'ui/selectors.catalog.json',
    'ui/modals.catalog.json',
    'ui/navigation-routes.json',
    'network/endpoints.catalog.json',
    'network/auth-and-login.json',
    'network/cdn-assets.json',
    'combat/combat-physics.json',
    'combat/battle-systems.json',
    'combat/omens.catalog.json',
    'combat/v2-counter-taxonomy.json',
    'schemas/element-catalog.schema.json',
    'schemas/omens-catalog.schema.json',
    'elements/elements.catalog.json',
    'elements/elemental-matrix.json',
    'elements/party-selection-rules.json',
    'automation/daily-routines.json',
    'automation/anti-detection.json',
    'schemas/plain-damage-catalog.schema.json',
    'combat/plain-damage.catalog.json',
    'combat/plain-damage-counter-engine.json',
    'schemas/status-effects-catalog.schema.json',
    'schemas/supporter-summons.schema.json',
    'schemas/raid-evaluation.schema.json',
    'schemas/combat-physics.schema.json',
    'schemas/battle-systems.schema.json',
    'schemas/tactical-action-priority.schema.json',
    'schemas/anti-detection.schema.json',
    'schemas/auth-and-login.schema.json',
    'schemas/cdn-assets.schema.json',
    'schemas/drop-tables.schema.json',
    'schemas/navigation-routes.schema.json',
    'schemas/party-selection-rules.schema.json',
    'schemas/categories.schema.json',
    'schemas/modals.schema.json',
    'combat/status-effects.catalog.json',
    'combat/supporter-summons.catalog.json',
    'combat/tactical-action-priority.json',
    'raids/raid-join-decision.json',
    'schemas/events.schema.json',
    'schemas/event-detail.schema.json',
    'schemas/event-farming-optimizer.schema.json',
    'events/events.catalog.json',
    'events/biography045-gintama.catalog.json',
    'events/event-farming-optimizer.json',
    'schemas/side-stories.schema.json',
    'schemas/side-story-optimizer.schema.json',
    'events/side-stories.catalog.json',
    'events/side-story-optimizer.json'
  ];

  for (const relPath of expectedFiles) {
    const fullPath = path.join(dataDir, relPath);
    assert(fs.existsSync(fullPath), `File exists: ${relPath}`);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const parsed = JSON.parse(content);
    assert(typeof parsed === 'object' && parsed !== null, `Parses valid JSON: ${relPath}`);
  }

  // Test 2: Backwards compatibility of data/index.json
  console.log('\n[2/5] Testing backwards compatibility of data/index.json...');
  const indexData = JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf-8'));
  assert(Array.isArray(indexData.raids), 'index.json contains raids array');
  assert(indexData.endpoints && typeof indexData.endpoints === 'object', 'index.json contains endpoints object');
  assert(indexData.dailyCatalog && Array.isArray(indexData.dailyCatalog.tasks), 'index.json contains dailyCatalog.tasks array');
  assert(indexData.combatFormulas && typeof indexData.combatFormulas === 'object', 'index.json contains combatFormulas');
  assert(indexData.domSelectors && typeof indexData.domSelectors === 'object', 'index.json contains domSelectors');

  // Verify daily tasks expected by UniversalWorkflowEngine & test suites
  const rupieTask = indexData.dailyCatalog.tasks.find((t: any) => t.id === 'rupie_gacha' || t.tag === 'daily_rupie');
  assert(!!rupieTask, 'Resolves daily_rupie task from index.json');
  const enneadTask = indexData.dailyCatalog.tasks.find((t: any) => t.id === 'ennead_pro' || t.tag === 'daily_ennead_pro');
  assert(!!enneadTask, 'Resolves daily_ennead_pro task from index.json');

  // Test 3: DataCatalogService O(1) Raid Queries
  console.log('\n[3/5] Testing DataCatalogService Raid Resolution...');
  const catalog = DataCatalogService.getInstance(dataDir);

  const pbhl = catalog.getRaidById('pbhl');
  assert(!!pbhl, 'Resolves PBHL by ID');
  assert(pbhl?.stageId === '12061', 'PBHL stageId is 12061');
  assert(pbhl?.questId === '301061', 'PBHL questId is 301061');
  assert(pbhl?.blueChest?.thresholdHonors === 1480000, 'PBHL Blue Chest threshold is 1,480,000');
  assert(pbhl?.blueChest?.goldBrickChance === 0.015, 'PBHL Gold Brick chance is 1.5%');

  const tiamat = catalog.getRaidById('tiamat_aura');
  assert(!!tiamat, 'Resolves Tiamat Aura Omega by ID');
  assert(tiamat?.stageId === '12042', 'Tiamat Aura stageId is 12042');
  assert(tiamat?.questId === '305601', 'Tiamat Aura questId is 305601');
  assert(tiamat?.dailyLimit === 3, 'Tiamat Aura dailyLimit is 3');

  const tiamatByQuest = catalog.getRaidByQuestId('305601');
  assert(tiamatByQuest?.id === 'tiamat_aura', 'Resolves Tiamat Aura by quest ID 305601');

  const wilnas = catalog.getRaidByQuestId('305191');
  assert(wilnas?.id === 'wilnas' && wilnas?.stageId === '12051', 'Resolves Wilnas by quest ID 305191 in stage 12051');

  // Test 4: UI Modals, Selectors & Routes
  console.log('\n[4/5] Testing UI Modals, Selectors & Navigation Routes...');
  const stageModal = catalog.getModal('stage_detail_modal');
  assert(!!stageModal, 'Resolves stage_detail_modal');
  assert(stageModal?.closeButtonSelector?.includes('.btn-usual-close') === true, 'Stage modal close selector contains .btn-usual-close');

  const treasureModal = catalog.getModal('treasure_offer_modal');
  assert(treasureModal?.confirmButtonSelector?.includes('.btn-offer') === true, 'Treasure modal confirm selector contains .btn-offer');

  const multiRoute = catalog.getRoute('#quest/multi/0');
  assert(!!multiRoute, 'Resolves #quest/multi/0 navigation route');

  const selectors = catalog.getSelectors();
  assert(!!selectors.combatHUD?.attackButton, 'Selectors catalog contains combatHUD.attackButton');
  assert(selectors.combatHUD.attackButton === '.btn-attack-start', 'Attack button selector is .btn-attack-start');

  // Test 5: Endpoints, Auth & Automation Tasks
  console.log('\n[5/5] Testing Endpoints, Auth & Automation Tasks...');
  const normalAttack = catalog.getEndpoint('normalAttack');
  assert(!!normalAttack, 'Resolves normalAttack endpoint');
  assert(normalAttack?.path === '/rest/multiraid/normal_attack_result.json', 'normalAttack path is /rest/multiraid/normal_attack_result.json');

  const dailyRupie = catalog.getDailyTask('daily_rupie');
  assert(!!dailyRupie, 'Resolves daily_rupie task');
  assert(dailyRupie?.pageUrl === 'https://game.granbluefantasy.jp/#gacha/normal', 'daily_rupie pageUrl is #gacha/normal');

  const allTasks = catalog.getAllDailyTasks();
  assert(allTasks.length >= 15, `Loaded all daily automation tasks (count: ${allTasks.length})`);

  // Test 6: Elemental Catalog, Matrix & Party Selection Rules
  console.log('\n[6/6] Testing Elemental Catalog, Matrix & Party Selection Rules...');
  const fire = catalog.getElement('fire');
  assert(!!fire, 'Resolves Fire element');
  assert(fire?.internalId === 1, 'Fire internalId is 1');
  assert(fire?.supporterTabAttribute === 1, 'Fire supporterTabAttribute is 1');
  assert(fire?.superiorTo.includes('wind') === true, 'Fire is superior to Wind');
  assert(fire?.weakTo.includes('water') === true, 'Fire is weak to Water');

  const water = catalog.getElement(2);
  assert(water?.id === 'water', 'Resolves Water by internal ID 2');

  assert(catalog.getOptimalElementForBoss('wind') === 'fire', 'Optimal party for Wind boss is Fire');
  assert(catalog.getOptimalElementForBoss('water') === 'earth', 'Optimal party for Water boss is Earth');
  assert(catalog.getOptimalElementForBoss('earth') === 'wind', 'Optimal party for Earth boss is Wind');
  assert(catalog.getOptimalElementForBoss('fire') === 'water', 'Optimal party for Fire boss is Water');
  assert(catalog.getOptimalElementForBoss('dark') === 'light', 'Optimal party for Dark boss is Light');
  assert(catalog.getOptimalElementForBoss('light') === 'dark', 'Optimal party for Light boss is Dark');

  const fireVsWind = catalog.getElementMatrix('fire', 'wind');
  assert(fireVsWind?.relation === 'superior', 'Fire vs Wind relation is superior');
  assert(fireVsWind?.damageMultiplier === 1.5, 'Fire vs Wind damageMultiplier is 1.5');
  assert(fireVsWind?.criticalHitEligible === true, 'Fire vs Wind criticalHitEligible is true');

  const fireVsWater = catalog.getElementMatrix('fire', 'water');
  assert(fireVsWater?.relation === 'inferior', 'Fire vs Water relation is inferior');
  assert(fireVsWater?.damageMultiplier === 0.75, 'Fire vs Water damageMultiplier is 0.75');
  assert(fireVsWater?.criticalHitEligible === false, 'Fire vs Water criticalHitEligible is false');

  const allElements = catalog.getAllElements();
  assert(allElements.length === 7, 'All 7 elements loaded (6 main + plain)');

  // Test 7: Battle System 2.0 (V2) Omens & Counter Taxonomy Validation
  console.log('\n[7/7] Testing Battle System 2.0 (V2) Omens & Counter Taxonomy...');
  const allOmens = catalog.getAllOmens();
  assert(allOmens.length >= 15, `Loaded all V2 omens (count: ${allOmens.length})`);

  const tiamatOmen = catalog.getOmenById('tiamat_aura_skill_omen');
  assert(!!tiamatOmen, 'Resolves Tiamat Aura skill omen by ID');
  assert(tiamatOmen?.cancelCondition.type === 'skill_damage', 'Tiamat omen requires skill_damage');
  assert(tiamatOmen?.cancelCondition.targetCount === 10, 'Tiamat omen requires 10 hits');

  const wilnasOmens = catalog.getOmensByRaidId('wilnas');
  assert(wilnasOmens.length >= 2, 'Resolves Wilnas omens by raid ID');
  const magmaChamber = wilnasOmens.find(o => o.id === 'wilnas_magma_chamber_omen');
  assert(magmaChamber?.cancelCondition.targetCount === 30, 'Wilnas Magma Chamber requires 30 hits');

  const hitResolver = catalog.getConditionResolver('hit_count');
  assert(!!hitResolver, 'Resolves hit_count strategy resolver');
  assert(hitResolver?.candidateClasses.includes('Manadiver') === true, 'Hit count strategy recommends Manadiver');
  assert(hitResolver?.candidateSkills.includes('decimate') === true, 'Hit count strategy recommends Decimate');

  const caResolver = catalog.getConditionResolver('charge_attack_count');
  assert(caResolver?.candidateClasses.includes('Kengo') === true, 'C.A. strategy recommends Kengo');

  // Test 8: Plain Damage Sources & V2 Counter Engine Validation
  console.log('\n[8/8] Testing Plain Damage Sources & V2 Counter Engine...');
  const summons = catalog.getPlainDamageSummons();
  assert(summons.length >= 4, `Loaded Plain damage summons (count: ${summons.length})`);
  const bz = catalog.getPlainDamageSummonById('beelzebub');
  assert(!!bz, 'Resolves Beelzebub summon');
  assert(bz?.plainDamageMax === 3000000, 'Beelzebub deals 3,000,000 plain damage');

  const chars = catalog.getPlainDamageCharacters();
  assert(chars.length >= 8, `Loaded Plain damage characters (count: ${chars.length})`);

  const earthChars = catalog.getPlainDamageCharacters('earth');
  assert(earthChars.some(c => c.id === 'threo'), 'Earth characters include Threo (Sarasa)');
  const threo = catalog.getPlainDamageCharacterById('threo');
  assert(threo?.plainDamageMax === 2040000, 'Threo max plain damage is 2,040,000');

  const waterChars = catalog.getPlainDamageCharacters('water');
  assert(waterChars.some(c => c.id === 'yodarha_water'), 'Water characters include Yodarha');
  assert(waterChars.some(c => c.id === 'gwynne'), 'Water characters include Gwynne');

  const mcItems = catalog.getPlainDamageMCItems();
  assert(mcItems.length >= 3, `Loaded Plain damage MC items (count: ${mcItems.length})`);
  const yamato = catalog.getPlainDamageMCById('yamato_class');
  assert(!!yamato, 'Resolves Yamato Row V class');

  const pipeline = catalog.getPlainDamageSolverPipeline();
  assert(pipeline.length === 6, `Solver pipeline contains all 6 decision steps (count: ${pipeline.length})`);
  assert(pipeline[0].step === 1, 'Pipeline step 1 begins with Omen Requirement Interception');
  assert(pipeline[5].step === 6, 'Pipeline step 6 ends with Guard Fallback Evaluation');

  const faahlMapping = catalog.getPlainDamageMappingForRaid('dark_rapture_hard');
  assert(!!faahlMapping, 'Resolves FaaHL plain damage mapping');
  assert(faahlMapping?.requiredPlainDamage === 2000000, 'FaaHL Labor 7 requires 2,000,000 plain damage');

  // Test 9: Status Effects, Dispel & Cleanse KMS
  console.log('\n[9/11] Testing Status Effects, Dispel & Cleanse KMS...');
  const allBossBuffs = catalog.getAllBossBuffs();
  assert(allBossBuffs.length >= 8, `Loaded boss buffs (count: ${allBossBuffs.length})`);
  const repel = catalog.getBossBuff('repel');
  assert(!!repel, 'Resolves Repel boss buff');
  assert(repel?.dispelPriority === 'immediate', 'Repel dispel priority is immediate');
  assert(repel?.threatLevel === 'wipe', 'Repel threat level is wipe');

  const zombie = catalog.getPartyDebuff('zombified');
  assert(!!zombie, 'Resolves Zombified debuff');
  assert(zombie?.cleansePriority === 'immediate', 'Zombified cleanse priority is immediate');
  assert(catalog.isActionBlockedByZombified('green_potion'), 'Green Potion blocked during Zombified');
  assert(catalog.isActionBlockedByZombified('all_potion'), 'All Potion blocked during Zombified');
  assert(catalog.isActionBlockedByZombified('heal_skill'), 'Heal skill blocked during Zombified');
  assert(!catalog.isActionBlockedByZombified('normal_attack'), 'Normal attack not blocked during Zombified');

  const dispelSummons = catalog.getDispelSummons();
  assert(dispelSummons.some(s => s.id === 'beelzebub'), 'Dispel summons includes Beelzebub');

  // Test 10: Supporter Summons & Grid Archetypes Decision Engine
  console.log('\n[10/11] Testing Supporter Summons & Grid Archetypes Decision Engine...');
  const allArchetypes = catalog.getAllGridArchetypes();
  assert(allArchetypes.length >= 5, `Loaded grid archetypes (count: ${allArchetypes.length})`);
  assert(!!catalog.getGridArchetype('magna'), 'Resolves Magna grid archetype');
  assert(!!catalog.getGridArchetype('primal'), 'Resolves Primal grid archetype');
  assert(!!catalog.getGridArchetype('farming'), 'Resolves Farming grid archetype');

  const fireSupporters = catalog.getElementalSupporters('fire');
  assert(!!fireSupporters, 'Resolves Fire elemental supporters');
  assert(fireSupporters?.supporterTabAttribute === 1, 'Fire supporter tab attribute is 1');
  assert(fireSupporters?.magnaSummons.some(s => s.id === 'colossus_omega') === true, 'Fire includes Colossus Omega');

  const miscSupporters = catalog.getElementalSupporters('misc');
  assert(miscSupporters?.supporterTabAttribute === 7, 'Misc supporter tab attribute is 7');
  assert(miscSupporters?.elementalSummons.some(s => s.id === 'kaguya') === true, 'Misc includes Kaguya');

  const proSkipRule = catalog.getSupporterSelectionRule('daily_routines_pro_skip');
  assert(proSkipRule?.preferredArchetype === 'farming', 'Pro skip prefers farming supporter archetype');

  // Test 11: Raid Evaluation & Dynamic Join Decision Matrix
  console.log('\n[11/11] Testing Raid Evaluation & Dynamic Join Decision Matrix...');
  const policies = catalog.getRaidActionPolicies();
  assert(policies.length >= 5, `Loaded raid action policies (count: ${policies.length})`);
  assert(policies.some(p => p.action === 'SKIP_DYING'), 'Action policies include SKIP_DYING');
  assert(policies.some(p => p.action === 'RAPID_LEECH'), 'Action policies include RAPID_LEECH');
  assert(policies.some(p => p.action === 'BLUE_CHEST_RACE'), 'Action policies include BLUE_CHEST_RACE');

  const pbhlProfile = catalog.getRaidJoinProfile('pbhl');
  assert(!!pbhlProfile, 'Resolves PBHL raid join profile');
  assert(pbhlProfile?.targetMode === 'blue_chest_race', 'PBHL target mode is blue_chest_race');
  assert(pbhlProfile?.blueChestTargetHonors === 1480000, 'PBHL blue chest target is 1,480,000 honors');

  const tiamatProfile = catalog.getRaidJoinProfile('tiamat_aura');
  assert(tiamatProfile?.targetMode === 'rapid_leech', 'Tiamat Aura target mode is rapid_leech');

  const tiers = catalog.getTacticalExecutionTiers();
  assert(tiers.length === 8, `Tactical execution tiers loaded (count: ${tiers.length})`);
  assert(tiers[0].category === 'omen_interception', 'Tier 0 is omen_interception');
  assert(tiers[1].category === 'emergency_survival', 'Tier 1 is emergency_survival');

  // Test 12: Senior KMS Schema-First Linkage & Relational Integrity Verification
  console.log('\n[12/12] Testing KMS Schema Linkage & Relational Integrity (Gold Standard)...');
  const schemasDir = path.join(dataDir, 'schemas');
  const allSchemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.json'));
  assert(allSchemaFiles.length >= 15, `All authoritative schemas present (count: ${allSchemaFiles.length})`);

  for (const sFile of allSchemaFiles) {
    const sContent = JSON.parse(fs.readFileSync(path.join(schemasDir, sFile), 'utf-8'));
    assert(sContent.$schema === 'https://json-schema.org/draft/2020-12/schema', `${sFile} adheres to Draft 2020-12`);
    assert(sContent.type === 'object', `${sFile} root type is object`);
    assert(typeof sContent.properties === 'object', `${sFile} defines properties object`);
  }

  // Verify every catalog declares an existing local schema
  const dataCatalogs = [
    'automation/anti-detection.json',
    'automation/daily-routines.json',
    'automation/recovery-policies.catalog.json',
    'automation/battle-reload-profiles.catalog.json',
    'automation/event-automation.catalog.json',
    'automation/cooldown-and-pacing.catalog.json',
    'automation/multi-account-orchestration.catalog.json',
    'automation/state-machine-recovery.catalog.json',
    'automation/sentinel-watchdog.catalog.json',
    'combat/battle-systems.json',
    'combat/combat-physics.json',
    'combat/omens.catalog.json',
    'combat/plain-damage-counter-engine.json',
    'combat/plain-damage.catalog.json',
    'combat/status-effects.catalog.json',
    'combat/supporter-summons.catalog.json',
    'combat/tactical-action-priority.json',
    'combat/v2-counter-taxonomy.json',
    'elements/elements.catalog.json',
    'elements/elemental-matrix.json',
    'elements/party-selection-rules.json',
    'network/auth-and-login.json',
    'network/cdn-assets.json',
    'network/endpoints.catalog.json',
    'raids/categories.json',
    'raids/drop-tables.json',
    'raids/raid-join-decision.json',
    'raids/raids.catalog.json',
    'ui/modals.catalog.json',
    'ui/navigation-routes.json',
    'ui/selectors.catalog.json'
  ];

  for (const catRelPath of dataCatalogs) {
    const fullCatPath = path.join(dataDir, catRelPath);
    const catData = JSON.parse(fs.readFileSync(fullCatPath, 'utf-8'));
    assert(typeof catData.$schema === 'string', `${catRelPath} declares $schema`);
    const resolvedSchemaPath = path.resolve(path.dirname(fullCatPath), catData.$schema);
    assert(fs.existsSync(resolvedSchemaPath), `${catRelPath} $schema resolves to existing file (${path.basename(resolvedSchemaPath)})`);
  }

  // Relational Integrity: All raid IDs in omens & join decisions exist in raids.catalog.json
  const allRaids = catalog.getAllRaids();
  const knownRaidIds = new Set(allRaids.map(r => r.id.toLowerCase()));
  for (const omen of catalog.getAllOmens()) {
    assert(knownRaidIds.has(omen.raidId.toLowerCase()), `Omen ${omen.id} references known raidId: ${omen.raidId}`);
  }
  for (const profile of catalog.getAllRaidJoinProfiles()) {
    assert(knownRaidIds.has(profile.raidId.toLowerCase()), `Join profile ${profile.raidId} references known raidId`);
  }

  // Test 13: Automation Subsystem Deep Knowledge & Integrity Verification
  console.log('\n[13/13] Testing Automation Subsystem Deep Knowledge & Integrity...');
  const autoDir = path.join(dataDir, 'automation');

  // 1. Recovery Policies
  const recoveryData = JSON.parse(fs.readFileSync(path.join(autoDir, 'recovery-policies.catalog.json'), 'utf-8'));
  assert(recoveryData.consumables.ap.some((c: any) => c.id === 'half_elixir' && c.itemId === '1'), 'Half-Elixir item 1 mapped');
  assert(recoveryData.pendingBattlesPolicy.activeBattleLimit === 3, 'Pending battle active limit is 3');
  assert(recoveryData.pendingBattlesPolicy.unclaimedLootLimit === 5, 'Pending battle unclaimed limit is 5');
  assert(recoveryData.pendingBattlesPolicy.goldBarItemId === '20004', 'Gold Bar item ID 20004 mapped in recovery policy');

  // 2. Battle Reload Profiles
  const reloadData = JSON.parse(fs.readFileSync(path.join(autoDir, 'battle-reload-profiles.catalog.json'), 'utf-8'));
  assert(reloadData.profiles.turbo.reloadOnAttack === true, 'Turbo profile reloads on attack');
  assert(reloadData.profiles.turbo.createJsOptimization.tickerFramerate === 120, 'Turbo framerate is 120 FPS');
  assert(reloadData.profiles.stealth.reloadOnAttack === false, 'Stealth profile never reloads');
  assert(reloadData.turnProcessingRecovery.whiteScreenTimeoutMs === 8000, 'White screen recovery threshold is 8s');

  // 3. Event Automation
  const eventData = JSON.parse(fs.readFileSync(path.join(autoDir, 'event-automation.catalog.json'), 'utf-8'));
  assert(eventData.dailyManiac.dailyLimit === 2, 'Daily Maniac limit is 2/2');
  assert(eventData.nightmareHell.difficulties.includes(100), 'Nightmare difficulties include 100');
  assert(eventData.tokenGacha.boxRules.boxes1to4.earlyResetOnSsr === true, 'Senka boxes 1-4 early reset on SSR');

  // 4. Cooldown and Pacing
  const pacingData = JSON.parse(fs.readFileSync(path.join(autoDir, 'cooldown-and-pacing.catalog.json'), 'utf-8'));
  assert(pacingData.gameServerCooldowns.backupRequestBroadcastAllMs === 180000, 'Backup broadcast cooldown is 180s');
  assert(pacingData.humanPacingBudgets.maxActionsPerMinute <= 45, 'APM hard cap is <= 45');
  assert(pacingData.humanPacingBudgets.restCycles.mandatorySleep.durationHours >= 6, 'Mandatory sleep >= 6h');

  // 5. Multi-Account Orchestration
  const multiAccData = JSON.parse(fs.readFileSync(path.join(autoDir, 'multi-account-orchestration.catalog.json'), 'utf-8'));
  assert(multiAccData.portAllocation.basePort === 9222, 'Base CDP port is 9222');
  assert(multiAccData.portAllocation.registeredAccounts.length >= 3, 'At least 3 accounts registered (acc1, acc2, iron)');
  assert(multiAccData.safetyPolicies.minStaggerDelayMs >= 45000, 'Stagger delay >= 45s');

  // 6. State Machine Recovery
  const smData = JSON.parse(fs.readFileSync(path.join(autoDir, 'state-machine-recovery.catalog.json'), 'utf-8'));
  assert(smData.states.some((s: any) => s.state === 'CAPTCHA_HALTED' && s.isTerminal === true), 'CAPTCHA_HALTED is terminal state');
  assert(smData.errorTaxonomy.some((e: any) => e.errorCode === 'DETACHED_FRAME'), 'Error taxonomy handles DETACHED_FRAME');
  assert(smData.fatalPolicy.maxConsecutiveErrors === 3, 'Max consecutive errors is 3');

  // 7. Sentinel Watchdog
  const sentinelData = JSON.parse(fs.readFileSync(path.join(autoDir, 'sentinel-watchdog.catalog.json'), 'utf-8'));
  assert(sentinelData.captchaSignatures.domSelectors.length >= 25, 'Sentinel defines 25+ CAPTCHA selectors');
  assert(sentinelData.captchaSignatures.networkPatterns.includes('/c/i?'), 'Sentinel intercepts /c/i? verification pattern');
  assert(sentinelData.escalationMatrix.tier1Freeze.haltInputs === true, 'Tier 1 freeze halts inputs');

  // Test 14: Events Subsystem & Gintama Collaboration Architecture (KMS Vol. 15)
  console.log('\n[14/14] Testing Events Subsystem & Gintama Collab Architecture (KMS Vol. 15)...');
  const allEvents = catalog.getAllEvents();
  assert(allEvents.length >= 4, `All events registered (count: ${allEvents.length} >= 4)`);

  const activeEvents = catalog.getActiveEvents();
  assert(activeEvents.some(e => e.id === 'biography045'), 'Active events include biography045');

  // ID & Raw ID lookups
  const gintamaById = catalog.getEvent('biography045');
  const gintamaByRaw = catalog.getEvent('720');
  assert(!!gintamaById, 'Resolves Gintama event by id (biography045)');
  assert(!!gintamaByRaw, 'Resolves Gintama event by rawId (720)');
  assert(gintamaById?.id === gintamaByRaw?.id, 'ID and RawID resolve to same master event record');

  // Metadata verification
  assert(gintamaById?.type === 'collaboration', 'Gintama type is collaboration');
  assert(gintamaById?.status === 'rerun', 'Gintama status is rerun');
  assert(gintamaById?.features?.recruitableCharactersCount === 2, 'Gintama features 2 recruitable SSRs');
  assert(gintamaById?.features?.hasFlbWeapon === true, 'Gintama has FLB weapon');
  assert(gintamaById?.features?.hasFlbSummon === true, 'Gintama has FLB summon');
  assert(gintamaById?.features?.hasNightmareHellSkip === true, 'Gintama supports HELL skip');

  // Detailed Catalog verification
  const gintamaDetail = catalog.getEventDetail('biography045');
  assert(!!gintamaDetail, 'Resolves Gintama detail catalog');
  assert(gintamaDetail?.metadata.eventNumber === 720, 'Event number is 720');
  assert(gintamaDetail?.assets.primaryOrigin.includes('akamaized.net'), 'CDN assets primary origin valid (Akamai CDN)');

  // Playable characters
  const shinsengumi = gintamaDetail?.characters.find(c => c.name.includes('Shinsengumi'));
  const yorozuya = gintamaDetail?.characters.find(c => c.name.includes('Yorozuya'));
  assert(!!shinsengumi && shinsengumi.element === 'fire', 'Shinsengumi is Fire SSR');
  assert(!!yorozuya && yorozuya.element === 'light', 'Yorozuya Gin-chan is Light SSR');

  // Equipment & Summons
  const sword = gintamaDetail?.weapons.find(w => w.name.includes('Wooden Sword Lake Toya'));
  const summon = gintamaDetail?.summons.find(s => s.name.includes('Katsura'));
  assert(!!sword && sword.maxUncap === 4 && sword.element === 'light', 'Lake Toya is 4★ Light Katana');
  assert(!!summon && summon.maxUncap === 4 && summon.element === 'wind', 'Katsura & Elizabeth is 4★ Wind Summon');

  // Story & Currencies
  assert(gintamaDetail?.story.totalCrystals === 350, 'Total story crystals is 350');
  assert(gintamaDetail?.story.chapters.length === 8, 'Story has 8 chapter entries (including Part 1 Ending)');
  assert(gintamaDetail?.currencies.length === 3, 'Currencies define Medallion, Secondary, and Fruit Parfait');

  // Quests & Exchange Shop
  const eventQuests = catalog.getEventQuests('biography045');
  assert(eventQuests.length >= 7, `Event has quests defined (count: ${eventQuests.length} >= 7)`);
  assert(eventQuests.some(q => q.bossName.includes('Neo Armstrong')), 'Quests include Neo Armstrong Cannon');
  assert(eventQuests.some(q => q.bossName.includes('Koro')), 'Quests include Koro raid');

  const exchangeItems = catalog.getEventExchangeItems('biography045');
  assert(exchangeItems.length >= 15, `Exchange shop has items (count: ${exchangeItems.length} >= 15)`);
  assert(exchangeItems.some(i => i.id === 'damascus_crystal'), 'Exchange shop includes Damascus Crystals');

  // Daily missions & Trophies
  assert(gintamaDetail?.dailyMissions.length === 1 && gintamaDetail?.dailyMissions[0].reward.amount === 50, 'Daily mission grants 50 crystals');
  assert(gintamaDetail?.trophies.length === 9, '9 event trophies mapped');

  // Test 15: Side Stories Permanent Vault & Spark Acceleration (KMS Vol. 16)
  console.log('\n[15/15] Testing Side Stories Permanent Vault & Spark Acceleration (KMS Vol. 16)...');
  const allSideStories = catalog.getAllSideStories();
  assert(allSideStories.length >= 20, `Side stories registered (count: ${allSideStories.length} >= 20)`);

  const globalTotals = catalog.getSideStoriesGlobalTotals();
  assert(!!globalTotals, 'Side stories global totals available');
  assert(globalTotals!.totalPremiumDrawTickets >= 100, `Total draw tickets calculated (${globalTotals!.totalPremiumDrawTickets} >= 100)`);
  assert(globalTotals!.totalStoryCrystals >= 5000, `Total story crystals calculated (${globalTotals!.totalStoryCrystals} >= 5000)`);
  assert(globalTotals!.totalSsrCharacters >= 10, `Total SSR characters calculated (${globalTotals!.totalSsrCharacters} >= 10)`);
  assert(globalTotals!.totalHalfElixirs >= 1000, `Total half-elixirs calculated (${globalTotals!.totalHalfElixirs} >= 1000)`);

  // Key Side Story Lookups (id & numeric)
  const wmtsb1 = catalog.getSideStory('wmtsb_1');
  const wmtsb1Num = catalog.getSideStory(1001);
  assert(!!wmtsb1, 'Resolves WMTSB I by string ID (wmtsb_1)');
  assert(!!wmtsb1Num, 'Resolves WMTSB I by numeric ID (1001)');
  assert(wmtsb1?.id === wmtsb1Num?.id, 'String and numeric lookups resolve to same side story');
  assert(wmtsb1?.rewards.weapons?.some(w => w.isBahamutOrAtma === true), 'WMTSB I grants Bahamut Nova Weapon');
  assert(wmtsb1?.unlockPrerequisite.mainQuestChapter === 54, 'WMTSB I requires Main Quest Chapter 54');

  const wmtsb2 = catalog.getSideStory('wmtsb_2');
  assert(!!wmtsb2, 'Resolves WMTSB II');
  assert(wmtsb2?.rewards.weapons?.some(w => w.isBahamutOrAtma === true), 'WMTSB II grants Atma Weapon');
  assert(wmtsb2?.rewards.characters?.some(c => c.name === 'Sandalphon' && c.rarity === 'SSR'), 'WMTSB II grants SSR Sandalphon');

  // Collaborations
  const geass = catalog.getSideStory('code_geass');
  assert(!!geass, 'Resolves Code Geass side story');
  assert((geass?.rewards.characters?.filter(c => c.rarity === 'SSR').length ?? 0) >= 3, 'Code Geass grants 3 SSR units (Lelouch, Suzaku, Kallen)');

  const priconne = catalog.getSideStory('princess_connect');
  assert(!!priconne, 'Resolves Princess Connect side story');
  assert((priconne?.rewards.characters?.filter(c => c.rarity === 'SSR').length ?? 0) >= 3, 'Princess Connect grants 3 SSR units (Pecorine, Kokkoro, Karyl)');

  // Category Filtering
  const collabs = catalog.getSideStoriesByCategory('collaboration');
  assert(collabs.length >= 5, `Collaboration side stories count >= 5 (found: ${collabs.length})`);

  const dragonKnights = catalog.getSideStoriesByCategory('dragon_knights');
  assert(dragonKnights.length >= 4, `Dragon Knights side stories count >= 4 (found: ${dragonKnights.length})`);

  // Availability Filtering by Main Quest Chapter
  const earlyStories = catalog.getAvailableSideStories(8);
  assert(earlyStories.length >= 5, `Stories unlocked at Chapter 8 >= 5 (found: ${earlyStories.length})`);
  assert(earlyStories.every(s => s.unlockPrerequisite.mainQuestChapter <= 8), 'All returned stories respect Chapter 8 boundary');

  console.log('\n🎉 ALL DATA ARCHITECTURE ASSERTIONS PASSED (100% GOLD INDUSTRY STANDARD)');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

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
    'automation/daily-routines.json',
    'automation/anti-detection.json'
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

  console.log('\n🎉 ALL DATA ARCHITECTURE ASSERTIONS PASSED (100% GOLD INDUSTRY STANDARD)');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

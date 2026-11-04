// tests/test-gold-bar-tracker.ts
import fs from 'fs';
import path from 'path';
import { DropLogger } from '../src/engines/drop-logger.js';

console.log('========================================================================');
console.log('       Granblue Fantasy Suite - Gold Bar Tracker & URL Test             ');
console.log('========================================================================\n');

const tempLogDir = path.resolve(process.cwd(), 'artifacts', 'test-goldbar');
if (!fs.existsSync(tempLogDir)) {
  fs.mkdirSync(tempLogDir, { recursive: true });
}
const tempLogFile = path.resolve(tempLogDir, 'test-gold-bar-log.md');

try {
  // Clean up any stale test file
  if (fs.existsSync(tempLogFile)) fs.unlinkSync(tempLogFile);

  console.log('1. Testing DropLogger initialization and empty stats...');
  const logger = new DropLogger(tempLogFile, 'Proto Bahamut HL (Test)');
  const stats0 = logger.getStats();
  if (stats0.totalBattles !== 0 || stats0.goldBars !== 0) {
    throw new Error(`Expected 0 battles, got ${stats0.totalBattles}`);
  }
  console.log('   ✅ Initial empty state validated');

  console.log('\n2. Logging regular battles without Gold Bar...');
  logger.logBattle({
    raidId: '46933001111',
    turns: 4,
    honors: '1,520,000 pt',
    targetMet: true,
    hasGoldBar: false,
  });

  logger.logBattle({
    raidId: '46933002222',
    turns: 5,
    honors: '1,490,000 pt',
    targetMet: true,
    hasGoldBar: false,
  });

  const stats1 = logger.getStats();
  if (stats1.totalBattles !== 2 || stats1.currentDryStreak !== 2) {
    throw new Error(`Expected 2 battles and 2 dry streak, got ${stats1.totalBattles} / ${stats1.currentDryStreak}`);
  }
  console.log('   ✅ Normal battles logged and dry streak tracked (streak = 2)');

  console.log('\n3. Logging Gold Bar drop event (Item 20004)...');
  const dummyScreenshot = path.resolve(tempLogDir, 'proof-46933003333.png');
  fs.writeFileSync(dummyScreenshot, 'dummy-png-data');

  logger.logBattle({
    raidId: '46933003333',
    turns: 3,
    honors: '1,840,000 pt',
    targetMet: true,
    hasGoldBar: true,
    screenshotPath: dummyScreenshot,
  });

  const stats2 = logger.getStats();
  if (stats2.goldBars !== 1 || stats2.currentDryStreak !== 0) {
    throw new Error(`Expected 1 gold bar and streak reset to 0, got ${stats2.goldBars} / ${stats2.currentDryStreak}`);
  }
  console.log('   ✅ Gold bar drop recorded and dry streak reset to 0');

  console.log('\n4. Verifying Markdown generation, clickable Battle URL, and 20004 image tag...');
  const mdContent = fs.readFileSync(tempLogFile, 'utf-8');

  // Verify Gold Bar Hall of Fame
  if (!mdContent.includes('Gold Bar Drops Hall of Fame')) {
    throw new Error('Expected markdown to contain "Gold Bar Drops Hall of Fame" section');
  }

  // Verify Battle Log URL
  if (!mdContent.includes('https://game.granbluefantasy.jp/#result_multi/46933003333')) {
    throw new Error('Expected markdown to include direct Battle Log URL');
  }

  // Verify Item 20004 image embed
  if (!mdContent.includes('20004.jpg')) {
    throw new Error('Expected markdown to include item 20004 image thumbnail embed');
  }

  // Verify Clickable raidId markdown link
  if (!mdContent.includes('[46933001111](https://game.granbluefantasy.jp/#result_multi/46933001111)')) {
    throw new Error('Expected table cell to format raidId as clickable markdown link');
  }

  console.log('   ✅ Markdown file contains Hall of Fame, Battle Log URLs, and 20004 icon embeds');

  console.log('\n5. Testing reload and backwards-compatible parsing of generated Markdown...');
  const reloadedLogger = new DropLogger(tempLogFile, 'Proto Bahamut HL (Test)');
  const reloadedStats = reloadedLogger.getStats();

  if (reloadedStats.totalBattles !== 3 || reloadedStats.goldBars !== 1) {
    throw new Error(`Expected 3 total battles and 1 gold bar after reload, got ${reloadedStats.totalBattles} / ${reloadedStats.goldBars}`);
  }
  console.log('   ✅ Log file successfully parsed back without loss of battle URLs or drop counts');

  console.log('\n6. Testing pending battle Gold Bar discovery (recordPendingGoldBar)...');
  reloadedLogger.recordPendingGoldBar('46933002222', dummyScreenshot);
  const statsPending = reloadedLogger.getStats();
  if (statsPending.goldBars !== 2) {
    throw new Error(`Expected 2 gold bars after retroactively claiming pending battle, got ${statsPending.goldBars}`);
  }
  console.log('   ✅ Retroactive pending battle Gold Bar claim verified');

  console.log('\n7. Testing Blue Chest dry streak vs battle dry streak distinction...');
  const blueChestTestFile = path.resolve(tempLogDir, 'test-blue-chest-log.md');
  if (fs.existsSync(blueChestTestFile)) fs.unlinkSync(blueChestTestFile);
  const bcJsonl = blueChestTestFile.replace(/\.md$/, '.jsonl');
  if (fs.existsSync(bcJsonl)) fs.unlinkSync(bcJsonl);

  const bcLogger = new DropLogger(blueChestTestFile, 'Akasha HL', { dryStreakMode: 'blue_chest' });

  // Run 1: Earned Blue Chest (1.5M honors)
  bcLogger.logBattle({ raidId: '10001', turns: 3, honors: '1,550,000 pt', targetMet: true, hasBlueChest: true, hasGoldBar: false });
  // Run 2: Failed/Wiped raid (0 honors, no blue chest)
  bcLogger.logBattle({ raidId: '10002', turns: 1, honors: '50,000 pt', targetMet: false, hasBlueChest: false, hasGoldBar: false });
  // Run 3: Earned Blue Chest (1.6M honors)
  bcLogger.logBattle({ raidId: '10003', turns: 4, honors: '1,620,000 pt', targetMet: true, hasBlueChest: true, hasGoldBar: false });

  const bcStats = bcLogger.getStats();
  // Total battles = 3, but Blue Chests = 2!
  if (bcStats.totalBattles !== 3) {
    throw new Error(`Expected 3 total battles, got ${bcStats.totalBattles}`);
  }
  if (bcStats.blueChests !== 2) {
    throw new Error(`Expected 2 blue chests, got ${bcStats.blueChests}`);
  }
  // Because dryStreakMode is 'blue_chest', currentDryStreak must be 2 (blue chests), NOT 3 (battles)!
  if (bcStats.currentDryStreak !== 2) {
    throw new Error(`Expected blue chest dry streak of 2, got ${bcStats.currentDryStreak}`);
  }
  if (bcStats.currentDryStreakAllBattles !== 3) {
    throw new Error(`Expected total battle dry streak of 3, got ${bcStats.currentDryStreakAllBattles}`);
  }
  console.log('   ✅ Blue Chest tracking correctly distinguishes between blue chest dry streak (2) and battle streak (3)');

  console.log('\n8. Testing configurable DryStreakMode options (all_battles vs min_honor vs blue_chest)...');
  const allBattlesLogger = new DropLogger(blueChestTestFile, 'Akasha HL', { dryStreakMode: 'all_battles' });
  const allStats = allBattlesLogger.getStats();
  if (allStats.currentDryStreak !== 3) {
    throw new Error(`Expected all_battles dry streak of 3, got ${allStats.currentDryStreak}`);
  }

  const minHonorLogger = new DropLogger(blueChestTestFile, 'Akasha HL', { dryStreakMode: 'min_honor' });
  const minHonorStats = minHonorLogger.getStats();
  if (minHonorStats.currentDryStreak !== 2) {
    throw new Error(`Expected min_honor dry streak of 2, got ${minHonorStats.currentDryStreak}`);
  }
  console.log('   ✅ Configurable dryStreakMode successfully switches between blue_chest, min_honor, and all_battles');

  console.log('\n9. Testing Discord Presence Activity formatting...');
  const { discordPresence } = await import('../src/relay/discord-presence.js');
  discordPresence.setMode('gbf', undefined, false);

  const activityAkasha = discordPresence.formatActivityData({
    raidName: 'Akasha HL',
    runNumber: 152,
    goldBars: 2,
    blueChests: 120,
    dryStreak: 45,
    dryStreakMode: 'blue_chest',
    honors: 1620000,
    status: 'In Combat',
    turn: 3
  });

  if (activityAkasha.name !== 'Raid Akasha 152 - 2 GB Drop') {
    throw new Error(`Expected name 'Raid Akasha 152 - 2 GB Drop', got '${activityAkasha.name}'`);
  }
  if (!activityAkasha.state.includes('💎 Blue: 120 (Dry: 45)') || !activityAkasha.state.includes('1.62M honors')) {
    throw new Error(`Unexpected activity state string: '${activityAkasha.state}'`);
  }
  console.log(`   ✅ Discord Status Activity Name: "${activityAkasha.name}"`);
  console.log(`   ✅ Discord Status Activity Details: "${activityAkasha.details}"`);
  console.log(`   ✅ Discord Status Activity State: "${activityAkasha.state}"`);

  console.log('\n10. Testing backwards-compatible parsing of legacy 8-column log with honors threshold inference...');
  const legacy8ColFile = path.resolve(tempLogDir, 'legacy-8col-log.md');
  const legacy8ColContent = [
    '# Akasha HL - Gold Bar Drop Log',
    '',
    '| Run # | Timestamp | Raid ID | Turns | Honors | Target Met? | Gold Bar Found? | Battles Without GB |',
    '| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |',
    '| 1 | 2026-03-01 12:00:00 | 46911111111 | 4 | 1,550,000 pt | ✅ Yes | ❌ No | 1 |',
    '| 2 | 2026-03-01 12:05:00 | 46922222222 | 1 | 100,000 pt | ⚠️ No | ❌ No | 2 |',
    '| 3 | 2026-03-01 12:10:00 | 46933333333 | 3 | 1,600,000 pt | ✅ Yes | ❌ No | 3 |'
  ].join('\n');
  fs.writeFileSync(legacy8ColFile, legacy8ColContent, 'utf-8');
  const legacyJsonl = legacy8ColFile.replace(/\.md$/, '.jsonl');
  if (fs.existsSync(legacyJsonl)) fs.unlinkSync(legacyJsonl);

  const legacyLogger = new DropLogger(legacy8ColFile, 'Akasha HL', { dryStreakMode: 'blue_chest' });
  const legacyStats = legacyLogger.getStats();
  if (legacyStats.totalBattles !== 3) {
    throw new Error(`Expected 3 total battles from legacy 8-col log, got ${legacyStats.totalBattles}`);
  }
  if (legacyStats.blueChests !== 2) {
    throw new Error(`Expected 2 inferred blue chests from legacy 8-col log, got ${legacyStats.blueChests}`);
  }
  if (legacyStats.currentDryStreak !== 2) {
    throw new Error(`Expected blue chest dry streak of 2 from legacy 8-col log, got ${legacyStats.currentDryStreak}`);
  }
  console.log('   ✅ Legacy 8-column table parsed flawlessly with blue chest dry streak inference');

  console.log('\n11. Testing strict Gold Bar payload & HTML detection against false positives (Rupies 118520004, EXP, damage, treasure footer)...');
  const { LootTrackerService } = await import('../src/services/telemetry/loot-tracker.service.js');

  // False positive vector #1: Raid 47019788714 payload where player Rupies ("118520004") contains "20004" and Blue Chest (11) has Hollow Key (10_534)
  const akashaFalsePositivePayload = {
    user_point: 1413109,
    gold: {
      before_gold: '118520004',
      after_gold: '118520592',
      get_gold: 588
    },
    exp: {
      before_exp: '99200041',
      after_exp: '99201100'
    },
    rewards: {
      reward_list: {
        '3': {
          '10_534': { item_id: '534', item_kind: '10', name: 'Hollow Key', count: '2' },
          '10_5471': { item_id: '5471', item_kind: '10', name: 'Silver Centrum', count: '1' }
        },
        '11': {
          '10_534': { item_id: '534', item_kind: '10', name: 'Hollow Key', count: '1' }
        }
      }
    }
  };
  if (LootTrackerService.hasGoldBarInPayload(akashaFalsePositivePayload)) {
    throw new Error('False positive! Payload with before_gold "118520004" and Hollow Key must NOT trigger Gold Bar detection');
  }

  // False positive vector #2: Non-evolution item_kind with id 20004
  const wrongItemKindPayload = {
    rewards: {
      reward_list: {
        '3': {
          '10_20004': { item_id: '20004', item_kind: '10', name: 'Some Other Material', count: '1' }
        }
      }
    }
  };
  if (LootTrackerService.hasGoldBarInPayload(wrongItemKindPayload)) {
    throw new Error('False positive! item_kind "10" with id "20004" must NOT trigger Gold Bar detection');
  }

  // True positive vector #1: Genuine Gold Brick in Blue Chest (key 17_20004)
  const genuineGoldBrickPayload = {
    rewards: {
      reward_list: {
        '11': {
          '17_20004': { item_id: '20004', item_kind: '17', name: 'Gold Brick', count: '1' }
        }
      }
    }
  };
  if (!LootTrackerService.hasGoldBarInPayload(genuineGoldBrickPayload)) {
    throw new Error('True positive missed! Genuine 17_20004 Gold Brick in reward_list must return true');
  }

  // True positive vector #2: Genuine Gold Bar in array reward_list
  const genuineArrayPayload = {
    rewards: {
      reward_list: [
        { item_id: '20004', item_kind: '17', name: 'ヒヒイロカネ' }
      ]
    }
  };
  if (!LootTrackerService.hasGoldBarInPayload(genuineArrayPayload)) {
    throw new Error('True positive missed! Genuine Gold Bar in array reward_list must return true');
  }

  console.log('   ✅ Strict Gold Bar payload validator rejected Rupies/EXP/wrong-kind false positives and confirmed genuine 17_20004 drops');

  console.log('\n12. Testing Eternity Sand (刻の流砂, Item 215, Kind 10) payload, HTML, DropLogger, and EternitySandTrackerService...');
  const { EternitySandTrackerService } = await import('../src/services/telemetry/eternity-sand-tracker.service.js');

  // False positive vector #1: Rupies/EXP/honors containing "215" and article_list inventory summary containing 10_215
  const sandFalsePositivePayload = {
    user_point: 4215000,
    gold: { before_gold: '118521500', after_gold: '118522000' },
    exp: { before_exp: '99215000', after_exp: '99216000' },
    article_list: {
      '10_215': { item_id: '215', item_kind: '10', name: 'Eternity Sand', count: '5' }
    },
    rewards: {
      article_list: {
        '10_215': { item_id: '215', item_kind: '10', name: '刻の流砂', count: '5' }
      },
      reward_list: {
        '4': {
          '10_581': { item_id: '581', item_kind: '10', name: "Seofon's Distinction", count: '3' }
        }
      }
    }
  };
  if (LootTrackerService.hasEternitySandInPayload(sandFalsePositivePayload)) {
    throw new Error('False positive! Payload with 215 in Rupies/EXP/honors or article_list inventory must NOT trigger Eternity Sand detection');
  }

  // False positive vector #2: Wrong item_kind (17 instead of 10) for item_id 215
  const sandWrongKindPayload = {
    rewards: {
      reward_list: {
        '3': {
          '17_215': { item_id: '215', item_kind: '17', name: 'Some Other Item', count: '1' }
        }
      }
    }
  };
  if (LootTrackerService.hasEternitySandInPayload(sandWrongKindPayload)) {
    throw new Error('False positive! item_kind "17" with id "215" must NOT trigger Eternity Sand detection');
  }

  // False positive vector #3: HTML with 215.jpg inside .prt-treasure-wrapper footer
  const sandFooterHtml = '<div class="prt-treasure-wrapper"><img src="https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img/sp/assets/item/article/s/215.jpg" /><span>5</span></div>';
  if (LootTrackerService.hasEternitySandInHtml(sandFooterHtml)) {
    throw new Error('False positive! .prt-treasure-wrapper footer containing 215.jpg must NOT trigger Eternity Sand detection');
  }

  // True positive vector #1: Genuine Eternity Sand in Blue Chest (key 10_215)
  const genuineSandPayload = {
    rewards: {
      reward_list: {
        '11': {
          '10_215': { item_id: '215', item_kind: '10', name: 'Eternity Sand', count: '1' }
        }
      }
    }
  };
  if (!LootTrackerService.hasEternitySandInPayload(genuineSandPayload)) {
    throw new Error('True positive missed! Genuine 10_215 Eternity Sand in reward_list must return true');
  }

  // True positive vector #2: Genuine Eternity Sand in HTML reward container
  const genuineSandHtml = '<div class="prt-item-list"><div class="lis-treasure" data-key="10_215"><img class="img-item" src="https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img/sp/assets/item/article/s/215.jpg" /></div></div>';
  if (!LootTrackerService.hasEternitySandInHtml(genuineSandHtml)) {
    throw new Error('True positive missed! Genuine 10_215 Eternity Sand in .prt-item-list HTML must return true');
  }

  // Verify DropLogger Eternity Sand logging & Hall of Fame
  const sandLogFile = path.resolve(tempLogDir, 'test-eternity-sand-log.md');
  if (fs.existsSync(sandLogFile)) fs.unlinkSync(sandLogFile);
  const sandJsonl = sandLogFile.replace(/\.md$/, '.jsonl');
  if (fs.existsSync(sandJsonl)) fs.unlinkSync(sandJsonl);

  const sandDropLogger = new DropLogger(sandLogFile, 'Seofon (Impossible)');
  sandDropLogger.logBattle({
    raidId: '47099887766',
    turns: 5,
    honors: '4,120,000 pt',
    targetMet: true,
    hasBlueChest: true,
    hasGoldBar: false,
    hasEternitySand: true,
    screenshotPath: dummyScreenshot,
  });

  const sandStats = sandDropLogger.getStats();
  if (sandStats.eternitySands !== 1) {
    throw new Error(`Expected 1 Eternity Sand in DropLogger stats, got ${sandStats.eternitySands}`);
  }
  const sandMd = fs.readFileSync(sandLogFile, 'utf-8');
  if (!sandMd.includes('Eternity Sand Drops Hall of Fame') || !sandMd.includes('item/article/s/215.jpg')) {
    throw new Error('Expected DropLogger markdown to include Eternity Sand Drops Hall of Fame and item/article/s/215.jpg icon');
  }

  // Verify EternitySandTrackerService isolated ledger
  const sandLedgerDir = path.resolve(tempLogDir, 'sand-ledger');
  const sandTracker = new EternitySandTrackerService(sandLedgerDir);
  const recordedSand = sandTracker.recordDrop({
    raidId: '47099887766',
    questName: 'Seofon (Impossible)',
    honors: '4,120,000 pt',
    turns: 5,
    source: 'Blue Chest',
    accountName: 'TestDanchou',
    sendDiscord: false
  });
  if (!recordedSand || sandTracker.getLifetimeStats().totalEternitySands !== 1) {
    throw new Error('Expected EternitySandTrackerService to record 1 Eternity Sand drop');
  }
  const sandReadme = fs.readFileSync(path.join(sandLedgerDir, 'README.md'), 'utf-8');
  if (!sandReadme.includes('item/article/s/215.jpg') || !sandReadme.includes('47099887766')) {
    throw new Error('Expected EternitySandTrackerService README.md to contain 215.jpg icon and raid ID');
  }
  console.log('   ✅ Eternity Sand (10_215 / 刻の流砂 / 215.jpg) payload, HTML, DropLogger, and EternitySandTrackerService verified');

  console.log('\n========================================================================');
  console.log('  🎉 ALL GOLD BAR TRACKER & URL INTEGRATION TESTS PASSED 100%!         ');
  console.log('========================================================================\n');
} finally {
  try {
    const { discordPresence } = await import('../src/relay/discord-presence.js');
    discordPresence.shutdown();
  } catch {}

  try {
    if (fs.existsSync(tempLogFile)) fs.unlinkSync(tempLogFile);
    const jsonl = tempLogFile.replace(/\.md$/, '.jsonl');
    if (fs.existsSync(jsonl)) fs.unlinkSync(jsonl);
    const bcFile = path.resolve(tempLogDir, 'test-blue-chest-log.md');
    if (fs.existsSync(bcFile)) fs.unlinkSync(bcFile);
    const bcJsonl = bcFile.replace(/\.md$/, '.jsonl');
    if (fs.existsSync(bcJsonl)) fs.unlinkSync(bcJsonl);
    const legacyFile = path.resolve(tempLogDir, 'legacy-8col-log.md');
    if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
    const dummyPng = path.resolve(tempLogDir, 'proof-46933003333.png');
    if (fs.existsSync(dummyPng)) fs.unlinkSync(dummyPng);
    if (fs.existsSync(tempLogDir)) fs.rmSync(tempLogDir, { recursive: true, force: true });
  } catch {}
}

process.exit(0);

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

  console.log('\n========================================================================');
  console.log('  🎉 ALL GOLD BAR TRACKER & URL INTEGRATION TESTS PASSED 100%!         ');
  console.log('========================================================================\n');
} finally {
  try {
    if (fs.existsSync(tempLogFile)) fs.unlinkSync(tempLogFile);
    const jsonl = tempLogFile.replace(/\.md$/, '.jsonl');
    if (fs.existsSync(jsonl)) fs.unlinkSync(jsonl);
    const dummyPng = path.resolve(tempLogDir, 'proof-46933003333.png');
    if (fs.existsSync(dummyPng)) fs.unlinkSync(dummyPng);
    if (fs.existsSync(tempLogDir)) fs.rmdirSync(tempLogDir);
  } catch {}
}

// src/cli/test-presence.ts
import { DropLogger } from '../engines/drop-logger.js';
import { discordPresence } from '../relay/discord-presence.js';
import path from 'path';

const logPath = path.resolve('logs/gb-akasha.md');
const logger = new DropLogger(logPath, 'Akasha HL');
const stats = logger.getStats();
const lastRec = logger.getLastRecord();

console.log('=====================================================');
console.log('       Granblue Fantasy - Discord Live Status        ');
console.log('=====================================================');
console.log(`Raid:              Akasha HL`);
console.log(`Total Battles:     ${stats.totalBattles}`);
console.log(`Blue Chests:       ${stats.blueChests} (${stats.blueChestRatePct})`);
console.log(`Gold Bars:         ${stats.goldBars} (${stats.goldBarsToday} today)`);
console.log(`Dry Streak:        ${stats.currentDryStreak} ${stats.dryStreakMode === 'blue_chest' ? 'blue chests' : 'battles'}`);
console.log(`Last Honors:       ${lastRec?.honors || 'N/A'}`);
console.log('=====================================================\n');

discordPresence.updateStatus({
  raidName: 'Akasha',
  runNumber: stats.totalBattles,
  goldBars: stats.goldBars,
  goldBarsToday: stats.goldBarsToday,
  goldBarsSession: 0,
  blueChests: stats.blueChests,
  dryStreak: stats.currentDryStreak,
  dryStreakMode: stats.dryStreakMode,
  honors: lastRec?.honors || 0,
  status: 'Raid Akasha',
}, true);

console.log('📡 Live Discord status broadcasted to Bot Gateway & Desktop IPC!');
console.log(`• Status Name: "Raid Akasha ${stats.totalBattles} - ${stats.goldBars} GB Drop"`);
console.log(`• Details:     "Raid Akasha"`);
console.log(`• Activity:    "💎 Blue: ${stats.blueChests} (Dry: ${stats.currentDryStreak}) | 🌟 Today: ${stats.goldBarsToday} | ${lastRec?.honors || ''}"`);
console.log('\n(Holding connection open so you can inspect Discord. Press Ctrl+C to exit)');

// Keep process alive so gateway session remains active
setInterval(() => {}, 10000);

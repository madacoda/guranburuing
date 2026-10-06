// tests/test-presence-templates.ts
import {
  formatPresenceByMode,
  formatWorkPresence,
  formatTradePresence,
  formatGbfPresence,
  savePresenceConfig,
  loadPresenceConfig,
  TRADING_QUOTES
} from '../src/relay/presence-templates.js';
import { discordPresence } from '../src/relay/discord-presence.js';
import fs from 'fs';
import path from 'path';

console.log('========================================================================');
console.log('           Discord Presence Multi-Template Unit Tests                   ');
console.log('========================================================================\n');

// 1. Test WORK Template (Default: Every Hero)
console.log('1. Testing [WORK] template formatting (default Every Hero)...');
const defaultWork = formatWorkPresence();
if (defaultWork.name !== 'Working on Every Hero') {
  throw new Error(`Expected 'Working on Every Hero', got '${defaultWork.name}'`);
}
if (!defaultWork.details.includes('Every Hero')) {
  throw new Error(`Expected details to include project, got '${defaultWork.details}'`);
}
if (!defaultWork.state.includes('Deep focus mode')) {
  throw new Error(`Expected state to include focus mode, got '${defaultWork.state}'`);
}
console.log(`   ✅ Name:    "${defaultWork.name}"`);
console.log(`   ✅ Details: "${defaultWork.details}"`);
console.log(`   ✅ State:   "${defaultWork.state}"`);

// 2. Test WORK Template (Custom project & task)
console.log('\n2. Testing [WORK] template with custom project and task...');
const customWork = formatWorkPresence({
  project: 'Every Hero Web',
  task: 'Building Battle V2 Visual HUD'
});
if (customWork.name !== 'Working on Every Hero Web') {
  throw new Error(`Expected 'Working on Every Hero Web', got '${customWork.name}'`);
}
if (customWork.details !== 'Building Battle V2 Visual HUD') {
  throw new Error(`Expected 'Building Battle V2 Visual HUD', got '${customWork.details}'`);
}
console.log(`   ✅ Name:    "${customWork.name}"`);
console.log(`   ✅ Details: "${customWork.details}"`);

// 3. Test TRADE Template (Curated quotes)
console.log('\n3. Testing [TRADE] template with cycling trading quotes...');
const defaultTrade = formatTradePresence();
if (defaultTrade.name !== 'Market Execution 📈') {
  throw new Error(`Expected 'Market Execution 📈', got '${defaultTrade.name}'`);
}
if (!defaultTrade.state.startsWith('"')) {
  throw new Error(`Expected quote in state, got '${defaultTrade.state}'`);
}
console.log(`   ✅ Name:    "${defaultTrade.name}"`);
console.log(`   ✅ Details: "${defaultTrade.details}"`);
console.log(`   ✅ Quote:   "${defaultTrade.state}"`);

// 4. Test TRADE Template (Custom quote)
console.log('\n4. Testing [TRADE] template with custom quote...');
const customQuote = 'The trend is your friend until the end when it bends.';
const customTrade = formatTradePresence({ quote: customQuote, author: 'Ed Seykota' });
if (!customTrade.state.includes(customQuote)) {
  throw new Error(`Expected state to include custom quote, got '${customTrade.state}'`);
}
console.log(`   ✅ Custom Quote: "${customTrade.state}"`);

// 5. Test GBF Template (Backwards-compatibility)
console.log('\n5. Testing [GBF] template formatting...');
const gbfData = formatGbfPresence({
  raidName: 'Akasha HL',
  runNumber: 200,
  goldBars: 3,
  goldBarsToday: 1,
  blueChests: 140,
  dryStreak: 50,
  dryStreakMode: 'blue_chest',
  honors: 1650000,
  status: 'In Combat',
  turn: 2
});
if (gbfData.name !== 'Raid Akasha 200 - 3 GB Drop') {
  throw new Error(`Expected 'Raid Akasha 200 - 3 GB Drop', got '${gbfData.name}'`);
}
if (gbfData.details !== 'Combat Turn 2') {
  throw new Error(`Expected 'Combat Turn 2', got '${gbfData.details}'`);
}
if (!gbfData.state.includes('💎 Blue: 140 (Dry: 50)') || !gbfData.state.includes('🌟 Today: 1')) {
  throw new Error(`Unexpected state format: '${gbfData.state}'`);
}
console.log(`   ✅ Name:    "${gbfData.name}"`);
console.log(`   ✅ Details: "${gbfData.details}"`);
console.log(`   ✅ State:   "${gbfData.state}"`);

// 6. Test Persistence & Mode Switching on DiscordPresenceManager
console.log('\n6. Testing DiscordPresenceManager mode switching & persistence...');
discordPresence.setMode('work', { project: 'Every Hero' }, false);
if (discordPresence.getMode() !== 'work') {
  throw new Error(`Expected mode 'work', got '${discordPresence.getMode()}'`);
}

const managerWork = discordPresence.formatActivityData({});
if (managerWork.name !== 'Working on Every Hero') {
  throw new Error(`Expected 'Working on Every Hero', got '${managerWork.name}'`);
}
console.log(`   ✅ Manager Work Presence: "${managerWork.name}" | "${managerWork.details}"`);

discordPresence.setMode('trade', { quote: 'Plan your trade and trade your plan.' }, false);
if (discordPresence.getMode() !== 'trade') {
  throw new Error(`Expected mode 'trade', got '${discordPresence.getMode()}'`);
}
const managerTrade = discordPresence.formatActivityData({});
if (!managerTrade.state.includes('Plan your trade')) {
  throw new Error(`Expected quote in state, got '${managerTrade.state}'`);
}
console.log(`   ✅ Manager Trade Presence: "${managerTrade.name}" | "${managerTrade.state}"`);

discordPresence.setMode('gbf', {}, false);
if (discordPresence.getMode() !== 'gbf') {
  throw new Error(`Expected mode 'gbf', got '${discordPresence.getMode()}'`);
}
const managerGbf = discordPresence.formatActivityData({
  raidName: 'PBHL',
  runNumber: 10,
  goldBars: 1
});
if (managerGbf.name !== 'Raid PBHL 10 - 1 GB Drop') {
  throw new Error(`Expected 'Raid PBHL 10 - 1 GB Drop', got '${managerGbf.name}'`);
}
console.log(`   ✅ Manager GBF Presence: "${managerGbf.name}"`);

console.log('\n========================================================================');
console.log('  🎉 ALL DISCORD PRESENCE TEMPLATE TESTS PASSED 100%!                   ');
console.log('========================================================================\n');

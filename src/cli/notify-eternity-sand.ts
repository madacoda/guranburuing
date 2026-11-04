// src/cli/notify-eternity-sand.ts
import path from 'path';
import fs from 'fs';
import { DropLogger } from '../engines/drop-logger.js';
import { discordDmRelay } from '../relay/discord-dm-relay.js';
import { discordPresence } from '../relay/discord-presence.js';
import { AccountRegistry } from '../auth/account-registry.js';

async function main() {
  const args = process.argv.slice(2);
  const positionalArgs = args.filter(a => !a.startsWith('-'));

  // Load accounts
  const accounts = AccountRegistry.loadAccounts();
  const account = accounts[0];
  const playerName = account ? account.name : '『Danchou』';

  // Determine raid target log (default to seofon, or check arg)
  let logFile = 'logs/raid-seofon.md';
  let raidTitle = 'Revans Raid - Seofon (Impossible)';
  let targetRaidId = '';

  for (const arg of positionalArgs) {
    if (/^\d{8,}$/.test(arg)) {
      targetRaidId = arg;
    } else if (arg.toLowerCase().includes('siete') || arg.toLowerCase().includes('seofon')) {
      logFile = 'logs/raid-seofon.md';
      raidTitle = 'Revans Raid - Seofon (Impossible)';
    } else if (arg.toLowerCase().includes('agastia')) {
      logFile = 'logs/raid-agastia.md';
      raidTitle = 'Revans Raid - Agastia (Impossible)';
    } else if (arg.toLowerCase().includes('world')) {
      logFile = 'logs/raid-the-world.md';
      raidTitle = 'The World (Impossible)';
    } else if (arg.toLowerCase().includes('wilnas')) {
      logFile = 'logs/raid-wilnas.md';
      raidTitle = 'Six-Dragon Raid - Wilnas (Impossible)';
    } else if (arg.toLowerCase().includes('fediel')) {
      logFile = 'logs/raid-fediel.md';
      raidTitle = 'Six-Dragon Raid - Fediel (Impossible)';
    } else if (arg.toLowerCase().includes('pbhl')) {
      logFile = 'logs/gb-pbhl.md';
      raidTitle = 'GB Farm - Proto Bahamut HL';
    } else if (arg.toLowerCase().includes('akasha')) {
      logFile = 'logs/gb-akasha.md';
      raidTitle = 'GB Farm - Akasha HL';
    }
  }

  const absLogPath = path.resolve(process.cwd(), logFile);
  if (!fs.existsSync(absLogPath)) {
    console.error(`❌ Log file not found: ${absLogPath}`);
    process.exit(1);
  }

  const dropLogger = new DropLogger(absLogPath, raidTitle);
  const records = dropLogger.getRecords();

  const shouldRecord = args.includes('--record');
  const useLatest = args.includes('--latest');

  if (!targetRaidId && useLatest) {
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].raidId && /^\d+$/.test(records[i].raidId)) {
        targetRaidId = records[i].raidId;
        break;
      }
    }
  }

  console.log('========================================================================');
  console.log('       ⏳ Granblue Fantasy - Eternity Sand Drop & Discord Dispatcher    ');
  console.log('========================================================================');
  console.log(`• Target Raid:      ${raidTitle}`);
  console.log(`• Target Raid ID:   ${targetRaidId || (useLatest ? 'Latest Battle' : 'N/A (Test Alert)')}`);
  console.log(`• Drop Log:         ${logFile}`);
  console.log(`• Mode:             ${shouldRecord ? 'RECORD (COMMITTING TO LOGS)' : 'TEST / DISPATCH ONLY'}`);
  console.log(`• Account:          ${playerName}`);
  console.log('========================================================================\n');

  let updatedStats = dropLogger.getStats();

  if (shouldRecord) {
    if (!targetRaidId) {
      console.error('❌ Cannot record Eternity Sand: Please provide a valid raid ID (e.g. `bun run notify:eternity-sand 47000629910 --record`) or specify `--latest`.');
      process.exit(1);
    }
    updatedStats = dropLogger.recordPendingEternitySand(targetRaidId);
    console.log(`✅ [DropLogger] Marked Eternity Sand in ${logFile}!`);
    console.log(`   - Total Eternity Sands: ${updatedStats.eternitySands}`);
    console.log(`   - Blue Chests:          ${updatedStats.blueChests}\n`);
  } else {
    console.log(`ℹ️ [Safe Mode] Battle log not modified. (Use \`--record <raidId>\` to commit a real drop to log files).\n`);
  }

  // Update Discord Presence
  discordPresence.updateStatus({
    raidName: raidTitle,
    goldBars: updatedStats.goldBars,
    blueChests: updatedStats.blueChests,
    dryStreak: updatedStats.currentDryStreak,
    dryStreakMode: updatedStats.dryStreakMode,
    status: 'Eternity Sand Dropped!'
  }, true);

  // Send Discord DM Notification
  if (!discordDmRelay.isConfigured()) {
    console.warn('⚠️ DISCORD_BOT_TOKEN and DISCORD_USER_ID are not configured in .env.');
    process.exit(0);
  }

  const battleUrl = targetRaidId && /^\d+$/.test(targetRaidId)
    ? `https://game.granbluefantasy.jp/#result_multi/detail/${targetRaidId}/1/0/0`
    : 'https://game.granbluefantasy.jp/#quest/assist';

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }) + ' (JST)';

  const content = [
    '⏳ **Eternity Sand (刻の流砂) Drop Confirmed** ⏳',
    `• **Raid**: ${raidTitle}`,
    targetRaidId ? `• **Raid ID**: \`${targetRaidId}\`` : '',
    `• **Battle Log**: ${battleUrl}`,
    `• **Timestamp**: ${timestamp}`,
    `• **Account**: ${playerName}`,
    `• **Total Eternity Sands**: ${updatedStats.eternitySands}`,
  ].filter(Boolean).join('\n');

  try {
    console.log('[DiscordRelay] 📤 Sending Eternity Sand notification to Discord DM...');
    const res = await discordDmRelay.sendMessage(
      content,
      undefined,
      `eternity-sand-${targetRaidId || 'drop'}.png`,
      undefined,
      true // force = true
    );
    console.log(`🎉 [DiscordRelay] ✅ Eternity Sand notification successfully delivered! (Message ID: ${res.id})\n`);
  } catch (err: any) {
    console.error('❌ Failed to send Discord notification:', err.message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

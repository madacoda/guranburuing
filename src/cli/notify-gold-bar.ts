// src/cli/notify-gold-bar.ts
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

  // Determine raid target log (default to akasha, or check arg)
  let logFile = 'logs/gb-akasha.md';
  let raidTitle = 'GB Farm - Akasha HL';
  let targetRaidId = '';

  for (const arg of positionalArgs) {
    if (/^\d{8,}$/.test(arg)) {
      targetRaidId = arg;
    } else if (arg.toLowerCase().includes('pbhl')) {
      logFile = 'logs/gb-pbhl.md';
      raidTitle = 'GB Farm - Proto Bahamut HL';
    } else if (arg.toLowerCase().includes('go')) {
      logFile = 'logs/gb-go.md';
      raidTitle = 'GB Farm - Grand Order HL';
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
    // Find the latest raid ID from records
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].raidId && /^\d+$/.test(records[i].raidId)) {
        targetRaidId = records[i].raidId;
        break;
      }
    }
  }

  console.log('========================================================================');
  console.log('         🌟 Granblue Fantasy - Gold Bar Drop & Discord Dispatcher       ');
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
      console.error('❌ Cannot record Gold Bar: Please provide a valid raid ID (e.g. `bun run notify:gold-bar 47000629910 --record`) or specify `--latest`.');
      process.exit(1);
    }
    updatedStats = dropLogger.recordPendingGoldBar(targetRaidId);
    console.log(`✅ [DropLogger] Marked Gold Bar in ${logFile}!`);
    console.log(`   - Total Gold Bars: ${updatedStats.goldBars}`);
    console.log(`   - Blue Chests:     ${updatedStats.blueChests}`);
    console.log(`   - Dry Streak Reset to: ${updatedStats.currentDryStreak}\n`);
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
    status: 'Gold Bar Dropped!'
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
    '🌟 **Gold Brick Drop Confirmed** 🌟',
    `• **Raid**: ${raidTitle}`,
    targetRaidId ? `• **Raid ID**: \`${targetRaidId}\`` : '',
    `• **Battle Log**: ${battleUrl}`,
    `• **Timestamp**: ${timestamp}`,
    `• **Account**: ${playerName}`,
    `• **Total Gold Bars**: ${updatedStats.goldBars}`,
  ].filter(Boolean).join('\n');

  try {
    console.log('[DiscordRelay] 📤 Sending Gold Bar notification to Discord DM...');
    const res = await discordDmRelay.sendMessage(
      content,
      undefined,
      `gold-bar-${targetRaidId || 'drop'}.png`,
      undefined,
      true // force = true
    );
    console.log(`🎉 [DiscordRelay] ✅ Gold Bar notification successfully delivered! (Message ID: ${res.id})\n`);
  } catch (err: any) {
    console.error('❌ Failed to send Discord notification:', err.message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

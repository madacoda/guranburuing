// src/cli/report-gold-bars.ts
import { goldBarTracker, GoldBarTrackerService } from '../services/telemetry/gold-bar-tracker.service.js';

async function main() {
  const args = process.argv.slice(2);
  const shouldBackfill = args.includes('--backfill');
  const shouldSendDiscord = args.includes('--discord');
  const dateArgIdx = args.indexOf('--date');
  const customDate = dateArgIdx !== -1 && args[dateArgIdx + 1] ? args[dateArgIdx + 1] : undefined;
  const removeArgIdx = args.indexOf('--remove');
  const removeRaidId = removeArgIdx !== -1 && args[removeArgIdx + 1] ? args[removeArgIdx + 1] : undefined;

  console.log('========================================================================');
  console.log('      🌟 Granblue Fantasy - Modular Gold Bar Tracker & Daily Ledger     ');
  console.log('========================================================================\n');

  if (removeRaidId) {
    console.log(`[Ledger] Removing raid ID ${removeRaidId} from Gold Bar records...`);
    const success = goldBarTracker.removeDrop(removeRaidId);
    if (success) {
      console.log(`✅ Successfully removed raid ID ${removeRaidId} and refreshed summary reports!\n`);
    } else {
      console.log(`⚠️ Raid ID ${removeRaidId} was not found in the ledger.\n`);
    }
    process.exit(0);
  }

  if (shouldBackfill) {
    console.log('[Backfill] Scanning logs for historical Gold Bar drops...');
    const count = await goldBarTracker.backfillFromLogs();
    console.log(`[Backfill] ✅ Imported / Verified ${count} Gold Bar records into master ledger!\n`);
  } else {
    // Automatically run quick initial backfill if master ledger is empty
    const existing = goldBarTracker.getMasterRecords();
    if (existing.length === 0) {
      console.log('[Init] Master ledger empty. Automatically syncing from existing raid logs...');
      const count = await goldBarTracker.backfillFromLogs();
      console.log(`[Init] ✅ Loaded ${count} historical drops!\n`);
    }
  }

  const currentGbfDay = customDate || GoldBarTrackerService.getGbfDay();
  const currentJstTime = GoldBarTrackerService.formatJstTimestamp();
  const summary = goldBarTracker.getDailySummary(currentGbfDay);
  const lifetime = goldBarTracker.getLifetimeStats();

  console.log(`📅 GBF Server Day (05:00 JST Reset): ${currentGbfDay}`);
  console.log(`⏰ Current Server Time:               ${currentJstTime}`);
  console.log(`🌟 Gold Bars Dropped Today:          ${summary.goldBarsCount}`);
  console.log(`📆 Gold Bars Last 7 Days:            ${lifetime.goldBarsThisWeek}`);
  console.log(`🏆 Lifetime Total Gold Bars:          ${lifetime.totalGoldBars}\n`);

  console.log('------------------------------------------------------------------------');
  console.log(`  TODAY\'S GOLD BAR DROPS (${currentGbfDay} JST)`);
  console.log('------------------------------------------------------------------------');

  if (summary.drops.length === 0) {
    console.log('  (No Gold Bar drops recorded yet for today\'s GBF server day)\n');
  } else {
    summary.drops.forEach((d, idx) => {
      console.log(`[Drop #${idx + 1}]`);
      console.log(`  • Raid:         ${d.questName}`);
      console.log(`  • Raid ID:      ${d.raidId}`);
      console.log(`  • Time (JST):   ${d.timestampJst}`);
      console.log(`  • Honors:       ${d.honors} (Turns: ${d.turns})`);
      console.log(`  • Source:       ${d.source}`);
      console.log(`  • Battle Log:   ${d.battleUrl}`);
      if (d.screenshotPath) console.log(`  • Proof:        ${d.screenshotPath}`);
      console.log('');
    });
  }

  console.log('------------------------------------------------------------------------');
  console.log('  RECENT 7-DAY SUMMARY (GBF Server Days)');
  console.log('------------------------------------------------------------------------');
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    const dayStr = GoldBarTrackerService.getGbfDay(d);
    const count = lifetime.dropsByDay[dayStr] || 0;
    const isToday = dayStr === currentGbfDay ? ' (TODAY)' : '';
    const barStr = count > 0 ? `🌟 ${count} Gold Bar${count > 1 ? 's' : ''}` : '0';
    console.log(`  • ${dayStr}${isToday.padEnd(8)}: ${barStr}`);
  }
  console.log('------------------------------------------------------------------------\n');

  console.log('📁 Data Storage:');
  console.log('  • Master Ledger:   logs/gold-bars/gold-bar-ledger.json');
  console.log(`  • Daily Ledger:    logs/gold-bars/daily/gold-bars-${currentGbfDay}.json`);
  console.log('  • Markdown Report: logs/gold-bars/README.md\n');

  if (shouldSendDiscord) {
    console.log('[Discord] Dispatching Daily Summary digest to Discord...');
    await goldBarTracker.dispatchDailySummaryToDiscord(currentGbfDay);
  }
}

main().catch(err => {
  console.error('Fatal error in report-gold-bars:', err);
  process.exit(1);
});

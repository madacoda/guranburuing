// src/cli/report-eternity-sands.ts
import { eternitySandTracker, EternitySandTrackerService } from '../services/telemetry/eternity-sand-tracker.service.js';

async function main() {
  const args = process.argv.slice(2);
  const shouldBackfill = args.includes('--backfill');
  const shouldSendDiscord = args.includes('--discord');
  const dateArgIdx = args.indexOf('--date');
  const customDate = dateArgIdx !== -1 && args[dateArgIdx + 1] ? args[dateArgIdx + 1] : undefined;
  const removeArgIdx = args.indexOf('--remove');
  const removeRaidId = removeArgIdx !== -1 && args[removeArgIdx + 1] ? args[removeArgIdx + 1] : undefined;

  console.log('========================================================================');
  console.log('     ⏳ Granblue Fantasy - Modular Eternity Sand Tracker & Ledger       ');
  console.log('========================================================================\n');

  if (removeRaidId) {
    console.log(`[Ledger] Removing raid ID ${removeRaidId} from Eternity Sand records...`);
    const success = eternitySandTracker.removeDrop(removeRaidId);
    if (success) {
      console.log(`✅ Successfully removed raid ID ${removeRaidId} and refreshed summary reports!\n`);
    } else {
      console.log(`⚠️ Raid ID ${removeRaidId} was not found in the ledger.\n`);
    }
    process.exit(0);
  }

  if (shouldBackfill) {
    console.log('[Backfill] Scanning logs for historical Eternity Sand drops...');
    const count = await eternitySandTracker.backfillFromLogs();
    console.log(`[Backfill] ✅ Imported / Verified ${count} Eternity Sand records into master ledger!\n`);
  } else {
    const existing = eternitySandTracker.getMasterRecords();
    if (existing.length === 0) {
      console.log('[Init] Master ledger empty. Automatically syncing from existing raid logs...');
      const count = await eternitySandTracker.backfillFromLogs();
      console.log(`[Init] ✅ Loaded ${count} historical drops!\n`);
    }
  }

  const currentGbfDay = customDate || EternitySandTrackerService.getGbfDay();
  const currentJstTime = EternitySandTrackerService.formatJstTimestamp();
  const summary = eternitySandTracker.getDailySummary(currentGbfDay);
  const lifetime = eternitySandTracker.getLifetimeStats();

  console.log(`📅 GBF Server Day (05:00 JST Reset): ${currentGbfDay}`);
  console.log(`⏰ Current Server Time:               ${currentJstTime}`);
  console.log(`⏳ Eternity Sands Dropped Today:      ${summary.eternitySandsCount}`);
  console.log(`📆 Eternity Sands Last 7 Days:        ${lifetime.eternitySandsThisWeek}`);
  console.log(`🏆 Lifetime Total Eternity Sands:     ${lifetime.totalEternitySands}\n`);

  console.log('------------------------------------------------------------------------');
  console.log(`  TODAY'S ETERNITY SAND DROPS (${currentGbfDay} JST)`);
  console.log('------------------------------------------------------------------------');

  if (summary.drops.length === 0) {
    console.log('  (No Eternity Sand drops recorded yet for today\'s GBF server day)\n');
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
    const dayStr = EternitySandTrackerService.getGbfDay(d);
    const count = lifetime.dropsByDay[dayStr] || 0;
    const isToday = dayStr === currentGbfDay ? ' (TODAY)' : '';
    const sandStr = count > 0 ? `⏳ ${count} Eternity Sand${count > 1 ? 's' : ''}` : '0';
    console.log(`  • ${dayStr}${isToday.padEnd(8)}: ${sandStr}`);
  }
  console.log('------------------------------------------------------------------------\n');

  console.log('📁 Data Storage:');
  console.log('  • Master Ledger:   logs/eternity-sands/eternity-sand-ledger.json');
  console.log(`  • Daily Ledger:    logs/eternity-sands/daily/eternity-sands-${currentGbfDay}.json`);
  console.log('  • Markdown Report: logs/eternity-sands/README.md\n');

  if (shouldSendDiscord) {
    console.log('[Discord] Dispatching Daily Summary digest to Discord...');
    await eternitySandTracker.dispatchDailySummaryToDiscord(currentGbfDay);
  }
}

main().catch(err => {
  console.error('Fatal error in report-eternity-sands:', err);
  process.exit(1);
});

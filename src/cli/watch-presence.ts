// src/cli/watch-presence.ts
import fs from 'fs';
import path from 'path';
import { DropLogger } from '../engines/drop-logger.js';
import { discordPresence } from '../relay/discord-presence.js';

interface MonitoredTarget {
  name: string;
  title: string;
  filePath: string;
}

const CANDIDATES: MonitoredTarget[] = [
  { name: 'akasha', title: 'Akasha HL', filePath: path.resolve('logs/gb-akasha.md') },
  { name: 'pbhl', title: 'PBHL', filePath: path.resolve('logs/gb-pbhl.md') },
  { name: 'go', title: 'Grand Order HL', filePath: path.resolve('logs/gb-go.md') },
  { name: 'farm', title: 'Gold Bar Farm', filePath: path.resolve('logs/gb-farm.md') },
];

function resolveActiveTarget(requested?: string): MonitoredTarget {
  if (requested) {
    const matched = CANDIDATES.find(c =>
      c.name.toLowerCase() === requested.toLowerCase() ||
      c.title.toLowerCase().includes(requested.toLowerCase()) ||
      c.filePath.toLowerCase().includes(requested.toLowerCase())
    );
    if (matched) return matched;
    return {
      name: path.basename(requested, '.md'),
      title: path.basename(requested, '.md').toUpperCase(),
      filePath: path.resolve(requested),
    };
  }

  // Auto-detect the most recently modified log file
  let newest: MonitoredTarget = CANDIDATES[0];
  let newestMtime = 0;

  for (const candidate of CANDIDATES) {
    try {
      if (fs.existsSync(candidate.filePath)) {
        const stat = fs.statSync(candidate.filePath);
        if (stat.mtimeMs > newestMtime) {
          newestMtime = stat.mtimeMs;
          newest = candidate;
        }
      }
    } catch {}
  }

  return newest;
}

async function main() {
  const arg = process.argv[2];
  const target = resolveActiveTarget(arg);

  console.log('=====================================================');
  console.log('    Granblue Fantasy - Real-Time Presence Watcher    ');
  console.log('=====================================================');
  console.log(`• Monitored Raid:  ${target.title}`);
  console.log(`• Monitored File:  ${path.relative(process.cwd(), target.filePath)}`);

  const logger = new DropLogger(target.filePath, target.title);
  let stats = logger.getStats();
  let lastRec = logger.getLastRecord();

  const initialGoldBars = stats.goldBars;
  const cleanTargetName = target.name.toLowerCase().includes('akasha')
    ? 'Akasha'
    : (target.name.toLowerCase().includes('pbhl') ? 'PBHL' : (target.name.toLowerCase().includes('go') ? 'GO' : target.title));

  console.log(`• Total Battles:   ${stats.totalBattles}`);
  console.log(`• Blue Chests:     ${stats.blueChests} (${stats.blueChestRatePct})`);
  console.log(`• Gold Bars:       ${stats.goldBars} (${stats.goldBarsToday} today)`);
  console.log(`• Current Dry:     ${stats.currentDryStreak} ${stats.dryStreakMode === 'blue_chest' ? 'Blue Chests' : 'Battles'}`);
  console.log('=====================================================');

  // Broadcast initial status
  discordPresence.updateStatus({
    raidName: target.title,
    runNumber: stats.totalBattles,
    goldBars: stats.goldBars,
    goldBarsToday: stats.goldBarsToday,
    goldBarsSession: 0,
    blueChests: stats.blueChests,
    dryStreak: stats.currentDryStreak,
    dryStreakMode: stats.dryStreakMode,
    honors: lastRec?.honors || 0,
    status: `Raid ${cleanTargetName}`,
  }, true);

  console.log('📡 Live presence active on Discord Bot Gateway & Desktop RPC.');
  console.log('👀 Watching for new completed battles... (Press Ctrl+C to stop)\n');

  let lastKnownBattles = stats.totalBattles;
  let lastKnownMtime = 0;
  let lastKnownSize = 0;
  try {
    if (fs.existsSync(target.filePath)) {
      const initStat = fs.statSync(target.filePath);
      lastKnownMtime = initStat.mtimeMs;
      lastKnownSize = initStat.size;
    }
  } catch {}

  const pollInterval = setInterval(() => {
    try {
      if (!fs.existsSync(target.filePath)) return;

      const stat = fs.statSync(target.filePath);
      if (stat.mtimeMs === lastKnownMtime && stat.size === lastKnownSize) return;
      lastKnownMtime = stat.mtimeMs;
      lastKnownSize = stat.size;

      logger.reload();
      const currentStats = logger.getStats();
      const latestRecord = logger.getLastRecord();

      if (currentStats.totalBattles > lastKnownBattles) {
        const diff = currentStats.totalBattles - lastKnownBattles;
        lastKnownBattles = currentStats.totalBattles;

        const timeStr = new Date().toLocaleTimeString();
        const blueIcon = latestRecord?.hasBlueChest ? '💎 Blue Chest' : '⚠️ No Blue';
        const gbIcon = latestRecord?.hasGoldBar ? '🌟🌟 GOLD BAR DROPPED! 🌟🌟' : '❌ No GB';

        console.log(`[${timeStr}] ⚔️ New Battle #${currentStats.totalBattles} (+${diff})`);
        console.log(`       Honors:     ${latestRecord?.honors || 'N/A'}`);
        console.log(`       Turns:      ${latestRecord?.turns || 'N/A'}`);
        console.log(`       Result:     ${blueIcon} | ${gbIcon}`);
        console.log(`       Dry Streak: ${currentStats.currentDryStreak} ${currentStats.dryStreakMode === 'blue_chest' ? 'Blue' : 'Runs'}`);

        const sessionGb = Math.max(0, currentStats.goldBars - initialGoldBars);

        discordPresence.updateStatus({
          raidName: target.title,
          runNumber: currentStats.totalBattles,
          goldBars: currentStats.goldBars,
          goldBarsToday: currentStats.goldBarsToday,
          goldBarsSession: sessionGb,
          blueChests: currentStats.blueChests,
          dryStreak: currentStats.currentDryStreak,
          dryStreakMode: currentStats.dryStreakMode,
          honors: latestRecord?.honors,
          status: `Raid ${cleanTargetName}`,
        }, true);
      }
    } catch (err: any) {
      // Non-blocking file read error
    }
  }, 2500);

  // Graceful exit handler
  const shutdown = () => {
    clearInterval(pollInterval);
    console.log('\n[PresenceWatcher] Stopping presence watcher...');
    discordPresence.updateStatus({
      status: 'Idle',
    }, true);
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[PresenceWatcher] Fatal error:', e);
  process.exit(1);
});

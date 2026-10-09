// src/services/telemetry/gold-bar-tracker.service.ts
import fs from 'node:fs';
import path from 'node:path';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { AlertRelay } from '../../alert-relay.js';

export interface GoldBarDropRecord {
  id: string;
  raidId: string;
  questName: string;
  timestampJst: string;
  jstDate: string;
  gbfDay: string; // GBF Server Day (05:00 JST reset)
  honors: string;
  turns: string | number;
  battleUrl: string;
  screenshotPath?: string;
  chestType: 'blue_chest' | 'host_chest' | 'share_chest' | 'unknown';
  source: 'live_combat' | 'pending_claim' | 'battle_log_audit' | 'backfill';
  accountId: string;
}

export interface DailyGoldBarSummary {
  gbfDay: string;
  jstDate: string;
  goldBarsCount: number;
  blueChestsCount: number;
  totalBattlesCount: number;
  dropRatePerBlueChestPct: string;
  drops: GoldBarDropRecord[];
}

export interface LifetimeGoldBarStats {
  totalGoldBars: number;
  goldBarsToday: number;
  goldBarsThisWeek: number;
  currentGbfDay: string;
  currentJstTimestamp: string;
  dropsByDay: Record<string, number>;
  allDrops: GoldBarDropRecord[];
}

/**
 * Modular Gold Bar Tracker Service.
 * Tracks Gold Bar drops aligned with GBF Server Timezone (JST / 05:00 JST daily reset),
 * maintains daily partitioned JSON records, provides canonical Battle Log URLs,
 * and handles Discord reporting (instant drop alerts + daily digests).
 */
export class GoldBarTrackerService {
  private baseDir: string;
  private dailyDir: string;
  private masterLedgerPath: string;
  private summaryMarkdownPath: string;
  private alertRelay = new AlertRelay();

  constructor(baseDir = 'logs/gold-bars') {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.dailyDir = path.resolve(this.baseDir, 'daily');
    this.masterLedgerPath = path.resolve(this.baseDir, 'gold-bar-ledger.json');
    this.summaryMarkdownPath = path.resolve(this.baseDir, 'README.md');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.dailyDir)) {
      fs.mkdirSync(this.dailyDir, { recursive: true });
    }
  }

  /**
   * Returns current date string (YYYY-MM-DD) in Japan Standard Time (JST / UTC+9).
   */
  public static getJstDate(date: Date = new Date()): string {
    const jstStr = date.toLocaleString('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return jstStr.slice(0, 10);
  }

  /**
   * Returns canonical GBF Server Day (YYYY-MM-DD).
   * In GBF, the daily reset occurs at 05:00 JST.
   * Any activity between 00:00:00 and 04:59:59 JST belongs to the previous day's server cycle.
   */
  public static getGbfDay(date: Date = new Date()): string {
    // Offset by -5 hours in JST to align 05:00 JST as the start of the day
    const jstTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    jstTime.setHours(jstTime.getHours() - 5);
    const y = jstTime.getFullYear();
    const m = String(jstTime.getMonth() + 1).padStart(2, '0');
    const d = String(jstTime.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Formats a date into a clean JST timestamp string.
   */
  public static formatJstTimestamp(date: Date = new Date()): string {
    return date.toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }) + ' JST';
  }

  /**
   * Constructs official persistent GBF battle log URL from raid ID.
   */
  public static getBattleLogUrl(raidId: string): string {
    const clean = raidId.replace(/\D/g, '').trim();
    if (clean) {
      return `https://game.granbluefantasy.jp/#result_multi/detail/${clean}/1/0/0`;
    }
    return 'https://game.granbluefantasy.jp/#quest/assist';
  }

  /**
   * Reads all master ledger records from disk.
   */
  public getMasterRecords(): GoldBarDropRecord[] {
    try {
      if (fs.existsSync(this.masterLedgerPath)) {
        const raw = fs.readFileSync(this.masterLedgerPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e: any) {
      console.warn(`[GoldBarTracker] Warning loading master ledger: ${e.message}`);
    }
    return [];
  }

  /**
   * Records a confirmed Gold Bar drop into both the daily JST ledger and master ledger.
   * Performs deduplication by raidId.
   */
  public async recordDrop(params: {
    raidId: string;
    questName: string;
    honors?: string | number;
    turns?: string | number;
    screenshotPath?: string;
    screenshotBuffer?: Buffer;
    chestType?: 'blue_chest' | 'host_chest' | 'share_chest' | 'unknown';
    source?: 'live_combat' | 'pending_claim' | 'battle_log_audit' | 'backfill';
    accountId?: string;
    customTimestamp?: Date;
    skipAlert?: boolean;
  }): Promise<GoldBarDropRecord> {
    const date = params.customTimestamp || new Date();
    const cleanRaidId = params.raidId.replace(/\D/g, '').trim() || 'Unknown';
    const jstDate = GoldBarTrackerService.getJstDate(date);
    const gbfDay = GoldBarTrackerService.getGbfDay(date);
    const timestampJst = GoldBarTrackerService.formatJstTimestamp(date);
    const battleUrl = GoldBarTrackerService.getBattleLogUrl(cleanRaidId);

    let honorsStr = '-';
    if (params.honors !== undefined) {
      honorsStr = typeof params.honors === 'number'
        ? `${params.honors.toLocaleString()} pt`
        : String(params.honors).includes('pt') ? String(params.honors) : `${params.honors} pt`;
    }

    const recordId = `gb-${cleanRaidId || Date.now()}`;
    const record: GoldBarDropRecord = {
      id: recordId,
      raidId: cleanRaidId,
      questName: params.questName || 'Granblue Fantasy Raid',
      timestampJst,
      jstDate,
      gbfDay,
      honors: honorsStr,
      turns: params.turns ?? '-',
      battleUrl,
      screenshotPath: params.screenshotPath,
      chestType: params.chestType || 'blue_chest',
      source: params.source || 'live_combat',
      accountId: params.accountId || 'acc1'
    };

    // 1. Update Master Ledger (with deduplication)
    const masterRecords = this.getMasterRecords();
    const existingIndex = masterRecords.findIndex(r => r.raidId === cleanRaidId && cleanRaidId !== 'Unknown');

    if (existingIndex >= 0) {
      // Merge updates
      masterRecords[existingIndex] = { ...masterRecords[existingIndex], ...record };
    } else {
      masterRecords.push(record);
    }
    fs.writeFileSync(this.masterLedgerPath, JSON.stringify(masterRecords, null, 2), 'utf-8');

    // 2. Update Daily Partition
    const dailyPath = path.resolve(this.dailyDir, `gold-bars-${gbfDay}.json`);
    let dailyRecords: GoldBarDropRecord[] = [];
    if (fs.existsSync(dailyPath)) {
      try {
        dailyRecords = JSON.parse(fs.readFileSync(dailyPath, 'utf-8'));
      } catch {}
    }
    const dailyIndex = dailyRecords.findIndex(r => r.raidId === cleanRaidId && cleanRaidId !== 'Unknown');
    if (dailyIndex >= 0) {
      dailyRecords[dailyIndex] = { ...dailyRecords[dailyIndex], ...record };
    } else {
      dailyRecords.push(record);
    }
    fs.writeFileSync(dailyPath, JSON.stringify(dailyRecords, null, 2), 'utf-8');

    // 3. Update Summary Markdown
    this.generateSummaryMarkdown();

    // 4. Send Instant Discord Alert (if not skipped)
    if (!params.skipAlert) {
      await this.dispatchDropAlert(record, params.screenshotBuffer);
    }

    return record;
  }

  /**
   * Removes an invalid or false-positive drop from the ledger and updates summaries.
   */
  public removeDrop(raidId: string): boolean {
    const cleanRaidId = raidId.replace(/\D/g, '').trim();
    if (!cleanRaidId) return false;

    let master = this.getMasterRecords();
    const target = master.find(r => r.raidId === cleanRaidId);
    if (!target) return false;

    master = master.filter(r => r.raidId !== cleanRaidId);
    fs.writeFileSync(this.masterLedgerPath, JSON.stringify(master, null, 2), 'utf-8');

    // Update Daily Partition
    const dailyPath = path.resolve(this.dailyDir, `gold-bars-${target.gbfDay}.json`);
    if (fs.existsSync(dailyPath)) {
      try {
        let dailyRecords: GoldBarDropRecord[] = JSON.parse(fs.readFileSync(dailyPath, 'utf-8'));
        dailyRecords = dailyRecords.filter(r => r.raidId !== cleanRaidId);
        if (dailyRecords.length === 0) {
          fs.unlinkSync(dailyPath);
        } else {
          fs.writeFileSync(dailyPath, JSON.stringify(dailyRecords, null, 2), 'utf-8');
        }
      } catch {}
    }

    this.generateSummaryMarkdown();
    return true;
  }

  /**
   * Dispatches Discord DM notification for a confirmed drop.
   */
  public async dispatchDropAlert(record: GoldBarDropRecord, screenshotBuffer?: Buffer): Promise<void> {
    const dailySummary = this.getDailySummary(record.gbfDay);
    const playerName = record.accountId || 'acc1';

    const content = [
      '🌟 **Gold Brick Drop Confirmed** 🌟',
      `• **Raid**: ${record.questName}`,
      record.raidId ? `• **Raid ID**: \`${record.raidId}\`` : '',
      `• **Battle Log**: ${record.battleUrl}`,
      `• **Timestamp**: ${record.timestampJst}`,
      `• **Account**: ${playerName}`,
      `• **Honors**: ${record.honors}`,
      `• **Source**: ${record.source.replace('_', ' ').toUpperCase()}`,
      `• **Drops Today (GBF Day)**: \`${dailySummary.goldBarsCount}\` 🌟`,
    ].filter(Boolean).join('\n');

    console.log(`\n========================================================================`);
    console.log(`  🌟🌟🌟 [GOLD BAR LOGGED] Raid: ${record.raidId} | Day: ${record.gbfDay} (Drop #${dailySummary.goldBarsCount} Today) 🌟🌟🌟`);
    console.log(`  🔗 Battle Log: ${record.battleUrl}`);
    console.log(`========================================================================\n`);

    // Audible terminal notification
    process.stdout.write('\x07\x07\x07');

    if (discordDmRelay.isConfigured()) {
      try {
        console.log('[GoldBarTracker] 📤 Sending Gold Bar notification to Discord DM...');
        await discordDmRelay.sendMessage(
          content,
          screenshotBuffer,
          `gold-bar-${record.raidId || 'drop'}.png`,
          undefined,
          true
        );
        console.log('[GoldBarTracker] ✅ Discord DM alert sent successfully!');
      } catch (err: any) {
        console.error('[GoldBarTracker] Discord alert notice:', err.message);
      }
    }

    try {
      await this.alertRelay.sendEmergencyAlert(
        `🌟 GOLD BAR CONFIRMED (${record.questName})!\n• ID: ${record.raidId}\n• Log: ${record.battleUrl}\n• Honors: ${record.honors}\n• Day: ${record.gbfDay}`,
        screenshotBuffer
      );
    } catch {}
  }

  /**
   * Computes the summary for a specific GBF server day (default: current server day).
   */
  public getDailySummary(gbfDay?: string): DailyGoldBarSummary {
    const targetDay = gbfDay || GoldBarTrackerService.getGbfDay();
    const dailyPath = path.resolve(this.dailyDir, `gold-bars-${targetDay}.json`);
    let drops: GoldBarDropRecord[] = [];

    if (fs.existsSync(dailyPath)) {
      try {
        drops = JSON.parse(fs.readFileSync(dailyPath, 'utf-8'));
      } catch {}
    } else {
      // Fallback: filter from master ledger
      const all = this.getMasterRecords();
      drops = all.filter(r => r.gbfDay === targetDay);
    }

    return {
      gbfDay: targetDay,
      jstDate: GoldBarTrackerService.getJstDate(),
      goldBarsCount: drops.length,
      blueChestsCount: 0, // Enriched by log parser if available
      totalBattlesCount: 0,
      dropRatePerBlueChestPct: 'N/A',
      drops
    };
  }

  /**
   * Computes lifetime and recent drop statistics.
   */
  public getLifetimeStats(): LifetimeGoldBarStats {
    const allDrops = this.getMasterRecords();
    const currentGbfDay = GoldBarTrackerService.getGbfDay();
    const currentJstTimestamp = GoldBarTrackerService.formatJstTimestamp();

    // Group drops by GBF day
    const dropsByDay: Record<string, number> = {};
    for (const drop of allDrops) {
      dropsByDay[drop.gbfDay] = (dropsByDay[drop.gbfDay] || 0) + 1;
    }

    const goldBarsToday = dropsByDay[currentGbfDay] || 0;

    // Calculate this week (last 7 GBF days)
    let goldBarsThisWeek = 0;
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayStr = GoldBarTrackerService.getGbfDay(d);
      goldBarsThisWeek += dropsByDay[dayStr] || 0;
    }

    return {
      totalGoldBars: allDrops.length,
      goldBarsToday,
      goldBarsThisWeek,
      currentGbfDay,
      currentJstTimestamp,
      dropsByDay,
      allDrops
    };
  }

  /**
   * Backfills records from existing jsonl log files across the project (e.g. gb-akasha.jsonl, gb-pbhl.jsonl).
   */
  public async backfillFromLogs(jsonlPaths?: string[]): Promise<number> {
    const defaultPaths = [
      'logs/gb-akasha.jsonl',
      'logs/gb-pbhl.jsonl',
      'logs/gb-go.jsonl',
      'logs/gb-farm.jsonl'
    ];
    const targets = jsonlPaths && jsonlPaths.length > 0 ? jsonlPaths : defaultPaths;
    let importedCount = 0;

    for (const relPath of targets) {
      const absPath = path.resolve(process.cwd(), relPath);
      if (!fs.existsSync(absPath)) continue;

      try {
        const lines = fs.readFileSync(absPath, 'utf-8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.hasGoldBar) {
              const parsedDate = data.timestamp ? new Date(data.timestamp.replace(/-/g, '/')) : new Date();
              const questName = relPath.includes('akasha')
                ? 'Akasha HL'
                : relPath.includes('pbhl')
                  ? 'Proto Bahamut HL'
                  : relPath.includes('go')
                    ? 'Grand Order HL'
                    : 'Granblue Fantasy Raid';

              await this.recordDrop({
                raidId: data.raidId || 'Unknown',
                questName,
                honors: data.honors,
                turns: data.turns,
                screenshotPath: data.screenshotPath,
                chestType: 'blue_chest',
                source: 'backfill',
                customTimestamp: parsedDate,
                skipAlert: true // Do not spam Discord for historical backfill
              });
              importedCount++;
            }
          } catch {}
        }
      } catch (err: any) {
        console.warn(`[GoldBarTracker] Notice during backfill from ${relPath}: ${err.message}`);
      }
    }

    this.generateSummaryMarkdown();
    return importedCount;
  }

  /**
   * Generates a comprehensive markdown summary dashboard and Hall of Fame.
   */
  public generateSummaryMarkdown(): void {
    const stats = this.getLifetimeStats();
    const sortedDrops = [...stats.allDrops].sort((a, b) => b.timestampJst.localeCompare(a.timestampJst));

    let md = `# 🌟 Granblue Fantasy - Gold Bar Drop Ledger (JST Server Time)\n\n`;
    md += `> ### 📊 Daily & Lifetime Drop Summary\n`;
    md += `> - **Current GBF Server Day (05:00 JST Reset):** \`${stats.currentGbfDay}\`\n`;
    md += `> - **Current JST Timestamp:** \`${stats.currentJstTimestamp}\`\n`;
    md += `> - **Gold Bars Dropped Today (GBF Day):** \`${stats.goldBarsToday}\` 🌟\n`;
    md += `> - **Gold Bars Dropped Last 7 Days:** \`${stats.goldBarsThisWeek}\`\n`;
    md += `> - **Lifetime Total Gold Bars Tracked:** \`${stats.totalGoldBars}\` 🏆\n\n`;

    md += `### 📅 Drops by GBF Server Day (Past 14 Days)\n\n`;
    md += `| GBF Server Day (05:00 JST) | Gold Bars Dropped | Status |\n`;
    md += `| :---: | :---: | :--- |\n`;

    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayStr = GoldBarTrackerService.getGbfDay(d);
      const count = stats.dropsByDay[dayStr] || 0;
      const statusIcon = count > 0 ? `🌟 **${count} Bar${count > 1 ? 's' : ''}**` : '—';
      md += `| ${dayStr} | ${count} | ${statusIcon} |\n`;
    }
    md += `\n---\n\n`;

    md += `### 🏆 🌟 Gold Bar Drops Hall of Fame 🌟\n\n`;
    md += `| # | Timestamp (JST) | GBF Day | Raid | Raid ID | Battle Log URL | Honors | Turns | Proof Screenshot |\n`;
    md += `| :---: | :--- | :---: | :--- | :---: | :--- | :---: | :---: | :--- |\n`;

    sortedDrops.forEach((d, idx) => {
      const battleLink = `[Battle Log #${d.raidId}](${d.battleUrl})`;
      const proof = d.screenshotPath
        ? `[Screenshot](${d.screenshotPath})`
        : 'Confirmed In-Game';
      md += `| ${idx + 1} | ${d.timestampJst} | ${d.gbfDay} | ${d.questName} | \`${d.raidId}\` | ${battleLink} | ${d.honors} | ${d.turns} | ${proof} |\n`;
    });

    try {
      fs.writeFileSync(this.summaryMarkdownPath, md, 'utf-8');
    } catch (e: any) {
      console.warn(`[GoldBarTracker] Could not write summary markdown: ${e.message}`);
    }
  }

  /**
   * Sends a comprehensive daily summary report to Discord.
   */
  public async dispatchDailySummaryToDiscord(gbfDay?: string): Promise<void> {
    const targetDay = gbfDay || GoldBarTrackerService.getGbfDay();
    const summary = this.getDailySummary(targetDay);
    const stats = this.getLifetimeStats();

    const lines = [
      `📊 **GBF Daily Gold Bar Summary (${targetDay} JST)** 📊`,
      `• **Gold Bars Today**: \`${summary.goldBarsCount}\` 🌟`,
      `• **Total Lifetime Gold Bars**: \`${stats.totalGoldBars}\` 🏆`,
      `• **Last 7 Days Total**: \`${stats.goldBarsThisWeek}\``,
      '',
    ];

    if (summary.drops.length > 0) {
      lines.push('**Today\'s Drops:**');
      summary.drops.forEach((d, i) => {
        lines.push(`${i + 1}. **${d.questName}** (ID: \`${d.raidId}\`) at ${d.timestampJst}`);
        lines.push(`   🔗 Log: ${d.battleUrl}`);
      });
    } else {
      lines.push('• No Gold Bar drops recorded today yet. Keep grinding!');
    }

    const message = lines.join('\n');
    console.log('\n' + message + '\n');

    if (discordDmRelay.isConfigured()) {
      try {
        await discordDmRelay.sendMessage(message, undefined, undefined, undefined, true);
        console.log('[GoldBarTracker] ✅ Daily summary posted to Discord!');
      } catch (err: any) {
        console.error('[GoldBarTracker] Notice posting daily summary to Discord:', err.message);
      }
    }
  }
}

export const goldBarTracker = new GoldBarTrackerService();

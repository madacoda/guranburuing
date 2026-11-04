// src/services/telemetry/eternity-sand-tracker.service.ts
import fs from 'node:fs';
import path from 'node:path';
import { discordDmRelay } from '../../relay/discord-dm-relay.js';
import { AlertRelay } from '../../alert-relay.js';
import { rustBridge } from '../../core/rust-bridge.js';

export const ETERNITY_SAND_ITEM_ID = '215';
export const ETERNITY_SAND_ITEM_KIND = '10';
export const ETERNITY_SAND_DATA_KEY = '10_215';
export const ETERNITY_SAND_ICON_URL =
  'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img/sp/assets/item/article/s/215.jpg';
export const ETERNITY_SAND_ICON_MEDIUM_URL =
  'https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img/sp/assets/item/article/m/215.jpg';

export interface EternitySandDropRecord {
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

export interface DailyEternitySandSummary {
  gbfDay: string;
  jstDate: string;
  eternitySandsCount: number;
  blueChestsCount: number;
  totalBattlesCount: number;
  dropRatePerBlueChestPct: string;
  drops: EternitySandDropRecord[];
}

export interface LifetimeEternitySandStats {
  totalEternitySands: number;
  eternitySandsToday: number;
  eternitySandsThisWeek: number;
  currentGbfDay: string;
  currentJstTimestamp: string;
  dropsByDay: Record<string, number>;
  allDrops: EternitySandDropRecord[];
}

/**
 * Modular Eternity Sand (刻の流砂) Tracker Service.
 * Tracks Eternity Sand drops (Item ID 215, Kind 10 / Article, Key 10_215) aligned with GBF Server Timezone
 * (JST / 05:00 JST daily reset), maintains daily partitioned JSON records, provides canonical Battle Log URLs,
 * and handles Discord reporting (instant drop alerts + daily digests).
 */
export class EternitySandTrackerService {
  private baseDir: string;
  private dailyDir: string;
  private masterLedgerPath: string;
  private summaryMarkdownPath: string;
  private alertRelay = new AlertRelay();
  private masterRecordsCache: EternitySandDropRecord[] | null = null;
  private masterRecordsMtimeMs = -1;

  constructor(baseDir = 'logs/eternity-sands') {
    this.baseDir = path.resolve(process.cwd(), baseDir);
    this.dailyDir = path.resolve(this.baseDir, 'daily');
    this.masterLedgerPath = path.resolve(this.baseDir, 'eternity-sand-ledger.json');
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
    const nativeDay = rustBridge.getGbfServerDayYmd(date.getTime());
    if (nativeDay !== null) {
      return nativeDay;
    }
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
    return (
      date.toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }) + ' JST'
    );
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
   * Reads all master ledger records from disk (with mtimeMs-validated in-memory caching).
   */
  public getMasterRecords(): EternitySandDropRecord[] {
    try {
      if (fs.existsSync(this.masterLedgerPath)) {
        const stat = fs.statSync(this.masterLedgerPath);
        if (this.masterRecordsCache && this.masterRecordsMtimeMs === stat.mtimeMs) {
          return [...this.masterRecordsCache];
        }
        const raw = fs.readFileSync(this.masterLedgerPath, 'utf-8');
        const parsed: EternitySandDropRecord[] = JSON.parse(raw);
        this.masterRecordsCache = parsed;
        this.masterRecordsMtimeMs = stat.mtimeMs;
        return [...parsed];
      }
      this.masterRecordsCache = null;
      this.masterRecordsMtimeMs = -1;
    } catch (e: any) {
      console.warn(`[EternitySandTracker] Warning loading master ledger: ${e.message}`);
    }
    return [];
  }

  private saveMasterRecords(records: EternitySandDropRecord[]): void {
    fs.writeFileSync(this.masterLedgerPath, JSON.stringify(records, null, 2), 'utf-8');
    try {
      const stat = fs.statSync(this.masterLedgerPath);
      this.masterRecordsCache = [...records];
      this.masterRecordsMtimeMs = stat.mtimeMs;
    } catch {
      this.masterRecordsCache = [...records];
    }
  }

  /**
   * Records a confirmed Eternity Sand drop into both the daily JST ledger and master ledger.
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
    skipMarkdownUpdate?: boolean;
  }): Promise<EternitySandDropRecord> {
    const date = params.customTimestamp || new Date();
    const cleanRaidId = params.raidId.replace(/\D/g, '').trim() || 'Unknown';
    const jstDate = EternitySandTrackerService.getJstDate(date);
    const gbfDay = EternitySandTrackerService.getGbfDay(date);
    const timestampJst = EternitySandTrackerService.formatJstTimestamp(date);
    const battleUrl = EternitySandTrackerService.getBattleLogUrl(cleanRaidId);

    let honorsStr = '-';
    if (params.honors !== undefined) {
      honorsStr =
        typeof params.honors === 'number'
          ? `${params.honors.toLocaleString()} pt`
          : String(params.honors).includes('pt')
            ? String(params.honors)
            : `${params.honors} pt`;
    }

    const recordId = `sand-${cleanRaidId || Date.now()}`;
    const record: EternitySandDropRecord = {
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

    const isDefaultProdLedger =
      path.resolve(this.baseDir) === path.resolve(process.cwd(), 'logs/eternity-sands');
    if (
      isDefaultProdLedger &&
      (params.accountId === 'test-acc' || params.questName === 'Unit Test Template')
    ) {
      return record;
    }

    // 1. Update Master Ledger (with deduplication)
    const masterRecords = this.getMasterRecords();
    const existingIndex = masterRecords.findIndex(
      r => r.raidId === cleanRaidId && cleanRaidId !== 'Unknown'
    );

    if (existingIndex >= 0) {
      masterRecords[existingIndex] = { ...masterRecords[existingIndex], ...record };
    } else {
      masterRecords.push(record);
    }
    this.saveMasterRecords(masterRecords);

    // 2. Update Daily Partition
    const dailyPath = path.resolve(this.dailyDir, `eternity-sands-${gbfDay}.json`);
    let dailyRecords: EternitySandDropRecord[] = [];
    if (fs.existsSync(dailyPath)) {
      try {
        dailyRecords = JSON.parse(fs.readFileSync(dailyPath, 'utf-8'));
      } catch {}
    }
    const dailyIndex = dailyRecords.findIndex(
      r => r.raidId === cleanRaidId && cleanRaidId !== 'Unknown'
    );
    if (dailyIndex >= 0) {
      dailyRecords[dailyIndex] = { ...dailyRecords[dailyIndex], ...record };
    } else {
      dailyRecords.push(record);
    }
    fs.writeFileSync(dailyPath, JSON.stringify(dailyRecords, null, 2), 'utf-8');

    // 3. Update Summary Markdown
    if (!params.skipMarkdownUpdate) {
      this.generateSummaryMarkdown();
    }

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
    this.saveMasterRecords(master);

    const dailyPath = path.resolve(this.dailyDir, `eternity-sands-${target.gbfDay}.json`);
    if (fs.existsSync(dailyPath)) {
      try {
        let dailyRecords: EternitySandDropRecord[] = JSON.parse(fs.readFileSync(dailyPath, 'utf-8'));
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
   * Dispatches Discord DM notification for a confirmed Eternity Sand drop.
   */
  public async dispatchDropAlert(
    record: EternitySandDropRecord,
    screenshotBuffer?: Buffer
  ): Promise<void> {
    const dailySummary = this.getDailySummary(record.gbfDay);
    const playerName = record.accountId || 'acc1';

    const content = [
      '⏳ **Eternity Sand (刻の流砂) Drop Confirmed** ⏳',
      `• **Raid**: ${record.questName}`,
      record.raidId ? `• **Raid ID**: \`${record.raidId}\`` : '',
      `• **Battle Log**: ${record.battleUrl}`,
      `• **Timestamp**: ${record.timestampJst}`,
      `• **Account**: ${playerName}`,
      `• **Honors**: ${record.honors}`,
      `• **Source**: ${record.source.replace('_', ' ').toUpperCase()}`,
      `• **Drops Today (GBF Day)**: \`${dailySummary.eternitySandsCount}\` ⏳`
    ]
      .filter(Boolean)
      .join('\n');

    console.log(`\n========================================================================`);
    console.log(
      `  ⏳⏳⏳ [ETERNITY SAND LOGGED] Raid: ${record.raidId} | Day: ${record.gbfDay} (Drop #${dailySummary.eternitySandsCount} Today) ⏳⏳⏳`
    );
    console.log(`  🔗 Battle Log: ${record.battleUrl}`);
    console.log(`========================================================================\n`);

    process.stdout.write('\x07\x07\x07');

    if (discordDmRelay.isConfigured()) {
      try {
        console.log('[EternitySandTracker] 📤 Sending Eternity Sand notification to Discord DM...');
        await discordDmRelay.sendMessage(
          content,
          screenshotBuffer,
          `eternity-sand-${record.raidId || 'drop'}.png`,
          undefined,
          true
        );
        console.log('[EternitySandTracker] ✅ Discord DM alert sent successfully!');
      } catch (err: any) {
        console.error('[EternitySandTracker] Discord alert notice:', err.message);
      }
    }

    try {
      await this.alertRelay.sendEmergencyAlert(
        `⏳ ETERNITY SAND CONFIRMED (${record.questName})!\n• ID: ${record.raidId}\n• Log: ${record.battleUrl}\n• Honors: ${record.honors}\n• Day: ${record.gbfDay}`,
        screenshotBuffer
      );
    } catch {}
  }

  /**
   * Computes the summary for a specific GBF server day (default: current server day).
   */
  public getDailySummary(gbfDay?: string): DailyEternitySandSummary {
    const targetDay = gbfDay || EternitySandTrackerService.getGbfDay();
    const dailyPath = path.resolve(this.dailyDir, `eternity-sands-${targetDay}.json`);
    let drops: EternitySandDropRecord[] = [];

    if (fs.existsSync(dailyPath)) {
      try {
        drops = JSON.parse(fs.readFileSync(dailyPath, 'utf-8'));
      } catch {}
    } else {
      const all = this.getMasterRecords();
      drops = all.filter(r => r.gbfDay === targetDay);
    }

    return {
      gbfDay: targetDay,
      jstDate: EternitySandTrackerService.getJstDate(),
      eternitySandsCount: drops.length,
      blueChestsCount: 0,
      totalBattlesCount: 0,
      dropRatePerBlueChestPct: 'N/A',
      drops
    };
  }

  /**
   * Computes lifetime and recent drop statistics.
   */
  public getLifetimeStats(): LifetimeEternitySandStats {
    const allDrops = this.getMasterRecords();
    const currentGbfDay = EternitySandTrackerService.getGbfDay();
    const currentJstTimestamp = EternitySandTrackerService.formatJstTimestamp();

    const dropsByDay: Record<string, number> = {};
    for (const drop of allDrops) {
      dropsByDay[drop.gbfDay] = (dropsByDay[drop.gbfDay] || 0) + 1;
    }

    const eternitySandsToday = dropsByDay[currentGbfDay] || 0;

    let eternitySandsThisWeek = 0;
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayStr = EternitySandTrackerService.getGbfDay(d);
      eternitySandsThisWeek += dropsByDay[dayStr] || 0;
    }

    return {
      totalEternitySands: allDrops.length,
      eternitySandsToday,
      eternitySandsThisWeek,
      currentGbfDay,
      currentJstTimestamp,
      dropsByDay,
      allDrops
    };
  }

  /**
   * Backfills records from existing jsonl log files across the project.
   */
  public async backfillFromLogs(jsonlPaths?: string[]): Promise<number> {
    const logsDir = path.resolve(process.cwd(), 'logs');
    let targets: string[] = [];
    if (jsonlPaths && jsonlPaths.length > 0) {
      targets = jsonlPaths;
    } else if (fs.existsSync(logsDir)) {
      try {
        targets = fs
          .readdirSync(logsDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => path.join('logs', f));
      } catch {}
    }

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
            if (data.hasEternitySand) {
              const parsedDate = data.timestamp
                ? new Date(data.timestamp.replace(/-/g, '/'))
                : new Date();
              const baseName = path.basename(relPath, '.jsonl');
              const questName = data.questName || baseName;

              await this.recordDrop({
                raidId: data.raidId || 'Unknown',
                questName,
                honors: data.honors,
                turns: data.turns,
                screenshotPath: data.screenshotPath,
                chestType: 'blue_chest',
                source: 'backfill',
                customTimestamp: parsedDate,
                skipAlert: true,
                skipMarkdownUpdate: true
              });
              importedCount++;
            }
          } catch {}
        }
      } catch (err: any) {
        console.warn(`[EternitySandTracker] Notice during backfill from ${relPath}: ${err.message}`);
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
    const sortedDrops = [...stats.allDrops].sort((a, b) =>
      b.timestampJst.localeCompare(a.timestampJst)
    );

    let md = `# ⏳ Granblue Fantasy - Eternity Sand (刻の流砂) Drop Ledger (JST Server Time)\n\n`;
    md += `> ### 📊 Daily & Lifetime Drop Summary\n`;
    md += `> - **Item Asset:** <img src="${ETERNITY_SAND_ICON_URL}" width="20" height="20" style="vertical-align:middle;" /> **Eternity Sand** (\`刻の流砂\` | ID: \`215\` | Key: \`10_215\`)\n`;
    md += `> - **Current GBF Server Day (05:00 JST Reset):** \`${stats.currentGbfDay}\`\n`;
    md += `> - **Current JST Timestamp:** \`${stats.currentJstTimestamp}\`\n`;
    md += `> - **Eternity Sands Dropped Today (GBF Day):** \`${stats.eternitySandsToday}\` ⏳\n`;
    md += `> - **Eternity Sands Dropped Last 7 Days:** \`${stats.eternitySandsThisWeek}\`\n`;
    md += `> - **Lifetime Total Eternity Sands Tracked:** \`${stats.totalEternitySands}\` 🏆\n\n`;

    md += `### 📅 Drops by GBF Server Day (Past 14 Days)\n\n`;
    md += `| GBF Server Day (05:00 JST) | Eternity Sands Dropped | Status |\n`;
    md += `| :---: | :---: | :--- |\n`;

    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayStr = EternitySandTrackerService.getGbfDay(d);
      const count = stats.dropsByDay[dayStr] || 0;
      const statusIcon = count > 0 ? `⏳ **${count} Sand${count > 1 ? 's' : ''}**` : '—';
      md += `| ${dayStr} | ${count} | ${statusIcon} |\n`;
    }
    md += `\n---\n\n`;

    md += `### 🏆 ⏳ Eternity Sand Drops Hall of Fame ⏳\n\n`;
    md += `| # | Timestamp (JST) | GBF Day | Raid | Raid ID | Battle Log URL | Honors | Turns | Proof Screenshot |\n`;
    md += `| :---: | :--- | :---: | :--- | :---: | :--- | :---: | :---: | :--- |\n`;

    sortedDrops.forEach((d, idx) => {
      const battleLink = `[Battle Log #${d.raidId}](${d.battleUrl})`;
      const proof = d.screenshotPath ? `[Screenshot](${d.screenshotPath})` : 'Confirmed In-Game';
      md += `| ${idx + 1} | ${d.timestampJst} | ${d.gbfDay} | ${d.questName} | \`${d.raidId}\` | ${battleLink} | ${d.honors} | ${d.turns} | ${proof} |\n`;
    });

    try {
      fs.writeFileSync(this.summaryMarkdownPath, md, 'utf-8');
    } catch (e: any) {
      console.warn(`[EternitySandTracker] Could not write summary markdown: ${e.message}`);
    }
  }

  /**
   * Sends a comprehensive daily summary report to Discord.
   */
  public async dispatchDailySummaryToDiscord(gbfDay?: string): Promise<void> {
    const targetDay = gbfDay || EternitySandTrackerService.getGbfDay();
    const summary = this.getDailySummary(targetDay);
    const stats = this.getLifetimeStats();

    const lines = [
      `📊 **GBF Daily Eternity Sand Summary (${targetDay} JST)** 📊`,
      `• **Eternity Sands Today**: \`${summary.eternitySandsCount}\` ⏳`,
      `• **Total Lifetime Eternity Sands**: \`${stats.totalEternitySands}\` 🏆`,
      `• **Last 7 Days Total**: \`${stats.eternitySandsThisWeek}\``,
      ''
    ];

    if (summary.drops.length > 0) {
      lines.push("**Today's Drops:**");
      summary.drops.forEach((d, i) => {
        lines.push(`${i + 1}. **${d.questName}** (ID: \`${d.raidId}\`) at ${d.timestampJst}`);
        lines.push(`   🔗 Log: ${d.battleUrl}`);
      });
    } else {
      lines.push('• No Eternity Sand drops recorded today yet. Keep grinding!');
    }

    const message = lines.join('\n');
    console.log('\n' + message + '\n');

    if (discordDmRelay.isConfigured()) {
      try {
        await discordDmRelay.sendMessage(message, undefined, undefined, undefined, true);
        console.log('[EternitySandTracker] ✅ Daily summary posted to Discord!');
      } catch (err: any) {
        console.error(
          '[EternitySandTracker] Notice posting daily summary to Discord:',
          err.message
        );
      }
    }
  }
}

export const eternitySandTracker = new EternitySandTrackerService();

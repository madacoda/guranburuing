// src/engines/drop-logger.ts
import fs from 'fs';
import path from 'path';

export interface BattleRecord {
  runNumber: number;
  timestamp: string;
  raidId: string;
  turns: number | string;
  honors: string;
  targetMet: boolean;
  hasGoldBar: boolean;
  battlesWithoutGb: number;
}

export interface DropStats {
  totalBattles: number;
  goldBars: number;
  battlesWithoutGb: number;
  currentDryStreak: number;
  dropRatePct: string;
}

export interface RaidCandidate {
  raidId: string;
  hpPct: number;
  players: number;
}

export interface RaidWorkflowResult {
  success: boolean;
  score: number;
  turns: number;
  durationMs: number;
  goldBarFound: boolean;
  hitPendingLimit?: boolean;
  raidEndedEarly?: boolean;
}

export class DropLogger {
  private records: BattleRecord[] = [];

  constructor(
    private filePath: string,
    private raidTitle: string = 'Granblue Fantasy Raid'
  ) {
    this.ensureDirExists();
    this.loadExistingLog();
  }

  private ensureDirExists(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Parses existing log file to restore prior run counts, streaks, and drop history.
   */
  private loadExistingLog(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      const lines = content.split('\n');
      this.records = [];

      for (const rawLine of lines) {
        const line = rawLine.trim();
        // Skip header lines, dividers, or workflow summary rows
        if (!line.startsWith('|') || line.includes(':---') || line.includes('Timestamp') || line.includes('Run #') || line.includes('Duration') || line.includes('Status') || line.includes('Notes')) {
          continue;
        }

        const cols = line
          .split('|')
          .map(c => c.trim())
          .filter(c => c.length > 0);

        if (cols.length >= 6) {
          // Format A (New): | Run # | Timestamp | Raid ID | Turns | Honors | Target Met? | Gold Bar Found? | Battles Without GB |
          if (cols.length >= 8) {
            const timestamp = cols[1];
            const turns = cols[3];
            const honors = cols[4];

            // Guard against corrupted workflow rows injected into 8-col table
            if (!/^\d{4}-\d{2}-\d{2}/.test(timestamp) || honors === 'SUCCESS' || honors === 'FAILED' || (typeof turns === 'string' && turns.endsWith('s'))) {
              continue;
            }

            const runNumber = parseInt(cols[0], 10) || (this.records.length + 1);
            const raidId = cols[2];
            const targetMet = cols[5].includes('Yes') || cols[5].includes('✅');
            const hasGoldBar = cols[6].includes('YES') || cols[6].includes('🌟') || cols[6].includes('Gold Bar');
            const battlesWithoutGb = parseInt(cols[7], 10) || 0;

            this.records.push({
              runNumber,
              timestamp,
              raidId,
              turns,
              honors,
              targetMet,
              hasGoldBar,
              battlesWithoutGb
            });
          } else {
            // Legacy Format: | Timestamp | Raid ID | Turns | Honors | Gold Bar Found? | Cumulative Runs |
            const timestamp = cols[0];
            const isWorkflowRow = cols.some(c => c === 'SUCCESS' || c === 'FAILED' || c.includes('Cleared') || (typeof c === 'string' && c.endsWith('s')));
            if (isWorkflowRow || !/^\d{4}-\d{2}-\d{2}/.test(timestamp)) {
              continue;
            }

            const raidId = cols[1];
            const turns = cols[2];
            const honors = cols[3];
            const hasGoldBar = cols[4].includes('YES') || cols[4].includes('🌟') || cols[4].includes('Gold Bar');
            const runNumber = parseInt(cols[5].replace(/\D/g, ''), 10) || (this.records.length + 1);

            this.records.push({
              runNumber,
              timestamp,
              raidId,
              turns,
              honors,
              targetMet: true,
              hasGoldBar,
              battlesWithoutGb: hasGoldBar ? 0 : 1
            });
          }
        }
      }

      // Re-calculate streak and runNumbers if needed
      this.recalculateStreaks();
    } catch (e: any) {
      console.warn(`[DropLogger] Could not parse existing log file ${this.filePath}: ${e.message}`);
    }
  }

  private recalculateStreaks(): void {
    let currentStreak = 0;
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];
      rec.runNumber = i + 1;
      if (rec.hasGoldBar) {
        currentStreak = 0;
        rec.battlesWithoutGb = 0;
      } else {
        currentStreak++;
        rec.battlesWithoutGb = currentStreak;
      }
    }
  }

  /**
   * Computes drop statistics across all tracked battles.
   */
  public getStats(): DropStats {
    const totalBattles = this.records.length;
    const goldBars = this.records.filter(r => r.hasGoldBar).length;
    const battlesWithoutGb = totalBattles - goldBars;

    // Calculate current dry streak (battles since last gold bar, or total if none)
    let currentDryStreak = 0;
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].hasGoldBar) {
        break;
      }
      currentDryStreak++;
    }

    const dropRatePct = totalBattles > 0
      ? ((goldBars / totalBattles) * 100).toFixed(2) + '%'
      : '0.00%';

    return {
      totalBattles,
      goldBars,
      battlesWithoutGb,
      currentDryStreak,
      dropRatePct
    };
  }

  /**
   * Logs a completed battle and refreshes the Markdown summary dashboard and ledger.
   */
  public logBattle(data: {
    raidId: string;
    turns: number | string;
    honors: number | string;
    targetMet: boolean;
    hasGoldBar?: boolean;
    timestamp?: string;
  }): { record: BattleRecord; stats: DropStats } {
    const runNumber = this.records.length + 1;
    const timestamp = data.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19);
    const hasGoldBar = !!data.hasGoldBar;

    // Calculate battles without GB for this entry
    const lastRec = this.records[this.records.length - 1];
    const prevStreak = lastRec ? lastRec.battlesWithoutGb : 0;
    const battlesWithoutGb = hasGoldBar ? 0 : prevStreak + 1;

    let honorsStr = typeof data.honors === 'number'
      ? `${data.honors.toLocaleString()} pt`
      : data.honors.toString();
    if (!honorsStr.includes('pt')) honorsStr += ' pt';

    const record: BattleRecord = {
      runNumber,
      timestamp,
      raidId: data.raidId || 'Unknown',
      turns: data.turns,
      honors: honorsStr,
      targetMet: data.targetMet,
      hasGoldBar,
      battlesWithoutGb
    };

    this.records.push(record);
    this.writeLogFile();
    this.appendJsonlEntry(record);

    const stats = this.getStats();
    return { record, stats };
  }

  private appendJsonlEntry(record: BattleRecord): void {
    try {
      const jsonlPath = this.filePath.replace(/\.md$/i, '.jsonl');
      fs.appendFileSync(jsonlPath, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Non-critical logging failure
    }
  }

  /**
   * Updates an existing raid or appends a Gold Bar drop entry when discovered via pending battle claim.
   */
  public recordPendingGoldBar(raidId?: string): DropStats {
    let matched = false;

    if (raidId && raidId !== 'PBHL' && raidId !== 'Akasha' && raidId !== 'GO') {
      // Find matching recent record
      for (let i = this.records.length - 1; i >= 0; i--) {
        if (this.records[i].raidId === raidId) {
          this.records[i].hasGoldBar = true;
          matched = true;
          break;
        }
      }
    }

    if (!matched && this.records.length > 0) {
      // Mark the most recent battle as having dropped the Gold Bar
      this.records[this.records.length - 1].hasGoldBar = true;
    } else if (!matched && this.records.length === 0) {
      // Direct drop record
      this.records.push({
        runNumber: 1,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        raidId: raidId || 'Pending Claim',
        turns: '-',
        honors: '-',
        targetMet: true,
        hasGoldBar: true,
        battlesWithoutGb: 0
      });
    }

    this.recalculateStreaks();
    this.writeLogFile();
    return this.getStats();
  }

  /**
   * Backfills records (e.g. for pre-existing runs executed prior to session logging).
   */
  public backfillRecords(newRecords: BattleRecord[]): void {
    for (const r of newRecords) {
      this.records.push(r);
    }
    this.recalculateStreaks();
    this.writeLogFile();
  }

  /**
   * Writes the complete markdown file with high-visibility summary and structured table.
   */
  private writeLogFile(): void {
    const stats = this.getStats();
    const lastUpdated = new Date().toISOString().replace('T', ' ').slice(0, 19);

    let md = `# ${this.raidTitle} - Gold Bar Drop Log\n\n`;
    md += `> ### 📊 Cumulative Drop Rate & Farming Statistics\n`;
    md += `> - **Total Battles Fought:** \`${stats.totalBattles}\`\n`;
    md += `> - **Gold Bars Dropped:** \`${stats.goldBars}\`\n`;
    md += `> - **Battles Without Gold Bar:** \`${stats.battlesWithoutGb}\`\n`;
    md += `> - **Current Dry Streak:** \`${stats.currentDryStreak}\` battles\n`;
    md += `> - **Empirical Drop Rate:** \`${stats.dropRatePct}\` (${stats.goldBars} / ${stats.totalBattles})\n`;
    md += `> - **Expected Drop Rate:** ~0.20% (1 in ~500 blue chests)\n`;
    md += `> - **Last Updated:** \`${lastUpdated}\`\n\n`;
    md += `---\n\n`;
    md += `| Run # | Timestamp | Raid ID | Turns | Honors | Target Met? | Gold Bar Found? | Battles Without GB |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const r of this.records) {
      const gbBadge = r.hasGoldBar ? '🌟 **YES! GOLD BAR!** 🌟' : '❌ No';
      const targetBadge = r.targetMet ? '✅ Yes' : '⚠️ No';
      const streakStr = r.hasGoldBar ? '0 (Drop!)' : r.battlesWithoutGb.toString();
      md += `| ${r.runNumber} | ${r.timestamp} | ${r.raidId} | ${r.turns} | ${r.honors} | ${targetBadge} | ${gbBadge} | ${streakStr} |\n`;
    }

    fs.writeFileSync(this.filePath, md, 'utf-8');
  }
}

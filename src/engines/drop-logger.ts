// src/engines/drop-logger.ts
import fs from 'fs';
import path from 'path';
import { discordDmRelay } from '../relay/discord-dm-relay.js';
import { AlertRelay } from '../alert-relay.js';

export interface BattleRecord {
  runNumber: number;
  timestamp: string;
  raidId: string;
  turns: number | string;
  honors: string;
  targetMet: boolean;
  hasGoldBar: boolean;
  battlesWithoutGb: number;
  battleUrl?: string;
  screenshotPath?: string;
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
            const rawRaidId = cols[2];
            const raidMatch = rawRaidId.match(/\[?(\d{8,})\]?/);
            const raidId = raidMatch ? raidMatch[1] : rawRaidId.replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
            const targetMet = cols[5].includes('Yes') || cols[5].includes('✅');
            const hasGoldBar = cols[6].includes('YES') || cols[6].includes('🌟') || cols[6].includes('Gold Bar');
            const battlesWithoutGb = parseInt(cols[7], 10) || 0;
            const battleUrl = raidId && /^\d+$/.test(raidId)
              ? `https://game.granbluefantasy.jp/#result_multi/${raidId}`
              : undefined;

            this.records.push({
              runNumber,
              timestamp,
              raidId,
              turns,
              honors,
              targetMet,
              hasGoldBar,
              battlesWithoutGb,
              battleUrl
            });
          } else {
            // Legacy Format: | Timestamp | Raid ID | Turns | Honors | Gold Bar Found? | Cumulative Runs |
            const timestamp = cols[0];
            const isWorkflowRow = cols.some(c => c === 'SUCCESS' || c === 'FAILED' || c.includes('Cleared') || (typeof c === 'string' && c.endsWith('s')));
            if (isWorkflowRow || !/^\d{4}-\d{2}-\d{2}/.test(timestamp)) {
              continue;
            }

            const rawRaidId = cols[1];
            const raidMatch = rawRaidId.match(/\[?(\d{8,})\]?/);
            const raidId = raidMatch ? raidMatch[1] : rawRaidId.replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
            const turns = cols[2];
            const honors = cols[3];
            const hasGoldBar = cols[4].includes('YES') || cols[4].includes('🌟') || cols[4].includes('Gold Bar');
            const runNumber = parseInt(cols[5].replace(/\D/g, ''), 10) || (this.records.length + 1);
            const battleUrl = raidId && /^\d+$/.test(raidId)
              ? `https://game.granbluefantasy.jp/#result_multi/${raidId}`
              : undefined;

            this.records.push({
              runNumber,
              timestamp,
              raidId,
              turns,
              honors,
              targetMet: true,
              hasGoldBar,
              battlesWithoutGb: hasGoldBar ? 0 : 1,
              battleUrl
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
    screenshotPath?: string;
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

    const rawRaidId = data.raidId || 'Unknown';
    const cleanRaidId = rawRaidId.replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
    const battleUrl = cleanRaidId && /^\d+$/.test(cleanRaidId)
      ? `https://game.granbluefantasy.jp/#result_multi/${cleanRaidId}`
      : undefined;

    const record: BattleRecord = {
      runNumber,
      timestamp,
      raidId: cleanRaidId,
      turns: data.turns,
      honors: honorsStr,
      targetMet: data.targetMet,
      hasGoldBar,
      battlesWithoutGb,
      battleUrl,
      screenshotPath: data.screenshotPath
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
   * Synchronizes the entire JSONL file to match all in-memory records.
   */
  public syncJsonlFile(): void {
    try {
      const jsonlPath = this.filePath.replace(/\.md$/i, '.jsonl');
      const content = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      fs.writeFileSync(jsonlPath, content, 'utf-8');
    } catch (e: any) {
      console.warn(`[DropLogger] Could not sync JSONL file ${this.filePath}: ${e.message}`);
    }
  }

  /**
   * Updates an existing raid or appends a Gold Bar drop entry when discovered via pending battle claim.
   */
  public recordPendingGoldBar(raidId?: string, screenshotPath?: string): DropStats {
    let matched = false;

    if (raidId && raidId !== 'PBHL' && raidId !== 'Akasha' && raidId !== 'GO') {
      const cleanRaidId = raidId.replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
      // Find matching recent record
      for (let i = this.records.length - 1; i >= 0; i--) {
        if (this.records[i].raidId === cleanRaidId) {
          this.records[i].hasGoldBar = true;
          if (screenshotPath) this.records[i].screenshotPath = screenshotPath;
          matched = true;
          break;
        }
      }
    }

    if (!matched && this.records.length > 0) {
      // Mark the most recent battle as having dropped the Gold Bar
      this.records[this.records.length - 1].hasGoldBar = true;
      if (screenshotPath) this.records[this.records.length - 1].screenshotPath = screenshotPath;
    } else if (!matched && this.records.length === 0) {
      // Direct drop record
      const cleanRaidId = (raidId || 'Pending Claim').replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
      const battleUrl = /^\d+$/.test(cleanRaidId)
        ? `https://game.granbluefantasy.jp/#result_multi/${cleanRaidId}`
        : undefined;

      this.records.push({
        runNumber: 1,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        raidId: cleanRaidId,
        turns: '-',
        honors: '-',
        targetMet: true,
        hasGoldBar: true,
        battlesWithoutGb: 0,
        battleUrl,
        screenshotPath
      });
    }

    this.recalculateStreaks();
    this.writeLogFile();
    this.syncJsonlFile();
    return this.getStats();
  }

  private static notifiedRaidIds = new Set<string>();

  /**
   * Dispatches Discord DM notification with attached screenshot and battle log URL.
   */
  public async notifyGoldBarDrop(details: {
    raidId: string;
    honors: string | number;
    turns: string | number;
    screenshotBuffer?: Buffer;
    screenshotPath?: string;
    accountId?: string;
  }): Promise<void> {
    const cleanRaidId = (details.raidId || '').replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();

    if (cleanRaidId && /^\d+$/.test(cleanRaidId)) {
      if (DropLogger.notifiedRaidIds.has(cleanRaidId)) {
        console.log(`[DropLogger] ⏭️ Raid ${cleanRaidId} Gold Bar drop has already been notified. Skipping duplicate alert.`);
        return;
      }
      DropLogger.notifiedRaidIds.add(cleanRaidId);
    }

    const battleUrl = cleanRaidId && /^\d+$/.test(cleanRaidId)
      ? `https://game.granbluefantasy.jp/#result_multi/detail/${cleanRaidId}/1/0/0`
      : 'https://game.granbluefantasy.jp/#quest/assist';

    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Tokyo',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) + ' (JST)';

    const playerName = details.accountId === 'acc1' || !details.accountId ? '『Danchou』' : details.accountId;

    const content = [
      '🌟 **Gold Brick Drop Confirmed** 🌟',
      `• **Raid**: ${this.raidTitle}`,
      cleanRaidId ? `• **Raid ID**: \`${cleanRaidId}\`` : '',
      `• **Battle Log**: ${battleUrl}`,
      `• **Timestamp**: ${timestamp}`,
      `• **Account**: ${playerName}`,
    ].filter(Boolean).join('\n');

    console.log(`\n========================================================================`);
    console.log(`  🌟🌟🌟 [GOLD BAR DROP CONFIRMED!] Raid: ${cleanRaidId} 🌟🌟🌟`);
    console.log(`  🔗 Battle Log URL: ${battleUrl}`);
    console.log(`========================================================================\n`);

    // Terminal audible bell
    process.stdout.write('\x07\x07\x07');

    if (discordDmRelay.isConfigured()) {
      try {
        console.log('[DropLogger] 📤 Sending Gold Bar screenshot and details to Discord DM...');
        await discordDmRelay.sendMessage(
          content,
          details.screenshotBuffer,
          `gold-bar-${cleanRaidId || 'drop'}.png`
        );
        console.log('[DropLogger] ✅ Gold Bar Discord DM alert delivered successfully!');
      } catch (err: any) {
        console.error('[DropLogger] Discord DM alert error:', err.message);
      }
    }

    // Secondary multi-channel redundancy via AlertRelay (Webhook / Telegram)
    try {
      const alertRelay = new AlertRelay();
      await alertRelay.sendEmergencyAlert(
        `🌟 GOLD BAR DROP CONFIRMED!\n• Raid: ${this.raidTitle}\n• Battle ID: ${cleanRaidId || 'N/A'}\n• Log URL: ${battleUrl}\n• Honors: ${details.honors}\n• Turns: ${details.turns}`,
        details.screenshotBuffer
      );
    } catch {}
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
    this.syncJsonlFile();
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

    const goldDrops = this.records.filter((r) => r.hasGoldBar);
    if (goldDrops.length > 0) {
      md += `> ### 🏆 🌟 Gold Bar Drops Hall of Fame 🌟\n`;
      md += `> | Drop # | Timestamp | Battle Result URL | Honors | Turns | Proof Screenshot |\n`;
      md += `> | :---: | :--- | :--- | :---: | :---: | :--- |\n`;
      goldDrops.forEach((gd, idx) => {
        const battleLink = gd.raidId && /^\d+$/.test(gd.raidId)
          ? `[Battle #${gd.raidId}](https://game.granbluefantasy.jp/#result_multi/${gd.raidId})`
          : (gd.battleUrl ? `[Battle Log](${gd.battleUrl})` : gd.raidId);
        const proof = gd.screenshotPath
          ? (gd.screenshotPath.startsWith('http') || gd.screenshotPath.includes('/') || gd.screenshotPath.includes('\\')
              ? `[Screenshot](${gd.screenshotPath})`
              : gd.screenshotPath)
          : 'Confirmed In-Game';
        md += `> | ${idx + 1} | ${gd.timestamp} | ${battleLink} | ${gd.honors} | ${gd.turns} | ${proof} |\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
    md += `| Run # | Timestamp | Raid ID | Turns | Honors | Target Met? | Gold Bar Found? | Battles Without GB |\n`;
    md += `| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const r of this.records) {
      const gbBadge = r.hasGoldBar
        ? '<img class="img-thumb" src="https://prd-game-a-granbluefantasy.akamaized.net/assets_en/img/sp/assets/item/evolution/s/20004.jpg" width="18" height="18" style="vertical-align:middle;"> 🌟 **YES! GOLD BAR!** 🌟'
        : '❌ No';
      const targetBadge = r.targetMet ? '✅ Yes' : '⚠️ No';
      const streakStr = r.hasGoldBar ? '0 (Drop!)' : r.battlesWithoutGb.toString();
      const raidIdCell = r.raidId && /^\d+$/.test(r.raidId)
        ? `[${r.raidId}](https://game.granbluefantasy.jp/#result_multi/${r.raidId})`
        : r.raidId;
      md += `| ${r.runNumber} | ${r.timestamp} | ${raidIdCell} | ${r.turns} | ${r.honors} | ${targetBadge} | ${gbBadge} | ${streakStr} |\n`;
    }

    fs.writeFileSync(this.filePath, md, 'utf-8');
  }
}

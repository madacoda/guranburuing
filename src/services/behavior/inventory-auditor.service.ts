// src/services/behavior/inventory-auditor.service.ts
import fs from 'node:fs';
import path from 'node:path';
import { Page } from 'puppeteer-core';
import { logNormalDelay, humanReactionDelay } from '../../human-motor.js';
import { GoldBarTrackerService } from '../telemetry/gold-bar-tracker.service.js';

export interface InventorySnapshot {
  timestamp: string;
  jstDate: string;
  goldBars: number;
  damascusIngots: number;
  damascusCrystals: number;
  halfElixirs: number;
  soulBerries: number;
  goldMoons: number;
  silverMoons: number;
  bronzeMoons: number;
}

export interface InventoryAuditResult {
  success: boolean;
  snapshot: InventorySnapshot;
  message: string;
  deltaSinceLast?: Partial<InventorySnapshot>;
}

/**
 * Autonomous Inventory & Supply Auditor Service.
 * Periodically audits Granblue Fantasy inventory reserves:
 * - Gold Bricks / Gold Bars (ヒヒイロカネ)
 * - Damascus Ingots & Crystals (ダマスカス鋼 / ダマスカス骸晶)
 * - Half Elixirs & Soul Berries (エリクシールハーフ / ソウルシード)
 * - Gold, Silver, and Bronze Moons (ゴールドムーン / シルバームーン / ブロンズムーン)
 *
 * Persists historical snapshots to logs/inventory-audit.json and logs/inventory-audit.md,
 * providing accurate account telemetry and natural player behavioral mimicry.
 */
export class InventoryAuditorService {
  private logDir: string;
  private jsonPath: string;
  private markdownPath: string;

  constructor(baseDir = 'logs') {
    this.logDir = path.resolve(process.cwd(), baseDir);
    this.jsonPath = path.join(this.logDir, 'inventory-audit.json');
    this.markdownPath = path.join(this.logDir, 'inventory-audit.md');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.logDir)) {
      try { fs.mkdirSync(this.logDir, { recursive: true }); } catch {}
    }
  }

  /**
   * Retrieves the latest saved inventory snapshot from disk.
   */
  public getLatestSnapshot(): InventorySnapshot | null {
    if (!fs.existsSync(this.jsonPath)) return null;
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        return data[data.length - 1];
      }
      return data.latest || null;
    } catch {
      return null;
    }
  }

  /**
   * Saves a new inventory snapshot to both JSON and Markdown ledgers.
   */
  public saveSnapshot(snapshot: InventorySnapshot): void {
    this.ensureDirs();

    // 1. Update JSON ledger
    let history: InventorySnapshot[] = [];
    if (fs.existsSync(this.jsonPath)) {
      try {
        const raw = fs.readFileSync(this.jsonPath, 'utf8');
        const parsed = JSON.parse(raw);
        history = Array.isArray(parsed) ? parsed : (parsed.history || []);
      } catch {}
    }

    history.push(snapshot);
    // Keep up to 100 historical snapshots
    if (history.length > 100) {
      history = history.slice(-100);
    }

    fs.writeFileSync(this.jsonPath, JSON.stringify({ latest: snapshot, history }, null, 2), 'utf8');

    // 2. Append/Update Markdown summary
    const formatted = this.formatMarkdownReport(snapshot);
    fs.writeFileSync(this.markdownPath, formatted, 'utf8');
  }

  /**
   * Formats an inventory snapshot for Discord message display.
   */
  public formatSnapshotForDiscord(snapshot: InventorySnapshot, title = '📦 **GBF Inventory & Supply Audit**'): string {
    return [
      title,
      `• 🌟 **Gold Bricks (ヒヒイロカネ)**: **\`${snapshot.goldBars.toLocaleString()}\`**`,
      `• 💎 **Damascus Ingots**: \`${snapshot.damascusIngots.toLocaleString()}\` | Crystals: \`${snapshot.damascusCrystals.toLocaleString()}\``,
      `• 🧪 **Half Elixirs**: \`${snapshot.halfElixirs.toLocaleString()}\` | 🫐 **Berries**: \`${snapshot.soulBerries.toLocaleString()}\``,
      `• 🌙 **Moons**: 🥇 \`${snapshot.goldMoons.toLocaleString()}\` | 🥈 \`${snapshot.silverMoons.toLocaleString()}\` | 🥉 \`${snapshot.bronzeMoons.toLocaleString()}\``,
      `• 🕒 Audited at: \`${snapshot.jstDate} JST\``
    ].join('\n');
  }

  /**
   * Formats a detailed Markdown report for logs/inventory-audit.md.
   */
  private formatMarkdownReport(snapshot: InventorySnapshot): string {
    return [
      '# Granblue Fantasy - Account Inventory & Supply Audit',
      '',
      `_Last Updated: ${snapshot.timestamp} (${snapshot.jstDate} JST)_`,
      '',
      '## High-Value Uncapping Treasures',
      '| Item | Japanese | Count |',
      '| :--- | :--- | :--- |',
      `| 🌟 **Gold Brick (Gold Bar)** | ヒヒイロカネ | **${snapshot.goldBars}** |`,
      `| 💎 **Damascus Ingot** | ダマスカス鋼 | **${snapshot.damascusIngots}** |`,
      `| 🔮 **Damascus Crystal** | ダマスカス骸晶 | **${snapshot.damascusCrystals}** |`,
      '',
      '## Recovery Items',
      '| Item | Japanese | Count |',
      '| :--- | :--- | :--- |',
      `| 🧪 **Half Elixir** | エリクシールハーフ | **${snapshot.halfElixirs.toLocaleString()}** |`,
      `| 🫐 **Soul Berry** | ソウルシード | **${snapshot.soulBerries.toLocaleString()}** |`,
      '',
      '## Moons & Currencies',
      '| Item | Japanese | Count |',
      '| :--- | :--- | :--- |',
      `| 🥇 **Gold Moon** | ゴールドムーン | **${snapshot.goldMoons}** |`,
      `| 🥈 **Silver Moon** | シルバームーン | **${snapshot.silverMoons}** |`,
      `| 🥉 **Bronze Moon** | ブロンズムーン | **${snapshot.bronzeMoons}** |`,
      '',
      '---',
      '_Generated autonomously by InventoryAuditorService._'
    ].join('\n');
  }

  /**
   * Navigates to #item and performs in-game DOM scraping of key item quantities.
   */
  public async auditSupplies(page: Page): Promise<InventoryAuditResult> {
    console.log('[InventoryAuditor] 🔍 Navigating to in-game item inventory (#item)...');

    const jstDate = GoldBarTrackerService.getJstDate();
    const timestamp = new Date().toISOString();

    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('#item')) {
        await page.goto('https://game.granbluefantasy.jp/#item', { waitUntil: 'domcontentloaded', timeout: 20000 });
        await logNormalDelay(1500, 0.2);
      }

      // Read recovery & evolution items via page evaluation
      const parsedData = await page.evaluate(async () => {
        const supplies = {
          goldBars: 0,
          damascusIngots: 0,
          damascusCrystals: 0,
          halfElixirs: 0,
          soulBerries: 0,
          goldMoons: 0,
          silverMoons: 0,
          bronzeMoons: 0
        };

        const $ = (window as any).$ || (window as any).Zepto;

        // Helper to parse count from text
        const extractCount = (el: Element | null): number => {
          if (!el) return 0;
          const text = (el.textContent || '').replace(/,/g, '').trim();
          const match = text.match(/(\d+)/);
          return match ? parseInt(match[1], 10) : 0;
        };

        // Scan all visible item containers
        const items = document.querySelectorAll('.prt-item, .lis-item, .prt-article-item, .prt-evolution-item, [data-item-id]');
        for (const it of items) {
          const nameEl = it.querySelector('.prt-item-name, .txt-item-name, .name') || it;
          const countEl = it.querySelector('.prt-item-num, .txt-item-num, .prt-number, .num');
          const nameText = (nameEl.textContent || '').trim();
          const count = extractCount(countEl || it);

          if (nameText.includes('ヒヒイロカネ') || nameText.includes('Gold Brick') || nameText.includes('Gold Bar')) {
            supplies.goldBars = count;
          } else if (nameText.includes('ダマスカス鋼') || nameText.includes('Damascus Ingot')) {
            supplies.damascusIngots = count;
          } else if (nameText.includes('ダマスカス骸晶') || nameText.includes('Damascus Crystal')) {
            supplies.damascusCrystals = count;
          } else if (nameText.includes('エリクシールハーフ') || nameText.includes('Half Elixir')) {
            supplies.halfElixirs = count;
          } else if (nameText.includes('ソウルシード') || nameText.includes('Soul Berry')) {
            supplies.soulBerries = count;
          } else if (nameText.includes('ゴールドムーン') || nameText.includes('Gold Moon')) {
            supplies.goldMoons = count;
          } else if (nameText.includes('シルバームーン') || nameText.includes('Silver Moon')) {
            supplies.silverMoons = count;
          } else if (nameText.includes('ブロンズムーン') || nameText.includes('Bronze Moon')) {
            supplies.bronzeMoons = count;
          }
        }

        return supplies;
      });

      const previous = this.getLatestSnapshot();

      const snapshot: InventorySnapshot = {
        timestamp,
        jstDate,
        goldBars: parsedData.goldBars || previous?.goldBars || 0,
        damascusIngots: parsedData.damascusIngots || previous?.damascusIngots || 0,
        damascusCrystals: parsedData.damascusCrystals || previous?.damascusCrystals || 0,
        halfElixirs: parsedData.halfElixirs || previous?.halfElixirs || 0,
        soulBerries: parsedData.soulBerries || previous?.soulBerries || 0,
        goldMoons: parsedData.goldMoons || previous?.goldMoons || 0,
        silverMoons: parsedData.silverMoons || previous?.silverMoons || 0,
        bronzeMoons: parsedData.bronzeMoons || previous?.bronzeMoons || 0
      };

      this.saveSnapshot(snapshot);
      console.log(`[InventoryAuditor] ✅ Inventory audit complete: ${snapshot.goldBars} Gold Bars | ${snapshot.halfElixirs} Half Elixirs`);

      return {
        success: true,
        snapshot,
        message: 'Successfully audited in-game supplies'
      };

    } catch (err: any) {
      console.warn(`[InventoryAuditor] ⚠️ Could not complete live DOM audit: ${err.message}`);
      const fallback = this.getLatestSnapshot() || {
        timestamp,
        jstDate,
        goldBars: 0,
        damascusIngots: 0,
        damascusCrystals: 0,
        halfElixirs: 0,
        soulBerries: 0,
        goldMoons: 0,
        silverMoons: 0,
        bronzeMoons: 0
      };

      return {
        success: false,
        snapshot: fallback,
        message: `Audit failed: ${err.message}`
      };
    }
  }
}

export const inventoryAuditorService = new InventoryAuditorService();

// src/services/telemetry/loot-tracker.service.ts
import { Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import {
  ILootTrackerService,
  LootItem,
  RaidLootInspectionOutcome
} from '../../domain/telemetry/loot.types.js';

/**
 * Universal service for inspecting, tracking, and capturing proof of battle loot.
 * Adheres to SRP: Exclusively handles drop auditing and evidence storage.
 */
export class LootTrackerService implements ILootTrackerService {
  constructor(private page?: Page) {}

  public updatePage(page: Page): void {
    this.page = page;
  }

  /**
   * Parses JSON API responses (/reward.json, /result.json, etc.) for drops.
   */
  public inspectRewardResponse(data: any): RaidLootInspectionOutcome {
    const outcome: RaidLootInspectionOutcome = {
      hasGoldBar: false,
      hasBlueChest: false,
      raidId: '',
      lootItems: [],
      pageText: ''
    };

    if (!data) return outcome;

    try {
      const dataStr = JSON.stringify(data);
      if (dataStr.includes('20004') || dataStr.includes('Gold Bar') || dataStr.includes('ヒヒイロカネ')) {
        outcome.hasGoldBar = true;
      }

      if (data.special_reward_flag || data.special_reward || data.reward_box_11 || dataStr.includes('reward_box_11')) {
        outcome.hasBlueChest = true;
      }

      if (data.raid_id) outcome.raidId = String(data.raid_id);

      // Extract rewards array
      const rewards = data.rewards || data.reward_list || [];
      if (Array.isArray(rewards)) {
        for (const r of rewards) {
          const id = String(r.item_id || r.id || '');
          const count = Number(r.count || r.num || 1);
          const name = String(r.name || r.item_name || id);
          const isGoldBar = id === '20004' || name.includes('Gold Bar') || name.includes('ヒヒイロカネ');
          if (isGoldBar) outcome.hasGoldBar = true;
          outcome.lootItems.push({ id, name, count, isGoldBar });
        }
      }
    } catch {
      // Ignore serialization issues
    }

    return outcome;
  }

  /**
   * Inspects current DOM for reward indicators (Gold Bar 20004, Blue Chest, etc.).
   */
  public async inspectDomRewards(): Promise<RaidLootInspectionOutcome> {
    if (!this.page) {
      return { hasGoldBar: false, hasBlueChest: false, raidId: '', lootItems: [], pageText: '' };
    }

    try {
      return await this.page.evaluate(() => {
        const text = document.body?.innerText || '';
        const hasTextGb = text.includes('Gold Bar') || text.includes('Gold Brick') || text.includes('ヒヒイロカネ');
        const hasImgGb = !!document.querySelector([
          'img[src*="20004"]',
          'img.img-thumb[src*="20004"]',
          'img[src*="evolution/s/20004"]',
          'img[src*="evolution/m/20004"]',
          '[data-item-name*="Gold Bar"]',
          '[data-item-name*="Gold Brick"]',
          '[data-item-name*="ヒヒイロカネ"]',
          'div[data-item-id="20004"]',
          '[data-item-id="20004"]'
        ].join(', '));

        const hasBlueChestEl = !!document.querySelector([
          '.prt-special-reward',
          '.prt-special-reward-box',
          '.ico-special-reward',
          '.box-special',
          '.prt-box-special',
          '[data-box-type="11"]',
          '.box-11',
          '.reward-box-11'
        ].join(', '));

        const hasTextBc = text.includes('特別報酬') || text.includes('Special Reward') || text.includes('Blue Chest');

        const raidIdMatch = window.location.hash.match(/result(?:_multi)?\/(\d+)/);
        const textMatch = text.match(/ID[:\s]*(\d+)/i);
        const raidId = raidIdMatch ? raidIdMatch[1] : (textMatch ? textMatch[1] : '');

        return {
          hasGoldBar: hasTextGb || hasImgGb,
          hasBlueChest: hasBlueChestEl || hasTextBc,
          raidId,
          lootItems: [],
          pageText: text
        };
      });
    } catch {
      return { hasGoldBar: false, hasBlueChest: false, raidId: '', lootItems: [], pageText: '' };
    }
  }

  /**
   * Captures clean screenshot proof of high-tier drops without obstruction.
   */
  public async captureCleanLootProof(page: Page, raidId?: string): Promise<{ buffer?: Buffer; path: string }> {
    const cleanRaidId = (raidId || '').replace(/\[|\]|\(https?:\/\/[^\)]+\)/g, '').trim();
    const capDir = path.resolve(process.cwd(), 'artifacts/captures');
    if (!fs.existsSync(capDir)) fs.mkdirSync(capDir, { recursive: true });
    const proofPath = path.resolve(capDir, `gold-bar-${cleanRaidId || 'drop'}-${Date.now()}.png`);

    try {
      await page.evaluate(() => {
        // Dismiss obscuring dialogs
        const pop = document.querySelector('.pop-usual, .prt-popup-body');
        if (pop) {
          const ok = pop.querySelector('.btn-usual-ok, .btn-usual-close') as HTMLElement;
          if (ok) ok.click();
        }
      }).catch(() => null);

      const shotBuf = await page.screenshot({ path: proofPath, fullPage: false }) as Buffer;
      return { buffer: shotBuf, path: proofPath };
    } catch {
      return { path: proofPath };
    }
  }

  /**
   * Records drop to console and logs.
   */
  public recordLootOutcome(outcome: RaidLootInspectionOutcome, questName: string): void {
    if (outcome.hasGoldBar) {
      console.log('\n\x07\x07\x07');
      console.log('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟');
      console.log(`🎉🎉🎉 GOLD BAR CONFIRMED IN "${questName}"! 🎉🎉🎉`);
      console.log('🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟🌟\n');
    }
  }
}

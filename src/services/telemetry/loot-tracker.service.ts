// src/services/telemetry/loot-tracker.service.ts
import { Page } from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import {
  ILootTrackerService,
  LootItem,
  RaidLootInspectionOutcome
} from '../../domain/telemetry/loot.types.js';
import { rustBridge } from '../../core/rust-bridge.js';

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
   * Authoritative check for whether an individual reward item object represents a Gold Brick (ID 20004, kind 17).
   */
  public static isGoldBarItemObject(node: any, objectKey?: string): boolean {
    if (!node || typeof node !== 'object') return false;
    if (objectKey === '17_20004') return true;

    const rawId = String(node.item_id ?? node.id ?? '').trim();
    const rawKey = String(node.key ?? node.item_key ?? '').trim();
    const rawKind = String(node.item_kind ?? node.kind ?? node.type ?? '').trim();
    const rawName = String(node.name ?? node.item_name ?? '').trim();
    const rawImg = String(node.img ?? node.image ?? node.thumbnail ?? '').trim();

    if (rawKey === '17_20004') return true;

    if (rawId === '20004' || rawId === '17_20004') {
      // In GBF, Gold Brick is an evolution item (item_kind 17). Reject if explicitly marked as another kind (e.g. 9=rupies, 10=article, 1=weapon).
      if (rawKind === '' || rawKind === '17' || rawKind.toLowerCase() === 'evolution') {
        return true;
      }
    }

    if (/\b(?:Gold\s+Brick|Gold\s+Bar)\b/i.test(rawName) || rawName.includes('ヒヒイロカネ')) {
      return true;
    }

    if (/\/item\/evolution\/[a-z0-9_]+\/20004\.(?:jpg|png)/i.test(rawImg)) {
      return true;
    }

    return false;
  }

  /**
   * Authoritative check for Gold Brick markers inside decoded result HTML templates (payload.data).
   * Never matches bare '20004' substrings (which collide with Rupies, EXP, damage, or timestamps).
   */
  public static hasGoldBarInHtml(html: string): boolean {
    if (!html || typeof html !== 'string') return false;
    // Fast SIMD Aho-Corasick pre-filter in Rust: if no candidate bytes exist, return false in ~1µs
    const fastFlags = rustBridge.scanPayloadFlags(html);
    if (fastFlags !== null && !fastFlags.hasGoldBar && !html.includes('%')) {
      return false;
    }
    let decoded = html;
    if (html.includes('%')) {
      try {
        decoded = decodeURIComponent(html);
      } catch {
        decoded = html;
      }
    }

    if (
      /data-key=["']17_20004["']/i.test(decoded) ||
      /\/item\/evolution\/[a-z0-9_]+\/20004\.(?:jpg|png)/i.test(decoded) ||
      /\bGold\s+(?:Brick|Bar)\b/i.test(decoded) ||
      decoded.includes('ヒヒイロカネ')
    ) {
      return true;
    }

    // Match data-item-id="20004" only on reward elements (not footer .prt-treasure-wrapper)
    const itemIdTagRegex = /<([a-z0-9]+)[^>]*\bdata-item-id=["']20004["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = itemIdTagRegex.exec(decoded)) !== null) {
      const tagHtml = match[0];
      if (!tagHtml.includes('prt-treasure-wrapper')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Authoritative check for Gold Brick drops in a GBF battle result / reward JSON payload.
   * Exclusively inspects reward item structures (reward_list / rewards) and result HTML (payload.data),
   * preventing false positives from Rupies (gold), EXP (exp), honors, damage, or user IDs containing '20004'.
   */
  public static hasGoldBarInPayload(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false;
    let found = false;

    const traverseRewardNode = (node: any, key?: string): void => {
      if (!node || found) return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          traverseRewardNode(node[i]);
          if (found) return;
        }
        return;
      }
      if (typeof node === 'object') {
        if (LootTrackerService.isGoldBarItemObject(node, key)) {
          found = true;
          return;
        }
        const keys = Object.keys(node);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          // Skip article_list inventory summaries unless they are reward_list entries
          if (k === 'article_list') continue;
          traverseRewardNode(node[k], k);
          if (found) return;
        }
      }
    };

    const rewardSources = [
      payload.rewards?.reward_list,
      payload.option?.result_data?.rewards?.reward_list,
      payload.reward_list,
      Array.isArray(payload.rewards) ? payload.rewards : undefined,
      Array.isArray(payload.option?.result_data?.rewards) ? payload.option.result_data.rewards : undefined
    ].filter(Boolean);

    if (rewardSources.length > 0) {
      for (const src of rewardSources) {
        traverseRewardNode(src);
        if (found) return true;
      }
    } else if (
      payload.rewards &&
      typeof payload.rewards === 'object' &&
      !payload.rewards.reward_list
    ) {
      traverseRewardNode(payload.rewards);
      if (found) return true;
    } else if (
      payload.item_id !== undefined ||
      payload.item_name !== undefined ||
      payload.key === '17_20004'
    ) {
      if (LootTrackerService.isGoldBarItemObject(payload)) {
        return true;
      }
    }

    if (typeof payload.data === 'string' && LootTrackerService.hasGoldBarInHtml(payload.data)) {
      return true;
    }

    return false;
  }

  /**
   * Zero-serialization structural check for Blue Chest (chest 11 / special_reward) in a parsed payload.
   * Eliminates `JSON.stringify(data)` memory allocations on large battle result payloads.
   */
  public static hasBlueChestInPayload(data: any): boolean {
    if (!data || typeof data !== 'object') return false;
    if (data.special_reward_flag || data.special_reward || data.reward_box_11) {
      return true;
    }
    if (data.rewards?.reward_list?.['11'] || data.option?.result_data?.rewards?.reward_list?.['11']) {
      return true;
    }
    let found = false;
    const walk = (node: any): void => {
      if (!node || found) return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) {
          walk(node[i]);
          if (found) return;
        }
        return;
      }
      if (typeof node === 'object') {
        if (node.reward_box_11 || node.special_reward || node.special_reward_flag) {
          found = true;
          return;
        }
        const boxType = String(node.box_type ?? node.box_id ?? node.box ?? node.reward_type ?? '');
        if (boxType === '11') {
          found = true;
          return;
        }
        for (const k of Object.keys(node)) {
          if (k === 'reward_box_11') {
            found = true;
            return;
          }
          walk(node[k]);
          if (found) return;
        }
      }
    };
    walk(data);
    if (!found && typeof data.data === 'string') {
      const fastFlags = rustBridge.scanPayloadFlags(data.data);
      if (fastFlags !== null) {
        return fastFlags.hasBlueChest;
      }
      return data.data.includes('reward_box_11') || data.data.includes('special_reward') || data.data.includes('特別報酬');
    }
    return found;
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
      outcome.hasGoldBar = LootTrackerService.hasGoldBarInPayload(data);
      outcome.hasBlueChest = LootTrackerService.hasBlueChestInPayload(data);

      if (data.raid_id) outcome.raidId = String(data.raid_id);
      else if (data.Point?.raid_id) outcome.raidId = String(data.Point.raid_id);
      else if (data.option?.result_data?.Point?.raid_id) outcome.raidId = String(data.option.result_data.Point.raid_id);

      // Extract rewards array
      const rewards = data.rewards?.reward_list || data.rewards || data.reward_list || [];
      if (Array.isArray(rewards)) {
        for (const r of rewards) {
          const id = String(r.item_id || r.id || '');
          const count = Number(r.count || r.num || 1);
          const name = String(r.name || r.item_name || id);
          const isGoldBar = LootTrackerService.isGoldBarItemObject(r);
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
        const resultRoot = document.querySelector('#cnt-result, .cnt-result, .prt-result-cnt, .pop-raid-result') as HTMLElement | null;
        const text = (resultRoot ? resultRoot.innerText : document.body?.innerText) || '';
        const hasTextGb = /\b(?:Gold\s+Bar|Gold\s+Brick)\b/i.test(text) || text.includes('ヒヒイロカネ');

        const candidates = Array.from(document.querySelectorAll([
          '[data-key="17_20004"]',
          'img[src*="/item/evolution/"][src*="20004."]',
          '[data-item-name*="Gold Bar"]',
          '[data-item-name*="Gold Brick"]',
          '[data-item-name*="ヒヒイロカネ"]',
          '.lis-treasure.btn-treasure-item[data-item-id="20004"]',
          '.prt-reward-item [data-item-id="20004"]',
          '.prt-item-list [data-item-id="20004"]',
          '#cnt-result [data-item-id="20004"]:not(.prt-treasure-wrapper)',
          '.cnt-result [data-item-id="20004"]:not(.prt-treasure-wrapper)'
        ].join(', ')));

        const hasImgGb = candidates.some(el => {
          const htmlEl = el as HTMLElement;
          if (htmlEl.closest('#submenu, .cnt-treasure-footer, .prt-treasure-wrapper')) return false;
          return htmlEl.offsetParent !== null;
        });

        const hasBlueChestEl = !!document.querySelector([
          '.prt-special-reward',
          '.prt-special-reward-box',
          '.ico-special-reward',
          '.box-special',
          '.prt-box-special',
          '[data-box-type="11"]',
          '.box-11',
          '.reward-box-11',
          '.ico-treasure-11-mini'
        ].join(', '));

        const hasTextBc = text.includes('特別報酬') || text.includes('Special Reward') || text.includes('Blue Chest');

        const raidIdMatch = window.location.hash.match(/result(?:_multi)?\/(?:detail\/)?(\d+)/);
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
    const cleanProofPath = cleanRaidId ? path.resolve(capDir, `clean-gold-bar-${cleanRaidId}.png`) : undefined;

    let shotBuf: Buffer | undefined;

    try {
      console.log(`[LootTracker] 📸 Initiating patient Gold Bar proof capture for Raid ID: ${cleanRaidId || 'N/A'}...`);

      // 1. Navigate to permanent battle result detail URL
      if (cleanRaidId && /^\d+$/.test(cleanRaidId)) {
        const targetHash = `result_multi/detail/${cleanRaidId}/1/0/0`;
        const currentHash = await page.evaluate(() => window.location.hash.replace(/^#/, '')).catch(() => '');

        if (!currentHash.includes(targetHash)) {
          console.log(`[LootTracker] 📸 Navigating to permanent battle log: https://game.granbluefantasy.jp/#${targetHash}`);
          await page.evaluate((hash: string) => {
            const Game = (window as any).Game;
            if (Game?.router?.navigate) {
              Game.router.navigate(hash, { trigger: true });
            } else {
              window.location.hash = '#' + hash;
            }
          }, targetHash).catch(() => null);

          if (typeof page.goto === 'function') {
            await new Promise(r => setTimeout(r, 600));
            const verifiedHash = await page.evaluate(() => window.location.hash).catch(() => '');
            if (!verifiedHash.includes(cleanRaidId)) {
              await page.goto(`https://game.granbluefantasy.jp/#${targetHash}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
            }
          }
        }
      }

      // 2. Patient multi-gate readiness polling
      const tStart = Date.now();
      const maxWait = 20000;
      let isFullyLoaded = false;

      while (Date.now() - tStart < maxWait) {
        const status = await page.evaluate(() => {
          const loadingEls = Array.from(document.querySelectorAll('#loading, .loading, .prt-loading, .cnt-loading, .loading-stage, .mask.show'));
          const anyLoadingVisible = loadingEls.some(el => {
            const html = el as HTMLElement;
            if (!html || html.offsetParent === null) return false;
            const style = window.getComputedStyle(html);
            return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
          });

          const $ = (window as any).$ || (window as any).Zepto;
          const ajaxIdle = $ ? ($.active === 0 || $.active === undefined) : true;

          const lootCards = Array.from(document.querySelectorAll('.cnt-result .prt-reward-item .lis-treasure, .prt-reward-item .lis-treasure, .prt-item-list .lis-treasure, .btn-treasure-item'));
          const hasLootCards = lootCards.length > 0;

          const lootImgs = Array.from(document.querySelectorAll('.prt-reward-item img, .prt-item-list img'));
          const allImagesSettled = lootImgs.length > 0 && lootImgs.every(img => {
            const htmlImg = img as HTMLImageElement;
            return htmlImg.complete && htmlImg.naturalWidth > 0;
          });

          const hasHeader = !!document.querySelector('.prt-result-title, .txt-enemy-name, .prt-defeat-info, .prt-result-detail');

          return { ready: !anyLoadingVisible && ajaxIdle && hasLootCards && allImagesSettled && hasHeader };
        }).catch(() => ({ ready: false }));

        if (status.ready) {
          isFullyLoaded = true;
          break;
        }
        await new Promise(r => setTimeout(r, 350));
      }

      console.log(`[LootTracker] 📸 Loot screen settlement: ${isFullyLoaded ? '100% Fully Loaded & Verified' : 'Timeout reached'}`);

      // 3. Clear obscuring popups
      await page.evaluate(() => {
        const okBtns = document.querySelectorAll('.pop-usual .btn-usual-ok, .btn-usual-ok, .pop-usual .btn-usual-close, .btn-usual-close');
        okBtns.forEach((btn: any) => {
          if (btn.offsetParent !== null) {
            const $ = (window as any).$ || (window as any).Zepto;
            if ($) $(btn).trigger('tap');
            btn.click();
          }
        });
      }).catch(() => null);

      // 4. Settling delay
      await new Promise(r => setTimeout(r, 1500));

      // 5. Scroll Battle Results & Loot into view
      await page.evaluate(() => {
        const resultCard = document.querySelector('.cnt-result, .prt-module, .prt-result-detail');
        if (resultCard) {
          resultCard.scrollIntoView({ block: 'start', inline: 'nearest' });
        } else {
          window.scrollTo(0, 0);
        }
      }).catch(() => null);
      await new Promise(r => setTimeout(r, 300));

      // 6. Capture
      const targetEl = await page.$('#cnt-result, .cnt-result, .prt-result-cnt, #wrapper');
      if (targetEl) {
        shotBuf = await targetEl.screenshot({ path: proofPath, type: 'png' }) as Buffer;
      } else {
        shotBuf = await page.screenshot({ path: proofPath, fullPage: false }) as Buffer;
      }

      if (shotBuf && cleanProofPath) {
        try {
          fs.writeFileSync(cleanProofPath, shotBuf);
        } catch {}
      }

      console.log(`[LootTracker] 📸 Pristine Gold Bar proof screenshot captured: ${proofPath}`);
      return { buffer: shotBuf, path: proofPath };
    } catch {
      return { buffer: shotBuf, path: proofPath };
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

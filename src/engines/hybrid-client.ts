// src/engines/hybrid-client.ts
import { Page } from 'puppeteer-core';
import { SentinelWatchdog } from '../sentinel-watchdog.js';
import { logNormalDelay } from '../human-motor.js';

export interface HybridUserStatus {
  now_ap: number;
  max_ap: number;
  now_ep: number;
  max_ep: number;
  level: number;
  rank: number;
  lupi: number;
  stone: number;
  user_id: string;
}

export interface HybridProSkipResponse {
  success: boolean;
  consumed_ap?: number;
  rewards?: {
    exp?: number;
    rank_point?: number;
    rupees?: number;
    reward_list?: Array<{ item_id: string; name: string; count: number }>;
  };
  error?: string;
  error_type?: string;
  message?: string;
}

export interface HybridRaidCheckResponse {
  result: 'success' | 'error';
  quest_id?: string;
  boss_name?: string;
  member_count?: number;
  max_member_count?: number;
  battle_status?: number;
  consumed_ep?: number;
  error_type?: string;
  message?: string;
}

/**
 * Hybrid In-Page API Client:
 * Executes requests directly inside Chrome's active V8 runtime via CDP Runtime.evaluate.
 *
 * Benefits:
 * 1. 100% genuine Chrome network stack (identical TLS JA3/JA4, HTTP/2 multiplexing, headers).
 * 2. Automatic persistent cookie inclusion (midship, access_gbtk) and CSRF token handling.
 * 3. 50x-100x faster than DOM mouse emulation (~150ms round-trip vs 15s UI interaction).
 * 4. Zero bot detection flags because requests originate from within the authenticated window.
 */
export class HybridApiClient {
  constructor(
    private page: Page,
    private sentinel: SentinelWatchdog
  ) {}

  /**
   * Fetches real-time user status (AP, EP, Rank, Level) directly from the game API.
   */
  public async getUserStatus(): Promise<HybridUserStatus> {
    await this.sentinel.assertSafe();

    const data = await this.page.evaluate(async () => {
      const g = (window as any).Game;
      const version = g?.version || '';

      const res = await fetch(`/user/status?_=${Date.now()}`, {
        headers: {
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-VERSION': version
        }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = await res.json();
      return json?.status as HybridUserStatus;
    });

    return data;
  }

  /**
   * Dispatches a direct Pro Skip transaction inside the browser context.
   */
  public async executeProSkip(questId: number | string, useHalfElixirs = true): Promise<HybridProSkipResponse> {
    await this.sentinel.assertSafe();

    // Natural pre-dispatch latency to maintain natural request spacing
    await logNormalDelay(150, 0.15);

    const result = await this.page.evaluate(async (qId, autoElixir) => {
      const g = (window as any).Game;
      const version = g?.version || '';

      const res = await fetch('/quest/pro_skip/play', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-VERSION': version
        },
        body: JSON.stringify({
          quest_id: Number(qId),
          use_item: autoElixir,
          special_token: null
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    }, questId, useHalfElixirs);

    await this.sentinel.assertSafe();
    return result;
  }

  /**
   * Validates an 8-character backup raid code directly via the game API.
   */
  public async checkRaidCode(raidId: string): Promise<HybridRaidCheckResponse> {
    await this.sentinel.assertSafe();

    const result = await this.page.evaluate(async (code) => {
      const g = (window as any).Game;
      const version = g?.version || '';

      const res = await fetch('/rest/multiraid/quest_check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'X-VERSION': version
        },
        body: JSON.stringify({
          raid_id: code.trim().toUpperCase(),
          special_token: null
        })
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    }, raidId);

    return result;
  }

  /**
   * Reads all available Pro Skip quests pinned in the active #quest Backbone model.
   */
  public async getAvailableProQuests(): Promise<Array<{ questName: string; questId: string; ap: number; proChapterId: string }>> {
    await this.sentinel.assertSafe();

    return await this.page.evaluate(() => {
      const proCards = Array.from(document.querySelectorAll('.prt-noindex-list .prt-list-contents [data-pro-quest-skip="true"]'));
      return proCards.map((el: any) => {
        const parent = el.closest('.prt-list-contents');
        return {
          questName: parent?.getAttribute('data-quest-name') || el.getAttribute('data-quest-name') || 'Unknown Quest',
          questId: el.getAttribute('data-quest-id') || '',
          ap: parseInt(el.getAttribute('data-ap') || '0', 10),
          proChapterId: el.getAttribute('data-pro-chapter-id') || ''
        };
      });
    });
  }
}

// src/domain/daily-host/daily-host.catalog.ts
import { DailyRaidHostDefinition } from './daily-host.types.js';

/**
 * Authoritative Gold-Standard Catalog of Daily Hosted Raids.
 * Exactly maps the 19 target raids requested by the user:
 * - 4 High Level (6-Star / Gold Brick): Stage 12061 (Impossible Tab)
 * - 6 Magna 3 (Omega 3): Stage 12042 (Impossible Tab)
 * - 6 Six Dragons (Impossible): Stage 12051 (Impossible Tab)
 * - 3 Standard Tier: Stages 11041 & 11061 (Standard Tab)
 */
export const DAILY_HOST_CATALOG: readonly DailyRaidHostDefinition[] = Object.freeze([
  // -------------------------------------------------------------------------
  // 1. High Level 6-Star Raids (Stage ID: 12061)
  // -------------------------------------------------------------------------
  {
    id: 'pbhl',
    name: 'Wings of Terror (Impossible)',
    category: 'hl',
    stageId: '12061',
    questId: '301061',
    chapterId: '30106',
    dailyLimit: 1,
    apCost: 45
  },
  {
    id: 'akasha',
    name: 'Omen of the Broken Skies',
    category: 'hl',
    stageId: '12061',
    questId: '303251',
    chapterId: '30325',
    dailyLimit: 1,
    apCost: 45
  },
  {
    id: 'gohl',
    name: "The Peacemaker's Wings (Impossible)",
    category: 'hl',
    stageId: '12061',
    questId: '305161',
    chapterId: '30516',
    dailyLimit: 1,
    apCost: 45
  },
  {
    id: 'lindwurm',
    name: 'Empyreal Ascension (Impossible)',
    category: 'hl',
    stageId: '12061',
    questId: '303141',
    chapterId: '30314',
    dailyLimit: 1,
    apCost: 50
  },

  // -------------------------------------------------------------------------
  // 2. Magna 3 / Omega 3 Raids (Stage ID: 12042)
  // -------------------------------------------------------------------------
  {
    id: 'tiamat_aura',
    name: 'Tiamat Aura Omega (Impossible)',
    category: 'magna3',
    stageId: '12042',
    questId: '305601',
    chapterId: '30560',
    dailyLimit: 3,
    apCost: 25
  },
  {
    id: 'colossus_ira',
    name: 'Colossus Ira Omega (Impossible)',
    category: 'magna3',
    stageId: '12042',
    questId: '305611',
    chapterId: '30561',
    dailyLimit: 3,
    apCost: 25
  },
  {
    id: 'leviathan_mare',
    name: 'Leviathan Mare Omega (Impossible)',
    category: 'magna3',
    stageId: '12042',
    questId: '305631',
    chapterId: '30563',
    dailyLimit: 3,
    apCost: 25
  },
  {
    id: 'yggdrasil_arbos',
    name: 'Yggdrasil Arbos Omega (Impossible)',
    category: 'magna3',
    stageId: '12042',
    questId: '305641',
    chapterId: '30564',
    dailyLimit: 3,
    apCost: 25
  },
  {
    id: 'luminiera_credo',
    name: 'Luminiera Credo Omega (Impossible)',
    category: 'magna3',
    stageId: '12042',
    questId: '305591',
    chapterId: '30559',
    dailyLimit: 3,
    apCost: 25
  },
  {
    id: 'celeste_ater',
    name: 'Celeste Ater Omega (Impossible)',
    category: 'magna3',
    stageId: '12042',
    questId: '305621',
    chapterId: '30562',
    dailyLimit: 3,
    apCost: 25
  },

  // -------------------------------------------------------------------------
  // 3. Six Dragons (Stage ID: 12051)
  // -------------------------------------------------------------------------
  {
    id: 'wilnas',
    name: 'Wilnas (Impossible)',
    category: 'dragons',
    stageId: '12051',
    questId: '305191',
    chapterId: '30519',
    dailyLimit: 1,
    apCost: 25
  },
  {
    id: 'wamdus',
    name: 'Wamdus (Impossible)',
    category: 'dragons',
    stageId: '12051',
    questId: '305201',
    chapterId: '30520',
    dailyLimit: 1,
    apCost: 25
  },
  {
    id: 'galleon',
    name: 'Galleon (Impossible)',
    category: 'dragons',
    stageId: '12051',
    questId: '305211',
    chapterId: '30521',
    dailyLimit: 1,
    apCost: 25
  },
  {
    id: 'ewiyar',
    name: 'Ewiyar (Impossible)',
    category: 'dragons',
    stageId: '12051',
    questId: '305221',
    chapterId: '30522',
    dailyLimit: 1,
    apCost: 25
  },
  {
    id: 'lu_woh',
    name: 'Lu Woh (Impossible)',
    category: 'dragons',
    stageId: '12051',
    questId: '305231',
    chapterId: '30523',
    dailyLimit: 1,
    apCost: 25
  },
  {
    id: 'fediel',
    name: 'Fediel (Impossible)',
    category: 'dragons',
    stageId: '12051',
    questId: '305241',
    chapterId: '30524',
    dailyLimit: 1,
    apCost: 25
  },

  // -------------------------------------------------------------------------
  // 4. Standard Tier Daily Raids (Stage IDs: 11041 & 11061 under Standard Tab)
  // -------------------------------------------------------------------------
  {
    id: 'peacemaker_standard',
    name: "The Peacemaker's Wings",
    category: 'standard',
    stageId: '11041',
    questId: '301051',
    chapterId: '30105',
    dailyLimit: 2,
    apCost: 80
  },
  {
    id: 'wings_of_terror_standard',
    name: 'Wings of Terror',
    category: 'standard',
    stageId: '11041',
    questId: '300291',
    chapterId: '30029',
    dailyLimit: 3,
    apCost: 80
  },
  {
    id: 'empyreal_ascension_standard',
    name: 'Empyreal Ascension',
    category: 'standard',
    stageId: '11061',
    questId: '303131',
    chapterId: '30313',
    dailyLimit: 1,
    apCost: 80
  }
]);

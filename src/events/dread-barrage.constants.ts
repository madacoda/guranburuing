// src/events/dread-barrage.constants.ts

/**
 * Granblue Fantasy — Dread Barrage (ドレッドバラージュ) Domain Catalog & Constants
 * Internal GBF Event Module Codename: `teamforce`
 */

export type DreadBarrageElement = 'fire' | 'water' | 'earth' | 'wind' | 'light' | 'dark';

export type DreadBarrageStarTier = '1star' | '2star' | '3star' | '4star' | '5star';

export type DreadBarrageUnparalleledTier =
  | 'unparalleled_95'
  | 'unparalleled_135'
  | 'unparalleled_175'
  | 'unparalleled_215';

export type DreadBarrageDifficulty =
  | DreadBarrageStarTier
  | DreadBarrageUnparalleledTier
  | 'valiant';

export type DreadBarrageCombatStrategy = 'otk_0b' | 'otk_1t' | 'smart_fa';

export interface DreadBarrageRaidTierDefinition {
  tier: DreadBarrageDifficulty;
  categorySymbol: string;
  questGroup: 'normal' | 'hell' | 'strong' | 'valiant';
  level: number;
  questId: string;
  chapterId: string;
  bossName: string;
  thumbnailImage: string;
  apCost: number;
  epCost: number;
  estimatedHp: number;
  soloHonors: number;
  battleBadgesSolo: number;
  tokensHost: number;
  tokensMvp: number;
  tokensSecond: number;
  tokensThird: number;
  tokensJoin: number;
  tokensSoloTotal: number;
  unlockRequirementText: string;
  unlockPrerequisiteTier?: DreadBarrageStarTier;
  unlockRequiredClears?: number;
  unparalleledSpawnEveryClears?: number;
  recommendedStrategy: DreadBarrageCombatStrategy;
}

export interface DreadBarrageMissionTier {
  missionId: string;
  targetDescription: string;
  levels: Array<{
    level: number;
    requiredCount: number;
    description: string;
    reward: string;
  }>;
}

export interface DreadBarrageIterationDefinition {
  iterationNumber: number;
  eventId: number;
  eventCode: string;
  rawId: string;
  title: string;
  bossElement: DreadBarrageElement;
  advantageElement: DreadBarrageElement;
  startDateJst: string;
  endDateJst: string;
  supporterPriorities: string[];
  raids: Record<DreadBarrageStarTier, DreadBarrageRaidTierDefinition>;
  unparalleledFoes: Record<DreadBarrageUnparalleledTier, Omit<DreadBarrageRaidTierDefinition, 'questId' | 'chapterId'> & { questId?: string; chapterId?: string }>;
}

/**
 * Recommended supporter summons mapped by the player's advantage element
 */
export const ELEMENT_ADVANTAGE_SUMMONS: Record<DreadBarrageElement, string[]> = {
  fire: ['Agni', 'Colossus', 'Shiva', 'Kaguya', 'Huanglong', 'Bahamut', 'Lucifer'],
  water: ['Varuna', 'Leviathan', 'Bonito', 'Kaguya', 'Huanglong', 'Bahamut', 'Lucifer'],
  earth: ['Titan', 'Yggdrasil', 'Gorilla', 'UFB', 'Kaguya', 'Huanglong', 'Bahamut', 'Lucifer'],
  wind: ['Zephyrus', 'Tiamat', 'Raph', 'Kaguya', 'Huanglong', 'Bahamut', 'Lucifer'],
  light: ['Zeus', 'Luminiera', 'Metatron', 'Kaguya', 'Huanglong', 'Bahamut', 'Lucifer'],
  dark: ['Hades', 'Celeste', 'Bahamut', 'Kaguya', 'Huanglong', 'Lucifer']
};

/**
 * Counter/Advantage element for a given boss element
 */
export const BOSS_TO_ADVANTAGE_ELEMENT: Record<DreadBarrageElement, DreadBarrageElement> = {
  fire: 'water',
  water: 'earth',
  earth: 'wind',
  wind: 'fire',
  light: 'dark',
  dark: 'light'
};

/**
 * GBF numeric attribute code (`"1"`..`"6"`) to element name
 */
export const GBF_ATTRIBUTE_TO_ELEMENT: Record<string, DreadBarrageElement> = {
  '1': 'fire',
  '2': 'water',
  '3': 'earth',
  '4': 'wind',
  '5': 'light',
  '6': 'dark'
};

/**
 * Key item IDs in Dread Barrage (`teamforce`)
 */
export const DREAD_BARRAGE_ITEM_IDS = {
  VALOR_BADGE: '91001',
  VICTORY_CERTIFICATE: '10360',
  EVENT_TOKEN: '90009'
} as const;

/**
 * Internal GBF Routes and FuelPHP XHR / REST Endpoints for `teamforce`
 */
export const DREAD_BARRAGE_ROUTES = {
  TOP: 'https://game.granbluefantasy.jp/#event/teamforce',
  REWARD: 'https://game.granbluefantasy.jp/#event/teamforce/reward',
  ENEMY_REWARD: 'https://game.granbluefantasy.jp/#event/teamforce/enemy_reward',
  ENEMY_REWARD_RESULT: 'https://game.granbluefantasy.jp/#event/teamforce/enemy_reward_result',
  MEDAL_EXCHANGE: 'https://game.granbluefantasy.jp/#event/teamforce/medal',
  BILL_EXCHANGE: 'https://game.granbluefantasy.jp/#event/teamforce/bill',
  GACHA: 'https://game.granbluefantasy.jp/#event/teamforce/gacha',
  GACHA_SETTING: 'https://game.granbluefantasy.jp/#event/teamforce/gacha_setting',
  GACHA_RESULT: 'https://game.granbluefantasy.jp/#event/teamforce/gacha_result',
  GACHA_LINEUP: 'https://game.granbluefantasy.jp/#event/teamforce/gacha_lineup'
} as const;

export const DREAD_BARRAGE_API_ENDPOINTS = {
  TOP_CONTENT: '/teamforce/top/content/index',
  REWARD_CONTENT: '/teamforce/reward/content/index',
  GACHA_CONTENT: '/teamforce/gacha/content/index',
  GACHA_SETTING_CONTENT: '/teamforce/gacha/content/setting',
  DEFEAT_REWARD_LIST: '/rest/teamforce/reward/defeat_reward',
  POINT_REWARD_LIST: '/rest/teamforce/reward/point_reward',
  RECEIVE_DEFEAT_REWARD: '/rest/teamforce/reward/receive_defeat_reward',
  RECEIVE_ALL_DEFEAT_REWARD: '/rest/teamforce/reward/receive_all_defeat_reward',
  RECEIVE_POINT_REWARD: '/rest/teamforce/reward/receive_point_reward',
  RECEIVE_ALL_POINT_REWARD: '/rest/teamforce/reward/receive_all_point_reward',
  MEDAL_EXCHANGE_LIST: '/rest/teamforce/reward/medal_exchange_list',
  BILL_EXCHANGE_LIST: '/rest/teamforce/reward/bill_exchange_list',
  GACHA_PLAY: '/rest/teamforce/gacha/play',
  GACHA_BULK_PLAY: '/rest/teamforce/gacha/bulk_play',
  GACHA_BULK_BOX_PLAY: '/rest/teamforce/gacha/bulk_box_play',
  GACHA_RESET_BOX: '/rest/teamforce/gacha/reset_box',
  GACHA_WEAPON_SET: '/rest/teamforce/gacha/weapon_set',
  VALIANT_BOSS_RAID: '/rest/teamforce/top/boss_raid',
  ONE_SHOT_ASSIST: '/rest/teamforce/top/one_shot_assist',
  AUTO_ASSIST_INVITE: '/rest/teamforce/top/auto_assist_invite'
} as const;

/**
 * Verified DOM Selectors from `event/common/teamforce/**` client views
 */
export const DREAD_BARRAGE_SELECTORS = {
  // Top Page Quests & Modals
  ENEMY_INFO_START_BTN: '.prt-enemy-info-list .btn-start-quest.open',
  ENEMY_INFO_CARD: '.prt-enemy-info-list .prt-enemy-info',
  QUEST_GROUP_BTN: '.cnt-teamforce .btn-quest-select',
  QUEST_LIST_POPUP: '.pop-teamforce-quest-list',
  QUEST_LIST_START_BTN: '.pop-teamforce-quest-list .btn-start-quest.open',
  RELEASE_QUEST_POPUP_CLOSE: '.pop-release-quest .btn-usual-close, .pop-release-quest .btn-usual-ok',
  MISSION_BTN: '.btn-event-mission',
  MISSION_POPUP: '.pop-mission-progress',

  // Valiant Battle
  VALIANT_BATTLE_BTN: '.cnt-teamforce .btn-valiant-battle',
  VALIANT_POPUP_OK: '.pop-valiant-battle .btn-usual-ok',
  VALIANT_ATTR_POPUP_OK: '.pop-attribute-description .btn-usual-ok',
  VALIANT_WIN_CANVAS: '#cjs-valiantbattle-win',

  // Settings (Special Backup / Auto-Assist)
  SETTING_MENU_BTN: '.btn-menu.setting',
  ONE_SHOT_ASSIST_CHECKBOX: '.pop-setting #one-shot-assist',
  AUTO_ASSIST_INVITE_CHECKBOX: '.pop-setting #auto-assist-invite',

  // Rewards Page (#event/teamforce/reward)
  REWARD_TAB_DEFEAT: '.btn-tabs[data-reward-type="defeat"]',
  REWARD_TAB_POINT: '.btn-tabs[data-reward-type="point"]',
  REWARD_GET_ALL_BTN: '.prt-get-all-wrapper .btn-reward-get-all',
  REWARD_GET_SINGLE_BTN: '.prt-reward-list-wrapper .btn-reward-get',
  REWARD_POPUP_OK: '.pop-receive-reward .btn-usual-ok, .pop-usual .btn-usual-ok',

  // Token Drawbox Page (#event/teamforce/gacha)
  GACHA_BULK_BOX_BTN: '.prt-event-gacha .btn-bulk-play-box:not(.disable)',
  GACHA_USE_ALL_BTN: '.prt-event-gacha .btn-use-all:not(.disable)',
  GACHA_BULK_PLAY_BTN: '.prt-event-gacha .btn-bulk-play:not(.disable)',
  GACHA_PLAY_BTN: '.prt-event-gacha .btn-play:not(.disable)',
  GACHA_RESET_BTN: '.prt-event-reset .btn-reset',
  GACHA_RESET_CONFIRM_OK: '.pop-reset-confirm .btn-usual-ok',
  GACHA_RESET_DONE_OK: '.pop-reset .btn-usual-ok',
  GACHA_TOKEN_COUNT: '.txt-current-point, .txt-medal-possessed, .txt-possessed-point, .prt-token-point .txt-point, #now-point'
} as const;

/**
 * Active Iteration #15 (October 22–29, 2026) — Earth Bosses / Wind Advantage
 * Live-verified from `/teamforce/top/content/index` (`event_id: 16015`, `teamforce15`)
 */
export const DREAD_BARRAGE_ITERATION_15: DreadBarrageIterationDefinition = {
  iterationNumber: 15,
  eventId: 16015,
  eventCode: 'teamforce',
  rawId: 'teamforce015',
  title: 'Dread Barrage #15 (Earth / Wind Advantage)',
  bossElement: 'earth',
  advantageElement: 'wind',
  startDateJst: '2026-10-22T19:00:00+09:00',
  endDateJst: '2026-10-29T18:59:59+09:00',
  supporterPriorities: ELEMENT_ADVANTAGE_SUMMONS.wind,
  raids: {
    '1star': {
      tier: '1star',
      categorySymbol: '★',
      questGroup: 'normal',
      level: 60,
      questId: '980811',
      chapterId: '98081',
      bossName: 'Lvl 60 Lacerta Currens',
      thumbnailImage: 'teamforce15_star1',
      apCost: 30,
      epCost: 2,
      estimatedHp: 9_000_000,
      soloHonors: 320,
      battleBadgesSolo: 2,
      tokensHost: 18,
      tokensMvp: 14,
      tokensSecond: 0,
      tokensThird: 0,
      tokensJoin: 20,
      tokensSoloTotal: 32,
      unlockRequirementText: 'Available from event start',
      unparalleledSpawnEveryClears: 10,
      recommendedStrategy: 'otk_0b'
    },
    '2star': {
      tier: '2star',
      categorySymbol: '★★',
      questGroup: 'normal',
      level: 75,
      questId: '980821',
      chapterId: '98082',
      bossName: 'Lvl 75 Ferrum Agile',
      thumbnailImage: 'teamforce15_star2',
      apCost: 30,
      epCost: 2,
      estimatedHp: 21_500_000,
      soloHonors: 788,
      battleBadgesSolo: 2,
      tokensHost: 28,
      tokensMvp: 20,
      tokensSecond: 0,
      tokensThird: 0,
      tokensJoin: 22,
      tokensSoloTotal: 48,
      unlockRequirementText: 'Crew clears ★ quest 20 times',
      unlockPrerequisiteTier: '1star',
      unlockRequiredClears: 20,
      unparalleledSpawnEveryClears: 10,
      recommendedStrategy: 'otk_0b'
    },
    '3star': {
      tier: '3star',
      categorySymbol: '★★★',
      questGroup: 'hell',
      level: 90,
      questId: '980831',
      chapterId: '98083',
      bossName: 'Lvl 90 Corpus Volans',
      thumbnailImage: 'teamforce15_star3',
      apCost: 40,
      epCost: 2,
      estimatedHp: 66_150_000,
      soloHonors: 3_730,
      battleBadgesSolo: 2,
      tokensHost: 50,
      tokensMvp: 22,
      tokensSecond: 15,
      tokensThird: 8,
      tokensJoin: 25,
      tokensSoloTotal: 72,
      unlockRequirementText: 'Crew clears ★★ quest 100 times',
      unlockPrerequisiteTier: '2star',
      unlockRequiredClears: 100,
      unparalleledSpawnEveryClears: 5,
      recommendedStrategy: 'otk_1t'
    },
    '4star': {
      tier: '4star',
      categorySymbol: '★★★★',
      questGroup: 'hell',
      level: 100,
      questId: '980841',
      chapterId: '98084',
      bossName: 'Lvl 100 Ferrum Grave',
      thumbnailImage: 'teamforce15_star4',
      apCost: 50,
      epCost: 3,
      estimatedHp: 170_625_000,
      soloHonors: 20_330,
      battleBadgesSolo: 2,
      tokensHost: 72,
      tokensMvp: 34,
      tokensSecond: 26,
      tokensThird: 18,
      tokensJoin: 40,
      tokensSoloTotal: 106,
      unlockRequirementText: 'Crew clears ★★★ quest 150 times',
      unlockPrerequisiteTier: '3star',
      unlockRequiredClears: 150,
      unparalleledSpawnEveryClears: 3,
      recommendedStrategy: 'smart_fa'
    },
    '5star': {
      tier: '5star',
      categorySymbol: '★★★★★',
      questGroup: 'hell',
      level: 150,
      questId: '980851',
      chapterId: '98085',
      bossName: 'Lvl 150 Arx Movens',
      thumbnailImage: 'teamforce15_star5',
      apCost: 50,
      epCost: 3,
      estimatedHp: 288_750_000,
      soloHonors: 41_000,
      battleBadgesSolo: 2,
      tokensHost: 115,
      tokensMvp: 48,
      tokensSecond: 40,
      tokensThird: 28,
      tokensJoin: 80,
      tokensSoloTotal: 163,
      unlockRequirementText: 'Crew clears ★★★★ quest 200 times',
      unlockPrerequisiteTier: '4star',
      unlockRequiredClears: 200,
      unparalleledSpawnEveryClears: 2,
      recommendedStrategy: 'smart_fa'
    }
  },
  unparalleledFoes: {
    unparalleled_95: {
      tier: 'unparalleled_95',
      categorySymbol: 'Unparalleled Lv95',
      questGroup: 'strong',
      level: 95,
      questId: '980861',
      chapterId: '98086',
      bossName: 'Lvl 95 Unparalleled Foe',
      thumbnailImage: 'teamforce15_strong1',
      apCost: 0,
      epCost: 3,
      estimatedHp: 131_000_000,
      soloHonors: 5_500,
      battleBadgesSolo: 3,
      tokensHost: 80,
      tokensMvp: 30,
      tokensSecond: 20,
      tokensThird: 15,
      tokensJoin: 40,
      tokensSoloTotal: 110,
      unlockRequirementText: 'Spawns from clearing ★–★★★★★ raids (Max 2 hosts/day; Day 1+)',
      recommendedStrategy: 'smart_fa'
    },
    unparalleled_135: {
      tier: 'unparalleled_135',
      categorySymbol: 'Unparalleled Lv135',
      questGroup: 'strong',
      level: 135,
      questId: '980871',
      chapterId: '98087',
      bossName: 'Lvl 135 Unparalleled Foe',
      thumbnailImage: 'teamforce15_strong2',
      apCost: 0,
      epCost: 3,
      estimatedHp: 245_437_500,
      soloHonors: 11_855,
      battleBadgesSolo: 4,
      tokensHost: 120,
      tokensMvp: 40,
      tokensSecond: 30,
      tokensThird: 20,
      tokensJoin: 60,
      tokensSoloTotal: 160,
      unlockRequirementText: 'Unlocks Day 3 at 19:00 JST (Max 2 hosts/day)',
      recommendedStrategy: 'smart_fa'
    },
    unparalleled_175: {
      tier: 'unparalleled_175',
      categorySymbol: 'Unparalleled Lv175',
      questGroup: 'strong',
      level: 175,
      questId: '980881',
      chapterId: '98088',
      bossName: 'Lvl 175 Unparalleled Foe',
      thumbnailImage: 'teamforce15_strong3',
      apCost: 0,
      epCost: 3,
      estimatedHp: 375_375_000,
      soloHonors: 24_000,
      battleBadgesSolo: 5,
      tokensHost: 160,
      tokensMvp: 50,
      tokensSecond: 35,
      tokensThird: 25,
      tokensJoin: 80,
      tokensSoloTotal: 210,
      unlockRequirementText: 'Unlocks Day 4 at 19:00 JST (Max 2 hosts/day)',
      recommendedStrategy: 'smart_fa'
    },
    unparalleled_215: {
      tier: 'unparalleled_215',
      categorySymbol: 'Unparalleled Lv215',
      questGroup: 'strong',
      level: 215,
      questId: '980891',
      chapterId: '98089',
      bossName: 'Lvl 215 Unparalleled Foe',
      thumbnailImage: 'teamforce15_strong4',
      apCost: 0,
      epCost: 3,
      estimatedHp: 924_000_000,
      soloHonors: 75_000,
      battleBadgesSolo: 6,
      tokensHost: 240,
      tokensMvp: 80,
      tokensSecond: 50,
      tokensThird: 35,
      tokensJoin: 120,
      tokensSoloTotal: 320,
      unlockRequirementText: 'Unlocks Day 5 at 19:00 JST (Max 2 hosts/day)',
      recommendedStrategy: 'smart_fa'
    }
  }
};

/**
 * Standard Dread Barrage Event & Guild Missions
 */
export const DREAD_BARRAGE_MISSIONS: DreadBarrageMissionTier[] = [
  {
    missionId: '1',
    targetDescription: 'Clear ★ Quest (Individual)',
    levels: [
      { level: 1, requiredCount: 5, description: 'Clear the ★ quest 5 times', reward: 'Crystal x30' },
      { level: 2, requiredCount: 10, description: 'Clear the ★ quest 10 times', reward: 'Crystal x50' },
      { level: 3, requiredCount: 15, description: 'Clear the ★ quest 15 times', reward: 'Island Builder Treasure Set x1' },
      { level: 4, requiredCount: 20, description: 'Clear the ★ quest 20 times', reward: 'Crystal x100' }
    ]
  },
  {
    missionId: '2',
    targetDescription: 'Clear ★★ Quest (Individual)',
    levels: [
      { level: 1, requiredCount: 5, description: 'Clear the ★★ quest 5 times', reward: 'Crystal x30' },
      { level: 2, requiredCount: 10, description: 'Clear the ★★ quest 10 times', reward: 'Crystal x50' },
      { level: 3, requiredCount: 15, description: 'Clear the ★★ quest 15 times', reward: 'Island Builder Treasure Set x1' },
      { level: 4, requiredCount: 20, description: 'Clear the ★★ quest 20 times', reward: 'Crystal x100' }
    ]
  },
  {
    missionId: '3',
    targetDescription: 'Clear ★★★ Quest (Individual)',
    levels: [
      { level: 1, requiredCount: 5, description: 'Clear the ★★★ quest 5 times', reward: 'Crystal x100' },
      { level: 2, requiredCount: 10, description: 'Clear the ★★★ quest 10 times', reward: 'Crystal x200' },
      { level: 3, requiredCount: 15, description: 'Clear the ★★★ quest 15 times', reward: 'Island Builder Treasure Set x1' },
      { level: 4, requiredCount: 20, description: 'Clear the ★★★ quest 20 times', reward: 'Premium Draw Ticket x1' }
    ]
  },
  {
    missionId: '4',
    targetDescription: 'Defeat Unparalleled Foes (Crew)',
    levels: [
      { level: 1, requiredCount: 10, description: 'Defeat an unparalleled foe 10 times', reward: 'Crystal x150' },
      { level: 2, requiredCount: 30, description: 'Defeat an unparalleled foe 30 times', reward: 'Intricacy Ring x1' },
      { level: 3, requiredCount: 80, description: 'Defeat an unparalleled foe 80 times', reward: 'Premium Draw Ticket x1' },
      { level: 4, requiredCount: 150, description: 'Defeat an unparalleled foe 150 times', reward: 'Elemental Earrings x2' }
    ]
  }
];

/**
 * Builds the direct supporter selection URL for a given Dread Barrage quest ID
 */
export function buildDreadBarrageSupporterUrl(questId: string): string {
  return `https://game.granbluefantasy.jp/#quest/supporter/${questId}/1`;
}

/**
 * Normalizes a CLI difficulty string into a canonical `DreadBarrageStarTier`
 */
export function normalizeDreadBarrageStarTier(input?: string): DreadBarrageStarTier {
  const s = (input || '').toLowerCase().trim();
  if (s === '1' || s === '1star' || s === 'star1' || s === '★') return '1star';
  if (s === '2' || s === '2star' || s === 'star2' || s === '★★') return '2star';
  if (s === '3' || s === '3star' || s === 'star3' || s === '★★★') return '3star';
  if (s === '4' || s === '4star' || s === 'star4' || s === '★★★★') return '4star';
  if (s === '5' || s === '5star' || s === 'star5' || s === '★★★★★') return '5star';
  return '2star';
}

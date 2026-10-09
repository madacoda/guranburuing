// src/events/event.constants.ts

export type EventRaidDifficulty = 'vh' | 'ex' | 'hl' | 'hell' | 'maniac';

export interface ScenarioEventRaidDef {
  difficulty: EventRaidDifficulty;
  name: string;
  questId: string;
  questType: number; // 1 = multi/raid
  costAp: number;
  consumedItemId?: string;
  consumedItemCount?: number;
  bossName: string;
  bossHp: number;
  supporterPriorities: string[];
}

export interface ScenarioEventDefinition {
  id: string; // e.g. "177"
  rawId: string; // e.g. "treasureraid177"
  title: string; // e.g. "Farewell, Cold Heart"
  element: 'dark' | 'light' | 'fire' | 'water' | 'earth' | 'wind';
  hostItemId: string; // e.g. "10674"
  hostItemName: string; // e.g. "Mechanical Core"
  raids: {
    vh: ScenarioEventRaidDef;
    ex: ScenarioEventRaidDef;
    hl: ScenarioEventRaidDef;
    hell: ScenarioEventRaidDef;
    maniac?: ScenarioEventRaidDef;
    [key: string]: ScenarioEventRaidDef | undefined;
  };
}

/**
 * Standard Granblue Fantasy Scenario Event (treasureraid) Registry.
 * Event 177: "Farewell, Cold Heart" (氷尖に沈む)
 */
export const EVENT_177_DEFINITION: ScenarioEventDefinition = {
  id: '177',
  rawId: 'treasureraid177',
  title: 'Farewell, Cold Heart',
  element: 'dark',
  hostItemId: '10674',
  hostItemName: 'Mechanical Core',
  raids: {
    vh: {
      difficulty: 'vh',
      name: 'Drone Assault (Very Hard)',
      questId: '947421',
      questType: 1,
      costAp: 20,
      bossName: 'Drone Assault',
      bossHp: 4200000,
      supporterPriorities: ['Hades', 'Bahamut', 'Celeste Omega', 'Zamalvoch', 'Kaguya']
    },
    ex: {
      difficulty: 'ex',
      name: 'Strength of Humanity (Extreme)',
      questId: '947431',
      questType: 1,
      costAp: 30,
      consumedItemId: '10674',
      consumedItemCount: 3,
      bossName: 'Lvl 50 Ohr Morhes',
      bossHp: 12000000,
      supporterPriorities: ['Hades', 'Bahamut', 'Celeste Omega', 'Zamalvoch', 'Kaguya']
    },
    hl: {
      difficulty: 'hl',
      name: 'Ohr Morhes (Impossible)',
      questId: '947441',
      questType: 1,
      costAp: 50,
      consumedItemId: '10674',
      consumedItemCount: 5,
      bossName: 'Lvl 100 Ohr Morhes',
      bossHp: 45000000,
      supporterPriorities: ['Hades', 'Bahamut', 'Celeste Omega', 'Zamalvoch']
    },
    hell: {
      difficulty: 'hell',
      name: 'Alert: Reinforcements Requested (Nightmare)',
      questId: '947411',
      questType: 3,
      costAp: 0,
      bossName: 'Nightmare Foe',
      bossHp: 15000000,
      supporterPriorities: ['Hades', 'Bahamut', 'Celeste Omega', 'Zamalvoch']
    }
  }
};

/**
 * Granblue Fantasy x Gintama Collaboration Event (biography045).
 * "Gin Tama: Shonen Jump Is Best Enjoyed Cover to Cover"
 */
export const EVENT_BIOGRAPHY045_DEFINITION: ScenarioEventDefinition = {
  id: 'biography045',
  rawId: 'biography045',
  title: 'Gin Tama: Shonen Jump Is Best Enjoyed Cover to Cover',
  element: 'wind',
  hostItemId: '',
  hostItemName: 'Medallion',
  raids: {
    vh: {
      difficulty: 'vh',
      name: 'Lv30 Neo Armstrong (Very Hard Multi)',
      questId: 'solo_vh_neo_armstrong',
      questType: 1,
      costAp: 20,
      bossName: 'Neo Armstrong Cyclone Jet Armstrong Cannon',
      bossHp: 4620000,
      supporterPriorities: ['Agni', 'Colossus', 'Michael', 'Kaguya']
    },
    ex: {
      difficulty: 'ex',
      name: 'Lv50 Neo Armstrong (Extreme Multi)',
      questId: 'solo_ex_neo_armstrong',
      questType: 1,
      costAp: 30,
      bossName: 'Neo Armstrong Cyclone Jet Armstrong Cannon',
      bossHp: 9680000,
      supporterPriorities: ['Agni', 'Colossus', 'Michael', 'Kaguya']
    },
    hl: {
      difficulty: 'hl',
      name: 'Lv60 Koro (Extreme+ Multi)',
      questId: 'raid_ex_plus_koro',
      questType: 1,
      costAp: 30,
      bossName: 'Koro',
      bossHp: 13200000,
      supporterPriorities: ['Zeus', 'Lumi', 'Lu Woh', 'Kaguya']
    },
    hell: {
      difficulty: 'hell',
      name: 'Lv120 Koro (Nightmare)',
      questId: 'hell_lv120_koro',
      questType: 3,
      costAp: 0,
      bossName: 'Lv120 Koro',
      bossHp: 25000000,
      supporterPriorities: ['Zeus', 'Lumi', 'Lu Woh']
    }
  }
};

export const ACTIVE_EVENT = EVENT_177_DEFINITION;

/**
 * Builds the exact in-game supporter URL for any scenario event raid difficulty.
 */
export function buildEventRaidUrl(difficulty: EventRaidDifficulty = 'ex', eventDef: ScenarioEventDefinition = ACTIVE_EVENT): string {
  const raid = eventDef.raids[difficulty] || eventDef.raids.ex;
  if (difficulty === 'vh') {
    return `https://game.granbluefantasy.jp/#quest/supporter/${raid.questId}/1`;
  }
  if (difficulty === 'ex' || difficulty === 'hl') {
    const itemId = raid.consumedItemId || eventDef.hostItemId;
    return `https://game.granbluefantasy.jp/#quest/supporter/${raid.questId}/1/0/${itemId}`;
  }
  if (difficulty === 'hell') {
    return `https://game.granbluefantasy.jp/#quest/supporter/${raid.questId}/3`;
  }
  return `https://game.granbluefantasy.jp/#quest/supporter/${raid.questId}/1/0/${eventDef.hostItemId}`;
}

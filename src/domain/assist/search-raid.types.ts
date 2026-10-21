// src/domain/assist/search-raid.types.ts

/**
 * Definition for a searchable raid battle in Granblue Fantasy Backup Request (#quest/assist) Finder settings.
 */
export interface SearchRaidDefinition {
  questId: string;
  stageId: string;
  stageType: string; // '1' = Standard Multi-battles, '2' = High Level (HL), '4' = Special / Event
  name: string;
  aliases: string[];
  bossName?: string;
  category?: string;
}

/**
 * Options for configuring a Finder slot in Granblue Fantasy Backup Request (#quest/assist).
 */
export interface FinderSlotConfigurationOptions {
  slot: number; // 1 to 4 (default: 1)
  targetRaid: SearchRaidDefinition;
  forceReconfigure?: boolean;
}

/**
 * Query criteria for resolving a target raid from a workflow template.
 */
export interface SearchRaidQuery {
  questId?: string | number;
  targetEnemy?: string;
  name?: string;
  description?: string;
}

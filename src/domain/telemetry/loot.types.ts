// src/domain/telemetry/loot.types.ts

export interface LootItem {
  id: string;
  name: string;
  count: number;
  isGoldBar?: boolean;
  isBlueChest?: boolean;
}

export interface RaidLootInspectionOutcome {
  hasGoldBar: boolean;
  hasBlueChest: boolean;
  raidId: string;
  lootItems: LootItem[];
  pageText: string;
}

export interface ILootTrackerService {
  inspectRewardResponse(data: any): RaidLootInspectionOutcome;
  inspectDomRewards(): Promise<RaidLootInspectionOutcome>;
  captureCleanLootProof(page: any, raidId?: string): Promise<{ buffer?: Buffer; path: string }>;
  recordLootOutcome(outcome: RaidLootInspectionOutcome, questName: string): void;
}

// src/domain/data/data-catalog.types.ts

export interface RaidCategoryDefinition {
  id: string;
  name: string;
  japaneseName: string;
  stageId: string;
  stageType: string;
  minRank: number;
  description: string;
}

export interface RaidHostMaterial {
  name: string;
  itemId: string;
  count: number;
}

export interface BlueChestDropSpecification {
  thresholdHonors: number;
  guaranteedDamage: number;
  goldBrickChance: number;
  eternitySandChance: number;
}

export interface RaidCatalogItem {
  id: string;
  name: string;
  commonName?: string;
  japaneseName?: string;
  nickname?: string;
  category: string;
  stageId: string;
  questId: string;
  chapterId?: string;
  apCost: number;
  epCost: number;
  maxPlayers: number;
  bossHp: number;
  element: string;
  battleSystem: 'V1' | 'V2';
  dailyLimit?: number;
  hostMaterials?: RaidHostMaterial[];
  blueChest?: BlueChestDropSpecification;
  specialPhysics?: Record<string, any>;
  tacticalRecommendations?: {
    speedProfile: string;
    recommendedTurns: number;
    supportSummonPriority: string[];
  };
}

export interface ModalDefinition {
  id: string;
  name: string;
  trigger: string;
  containerSelector: string;
  closeButtonSelector?: string;
  confirmButtonSelector?: string;
  cancelButtonSelector?: string;
  itemSelector?: string;
  itemSelectionSelector?: string;
  scopeSelectors?: Record<string, string>;
  eventType?: string;
  dismissBehavior: string;
  timeoutMs?: number;
}

export interface NavigationRouteDefinition {
  hash: string;
  name: string;
  description: string;
  view?: string;
  subTabs?: Record<string, string>;
  allowedTransitions?: string[];
}

export interface EndpointDefinition {
  path: string;
  method: 'GET' | 'POST';
  description: string;
  headers?: Record<string, string>;
  requestPayload?: Record<string, any>;
  responseSchema?: Record<string, any>;
}

export interface DailyAutomationTask {
  id: string;
  tag: string;
  name: string;
  category: string;
  questId?: string;
  chapterId?: string;
  proChapterId?: string;
  pageUrl: string;
  selector?: string;
  dailyLimit?: number;
  apCost?: number;
}

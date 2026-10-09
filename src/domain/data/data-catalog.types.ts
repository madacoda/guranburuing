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

export interface ElementDefinition {
  id: string;
  internalId: number;
  name: string;
  japaneseName: string;
  kanji: string;
  colorHex: string;
  supporterTabAttribute: number;
  superiorTo: string[];
  weakTo: string[];
  neutralTo: string[];
  baseDamageMultiplierVsSuperior: number;
  baseDamageMultiplierVsInferior: number;
  baseDamageTakenMultiplierVsSuperior: number;
  baseDamageTakenMultiplierVsInferior: number;
  summons?: {
    magna?: string[];
    primal?: string[];
    primarch?: string[];
    arcarum?: string[];
    sixDragons?: string[];
  };
  weaponSkills?: {
    magnaPrefix?: string;
    primalPrefix?: string;
    seraphicWeapon?: string;
  };
}

export interface ElementMatrixItem {
  attacker: string;
  defender: string;
  relation: 'superior' | 'inferior' | 'neutral' | 'mutual_advantage' | 'plain';
  damageMultiplier: number;
  damageTakenMultiplier: number;
  criticalHitEligible: boolean;
  seraphicMultiplierEligible: boolean;
  debuffAccuracyModifier: number;
  notes?: string;
}

export interface PartySelectionRuleItem {
  optimalPartyElement: string;
  fallbackPartyElement?: string;
  supporterTabAttribute: number;
  rationale: string;
  recommendedSupporterSummons: string[];
}

export interface V2OmenCancelCondition {
  type:
    | 'hit_count'
    | 'damage_threshold'
    | 'skill_damage'
    | 'charge_attack_count'
    | 'charge_attack_damage'
    | 'fatal_chain'
    | 'dispel'
    | 'debuff_count'
    | 'skill_category'
    | 'plain_damage'
    | 'none';
  description: string;
  targetCount?: number;
  targetDamage?: number;
  requiredCategory?: string;
}

export interface V2OmenDefinition {
  id: string;
  raidId: string;
  raidName: string;
  omenName: string;
  japaneseName?: string;
  triggerType: 'hp_threshold' | 'turn_interval' | 'charge_diamonds' | 'phase_change' | 'special_trigger';
  triggerValue: string;
  omenType: 'cancelable_yellow' | 'uncancelable_red';
  cancelCondition: V2OmenCancelCondition;
  dangerLevel: 'low' | 'medium' | 'high' | 'wipe';
  incomingDamageType: 'elemental_multi' | 'elemental_nuke' | 'plain' | 'all_party_nuke' | 'buff_only';
  recommendedCounter: {
    primaryAction: string;
    fallbackAction: string;
    targetSkills: string[];
    targetSummons: string[];
    autoGuardEligible: boolean;
  };
}

export interface V2ConditionResolver {
  strategyName: string;
  description: string;
  tacticalSequence: string[];
  candidateClasses: string[];
  candidateSkills: string[];
  candidateSummons: string[];
  guardFallbackSafety: string;
}

export interface PlainDamageSummon {
  id: string;
  name: string;
  callName: string;
  plainDamageMax: number;
  scalingType: 'fixed' | 'random' | 'hp_percentage' | 'turn_end_tick' | string;
  conditions: string;
  additionalUtility: string[];
}

export interface PlainDamageCharacter {
  id: string;
  name: string;
  element: 'fire' | 'water' | 'earth' | 'wind' | 'light' | 'dark' | string;
  actionType: 'skill' | 'charge_attack' | 'auto_counter' | string;
  actionName: string;
  plainDamageMax: number;
  scalingType: 'consumed_hp' | 'fixed_stack' | 'flat' | 'hp_percentage' | 'charge_bar' | string;
  cooldownTurns: number;
  conditions: string;
  notes: string;
}

export interface PlainDamageMC {
  id: string;
  category: 'class_skill' | 'weapon_awaken' | 'secret_gear' | string;
  name: string;
  mechanism: string;
  plainDamageMax: number;
  specialEffect: string;
}

export interface PlainDamageCatalogSources {
  summons: PlainDamageSummon[];
  characters: PlainDamageCharacter[];
  mcClassesAndWeapons: PlainDamageMC[];
}

export interface PlainDamageSolverStep {
  step: number;
  name: string;
  logic: string;
}

export interface PlainDamageRaidOmenMapping {
  raidId: string;
  raidName: string;
  labor?: string;
  trigger?: string;
  requiredPlainDamage: number;
  incomingDamage?: number;
  optimalSolver?: string;
  mitigationStrategy?: string;
  failurePenalty?: string;
}

export interface PlainDamageCounterEngineData {
  solverPipeline: PlainDamageSolverStep[];
  raidOmenMappings: PlainDamageRaidOmenMapping[];
}

// Status Effects, Dispel & Cleanse
export interface BossBuffDefinition {
  id: string;
  name: string;
  japaneseName?: string;
  category: 'defensive' | 'offensive' | 'utility' | 'special' | string;
  dispelPriority: 'immediate' | 'high' | 'normal' | 'low' | 'ignore' | string;
  removable: boolean;
  threatLevel: 'wipe' | 'high' | 'medium' | 'low' | string;
  description: string;
  commonBosses?: string[];
}

export interface PartyDebuffDefinition {
  id: string;
  name: string;
  japaneseName?: string;
  category: 'lockout' | 'lethal_dot' | 'offensive_penalty' | 'defensive_penalty' | 'special' | string;
  cleansePriority: 'immediate' | 'high' | 'normal' | 'low' | 'ignore' | string;
  cleanseable: boolean;
  blockableByVeil: boolean;
  threatLevel: 'wipe' | 'high' | 'medium' | 'low' | string;
  description: string;
  incompatibleActions?: string[];
}

export interface DispelSourceSummon {
  id: string;
  name: string;
  callName?: string;
  dispelsCount: number;
  conditions: string;
  priorityScore: number;
}

export interface DispelSourceMCSkill {
  id: string;
  name: string;
  classCategory: string;
  dispelsCount: number;
  cooldownTurns: number;
  notes?: string;
}

export interface DispelSourceCharacter {
  id: string;
  name: string;
  element: string;
  dispelsCount: number;
  triggerMechanism: string;
}

export interface CleanseSourceMCSkill {
  id: string;
  name: string;
  actionType: 'cleanse' | 'veil' | 'hybrid' | string;
  cooldownTurns: number;
  notes?: string;
}

export interface CleanseSourceSummon {
  id: string;
  name: string;
  actionType: string;
}

export interface CleanseSourceCharacter {
  id: string;
  name: string;
  element: string;
  actionType: string;
  notes?: string;
}

export interface StatusEffectsCatalogData {
  bossBuffs: BossBuffDefinition[];
  partyDebuffs: PartyDebuffDefinition[];
  dispelSources: {
    summons: DispelSourceSummon[];
    mcSkills: DispelSourceMCSkill[];
    characterHighlights: DispelSourceCharacter[];
  };
  cleanseSources: {
    mcSkills: CleanseSourceMCSkill[];
    summons: CleanseSourceSummon[];
    characterHighlights: CleanseSourceCharacter[];
  };
  decisionEngine: {
    dispelEvaluationRules: Array<{ step: number; rule: string; action: string }>;
    cleanseEvaluationRules: Array<{ step: number; rule: string; action: string }>;
    zombifiedSafetyInterlock: {
      enabled: boolean;
      rule: string;
      lockoutActions: string[];
    };
  };
}

// Supporter Summons & Grid Archetypes
export interface GridArchetypeDefinition {
  id: string;
  name: string;
  weaponSkillBoostType: string;
  optimalSupporterAura: string;
  description: string;
}

export interface SupporterSummonItem {
  id: string;
  name: string;
  auraEffect: string;
  maxUncapLevel?: number;
}

export interface ElementalSupportersDefinition {
  element: string;
  supporterTabAttribute: number;
  magnaSummons: SupporterSummonItem[];
  primalSummons: SupporterSummonItem[];
  elementalSummons: SupporterSummonItem[];
  utilitySummons: SupporterSummonItem[];
}

export interface UncapTierRankingDefinition {
  tier: string;
  level: number;
  starRating: string;
  priorityScore: number;
}

export interface SupporterSelectionMatrixItem {
  questType: string;
  preferredArchetype: string;
  fallbackHierarchy: string[];
  quickSummonPreferred: boolean;
  notes?: string;
}

// Raid Join Decision & Evaluation
export interface RaidActionPolicy {
  action: string;
  description: string;
  minHpPercent: number;
  maxHpPercent: number;
  minParticipants: number;
  maxParticipants: number;
  epCostRange: number[];
}

export interface RaidJoinProfile {
  raidId: string;
  name: string;
  targetMode: 'blue_chest_race' | 'rapid_leech' | 'host_only' | 'hybrid' | string;
  minHpJoin: number;
  maxHpJoin: number;
  maxParticipantsAllowed: number;
  blueChestTargetHonors: number;
  leechHonorsTarget: number;
  expectedTimeToDeathSeconds: number;
  primaryDrop: string;
  tacticalNotes: string;
}

export interface RaidJoinDecisionStep {
  step: number;
  name: string;
  formulaOrCondition: string;
  actionOutput: string;
}

// Tactical Combat Action Priority
export interface TacticalExecutionTier {
  tier: number;
  category: string;
  name: string;
  description: string;
  safetyInterlocks: string[];
}

// Events Subsystem & Collaboration Architecture (KMS Vol. 15)
export type EventType = 'collaboration' | 'treasureraid' | 'unite_and_fight' | 'dread_barrage' | 'xeno_clash' | 'story_side' | 'tower_of_babyl' | string;
export type EventStatus = 'active' | 'rerun' | 'archived' | 'upcoming' | 'ended' | string;

export interface EventMasterItem {
  id: string;
  rawId: string;
  type: EventType;
  title: string;
  japaneseTitle: string;
  hashRoute: string;
  status: EventStatus;
  period?: {
    startDate?: string;
    endDate?: string;
    exchangeDeadline?: string;
  };
  elements: {
    bossElements: string[];
    playerAdvantageousElements: string[];
  };
  detailCatalog?: string;
  features?: {
    hasTreasureTrade: boolean;
    hasTokenDrawbox: boolean;
    hasDailyMissions: boolean;
    hasChallengeQuest: boolean;
    hasNightmareHellSkip: boolean;
    recruitableCharactersCount: number;
    hasFlbWeapon: boolean;
    hasFlbSummon: boolean;
  };
}

export interface EventCurrencyDefinition {
  id: string;
  name: string;
  japaneseName: string;
  itemType: string;
  iconAsset?: string;
  primarySources: string[];
  usage: string[];
}

export interface EventExchangeItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  cost: {
    medallion: number;
    secondary?: number;
  };
  priorityTier: number;
  recommendation: string;
}

export interface EventQuestDefinition {
  id: string;
  name: string;
  difficulty?: string;
  level?: number;
  apCost: number;
  bpCost?: number;
  element: string;
  bossName: string;
  bossHp: number;
  maxPlayers?: number;
  battles?: number;
  firstClearReward?: string;
  drops?: Record<string, any>;
  hellProcChance?: number;
  skipUnlockedAfterClears?: number;
}

export interface EventDetailDefinition {
  version: string;
  generatedAt: string;
  description: string;
  metadata: {
    id: string;
    rawId: string;
    eventNumber?: number;
    title: string;
    englishTitle?: string;
    japaneseTitle: string;
    type: EventType;
    status: EventStatus;
    hashRoute: string;
    period?: {
      startDate?: string;
      endDate?: string;
      exchangeDeadline?: string;
    };
    elements: {
      bossElements: string[];
      playerAdvantageousElements: string[];
    };
  };
  assets: {
    primaryOrigin: string;
    backupOrigin: string;
    paths: Record<string, string>;
    eventBanners?: Record<string, string>;
    audioTracks?: Record<string, string>;
  };
  characters: Array<{
    id: string;
    name: string;
    japaneseName?: string;
    rarity: string;
    element: string;
    style?: string;
    race?: string;
    joinCondition: string;
    cv?: string;
    ougi?: any;
    skills?: any[];
    passives?: any[];
    assets?: any;
  }>;
  storyNpcs?: Array<{
    name: string;
    cv: string;
    imageId?: string;
    role?: string;
  }>;
  summons: Array<{
    id: string;
    name: string;
    element: string;
    rarity: string;
    maxUncap: number;
    call: any;
    mainAura: any;
    subAura?: any;
    stats?: any;
    flbMaterials?: any;
  }>;
  weapons: Array<{
    id: string;
    name: string;
    element: string;
    weaponType: string;
    rarity: string;
    maxUncap: number;
    ougi: any;
    skills: any[];
    stats?: any;
    flbMaterials?: any;
  }>;
  story: {
    totalCrystals: number;
    chapters: Array<{
      chapterNumber: number;
      title: string;
      japaneseTitle?: string;
      part?: string;
      episodes: Array<{
        episodeNumber: number;
        apCost: number;
        hasBattle: boolean;
        reward?: string;
        unlockFeature?: string;
      }>;
    }>;
  };
  quests: {
    singleQuests: EventQuestDefinition[];
    raidQuests: EventQuestDefinition[];
    challengeQuests?: EventQuestDefinition[];
    hellQuests: EventQuestDefinition[];
  };
  currencies: EventCurrencyDefinition[];
  exchangeShop: {
    totalEssentialCost: {
      medallions: number;
      secondaryTreasure: number;
      fruitParfaits?: number;
    };
    items: EventExchangeItem[];
  };
  dailyMissions: Array<{
    id: string;
    description: string;
    targetType?: string;
    targetCount: number;
    reward: {
      item: string;
      amount: number;
    };
    resetTime: string;
  }>;
  trophies: Array<{
    id: string;
    title: string;
    japaneseTitle?: string;
    grade?: string;
    condition: string;
    rewardCrystals: number;
  }>;
  optimalFarmingBlueprint: {
    routineSteps: string[];
    apEpEfficiencyBreakdown: Record<string, string>;
    recommendedParties: Record<string, any>;
  };
}

// Side Stories Subsystem & Permanent Vault (KMS Vol. 16)
export type SideStoryCategory =
  | 'anniversary'
  | 'collaboration'
  | 'dragon_knights'
  | 'society'
  | 'summer'
  | 'sky_adventures'
  | 'robomi'
  | 'idols'
  | string;

export interface SideStoryCharacterReward {
  name: string;
  japaneseName?: string;
  rarity: 'SSR' | 'SR' | 'R' | string;
  element: string;
  joinCondition: string;
}

export interface SideStoryWeaponReward {
  name: string;
  rarity: string;
  type: string;
  element: string;
  isBahamutOrAtma?: boolean;
  notes?: string;
}

export interface SideStorySummonReward {
  name: string;
  rarity: string;
  element: string;
}

export interface SideStoryMasterItem {
  id: string;
  sidestoryId: number;
  title: string;
  japaneseTitle: string;
  category: SideStoryCategory;
  hashRoute: string;
  unlockPrerequisite: {
    mainQuestChapter: number;
    prerequisiteSideStories?: string[];
  };
  elements?: {
    bossElement?: string;
    advantageousElement?: string;
  };
  rewards: {
    premiumDrawTickets: number;
    storyCrystals: number;
    halfElixirsMax?: number;
    soulBerriesMax?: number;
    characters?: SideStoryCharacterReward[];
    weapons?: SideStoryWeaponReward[];
    summons?: SideStorySummonReward[];
  };
  treasureTrade?: {
    medallionName?: string;
    secondaryTreasureName?: string;
  };
  priorityTier: number;
}

export interface SideStoryGlobalTotals {
  totalSideStories: number;
  totalPremiumDrawTickets: number;
  totalStoryCrystals: number;
  totalHalfElixirs: number;
  totalSoulBerries?: number;
  totalFreeCharacters: number;
  totalSsrCharacters: number;
}





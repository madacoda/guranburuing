// src/domain/siete/siete-readiness.types.ts

export type SieteReadinessGrade = 'SSS' | 'SS' | 'S' | 'A' | 'B' | 'C' | 'NOT_READY';

export type SieteRosterSource = 'cdp_live' | 'cached_snapshot' | 'roster_config';

export interface SietePlayerCharacterItem {
  id?: string;
  npcId?: string;
  name: string;
  element?: string;
  level?: number;
  uncapStars?: number;
  hasFourthSkill?: boolean;
  ringed?: boolean;
  awakeningType?: string;
  slotPosition?: 'frontline_1' | 'frontline_2' | 'frontline_3' | 'backline_1' | 'backline_2' | 'inventory';
}

export interface SietePlayerWeaponItem {
  id?: string;
  weaponId?: string;
  name: string;
  copies?: number;
  level?: number;
  uncapStars?: number;
  awakeningType?: string;
  awakeningLevel?: number;
  pendulumKeys?: string[];
  isMainhand?: boolean;
}

export interface SietePlayerSummonItem {
  id?: string;
  summonId?: string;
  name: string;
  level?: number;
  uncapStars?: number;
  slotRole?: 'main' | 'supporter' | 'sub' | 'sub_aura' | 'inventory';
}

export interface SietePlayerRosterInput {
  version?: string;
  generatedAt?: string;
  description?: string;
  accountId?: string;
  source?: SieteRosterSource;
  activeMcClass?: string;
  mcClassesUnlocked?: string[];
  activeMcSkills?: string[];
  estimatedPartyHp?: number;
  characters: SietePlayerCharacterItem[];
  weapons: SietePlayerWeaponItem[];
  summons: SietePlayerSummonItem[];
}

export interface SieteHardGateCheckResult {
  gateId: string;
  name: string;
  severity: 'CRITICAL_BLOCKER' | 'WARNING';
  passed: boolean;
  measuredValue: string;
  requiredThreshold: string;
  diagnosticMessage: string;
}

export interface SieteCharacterSlotCheckResult {
  slotNumber: number;
  slotRole: string;
  position: 'frontline' | 'backline';
  primaryCharacterId: string;
  primaryCharacterName: string;
  status: 'PRIMARY_MATCH' | 'SUBSTITUTE_MATCH' | 'FALLBACK_MATCH' | 'MISSING';
  matchedCharacterId?: string;
  matchedCharacterName?: string;
  compatibilityScore: number; // 0 - 100
  meetsLevelAndUncap: boolean;
  estimatedTurnDamage: number;
  estimatedPeakDamage: number;
  notes: string;
}

export interface SieteWeaponSlotCheckResult {
  roleLabel: string;
  primaryWeaponId: string;
  primaryWeaponName: string;
  recommendedCopies: number;
  ownedEffectiveCopies: number;
  status: 'FULL_PRIMARY' | 'PARTIAL_OR_SUBSTITUTE' | 'MISSING';
  matchedWeaponsSummary: string;
  resonatorConditionMet: boolean;
  slotScore: number; // 0 - 100
  notes: string;
}

export interface SieteSummonCheckResult {
  mainSummonMatched: string | null;
  supporterSummonMatched: string | null;
  subAuraSummonsMatched: string[];
  missingSubAuraSummons: string[];
  totalPassiveDamageCapBonusPercent: number;
  totalSeraphicAmpPercent: number;
  totalSupplementalDamageFlat: number;
  totalHpBonusPercent: number;
  summonScore: number; // 0 - 100
  notes: string[];
}

export interface SieteDamageAndHonorProjection {
  estimatedPartyHp: number;
  estimatedAverageTurnDamage: number;
  estimatedPeakBurstTurnDamage: number;
  estimatedTurn1To3TotalDamage: number;
  clears77M7EmblemaOmen: boolean;
  omenCancelMarginDamage: number;
  estimatedAverageHonorsPerTurn: number;
  estimatedTurnsTo4MHonors: number;
  meets4MHonorsTarget: boolean;
  totalGridDamageCapPercent: number;
  totalGridSupplementalFlat: number;
  resonatorWeaponTypeCounts: Record<string, number>;
  maxIdenticalWeaponTypeCount: number;
}

export interface SieteArchetypeEvaluationResult {
  archetypeId: string;
  archetypeName: string;
  playstyle: string;
  overallScore: number; // 0 - 100
  grade: SieteReadinessGrade;
  isReadyFor4MBlueChest: boolean;
  mcScore: number;
  mcMatchedClass: string | null;
  mcStatus: 'PRIMARY' | 'ALTERNATIVE' | 'MISSING';
  characterScore: number;
  characterSlots: SieteCharacterSlotCheckResult[];
  weaponScore: number;
  mainhandMatched: string | null;
  weaponSlots: SieteWeaponSlotCheckResult[];
  summonCheck: SieteSummonCheckResult;
  damageProjection: SieteDamageAndHonorProjection;
  recommendedTurnRotation: string[];
  missingRequirements: string[];
}

export interface SieteSynthesizedOptimalSetup {
  recommendedArchetypeId: string;
  recommendedArchetypeName: string;
  playstyle: string;
  mcClass: string;
  mcSkills: string[];
  mainhandWeapon: string;
  frontlineCharacters: string[];
  backlineCharacters: string[];
  coreGridWeapons: string[];
  mainAndSupportSummons: string;
  subAuraSummons: string[];
  projectedPeakTurnDamage: number;
  projectedAverageTurnDamage: number;
  projectedTurnsTo4MHonors: number;
  canCancel77M7Emblema: boolean;
  turnByTurnExecutionPlan: string[];
}

export interface SieteUpgradeRecommendation {
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'Character' | 'Weapon_Grid' | 'Summon' | 'MC_Class' | 'Uncap_Awakening';
  targetItem: string;
  currentGap: string;
  actionableStep: string;
  expectedHonorOrDamageGain: string;
}

export interface SieteReadinessReport {
  timestamp: string;
  accountId: string;
  source: SieteRosterSource;
  raidName: string;
  questId: string;
  blueChestTargetHonors: number;
  equivalentTargetDamage: number;
  universalOmenCancelDamage: number;
  overallReadinessScore: number;
  overallGrade: SieteReadinessGrade;
  readyFor4MBlueChest: boolean;
  canCancel77M7Omen: boolean;
  hardGateResults: SieteHardGateCheckResult[];
  allCriticalGatesPassed: boolean;
  bestArchetypeEvaluation: SieteArchetypeEvaluationResult;
  allArchetypeEvaluations: SieteArchetypeEvaluationResult[];
  synthesizedOptimalSetup: SieteSynthesizedOptimalSetup;
  upgradeRoadmap: SieteUpgradeRecommendation[];
}

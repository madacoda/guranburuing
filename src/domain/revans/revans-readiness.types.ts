// src/domain/revans/revans-readiness.types.ts

export type RevansRaidId =
  | 'mugen'
  | 'diaspora'
  | 'siegfried'
  | 'siete'
  | 'cosmos'
  | 'agastia';

export type RevansElement =
  | 'fire'
  | 'water'
  | 'earth'
  | 'wind'
  | 'light'
  | 'dark';

export type RevansReadinessGrade =
  | 'SSS'
  | 'SS'
  | 'S'
  | 'A'
  | 'B'
  | 'C'
  | 'NOT_READY';

export type RevansRosterSource =
  | 'cdp_live'
  | 'cached_snapshot'
  | 'roster_config';

export interface RevansPlayerCharacterItem {
  id?: string;
  npcId?: string;
  name: string;
  element: RevansElement;
  level?: number;
  uncapStars?: number;
  hasFourthSkill?: boolean;
  slotPosition?:
    | 'frontline_1'
    | 'frontline_2'
    | 'frontline_3'
    | 'backline_1'
    | 'backline_2'
    | 'inventory';
}

export interface RevansPlayerWeaponItem {
  id?: string;
  weaponId?: string;
  name: string;
  element?: RevansElement;
  copies: number;
  level?: number;
  isMainhand?: boolean;
}

export interface RevansPlayerSummonItem {
  id?: string;
  summonId?: string;
  name: string;
  element?: RevansElement;
  level?: number;
  slotRole?: 'main' | 'supporter' | 'sub' | 'sub_aura' | 'inventory';
}

export interface RevansElementRosterInput {
  element: RevansElement;
  activeMcClass?: string;
  mcClassesUnlocked: string[];
  estimatedPartyHp: number;
  maxHpDeckPriority?: number;
  characters: RevansPlayerCharacterItem[];
  weapons: RevansPlayerWeaponItem[];
  summons: RevansPlayerSummonItem[];
}

export interface RevansMultiElementRosterInput {
  version: string;
  generatedAt: string;
  accountId: string;
  source: RevansRosterSource;
  mcClassesUnlocked: string[];
  elements: Record<RevansElement, RevansElementRosterInput>;
}

// ============================================================================
// Catalog Specification Types
// ============================================================================

export interface RevansOmenDefinition {
  trigger: string;
  omenName: string;
  cancelCondition: string;
  requiredTacticalTags: string[];
  failureConsequence: string;
}

export interface RevansCharacterCatalogItem {
  id: string;
  npcId: string;
  name: string;
  aliases: string[];
  element: RevansElement;
  priorityTier: 'CORE' | 'HIGH' | 'VIABLE' | 'NICHE';
  role: string;
  tacticalTags: string[];
  estimatedTurnDamageContribution: number;
  estimatedPeakBurstContribution: number;
  notes: string;
}

export interface RevansWeaponCatalogItem {
  id: string;
  weaponId: string;
  name: string;
  aliases: string[];
  element: RevansElement | 'any';
  weaponType: string;
  priorityTier: 'CORE' | 'HIGH' | 'VIABLE';
  role: string;
  recommendedCopies: number;
  damageCapBonusPercent: number;
  supplementalDamageFlat: number;
  hpBonusPercent: number;
  notes: string;
}

export interface RevansSummonCatalogItem {
  id: string;
  summonId: string;
  name: string;
  aliases: string[];
  role: 'MAIN_OR_SUPPORT' | 'SUB_AURA' | 'ACTIVE_CALL';
  damageCapBonusPercent: number;
  seraphicAmpPercent: number;
  supplementalDamageFlat: number;
  hpBonusPercent: number;
  notes: string;
}

export interface RevansArchetypeCharacterSlotSpec {
  slotNumber: number;
  position: 'frontline' | 'backline';
  roleLabel: string;
  primaryCharacterId: string;
  acceptableSubstitutes: string[];
  requiredForOmenClear?: boolean;
}

export interface RevansArchetypeWeaponSlotSpec {
  roleLabel: string;
  primaryWeaponId: string;
  recommendedCopies: number;
  acceptableSubstitutes: string[];
}

export interface RevansArchetypeDefinition {
  archetypeId: string;
  name: string;
  playstyle: 'BURST_BLUE_CHEST' | 'OUGI_LOOP' | 'FULL_AUTO_SOLO' | 'HOST_TANK';
  recommendedFor: string;
  minimumViableHp: number;
  recommendedComfortHp: number;
  estimatedTurnsTo4MHonors: number;
  mcSpec: {
    primaryClass: string;
    alternativeClasses: string[];
    recommendedSkills: string[];
    preferredMainhandIds: string[];
  };
  characterSlots: RevansArchetypeCharacterSlotSpec[];
  weaponSlots: RevansArchetypeWeaponSlotSpec[];
  summonSpec: {
    preferredMainSummonIds: string[];
    preferredSupportSummonIds: string[];
    recommendedSubAuraSummonIds: string[];
  };
  turnByTurnRotation: string[];
}

export interface RevansRaidCatalogEntry {
  raidId: RevansRaidId;
  raidName: string;
  bossName: string;
  questId: string;
  stageId: string;
  bossElement: RevansElement;
  advantageousElement: RevansElement;
  attributeCode: string; // '1'..'6'
  blueChestTargetHonors: number;
  equivalentTargetDamage: number;
  minimumEntryHp: number;
  recommendedComfortHp: number;
  entryMechanicWarning: string;
  signatureWeaponDrop: {
    name: string;
    weaponId: string;
    weaponType: string;
    description: string;
  };
  coreOmens: RevansOmenDefinition[];
  requiredTacticalTagsForComfort: string[];
  characterRegistry: RevansCharacterCatalogItem[];
  weaponRegistry: RevansWeaponCatalogItem[];
  summonRegistry: RevansSummonCatalogItem[];
  archetypes: RevansArchetypeDefinition[];
}

export interface RevansPartyCompositionsCatalog {
  version: string;
  lastUpdated: string;
  description: string;
  raids: Record<RevansRaidId, RevansRaidCatalogEntry>;
}

// ============================================================================
// Evaluation Result & Report Types
// ============================================================================

export interface RevansHardGateCheckResult {
  gateId: string;
  name: string;
  severity: 'CRITICAL_BLOCKER' | 'WARNING';
  passed: boolean;
  measuredValue: string;
  requiredThreshold: string;
  diagnosticMessage: string;
}

export interface RevansCharacterSlotCheckResult {
  slotNumber: number;
  slotRole: string;
  position: 'frontline' | 'backline';
  primaryCharacterId: string;
  primaryCharacterName: string;
  status: 'PRIMARY_MATCH' | 'SUBSTITUTE_MATCH' | 'FALLBACK_MATCH' | 'MISSING';
  matchedCharacterId?: string;
  matchedCharacterName?: string;
  matchedNpcId?: string;
  compatibilityScore: number;
  estimatedTurnDamage: number;
  estimatedPeakDamage: number;
  notes: string;
}

export interface RevansWeaponSlotCheckResult {
  roleLabel: string;
  primaryWeaponId: string;
  primaryWeaponName: string;
  recommendedCopies: number;
  ownedEffectiveCopies: number;
  status: 'FULL_PRIMARY' | 'PARTIAL_OR_SUBSTITUTE' | 'MISSING';
  matchedWeaponsSummary: string;
  slotScore: number;
  notes: string;
}

export interface RevansSummonCheckResult {
  mainSummonMatched: string | null;
  supporterSummonMatched: string | null;
  subAuraSummonsMatched: string[];
  missingSubAuraSummons: string[];
  totalPassiveDamageCapBonusPercent: number;
  totalSeraphicAmpPercent: number;
  totalSupplementalDamageFlat: number;
  totalHpBonusPercent: number;
  summonScore: number;
  notes: string[];
}

export interface RevansOmenCoverageResult {
  omenName: string;
  trigger: string;
  cancelCondition: string;
  covered: boolean;
  matchedSolvers: string[];
  missingTags: string[];
}

export interface RevansArchetypeEvaluationResult {
  archetypeId: string;
  archetypeName: string;
  playstyle: string;
  overallScore: number;
  grade: RevansReadinessGrade;
  isReadyFor4MBlueChest: boolean;
  mcScore: number;
  mcMatchedClass: string | null;
  mcStatus: 'PRIMARY' | 'ALTERNATIVE' | 'MISSING';
  characterScore: number;
  characterSlots: RevansCharacterSlotCheckResult[];
  weaponScore: number;
  mainhandMatched: string | null;
  weaponSlots: RevansWeaponSlotCheckResult[];
  summonCheck: RevansSummonCheckResult;
  omenCoverage: RevansOmenCoverageResult[];
  estimatedPartyHp: number;
  estimatedAverageTurnDamage: number;
  estimatedPeakBurstTurnDamage: number;
  estimatedTurnsTo4MHonors: number;
  recommendedTurnRotation: string[];
  missingRequirements: string[];
}

export interface RevansSynthesizedOptimalSetup {
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
  omenCancelReadinessSummary: string;
  turnByTurnExecutionPlan: string[];
}

export interface RevansUpgradeRecommendation {
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: 'Character' | 'Weapon_Grid' | 'Summon' | 'MC_Class' | 'HP_Survivability';
  targetItem: string;
  currentGap: string;
  actionableStep: string;
  expectedHonorOrDamageGain: string;
}

export interface RevansSingleRaidReport {
  timestamp: string;
  accountId: string;
  source: RevansRosterSource;
  raidId: RevansRaidId;
  raidName: string;
  bossName: string;
  questId: string;
  stageId: string;
  bossElement: RevansElement;
  advantageousElement: RevansElement;
  signatureWeaponDrop: string;
  blueChestTargetHonors: number;
  equivalentTargetDamage: number;
  overallReadinessScore: number;
  overallGrade: RevansReadinessGrade;
  readyFor4MBlueChest: boolean;
  omenSolverCoverageRatio: string;
  measuredElementMaxHp: number;
  minimumRequiredHp: number;
  hardGateResults: RevansHardGateCheckResult[];
  allCriticalGatesPassed: boolean;
  bestArchetypeEvaluation: RevansArchetypeEvaluationResult;
  allArchetypeEvaluations: RevansArchetypeEvaluationResult[];
  synthesizedOptimalSetup: RevansSynthesizedOptimalSetup;
  upgradeRoadmap: RevansUpgradeRecommendation[];
}

export interface RevansAllRaidsSummaryReport {
  timestamp: string;
  accountId: string;
  source: RevansRosterSource;
  totalRaidsEvaluated: number;
  readyRaidsCount: number;
  averageReadinessScore: number;
  bestRaidId: RevansRaidId;
  recommendedFarmingOrder: RevansRaidId[];
  raidReports: Record<RevansRaidId, RevansSingleRaidReport>;
}

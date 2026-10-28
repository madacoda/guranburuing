// src/domain/siete/siete-auto-setup.types.ts
import { SieteReadinessReport } from './siete-readiness.types.js';
import { WorkflowStep } from '../../types/workflow.types.js';

export type SieteArchetypeId =
  | 'siete_fire_manadiver_burst_2t'
  | 'siete_fire_kengo_ougi_loop'
  | 'siete_fire_paladin_safe_full_auto'
  | string;

export interface ResolvedDeckTarget {
  /** GBF internal deck priority ID (e.g. 153 for Ex A Party 3) */
  priority: number;
  /** Group priority ID (e.g. 15 for Ex A Group 1) */
  groupPriority: number;
  /** Party order within group (1..6) */
  orderNo: number;
  /** Deck set category */
  setType: 'Set A' | 'Set B' | 'Ex A' | 'Ex B';
  /** Number of weapon slots supported by this deck (10 for Set A/B, 13 for Ex A/B) */
  maxWeaponSlots: 10 | 13;
  /** Human-readable label (e.g. "Ex A Party 3 (Group 15, Priority 153)") */
  label: string;
}

export interface DiscoveredJobInstance {
  userJobId: number;
  masterId: string;
  name: string;
  classType?: number;
  seenInDeck?: number;
}

export interface DiscoveredSubskillInstance {
  abilityId: string;
  name: string;
  defaultPos?: number;
}

export interface DiscoveredNpcInstance {
  userNpcId: number;
  masterId: string;
  name: string;
  attribute: number;
  level: number;
  evolution: number;
}

export interface DiscoveredWeaponInstance {
  userWeaponId: number;
  masterId: string;
  name: string;
  attribute: number;
  level: number;
  arousalForm?: string | null;
  skill1?: string | null;
  skill2?: string | null;
  skill3?: string | null;
}

export interface DiscoveredSummonInstance {
  userSummonId: string;
  masterId: string;
  name: string;
  attribute: number;
  level: number;
  evolution: number;
}

export interface DiscoveredAccountInventory {
  accountId: string;
  scannedPriorities: number[];
  jobs: DiscoveredJobInstance[];
  subskills: DiscoveredSubskillInstance[];
  npcs: DiscoveredNpcInstance[];
  weapons: DiscoveredWeaponInstance[];
  summons: DiscoveredSummonInstance[];
}

export interface PlannedMcSubskill {
  setPos: 0 | 1 | 2;
  abilityId: string;
  name: string;
}

export interface PlannedMcJob {
  userJobId: number;
  masterId: string;
  name: string;
  subskills: PlannedMcSubskill[];
}

export interface PlannedPartySlot {
  slot: 1 | 2 | 3 | 4 | 5;
  role: 'frontline' | 'backline';
  userNpcId: number;
  masterId: string;
  name: string;
  level: number;
  evolution: number;
}

export interface PlannedWeaponSlot {
  slot: number;
  role: 'mainhand' | 'core' | 'extra';
  userWeaponId: number;
  masterId: string;
  name: string;
  level: number;
  arousalForm?: string | null;
}

export interface PlannedSummonSlot {
  equipment: 'summon' | 'sub_summon';
  slot: number;
  role: 'main' | 'sub' | 'sub_aura';
  userSummonId: string;
  masterId: string;
  name: string;
  level: number;
}

export interface SietePartySetupPlan {
  accountId: string;
  deckTarget: ResolvedDeckTarget;
  archetypeId: SieteArchetypeId;
  mcJob: PlannedMcJob;
  party: PlannedPartySlot[];
  weapons: PlannedWeaponSlot[];
  summons: PlannedSummonSlot[];
  sabreKatanaCount: number;
  workflowSteps: WorkflowStep[];
  notes: string[];
}

export interface SieteMutationStepLog {
  phase: 'mc_class' | 'mc_subskill' | 'party_npc' | 'weapon_grid' | 'summon_grid';
  description: string;
  endpoint: string;
  success: boolean;
  detail?: string;
}

export interface SieteAutoSetupOptions {
  accountId?: string;
  deckTarget?: string | number;
  archetypeId?: SieteArchetypeId;
  dryRun?: boolean;
  syncWorkflow?: boolean;
  workflowFilePath?: string;
  activateDeck?: boolean;
}

export interface SieteAutoSetupResult {
  accountId: string;
  executedAt: string;
  dryRun: boolean;
  plan: SietePartySetupPlan;
  mutations: SieteMutationStepLog[];
  allMutationsSucceeded: boolean;
  verifiedLiveDeck?: {
    priority: number;
    name: string;
    groupName: string;
    mcJobName: string;
    mcSubskills: string[];
    npcs: string[];
    weapons: string[];
    summons: string[];
    subSummons: string[];
  };
  workflowSyncedPath?: string;
  readinessReport?: SieteReadinessReport;
}

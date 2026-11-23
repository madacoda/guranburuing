// src/services/gw/gw-nm95-dark-setup.service.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Page } from 'puppeteer-core';
import { WorkflowStep, WorkflowTemplate } from '../../types/workflow.types.js';
import { SieteAutoSetupService } from '../combat/siete-auto-setup.service.js';

export type GwNm95DarkProfileId = 'fast' | 'safe' | 'legacy';

export interface GwNm95DarkAuditFinding {
  id: string;
  severity: 'CRITICAL_BLOCKER' | 'OPTIMIZATION_OPPORTUNITY' | 'INFO';
  category: 'summon' | 'sub_aura' | 'weapon_grid' | 'party' | 'job';
  title: string;
  detail: string;
  actionableFix?: string;
}

export interface GwNm95DarkEquippedSlot {
  slot: number;
  id: string;
  masterId: string;
  name: string;
  level: number;
  skills?: string[];
  arousalForm?: string | null;
  arousalLevel?: number | null;
}

export interface GwNm95DarkDeckAudit {
  deckPriority: number;
  deckName: string;
  mcJobName: string;
  quickSummonId: string;
  quickSummonIsYatima: boolean;
  axeCount: number;
  hasEreshkigalMh: boolean;
  hasOpusBeta: boolean;
  hasFalsehood: boolean;
  hasEternalSignature: boolean;
  hasPainOfDeath: boolean;
  hasFallenSwordAtkLv4: boolean;
  hasSarielSubAura: boolean;
  hasFedielOrUlbHadesSubAura: boolean;
  hasSummerBelialSub: boolean;
  hasBelialSub: boolean;
  hasDeathSub: boolean;
  hasVersusiaSub: boolean;
  yatimaPoolDeterministic: boolean;
  partyOrderValid: boolean;
  mainAndSubSummons: GwNm95DarkEquippedSlot[];
  subAuraSummons: GwNm95DarkEquippedSlot[];
  weapons: GwNm95DarkEquippedSlot[];
  party: GwNm95DarkEquippedSlot[];
  findings: GwNm95DarkAuditFinding[];
}

export interface GwNm95DarkSimulationResult {
  profileId: GwNm95DarkProfileId;
  profileName: string;
  speedProfile: 'fast' | 'turbo';
  skillCount: number;
  projectedPlayerPhaseDamage: number;
  bossHp: number;
  projectedOverkillMargin: number;
  killsInPlayerPhase: boolean;
  hasSummerBelialSafetyNet: boolean;
  estimatedClearSecMin: number;
  estimatedClearSecMax: number;
  estimatedClearSecAvg: number;
  estimatedHonorsPerRun: number;
  projectedHonorsPerHour: number;
}

export interface GwNm95DarkSummonMutation {
  equipment: 'sub_summon';
  slot: 1 | 2;
  targetName: string;
  targetSummonId: string;
  targetMasterId: string;
  previousName: string;
  previousSummonId: string;
  applied: boolean;
  success: boolean;
  detail: string;
}

export interface GwNm95DarkConflictCheck {
  hasConflict: boolean;
  conflictingProcesses: string[];
  reason?: string;
}

export interface GwNm95DarkSetupOptions {
  accountId?: string;
  deckPriority?: number;
  profile?: GwNm95DarkProfileId | 'auto';
  speedProfile?: 'fast' | 'turbo';
  dryRun?: boolean;
  syncTemplate?: boolean;
  templatePath?: string;
  force?: boolean;
  activeProcessCommands?: string[];
}

export interface GwNm95DarkSetupResult {
  mode: 'offline' | 'dry_run' | 'live_apply' | 'blocked_conflict';
  accountId: string;
  deckPriority: number;
  executedAt: string;
  conflictCheck: GwNm95DarkConflictCheck;
  blockedByActiveWorkflow: boolean;
  initialAudit: GwNm95DarkDeckAudit;
  postMutationAudit: GwNm95DarkDeckAudit;
  recommendedProfile: GwNm95DarkProfileId;
  selectedProfile: GwNm95DarkProfileId;
  simulationsCurrentDeck: GwNm95DarkSimulationResult[];
  simulationsAfterSubAuraSwap: GwNm95DarkSimulationResult[];
  subAuraMutations: GwNm95DarkSummonMutation[];
  workflowSyncedPath?: string;
}

export const GW_NM95_DARK_BOSS_HP = 131_250_000;
export const GW_NM95_DARK_QUEST_ID = '980681';
export const GW_NM95_DARK_QUEST_URL = 'https://game.granbluefantasy.jp/#quest/supporter/980681/1/0/10116';

const YATIMA_MASTER_ID = '2040417000';
const DEATH_MASTER_ID = '2040315000';
const VERSUSIA_MASTER_ID = '2040448000';
const SUMMER_BELIAL_MASTER_ID = '2040411000';
const BELIAL_MASTER_ID = '2040347000';
const SARIEL_MASTER_ID = '2040327000';
const FEDIEL_SUMMON_MASTER_ID = '2040418000';
const HADES_MASTER_ID = '2040090000';
const BEELZEBUB_MASTER_ID = '2040408000';
const BAHAMUT_MASTER_ID = '2040003000';

const KNOWN_SARIEL_DEFAULT_ID = '977961317';
const KNOWN_FEDIEL_DEFAULT_ID = '1510948871';

// Summons excluded from Yatima's random sub-summon call pool (one-use / non-combo calls).
const YATIMA_EXCLUDED_SUB_SUMMON_MASTER_IDS = new Set([
  SUMMER_BELIAL_MASTER_ID,
  BELIAL_MASTER_ID,
  '2040158000', // Qilin
  '2040157000' // Huanglong
]);

const KNOWN_AXE_NAME_HINTS = [
  'ereshkigal',
  'pain and suffering',
  'scythe of darkherald',
  'celeste zaghnal',
  'vynateya',
  'abyssal axe',
  'zephyrus'
];

function isAxeWeapon(weapon: any): boolean {
  const kind = String(weapon?.master?.kind || '');
  const masterId = String(weapon?.master?.id || '');
  const name = String(weapon?.master?.name || '').toLowerCase();
  if (kind === '3' || masterId.startsWith('10403')) return true;
  return KNOWN_AXE_NAME_HINTS.some(h => name.includes(h));
}

function isSummerBelialSlot(s: GwNm95DarkEquippedSlot): boolean {
  const name = s.name.toLowerCase();
  const skillsJoined = (s.skills || []).join(' ').toLowerCase();
  if (s.masterId === SUMMER_BELIAL_MASTER_ID) return true;
  if (skillsJoined.includes("i'll be gentle") || skillsJoined.includes('hotter than the sun')) return true;
  return name.includes('belial') && s.level > 0 && s.level <= 80 && s.masterId !== BELIAL_MASTER_ID;
}

function isRegularBelialSlot(s: GwNm95DarkEquippedSlot): boolean {
  const name = s.name.toLowerCase();
  if (s.masterId === BELIAL_MASTER_ID) return true;
  if (isSummerBelialSlot(s)) return false;
  return name.includes('belial') && s.level >= 100;
}

/**
 * Deterministic baseline Deck 133 snapshot matching the live acc1 audit for `--offline` simulation.
 */
export function buildDefaultOfflineDeck133Snapshot(): any {
  return {
    priority: 133,
    name: 'Fire',
    pc: {
      quick_user_summon_id: '1301888572',
      job: { master: { id: '100501', name: 'Fighter Origin' } },
      weapons: {
        '1': { param: { id: '4514830075', level: '250' }, master: { id: '1040315100', name: 'Ereshkigal', kind: '3' }, skill1: { name: 'Gugalanna' }, skill2: { name: 'Disease Demon II' }, skill3: { name: 'Tell Ibrahim II' } },
        '2': { param: { id: '3959082228', level: '150' }, master: { id: '1040314300', name: 'Pain and Suffering', kind: '3' }, skill1: { name: "Purgatory's Pact" }, skill2: { name: 'Axe Voltage II' }, skill3: { name: "Purgatory's Quintessence" } },
        '3': { param: { id: '4322348153', level: '150' }, master: { id: '1040314300', name: 'Pain and Suffering', kind: '3' }, skill1: { name: "Purgatory's Pact" }, skill2: { name: 'Axe Voltage II' }, skill3: { name: "Purgatory's Quintessence" } },
        '4': { param: { id: '4316304531', level: '150' }, master: { id: '1040116600', name: 'Eternal Signature', kind: '2' }, skill1: { name: 'Graphite Convergence' }, skill2: { name: "Dark's Majesty" } },
        '5': { param: { id: '3679737516', level: '150', arousal: { level: 1, form_name: 'Multiattack' } }, master: { id: '1040014300', name: 'Fallen Sword', kind: '1' }, skill1: { name: "Oblivion's Might III" }, skill2: { name: "Hatred's Stamina" } },
        '6': { param: { id: '4805688649', level: '150' }, master: { id: '1040916700', name: 'Causality Driver', kind: '10' }, skill1: { name: 'Optimus Exalto Caliginis' }, skill2: { name: "Dark's Fandango" }, skill3: { name: "Oblivion's Deathstrike" } },
        '7': { param: { id: '3444868993', level: '220' }, master: { id: '1040911000', name: 'Katana of Repudiation', kind: '10' }, skill1: { name: "Oblivion's Majesty II" }, skill2: { name: 'α Revelation Ruber ' }, skill3: { name: 'Deceitful Fallacy' } },
        '8': { param: { id: '3641774713', level: '150', arousal: { level: 4, form_name: 'Attack' } }, master: { id: '1040108700', name: 'Parazonium', kind: '2' }, skill1: { name: "Oblivion's Might III" }, skill2: { name: "Dark's Trium" } },
        '9': { param: { id: '4335298881', level: '200' }, master: { id: '1040113200', name: 'Pain of Death', kind: '2' }, skill1: { name: "Lovers-Death's Demise" }, skill2: { name: 'Sephira Maxi-Dark ' }, skill3: { name: "Dark's Majesty" } },
        '10': { param: { id: '2812453290', level: '150' }, master: { id: '1040310800', name: 'Scythe of Darkherald', kind: '3' }, skill1: { name: "Debauchery's Sway III" }, skill2: { name: "Dark's Majesty" } }
      },
      summons: {
        '1': { param: { id: '1301888572', level: '150' }, master: { id: '2040417000', name: 'Yatima' } },
        '2': { param: { id: '1273519543', level: '40' }, master: { id: '2040411000', name: 'Belial' }, sub_skill: { name: "I'll Be Gentle" } },
        '3': { param: { id: '971897245', level: '200' }, master: { id: '2040315000', name: 'Death' } },
        '4': { param: { id: '1510948782', level: '150' }, master: { id: '2040448000', name: 'Versusia' } },
        '5': { param: { id: '933713546', level: '150' }, master: { id: '2040347000', name: 'Belial' } }
      },
      sub_summons: {
        '1': { param: { id: '1217829246', level: '150' }, master: { id: '2040408000', name: 'Beelzebub' } },
        '2': { param: { id: '906416626', level: '250' }, master: { id: '2040003000', name: 'Bahamut' } }
      }
    },
    npc: {
      '1': { param: { id: '215397473', level: '80' }, master: { id: '3040456000', name: 'Ilsa' } },
      '2': { param: { id: '141499170', level: '150' }, master: { id: '3040035000', name: 'Seox' } },
      '3': { param: { id: '249737739', level: '80' }, master: { id: '3040680000', name: 'Ewiyar' } },
      '4': { param: { id: '158453965', level: '100' }, master: { id: '3040169000', name: 'Nier' } },
      '5': { param: { id: '219359732', level: '80' }, master: { id: '3040503000', name: 'Tyra' } }
    }
  };
}

/**
 * Auditing, damage simulation, Sub-Aura mutation, conflict guard, and workflow synthesis
 * for Unite and Fight (GW) Nightmare 95 Dark using the Yatima -> Death+Versusia -> Nier / Ereshkigal engine.
 */
export class GwNm95DarkSetupService {
  /**
   * Audits a live or snapshot `/party/deck/{priority}` object for Yatima determinism,
   * Sub-Aura efficiency, weapon cap-bracket waste, Resonator counts, and party order.
   */
  public static auditDeckData(deck: any): GwNm95DarkDeckAudit {
    const findings: GwNm95DarkAuditFinding[] = [];
    const deckPriority = Number(deck?.priority || 133);
    const deckName = String(deck?.name || 'NM95 Dark');
    const mcJobName = String(deck?.pc?.job?.master?.name || '');
    const quickSummonId = String(deck?.pc?.quick_user_summon_id || '');

    const parseSummonMap = (raw: Record<string, any> | undefined): GwNm95DarkEquippedSlot[] =>
      Object.entries(raw || {})
        .filter(([, v]) => v?.master?.name || v?.param?.id)
        .map(([k, v]) => ({
          slot: Number(k),
          id: String(v?.param?.id || ''),
          masterId: String(v?.master?.id || ''),
          name: String(v?.master?.name || ''),
          level: Number(v?.param?.level || 0),
          skills: [v?.special_skill?.name, v?.skill?.name, v?.sub_skill?.name].filter(Boolean).map(String)
        }))
        .sort((a, b) => a.slot - b.slot);

    const mainAndSubSummons = parseSummonMap(deck?.pc?.summons);
    const subAuraSummons = parseSummonMap(deck?.pc?.sub_summons);

    const weapons: GwNm95DarkEquippedSlot[] = Object.entries(deck?.pc?.weapons || {})
      .filter(([, v]: [string, any]) => v?.master?.name || v?.param?.id)
      .map(([k, v]: [string, any]) => ({
        slot: Number(k),
        id: String(v?.param?.id || ''),
        masterId: String(v?.master?.id || ''),
        name: String(v?.master?.name || ''),
        level: Number(v?.param?.level || 0),
        skills: [v?.skill1?.name, v?.skill2?.name, v?.skill3?.name].filter(Boolean).map(String),
        arousalForm: v?.param?.arousal?.form_name || null,
        arousalLevel: v?.param?.arousal?.level ? Number(v.param.arousal.level) : null
      }))
      .sort((a, b) => a.slot - b.slot);

    const party: GwNm95DarkEquippedSlot[] = Object.entries(deck?.npc || {})
      .filter(([, v]: [string, any]) => v?.master?.name || v?.param?.id)
      .map(([k, v]: [string, any]) => ({
        slot: Number(k),
        id: String(v?.param?.id || ''),
        masterId: String(v?.master?.id || ''),
        name: String(v?.master?.name || ''),
        level: Number(v?.param?.level || 0)
      }))
      .sort((a, b) => a.slot - b.slot);

    // 1. Yatima Quick Call & Sub 2-5 Determinism Audit
    const mainSummon = mainAndSubSummons.find(s => s.slot === 1);
    const mainIsYatima = Boolean(
      mainSummon && (mainSummon.masterId === YATIMA_MASTER_ID || mainSummon.name.toLowerCase().includes('yatima'))
    );
    const quickSummonIsYatima = Boolean(
      mainIsYatima && (!quickSummonId || quickSummonId === mainSummon?.id)
    );
    if (!mainIsYatima || !quickSummonIsYatima) {
      findings.push({
        id: 'yatima_not_quick_main',
        severity: 'CRITICAL_BLOCKER',
        category: 'summon',
        title: 'Main & Quick Summon must be Yatima Lv150',
        detail: `Main=${mainSummon?.name || 'Empty'}, QuickID=${quickSummonId || 'unset'}.`,
        actionableFix: 'Equip Yatima Lv150 in Main Slot 1 and pin it as Quick Summon.'
      });
    }

    const subSlots2To5 = mainAndSubSummons.filter(s => s.slot >= 2 && s.slot <= 5);
    const hasDeathSub = subSlots2To5.some(
      s => s.masterId === DEATH_MASTER_ID || s.name.toLowerCase() === 'death'
    );
    const hasVersusiaSub = subSlots2To5.some(
      s => s.masterId === VERSUSIA_MASTER_ID || s.name.toLowerCase().includes('versusia')
    );
    const hasSummerBelialSub = subSlots2To5.some(isSummerBelialSlot);
    const hasBelialSub = subSlots2To5.some(isRegularBelialSlot);

    if (!hasDeathSub || !hasVersusiaSub) {
      findings.push({
        id: 'yatima_missing_core_call',
        severity: 'CRITICAL_BLOCKER',
        category: 'summon',
        title: 'Yatima pool missing Death Lv200 or Versusia Lv150',
        detail: `Death=${hasDeathSub}, Versusia=${hasVersusiaSub} in Sub Slots 2-5.`,
        actionableFix: 'Equip Death Lv200 and Versusia Lv150 inside Sub Slots 2-5.'
      });
    }

    const extraCallables = subSlots2To5.filter(s => {
      const isDeath = s.masterId === DEATH_MASTER_ID || s.name.toLowerCase() === 'death';
      const isVersusia = s.masterId === VERSUSIA_MASTER_ID || s.name.toLowerCase().includes('versusia');
      if (isDeath || isVersusia) return false;
      if (isSummerBelialSlot(s) || isRegularBelialSlot(s)) return false;
      return !YATIMA_EXCLUDED_SUB_SUMMON_MASTER_IDS.has(s.masterId);
    });

    const yatimaPoolDeterministic = Boolean(mainIsYatima && quickSummonIsYatima && hasDeathSub && hasVersusiaSub && extraCallables.length === 0);
    if (extraCallables.length > 0) {
      findings.push({
        id: 'yatima_pool_contaminated',
        severity: 'CRITICAL_BLOCKER',
        category: 'summon',
        title: 'Yatima callable pool contaminated by extra callable summon',
        detail: `Callable summon(s) in Sub 2-5 [${extraCallables.map(s => `${s.name} Lv${s.level}`).join(', ')}] dilute Death+Versusia RNG.`,
        actionableFix: 'Keep Sub 2-5 strictly as Death + Versusia + 2 Yatima-excluded summons (Summer Belial + Belial). Place Sariel/Fediel in Sub-Aura 1-2 only.'
      });
    }

    // 2. Sub-Aura Audit
    const hasSarielSubAura = subAuraSummons.some(
      s => s.masterId === SARIEL_MASTER_ID || s.name.toLowerCase().includes('sariel')
    );
    const hasFedielOrUlbHadesSubAura = subAuraSummons.some(
      s =>
        s.masterId === FEDIEL_SUMMON_MASTER_ID ||
        s.name.toLowerCase().includes('fediel') ||
        ((s.masterId === HADES_MASTER_ID || s.name.toLowerCase().includes('hades')) && s.level >= 210)
    );

    const bubsInSubAura = subAuraSummons.find(
      s => s.masterId === BEELZEBUB_MASTER_ID || s.name.toLowerCase().includes('beelzebub')
    );
    if (bubsInSubAura) {
      findings.push({
        id: 'subaura_beelzebub_wasted',
        severity: 'OPTIMIZATION_OPPORTUNITY',
        category: 'sub_aura',
        title: 'Beelzebub in Sub-Aura Slot deals 0% damage on Turn-1 Ereshkigal',
        detail: 'Beelzebub sub-aura only grants 50% ATK / 20% Cap at Trance Lvl 3 (3+ MC C.A.s). Turn-1 Ereshkigal reaches max Trance 2.',
        actionableFix: 'Replace Sub-Aura 1 with Sariel Lv150 (+15% Dark DMG Cap, ~+10.0M damage).'
      });
    } else if (!hasSarielSubAura) {
      findings.push({
        id: 'subaura_missing_sariel',
        severity: 'OPTIMIZATION_OPPORTUNITY',
        category: 'sub_aura',
        title: 'Missing Sariel Lv150 (+15% Dark DMG Cap) in Sub-Aura Slots',
        detail: 'Sariel is passive, excluded from Yatima calls, and provides ~+10.0M Turn-1 damage.',
        actionableFix: 'Place Sariel Lv150 in Sub-Aura Slot 1.'
      });
    }

    const bahamutInSubAura = subAuraSummons.find(
      s => s.masterId === BAHAMUT_MASTER_ID || s.name.toLowerCase().includes('bahamut')
    );
    if (bahamutInSubAura) {
      findings.push({
        id: 'subaura_bahamut_wasted',
        severity: 'OPTIMIZATION_OPPORTUNITY',
        category: 'sub_aura',
        title: 'Bahamut Lv250 in Sub-Aura adds 0% under Yatima zero-call-damage rule',
        detail: "Yatima's activated calls deal 0 direct call damage, so Bahamut's +50% call DMG and -1T CD cut do nothing.",
        actionableFix: 'Replace Sub-Aura 2 with Fediel (+10% Optimus aura, ~+1.2M damage).'
      });
    } else if (!hasFedielOrUlbHadesSubAura) {
      findings.push({
        id: 'subaura_missing_fediel',
        severity: 'OPTIMIZATION_OPPORTUNITY',
        category: 'sub_aura',
        title: 'Sub-Aura Slot 2 missing Fediel (+10% Optimus) or Hades Lv210+',
        detail: 'Adding Fediel boosts Fallen Sword, Parazonium, Dark Opus, and Causality Driver.',
        actionableFix: 'Place Fediel in Sub-Aura Slot 2.'
      });
    }

    // 3. Weapon Grid & Cap Bracket Audit
    const mhWeapon = weapons.find(w => w.slot === 1);
    const hasEreshkigalMh = Boolean(
      mhWeapon && (mhWeapon.masterId === '1040315100' || mhWeapon.name.toLowerCase().includes('ereshkigal'))
    );
    if (!hasEreshkigalMh) {
      findings.push({
        id: 'missing_ereshkigal_mh',
        severity: 'CRITICAL_BLOCKER',
        category: 'weapon_grid',
        title: 'Slot 1 Mainhand is not Ereshkigal',
        detail: `Found "${mhWeapon?.name || 'Empty'}" in Slot 1.`,
        actionableFix: 'Equip Ereshkigal Lv250 as Mainhand for Tell Ibrahim II + Disease Demon II.'
      });
    }

    const rawWeaponsList = Object.values(deck?.pc?.weapons || {}) as any[];
    const axeCount = rawWeaponsList.filter(isAxeWeapon).length;
    const hasEternalSignature = weapons.some(
      w => w.masterId === '1040116600' || w.name.toLowerCase().includes('eternal signature')
    );
    if (hasEternalSignature && axeCount < 4) {
      findings.push({
        id: 'eternal_signature_axe_count',
        severity: 'CRITICAL_BLOCKER',
        category: 'weapon_grid',
        title: 'Eternal Signature Graphite Convergence inactive (< 4 Axes)',
        detail: `Only ${axeCount} Axe(s) equipped; 4 Axes required for +7% Special Cap & ATK/DEF.`,
        actionableFix: 'Keep 4 Axes equipped (Ereshkigal, 2x Pain and Suffering, Scythe of Darkherald).'
      });
    }

    const opusWeapon = weapons.find(
      w => w.masterId === '1040911000' || w.name.toLowerCase().includes('katana of repudiation')
    );
    const opusSkillsStr = (opusWeapon?.skills || []).join(' ').toLowerCase();
    const hasOpusBeta = /β|beta|skill/i.test(opusSkillsStr) && !/α|alpha/i.test(opusWeapon?.skills?.[1]?.toLowerCase() || '');
    const hasFalsehood = opusSkillsStr.includes('fallacy') || opusSkillsStr.includes('falsehood');
    if (opusWeapon && !hasOpusBeta) {
      findings.push({
        id: 'opus_alpha_wasted',
        severity: 'OPTIMIZATION_OPPORTUNITY',
        category: 'weapon_grid',
        title: 'Dark Opus Skill 2 α (Normal Cap +10%) is wasted under Ereshkigal',
        detail: 'Ereshkigal Disease Demon II alone hits the 20% Normal Attack DMG Cap grid limit.',
        actionableFix: 'Swap Dark Opus Skill 2 from α -> β (+50% Skill Cap) for +4.5M-5.5M on Eternal Vow & Celestial Dominion.'
      });
    }

    const fallenSword = weapons.find(
      w => w.masterId === '1040014300' || w.name.toLowerCase().includes('fallen sword')
    );
    const hasFallenSwordAtkLv4 = Boolean(
      fallenSword &&
        fallenSword.arousalForm?.toLowerCase() === 'attack' &&
        (fallenSword.arousalLevel ?? 0) >= 4
    );
    if (fallenSword && !hasFallenSwordAtkLv4) {
      findings.push({
        id: 'fallen_sword_awakening',
        severity: 'OPTIMIZATION_OPPORTUNITY',
        category: 'weapon_grid',
        title: `Fallen Sword Awakening (${fallenSword.arousalForm || 'None'} Lv${fallenSword.arousalLevel ?? 1}) suboptimal`,
        detail: 'Multiattack Lv1 provides 0% bonus, while Death + Ereshkigal already guarantee 100% TA.',
        actionableFix: 'Re-awaken Fallen Sword to Attack Lv4 (+35% ATK) for +2.0M consistency.'
      });
    }

    const hasPainOfDeath = weapons.some(
      w => w.masterId === '1040113200' || w.name.toLowerCase().includes('pain of death')
    );

    // 4. Party Composition & Death Target Slot Order Audit
    const s1 = party.find(p => p.slot === 1)?.name.toLowerCase() || '';
    const s2 = party.find(p => p.slot === 2)?.name.toLowerCase() || '';
    const s3 = party.find(p => p.slot === 3)?.name.toLowerCase() || '';
    const s4 = party.find(p => p.slot === 4)?.name.toLowerCase() || '';
    const partyOrderValid =
      s1.includes('ilsa') &&
      s2.includes('seox') &&
      s3.includes('ewiyar') &&
      s4.includes('nier');

    if (!partyOrderValid) {
      findings.push({
        id: 'party_slot_order',
        severity: 'CRITICAL_BLOCKER',
        category: 'party',
        title: 'Party slots must place Ewiyar in 4th position (Slot 3) and Nier in Backline 1 (Slot 4)',
        detail: `Observed order: [${party.map(p => `${p.slot}:${p.name}`).join(', ')}]. Death kills 4th position to trigger The Lovers Upright & Ilsa Diuturna.`,
        actionableFix: 'Set NPCs: 1=Ilsa (Yukata), 2=Seox Lv150, 3=Ewiyar (Halloween), 4=Nier Lv100.'
      });
    }

    return {
      deckPriority,
      deckName,
      mcJobName,
      quickSummonId,
      quickSummonIsYatima,
      axeCount,
      hasEreshkigalMh,
      hasOpusBeta,
      hasFalsehood,
      hasEternalSignature,
      hasPainOfDeath,
      hasFallenSwordAtkLv4,
      hasSarielSubAura,
      hasFedielOrUlbHadesSubAura,
      hasSummerBelialSub,
      hasBelialSub,
      hasDeathSub,
      hasVersusiaSub,
      yatimaPoolDeterministic,
      partyOrderValid,
      mainAndSubSummons,
      subAuraSummons,
      weapons,
      party,
      findings
    };
  }

  /**
   * Simulates expected Turn-1 player-phase damage, overkill margin, and clear time for a deck state.
   * Calibrated to the live acc1 Deck 133 empirical sniff (125,339,038 player phase).
   */
  public static simulateRotation(
    audit: GwNm95DarkDeckAudit,
    profileId: GwNm95DarkProfileId,
    speedProfileOverride?: 'fast' | 'turbo'
  ): GwNm95DarkSimulationResult {
    // Baseline empirically measured on acc1 Deck 133 (Beelzebub + Bahamut, Opus Alpha, FS MA1)
    const BASE_LEGACY_PLAYER_DAMAGE = 125_339_038;
    const BASE_EWIYAR_S2_VALUE = 8_067_741; // 2,217,741 nuke + ~5,850,000 from 30k supp debuff
    const BASE_LAST_LOVE_VALUE = 8_484_247; // Extra Eklu Kurnugia C.A.
    const BASE_DIVA_SATANICA_VALUE = 14_440_000; // Yukata Ilsa 3rd swing at Diuturna=2 (pre-Sariel)

    let preCapDamage = BASE_LEGACY_PLAYER_DAMAGE;
    let skillCount = 7;
    let profileName = 'Legacy 7-Skill Baseline';
    let defaultSpeed: 'fast' | 'turbo' = 'fast';
    let includeEwiyarS2 = true;

    if (profileId === 'safe') {
      preCapDamage += BASE_DIVA_SATANICA_VALUE - BASE_LAST_LOVE_VALUE;
      skillCount = 6;
      profileName = 'Option B: 6-Skill Zero-Grid-Change Safe';
      defaultSpeed = 'turbo';
      includeEwiyarS2 = true;
    } else if (profileId === 'fast') {
      preCapDamage += BASE_DIVA_SATANICA_VALUE - BASE_LAST_LOVE_VALUE - BASE_EWIYAR_S2_VALUE;
      skillCount = 5;
      profileName = 'Option A: 5-Skill Turbo (Fastest)';
      defaultSpeed = 'turbo';
      includeEwiyarS2 = false;
    }

    const speedProfile = speedProfileOverride ?? defaultSpeed;

    // Apply audited grid & sub-aura multipliers/bonuses
    let projectedPlayerPhaseDamage = audit.hasSarielSubAura
      ? Math.round(preCapDamage * 1.076) // ~+10.0M on 6-skill / +9.4M on 5-skill
      : preCapDamage;

    if (audit.hasFedielOrUlbHadesSubAura) {
      projectedPlayerPhaseDamage += 1_200_000;
    }
    if (audit.hasOpusBeta) {
      projectedPlayerPhaseDamage += includeEwiyarS2 ? 5_500_000 : 4_500_000;
    }
    if (audit.hasFallenSwordAtkLv4) {
      projectedPlayerPhaseDamage += 2_000_000;
    }

    const projectedOverkillMargin = projectedPlayerPhaseDamage - GW_NM95_DARK_BOSS_HP;
    const killsInPlayerPhase = projectedOverkillMargin >= 0;

    // Clear-time model based on logged 36-44s baseline vs skill reduction & turbo pacing
    let secMin = 36;
    let secMax = 44;
    if (profileId === 'safe') {
      secMin = speedProfile === 'turbo' ? 22 : 28;
      secMax = speedProfile === 'turbo' ? 26 : 34;
    } else if (profileId === 'fast') {
      secMin = speedProfile === 'turbo' ? 18 : 24;
      secMax = speedProfile === 'turbo' ? 23 : 30;
    }

    const estimatedClearSecAvg = Number(((secMin + secMax) / 2).toFixed(1));
    const estimatedHonorsPerRun = includeEwiyarS2 ? 910_385 : 910_010;
    const projectedHonorsPerHour = Math.round((3600 / estimatedClearSecAvg) * estimatedHonorsPerRun);

    return {
      profileId,
      profileName,
      speedProfile,
      skillCount,
      projectedPlayerPhaseDamage,
      bossHp: GW_NM95_DARK_BOSS_HP,
      projectedOverkillMargin,
      killsInPlayerPhase,
      hasSummerBelialSafetyNet: audit.hasSummerBelialSub,
      estimatedClearSecMin: secMin,
      estimatedClearSecMax: secMax,
      estimatedClearSecAvg,
      estimatedHonorsPerRun,
      projectedHonorsPerHour
    };
  }

  /**
   * Selects `'fast'` (5-skill) when player-phase overkill margin is >= 4.5M (e.g. Sariel + Opus Beta/Atk4),
   * or `'safe'` (6-skill) when Sariel alone already pushes 141M+ without grid edits.
   */
  public static recommendProfile(sims: GwNm95DarkSimulationResult[]): GwNm95DarkProfileId {
    const fastSim = sims.find(s => s.profileId === 'fast');
    if (fastSim && fastSim.projectedOverkillMargin >= 4_500_000) {
      return 'fast';
    }
    const safeSim = sims.find(s => s.profileId === 'safe');
    if (safeSim && safeSim.killsInPlayerPhase) {
      return 'safe';
    }
    return 'safe';
  }

  /**
   * Builds the exact workflow steps for the chosen NM95 Dark burst profile.
   */
  public static buildOptimizedWorkflowSteps(profileId: GwNm95DarkProfileId): WorkflowStep[] {
    if (profileId === 'legacy') {
      return [
        {
          id: 'step_2',
          name: 'Character 4 Skill 2 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 4,
          skill: 2,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_3',
          name: 'Quick Call Summon',
          code: 'quick_call',
          action: 'quick_call',
          waitForNetwork: 'summon_result.json'
        },
        {
          id: 'step_4',
          name: 'Reload F5 (Post-Summon Animation Cancel)',
          code: 'reload',
          action: 'reload'
        },
        {
          id: 'step_5',
          name: 'Character 4 Skill 1 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 4,
          skill: 1,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_6',
          name: 'Character 4 Skill 3 on Character 1 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 4,
          skill: 3,
          targetCharacter: 1,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_7',
          name: 'Character 4 Skill 4 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 4,
          skill: 4,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_8',
          name: 'Character 3 Skill 1 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 3,
          skill: 1,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_9',
          name: 'Character 3 Skill 2 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 3,
          skill: 2,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_10',
          name: 'Character 2 Skill 1 (Ensured)',
          code: 'skill',
          action: 'skill',
          character: 2,
          skill: 1,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          id: 'step_11',
          name: 'Execute Attack',
          code: 'attack',
          action: 'attack',
          waitForNetwork: 'normal_attack_result.json'
        },
        {
          id: 'step_12',
          name: 'Reload F5 (Post-Attack Animation Cancel)',
          code: 'reload',
          action: 'reload'
        },
        {
          id: 'step_13',
          name: 'Confirm Battle Result & Rerun',
          code: 'confirm_result',
          action: 'confirm_result'
        }
      ];
    }

    const corePostSummonSteps: WorkflowStep[] = [
      {
        id: 'step_quick_call',
        name: 'Quick Call Summon (Yatima -> Death + Versusia)',
        code: 'quick_call',
        action: 'quick_call',
        waitForNetwork: 'summon_result.json'
      },
      {
        id: 'step_reload_summon',
        name: 'Reload F5 (Post-Summon Swap to Nier)',
        code: 'reload',
        action: 'reload'
      },
      {
        id: 'step_c4s1',
        name: 'Nier Skill 1: World of Death and Love + (Ensured)',
        code: 'skill',
        action: 'skill',
        character: 4,
        skill: 1,
        ensureCast: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        id: 'step_c4s4',
        name: 'Nier Skill 4: Eternal Vow (Same Drawer, Ensured)',
        code: 'skill',
        action: 'skill',
        character: 4,
        skill: 4,
        ensureCast: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        id: 'step_c3s1',
        name: 'Seox Skill 1: Gate of Sin ++ (Ensured)',
        code: 'skill',
        action: 'skill',
        character: 3,
        skill: 1,
        ensureCast: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        id: 'step_c2s1',
        name: 'Ilsa Skill 1: War Eternal + (Ensured)',
        code: 'skill',
        action: 'skill',
        character: 2,
        skill: 1,
        ensureCast: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        id: 'step_c2s3',
        name: 'Ilsa Skill 3: Diva Satanica Triple Strike (Same Drawer, Ensured)',
        code: 'skill',
        action: 'skill',
        character: 2,
        skill: 3,
        ensureCast: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        id: 'step_attack',
        name: 'Execute Attack (1T Kill)',
        code: 'attack',
        action: 'attack',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        id: 'step_reload_attack',
        name: 'Reload F5 (Post-Attack Animation Cancel)',
        code: 'reload',
        action: 'reload'
      },
      {
        id: 'step_confirm',
        name: 'Confirm Battle Result & Rerun',
        code: 'confirm_result',
        action: 'confirm_result'
      }
    ];

    if (profileId === 'safe') {
      return [
        {
          id: 'step_c4s2',
          name: 'Ewiyar Skill 2: Release the Clawvalry! + (30k Supp Debuff, Ensured)',
          code: 'skill',
          action: 'skill',
          character: 4,
          skill: 2,
          ensureCast: true,
          waitForNetwork: 'ability_result.json'
        },
        ...corePostSummonSteps
      ];
    }

    return corePostSummonSteps;
  }

  /**
   * Builds a complete schema-compliant `WorkflowTemplate` for `templates/gw-nm95-dark.json`.
   */
  public static buildOptimizedTemplate(
    profileId: GwNm95DarkProfileId,
    speedProfile?: 'fast' | 'turbo',
    baseTemplate: Partial<WorkflowTemplate> = {}
  ): WorkflowTemplate {
    const resolvedSpeed = speedProfile ?? (profileId === 'legacy' ? 'fast' : 'turbo');
    const description =
      profileId === 'fast'
        ? 'GW NM95 Dark 5-skill turbo 1-turn burst: Quick Call (Yatima -> Death + Versusia) -> Reload -> C4S1 -> C4S4 -> C3S1 -> C2S1 -> C2S3 (Diva Satanica Triple Strike) -> Attack -> Reload -> Confirm Result'
        : profileId === 'safe'
        ? 'GW NM95 Dark 6-skill safe turbo 1-turn burst: C4S2 -> Quick Call (Yatima -> Death + Versusia) -> Reload -> C4S1 -> C4S4 -> C3S1 -> C2S1 -> C2S3 (Diva Satanica Triple Strike) -> Attack -> Reload -> Confirm Result'
        : 'GW NM95 Dark 1-turn burst: C4S2 -> Quick Call -> Reload -> C4S1 -> C4S3 on C1 -> C4S4 -> C3S1 -> C3S2 -> C2S1 -> Attack -> Reload -> Confirm Result';

    return {
      name: baseTemplate.name || 'GW NM95 - Dark Farm',
      description,
      mode: baseTemplate.mode || 'combat',
      questUrl: baseTemplate.questUrl || GW_NM95_DARK_QUEST_URL,
      questId: baseTemplate.questId || GW_NM95_DARK_QUEST_ID,
      element: baseTemplate.element || 'Dark',
      isSolo: baseTemplate.isSolo ?? true,
      supporterPriority: baseTemplate.supporterPriority || ['Hades'],
      humanMotor: baseTemplate.humanMotor ?? true,
      stopOnCaptcha: baseTemplate.stopOnCaptcha ?? true,
      autoElixir: baseTemplate.autoElixir ?? true,
      defaultRuns: baseTemplate.defaultRuns ?? 2000,
      speedProfile: resolvedSpeed,
      steps: this.buildOptimizedWorkflowSteps(profileId)
    };
  }

  /**
   * Plans non-destructive Sub-Aura Slot 1 & 2 mutations ONLY (never touching Main Yatima or Sub 2-5).
   */
  public static synthesizeSubAuraMutations(
    audit: GwNm95DarkDeckAudit,
    ownedSummons: Array<{ id: string; masterId?: string; name: string; level: number }> = []
  ): GwNm95DarkSummonMutation[] {
    const mutations: GwNm95DarkSummonMutation[] = [];

    const findBestOwnedId = (masterId: string, nameKey: string, fallbackId: string): { id: string; lv: number } => {
      const matches = ownedSummons.filter(
        s => s.masterId === masterId || s.name.toLowerCase().includes(nameKey.toLowerCase())
      );
      if (matches.length > 0) {
        matches.sort((a, b) => b.level - a.level);
        return { id: matches[0].id, lv: matches[0].level };
      }
      return { id: fallbackId, lv: masterId === SARIEL_MASTER_ID ? 150 : 40 };
    };

    const slot1 = audit.subAuraSummons.find(s => s.slot === 1);
    const slot2 = audit.subAuraSummons.find(s => s.slot === 2);

    const isSlot1Sariel = slot1 && (slot1.masterId === SARIEL_MASTER_ID || slot1.name.toLowerCase().includes('sariel'));
    const isSlot2FedielOrHades =
      slot2 &&
      (slot2.masterId === FEDIEL_SUMMON_MASTER_ID ||
        slot2.name.toLowerCase().includes('fediel') ||
        ((slot2.masterId === HADES_MASTER_ID || slot2.name.toLowerCase().includes('hades')) && slot2.level >= 210));

    if (!isSlot1Sariel) {
      const sariel = findBestOwnedId(SARIEL_MASTER_ID, 'sariel', KNOWN_SARIEL_DEFAULT_ID);
      mutations.push({
        equipment: 'sub_summon',
        slot: 1,
        targetName: `Sariel Lv${sariel.lv}`,
        targetSummonId: sariel.id,
        targetMasterId: SARIEL_MASTER_ID,
        previousName: slot1 ? `${slot1.name} Lv${slot1.level}` : 'Empty',
        previousSummonId: slot1?.id || '',
        applied: false,
        success: false,
        detail: 'Pending (+15% Dark DMG Cap)'
      });
    }

    if (!isSlot2FedielOrHades) {
      const fediel = findBestOwnedId(FEDIEL_SUMMON_MASTER_ID, 'fediel', KNOWN_FEDIEL_DEFAULT_ID);
      mutations.push({
        equipment: 'sub_summon',
        slot: 2,
        targetName: `Fediel Lv${fediel.lv}`,
        targetSummonId: fediel.id,
        targetMasterId: FEDIEL_SUMMON_MASTER_ID,
        previousName: slot2 ? `${slot2.name} Lv${slot2.level}` : 'Empty',
        previousSummonId: slot2?.id || '',
        applied: false,
        success: false,
        detail: 'Pending (+10% Optimus Aura)'
      });
    }

    return mutations;
  }

  /**
   * Pure unit-testable detector checking process command lines for active workflows
   * that share the same browser CDP session or Deck 133 (`gw-nm95`, `run-workflow.ts`, `run-honor-park.ts`).
   */
  public static detectActiveWorkflowConflictFromProcessList(
    processCommands: string[],
    accountId: string = 'acc1'
  ): GwNm95DarkConflictCheck {
    const accLower = accountId.toLowerCase();
    const matches = processCommands.filter(cmd => {
      const lower = String(cmd || '').toLowerCase();
      if (!lower) return false;
      // Exclude this setup CLI itself and non-workflow dev server
      if (lower.includes('run-gw-nm95-setup')) return false;
      const isCombatRunner =
        lower.includes('run-workflow.ts') ||
        lower.includes('run-honor-park.ts') ||
        lower.includes('gw-nm95');
      if (!isCombatRunner) return false;
      // Match explicit accountId or default acc1 invocations (`bun run gw-nm95-dark`)
      const mentionsOtherAcc = /\bacc\d+\b/i.test(lower) && !lower.includes(accLower);
      return !mentionsOtherAcc;
    });

    if (matches.length > 0) {
      return {
        hasConflict: true,
        conflictingProcesses: matches,
        reason: `Active workflow detected on ${accountId} (${matches.length} process(es)); live deck mutation / benchmark skipped to avoid disrupting active combat.`
      };
    }

    return { hasConflict: false, conflictingProcesses: [] };
  }

  /**
   * Inspects running `bun` processes on the host OS for active CDP/combat conflicts.
   */
  public static detectActiveWorkflowConflict(accountId: string = 'acc1'): GwNm95DarkConflictCheck {
    try {
      const isWin = process.platform === 'win32';
      const raw = isWin
        ? execSync(
            'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name=\'bun.exe\'\\" | Select-Object -ExpandProperty CommandLine"',
            { encoding: 'utf-8', timeout: 4000 }
          )
        : execSync('ps -eo args', { encoding: 'utf-8', timeout: 4000 });
      const lines = raw
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
      return this.detectActiveWorkflowConflictFromProcessList(lines, accountId);
    } catch {
      return { hasConflict: false, conflictingProcesses: [] };
    }
  }

  /**
   * Executes offline audit and damage/time simulation against KMS Deck 133 baseline (0 browser calls).
   */
  public static runOfflineSimulation(options: GwNm95DarkSetupOptions = {}): GwNm95DarkSetupResult {
    const accountId = options.accountId ?? 'acc1';
    const deckPriority = options.deckPriority ?? 133;
    const rawDeck = buildDefaultOfflineDeck133Snapshot();
    const initialAudit = this.auditDeckData(rawDeck);
    const postMutationAudit = this.simulatePostSwapAudit(rawDeck);

    const profiles: GwNm95DarkProfileId[] = ['legacy', 'safe', 'fast'];
    const simulationsCurrentDeck = profiles.map(p => this.simulateRotation(initialAudit, p, options.speedProfile));
    const simulationsAfterSubAuraSwap = profiles.map(p =>
      this.simulateRotation(postMutationAudit, p, options.speedProfile)
    );
    const recommendedProfile = this.recommendProfile(simulationsAfterSubAuraSwap);
    const selectedProfile =
      options.profile && options.profile !== 'auto' ? options.profile : recommendedProfile;

    return {
      mode: 'offline',
      accountId,
      deckPriority,
      executedAt: new Date().toISOString(),
      conflictCheck: this.detectActiveWorkflowConflict(accountId),
      blockedByActiveWorkflow: false,
      initialAudit,
      postMutationAudit,
      recommendedProfile,
      selectedProfile,
      simulationsCurrentDeck,
      simulationsAfterSubAuraSwap,
      subAuraMutations: this.synthesizeSubAuraMutations(initialAudit),
      workflowSyncedPath: undefined
    };
  }

  /**
   * Executes live CDP audit and (unless `dryRun` or blocked by active workflow) applies
   * Sub-Aura upgrades (`Sariel Lv150` + `Fediel Lv40`) on Deck `133` + syncs `templates/gw-nm95-dark.json`.
   */
  public async executeSetup(
    page: Page,
    options: GwNm95DarkSetupOptions = {}
  ): Promise<GwNm95DarkSetupResult> {
    const accountId = options.accountId ?? 'acc1';
    const deckPriority = options.deckPriority ?? 133;
    const dryRun = Boolean(options.dryRun);
    const conflictCheck = options.activeProcessCommands
      ? GwNm95DarkSetupService.detectActiveWorkflowConflictFromProcessList(options.activeProcessCommands, accountId)
      : GwNm95DarkSetupService.detectActiveWorkflowConflict(accountId);

    const sieteSvc = new SieteAutoSetupService();
    const deckRes = await sieteSvc.gbfAjax(page, `party/deck/${deckPriority}`, 'GET');
    const liveDeck = deckRes.data?.deck || deckRes.data;
    if (!liveDeck?.pc) {
      throw new Error(`Failed to fetch /party/deck/${deckPriority} (status=${deckRes.status})`);
    }

    const initialAudit = GwNm95DarkSetupService.auditDeckData(liveDeck);
    const profiles: GwNm95DarkProfileId[] = ['legacy', 'safe', 'fast'];
    const simulationsCurrentDeck = profiles.map(p =>
      GwNm95DarkSetupService.simulateRotation(initialAudit, p, options.speedProfile)
    );

    const plannedMutations = GwNm95DarkSetupService.synthesizeSubAuraMutations(initialAudit);

    // Dry-run stops before any mutation
    if (dryRun) {
      const virtualPost = GwNm95DarkSetupService.simulatePostSwapAudit(liveDeck);
      const simsPost = profiles.map(p =>
        GwNm95DarkSetupService.simulateRotation(virtualPost, p, options.speedProfile)
      );
      const recommendedProfile = GwNm95DarkSetupService.recommendProfile(simsPost);
      const selectedProfile =
        options.profile && options.profile !== 'auto' ? options.profile : recommendedProfile;

      return {
        mode: 'dry_run',
        accountId,
        deckPriority,
        executedAt: new Date().toISOString(),
        conflictCheck,
        blockedByActiveWorkflow: false,
        initialAudit,
        postMutationAudit: initialAudit,
        recommendedProfile,
        selectedProfile,
        simulationsCurrentDeck,
        simulationsAfterSubAuraSwap: simsPost,
        subAuraMutations: plannedMutations
      };
    }

    // Conflict guard: refuse live deck/template writes while gw-nm95-dark is grinding
    if (conflictCheck.hasConflict && !options.force) {
      const recommendedProfile = GwNm95DarkSetupService.recommendProfile(simulationsCurrentDeck);
      const selectedProfile =
        options.profile && options.profile !== 'auto' ? options.profile : recommendedProfile;
      return {
        mode: 'blocked_conflict',
        accountId,
        deckPriority,
        executedAt: new Date().toISOString(),
        conflictCheck,
        blockedByActiveWorkflow: true,
        initialAudit,
        postMutationAudit: initialAudit,
        recommendedProfile,
        selectedProfile,
        simulationsCurrentDeck,
        simulationsAfterSubAuraSwap: simulationsCurrentDeck,
        subAuraMutations: plannedMutations
      };
    }

    // Apply Sub-Aura Slot 1 & 2 swaps via non-intrusive POST /party/update_equipment
    for (const m of plannedMutations) {
      await sieteSvc.gbfAjax(page, 'party/update_equipment', 'POST', {
        special_token: null,
        priority: deckPriority,
        equipment: 'sub_summon',
        equipment_id: null,
        set_num: m.slot
      });
      const res = await sieteSvc.gbfAjax(page, 'party/update_equipment', 'POST', {
        special_token: null,
        priority: deckPriority,
        equipment: 'sub_summon',
        equipment_id: m.targetSummonId,
        set_num: m.slot,
        limit_summon_check: 0
      });
      m.applied = true;
      m.success = Boolean(res.ok && res.data?.success !== false);
      m.detail = m.success ? `Swapped ${m.previousName} -> ${m.targetName}` : res.errorText || 'Failed';
    }

    // Re-fetch live deck for post-mutation proof
    const verifyRes = await sieteSvc.gbfAjax(page, `party/deck/${deckPriority}`, 'GET');
    const verifiedDeck = verifyRes.data?.deck || verifyRes.data || liveDeck;
    const postMutationAudit = GwNm95DarkSetupService.auditDeckData(verifiedDeck);
    const simulationsAfterSubAuraSwap = profiles.map(p =>
      GwNm95DarkSetupService.simulateRotation(postMutationAudit, p, options.speedProfile)
    );
    const recommendedProfile = GwNm95DarkSetupService.recommendProfile(simulationsAfterSubAuraSwap);
    const selectedProfile =
      options.profile && options.profile !== 'auto' ? options.profile : recommendedProfile;

    let workflowSyncedPath: string | undefined;
    if (options.syncTemplate !== false) {
      const targetPath = path.resolve(process.cwd(), options.templatePath || 'templates/gw-nm95-dark.json');
      let existing: Partial<WorkflowTemplate> = {};
      if (fs.existsSync(targetPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as Partial<WorkflowTemplate>;
        } catch {
          existing = {};
        }
      }
      const nextTemplate = GwNm95DarkSetupService.buildOptimizedTemplate(
        selectedProfile,
        options.speedProfile,
        existing
      );
      fs.writeFileSync(targetPath, `${JSON.stringify(nextTemplate, null, 2)}\n`, 'utf-8');
      workflowSyncedPath = targetPath;
    }

    return {
      mode: 'live_apply',
      accountId,
      deckPriority,
      executedAt: new Date().toISOString(),
      conflictCheck,
      blockedByActiveWorkflow: false,
      initialAudit,
      postMutationAudit,
      recommendedProfile,
      selectedProfile,
      simulationsCurrentDeck,
      simulationsAfterSubAuraSwap,
      subAuraMutations: plannedMutations,
      workflowSyncedPath
    };
  }

  private static simulatePostSwapAudit(rawDeck: any): GwNm95DarkDeckAudit {
    const cloned = JSON.parse(JSON.stringify(rawDeck));
    if (!cloned.pc) cloned.pc = {};
    cloned.pc.sub_summons = {
      '1': { param: { id: KNOWN_SARIEL_DEFAULT_ID, level: '150' }, master: { id: SARIEL_MASTER_ID, name: 'Sariel' } },
      '2': { param: { id: KNOWN_FEDIEL_DEFAULT_ID, level: '40' }, master: { id: FEDIEL_SUMMON_MASTER_ID, name: 'Fediel' } }
    };
    return this.auditDeckData(cloned);
  }

  /**
   * Formats a readable console summary of audit findings, simulations, and planned/applied swaps.
   */
  public static formatReport(result: GwNm95DarkSetupResult): string {
    const lines: string[] = [];
    const { initialAudit } = result;
    lines.push('==============================================================================');
    lines.push(`  GW NM95 DARK OPTIMIZER (${result.mode.toUpperCase()}) — [${result.accountId}] Deck ${result.deckPriority}`);
    lines.push('==============================================================================');
    lines.push(`  Job / Deck       : ${initialAudit.mcJobName} | "${initialAudit.deckName}" | Axes: ${initialAudit.axeCount}/4`);
    lines.push(`  Yatima Engine    : ${initialAudit.yatimaPoolDeterministic ? 'DETERMINISTIC (Death + Versusia)' : 'CONTAMINATED / BROKEN'}`);
    lines.push(`  Party Slot Order : ${initialAudit.partyOrderValid ? 'VALID (Ilsa / Seox / Ewiyar -> Nier)' : 'INVALID'} | [${initialAudit.party.map(p => p.name).join(', ')}]`);
    lines.push(`  Sub-Aura 1 & 2   : [${initialAudit.subAuraSummons.map(s => `${s.name} Lv${s.level}`).join(', ')}]`);
    lines.push(`  Active Conflict  : ${result.conflictCheck.hasConflict ? `YES (${result.conflictCheck.conflictingProcesses.length} process)` : 'None'}`);

    if (initialAudit.findings.length > 0) {
      lines.push('\n  [FINDINGS]');
      for (const f of initialAudit.findings) {
        lines.push(`  - [${f.severity}] ${f.title}`);
        lines.push(`    ${f.detail}`);
        if (f.actionableFix) lines.push(`    Fix: ${f.actionableFix}`);
      }
    }

    lines.push('\n  [SIMULATION COMPARISON (Post Sub-Aura Swap: Sariel Lv150 + Fediel Lv40)]');
    for (const s of result.simulationsAfterSubAuraSwap) {
      const marginStr =
        s.projectedOverkillMargin >= 0
          ? `+${s.projectedOverkillMargin.toLocaleString()}`
          : s.projectedOverkillMargin.toLocaleString();
      const recTag = s.profileId === result.recommendedProfile ? ' <-- RECOMMENDED' : '';
      lines.push(
        `  - ${s.profileId.toUpperCase().padEnd(6)} (${s.skillCount} skills, ${s.speedProfile.padEnd(5)}): ` +
          `${s.projectedPlayerPhaseDamage.toLocaleString()} dmg (${marginStr} vs 131.25M) | ` +
          `${s.estimatedClearSecMin}-${s.estimatedClearSecMax}s (~${(s.projectedHonorsPerHour / 1_000_000).toFixed(1)}M/hr)${recTag}`
      );
    }

    if (result.subAuraMutations.length > 0) {
      lines.push('\n  [SUB-AURA UPGRADES]');
      for (const m of result.subAuraMutations) {
        lines.push(`  - Sub-Aura ${m.slot}: ${m.previousName} -> ${m.targetName} [${m.detail}]`);
      }
    }

    if (result.workflowSyncedPath) {
      lines.push(`\n  Synced Template  : ${result.workflowSyncedPath} (profile=${result.selectedProfile})`);
    }
    if (result.blockedByActiveWorkflow) {
      lines.push(`\n  ⚠️ BLOCKED: ${result.conflictCheck.reason}`);
    }
    lines.push('==============================================================================');
    return lines.join('\n');
  }
}

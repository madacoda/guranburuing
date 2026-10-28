// src/services/combat/siete-auto-setup.service.ts
import fs from 'fs';
import path from 'path';
import type { Page } from 'puppeteer-core';
import {
  DiscoveredAccountInventory,
  DiscoveredJobInstance,
  DiscoveredNpcInstance,
  DiscoveredSubskillInstance,
  DiscoveredSummonInstance,
  DiscoveredWeaponInstance,
  PlannedMcJob,
  PlannedMcSubskill,
  PlannedPartySlot,
  PlannedSummonSlot,
  PlannedWeaponSlot,
  ResolvedDeckTarget,
  SieteAutoSetupOptions,
  SieteAutoSetupResult,
  SieteMutationStepLog,
  SietePartySetupPlan,
  SieteArchetypeId
} from '../../domain/siete/index.js';
import { WorkflowTemplate, WorkflowStep } from '../../types/workflow.types.js';
import { SieteReadinessCheckerService } from './siete-readiness-checker.service.js';

const SABRE_KATANA_KEYWORDS = [
  'lord of flames',
  '1040023700',
  'sennen goji',
  '1040917100',
  'ixaba',
  '1040906400',
  'sword of valorblaze',
  '1040017200',
  'heat of the sun',
  '1040912600',
  'ultima blade',
  '1040907600',
  'sette di spade',
  '1040024300',
  'higurashi',
  '1040913400',
  'unsigned kaneshige',
  '1040909300',
  'scimitar of brahman',
  '1040015000',
  'sword of bahamut',
  '1040007400',
  'ray of zhuque',
  '1040902500'
];

export class SieteAutoSetupService {
  private readonly readinessChecker: SieteReadinessCheckerService;

  constructor(readinessChecker?: SieteReadinessCheckerService) {
    this.readinessChecker = readinessChecker ?? new SieteReadinessCheckerService();
  }

  /**
   * Resolves a human-readable deck alias (e.g. "ex-a-3", "Ex A Party 3", "153", "a-1", "ex-b-1")
   * into GBF's internal deck priority ID and metadata.
   *
   * GBF Deck Priority Mapping:
   * - Set A (10 weapons): Groups 1..7, Parties 1..6 -> Priorities 11..16 through 71..76
   * - Set B (10 weapons): Groups 8..14, Parties 1..6 -> Priorities 81..86 through 141..146
   * - Ex A (13 weapons): Groups 15..21, Parties 1..6 -> Priorities 151..156 through 211..216
   * - Ex B (13 weapons): Groups 22..28, Parties 1..6 -> Priorities 221..226 through 281..286
   */
  public resolveDeckTarget(input?: string | number): ResolvedDeckTarget {
    if (typeof input === 'number' && Number.isFinite(input)) {
      return this.buildDeckTargetFromPriority(input);
    }

    const raw = String(input ?? 'ex-a-3')
      .trim()
      .toLowerCase();
    if (!raw || raw === 'default') {
      return this.buildDeckTargetFromPriority(153);
    }

    if (/^\d+$/.test(raw)) {
      return this.buildDeckTargetFromPriority(Number(raw));
    }

    // Match patterns like "ex a party 3", "ex-a-3", "exa3", "ex-a-1-3"
    const exMatch = raw.match(/ex[\s_-]*([ab])(?:[\s_-]*(?:group[\s_-]*)?(\d+))?[\s_-]*(?:party[\s_-]*|p)?(\d+)/i);
    if (exMatch) {
      const setLetter = exMatch[1].toUpperCase() as 'A' | 'B';
      const groupOffset = exMatch[2] ? Math.max(1, Math.min(7, Number(exMatch[2]))) - 1 : 0;
      const partyNo = Math.max(1, Math.min(6, Number(exMatch[3])));
      const baseGroup = setLetter === 'A' ? 15 : 22;
      const groupPriority = baseGroup + groupOffset;
      return this.buildDeckTargetFromPriority(groupPriority * 10 + partyNo);
    }

    // Match patterns like "set a party 3", "a-3", "b-1"
    const stdMatch = raw.match(/(?:set[\s_-]*)?([ab])(?:[\s_-]*(?:group[\s_-]*)?(\d+))?[\s_-]*(?:party[\s_-]*|p)?(\d+)/i);
    if (stdMatch) {
      const setLetter = stdMatch[1].toUpperCase() as 'A' | 'B';
      const groupOffset = stdMatch[2] ? Math.max(1, Math.min(7, Number(stdMatch[2]))) - 1 : 0;
      const partyNo = Math.max(1, Math.min(6, Number(stdMatch[3])));
      const baseGroup = setLetter === 'A' ? 1 : 8;
      const groupPriority = baseGroup + groupOffset;
      return this.buildDeckTargetFromPriority(groupPriority * 10 + partyNo);
    }

    return this.buildDeckTargetFromPriority(153);
  }

  private buildDeckTargetFromPriority(priority: number): ResolvedDeckTarget {
    const groupPriority = Math.floor(priority / 10);
    const orderNo = priority % 10;
    let setType: 'Set A' | 'Set B' | 'Ex A' | 'Ex B' = 'Ex A';
    let maxWeaponSlots: 10 | 13 = 13;

    if (groupPriority >= 1 && groupPriority <= 7) {
      setType = 'Set A';
      maxWeaponSlots = 10;
    } else if (groupPriority >= 8 && groupPriority <= 14) {
      setType = 'Set B';
      maxWeaponSlots = 10;
    } else if (groupPriority >= 15 && groupPriority <= 21) {
      setType = 'Ex A';
      maxWeaponSlots = 13;
    } else {
      setType = 'Ex B';
      maxWeaponSlots = 13;
    }

    return {
      priority,
      groupPriority,
      orderNo,
      setType,
      maxWeaponSlots,
      label: `${setType} Party ${orderNo} (Group ${groupPriority}, Priority ${priority})`
    };
  }

  /**
   * Executes a single GBF AJAX call inside the page context using jQuery $.ajax
   * (so GBF's $.ajaxPrefilter headers and URL formatting apply automatically)
   * with retry resilience against background raid page reloads.
   */
  public async gbfAjax(
    page: Page,
    endpointPath: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; data: any; errorText?: string }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await page.evaluate(
          async ({ p, m, b }) => {
            const $ = (window as any).$;
            const g = (window as any).Game;
            const baseUri = g?.baseUri || 'https://game.granbluefantasy.jp/';
            if ($) {
              return await new Promise<{ ok: boolean; status: number; data: any; errorText?: string }>(resolve => {
                $.ajax({
                  type: m,
                  url: `${baseUri}${p}?_=${Date.now()}`,
                  dataType: 'json',
                  contentType: m === 'POST' ? 'application/json' : undefined,
                  processData: false,
                  data: m === 'POST' ? JSON.stringify(b) : undefined,
                  success: (data: any) => resolve({ ok: true, status: 200, data }),
                  error: (xhr: any) =>
                    resolve({
                      ok: false,
                      status: Number(xhr?.status || 500),
                      data: null,
                      errorText: String(xhr?.responseText || '').slice(0, 200)
                    })
                });
              });
            }
            const headers: Record<string, string> = {
              Accept: 'application/json, text/javascript, */*; q=0.01',
              'X-Requested-With': 'XMLHttpRequest'
            };
            if (g?.version) headers['X-Version'] = String(g.version);
            if (m === 'POST') headers['Content-Type'] = 'application/json';
            const r = await fetch(`${baseUri}${p}?_=${Date.now()}`, {
              method: m,
              credentials: 'include',
              headers,
              body: m === 'POST' ? JSON.stringify(b) : undefined
            });
            const json = await r.json().catch(() => null);
            return { ok: r.ok, status: r.status, data: json };
          },
          { p: endpointPath, m: method, b: body }
        );
        if (res) return res;
      } catch {
        await new Promise(r => setTimeout(r, 300));
      }
    }
    return { ok: false, status: 0, data: null, errorText: 'Max retries exceeded on page.evaluate' };
  }

  /**
   * Discovers owned Jobs, Subskills, Fire Characters, Weapons, and Summons (with their exact user instance IDs)
   * across the account's party decks without navigating the browser page.
   */
  public async discoverInventoryFromLivePage(
    page: Page,
    accountId: string = 'acc1',
    targetPriority: number = 153
  ): Promise<DiscoveredAccountInventory> {
    const prioritiesToScan = Array.from(
      new Set([targetPriority, 151, 152, 153, 154, 155, 156, 221, 11, 12, 13, 14, 15, 16, 41, 181])
    );

    const jobMap = new Map<string, DiscoveredJobInstance>();
    const subskillMap = new Map<string, DiscoveredSubskillInstance>();
    const npcMap = new Map<number, DiscoveredNpcInstance>();
    const weaponMap = new Map<number, DiscoveredWeaponInstance>();
    const summonMap = new Map<string, DiscoveredSummonInstance>();

    // Seed baseline well-known GBF subskill IDs (Miserable Mist, Dispel, Manadiver Zeniths, etc.)
    const seedSubskills: DiscoveredSubskillInstance[] = [
      { abilityId: '1600', name: 'Miserable Mist', defaultPos: 0 },
      { abilityId: '3040', name: 'Dispel', defaultPos: 0 },
      { abilityId: '201861', name: 'Secret Triad', defaultPos: 1 },
      { abilityId: '201851', name: 'Wild Magica', defaultPos: 2 },
      { abilityId: '200211', name: 'No More Doubt', defaultPos: 1 },
      { abilityId: '270', name: 'Pandemonium', defaultPos: 2 },
      { abilityId: '467', name: 'Chaser', defaultPos: 1 },
      { abilityId: '204220', name: 'High Chaser', defaultPos: 2 }
    ];
    for (const sk of seedSubskills) {
      subskillMap.set(sk.abilityId, sk);
    }

    for (const p of prioritiesToScan) {
      const res = await this.gbfAjax(page, `party/deck/${p}`, 'GET');
      const d = res.data?.deck;
      if (!d || !d.pc) continue;

      if (d.pc.job?.master?.name && d.pc.job?.param?.id) {
        const masterId = String(d.pc.job.master.id);
        jobMap.set(masterId, {
          userJobId: Number(d.pc.job.param.id),
          masterId,
          name: String(d.pc.job.master.name),
          seenInDeck: p
        });
      }

      for (const sa of d.pc.set_action || []) {
        if (sa?.name && sa?.set_action_id) {
          subskillMap.set(String(sa.set_action_id), {
            abilityId: String(sa.set_action_id),
            name: String(sa.name),
            defaultPos: Number(sa.action_set_pos ?? 0)
          });
        }
      }

      for (const n of Object.values(d.npc || {}) as any[]) {
        if (n?.master?.name && n?.param?.id) {
          const userNpcId = Number(n.param.id);
          npcMap.set(userNpcId, {
            userNpcId,
            masterId: String(n.master.id),
            name: String(n.master.name),
            attribute: Number(n.master.attribute || 0),
            level: Number(n.param.level || 80),
            evolution: Number(n.param.evolution || 4)
          });
        }
      }

      for (const w of Object.values(d.pc.weapons || {}) as any[]) {
        if (w?.master?.name && w?.param?.id) {
          const userWeaponId = Number(w.param.id);
          weaponMap.set(userWeaponId, {
            userWeaponId,
            masterId: String(w.master.id),
            name: String(w.master.name),
            attribute: Number(w.master.attribute || 0),
            level: Number(w.param.level || 150),
            arousalForm: w.param?.arousal?.form_name
              ? `${w.param.arousal.form_name} Lv${w.param.arousal.level || ''}`.trim()
              : null,
            skill1: w.skill1?.name || null,
            skill2: w.skill2?.name || null,
            skill3: w.skill3?.name || null
          });
        }
      }

      const allDeckSummons = [...Object.values(d.pc.summons || {}), ...Object.values(d.pc.sub_summons || {})] as any[];
      for (const s of allDeckSummons) {
        if (s?.master?.name && s?.param?.id) {
          const userSummonId = String(s.param.id);
          summonMap.set(userSummonId, {
            userSummonId,
            masterId: String(s.master.id),
            name: String(s.master.name),
            attribute: Number(s.master.attribute || 0),
            level: Number(s.param.level || 150),
            evolution: Number(s.param.evolution || 4)
          });
        }
      }
    }

    // Also query /party/jobs/{targetPriority}/all_job/{classType} for Row IV, Row V, EX II, Origin
    for (const ct of [3, 4, 6, 7]) {
      const jRes = await this.gbfAjax(page, `party/jobs/${targetPriority}/all_job/${ct}`, 'GET');
      if (jRes.data?.jobs) {
        for (const [jobId, j] of Object.entries(jRes.data.jobs) as [string, any][]) {
          if (j?.param?.id && j?.name) {
            jobMap.set(String(jobId), {
              userJobId: Number(j.param.id),
              masterId: String(jobId),
              name: String(j.name),
              classType: ct
            });
          }
        }
      }
    }

    return {
      accountId,
      scannedPriorities: prioritiesToScan,
      jobs: Array.from(jobMap.values()),
      subskills: Array.from(subskillMap.values()),
      npcs: Array.from(npcMap.values()),
      weapons: Array.from(weaponMap.values()),
      summons: Array.from(summonMap.values())
    };
  }

  /**
   * Synthesizes an optimal Siete Party Setup Plan (MC Class, Subskills, 5 Fire Characters,
   * 10/13 Weapons, 7 Summons, and tailored Combat Workflow Steps) from discovered inventory.
   */
  public synthesizeSetupPlan(
    inventory: DiscoveredAccountInventory,
    options: SieteAutoSetupOptions = {}
  ): SietePartySetupPlan {
    const deckTarget = this.resolveDeckTarget(options.deckTarget ?? 153);
    const archetypeId: SieteArchetypeId = options.archetypeId ?? 'siete_fire_manadiver_burst_2t';
    const notes: string[] = [];

    // 1. Select MC Job & Subskills
    const mcJob = this.selectOptimalMcJob(inventory, archetypeId, notes);

    // 2. Select 5 Fire Party Characters (Slots 1..3 Frontline, Slots 4..5 Backline)
    const party = this.selectOptimalFireParty(inventory, archetypeId, notes);

    // 3. Select 10 or 13 Weapons matching MC Mainhand proficiency + Resonator & Exalto caps
    const weapons = this.selectOptimalWeaponGrid(inventory, mcJob, deckTarget.maxWeaponSlots, notes);
    const sabreKatanaCount = weapons.filter(w => this.isSabreOrKatana(w)).length;

    // 4. Select 7 Summons (Main 1 + Sub 2..5 + Sub-Aura 1..2) with 100% passive uptime under 99T summon lock
    const summons = this.selectOptimalSummons(inventory, notes);

    // 5. Generate tailored Siete 4M Honors workflow steps for the exact character slots & MC skills
    const workflowSteps = this.buildWorkflowStepsForPlan(mcJob, party);

    return {
      accountId: inventory.accountId,
      deckTarget,
      archetypeId,
      mcJob,
      party,
      weapons,
      summons,
      sabreKatanaCount,
      workflowSteps,
      notes
    };
  }

  private selectOptimalMcJob(
    inventory: DiscoveredAccountInventory,
    archetypeId: SieteArchetypeId,
    notes: string[]
  ): PlannedMcJob {
    const findJob = (namesOrIds: string[]): DiscoveredJobInstance | undefined => {
      for (const target of namesOrIds) {
        const lower = target.toLowerCase();
        const found = inventory.jobs.find(
          j => j.name.toLowerCase() === lower || j.masterId.toLowerCase() === lower
        );
        if (found) return found;
      }
      return undefined;
    };

    let chosenJob: DiscoveredJobInstance | undefined;
    let subskills: PlannedMcSubskill[] = [];

    if (archetypeId === 'siete_fire_kengo_ougi_loop') {
      chosenJob = findJob(['Kengo', '220301', 'Onmyoji', 'Manadiver']);
      subskills = [
        { setPos: 0, abilityId: '1600', name: 'Miserable Mist' },
        { setPos: 1, abilityId: '200211', name: 'No More Doubt' },
        { setPos: 2, abilityId: '270', name: 'Pandemonium' }
      ];
    } else if (archetypeId === 'siete_fire_paladin_safe_full_auto') {
      chosenJob = findJob(['Paladin', 'Shieldsworn', 'Wizard Origin', '130501', 'Manadiver']);
      subskills = [
        { setPos: 0, abilityId: '3040', name: 'Dispel' },
        { setPos: 1, abilityId: '467', name: 'Chaser' },
        { setPos: 2, abilityId: '204220', name: 'High Chaser' }
      ];
    } else {
      chosenJob = findJob(['Manadiver', '130401', 'Berserker', 'Sumaibito', 'Wizard Origin']);
      if (chosenJob?.name.toLowerCase() === 'manadiver') {
        subskills = [
          { setPos: 0, abilityId: '1600', name: 'Miserable Mist' },
          { setPos: 1, abilityId: '201861', name: 'Secret Triad' },
          { setPos: 2, abilityId: '201851', name: 'Wild Magica' }
        ];
      } else {
        subskills = [
          { setPos: 0, abilityId: '1600', name: 'Miserable Mist' },
          { setPos: 1, abilityId: '467', name: 'Chaser' },
          { setPos: 2, abilityId: '204220', name: 'High Chaser' }
        ];
      }
    }

    if (!chosenJob) {
      chosenJob = inventory.jobs[0] ?? {
        userJobId: 25501020,
        masterId: '130401',
        name: 'Manadiver'
      };
    }

    notes.push(
      `MC Class selected: ${chosenJob.name} (userJobId=${chosenJob.userJobId}) with subskills [${subskills.map(s => s.name).join(', ')}].`
    );

    return {
      userJobId: chosenJob.userJobId,
      masterId: chosenJob.masterId,
      name: chosenJob.name,
      subskills
    };
  }

  private selectOptimalFireParty(
    inventory: DiscoveredAccountInventory,
    archetypeId: SieteArchetypeId,
    notes: string[]
  ): PlannedPartySlot[] {
    const fireNpcs = inventory.npcs.filter(n => n.attribute === 1);
    const usedIds = new Set<number>();

    const pickNpc = (priorityKeys: string[]): DiscoveredNpcInstance | undefined => {
      for (const key of priorityKeys) {
        const lower = key.toLowerCase();
        const match = fireNpcs.find(
          n =>
            !usedIds.has(n.userNpcId) &&
            (n.masterId === lower || n.name.toLowerCase() === lower || n.name.toLowerCase().includes(lower))
        );
        if (match) {
          usedIds.add(match.userNpcId);
          return match;
        }
      }
      const fallback = fireNpcs.find(n => !usedIds.has(n.userNpcId));
      if (fallback) usedIds.add(fallback.userNpcId);
      return fallback;
    };

    const slotPriorities: string[][] =
      archetypeId === 'siete_fire_kengo_ougi_loop'
        ? [
            ['3040381000', 'wilnas'],
            ['3040425000', 'percival'],
            ['3040280000', 'satyr', '3040499000', 'zeta'],
            ['3040202000', 'athena', '3040167000', 'alanaan'],
            ['3040440000', 'michael']
          ]
        : [
            ['3040425000', 'percival'],
            ['3040499000', 'zeta'],
            ['3040580000', 'yuel', '3040381000', 'wilnas', '3040545000', 'aglovale'],
            ['3040440000', 'michael', '3040167000', 'alanaan', '3040280000', 'satyr', '3040202000', 'athena'],
            ['3040167000', 'alanaan', '3040381000', 'wilnas', '3040039000', 'tien', '3040280000', 'satyr']
          ];

    const party: PlannedPartySlot[] = [];
    for (let i = 0; i < 5; i++) {
      const slotNum = (i + 1) as 1 | 2 | 3 | 4 | 5;
      const role = slotNum <= 3 ? 'frontline' : 'backline';
      const chosen = pickNpc(slotPriorities[i]);
      if (chosen) {
        party.push({
          slot: slotNum,
          role,
          userNpcId: chosen.userNpcId,
          masterId: chosen.masterId,
          name: chosen.name,
          level: chosen.level,
          evolution: chosen.evolution
        });
      }
    }

    notes.push(
      `Fire Party (100% Fire for Cien Mil Espadas immunity): Frontline [${party
        .filter(p => p.role === 'frontline')
        .map(p => `${p.name} Lv${p.level}`)
        .join(', ')}] | Backline [${party
        .filter(p => p.role === 'backline')
        .map(p => `${p.name} Lv${p.level}`)
        .join(', ')}].`
    );

    return party;
  }

  private selectOptimalWeaponGrid(
    inventory: DiscoveredAccountInventory,
    mcJob: PlannedMcJob,
    maxSlots: 10 | 13,
    notes: string[]
  ): PlannedWeaponSlot[] {
    const usedWeaponIds = new Set<number>();
    const pickWeapon = (priorityKeys: string[]): DiscoveredWeaponInstance | undefined => {
      for (const key of priorityKeys) {
        const lower = key.toLowerCase();
        // Prefer Special Lv10 Exo Maitrah Karuna if multiple exist
        const candidates = inventory.weapons.filter(
          w =>
            !usedWeaponIds.has(w.userWeaponId) &&
            (w.masterId === lower || w.name.toLowerCase() === lower || w.name.toLowerCase().includes(lower))
        );
        if (candidates.length > 0) {
          candidates.sort((a, b) => {
            const aSpec = a.arousalForm?.toLowerCase().includes('special') ? 1 : 0;
            const bSpec = b.arousalForm?.toLowerCase().includes('special') ? 1 : 0;
            if (bSpec !== aSpec) return bSpec - aSpec;
            return b.level - a.level;
          });
          const best = candidates[0];
          usedWeaponIds.add(best.userWeaponId);
          return best;
        }
      }
      return undefined;
    };

    const planned: PlannedWeaponSlot[] = [];

    // 1. Slot 1 (Mainhand) matching MC Class proficiency
    const jobLower = mcJob.name.toLowerCase();
    let mhPriorities = ['1040118000', 'exo maitrah karuna', '1040417900', 'nilakantha'];
    if (jobLower.includes('kengo') || jobLower.includes('onmyoji')) {
      mhPriorities = ['1040909300', 'unsigned kaneshige', '1040913400', 'higurashi', '1040917100', 'sennen goji'];
    } else if (jobLower.includes('wizard')) {
      mhPriorities = ['1040417900', 'nilakantha'];
    } else if (jobLower.includes('sumaibito') || jobLower.includes('luchador')) {
      mhPriorities = ['1040604200', 'sky piercer', '1040614300', 'kiss of the devil'];
    }

    const mh = pickWeapon(mhPriorities) ?? pickWeapon(['overrider', 'lord of flames']);
    if (mh) {
      planned.push({
        slot: 1,
        role: 'mainhand',
        userWeaponId: mh.userWeaponId,
        masterId: mh.masterId,
        name: mh.name,
        level: mh.level,
        arousalForm: mh.arousalForm
      });
    }

    // 2. Core Grid Slots 2..10 (9 slots)
    const coreSlotCandidates: string[][] = [
      ['1040218900', 'overrider'], // Overrider #1 (Exalto +30% + Supplemental)
      ['1040218900', 'overrider'], // Overrider #2 (Exalto +30% + Supplemental)
      ['1040023700', 'lord of flames'], // Lord of Flames (Sabre #1: Voltage II + Special Cap +7%)
      ['1040315900', 'crimson scale'], // Crimson Scale (Axe: +50k Supplemental + Cap +7%)
      ['1040310700', 'scythe of renunciation'], // Dark Opus Lv210
      ['1040311800', 'sol remnant'], // Astral Axe Lv200 (+37% EX + Auto Cap)
      ['1040917100', 'sennen goji'], // Sennen Goji (Katana #2: Grand Yuel)
      ['1040906400', 'ixaba', '1040913400', 'higurashi'], // Ixaba (Katana #3)
      ['1040017200', 'sword of valorblaze', '1040024300', 'sette di spade'] // Sword of Valorblaze (Sabre #4: Seraphic +23%)
    ];

    for (let idx = 0; idx < coreSlotCandidates.length; idx++) {
      const slotNum = idx + 2;
      const w =
        pickWeapon(coreSlotCandidates[idx]) ??
        pickWeapon(['1040306300', 'true infernal flamescythe', '1040313200', 'garnet broadaxe', '1040612700', 'fist of destruction']);
      if (w) {
        planned.push({
          slot: slotNum,
          role: 'core',
          userWeaponId: w.userWeaponId,
          masterId: w.masterId,
          name: w.name,
          level: w.level,
          arousalForm: w.arousalForm
        });
      }
    }

    // 3. Extra Deck Slots 11..13 (3 slots for V2 / Extra Decks)
    if (maxSlots === 13) {
      const extraSlotCandidates: string[][] = [
        ['1040912600', 'heat of the sun'], // NWF Katana Lv200 (Auto Cap + Majesty, Sabre/Katana #5)
        ['1040614300', 'kiss of the devil'], // NWF Melee Lv150 (Skill Cap + Majesty)
        ['1040815200', 'worldstorming aetos', '1040907600', 'ultima blade', '1040024300', 'sette di spade'] // World Harp (+20% Normal Attack Amp for Sabre/Dagger/Spear: MC, Percival, Zeta, Yuel)
      ];
      for (let idx = 0; idx < extraSlotCandidates.length; idx++) {
        const slotNum = 11 + idx;
        const w =
          pickWeapon(extraSlotCandidates[idx]) ??
          pickWeapon(['1040815200', 'worldstorming aetos', '1040007400', 'sword of bahamut coda']);
        if (w) {
          planned.push({
            slot: slotNum,
            role: 'extra',
            userWeaponId: w.userWeaponId,
            masterId: w.masterId,
            name: w.name,
            level: w.level,
            arousalForm: w.arousalForm
          });
        }
      }
    }

    const skCount = planned.filter(w => this.isSabreOrKatana(w)).length;
    notes.push(
      `Weapon Grid (${planned.length}/${maxSlots} slots): Mainhand=${planned[0]?.name || 'None'}, Sabre/Katana count=${skCount} (>=4 required for Percival Königswürde & Lord of Flames Resonator).`
    );

    return planned;
  }

  private isSabreOrKatana(w: { masterId: string; name: string }): boolean {
    const combined = `${w.masterId} ${w.name}`.toLowerCase();
    return SABRE_KATANA_KEYWORDS.some(kw => combined.includes(kw));
  }

  private selectOptimalSummons(
    inventory: DiscoveredAccountInventory,
    notes: string[]
  ): PlannedSummonSlot[] {
    const usedSummonIds = new Set<string>();
    const pickSummon = (priorityKeys: string[], minLevel: number = 100): DiscoveredSummonInstance | undefined => {
      for (const key of priorityKeys) {
        const lower = key.toLowerCase();
        const candidates = inventory.summons.filter(
          s =>
            !usedSummonIds.has(s.userSummonId) &&
            s.level >= minLevel &&
            (s.masterId === lower || s.name.toLowerCase() === lower || s.name.toLowerCase().includes(lower))
        );
        if (candidates.length > 0) {
          candidates.sort((a, b) => b.level - a.level);
          const best = candidates[0];
          usedSummonIds.add(best.userSummonId);
          return best;
        }
      }
      return undefined;
    };

    const planned: PlannedSummonSlot[] = [];

    // Main Summon (Slot 1): Versusia Lv150 (200% Elemental ATK + Celestial Dominion to MC after 5 TAs) or Beelzebub Lv150
    const main = pickSummon(['2040448000', 'versusia', '2040408000', 'beelzebub', '2040034000', 'colossus omega']);
    if (main) {
      planned.push({
        equipment: 'summon',
        slot: 1,
        role: 'main',
        userSummonId: main.userSummonId,
        masterId: main.masterId,
        name: main.name,
        level: main.level
      });
    }

    // Sub Summons (Slots 2..5): The Sun (Seraphic +10%), Triple Zero (Perpetuity +10% & Cap +5%), Beelzebub/The Devil, Wilnas (+40% Optimus boost)
    const subCandidates: string[][] = [
      ['2040321000', 'the sun'],
      ['2040425000', 'triple zero'],
      ['2040408000', 'beelzebub', '2040317000', 'the devil'],
      ['2040398000', 'wilnas', '2040317000', 'the devil', '2040417000', 'yatima', '2040034000', 'colossus omega']
    ];
    for (let idx = 0; idx < subCandidates.length; idx++) {
      const slotNum = idx + 2;
      const s = pickSummon(subCandidates[idx], 100);
      if (s) {
        planned.push({
          equipment: 'summon',
          slot: slotNum,
          role: 'sub',
          userSummonId: s.userSummonId,
          masterId: s.masterId,
          name: s.name,
          level: s.level
        });
      }
    }

    // Sub-Aura Summons (Slots 1..2): Michael (+15% Fire Cap), Belial Lv150 (+30k Supplemental DMG)
    const subAuraCandidates: string[][] = [
      ['2040306000', 'michael'],
      ['2040347000', 'belial', '2040398000', 'wilnas']
    ];
    for (let idx = 0; idx < subAuraCandidates.length; idx++) {
      const slotNum = idx + 1;
      const s = pickSummon(subAuraCandidates[idx], 100);
      if (s) {
        planned.push({
          equipment: 'sub_summon',
          slot: slotNum,
          role: 'sub_aura',
          userSummonId: s.userSummonId,
          masterId: s.masterId,
          name: s.name,
          level: s.level
        });
      }
    }

    notes.push(
      `Summons (7/7 passive-aura optimized for Seofon's 99-Turn Summon Seal): Main=${
        planned.find(s => s.role === 'main')?.name || 'None'
      } | Sub=[${planned
        .filter(s => s.role === 'sub')
        .map(s => s.name)
        .join(', ')}] | Sub-Aura=[${planned
        .filter(s => s.role === 'sub_aura')
        .map(s => s.name)
        .join(', ')}].`
    );

    return planned;
  }

  /**
   * Generates the Siete 4M Honors combat workflow steps tailored to the exact configured
   * MC Class, Subskills, and Frontline Character slots (Percival Slot 1, Zeta Slot 2, Yuel/Wilnas Slot 3).
   */
  public buildWorkflowStepsForPlan(mcJob: PlannedMcJob, party: PlannedPartySlot[]): WorkflowStep[] {
    const steps: WorkflowStep[] = [
      {
        code: 'wait_element',
        name: 'Make sure combat full load & interactable',
        target: '.btn-attack-start',
        timeoutMs: 8000
      },
      {
        code: 'reload',
        name: 'Reload F5 (Cancel Entry Summon-Lock Animation)'
      }
    ];

    // Map frontline characters (Party Slot 1 -> character: 2, Slot 2 -> character: 3, Slot 3 -> character: 4)
    const frontline = party.filter(p => p.role === 'frontline');
    const findCharIndex = (keyword: string): number | undefined => {
      const idx = frontline.findIndex(p => p.name.toLowerCase().includes(keyword.toLowerCase()));
      return idx !== -1 ? idx + 2 : undefined;
    };

    const percivalChar = findCharIndex('percival') ?? 2;
    const zetaChar = findCharIndex('zeta') ?? 3;
    const yuelChar = findCharIndex('yuel');
    const wilnasChar = findCharIndex('wilnas');

    // Turn 1 — Character 1 (MC Manadiver):
    // Cast Skill 2 (Miserable Mist) -> Skill 3 (Secret Triad: fills 3 charge diamonds + +30% Charge Bar + Fire Echo)
    // -> Skill 1 (Aether Siphon: drains 1 diamond for +40% Charge Bar -> 100% Charge Bar!)
    // -> Skill 4 (Wild Magica: Double Strike & +30% Skill Supp for BOTH Turn 1 and Turn 2!)
    steps.push(
      {
        code: 'skill',
        name: `Character 1 Skill 2 (MC ${mcJob.subskills[0]?.name || 'Miserable Mist'})`,
        character: 1,
        skill: 2,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: `Character 1 Skill 3 (MC ${mcJob.subskills[1]?.name || 'Secret Triad'} +30% Charge & Fill Diamonds)`,
        character: 1,
        skill: 3,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: `Character 1 Skill 1 (MC ${mcJob.name} Aether Siphon Drain Diamond for +40% Charge)`,
        character: 1,
        skill: 1,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: `Character 1 Skill 4 (MC ${mcJob.subskills[2]?.name || 'Wild Magica'} Double Strike)`,
        character: 1,
        skill: 4,
        optional: true,
        waitForNetwork: 'ability_result.json'
      }
    );

    // Turn 1 — Character 2 (Percival Grand):
    // Cast Skill 1 (Roter Wirbel + Singed +1) -> Skill 2 (Regieren + Grovel/Petrify)
    steps.push(
      {
        code: 'skill',
        name: `Character ${percivalChar} Skill 1 (Percival Roter Wirbel + Singed)`,
        character: percivalChar,
        skill: 1,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: `Character ${percivalChar} Skill 2 (Percival Regieren + Grovel/Petrify)`,
        character: percivalChar,
        skill: 2,
        optional: true,
        waitForNetwork: 'ability_result.json'
      }
    );

    // Turn 1 — Character 3 (Zeta Grand):
    // Zeta starts at 100% Charge Bar so Skill 3 is Arvess Fugue (1-Time Salted Wound Assassin's Aim).
    // Passive 2 (Sirius Light) states: "Doesn't consume Assassin's Aim effect upon dealing skill DMG".
    // Therefore cast Skill 3 (Arvess Fugue Assassin) -> Skill 2 (Assassin-boosted 6-hit nuke!) -> Skill 1 (Furious Resonance + Crimson Will).
    steps.push(
      {
        code: 'skill',
        name: `Character ${zetaChar} Skill 3 (Zeta Arvess Fugue Salted Wound Assassin)`,
        character: zetaChar,
        skill: 3,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: `Character ${zetaChar} Skill 2 (Zeta Roar of a Thousand Flames + Assassin Nuke)`,
        character: zetaChar,
        skill: 2,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'skill',
        name: `Character ${zetaChar} Skill 1 (Zeta Furious Resonance + Crimson Will Echo & Dispel)`,
        character: zetaChar,
        skill: 1,
        optional: true,
        waitForNetwork: 'ability_result.json'
      }
    );

    // Turn 1 — Character 4 (Yuel Grand or Wilnas Grand):
    if (yuelChar) {
      steps.push(
        {
          code: 'skill',
          name: `Character ${yuelChar} Skill 1 (Yuel Foxflame Familiars + Team DMG Amplify & Singed)`,
          character: yuelChar,
          skill: 1,
          optional: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          code: 'skill',
          name: `Character ${yuelChar} Skill 2 (Yuel Crimson Dance: Chin + Stance)`,
          character: yuelChar,
          skill: 2,
          optional: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          code: 'skill',
          name: `Character ${yuelChar} Skill 3 (Yuel Third Dance: Shien 3-Hit Flurry Out-of-Turn Attack)`,
          character: yuelChar,
          skill: 3,
          optional: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          code: 'reload',
          name: 'Reload F5 (Cancel Yuel Shien Out-of-Turn Attack Animation)'
        },
        {
          code: 'wait_element',
          name: 'Wait for Combat Ready after Yuel Shien Reload',
          target: '.btn-attack-start',
          timeoutMs: 8000
        }
      );
    } else if (wilnasChar) {
      steps.push(
        {
          code: 'skill',
          name: `Character ${wilnasChar} Skill 3 (Wilnas The Vermillion's Glare)`,
          character: wilnasChar,
          skill: 3,
          optional: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          code: 'skill',
          name: `Character ${wilnasChar} Skill 2 (Wilnas Flame Claw + Singed & +20% Charge)`,
          character: wilnasChar,
          skill: 2,
          optional: true,
          waitForNetwork: 'ability_result.json'
        },
        {
          code: 'skill',
          name: `Character ${wilnasChar} Skill 1 (Wilnas Hadron Smash + 1200% Nuke)`,
          character: wilnasChar,
          skill: 1,
          optional: true,
          waitForNetwork: 'ability_result.json'
        }
      );
    }

    // Turn 1 Attack -> Cancels 77,777,777 Emblema Omen & Triggers Versusia Celestial Dominion (5+ TAs)
    steps.push(
      {
        code: 'attack',
        name: 'Execute Turn 1 Attack (Cancels 77,777,777 Emblema & Triggers Celestial Dominion)',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Turn 1 Animation Cancel)'
      }
    );

    // Turn 2: Percival Skill 3 (Koenig Dekret Full-Party Out-of-Turn Attack) -> Reload -> Turn 2 Attack
    steps.push(
      {
        code: 'wait_element',
        name: 'Wait for Turn 2 Combat Ready',
        target: '.btn-attack-start',
        timeoutMs: 8000
      },
      {
        code: 'skill',
        name: `Character ${percivalChar} Skill 3 (Percival Koenig Dekret Full-Party Out-of-Turn Attack)`,
        character: percivalChar,
        skill: 3,
        optional: true,
        waitForNetwork: 'ability_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Cancel Koenig Dekret Out-of-Turn Attack Animation & Sync Honors)'
      },
      {
        code: 'exit_if_score',
        name: 'Exit Early if 4,000,000 Honors Reached',
        targetScore: 4000000
      },
      {
        code: 'wait_element',
        name: 'Wait for Turn 2 Normal Attack Ready',
        target: '.btn-attack-start',
        timeoutMs: 8000
      },
      {
        code: 'attack',
        name: 'Execute Turn 2 Burst Attack (MC Double Strike + Celestial Dominion)',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Turn 2 Animation Cancel)'
      },
      {
        code: 'exit_if_score',
        name: 'Exit Early if 4,000,000 Honors Reached',
        targetScore: 4000000
      }
    );

    // Turn 3: Yuel Crimson Dance: Yaku + (Double Strike & Auto-Nuke) + Turn 3 Finisher Attack
    steps.push({
      code: 'wait_element',
      name: 'Wait for Turn 3 Finisher Ready',
      target: '.btn-attack-start',
      timeoutMs: 8000
    });
    if (yuelChar) {
      steps.push({
        code: 'skill',
        name: `Character ${yuelChar} Skill 2 (Yuel Crimson Dance: Yaku + Double Strike & Auto-Nuke)`,
        character: yuelChar,
        skill: 2,
        optional: true,
        waitForNetwork: 'ability_result.json'
      });
    }
    steps.push(
      {
        code: 'attack',
        name: 'Execute Turn 3 Attack to Secure 4M Honors',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Turn 3 Animation Cancel)'
      },
      {
        code: 'exit_if_score',
        name: 'Exit Early if 4,000,000 Honors Reached',
        targetScore: 4000000
      }
    );

    // Turn 4: Final Finisher Attack to guarantee 4,000,000 Honors
    steps.push(
      {
        code: 'wait_element',
        name: 'Wait for Turn 4 Finisher Ready',
        target: '.btn-attack-start',
        timeoutMs: 8000
      },
      {
        code: 'attack',
        name: 'Execute Turn 4 Finisher Attack to Lock 4M Honors',
        waitForNetwork: 'normal_attack_result.json'
      },
      {
        code: 'reload',
        name: 'Reload F5 (Post-Turn 4 Animation Cancel)'
      },
      {
        code: 'confirm_result',
        name: 'Confirm Battle Result & Rerun'
      }
    );

    return steps;
  }

  /**
   * Synchronizes templates/raid-seofon.json with the synthesized Siete Party Setup Plan.
   */
  public syncWorkflowFile(plan: SietePartySetupPlan, customPath?: string): string {
    const resolvedPath = path.resolve(process.cwd(), customPath || 'templates/raid-seofon.json');
    let existing: Partial<WorkflowTemplate> = {};
    if (fs.existsSync(resolvedPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as Partial<WorkflowTemplate>;
      } catch {
        existing = {};
      }
    }

    const frontlineNames = plan.party
      .filter(p => p.role === 'frontline')
      .map(p => p.name)
      .join(' + ');
    const backlineNames = plan.party
      .filter(p => p.role === 'backline')
      .map(p => p.name)
      .join(' + ');

    const updated: WorkflowTemplate = {
      name: existing.name || 'Raid - Seofon (Impossible) 4M Honors',
      description: `Seofon (Impossible) / Siete HL 4,000,000 Honors Blue Chest farmer [${plan.deckTarget.label}: MC ${plan.mcJob.name} + ${frontlineNames} (Backline: ${backlineNames})]. Respects Turn-1 99-turn summon lock (no Turn-1 quick_call), cancels 77,777,777 Emblema, and hits 4,000,000 honors in 2-3 turns.`,
      questUrl: existing.questUrl || 'https://game.granbluefantasy.jp/#quest/assist',
      mode: existing.mode || 'assist',
      targetEnemy: existing.targetEnemy || 'Seofon',
      targetRaidQuestId: '305411',
      element: 'Fire',
      raidSlot: existing.raidSlot ?? 1,
      targetScore: 4000000,
      supporterPriority: existing.supporterPriority || ['Agni', 'Colossus', 'Lucifer', 'Beelzebub'],
      evaluatorStrategy: existing.evaluatorStrategy || 'farm',
      minHpPct: existing.minHpPct ?? 35,
      maxHpPct: existing.maxHpPct ?? 100,
      minPlayers: existing.minPlayers ?? 1,
      maxPlayers: existing.maxPlayers ?? 5,
      minRaidScore: existing.minRaidScore ?? 25,
      adaptive: existing.adaptive ?? true,
      minBatchClaim: existing.minBatchClaim ?? 2,
      maxBatchClaim: existing.maxBatchClaim ?? 4,
      speedProfile: existing.speedProfile || 'fast',
      defaultRuns: existing.defaultRuns ?? 200,
      autoBerry: existing.autoBerry ?? true,
      autoElixir: existing.autoElixir ?? false,
      humanMotor: existing.humanMotor ?? true,
      stopOnCaptcha: existing.stopOnCaptcha ?? true,
      autoSetRaid: existing.autoSetRaid ?? true,
      steps: plan.workflowSteps
    };

    fs.writeFileSync(resolvedPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');
    return resolvedPath;
  }

  /**
   * Executes the full Siete Auto-Setup on the live GBF page via REST mutations
   * (or performs a dry-run synthesis) and verifies the resulting deck state.
   */
  public async executeAutoSetup(
    page: Page,
    options: SieteAutoSetupOptions = {}
  ): Promise<SieteAutoSetupResult> {
    const accountId = options.accountId ?? 'acc1';
    const deckTarget = this.resolveDeckTarget(options.deckTarget ?? 153);
    const dryRun = Boolean(options.dryRun);

    const inventory = await this.discoverInventoryFromLivePage(page, accountId, deckTarget.priority);
    const plan = this.synthesizeSetupPlan(inventory, {
      ...options,
      accountId,
      deckTarget: deckTarget.priority
    });

    const mutations: SieteMutationStepLog[] = [];

    if (!dryRun) {
      const p = deckTarget.priority;

      // Phase 1: Change MC Class (POST /party/update_job)
      const jobRes = await this.gbfAjax(page, 'party/update_job', 'POST', {
        special_token: null,
        deck_num: p,
        job_id: plan.mcJob.userJobId
      });
      mutations.push({
        phase: 'mc_class',
        description: `Set MC Class to ${plan.mcJob.name} (userJobId=${plan.mcJob.userJobId})`,
        endpoint: 'party/update_job',
        success: Boolean(jobRes.ok && (jobRes.data?.result ?? true)),
        detail: jobRes.ok ? 'OK' : jobRes.errorText
      });

      // Phase 2: Clear & Set MC Subskills (POST /party_ability_subaction/action)
      for (const pos of [0, 1, 2]) {
        await this.gbfAjax(page, 'party_ability_subaction/action', 'POST', {
          special_token: null,
          ability_id: null,
          deck_num: p,
          set_pos: pos
        });
      }
      for (const sk of plan.mcJob.subskills) {
        const skRes = await this.gbfAjax(page, 'party_ability_subaction/action', 'POST', {
          special_token: null,
          ability_id: sk.abilityId,
          deck_num: p,
          set_pos: sk.setPos
        });
        mutations.push({
          phase: 'mc_subskill',
          description: `Set Subskill Slot ${sk.setPos + 1} to ${sk.name} (abilityId=${sk.abilityId})`,
          endpoint: 'party_ability_subaction/action',
          success: Boolean(skRes.ok && skRes.data?.success !== false),
          detail: skRes.ok ? 'OK' : skRes.errorText
        });
      }

      // Phase 3: Configure Party Characters (POST /party/update_equipment, equipment: "npc")
      // Clear slots 2..5 first so characters moving between slots never collide
      for (const slot of [2, 3, 4, 5]) {
        await this.gbfAjax(page, 'party/update_equipment', 'POST', {
          special_token: null,
          priority: p,
          equipment: 'npc',
          equipment_id: null,
          set_num: slot
        });
      }
      for (const member of plan.party) {
        const npcRes = await this.gbfAjax(page, 'party/update_equipment', 'POST', {
          special_token: null,
          priority: p,
          equipment: 'npc',
          equipment_id: member.userNpcId,
          set_num: member.slot,
          multi_chara_check: false
        });
        mutations.push({
          phase: 'party_npc',
          description: `Set Party Slot ${member.slot} (${member.role}) to ${member.name} (userNpcId=${member.userNpcId})`,
          endpoint: 'party/update_equipment',
          success: Boolean(npcRes.ok && npcRes.data?.success !== false),
          detail: npcRes.ok ? 'OK' : npcRes.errorText
        });
      }

      // Phase 4: Configure Weapon Grid (POST /party/update_equipment, equipment: "weapon")
      // Clear sub-weapons 2..13 in a single batch call (all_assets_flag: 1)
      await this.gbfAjax(page, 'party/update_equipment', 'POST', {
        special_token: null,
        priority: p,
        equipment: 'weapon',
        equipment_id: null,
        set_num: 2,
        all_assets_flag: 1
      });
      for (const wpn of plan.weapons) {
        const wpnRes = await this.gbfAjax(page, 'party/update_equipment', 'POST', {
          special_token: null,
          priority: p,
          equipment: 'weapon',
          equipment_id: wpn.userWeaponId,
          set_num: wpn.slot,
          limit_weapon_check: false
        });
        mutations.push({
          phase: 'weapon_grid',
          description: `Set Weapon Slot ${wpn.slot} (${wpn.role}) to ${wpn.name} (userWeaponId=${wpn.userWeaponId})`,
          endpoint: 'party/update_equipment',
          success: Boolean(wpnRes.ok && wpnRes.data?.success !== false),
          detail: wpnRes.ok ? 'OK' : wpnRes.errorText
        });
      }

      // Phase 5: Configure Summons (POST /party/update_equipment, equipment: "summon" & "sub_summon")
      for (const slot of [2, 3, 4, 5]) {
        await this.gbfAjax(page, 'party/update_equipment', 'POST', {
          special_token: null,
          priority: p,
          equipment: 'summon',
          equipment_id: null,
          set_num: slot
        });
      }
      for (const slot of [1, 2]) {
        await this.gbfAjax(page, 'party/update_equipment', 'POST', {
          special_token: null,
          priority: p,
          equipment: 'sub_summon',
          equipment_id: null,
          set_num: slot
        });
      }
      for (const sum of plan.summons) {
        const sumRes = await this.gbfAjax(page, 'party/update_equipment', 'POST', {
          special_token: null,
          priority: p,
          equipment: sum.equipment,
          equipment_id: sum.userSummonId,
          set_num: sum.slot,
          limit_summon_check: 0
        });
        mutations.push({
          phase: 'summon_grid',
          description: `Set ${sum.role === 'sub_aura' ? 'Sub-Aura' : 'Summon'} Slot ${sum.slot} to ${sum.name} (userSummonId=${sum.userSummonId})`,
          endpoint: 'party/update_equipment',
          success: Boolean(sumRes.ok && sumRes.data?.success !== false),
          detail: sumRes.ok ? 'OK' : sumRes.errorText
        });
      }

      if (options.activateDeck) {
        await this.gbfAjax(page, 'party/update_last_used_deck', 'POST', {
          special_token: null,
          deck_num: p
        });
      }
    }

    // Verify resulting live deck state via GET /party/deck/{priority}
    const verifyRes = await this.gbfAjax(page, `party/deck/${deckTarget.priority}`, 'GET');
    const liveDeck = verifyRes.data?.deck;
    const verifiedLiveDeck = liveDeck
      ? {
          priority: Number(liveDeck.priority || deckTarget.priority),
          name: String(liveDeck.name || ''),
          groupName: String(liveDeck.group_name || ''),
          mcJobName: String(liveDeck.pc?.job?.master?.name || ''),
          mcSubskills: (liveDeck.pc?.set_action || [])
            .map((a: any) => a?.name)
            .filter(Boolean)
            .map(String),
          npcs: Object.entries(liveDeck.npc || {})
            .filter(([, v]: [string, any]) => v?.master?.name)
            .map(([k, v]: [string, any]) => `Slot ${k}: ${v.master.name} (Lv${v.param?.level})`),
          weapons: Object.entries(liveDeck.pc?.weapons || {})
            .filter(([, v]: [string, any]) => v?.master?.name)
            .map(([k, v]: [string, any]) => `Slot ${k}: ${v.master.name} (Lv${v.param?.level})`),
          summons: Object.entries(liveDeck.pc?.summons || {})
            .filter(([, v]: [string, any]) => v?.master?.name)
            .map(([k, v]: [string, any]) => `Slot ${k}: ${v.master.name} (Lv${v.param?.level})`),
          subSummons: Object.entries(liveDeck.pc?.sub_summons || {})
            .filter(([, v]: [string, any]) => v?.master?.name)
            .map(([k, v]: [string, any]) => `Sub ${k}: ${v.master.name} (Lv${v.param?.level})`)
        }
      : undefined;

    let workflowSyncedPath: string | undefined;
    if (options.syncWorkflow !== false) {
      workflowSyncedPath = this.syncWorkflowFile(plan, options.workflowFilePath);
    }

    const readinessReport = await this.readinessChecker.auditFromLiveCdpPage(page, accountId);
    const allMutationsSucceeded = mutations.length === 0 ? true : mutations.every(m => m.success);

    return {
      accountId,
      executedAt: new Date().toISOString(),
      dryRun,
      plan,
      mutations,
      allMutationsSucceeded,
      verifiedLiveDeck,
      workflowSyncedPath,
      readinessReport
    };
  }

  /**
   * Formats a human-readable console summary of the Siete Auto-Setup result.
   */
  public formatConsoleSummary(result: SieteAutoSetupResult): string {
    const lines: string[] = [];
    const { plan, verifiedLiveDeck, readinessReport } = result;
    lines.push('==============================================================================');
    lines.push(
      `  SIETE (SEOFON IMPOSSIBLE) AUTO-SETUP REPORT — [${result.accountId}] -> ${plan.deckTarget.label}`
    );
    lines.push('==============================================================================');
    lines.push(`  Mode          : ${result.dryRun ? 'DRY RUN (No Live Mutations)' : 'LIVE EXECUTION'}`);
    lines.push(`  Target Deck   : ${plan.deckTarget.label}`);
    lines.push(`  Archetype     : ${plan.archetypeId}`);
    lines.push(
      `  Mutations     : ${result.mutations.filter(m => m.success).length}/${result.mutations.length} succeeded`
    );
    if (result.workflowSyncedPath) {
      lines.push(`  Workflow Sync : ${result.workflowSyncedPath}`);
    }
    if (readinessReport) {
      lines.push(
        `  Readiness     : Grade [${readinessReport.overallGrade}] (${readinessReport.overallReadinessScore}/100) | 4M Blue Chest Ready: ${readinessReport.readyFor4MBlueChest ? 'YES' : 'NO'}`
      );
    }

    lines.push('\n  [1] MC CLASS & SUBSKILLS:');
    lines.push(`      Class     : ${plan.mcJob.name} (masterId=${plan.mcJob.masterId}, userJobId=${plan.mcJob.userJobId})`);
    for (const sk of plan.mcJob.subskills) {
      lines.push(`      Subskill ${sk.setPos + 1}: ${sk.name} (abilityId=${sk.abilityId})`);
    }

    lines.push('\n  [2] FIRE PARTY COMPOSITION (Slots 1-5):');
    for (const member of plan.party) {
      lines.push(
        `      Slot ${member.slot} (${member.role.padEnd(9)}): ${member.name} (Lv${member.level}, ${member.evolution}★, userNpcId=${member.userNpcId})`
      );
    }

    lines.push(
      `\n  [3] WEAPON GRID (${plan.weapons.length}/${plan.deckTarget.maxWeaponSlots} Slots | Sabres/Katanas: ${plan.sabreKatanaCount}):`
    );
    for (const wpn of plan.weapons) {
      const arousalTag = wpn.arousalForm ? ` [${wpn.arousalForm}]` : '';
      lines.push(
        `      Slot ${String(wpn.slot).padStart(2, ' ')} (${wpn.role.padEnd(8)}): ${wpn.name} Lv${wpn.level}${arousalTag} (userWeaponId=${wpn.userWeaponId})`
      );
    }

    lines.push('\n  [4] SUMMONS (99-Turn Summon Lock Passive-Aura Lineup):');
    for (const sum of plan.summons) {
      const label =
        sum.role === 'main' ? 'Main Slot 1' : sum.role === 'sub' ? `Sub Slot ${sum.slot} ` : `Sub-Aura ${sum.slot} `;
      lines.push(
        `      ${label}     : ${sum.name} Lv${sum.level} (userSummonId=${sum.userSummonId})`
      );
    }

    if (verifiedLiveDeck) {
      lines.push('\n  [5] LIVE IN-GAME VERIFICATION (/party/deck/' + verifiedLiveDeck.priority + '):');
      lines.push(
        `      Deck Name : "${verifiedLiveDeck.name}" (${verifiedLiveDeck.groupName}) | MC: ${verifiedLiveDeck.mcJobName} [${verifiedLiveDeck.mcSubskills.join(', ')}]`
      );
      lines.push(`      NPCs      : ${verifiedLiveDeck.npcs.join(' | ')}`);
      lines.push(`      Weapons   : ${verifiedLiveDeck.weapons.length} equipped`);
      lines.push(
        `      Summons   : ${verifiedLiveDeck.summons.join(' | ')} || ${verifiedLiveDeck.subSummons.join(' | ')}`
      );
    }

    lines.push('==============================================================================');
    return lines.join('\n');
  }
}

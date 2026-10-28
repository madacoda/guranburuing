// src/services/combat/revans-readiness-checker.service.ts
import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer-core';
import {
  RevansAllRaidsSummaryReport,
  RevansArchetypeDefinition,
  RevansArchetypeEvaluationResult,
  RevansCharacterCatalogItem,
  RevansCharacterSlotCheckResult,
  RevansElement,
  RevansElementRosterInput,
  RevansHardGateCheckResult,
  RevansMultiElementRosterInput,
  RevansOmenCoverageResult,
  RevansPartyCompositionsCatalog,
  RevansPlayerCharacterItem,
  RevansPlayerSummonItem,
  RevansPlayerWeaponItem,
  RevansRaidCatalogEntry,
  RevansRaidId,
  RevansReadinessGrade,
  RevansSingleRaidReport,
  RevansSummonCatalogItem,
  RevansSummonCheckResult,
  RevansSynthesizedOptimalSetup,
  RevansUpgradeRecommendation,
  RevansWeaponCatalogItem,
  RevansWeaponSlotCheckResult
} from '../../domain/revans/index.js';

export const ALL_REVANS_RAID_IDS: RevansRaidId[] = [
  'mugen',
  'diaspora',
  'siegfried',
  'siete',
  'cosmos',
  'agastia'
];

const RAID_ALIASES: Record<string, RevansRaidId> = {
  mugen: 'mugen',
  diaspora: 'diaspora',
  siegfried: 'siegfried',
  sieg: 'siegfried',
  siete: 'siete',
  seofon: 'siete',
  cosmos: 'cosmos',
  agastia: 'agastia'
};

const ATTR_TO_ELEMENT: Record<string, RevansElement> = {
  '1': 'fire',
  '2': 'water',
  '3': 'earth',
  '4': 'wind',
  '5': 'light',
  '6': 'dark'
};

function normalizeLookupKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class RevansReadinessCheckerService {
  private readonly catalog: RevansPartyCompositionsCatalog;
  private readonly snapshotPath: string;
  private readonly markdownReportPath: string;

  constructor(catalogPath?: string, logsDir?: string) {
    const resolvedCatalogPath =
      catalogPath ||
      path.resolve(process.cwd(), 'data/combat/revans-party-compositions.catalog.json');
    this.catalog = JSON.parse(
      fs.readFileSync(resolvedCatalogPath, 'utf-8')
    ) as RevansPartyCompositionsCatalog;

    const baseLogsDir = logsDir || path.resolve(process.cwd(), 'logs');
    this.snapshotPath = path.join(baseLogsDir, 'revans-readiness-snapshot.json');
    this.markdownReportPath = path.join(baseLogsDir, 'revans-readiness-report.md');
  }

  public static resolveRaidId(input?: string): RevansRaidId | 'all' {
    if (!input) return 'all';
    const cleaned = input.trim().toLowerCase();
    if (cleaned === 'all' || cleaned === 'revans') return 'all';
    const mapped = RAID_ALIASES[cleaned];
    if (!mapped) {
      throw new Error(
        `Unknown Revans raid "${input}". Valid raids: mugen, diaspora, siegfried, siete (seofon), cosmos, agastia, all.`
      );
    }
    return mapped;
  }

  public getCatalog(): RevansPartyCompositionsCatalog {
    return this.catalog;
  }

  public getRaidCatalog(raidId: RevansRaidId): RevansRaidCatalogEntry {
    const entry = this.catalog.raids[raidId];
    if (!entry) {
      throw new Error(`Revans raid catalog entry not found for: ${raidId}`);
    }
    return entry;
  }

  public loadMultiElementRosterFromFile(filePath?: string): RevansMultiElementRosterInput {
    const targetPath = path.resolve(
      process.cwd(),
      filePath || 'data/combat/revans-roster.example.json'
    );
    if (!fs.existsSync(targetPath)) {
      throw new Error(`Revans roster file not found at: ${targetPath}`);
    }
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as RevansMultiElementRosterInput;
  }

  /**
   * Non-intrusive read-only AJAX scan of `/party/deck/{priority}` across all 6 elements on a live GBF CDP page.
   */
  public async scrapeMultiElementRosterFromCdpPage(
    page: Page,
    accountId: string = 'acc1',
    targetElement?: RevansElement
  ): Promise<RevansMultiElementRosterInput> {
    const elementPriorities: Record<RevansElement, number[]> = {
      fire: [11, 12, 13, 14, 15, 16, 151, 152, 153, 154, 155, 156, 221],
      water: [21, 22, 23, 24, 25, 26, 91, 92, 93, 94, 95, 96, 161, 162, 163, 164, 165, 166],
      earth: [31, 32, 33, 34, 35, 36, 101, 102, 103, 171, 241],
      wind: [41, 111, 112, 113, 114, 115, 116, 181],
      light: [51, 52, 53, 54, 55, 56, 121, 143, 144],
      dark: [61, 62, 63, 64, 65, 66, 131, 132, 133, 134, 135, 136, 141, 142, 201]
    };

    const prioritiesToScan = targetElement
      ? Array.from(new Set([...elementPriorities[targetElement], 153, 23, 34, 181, 53, 201]))
      : Array.from(new Set(Object.values(elementPriorities).flat()));

    // Ensure the page is on game.granbluefantasy.jp so fetch('/party/deck/...') has session cookies
    const currentUrl = page.url();
    if (!currentUrl.includes('game.granbluefantasy.jp')) {
      await page.goto('https://game.granbluefantasy.jp/#mypage', {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });
      await new Promise(r => setTimeout(r, 1500));
    }

    const rawDecks = await page.evaluate(async (priorities: number[]) => {
      const g = (window as any).Game;
      const version = g?.version;
      const headers: Record<string, string> = {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (version) headers['X-Version'] = String(version);

      const results: Array<{ priority: number; deck: any }> = [];
      const batchSize = 8;
      for (let i = 0; i < priorities.length; i += batchSize) {
        const batch = priorities.slice(i, i + batchSize);
        const batchRes = await Promise.all(
          batch.map(async p => {
            try {
              const r = await fetch(
                `https://game.granbluefantasy.jp/party/deck/${p}?_=${Date.now()}`,
                { headers }
              );
              if (r.status !== 200) return null;
              const j = await r.json().catch(() => null);
              return j?.deck ? { priority: p, deck: j.deck } : null;
            } catch {
              return null;
            }
          })
        );
        for (const item of batchRes) {
          if (item) results.push(item);
        }
      }
      return results;
    }, prioritiesToScan);

    const allElements: RevansElement[] = ['fire', 'water', 'earth', 'wind', 'light', 'dark'];
    const globalClasses = new Set<string>();
    const globalSummons = new Map<string, RevansPlayerSummonItem>();

    const elementCharMaps: Record<RevansElement, Map<string, RevansPlayerCharacterItem>> = {
      fire: new Map(),
      water: new Map(),
      earth: new Map(),
      wind: new Map(),
      light: new Map(),
      dark: new Map()
    };
    const elementWeaponMaps: Record<RevansElement, Map<string, RevansPlayerWeaponItem>> = {
      fire: new Map(),
      water: new Map(),
      earth: new Map(),
      wind: new Map(),
      light: new Map(),
      dark: new Map()
    };
    const elementSummonMaps: Record<RevansElement, Map<string, RevansPlayerSummonItem>> = {
      fire: new Map(),
      water: new Map(),
      earth: new Map(),
      wind: new Map(),
      light: new Map(),
      dark: new Map()
    };
    const elementMaxHp: Record<RevansElement, { hp: number; priority?: number; bestClass?: string }> = {
      fire: { hp: 0 },
      water: { hp: 0 },
      earth: { hp: 0 },
      wind: { hp: 0 },
      light: { hp: 0 },
      dark: { hp: 0 }
    };

    for (const { priority, deck } of rawDecks) {
      const pc = deck?.pc;
      if (!pc) continue;

      const jobName = pc.job?.master?.name ? String(pc.job.master.name) : '';
      if (jobName) globalClasses.add(jobName);

      const mhAttr = String(pc.weapons?.['1']?.master?.attribute || pc.param?.attribute || '');
      const deckEl = ATTR_TO_ELEMENT[mhAttr];
      const deckHp = Number(pc.damage_info?.hp || pc.param?.hp || 0);

      if (deckEl) {
        if (deckHp > elementMaxHp[deckEl].hp) {
          elementMaxHp[deckEl].hp = deckHp;
          elementMaxHp[deckEl].priority = priority;
        }
        if (
          !elementMaxHp[deckEl].bestClass ||
          jobName === 'Kengo' ||
          jobName === 'Manadiver'
        ) {
          elementMaxHp[deckEl].bestClass = jobName || elementMaxHp[deckEl].bestClass;
        }
      }

      // Characters
      Object.values(deck.npc || {}).forEach((npcObj: any) => {
        const master = npcObj?.master;
        const param = npcObj?.param;
        if (!master?.name) return;
        const cAttr = String(master.attribute || param?.attribute || '');
        const cEl = ATTR_TO_ELEMENT[cAttr];
        if (!cEl) return;

        const npcId = String(master.id || '');
        const name = String(master.name);
        const key = npcId || name;
        const lvl = Number(param?.level || 80);
        const evo = Number(param?.evolution || 4);
        const existing = elementCharMaps[cEl].get(key);
        if (!existing || lvl > (existing.level || 0)) {
          elementCharMaps[cEl].set(key, {
            npcId: npcId || undefined,
            name,
            element: cEl,
            level: lvl,
            uncapStars: evo,
            hasFourthSkill: lvl >= 100 || evo >= 5
          });
        }
      });

      // Weapons per element within this deck
      const deckWpnCounts: Record<
        RevansElement,
        Map<string, { weaponId?: string; name: string; copies: number; level: number; isMainhand: boolean }>
      > = {
        fire: new Map(),
        water: new Map(),
        earth: new Map(),
        wind: new Map(),
        light: new Map(),
        dark: new Map()
      };

      Object.entries(pc.weapons || {}).forEach(([slotKey, wpnObj]: [string, any]) => {
        const master = wpnObj?.master;
        const param = wpnObj?.param;
        if (!master?.name) return;
        const wAttr = String(master.attribute || '');
        const wEl = ATTR_TO_ELEMENT[wAttr] || deckEl;
        if (!wEl) return;

        const wId = String(master.id || '');
        const wName = String(master.name);
        const key = wId || wName;
        const lvl = Number(param?.level || 150);
        const isMh = slotKey === '1' || slotKey === 'main';
        const cur = deckWpnCounts[wEl].get(key);
        if (cur) {
          cur.copies += 1;
          if (isMh) cur.isMainhand = true;
          if (lvl > cur.level) cur.level = lvl;
        } else {
          deckWpnCounts[wEl].set(key, {
            weaponId: wId || undefined,
            name: wName,
            copies: 1,
            level: lvl,
            isMainhand: isMh
          });
        }
      });

      for (const el of allElements) {
        for (const [key, wEntry] of deckWpnCounts[el].entries()) {
          const existing = elementWeaponMaps[el].get(key);
          if (!existing) {
            elementWeaponMaps[el].set(key, { ...wEntry, element: el });
          } else {
            existing.copies = Math.max(existing.copies, wEntry.copies);
            existing.level = Math.max(existing.level || 150, wEntry.level);
            if (wEntry.isMainhand) existing.isMainhand = true;
          }
        }
      }

      // Summons
      const collectSummon = (sumObj: any, role: RevansPlayerSummonItem['slotRole']) => {
        const master = sumObj?.master;
        const param = sumObj?.param;
        if (!master?.name) return;
        const sId = String(master.id || '');
        const sName = String(master.name);
        const key = sId || sName;
        const lvl = Number(param?.level || 150);
        const sAttr = String(master.attribute || '');
        const sEl = ATTR_TO_ELEMENT[sAttr];

        const item: RevansPlayerSummonItem = {
          summonId: sId || undefined,
          name: sName,
          element: sEl,
          level: lvl,
          slotRole: role
        };

        const existingGlobal = globalSummons.get(key);
        if (!existingGlobal || role === 'main' || lvl > (existingGlobal.level || 0)) {
          globalSummons.set(key, item);
        }
        if (sEl) {
          const existingEl = elementSummonMaps[sEl].get(key);
          if (!existingEl || role === 'main' || lvl > (existingEl.level || 0)) {
            elementSummonMaps[sEl].set(key, item);
          }
        }
      };

      Object.entries(pc.summons || {}).forEach(([slotKey, sumObj]) => {
        collectSummon(sumObj, slotKey === '1' ? 'main' : 'sub');
      });
      Object.values(pc.sub_summons || {}).forEach(sumObj => {
        collectSummon(sumObj, 'sub_aura');
      });
    }

    const unlockedArr = Array.from(globalClasses);
    const elementsRecord = {} as Record<RevansElement, RevansElementRosterInput>;
    for (const el of allElements) {
      // Merge element summons + global universal summons (e.g. Triple Zero, Beelzebub, Bahamut, Belial)
      const mergedSummons = new Map<string, RevansPlayerSummonItem>(elementSummonMaps[el]);
      for (const [k, s] of globalSummons.entries()) {
        if (!mergedSummons.has(k)) {
          mergedSummons.set(k, s);
        }
      }

      elementsRecord[el] = {
        element: el,
        activeMcClass: elementMaxHp[el].bestClass || unlockedArr[0] || 'Kengo',
        mcClassesUnlocked: unlockedArr,
        estimatedPartyHp: elementMaxHp[el].hp || 55000,
        maxHpDeckPriority: elementMaxHp[el].priority,
        characters: Array.from(elementCharMaps[el].values()),
        weapons: Array.from(elementWeaponMaps[el].values()),
        summons: Array.from(mergedSummons.values())
      };
    }

    return {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      accountId,
      source: 'cdp_live',
      mcClassesUnlocked: unlockedArr,
      elements: elementsRecord
    };
  }

  /**
   * Evaluates a single Revans raid from a live Chrome CDP page.
   */
  public async auditRaidFromLiveCdpPage(
    page: Page,
    raidId: RevansRaidId,
    accountId: string = 'acc1'
  ): Promise<RevansSingleRaidReport> {
    const raidCatalog = this.getRaidCatalog(raidId);
    const multiRoster = await this.scrapeMultiElementRosterFromCdpPage(
      page,
      accountId,
      raidCatalog.advantageousElement
    );
    const report = this.evaluateSingleRaid(raidId, multiRoster);
    this.persistSingleRaidArtifacts(report);
    return report;
  }

  /**
   * Evaluates all 6 Revans raids from a live Chrome CDP page in one unified pass.
   */
  public async auditAllRaidsFromLiveCdpPage(
    page: Page,
    accountId: string = 'acc1'
  ): Promise<RevansAllRaidsSummaryReport> {
    const multiRoster = await this.scrapeMultiElementRosterFromCdpPage(page, accountId);
    const summary = this.evaluateAllRaids(multiRoster);
    this.persistAllRaidsArtifacts(multiRoster, summary);
    return summary;
  }

  /**
   * Evaluates all 6 Revans Series raids from a multi-element roster.
   */
  public evaluateAllRaids(
    multiRoster: RevansMultiElementRosterInput
  ): RevansAllRaidsSummaryReport {
    const raidReports = {} as Record<RevansRaidId, RevansSingleRaidReport>;
    let readyCount = 0;
    let totalScore = 0;

    for (const raidId of ALL_REVANS_RAID_IDS) {
      const r = this.evaluateSingleRaid(raidId, multiRoster);
      raidReports[raidId] = r;
      if (r.readyFor4MBlueChest) readyCount += 1;
      totalScore += r.overallReadinessScore;
    }

    const sortedRaids = [...ALL_REVANS_RAID_IDS].sort(
      (a, b) =>
        raidReports[b].overallReadinessScore - raidReports[a].overallReadinessScore
    );

    return {
      timestamp: new Date().toISOString(),
      accountId: multiRoster.accountId || 'acc1',
      source: multiRoster.source || 'roster_config',
      totalRaidsEvaluated: ALL_REVANS_RAID_IDS.length,
      readyRaidsCount: readyCount,
      averageReadinessScore: Math.round(totalScore / ALL_REVANS_RAID_IDS.length),
      bestRaidId: sortedRaids[0],
      recommendedFarmingOrder: sortedRaids,
      raidReports
    };
  }

  /**
   * Evaluates a single Revans Series raid against the player's advantageous element roster.
   */
  public evaluateSingleRaid(
    raidId: RevansRaidId,
    multiRoster: RevansMultiElementRosterInput
  ): RevansSingleRaidReport {
    const raidCatalog = this.getRaidCatalog(raidId);
    const advElement = raidCatalog.advantageousElement;
    const elementRoster: RevansElementRosterInput = multiRoster.elements[advElement] || {
      element: advElement,
      mcClassesUnlocked: multiRoster.mcClassesUnlocked || [],
      estimatedPartyHp: 0,
      characters: [],
      weapons: [],
      summons: []
    };

    const resolvedChars = this.resolveOwnedCharacters(elementRoster, raidCatalog);
    const resolvedWeapons = this.resolveOwnedWeapons(elementRoster, raidCatalog);
    const resolvedSummons = this.resolveOwnedSummons(elementRoster, raidCatalog);

    const archetypeEvaluations = raidCatalog.archetypes.map(arch =>
      this.evaluateArchetype(
        raidCatalog,
        arch,
        elementRoster,
        resolvedChars,
        resolvedWeapons,
        resolvedSummons
      )
    );

    archetypeEvaluations.sort((a, b) => b.overallScore - a.overallScore);
    const bestEval = archetypeEvaluations[0];

    const hardGateResults = this.evaluateHardGates(
      raidCatalog,
      elementRoster,
      bestEval
    );
    const allCriticalGatesPassed = hardGateResults
      .filter(g => g.severity === 'CRITICAL_BLOCKER')
      .every(g => g.passed);

    const finalScore = allCriticalGatesPassed
      ? bestEval.overallScore
      : Math.min(bestEval.overallScore, 55);
    const finalGrade = this.computeGrade(finalScore, allCriticalGatesPassed);
    const readyFor4M = allCriticalGatesPassed && finalScore >= 70;

    const coveredOmensCount = bestEval.omenCoverage.filter(o => o.covered).length;
    const omenRatio = `${coveredOmensCount}/${bestEval.omenCoverage.length}`;

    const synthesizedOptimalSetup = this.synthesizeSetup(raidCatalog, bestEval);
    const upgradeRoadmap = this.buildUpgradeRoadmap(
      raidCatalog,
      elementRoster,
      bestEval,
      hardGateResults
    );

    return {
      timestamp: new Date().toISOString(),
      accountId: multiRoster.accountId || 'acc1',
      source: multiRoster.source || 'roster_config',
      raidId,
      raidName: raidCatalog.raidName,
      bossName: raidCatalog.bossName,
      questId: raidCatalog.questId,
      stageId: raidCatalog.stageId,
      bossElement: raidCatalog.bossElement,
      advantageousElement: advElement,
      signatureWeaponDrop: `${raidCatalog.signatureWeaponDrop.name} (${raidCatalog.signatureWeaponDrop.description})`,
      blueChestTargetHonors: raidCatalog.blueChestTargetHonors,
      equivalentTargetDamage: raidCatalog.equivalentTargetDamage,
      overallReadinessScore: finalScore,
      overallGrade: finalGrade,
      readyFor4MBlueChest: readyFor4M,
      omenSolverCoverageRatio: omenRatio,
      measuredElementMaxHp: elementRoster.estimatedPartyHp,
      minimumRequiredHp: raidCatalog.minimumEntryHp,
      hardGateResults,
      allCriticalGatesPassed,
      bestArchetypeEvaluation: bestEval,
      allArchetypeEvaluations: archetypeEvaluations,
      synthesizedOptimalSetup,
      upgradeRoadmap
    };
  }

  private resolveOwnedCharacters(
    roster: RevansElementRosterInput,
    raidCatalog: RevansRaidCatalogEntry
  ): Map<string, { raw: RevansPlayerCharacterItem; catalog: RevansCharacterCatalogItem }> {
    const matched = new Map<
      string,
      { raw: RevansPlayerCharacterItem; catalog: RevansCharacterCatalogItem }
    >();

    for (const rawChar of roster.characters) {
      const rawNpcId = (rawChar.npcId || '').trim();
      const rawNormName = normalizeLookupKey(rawChar.name);

      const catItem = raidCatalog.characterRegistry.find(c => {
        if (rawNpcId && c.npcId === rawNpcId) return true;
        if (normalizeLookupKey(c.id) === rawNormName) return true;
        if (normalizeLookupKey(c.name) === rawNormName) return true;
        return c.aliases.some(alias => normalizeLookupKey(alias) === rawNormName);
      });

      if (catItem) {
        matched.set(catItem.id, { raw: rawChar, catalog: catItem });
      }
    }
    return matched;
  }

  private resolveOwnedWeapons(
    roster: RevansElementRosterInput,
    raidCatalog: RevansRaidCatalogEntry
  ): Map<string, { raw: RevansPlayerWeaponItem; catalog: RevansWeaponCatalogItem; copies: number }> {
    const matched = new Map<
      string,
      { raw: RevansPlayerWeaponItem; catalog: RevansWeaponCatalogItem; copies: number }
    >();

    for (const rawWpn of roster.weapons) {
      const rawWpnId = (rawWpn.weaponId || '').trim();
      const rawNormName = normalizeLookupKey(rawWpn.name);

      const catItem = raidCatalog.weaponRegistry.find(w => {
        if (rawWpnId && w.weaponId === rawWpnId) return true;
        if (normalizeLookupKey(w.id) === rawNormName) return true;
        if (normalizeLookupKey(w.name) === rawNormName) return true;
        return w.aliases.some(alias => normalizeLookupKey(alias) === rawNormName);
      });

      if (catItem) {
        const existing = matched.get(catItem.id);
        const copies = Math.max(1, rawWpn.copies || 1);
        if (!existing || copies > existing.copies) {
          matched.set(catItem.id, { raw: rawWpn, catalog: catItem, copies });
        }
      }
    }
    return matched;
  }

  private resolveOwnedSummons(
    roster: RevansElementRosterInput,
    raidCatalog: RevansRaidCatalogEntry
  ): Map<string, { raw: RevansPlayerSummonItem; catalog: RevansSummonCatalogItem }> {
    const matched = new Map<
      string,
      { raw: RevansPlayerSummonItem; catalog: RevansSummonCatalogItem }
    >();

    for (const rawSum of roster.summons) {
      const rawSumId = (rawSum.summonId || '').trim();
      const rawNormName = normalizeLookupKey(rawSum.name);

      const catItem = raidCatalog.summonRegistry.find(s => {
        if (rawSumId && s.summonId === rawSumId) return true;
        if (normalizeLookupKey(s.id) === rawNormName) return true;
        if (normalizeLookupKey(s.name) === rawNormName) return true;
        return s.aliases.some(alias => normalizeLookupKey(alias) === rawNormName);
      });

      if (catItem) {
        matched.set(catItem.id, { raw: rawSum, catalog: catItem });
      }
    }
    return matched;
  }

  private evaluateArchetype(
    raidCatalog: RevansRaidCatalogEntry,
    arch: RevansArchetypeDefinition,
    roster: RevansElementRosterInput,
    resolvedChars: Map<string, { raw: RevansPlayerCharacterItem; catalog: RevansCharacterCatalogItem }>,
    resolvedWeapons: Map<string, { raw: RevansPlayerWeaponItem; catalog: RevansWeaponCatalogItem; copies: number }>,
    resolvedSummons: Map<string, { raw: RevansPlayerSummonItem; catalog: RevansSummonCatalogItem }>
  ): RevansArchetypeEvaluationResult {
    // 1. MC Class Evaluation (10% weight)
    const unlockedNorm = new Set(
      [...(roster.mcClassesUnlocked || []), roster.activeMcClass || '']
        .filter(Boolean)
        .map(c => normalizeLookupKey(c))
    );
    let mcScore = 40;
    let mcMatchedClass: string | null = null;
    let mcStatus: 'PRIMARY' | 'ALTERNATIVE' | 'MISSING' = 'MISSING';

    if (unlockedNorm.has(normalizeLookupKey(arch.mcSpec.primaryClass))) {
      mcScore = 100;
      mcMatchedClass = arch.mcSpec.primaryClass;
      mcStatus = 'PRIMARY';
    } else {
      const altMatch = arch.mcSpec.alternativeClasses.find(alt =>
        unlockedNorm.has(normalizeLookupKey(alt))
      );
      if (altMatch) {
        mcScore = 88;
        mcMatchedClass = altMatch;
        mcStatus = 'ALTERNATIVE';
      }
    }

    // 2. Character Slots Evaluation (45% weight)
    const usedCharIds = new Set<string>();
    const charSlotResults: RevansCharacterSlotCheckResult[] = [];
    const activeTacticalTags = new Set<string>();
    let totalTurnDamage = 25000000; // Base MC turn contribution
    let totalPeakDamage = 40000000;

    for (const slotSpec of arch.characterSlots) {
      const primaryCat = raidCatalog.characterRegistry.find(
        c => c.id === slotSpec.primaryCharacterId
      );
      const primaryName = primaryCat?.name || slotSpec.primaryCharacterId;

      const primaryOwned = resolvedChars.get(slotSpec.primaryCharacterId);
      if (primaryOwned && !usedCharIds.has(slotSpec.primaryCharacterId)) {
        usedCharIds.add(slotSpec.primaryCharacterId);
        primaryOwned.catalog.tacticalTags.forEach(t => activeTacticalTags.add(t));
        if (slotSpec.position === 'frontline') {
          totalTurnDamage += primaryOwned.catalog.estimatedTurnDamageContribution;
          totalPeakDamage += primaryOwned.catalog.estimatedPeakBurstContribution;
        } else {
          totalTurnDamage += Math.round(
            primaryOwned.catalog.estimatedTurnDamageContribution * 0.35
          );
          totalPeakDamage += Math.round(
            primaryOwned.catalog.estimatedPeakBurstContribution * 0.35
          );
        }
        charSlotResults.push({
          slotNumber: slotSpec.slotNumber,
          slotRole: slotSpec.roleLabel,
          position: slotSpec.position,
          primaryCharacterId: slotSpec.primaryCharacterId,
          primaryCharacterName: primaryName,
          status: 'PRIMARY_MATCH',
          matchedCharacterId: primaryOwned.catalog.id,
          matchedCharacterName: primaryOwned.catalog.name,
          matchedNpcId: primaryOwned.catalog.npcId,
          compatibilityScore: 100,
          estimatedTurnDamage: primaryOwned.catalog.estimatedTurnDamageContribution,
          estimatedPeakDamage: primaryOwned.catalog.estimatedPeakBurstContribution,
          notes: primaryOwned.catalog.notes
        });
        continue;
      }

      // Check acceptableSubstitutes
      const subId = slotSpec.acceptableSubstitutes.find(
        id => resolvedChars.has(id) && !usedCharIds.has(id)
      );
      if (subId) {
        const subOwned = resolvedChars.get(subId)!;
        usedCharIds.add(subId);
        subOwned.catalog.tacticalTags.forEach(t => activeTacticalTags.add(t));
        if (slotSpec.position === 'frontline') {
          totalTurnDamage += subOwned.catalog.estimatedTurnDamageContribution;
          totalPeakDamage += subOwned.catalog.estimatedPeakBurstContribution;
        } else {
          totalTurnDamage += Math.round(
            subOwned.catalog.estimatedTurnDamageContribution * 0.3
          );
          totalPeakDamage += Math.round(
            subOwned.catalog.estimatedPeakBurstContribution * 0.3
          );
        }
        charSlotResults.push({
          slotNumber: slotSpec.slotNumber,
          slotRole: slotSpec.roleLabel,
          position: slotSpec.position,
          primaryCharacterId: slotSpec.primaryCharacterId,
          primaryCharacterName: primaryName,
          status: 'SUBSTITUTE_MATCH',
          matchedCharacterId: subOwned.catalog.id,
          matchedCharacterName: subOwned.catalog.name,
          matchedNpcId: subOwned.catalog.npcId,
          compatibilityScore: 88,
          estimatedTurnDamage: subOwned.catalog.estimatedTurnDamageContribution,
          estimatedPeakDamage: subOwned.catalog.estimatedPeakBurstContribution,
          notes: `High-synergy substitute for ${primaryName}: ${subOwned.catalog.notes}`
        });
        continue;
      }

      // Fallback: any unused resolved catalog character in this element
      const fallbackEntry = Array.from(resolvedChars.values()).find(
        entry => !usedCharIds.has(entry.catalog.id)
      );
      if (fallbackEntry) {
        usedCharIds.add(fallbackEntry.catalog.id);
        fallbackEntry.catalog.tacticalTags.forEach(t => activeTacticalTags.add(t));
        charSlotResults.push({
          slotNumber: slotSpec.slotNumber,
          slotRole: slotSpec.roleLabel,
          position: slotSpec.position,
          primaryCharacterId: slotSpec.primaryCharacterId,
          primaryCharacterName: primaryName,
          status: 'FALLBACK_MATCH',
          matchedCharacterId: fallbackEntry.catalog.id,
          matchedCharacterName: fallbackEntry.catalog.name,
          matchedNpcId: fallbackEntry.catalog.npcId,
          compatibilityScore: 72,
          estimatedTurnDamage: fallbackEntry.catalog.estimatedTurnDamageContribution,
          estimatedPeakDamage: fallbackEntry.catalog.estimatedPeakBurstContribution,
          notes: `Element fallback (${fallbackEntry.catalog.name})`
        });
        continue;
      }

      charSlotResults.push({
        slotNumber: slotSpec.slotNumber,
        slotRole: slotSpec.roleLabel,
        position: slotSpec.position,
        primaryCharacterId: slotSpec.primaryCharacterId,
        primaryCharacterName: primaryName,
        status: 'MISSING',
        compatibilityScore: 0,
        estimatedTurnDamage: 0,
        estimatedPeakDamage: 0,
        notes: `Missing ${primaryName} and substitutes.`
      });
    }

    const characterScore = Math.round(
      charSlotResults.reduce((acc, s) => acc + s.compatibilityScore, 0) /
        Math.max(1, charSlotResults.length)
    );

    // 3. Weapon Grid Evaluation (35% weight)
    const weaponSlotResults: RevansWeaponSlotCheckResult[] = [];
    for (const wSpec of arch.weaponSlots) {
      const primaryWpnCat = raidCatalog.weaponRegistry.find(
        w => w.id === wSpec.primaryWeaponId
      );
      const primaryWpnName = primaryWpnCat?.name || wSpec.primaryWeaponId;
      const primaryOwned = resolvedWeapons.get(wSpec.primaryWeaponId);
      const primaryCopies = primaryOwned ? primaryOwned.copies : 0;

      if (primaryCopies >= wSpec.recommendedCopies) {
        weaponSlotResults.push({
          roleLabel: wSpec.roleLabel,
          primaryWeaponId: wSpec.primaryWeaponId,
          primaryWeaponName: primaryWpnName,
          recommendedCopies: wSpec.recommendedCopies,
          ownedEffectiveCopies: primaryCopies,
          status: 'FULL_PRIMARY',
          matchedWeaponsSummary: `${primaryCopies}x ${primaryWpnName}`,
          slotScore: 100,
          notes: primaryWpnCat?.notes || ''
        });
        continue;
      }

      // Check substitutes to fill remaining copies
      let subCopies = 0;
      const matchedNames: string[] = [];
      if (primaryCopies > 0) {
        matchedNames.push(`${primaryCopies}x ${primaryWpnName}`);
      }
      for (const subId of wSpec.acceptableSubstitutes) {
        const subOwned = resolvedWeapons.get(subId);
        if (subOwned && subOwned.copies > 0) {
          subCopies += subOwned.copies;
          matchedNames.push(`${subOwned.copies}x ${subOwned.catalog.name}`);
        }
      }

      const effectiveCopies = primaryCopies + subCopies;
      if (effectiveCopies > 0) {
        const ratio = Math.min(1, effectiveCopies / wSpec.recommendedCopies);
        const score = Math.round(75 + ratio * 20);
        weaponSlotResults.push({
          roleLabel: wSpec.roleLabel,
          primaryWeaponId: wSpec.primaryWeaponId,
          primaryWeaponName: primaryWpnName,
          recommendedCopies: wSpec.recommendedCopies,
          ownedEffectiveCopies: effectiveCopies,
          status: 'PARTIAL_OR_SUBSTITUTE',
          matchedWeaponsSummary: matchedNames.join(' + '),
          slotScore: score,
          notes: `Covered via ${matchedNames.join(' + ')}`
        });
      } else {
        weaponSlotResults.push({
          roleLabel: wSpec.roleLabel,
          primaryWeaponId: wSpec.primaryWeaponId,
          primaryWeaponName: primaryWpnName,
          recommendedCopies: wSpec.recommendedCopies,
          ownedEffectiveCopies: 0,
          status: 'MISSING',
          matchedWeaponsSummary: 'None',
          slotScore: 25,
          notes: `Missing ${primaryWpnName}`
        });
      }
    }

    const weaponScore = Math.round(
      weaponSlotResults.reduce((acc, w) => acc + w.slotScore, 0) /
        Math.max(1, weaponSlotResults.length)
    );

    const mhMatchedId = arch.mcSpec.preferredMainhandIds.find(id =>
      resolvedWeapons.has(id)
    );
    const mainhandMatched = mhMatchedId
      ? resolvedWeapons.get(mhMatchedId)!.catalog.name
      : roster.weapons.find(w => w.isMainhand)?.name ||
        roster.weapons[0]?.name ||
        null;

    // 4. Summon Evaluation (10% weight)
    const mainMatchedId = arch.summonSpec.preferredMainSummonIds.find(id =>
      resolvedSummons.has(id)
    );
    const mainSummonMatched = mainMatchedId
      ? resolvedSummons.get(mainMatchedId)!.catalog.name
      : roster.summons.find(s => s.slotRole === 'main')?.name || null;

    const subAuraMatched: string[] = [];
    const missingSubAuras: string[] = [];
    let totalCapBonus = 0;
    let totalSeraphic = 0;
    let totalHpBonus = 0;

    for (const subId of arch.summonSpec.recommendedSubAuraSummonIds) {
      const owned = resolvedSummons.get(subId);
      const cat = raidCatalog.summonRegistry.find(s => s.id === subId);
      if (owned) {
        subAuraMatched.push(owned.catalog.name);
        totalCapBonus += owned.catalog.damageCapBonusPercent;
        totalSeraphic += owned.catalog.seraphicAmpPercent;
        totalHpBonus += owned.catalog.hpBonusPercent;
        if (owned.catalog.id === 'triple_zero') {
          activeTacticalTags.add('sub_all_tank');
          activeTacticalTags.add('dispel_spam');
        }
      } else if (cat) {
        missingSubAuras.push(cat.name);
      }
    }

    const summonScore = Math.min(
      100,
      (mainSummonMatched ? 50 : 20) +
        Math.round(
          (subAuraMatched.length /
            Math.max(1, arch.summonSpec.recommendedSubAuraSummonIds.length)) *
            50
        )
    );

    const summonCheck: RevansSummonCheckResult = {
      mainSummonMatched,
      supporterSummonMatched: mainSummonMatched || raidCatalog.summonRegistry[0]?.name || 'Element Support',
      subAuraSummonsMatched: subAuraMatched,
      missingSubAuraSummons: missingSubAuras,
      totalPassiveDamageCapBonusPercent: totalCapBonus,
      totalSeraphicAmpPercent: totalSeraphic,
      totalSupplementalDamageFlat: 0,
      totalHpBonusPercent: totalHpBonus,
      summonScore,
      notes: []
    };

    // 5. Omen Coverage Check
    const omenCoverage: RevansOmenCoverageResult[] = raidCatalog.coreOmens.map(omen => {
      const missingTags = omen.requiredTacticalTags.filter(
        t => !activeTacticalTags.has(t)
      );
      const matchedSolvers = charSlotResults
        .filter(c => c.matchedCharacterName)
        .map(c => c.matchedCharacterName!)
        .slice(0, 3);
      return {
        omenName: omen.omenName,
        trigger: omen.trigger,
        cancelCondition: omen.cancelCondition,
        covered: missingTags.length === 0,
        matchedSolvers,
        missingTags
      };
    });

    const overallScore = Math.round(
      mcScore * 0.1 +
        characterScore * 0.45 +
        weaponScore * 0.35 +
        summonScore * 0.1
    );

    const estimatedPartyHp =
      roster.estimatedPartyHp > 0
        ? roster.estimatedPartyHp
        : arch.recommendedComfortHp;

    const estimatedTurnsTo4MHonors = Math.max(
      2,
      Math.ceil(raidCatalog.equivalentTargetDamage / Math.max(40000000, totalTurnDamage))
    );

    const missingRequirements: string[] = [];
    for (const c of charSlotResults) {
      if (c.status === 'MISSING') {
        missingRequirements.push(`Missing Character: ${c.primaryCharacterName} (${c.slotRole})`);
      }
    }
    for (const w of weaponSlotResults) {
      if (w.status === 'MISSING') {
        missingRequirements.push(`Missing Weapon: ${w.primaryWeaponName} (${w.roleLabel})`);
      }
    }
    for (const s of missingSubAuras) {
      missingRequirements.push(`Missing Sub-Aura Summon: ${s}`);
    }

    return {
      archetypeId: arch.archetypeId,
      archetypeName: arch.name,
      playstyle: arch.playstyle,
      overallScore,
      grade: this.computeGrade(overallScore, true),
      isReadyFor4MBlueChest: overallScore >= 70 && estimatedPartyHp >= raidCatalog.minimumEntryHp,
      mcScore,
      mcMatchedClass,
      mcStatus,
      characterScore,
      characterSlots: charSlotResults,
      weaponScore,
      mainhandMatched,
      weaponSlots: weaponSlotResults,
      summonCheck,
      omenCoverage,
      estimatedPartyHp,
      estimatedAverageTurnDamage: totalTurnDamage,
      estimatedPeakBurstTurnDamage: totalPeakDamage,
      estimatedTurnsTo4MHonors,
      recommendedTurnRotation: arch.turnByTurnRotation,
      missingRequirements
    };
  }

  private evaluateHardGates(
    raidCatalog: RevansRaidCatalogEntry,
    roster: RevansElementRosterInput,
    bestEval: RevansArchetypeEvaluationResult
  ): RevansHardGateCheckResult[] {
    const advElUpper = raidCatalog.advantageousElement.toUpperCase();
    const matchedElementChars = roster.characters.filter(
      c => c.element === raidCatalog.advantageousElement
    ).length;

    const gate1Passed = matchedElementChars >= 4;
    const gate2Passed = bestEval.estimatedPartyHp >= raidCatalog.minimumEntryHp;
    const coveredOmens = bestEval.omenCoverage.filter(o => o.covered).length;
    const gate3Passed = coveredOmens >= Math.ceil(bestEval.omenCoverage.length * 0.66);
    const gate4Passed = bestEval.estimatedTurnsTo4MHonors <= 6;

    return [
      {
        gateId: 'gate_1_element_compliance',
        name: `100% ${advElUpper} Element Roster Compliance`,
        severity: 'CRITICAL_BLOCKER',
        passed: gate1Passed,
        measuredValue: `${matchedElementChars} ${advElUpper} SSR characters discovered`,
        requiredThreshold: `>= 4 ${advElUpper} SSR characters`,
        diagnosticMessage: gate1Passed
          ? `Full ${advElUpper} roster verified (${matchedElementChars} characters) for ${raidCatalog.raidName}.`
          : `Insufficient ${advElUpper} characters discovered (${matchedElementChars}/4).`
      },
      {
        gateId: 'gate_2_entry_and_trigger_hp',
        name: `${raidCatalog.raidName} HP Survivability Gate`,
        severity: 'CRITICAL_BLOCKER',
        passed: gate2Passed,
        measuredValue: `${bestEval.estimatedPartyHp.toLocaleString()} HP`,
        requiredThreshold: `>= ${raidCatalog.minimumEntryHp.toLocaleString()} HP (Comfort: ${raidCatalog.recommendedComfortHp.toLocaleString()}+ HP)`,
        diagnosticMessage: gate2Passed
          ? `Max ${advElUpper} Party HP (${bestEval.estimatedPartyHp.toLocaleString()}) clears the ${raidCatalog.minimumEntryHp.toLocaleString()} HP threshold.`
          : `Party HP (${bestEval.estimatedPartyHp.toLocaleString()}) is below ${raidCatalog.minimumEntryHp.toLocaleString()} HP required for ${raidCatalog.raidName}.`
      },
      {
        gateId: 'gate_3_omen_solver_coverage',
        name: 'Raid Omen & Gimmick Solver Coverage',
        severity: 'WARNING',
        passed: gate3Passed,
        measuredValue: `${coveredOmens}/${bestEval.omenCoverage.length} Core Omens Covered`,
        requiredThreshold: 'All core raid omen mechanics covered by party kit',
        diagnosticMessage: gate3Passed
          ? `Party covers ${coveredOmens}/${bestEval.omenCoverage.length} core ${raidCatalog.raidName} omens.`
          : `Some omen tags missing; rely on Guard or summon calls during triggers.`
      },
      {
        gateId: 'gate_4_blue_chest_4m_pacing',
        name: '4,000,000 Honors Blue Chest Pacing',
        severity: 'WARNING',
        passed: gate4Passed,
        measuredValue: `~${bestEval.estimatedTurnsTo4MHonors} Turns (~${(bestEval.estimatedAverageTurnDamage / 1000000).toFixed(1)}M DMG/turn)`,
        requiredThreshold: '<= 6 Turns to 4,000,000 Honors (~400M DMG)',
        diagnosticMessage: gate4Passed
          ? `Projected to reach 4,000,000 Honors in ~${bestEval.estimatedTurnsTo4MHonors} turns.`
          : `Projected turn pacing (~${bestEval.estimatedTurnsTo4MHonors} turns) is slow for fast public rooms.`
      }
    ];
  }

  private synthesizeSetup(
    raidCatalog: RevansRaidCatalogEntry,
    bestEval: RevansArchetypeEvaluationResult
  ): RevansSynthesizedOptimalSetup {
    const archDef =
      raidCatalog.archetypes.find(a => a.archetypeId === bestEval.archetypeId) ||
      raidCatalog.archetypes[0];

    const frontline = bestEval.characterSlots
      .filter(s => s.position === 'frontline')
      .map(
        s =>
          `${s.matchedCharacterName || `MISSING (${s.primaryCharacterName})`} [${s.slotRole}]`
      );
    const backline = bestEval.characterSlots
      .filter(s => s.position === 'backline')
      .map(
        s =>
          `${s.matchedCharacterName || `MISSING (${s.primaryCharacterName})`} [${s.slotRole}]`
      );

    const coreWeapons = bestEval.weaponSlots.map(
      w => `${w.matchedWeaponsSummary} (${w.roleLabel})`
    );

    const coveredCount = bestEval.omenCoverage.filter(o => o.covered).length;

    return {
      recommendedArchetypeId: bestEval.archetypeId,
      recommendedArchetypeName: bestEval.archetypeName,
      playstyle: bestEval.playstyle,
      mcClass: bestEval.mcMatchedClass || archDef.mcSpec.primaryClass,
      mcSkills: archDef.mcSpec.recommendedSkills,
      mainhandWeapon: bestEval.mainhandMatched || 'Element Mainhand',
      frontlineCharacters: frontline,
      backlineCharacters: backline,
      coreGridWeapons: coreWeapons,
      mainAndSupportSummons: `${bestEval.summonCheck.mainSummonMatched || 'Element Main'} x ${bestEval.summonCheck.supporterSummonMatched || 'Element Support'}`,
      subAuraSummons: bestEval.summonCheck.subAuraSummonsMatched,
      projectedPeakTurnDamage: bestEval.estimatedPeakBurstTurnDamage,
      projectedAverageTurnDamage: bestEval.estimatedAverageTurnDamage,
      projectedTurnsTo4MHonors: bestEval.estimatedTurnsTo4MHonors,
      omenCancelReadinessSummary: `${coveredCount}/${bestEval.omenCoverage.length} Core Omens Covered`,
      turnByTurnExecutionPlan: bestEval.recommendedTurnRotation
    };
  }

  private buildUpgradeRoadmap(
    raidCatalog: RevansRaidCatalogEntry,
    roster: RevansElementRosterInput,
    bestEval: RevansArchetypeEvaluationResult,
    gates: RevansHardGateCheckResult[]
  ): RevansUpgradeRecommendation[] {
    const recs: RevansUpgradeRecommendation[] = [];

    const hpGate = gates.find(g => g.gateId === 'gate_2_entry_and_trigger_hp');
    if (hpGate && !hpGate.passed) {
      recs.push({
        priority: 'CRITICAL',
        category: 'HP_Survivability',
        targetItem: `${raidCatalog.advantageousElement.toUpperCase()} Party HP (${roster.estimatedPartyHp.toLocaleString()} -> ${raidCatalog.minimumEntryHp.toLocaleString()}+)`,
        currentGap: hpGate.diagnosticMessage,
        actionableStep: `Add DEF-awakened Revans weapons, Dark Opus Lv200+, and Arcarum HP sub-aura summon.`,
        expectedHonorOrDamageGain: 'Prevents entry/trigger wipe and unlocks safe 4M Blue Chest farming.'
      });
    }

    for (const slot of bestEval.characterSlots) {
      if (slot.status === 'MISSING') {
        recs.push({
          priority: 'HIGH',
          category: 'Character',
          targetItem: slot.primaryCharacterName,
          currentGap: `Slot ${slot.slotNumber} (${slot.slotRole}) is missing.`,
          actionableStep: `Recruit or slot ${slot.primaryCharacterName} into your ${raidCatalog.advantageousElement} deck.`,
          expectedHonorOrDamageGain: '+25M-45M turn damage & core omen cancellation.'
        });
      }
    }

    for (const wSlot of bestEval.weaponSlots) {
      if (wSlot.status !== 'FULL_PRIMARY') {
        recs.push({
          priority: wSlot.status === 'MISSING' ? 'HIGH' : 'MEDIUM',
          category: 'Weapon_Grid',
          targetItem: `${wSlot.recommendedCopies}x ${wSlot.primaryWeaponName}`,
          currentGap: `Owned/slotted: ${wSlot.matchedWeaponsSummary}`,
          actionableStep: `Uncap and slot ${wSlot.recommendedCopies}x ${wSlot.primaryWeaponName} (${wSlot.roleLabel}).`,
          expectedHonorOrDamageGain: '+7% to +15% Grid Damage Cap & Supplemental Damage.'
        });
      }
    }

    if (recs.length === 0) {
      recs.push({
        priority: 'LOW',
        category: 'Weapon_Grid',
        targetItem: `${raidCatalog.signatureWeaponDrop.name} Awakening Lv15-20`,
        currentGap: 'Setup is already Grade SS/SSS ready for 4,000,000 Honors Blue Chest!',
        actionableStep: `Farm ${raidCatalog.raidName} Blue Chests to collect & awaken ${raidCatalog.signatureWeaponDrop.name}.`,
        expectedHonorOrDamageGain: 'Further optimizes Endgame Hexachromatic / Dark Rapture Zero grids.'
      });
    }

    return recs;
  }

  private computeGrade(
    score: number,
    allCriticalGatesPassed: boolean
  ): RevansReadinessGrade {
    if (!allCriticalGatesPassed || score < 60) return 'NOT_READY';
    if (score >= 95) return 'SSS';
    if (score >= 88) return 'SS';
    if (score >= 80) return 'S';
    if (score >= 72) return 'A';
    if (score >= 65) return 'B';
    return 'C';
  }

  public persistSingleRaidArtifacts(report: RevansSingleRaidReport): void {
    try {
      const dir = path.dirname(this.snapshotPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const singleMdPath = path.join(dir, `revans-${report.raidId}-readiness-report.md`);
      fs.writeFileSync(singleMdPath, this.formatSingleRaidMarkdownReport(report), 'utf-8');
    } catch {
      // ignore write errors in read-only environments
    }
  }

  public persistAllRaidsArtifacts(
    roster: RevansMultiElementRosterInput,
    summary: RevansAllRaidsSummaryReport
  ): void {
    try {
      const dir = path.dirname(this.snapshotPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.snapshotPath,
        JSON.stringify({ roster, summary }, null, 2),
        'utf-8'
      );
      fs.writeFileSync(
        this.markdownReportPath,
        this.formatAllRaidsMarkdownReport(summary),
        'utf-8'
      );
    } catch {
      // ignore write errors
    }
  }

  // ============================================================================
  // Console & Markdown Formatters
  // ============================================================================

  public formatSingleRaidConsoleReport(report: RevansSingleRaidReport): string {
    const lines: string[] = [];
    const sep = '='.repeat(88);
    const subSep = '-'.repeat(88);

    lines.push(sep);
    lines.push(
      `  REVANS SERIES READINESS CHECKER: ${report.raidName.toUpperCase()} [Quest ${report.questId}]`
    );
    lines.push(sep);
    lines.push(
      `  Account          : ${report.accountId} (${report.source})`
    );
    lines.push(
      `  Boss / Element   : ${report.bossName} (${report.bossElement.toUpperCase()}) -> Advantageous: ${report.advantageousElement.toUpperCase()}`
    );
    lines.push(
      `  Signature Drop   : ${report.signatureWeaponDrop}`
    );
    lines.push(
      `  Readiness Grade  : ${report.overallGrade} (${report.overallReadinessScore}/100) | 4M Blue Chest Ready: ${report.readyFor4MBlueChest ? 'YES' : 'NO'}`
    );
    lines.push(
      `  Element Max HP   : ${report.measuredElementMaxHp.toLocaleString()} HP (Min Required: ${report.minimumRequiredHp.toLocaleString()} HP)`
    );
    lines.push(
      `  Omen Coverage    : ${report.omenSolverCoverageRatio} Core Omens Covered`
    );
    lines.push(subSep);
    lines.push('  [1] HARD GATES');
    for (const gate of report.hardGateResults) {
      const icon = gate.passed ? 'PASS' : 'FAIL';
      lines.push(
        `    [${icon}] ${gate.name}: ${gate.measuredValue} (Req: ${gate.requiredThreshold})`
      );
    }

    const setup = report.synthesizedOptimalSetup;
    lines.push(subSep);
    lines.push(
      `  [2] RECOMMENDED PARTY & GRID: ${setup.recommendedArchetypeName} (${setup.playstyle})`
    );
    lines.push(`    MC Class & Skills : ${setup.mcClass} (${setup.mcSkills.join(', ')})`);
    lines.push(`    Mainhand Weapon   : ${setup.mainhandWeapon}`);
    lines.push(`    Frontline         : ${setup.frontlineCharacters.join(' | ')}`);
    lines.push(`    Backline          : ${setup.backlineCharacters.join(' | ')}`);
    lines.push(`    Core Grid Weapons :`);
    for (const w of setup.coreGridWeapons) {
      lines.push(`      - ${w}`);
    }
    lines.push(`    Summons (Main/Sub): ${setup.mainAndSupportSummons} | Sub-Auras: ${setup.subAuraSummons.join(', ') || 'None'}`);
    lines.push(
      `    Pacing Projection : ~${(setup.projectedAverageTurnDamage / 1000000).toFixed(1)}M avg/turn (~${(setup.projectedPeakTurnDamage / 1000000).toFixed(1)}M peak) -> ~${setup.projectedTurnsTo4MHonors} turns to 4,000,000 Honors`
    );

    lines.push(subSep);
    lines.push('  [3] TURN-BY-TURN 4M HONORS BLUE CHEST ROTATION');
    for (const step of setup.turnByTurnExecutionPlan) {
      lines.push(`    * ${step}`);
    }

    lines.push(subSep);
    lines.push('  [4] CORE OMEN & GIMMICK SOLVER BREAKDOWN');
    for (const omen of report.bestArchetypeEvaluation.omenCoverage) {
      const badge = omen.covered ? 'COVERED' : 'CAUTION';
      lines.push(
        `    [${badge}] ${omen.trigger} - ${omen.omenName}: ${omen.cancelCondition}`
      );
    }

    lines.push(sep);
    return lines.join('\n');
  }

  public formatAllRaidsConsoleReport(summary: RevansAllRaidsSummaryReport): string {
    const lines: string[] = [];
    const sep = '='.repeat(96);
    const subSep = '-'.repeat(96);

    lines.push(sep);
    lines.push(
      `  UNIVERSAL REVANS SERIES (IMPOSSIBLE) Lv275 READINESS MATRIX — ACCOUNT: ${summary.accountId.toUpperCase()} (${summary.source})`
    );
    lines.push(sep);
    lines.push(
      `  4M Blue Chest Ready Raids : ${summary.readyRaidsCount}/${summary.totalRaidsEvaluated}  |  Average Readiness Score : ${summary.averageReadinessScore}/100`
    );
    lines.push(
      `  Recommended Farming Order : ${summary.recommendedFarmingOrder.map(id => `${id.toUpperCase()} (${summary.raidReports[id].overallGrade}:${summary.raidReports[id].overallReadinessScore})`).join(' -> ')}`
    );
    lines.push(subSep);
    lines.push(
      '  RAID                   ELEMENT       GRADE (SCORE)   MAX HP (REQ)        4M TURNS   OMENS   STATUS'
    );
    lines.push(subSep);

    for (const raidId of ALL_REVANS_RAID_IDS) {
      const r = summary.raidReports[raidId];
      const raidCol = r.raidName.padEnd(22, ' ');
      const elCol = `${r.advantageousElement.toUpperCase()} vs ${r.bossElement.toUpperCase()}`.padEnd(13, ' ');
      const gradeCol = `${r.overallGrade} (${r.overallReadinessScore}/100)`.padEnd(15, ' ');
      const hpCol = `${r.measuredElementMaxHp.toLocaleString()} (${(r.minimumRequiredHp / 1000).toFixed(0)}k)`.padEnd(19, ' ');
      const turnsCol = `~${r.synthesizedOptimalSetup.projectedTurnsTo4MHonors}T`.padEnd(10, ' ');
      const omenCol = r.omenSolverCoverageRatio.padEnd(7, ' ');
      const statusCol = r.readyFor4MBlueChest ? 'READY (4M BLUE CHEST)' : 'NEEDS SETUP';
      lines.push(`  ${raidCol} ${elCol} ${gradeCol} ${hpCol} ${turnsCol} ${omenCol} ${statusCol}`);
    }

    lines.push(sep);

    for (const raidId of ALL_REVANS_RAID_IDS) {
      lines.push('');
      lines.push(this.formatSingleRaidConsoleReport(summary.raidReports[raidId]));
    }

    return lines.join('\n');
  }

  public formatSingleRaidMarkdownReport(report: RevansSingleRaidReport): string {
    const setup = report.synthesizedOptimalSetup;
    const lines: string[] = [
      `# Revans Readiness Report: ${report.raidName}`,
      `- **Account**: \`${report.accountId}\` (\`${report.source}\`)`,
      `- **Boss / Quest ID**: ${report.bossName} (\`${report.questId}\`, Stage \`${report.stageId}\`)`,
      `- **Element Matchup**: **${report.advantageousElement.toUpperCase()}** Party vs **${report.bossElement.toUpperCase()}** Boss`,
      `- **Signature Drop**: ${report.signatureWeaponDrop}`,
      `- **Overall Readiness**: **${report.overallGrade} (${report.overallReadinessScore}/100)** — 4M Blue Chest Ready: **${report.readyFor4MBlueChest ? 'YES' : 'NO'}**`,
      `- **Measured Max HP**: **${report.measuredElementMaxHp.toLocaleString()} HP** (Minimum Required: ${report.minimumRequiredHp.toLocaleString()} HP)`,
      '',
      '## Hard Gates',
      '| Gate | Status | Measured | Requirement |',
      '| :--- | :---: | :--- | :--- |'
    ];

    for (const g of report.hardGateResults) {
      lines.push(
        `| ${g.name} | ${g.passed ? 'PASS' : 'FAIL'} | ${g.measuredValue} | ${g.requiredThreshold} |`
      );
    }

    lines.push(
      '',
      `## Synthesized Optimal Party: ${setup.recommendedArchetypeName}`,
      `- **MC Class**: \`${setup.mcClass}\` (${setup.mcSkills.join(', ')})`,
      `- **Mainhand**: \`${setup.mainhandWeapon}\``,
      `- **Frontline**: ${setup.frontlineCharacters.join(' | ')}`,
      `- **Backline**: ${setup.backlineCharacters.join(' | ')}`,
      `- **Core Grid Weapons**: ${setup.coreGridWeapons.join('; ')}`,
      `- **Summons**: ${setup.mainAndSupportSummons} (Sub-Auras: ${setup.subAuraSummons.join(', ')})`,
      `- **Projected Pacing**: ~${setup.projectedTurnsTo4MHonors} turns to 4,000,000 Honors`,
      '',
      '## Turn-by-Turn Execution Plan'
    );

    for (const step of setup.turnByTurnExecutionPlan) {
      lines.push(`- ${step}`);
    }

    return lines.join('\n');
  }

  public formatAllRaidsMarkdownReport(summary: RevansAllRaidsSummaryReport): string {
    const lines: string[] = [
      `# Universal Revans Series (Impossible) Lv275 Readiness Report — \`${summary.accountId}\``,
      `- **Generated At**: ${summary.timestamp}`,
      `- **Source**: \`${summary.source}\``,
      `- **Ready Raids**: **${summary.readyRaidsCount}/${summary.totalRaidsEvaluated}**`,
      `- **Average Score**: **${summary.averageReadinessScore}/100**`,
      `- **Recommended Farming Order**: ${summary.recommendedFarmingOrder.map(r => `\`${r}\``).join(' -> ')}`,
      '',
      '## 6-Raid Executive Matrix',
      '| Raid | Matchup | Grade (Score) | Max HP (Req) | 4M Turns | Omens Covered | Status |',
      '| :--- | :--- | :---: | :--- | :---: | :---: | :--- |'
    ];

    for (const raidId of ALL_REVANS_RAID_IDS) {
      const r = summary.raidReports[raidId];
      lines.push(
        `| **${r.raidName}** | ${r.advantageousElement.toUpperCase()} vs ${r.bossElement.toUpperCase()} | **${r.overallGrade} (${r.overallReadinessScore}/100)** | ${r.measuredElementMaxHp.toLocaleString()} (${r.minimumRequiredHp.toLocaleString()}) | ~${r.synthesizedOptimalSetup.projectedTurnsTo4MHonors}T | ${r.omenSolverCoverageRatio} | ${r.readyFor4MBlueChest ? 'READY' : 'NEEDS SETUP'} |`
      );
    }

    for (const raidId of ALL_REVANS_RAID_IDS) {
      lines.push('', '---', '', this.formatSingleRaidMarkdownReport(summary.raidReports[raidId]));
    }

    return lines.join('\n');
  }
}

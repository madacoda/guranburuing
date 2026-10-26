// src/services/combat/siete-readiness-checker.service.ts
import fs from 'fs';
import path from 'path';
import { Page } from 'puppeteer-core';
import {
  DataCatalogService,
  SieteCharacterRegistryItem,
  SietePartyArchetypeDefinition,
  SieteSummonRegistryItem,
  SieteWeaponRegistryItem
} from '../../domain/data/index.js';
import {
  SieteArchetypeEvaluationResult,
  SieteCharacterSlotCheckResult,
  SieteDamageAndHonorProjection,
  SieteHardGateCheckResult,
  SietePlayerCharacterItem,
  SietePlayerRosterInput,
  SietePlayerSummonItem,
  SietePlayerWeaponItem,
  SieteReadinessGrade,
  SieteReadinessReport,
  SieteSummonCheckResult,
  SieteSynthesizedOptimalSetup,
  SieteUpgradeRecommendation,
  SieteWeaponSlotCheckResult
} from '../../domain/siete/index.js';

export interface SieteReadinessLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

interface ResolvedOwnedCharacter {
  raw: SietePlayerCharacterItem;
  catalog: SieteCharacterRegistryItem;
  isFire: boolean;
  meetsFlbAndFourthSkill: boolean;
}

interface ResolvedOwnedWeapon {
  raw: SietePlayerWeaponItem;
  catalog: SieteWeaponRegistryItem;
  copies: number;
}

interface ResolvedOwnedSummon {
  raw: SietePlayerSummonItem;
  catalog: SieteSummonRegistryItem;
}

/**
 * SieteReadinessCheckerService
 *
 * Automated Readiness Evaluator & Party Synthesizer for Seofon (Impossible) / Siete HL
 * 4,000,000 Honors (~400,000,000 Damage) Blue Chest farming and 77,777,777 Omen Cancellation.
 */
export class SieteReadinessCheckerService {
  private readonly catalog: DataCatalogService;
  private readonly logger?: SieteReadinessLogger;
  private readonly snapshotPath: string;
  private readonly markdownReportPath: string;

  constructor(catalog?: DataCatalogService, logger?: SieteReadinessLogger, logsDir?: string) {
    this.catalog = catalog || DataCatalogService.getInstance();
    this.logger = logger;
    const baseLogsDir = logsDir || path.resolve(process.cwd(), 'logs');
    this.snapshotPath = path.join(baseLogsDir, 'siete-readiness-snapshot.json');
    this.markdownReportPath = path.join(baseLogsDir, 'siete-readiness-report.md');
  }

  /**
   * Loads a player roster JSON file from disk (matching data/schemas/siete-roster.schema.json).
   */
  public loadRosterFromFile(filePath: string): SietePlayerRosterInput {
    const resolved = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Siete roster file not found at: ${resolved}`);
    }
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as SietePlayerRosterInput;
    return {
      ...raw,
      source: raw.source || 'roster_config',
      characters: Array.isArray(raw.characters) ? raw.characters : [],
      weapons: Array.isArray(raw.weapons) ? raw.weapons : [],
      summons: Array.isArray(raw.summons) ? raw.summons : []
    };
  }

  /**
   * Scrapes the active Fire party, characters, weapon grid, and summons from a live GBF CDP page,
   * falling back to cached snapshot or reference roster if offline.
   */
  public async auditFromLiveCdpPage(page: Page, accountId: string = 'acc1'): Promise<SieteReadinessReport> {
    this.logger?.info?.(`[SieteChecker] Auditing live in-game Fire party & grid for [${accountId}]...`);

    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('#party/index')) {
        await page.goto('https://game.granbluefantasy.jp/#party/index/0/npc/0', {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await new Promise(resolve => setTimeout(resolve, 2500));
      }

      const scraped = await page.evaluate(() => {
        const result: {
          activeMcClass: string;
          estimatedPartyHp: number;
          characters: Array<{
            npcId?: string;
            name: string;
            element?: string;
            level?: number;
            uncapStars?: number;
            hasFourthSkill?: boolean;
            slotPosition?: 'frontline_1' | 'frontline_2' | 'frontline_3' | 'backline_1' | 'backline_2' | 'inventory';
          }>;
          weapons: Array<{
            weaponId?: string;
            name: string;
            copies: number;
            level?: number;
            isMainhand?: boolean;
          }>;
          summons: Array<{
            summonId?: string;
            name: string;
            level?: number;
            slotRole?: 'main' | 'supporter' | 'sub' | 'sub_aura' | 'inventory';
          }>;
        } = {
          activeMcClass: '',
          estimatedPartyHp: 0,
          characters: [],
          weapons: [],
          summons: []
        };

        const ELEMENT_MAP: Record<string, string> = {
          '1': 'fire',
          '2': 'water',
          '3': 'earth',
          '4': 'wind',
          '5': 'light',
          '6': 'dark'
        };

        try {
          const g = (window as any).Game;
          const deck = g?.view?.deck_model?.attributes?.deck || g?.view?.deck_model?.attributes;
          if (deck) {
            const pc = deck.pc || {};
            if (pc.job?.master?.name) {
              result.activeMcClass = String(pc.job.master.name);
            }
            if (pc.param?.hp) {
              result.estimatedPartyHp = Number(pc.param.hp) || 0;
            }

            // Characters from deck.npc
            const npcs = deck.npc || {};
            const slotOrder: Array<'frontline_1' | 'frontline_2' | 'frontline_3' | 'backline_1' | 'backline_2'> = [
              'frontline_1',
              'frontline_2',
              'frontline_3',
              'backline_1',
              'backline_2'
            ];
            Object.values(npcs).forEach((npcObj: any, idx: number) => {
              const master = npcObj?.master;
              const param = npcObj?.param;
              if (master && master.name) {
                const attr = String(master.attribute || param?.attribute || '1');
                const lvl = Number(param?.level || 80);
                const evo = Number(param?.evolution || 4);
                result.characters.push({
                  npcId: String(master.id || ''),
                  name: String(master.name),
                  element: ELEMENT_MAP[attr] || 'fire',
                  level: lvl,
                  uncapStars: evo,
                  hasFourthSkill: lvl >= 100 || evo >= 5,
                  slotPosition: slotOrder[idx] || 'inventory'
                });
              }
            });

            // Weapons from pc.weapons
            const weapons = pc.weapons || {};
            const weaponCountByKey = new Map<string, { weaponId?: string; name: string; copies: number; level?: number; isMainhand?: boolean }>();
            Object.entries(weapons).forEach(([slotKey, wpnObj]: [string, any]) => {
              const master = wpnObj?.master;
              const param = wpnObj?.param;
              if (master && master.name) {
                const wId = String(master.id || '');
                const wName = String(master.name);
                const key = wId || wName;
                const existing = weaponCountByKey.get(key);
                if (existing) {
                  existing.copies += 1;
                } else {
                  weaponCountByKey.set(key, {
                    weaponId: wId,
                    name: wName,
                    copies: 1,
                    level: Number(param?.level || 150),
                    isMainhand: slotKey === '1' || slotKey === 'main'
                  });
                }
              }
            });
            result.weapons.push(...Array.from(weaponCountByKey.values()));

            // Summons from pc.summons & pc.sub_summons
            const summons = pc.summons || {};
            Object.entries(summons).forEach(([slotKey, sumObj]: [string, any]) => {
              const master = sumObj?.master;
              const param = sumObj?.param;
              if (master && master.name) {
                result.summons.push({
                  summonId: String(master.id || ''),
                  name: String(master.name),
                  level: Number(param?.level || 150),
                  slotRole: slotKey === '1' ? 'main' : 'sub'
                });
              }
            });

            const subSummons = pc.sub_summons || {};
            Object.values(subSummons).forEach((sumObj: any) => {
              const master = sumObj?.master;
              const param = sumObj?.param;
              if (master && master.name) {
                result.summons.push({
                  summonId: String(master.id || ''),
                  name: String(master.name),
                  level: Number(param?.level || 150),
                  slotRole: 'sub_aura'
                });
              }
            });
          }
        } catch {
          // Fallback to DOM inspection below
        }

        // DOM Fallback if deck_model was not populated
        if (result.characters.length === 0) {
          document.querySelectorAll('.prt-deck-npc .lis-character, .cnt-party .lis-character').forEach((el, idx) => {
            const name = el.getAttribute('data-name') || el.getAttribute('title') || el.textContent?.trim() || '';
            const npcId = el.getAttribute('data-id') || el.getAttribute('data-image-id') || '';
            if (name || npcId) {
              const slotOrder: Array<'frontline_1' | 'frontline_2' | 'frontline_3' | 'backline_1' | 'backline_2'> = [
                'frontline_1',
                'frontline_2',
                'frontline_3',
                'backline_1',
                'backline_2'
              ];
              result.characters.push({
                npcId: npcId || undefined,
                name: name || npcId,
                element: 'fire',
                level: 100,
                uncapStars: 5,
                hasFourthSkill: true,
                slotPosition: slotOrder[idx] || 'inventory'
              });
            }
          });
        }

        return result;
      });

      if (scraped.characters.length > 0 || scraped.weapons.length > 0) {
        const rosterInput: SietePlayerRosterInput = {
          version: '2.0.0',
          generatedAt: new Date().toISOString(),
          description: `Live CDP scraped Fire party & roster for ${accountId}`,
          accountId,
          source: 'cdp_live',
          activeMcClass: scraped.activeMcClass || 'Manadiver',
          estimatedPartyHp: scraped.estimatedPartyHp || undefined,
          characters: scraped.characters,
          weapons: scraped.weapons,
          summons: scraped.summons
        };
        const report = this.evaluateRoster(rosterInput);
        this.persistReportArtifacts(rosterInput, report);
        return report;
      }
    } catch (err: any) {
      this.logger?.warn?.(`[SieteChecker] Live CDP scrape encountered an error (${err.message}); falling back to cached/example roster.`);
    }

    // Fallback to cached snapshot or reference roster
    const fallbackPath = fs.existsSync(this.snapshotPath)
      ? this.snapshotPath
      : path.resolve(process.cwd(), 'data/combat/siete-roster.example.json');
    const fallbackRoster = this.loadRosterFromFile(fallbackPath);
    fallbackRoster.accountId = accountId;
    fallbackRoster.source = 'cached_snapshot';
    const report = this.evaluateRoster(fallbackRoster);
    this.persistReportArtifacts(fallbackRoster, report);
    return report;
  }

  /**
   * Evaluates a player's Fire roster, weapon grid, summons, and MC class against all 5 Siete 4M Honors archetypes.
   */
  public evaluateRoster(
    roster: SietePlayerRosterInput,
    preferredArchetypeId?: string
  ): SieteReadinessReport {
    const raidSpec = this.catalog.getSieteRaidSpecification();
    const thresholds = this.catalog.getSieteReadinessThresholds();
    const archetypes = this.catalog.getAllSietePartyArchetypes();

    if (!raidSpec || !thresholds || archetypes.length === 0) {
      throw new Error('Siete Party Compositions catalog is not loaded in DataCatalogService.');
    }

    // 1. Resolve all owned characters, weapons, and summons against the catalog
    const resolvedCharacters = this.resolveOwnedCharacters(roster.characters || []);
    const resolvedWeapons = this.resolveOwnedWeapons(roster.weapons || []);
    const resolvedSummons = this.resolveOwnedSummons(roster.summons || []);

    // 2. Evaluate all 5 Siete Party Archetypes
    const allEvaluations = archetypes.map(arch =>
      this.evaluateSingleArchetype(
        arch,
        roster,
        resolvedCharacters,
        resolvedWeapons,
        resolvedSummons
      )
    );

    // Sort archetypes by overallScore descending (or pick preferredArchetypeId if specified)
    const sortedEvaluations = [...allEvaluations].sort((a, b) => {
      if (b.overallScore !== a.overallScore) {
        return b.overallScore - a.overallScore;
      }
      return b.damageProjection.estimatedPeakBurstTurnDamage - a.damageProjection.estimatedPeakBurstTurnDamage;
    });

    const bestEval = preferredArchetypeId
      ? sortedEvaluations.find(e => e.archetypeId.toLowerCase() === preferredArchetypeId.toLowerCase()) || sortedEvaluations[0]!
      : sortedEvaluations[0]!;

    // 3. Evaluate the 4 Seofon Hard Gates against the roster and best archetype
    const hardGateResults = this.evaluateHardGates(
      roster,
      resolvedCharacters,
      bestEval
    );
    const allCriticalGatesPassed = hardGateResults
      .filter(g => g.severity === 'CRITICAL_BLOCKER')
      .every(g => g.passed);

    // If any CRITICAL_BLOCKER gate failed, cap readiness
    const overallScore = allCriticalGatesPassed
      ? bestEval.overallScore
      : Math.min(bestEval.overallScore, 45);
    const overallGrade = allCriticalGatesPassed
      ? this.scoreToGrade(overallScore)
      : 'NOT_READY';
    const readyFor4MBlueChest =
      allCriticalGatesPassed &&
      bestEval.isReadyFor4MBlueChest &&
      overallScore >= thresholds.grades.B;

    // 4. Synthesize Optimal Party & Grid from Owned Inventory
    const bestArchetypeDef =
      this.catalog.getSietePartyArchetype(bestEval.archetypeId) || archetypes[0]!;
    const synthesizedOptimalSetup = this.synthesizeOptimalSetup(
      bestArchetypeDef,
      bestEval,
      roster
    );

    // 5. Generate Prioritized Upgrade Roadmap
    const upgradeRoadmap = this.generateUpgradeRoadmap(
      roster,
      resolvedCharacters,
      resolvedWeapons,
      resolvedSummons,
      bestArchetypeDef,
      bestEval,
      hardGateResults
    );

    return {
      timestamp: new Date().toISOString(),
      accountId: roster.accountId || 'acc1',
      source: roster.source || 'roster_config',
      raidName: raidSpec.name,
      questId: raidSpec.questId,
      blueChestTargetHonors: raidSpec.blueChestTargetHonors,
      equivalentTargetDamage: raidSpec.equivalentTotalDamage,
      universalOmenCancelDamage: raidSpec.universalOmenCancelDamage,
      overallReadinessScore: overallScore,
      overallGrade,
      readyFor4MBlueChest,
      canCancel77M7Omen: bestEval.damageProjection.clears77M7EmblemaOmen && allCriticalGatesPassed,
      hardGateResults,
      allCriticalGatesPassed,
      bestArchetypeEvaluation: bestEval,
      allArchetypeEvaluations: sortedEvaluations,
      synthesizedOptimalSetup,
      upgradeRoadmap
    };
  }

  /**
   * Persists the evaluated roster and markdown report to logs/.
   */
  public persistReportArtifacts(roster: SietePlayerRosterInput, report: SieteReadinessReport): void {
    try {
      const dir = path.dirname(this.snapshotPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.snapshotPath,
        JSON.stringify({ roster, report }, null, 2),
        'utf-8'
      );
      fs.writeFileSync(
        this.markdownReportPath,
        this.formatMarkdownReport(report),
        'utf-8'
      );
    } catch (err: any) {
      this.logger?.warn?.(`[SieteChecker] Could not write report artifacts: ${err.message}`);
    }
  }

  // ============================================================================
  // INTERNAL RESOLUTION & MATCHING ENGINE
  // ============================================================================

  public resolveCharacterCatalogEntry(item: SietePlayerCharacterItem): SieteCharacterRegistryItem | undefined {
    const candidates = [item.id, item.npcId, item.name].filter(Boolean) as string[];
    for (const key of candidates) {
      const exact = this.catalog.getSieteCharacter(key);
      if (exact) return exact;
    }

    // Normalized fuzzy match against all Siete characters
    const normalizedInput = this.normalizeToken(item.name);
    if (!normalizedInput) return undefined;

    for (const c of this.catalog.getAllSieteCharacters()) {
      const normName = this.normalizeToken(c.name);
      if (normName === normalizedInput || normName.includes(normalizedInput) || normalizedInput.includes(normName)) {
        return c;
      }
      for (const alias of c.aliases) {
        const normAlias = this.normalizeToken(alias);
        if (normAlias === normalizedInput || (normAlias.length >= 4 && normalizedInput.includes(normAlias))) {
          return c;
        }
      }
    }
    return undefined;
  }

  public resolveWeaponCatalogEntry(item: SietePlayerWeaponItem): SieteWeaponRegistryItem | undefined {
    const candidates = [item.id, item.weaponId, item.name].filter(Boolean) as string[];
    for (const key of candidates) {
      const exact = this.catalog.getSieteWeapon(key);
      if (exact) return exact;
    }

    const normalizedInput = this.normalizeToken(item.name);
    if (!normalizedInput) return undefined;

    for (const w of this.catalog.getAllSieteWeapons()) {
      const normName = this.normalizeToken(w.name);
      if (normName === normalizedInput || normName.includes(normalizedInput) || normalizedInput.includes(normName)) {
        return w;
      }
      for (const alias of w.aliases) {
        const normAlias = this.normalizeToken(alias);
        if (normAlias === normalizedInput || (normAlias.length >= 4 && normalizedInput.includes(normAlias))) {
          return w;
        }
      }
    }
    return undefined;
  }

  public resolveSummonCatalogEntry(item: SietePlayerSummonItem): SieteSummonRegistryItem | undefined {
    const candidates = [item.id, item.summonId, item.name].filter(Boolean) as string[];
    for (const key of candidates) {
      const exact = this.catalog.getSieteSummon(key);
      if (exact) return exact;
    }

    const normalizedInput = this.normalizeToken(item.name);
    if (!normalizedInput) return undefined;

    for (const s of this.catalog.getAllSieteSummons()) {
      const normName = this.normalizeToken(s.name);
      if (normName === normalizedInput || normName.includes(normalizedInput) || normalizedInput.includes(normName)) {
        return s;
      }
      for (const alias of s.aliases) {
        const normAlias = this.normalizeToken(alias);
        if (normAlias === normalizedInput || (normAlias.length >= 3 && normalizedInput.includes(normAlias))) {
          return s;
        }
      }
    }
    return undefined;
  }

  private resolveOwnedCharacters(items: SietePlayerCharacterItem[]): ResolvedOwnedCharacter[] {
    const results: ResolvedOwnedCharacter[] = [];
    for (const raw of items) {
      const isFire = this.isCharacterFireElement(raw);
      const catalog = this.resolveCharacterCatalogEntry(raw);
      if (catalog && isFire) {
        const level = raw.level ?? catalog.minLevelRequired;
        const stars = raw.uncapStars ?? (catalog.requiresFlb ? 5 : 4);
        const meetsLevel = level >= catalog.minLevelRequired;
        const meetsFlb = !catalog.requiresFlb || stars >= 5 || level >= 100;
        const meetsFourth =
          !catalog.requiresFourthSkill ||
          raw.hasFourthSkill === true ||
          (raw.hasFourthSkill !== false && (level >= 100 || stars >= 5));

        results.push({
          raw,
          catalog,
          isFire,
          meetsFlbAndFourthSkill: meetsLevel && meetsFlb && meetsFourth
        });
      }
    }
    return results;
  }

  private resolveOwnedWeapons(items: SietePlayerWeaponItem[]): ResolvedOwnedWeapon[] {
    const mergedById = new Map<string, ResolvedOwnedWeapon>();
    for (const raw of items) {
      const catalog = this.resolveWeaponCatalogEntry(raw);
      if (catalog) {
        const copies = Math.max(1, raw.copies ?? 1);
        const existing = mergedById.get(catalog.id);
        if (existing) {
          existing.copies += copies;
          if (raw.isMainhand) existing.raw.isMainhand = true;
        } else {
          mergedById.set(catalog.id, {
            raw: { ...raw },
            catalog,
            copies
          });
        }
      }
    }
    return Array.from(mergedById.values());
  }

  private resolveOwnedSummons(items: SietePlayerSummonItem[]): ResolvedOwnedSummon[] {
    const mergedById = new Map<string, ResolvedOwnedSummon>();
    for (const raw of items) {
      const catalog = this.resolveSummonCatalogEntry(raw);
      if (catalog && !mergedById.has(catalog.id)) {
        mergedById.set(catalog.id, { raw, catalog });
      }
    }
    return Array.from(mergedById.values());
  }

  private isCharacterFireElement(char: SietePlayerCharacterItem): boolean {
    if (char.element) {
      return char.element.trim().toLowerCase() === 'fire';
    }
    const lowerName = char.name.toLowerCase();
    const nonFireIndicators = [
      'water',
      'earth',
      'wind',
      'light',
      'dark',
      'seox',
      'fediel',
      'lich',
      'bowman',
      'nehan',
      'florence',
      'haaselia',
      'payila',
      'poseidon',
      'galleon',
      'caim',
      'narmaya (grand)',
      'charlotta (grand)',
      'siete',
      'seofon'
    ];
    if (nonFireIndicators.some(ind => lowerName.includes(ind))) {
      return false;
    }
    return true;
  }

  // ============================================================================
  // ARCHETYPE EVALUATOR
  // ============================================================================

  private evaluateSingleArchetype(
    archetype: SietePartyArchetypeDefinition,
    roster: SietePlayerRosterInput,
    ownedChars: ResolvedOwnedCharacter[],
    ownedWeapons: ResolvedOwnedWeapon[],
    ownedSummons: ResolvedOwnedSummon[]
  ): SieteArchetypeEvaluationResult {
    const missingRequirements: string[] = [];

    // 1. Evaluate MC Class (Weight: 10%)
    const mcEval = this.evaluateMcClass(archetype, roster);
    if (mcEval.status === 'MISSING') {
      missingRequirements.push(
        `Unlock MC Class ${archetype.mcRequirement.primaryClass} (or ${archetype.mcRequirement.alternativeClasses.join(' / ')})`
      );
    }

    // 2. Evaluate Character Slots (Frontline 1-3 & Backline 4-5) without duplicate assignment (Weight: 45%)
    const usedCharIds = new Set<string>();
    const characterSlots: SieteCharacterSlotCheckResult[] = [];

    for (const slot of archetype.frontlineSlots) {
      const slotRes = this.evaluateCharacterSlot(slot, 'frontline', ownedChars, usedCharIds);
      characterSlots.push(slotRes);
      if (slotRes.status === 'MISSING') {
        missingRequirements.push(`Frontline Slot ${slot.slotNumber} (${slot.slotRole}): Missing ${slotRes.primaryCharacterName}`);
      } else if (!slotRes.meetsLevelAndUncap && slotRes.matchedCharacterName) {
        missingRequirements.push(`Uncap ${slotRes.matchedCharacterName} to Lv100+ / FLB 4th Skill`);
      }
    }

    for (const slot of archetype.backlineSlots) {
      const slotRes = this.evaluateCharacterSlot(slot, 'backline', ownedChars, usedCharIds);
      characterSlots.push(slotRes);
      if (slotRes.status === 'MISSING') {
        missingRequirements.push(`Backline Slot ${slot.slotNumber} (${slot.slotRole}): Missing ${slotRes.primaryCharacterName}`);
      }
    }

    // Frontline slots carry 80% of character weight, backline slots carry 20%
    const frontlineAvg =
      characterSlots
        .filter(s => s.position === 'frontline')
        .reduce((sum, s) => sum + s.compatibilityScore, 0) /
      Math.max(1, archetype.frontlineSlots.length);
    const backlineAvg =
      characterSlots
        .filter(s => s.position === 'backline')
        .reduce((sum, s) => sum + s.compatibilityScore, 0) /
      Math.max(1, archetype.backlineSlots.length);
    const characterScore = Math.round(frontlineAvg * 0.8 + backlineAvg * 0.2);

    // 3. Evaluate Weapon Grid & Resonator / Pact Conditions (Weight: 35%)
    const weaponEval = this.evaluateWeaponGrid(archetype, ownedWeapons);
    for (const wSlot of weaponEval.weaponSlots) {
      if (wSlot.status === 'MISSING') {
        missingRequirements.push(`Weapon Grid (${wSlot.roleLabel}): Missing ${wSlot.primaryWeaponName}`);
      } else if (!wSlot.resonatorConditionMet) {
        missingRequirements.push(
          `Resonator Condition: Equip at least 4 weapons of the same type (e.g. 4 Sabres) to activate Lord of Flames`
        );
      }
    }
    if (!weaponEval.mainhandMatched) {
      missingRequirements.push(
        `Mainhand Weapon: Missing recommended mainhand for ${archetype.mcRequirement.primaryClass}`
      );
    }

    // 4. Evaluate Summons & Sub-Auras under Turn-1 99T Lock (Weight: 10%)
    const summonCheck = this.evaluateSummons(archetype, ownedSummons);
    if (!summonCheck.mainSummonMatched) {
      missingRequirements.push(`Main Summon: Equip Agni, Colossus Ira Omega, or Beelzebub`);
    }
    for (const missingSub of summonCheck.missingSubAuraSummons) {
      missingRequirements.push(`Sub-Aura Summon: Missing ${missingSub}`);
    }

    // 5. Compute Weighted Overall Score (45% Characters, 35% Weapons, 10% Summons, 10% MC)
    const overallScore = Math.round(
      characterScore * 0.45 +
        weaponEval.weaponScore * 0.35 +
        summonCheck.summonScore * 0.1 +
        mcEval.score * 0.1
    );

    // 6. Compute Mathematical Damage & Honor Projection
    const damageProjection = this.computeDamageAndHonorProjection(
      archetype,
      roster,
      characterSlots,
      ownedChars,
      ownedWeapons,
      weaponEval.weaponSlots,
      summonCheck,
      mcEval.score
    );

    const grade = this.scoreToGrade(overallScore);
    const isReadyFor4MBlueChest =
      overallScore >= 50 &&
      damageProjection.meets4MHonorsTarget &&
      damageProjection.estimatedPartyHp >= Math.min(45000, archetype.minRecommendedHp);

    return {
      archetypeId: archetype.archetypeId,
      archetypeName: archetype.name,
      playstyle: archetype.playstyle,
      overallScore,
      grade,
      isReadyFor4MBlueChest,
      mcScore: mcEval.score,
      mcMatchedClass: mcEval.matchedClass,
      mcStatus: mcEval.status,
      characterScore,
      characterSlots,
      weaponScore: weaponEval.weaponScore,
      mainhandMatched: weaponEval.mainhandMatched,
      weaponSlots: weaponEval.weaponSlots,
      summonCheck,
      damageProjection,
      recommendedTurnRotation: archetype.turnRotation,
      missingRequirements
    };
  }

  private evaluateMcClass(
    archetype: SietePartyArchetypeDefinition,
    roster: SietePlayerRosterInput
  ): { score: number; matchedClass: string | null; status: 'PRIMARY' | 'ALTERNATIVE' | 'MISSING' } {
    const ownedClasses = new Set<string>();
    if (roster.activeMcClass) {
      ownedClasses.add(roster.activeMcClass.trim().toLowerCase());
    }
    for (const c of roster.mcClassesUnlocked || []) {
      ownedClasses.add(c.trim().toLowerCase());
    }

    const primary = archetype.mcRequirement.primaryClass;
    if (ownedClasses.has(primary.toLowerCase())) {
      const isCurrentlyActive =
        !roster.activeMcClass || roster.activeMcClass.trim().toLowerCase() === primary.toLowerCase();
      return {
        score: isCurrentlyActive ? 100 : 95,
        matchedClass: primary,
        status: 'PRIMARY'
      };
    }

    for (const alt of archetype.mcRequirement.alternativeClasses) {
      if (ownedClasses.has(alt.toLowerCase())) {
        return {
          score: 85,
          matchedClass: alt,
          status: 'ALTERNATIVE'
        };
      }
    }

    return {
      score: 25,
      matchedClass: null,
      status: 'MISSING'
    };
  }

  private evaluateCharacterSlot(
    slot: SietePartyArchetypeDefinition['frontlineSlots'][number],
    position: 'frontline' | 'backline',
    ownedChars: ResolvedOwnedCharacter[],
    usedCharIds: Set<string>
  ): SieteCharacterSlotCheckResult {
    const primaryCat = this.catalog.getSieteCharacter(slot.primaryCharacterId);
    const primaryName = primaryCat?.name || slot.primaryCharacterId;

    // 1. Check Primary Character
    const ownedPrimary = ownedChars.find(
      c => c.catalog.id === slot.primaryCharacterId && !usedCharIds.has(c.catalog.id)
    );
    if (ownedPrimary) {
      usedCharIds.add(ownedPrimary.catalog.id);
      const flbPenalty = ownedPrimary.meetsFlbAndFourthSkill ? 1.0 : 0.72;
      const compatibilityScore = Math.round(100 * flbPenalty);
      return {
        slotNumber: slot.slotNumber,
        slotRole: slot.slotRole,
        position,
        primaryCharacterId: slot.primaryCharacterId,
        primaryCharacterName: primaryName,
        status: 'PRIMARY_MATCH',
        matchedCharacterId: ownedPrimary.catalog.id,
        matchedCharacterName: ownedPrimary.catalog.name,
        compatibilityScore,
        meetsLevelAndUncap: ownedPrimary.meetsFlbAndFourthSkill,
        estimatedTurnDamage: Math.round(ownedPrimary.catalog.estimatedTurnDamageContribution * flbPenalty),
        estimatedPeakDamage: Math.round(ownedPrimary.catalog.estimatedPeakBurstDamage * flbPenalty),
        notes: ownedPrimary.meetsFlbAndFourthSkill
          ? `Optimal slot match (${ownedPrimary.catalog.name}). ${slot.slotNotes}`
          : `${ownedPrimary.catalog.name} is owned but missing Lv${ownedPrimary.catalog.minLevelRequired} FLB / 4th Skill unlock!`
      };
    }

    // 2. Check Archetype & Registry Substitutes
    const candidateSubIds = new Set<string>(slot.substituteCharacterIds || []);
    if (primaryCat) {
      for (const subRef of primaryCat.substitutes) {
        candidateSubIds.add(subRef.characterId);
      }
    }

    for (const subId of candidateSubIds) {
      const ownedSub = ownedChars.find(c => c.catalog.id === subId && !usedCharIds.has(c.catalog.id));
      if (ownedSub) {
        usedCharIds.add(ownedSub.catalog.id);
        const subRef = primaryCat?.substitutes.find(s => s.characterId === subId);
        const baseCompat = subRef?.compatibilityPercent ?? 80;
        const flbPenalty = ownedSub.meetsFlbAndFourthSkill ? 1.0 : 0.75;
        const compatibilityScore = Math.round(baseCompat * flbPenalty);
        return {
          slotNumber: slot.slotNumber,
          slotRole: slot.slotRole,
          position,
          primaryCharacterId: slot.primaryCharacterId,
          primaryCharacterName: primaryName,
          status: 'SUBSTITUTE_MATCH',
          matchedCharacterId: ownedSub.catalog.id,
          matchedCharacterName: ownedSub.catalog.name,
          compatibilityScore,
          meetsLevelAndUncap: ownedSub.meetsFlbAndFourthSkill,
          estimatedTurnDamage: Math.round(ownedSub.catalog.estimatedTurnDamageContribution * flbPenalty),
          estimatedPeakDamage: Math.round(ownedSub.catalog.estimatedPeakBurstDamage * flbPenalty),
          notes:
            subRef?.tradeoffNotes ||
            `Using viable substitute ${ownedSub.catalog.name} in place of ${primaryName}.`
        };
      }
    }

    // 3. Fallback to any remaining Fire character in the player's roster
    const remainingFire = ownedChars.find(c => !usedCharIds.has(c.catalog.id));
    if (remainingFire) {
      usedCharIds.add(remainingFire.catalog.id);
      const flbPenalty = remainingFire.meetsFlbAndFourthSkill ? 1.0 : 0.75;
      return {
        slotNumber: slot.slotNumber,
        slotRole: slot.slotRole,
        position,
        primaryCharacterId: slot.primaryCharacterId,
        primaryCharacterName: primaryName,
        status: 'FALLBACK_MATCH',
        matchedCharacterId: remainingFire.catalog.id,
        matchedCharacterName: remainingFire.catalog.name,
        compatibilityScore: Math.round(55 * flbPenalty),
        meetsLevelAndUncap: remainingFire.meetsFlbAndFourthSkill,
        estimatedTurnDamage: Math.round(remainingFire.catalog.estimatedTurnDamageContribution * 0.75),
        estimatedPeakDamage: Math.round(remainingFire.catalog.estimatedPeakBurstDamage * 0.75),
        notes: `Budget Fire fallback (${remainingFire.catalog.name}) filling in for missing ${primaryName}.`
      };
    }

    // 4. Slot is completely empty / missing
    return {
      slotNumber: slot.slotNumber,
      slotRole: slot.slotRole,
      position,
      primaryCharacterId: slot.primaryCharacterId,
      primaryCharacterName: primaryName,
      status: 'MISSING',
      compatibilityScore: 0,
      meetsLevelAndUncap: false,
      estimatedTurnDamage: 0,
      estimatedPeakDamage: 0,
      notes: `CRITICAL GAP: Missing ${primaryName} and all viable Fire substitutes (${Array.from(candidateSubIds).join(', ')}).`
    };
  }

  private evaluateWeaponGrid(
    archetype: SietePartyArchetypeDefinition,
    ownedWeapons: ResolvedOwnedWeapon[]
  ): {
    weaponScore: number;
    mainhandMatched: string | null;
    weaponSlots: SieteWeaponSlotCheckResult[];
    resonatorTypeCounts: Record<string, number>;
    maxIdenticalTypeCount: number;
  } {
    // Count weapon types across owned grid (capped at 10 grid slots for realistic Resonator check)
    const resonatorTypeCounts: Record<string, number> = {};
    let countedSlots = 0;
    for (const w of ownedWeapons) {
      if (countedSlots >= 10) break;
      const take = Math.min(w.copies, 10 - countedSlots);
      const wType = w.catalog.weaponType;
      resonatorTypeCounts[wType] = (resonatorTypeCounts[wType] || 0) + take;
      countedSlots += take;
    }
    const maxIdenticalTypeCount = Object.values(resonatorTypeCounts).reduce(
      (max, val) => Math.max(max, val),
      0
    );

    // Check Mainhand
    let mainhandMatched: string | null = null;
    for (const mhId of archetype.weaponRequirements.mainhandOptions) {
      const found = ownedWeapons.find(w => w.catalog.id === mhId);
      if (found) {
        mainhandMatched = found.catalog.name;
        break;
      }
    }

    const weaponSlots: SieteWeaponSlotCheckResult[] = [];
    for (const reqSlot of archetype.weaponRequirements.coreGridSlots) {
      const primaryCat = this.catalog.getSieteWeapon(reqSlot.primaryWeaponId);
      const primaryName = primaryCat?.name || reqSlot.primaryWeaponId;

      const ownedPrimary = ownedWeapons.find(w => w.catalog.id === reqSlot.primaryWeaponId);
      const primaryCopies = Math.min(reqSlot.recommendedCopies, ownedPrimary?.copies ?? 0);

      let subCopies = 0;
      const matchedLabels: string[] = [];
      if (primaryCopies > 0) {
        matchedLabels.push(`${primaryCopies}x ${primaryName}`);
      }

      const remainingNeeded = reqSlot.recommendedCopies - primaryCopies;
      if (remainingNeeded > 0) {
        for (const subId of reqSlot.substituteWeaponIds) {
          const ownedSub = ownedWeapons.find(w => w.catalog.id === subId);
          if (ownedSub && ownedSub.copies > 0) {
            const take = Math.min(remainingNeeded - subCopies, ownedSub.copies);
            if (take > 0) {
              subCopies += take;
              matchedLabels.push(`${take}x ${ownedSub.catalog.name} (Sub)`);
            }
          }
          if (subCopies >= remainingNeeded) break;
        }
      }

      const effectiveCopies = primaryCopies + subCopies * 0.82;
      const rawRatio = Math.min(1, effectiveCopies / Math.max(1, reqSlot.recommendedCopies));

      // Check Resonator requirement (e.g. Lord of Flames requires >= 4 identical weapon types)
      const resonatorReq = primaryCat?.resonatorRequirementCount ?? 0;
      const resonatorConditionMet =
        primaryCopies === 0 || resonatorReq === 0 || maxIdenticalTypeCount >= resonatorReq;
      const resonatorMultiplier = resonatorConditionMet ? 1.0 : 0.65;

      const slotScore = Math.round(rawRatio * 100 * resonatorMultiplier);
      const status: SieteWeaponSlotCheckResult['status'] =
        primaryCopies >= reqSlot.recommendedCopies && resonatorConditionMet
          ? 'FULL_PRIMARY'
          : primaryCopies + subCopies > 0
          ? 'PARTIAL_OR_SUBSTITUTE'
          : 'MISSING';

      weaponSlots.push({
        roleLabel: reqSlot.roleLabel,
        primaryWeaponId: reqSlot.primaryWeaponId,
        primaryWeaponName: primaryName,
        recommendedCopies: reqSlot.recommendedCopies,
        ownedEffectiveCopies: Number((primaryCopies + subCopies).toFixed(1)),
        status,
        matchedWeaponsSummary: matchedLabels.length > 0 ? matchedLabels.join(' + ') : 'None',
        resonatorConditionMet,
        slotScore,
        notes: !resonatorConditionMet
          ? `WARNING: ${primaryName} requires ${resonatorReq}+ weapons of the same type in the grid (current max: ${maxIdenticalTypeCount}).`
          : status === 'FULL_PRIMARY'
          ? `Full ${reqSlot.recommendedCopies}x ${primaryName} requirement met.`
          : status === 'PARTIAL_OR_SUBSTITUTE'
          ? `Satisfied via ${matchedLabels.join(' + ')}.`
          : `Missing ${reqSlot.recommendedCopies}x ${primaryName}.`
      });
    }

    const avgSlotScore =
      weaponSlots.reduce((sum, s) => sum + s.slotScore, 0) / Math.max(1, weaponSlots.length);
    const mainhandBonus = mainhandMatched ? 100 : 40;
    const weaponScore = Math.round(avgSlotScore * 0.85 + mainhandBonus * 0.15);

    return {
      weaponScore,
      mainhandMatched,
      weaponSlots,
      resonatorTypeCounts,
      maxIdenticalTypeCount
    };
  }

  private evaluateSummons(
    archetype: SietePartyArchetypeDefinition,
    ownedSummons: ResolvedOwnedSummon[]
  ): SieteSummonCheckResult {
    let mainSummonMatched: string | null = null;
    for (const mainId of archetype.summonRequirements.mainSummonOptions) {
      const found = ownedSummons.find(s => s.catalog.id === mainId);
      if (found) {
        mainSummonMatched = found.catalog.name;
        break;
      }
    }

    let supporterSummonMatched: string | null = null;
    for (const supId of archetype.summonRequirements.supporterSummonOptions) {
      const supCat = this.catalog.getSieteSummon(supId);
      if (supCat) {
        supporterSummonMatched = supCat.name;
        break;
      }
    }

    const subAuraSummonsMatched: string[] = [];
    const missingSubAuraSummons: string[] = [];
    let totalPassiveDamageCapBonusPercent = 0;
    let totalSeraphicAmpPercent = 0;
    let totalSupplementalDamageFlat = 0;
    let totalHpBonusPercent = 0;

    for (const owned of ownedSummons) {
      totalPassiveDamageCapBonusPercent += owned.catalog.damageCapBonusPercent;
      totalSeraphicAmpPercent += owned.catalog.seraphicAmpPercent;
      totalSupplementalDamageFlat += owned.catalog.supplementalDamageFlat;
      totalHpBonusPercent += owned.catalog.hpBonusPercent;
    }

    for (const reqSubId of archetype.summonRequirements.requiredSubAuraSummonIds) {
      const found = ownedSummons.find(s => s.catalog.id === reqSubId);
      const reqCat = this.catalog.getSieteSummon(reqSubId);
      if (found) {
        subAuraSummonsMatched.push(found.catalog.name);
      } else if (reqCat) {
        missingSubAuraSummons.push(reqCat.name);
      }
    }

    const mainScore = mainSummonMatched ? 100 : 30;
    const subRatio =
      subAuraSummonsMatched.length /
      Math.max(1, archetype.summonRequirements.requiredSubAuraSummonIds.length);
    const summonScore = Math.round(mainScore * 0.5 + subRatio * 100 * 0.5);

    const notes: string[] = [
      `Seofon locks active summon calls to 99T on entry; passive Main/Support Auras (${mainSummonMatched || 'None'} x ${supporterSummonMatched || 'Colossus/Agni'}) and Sub-Auras (${subAuraSummonsMatched.join(', ') || 'None'}) remain 100% active.`
    ];

    return {
      mainSummonMatched,
      supporterSummonMatched,
      subAuraSummonsMatched,
      missingSubAuraSummons,
      totalPassiveDamageCapBonusPercent,
      totalSeraphicAmpPercent,
      totalSupplementalDamageFlat,
      totalHpBonusPercent,
      summonScore,
      notes
    };
  }

  private computeDamageAndHonorProjection(
    archetype: SietePartyArchetypeDefinition,
    roster: SietePlayerRosterInput,
    characterSlots: SieteCharacterSlotCheckResult[],
    ownedChars: ResolvedOwnedCharacter[],
    ownedWeapons: ResolvedOwnedWeapon[],
    weaponSlots: SieteWeaponSlotCheckResult[],
    summonCheck: SieteSummonCheckResult,
    mcScore: number
  ): SieteDamageAndHonorProjection {
    const raidSpec = this.catalog.getSieteRaidSpecification()!;

    // 1. Resonator Weapon Type Counts
    const resonatorWeaponTypeCounts: Record<string, number> = {};
    let totalGridDamageCapPercent = 0;
    let totalGridSupplementalFlat = 0;
    let gridHpBonusPercent = 0;
    let countedCopies = 0;

    for (const w of ownedWeapons) {
      const take = Math.min(w.copies, Math.max(0, 10 - countedCopies));
      if (take <= 0) continue;
      countedCopies += take;
      resonatorWeaponTypeCounts[w.catalog.weaponType] =
        (resonatorWeaponTypeCounts[w.catalog.weaponType] || 0) + take;
      totalGridDamageCapPercent += w.catalog.damageCapPercent * take;
      totalGridSupplementalFlat += w.catalog.supplementalDamageFlat * Math.min(2, take);
      gridHpBonusPercent += w.catalog.hpBonusPercent * take;
    }
    totalGridDamageCapPercent = Math.min(40, totalGridDamageCapPercent);
    totalGridSupplementalFlat = Math.min(200000, totalGridSupplementalFlat);

    const maxIdenticalWeaponTypeCount = Object.values(resonatorWeaponTypeCounts).reduce(
      (max, v) => Math.max(max, v),
      0
    );

    // 2. Estimated Party HP
    const calculatedHp = Math.round(
      26000 * (1 + (gridHpBonusPercent + Math.max(0, summonCheck.totalHpBonusPercent)) / 100)
    );
    const estimatedPartyHp = roster.estimatedPartyHp && roster.estimatedPartyHp > 0
      ? roster.estimatedPartyHp
      : calculatedHp;

    // 3. Base Character Turn & Peak Damage (Frontline + MC contribution)
    const frontlineSlots = characterSlots.filter(s => s.position === 'frontline');
    const charAvgTurnSum = frontlineSlots.reduce((sum, s) => sum + s.estimatedTurnDamage, 0);
    const charPeakTurnSum = frontlineSlots.reduce((sum, s) => sum + s.estimatedPeakDamage, 0);

    const mcBaseAvgDamage = archetype.playstyle === 'Manual_Burst_2T_3T' ? 32000000 : 25000000;
    const mcBasePeakDamage = archetype.playstyle === 'Manual_Burst_2T_3T' ? 54000000 : 38000000;
    const mcFactor = mcScore / 100;

    // 4. Grid, Sub-Ally (Michael +20% Cap), Seraphic, and Supplemental Multipliers
    const avgWeaponSlotRatio =
      weaponSlots.reduce((sum, s) => sum + s.slotScore, 0) /
      (Math.max(1, weaponSlots.length) * 100);

    const hasMichaelPassive = ownedChars.some(c => c.catalog.id === 'char_fire_michael');
    const michaelCapMultiplier = hasMichaelPassive ? 1.12 : 1.0;
    const summonAuraMultiplier = summonCheck.mainSummonMatched ? 1.08 : 0.78;
    const supplementalMultiplier =
      1 + Math.min(0.18, (totalGridSupplementalFlat + summonCheck.totalSupplementalDamageFlat) / 800000);
    const gridPowerFactor = Math.max(0.35, avgWeaponSlotRatio) * michaelCapMultiplier * summonAuraMultiplier * supplementalMultiplier;

    const estimatedAverageTurnDamage = Math.round(
      (charAvgTurnSum + mcBaseAvgDamage * mcFactor) * gridPowerFactor * 0.62
    );
    const estimatedPeakBurstTurnDamage = Math.round(
      (charPeakTurnSum + mcBasePeakDamage * mcFactor) * gridPowerFactor * 0.58
    );
    const estimatedTurn1To3TotalDamage = Math.round(
      estimatedPeakBurstTurnDamage + estimatedAverageTurnDamage * 2
    );

    const clears77M7EmblemaOmen =
      estimatedPeakBurstTurnDamage >= raidSpec.universalOmenCancelDamage;
    const omenCancelMarginDamage =
      estimatedPeakBurstTurnDamage - raidSpec.universalOmenCancelDamage;

    // Honors per turn (~10,000 honors per 1M damage + ~25,000 skill/debuff/omen honors)
    const estimatedAverageHonorsPerTurn = Math.max(
      100000,
      Math.round(estimatedAverageTurnDamage * raidSpec.honorPerDamageRatio + 25000)
    );
    const firstTurnBurstHonors = Math.round(
      estimatedPeakBurstTurnDamage * raidSpec.honorPerDamageRatio + 35000
    );
    const remainingHonorsAfterBurst = Math.max(
      0,
      raidSpec.blueChestTargetHonors - firstTurnBurstHonors
    );
    const estimatedTurnsTo4MHonors =
      estimatedAverageTurnDamage <= 0
        ? 99
        : 1 + Math.ceil(remainingHonorsAfterBurst / estimatedAverageHonorsPerTurn);

    const meets4MHonorsTarget = estimatedTurnsTo4MHonors <= 8 && estimatedAverageTurnDamage >= 45000000;

    return {
      estimatedPartyHp,
      estimatedAverageTurnDamage,
      estimatedPeakBurstTurnDamage,
      estimatedTurn1To3TotalDamage,
      clears77M7EmblemaOmen,
      omenCancelMarginDamage,
      estimatedAverageHonorsPerTurn,
      estimatedTurnsTo4MHonors,
      meets4MHonorsTarget,
      totalGridDamageCapPercent,
      totalGridSupplementalFlat,
      resonatorWeaponTypeCounts,
      maxIdenticalWeaponTypeCount
    };
  }

  // ============================================================================
  // HARD GATE VALIDATOR
  // ============================================================================

  private evaluateHardGates(
    roster: SietePlayerRosterInput,
    resolvedCharacters: ResolvedOwnedCharacter[],
    bestEval: SieteArchetypeEvaluationResult
  ): SieteHardGateCheckResult[] {
    const results: SieteHardGateCheckResult[] = [];

    // Gate 1: 100% Fire Element Roster & Party Enforcement
    const nonFireChars = (roster.characters || []).filter(c => !this.isCharacterFireElement(c));
    const nonFireInParty = nonFireChars.filter(
      c => c.slotPosition && c.slotPosition !== 'inventory'
    );
    const hasEnoughFireAllies = resolvedCharacters.length >= 3;
    const gate1Passed = nonFireInParty.length === 0 && nonFireChars.length === 0 && hasEnoughFireAllies;

    results.push({
      gateId: 'gate_100_percent_fire_allies',
      name: '100% Fire Element Roster & Party Enforcement',
      severity: 'CRITICAL_BLOCKER',
      passed: gate1Passed,
      measuredValue:
        nonFireChars.length > 0
          ? `Found non-Fire unit(s): ${nonFireChars.map(c => c.name).join(', ')}`
          : `${resolvedCharacters.length} Fire allies verified`,
      requiredThreshold: '100% Fire allies (minimum 3-5 Fire characters; 0 off-element units)',
      diagnosticMessage:
        nonFireChars.length > 0
          ? `CRITICAL BLOCKER: Seofon deals 999,999 plain damage to non-Fire allies (${nonFireChars.map(c => c.name).join(', ')}) on entry. Replace with Fire Ragazzo if an Evoker switch-in sacrifice is needed.`
          : !hasEnoughFireAllies
          ? `CRITICAL BLOCKER: Only ${resolvedCharacters.length} recognized Fire character(s) found; need at least 3-5 Fire allies.`
          : 'PASSED: All party members are Fire element and immune to Seofon entry execution.'
    });

    // Gate 2: Turn-1 99-Turn Summon Cooldown Lock Compliance
    const hasMainAura = Boolean(bestEval.summonCheck.mainSummonMatched);
    const subAuraCount = bestEval.summonCheck.subAuraSummonsMatched.length;
    const gate2Passed = hasMainAura && subAuraCount >= 2;

    results.push({
      gateId: 'gate_turn1_summon_lock_compliance',
      name: 'Turn-1 99-Turn Summon Cooldown Lock Compliance',
      severity: 'WARNING',
      passed: gate2Passed,
      measuredValue: `Main: ${bestEval.summonCheck.mainSummonMatched || 'None'} | Passive Sub-Auras: ${subAuraCount}`,
      requiredThreshold: 'Passive Main Aura + >= 2 Passive Sub-Auras (Michael / The Sun / Belial / Devil)',
      diagnosticMessage: gate2Passed
        ? `PASSED: Setup relies on passive auras (${bestEval.summonCheck.mainSummonMatched} + ${bestEval.summonCheck.subAuraSummonsMatched.join(', ')}) and does not depend on locked Turn-1 active summon calls.`
        : 'WARNING: Seofon locks all summon cooldowns to 99 turns on entry. Equip passive Main Summon (Agni/Colossus/Beelzebub) and Sub-Auras (The Sun ULB, Michael, Belial).'
    });

    // Gate 3: Survivable HP & Defense Threshold
    const hp = bestEval.damageProjection.estimatedPartyHp;
    const minHp = bestEval.playstyle === 'Manual_Burst_2T_3T' ? 45000 : 58000;
    const gate3Passed = hp >= minHp;

    results.push({
      gateId: 'gate_minimum_hp_threshold',
      name: 'Survivable HP & Defense Threshold',
      severity: 'WARNING',
      passed: gate3Passed,
      measuredValue: `${hp.toLocaleString()} HP`,
      requiredThreshold: `>= ${minHp.toLocaleString()} HP for ${bestEval.playstyle}`,
      diagnosticMessage: gate3Passed
        ? `PASSED: Estimated Party HP (${hp.toLocaleString()}) comfortably survives Seofon's Wind multi-hit normal attacks.`
        : `WARNING: Estimated Party HP (${hp.toLocaleString()}) is below the recommended ${minHp.toLocaleString()} HP threshold. Uncap The Devil (ULB +30% HP) or add Extinction Blade / Nilakantha.`
    });

    // Gate 4: 77,777,777 Omen Cancel & 4,000,000 Honors Pacing Check
    const peakDmg = bestEval.damageProjection.estimatedPeakBurstTurnDamage;
    const turnsTo4M = bestEval.damageProjection.estimatedTurnsTo4MHonors;
    const isKengoFcSolver = bestEval.archetypeId === 'siete_fire_kengo_ougi_loop' && bestEval.overallScore >= 65;
    const gate4Passed =
      (peakDmg >= 77777777 || isKengoFcSolver) &&
      turnsTo4M <= 7 &&
      bestEval.damageProjection.meets4MHonorsTarget;

    results.push({
      gateId: 'gate_77m_omen_and_4m_honors_pace',
      name: '77,777,777 Omen Cancel & 4,000,000 Honors Pacing Check',
      severity: 'CRITICAL_BLOCKER',
      passed: gate4Passed,
      measuredValue: `Peak Turn: ${(peakDmg / 1_000_000).toFixed(1)}M DMG | Est. ${turnsTo4M} Turns to 4M Honors`,
      requiredThreshold: '>= 77,777,777 Peak Turn DMG (or Kengo FC Loop) & <= 7 Turns to 4,000,000 Honors',
      diagnosticMessage: gate4Passed
        ? `PASSED: Projected Peak Turn Damage (${peakDmg.toLocaleString()}) clears the 77,777,777 Emblema omen and reaches 4,000,000 Honors in ~${turnsTo4M} turns.`
        : `CRITICAL BLOCKER: Projected Peak Turn Damage (${peakDmg.toLocaleString()}) falls short of 77,777,777 (Est. ${turnsTo4M} turns to 4M Honors). Review Upgrade Roadmap below.`
    });

    return results;
  }

  // ============================================================================
  // OPTIMAL SETUP SYNTHESIZER & UPGRADE ROADMAP GENERATOR
  // ============================================================================

  private synthesizeOptimalSetup(
    archetype: SietePartyArchetypeDefinition,
    evalResult: SieteArchetypeEvaluationResult,
    roster: SietePlayerRosterInput
  ): SieteSynthesizedOptimalSetup {
    const frontlineCharacters = evalResult.characterSlots
      .filter(s => s.position === 'frontline')
      .map(
        s =>
          `Slot ${s.slotNumber}: ${s.matchedCharacterName || `[MISSING: ${s.primaryCharacterName}]`} (${s.status === 'PRIMARY_MATCH' ? 'Optimal' : s.status})`
      );

    const backlineCharacters = evalResult.characterSlots
      .filter(s => s.position === 'backline')
      .map(
        s =>
          `Sub ${s.slotNumber - 3}: ${s.matchedCharacterName || `[MISSING: ${s.primaryCharacterName}]`} (${s.status === 'PRIMARY_MATCH' ? 'Optimal' : s.status})`
      );

    const coreGridWeapons = evalResult.weaponSlots.map(
      w => `${w.roleLabel}: ${w.matchedWeaponsSummary !== 'None' ? w.matchedWeaponsSummary : `[MISSING: ${w.recommendedCopies}x ${w.primaryWeaponName}]`}`
    );

    const mcClass = evalResult.mcMatchedClass || archetype.mcRequirement.primaryClass;
    const mcSkills =
      roster.activeMcSkills && roster.activeMcSkills.length > 0
        ? roster.activeMcSkills
        : archetype.mcRequirement.recommendedSkills;

    const mainhandWeapon =
      evalResult.mainhandMatched ||
      this.catalog.getSieteWeapon(archetype.weaponRequirements.mainhandOptions[0] || '')?.name ||
      'Scythe of Repentance';

    return {
      recommendedArchetypeId: archetype.archetypeId,
      recommendedArchetypeName: archetype.name,
      playstyle: archetype.playstyle,
      mcClass,
      mcSkills,
      mainhandWeapon,
      frontlineCharacters,
      backlineCharacters,
      coreGridWeapons,
      mainAndSupportSummons: `${evalResult.summonCheck.mainSummonMatched || 'Colossus Ira / Agni'} x ${evalResult.summonCheck.supporterSummonMatched || 'Agni / Colossus Ira'}`,
      subAuraSummons:
        evalResult.summonCheck.subAuraSummonsMatched.length > 0
          ? evalResult.summonCheck.subAuraSummonsMatched
          : ['The Sun (ULB)', 'Michael', 'Belial', 'The Devil (ULB)'],
      projectedPeakTurnDamage: evalResult.damageProjection.estimatedPeakBurstTurnDamage,
      projectedAverageTurnDamage: evalResult.damageProjection.estimatedAverageTurnDamage,
      projectedTurnsTo4MHonors: evalResult.damageProjection.estimatedTurnsTo4MHonors,
      canCancel77M7Emblema: evalResult.damageProjection.clears77M7EmblemaOmen,
      turnByTurnExecutionPlan: archetype.turnRotation
    };
  }

  private generateUpgradeRoadmap(
    roster: SietePlayerRosterInput,
    ownedChars: ResolvedOwnedCharacter[],
    ownedWeapons: ResolvedOwnedWeapon[],
    ownedSummons: ResolvedOwnedSummon[],
    archetype: SietePartyArchetypeDefinition,
    evalResult: SieteArchetypeEvaluationResult,
    hardGateResults: SieteHardGateCheckResult[]
  ): SieteUpgradeRecommendation[] {
    const roadmap: SieteUpgradeRecommendation[] = [];

    // 1. Check Non-Fire Blocker
    const gate1 = hardGateResults.find(g => g.gateId === 'gate_100_percent_fire_allies');
    if (gate1 && !gate1.passed) {
      roadmap.push({
        priority: 'CRITICAL',
        category: 'Character',
        targetItem: '100% Fire Element Frontline & Backline',
        currentGap: gate1.measuredValue,
        actionableStep:
          'Remove all non-Fire characters from the party immediately. Use Fire Ragazzo if you need a Turn 2-3 sacrifice to bring out Alanaan FLB or Fraux FLB.',
        expectedHonorOrDamageGain: 'Prevents instant 999,999 plain damage execution on battle entry'
      });
    }

    // 2. Check Uncapped FLB / 4th Skill Characters (e.g. Alanaan FLB, Fraux FLB)
    for (const c of ownedChars) {
      if (!c.meetsFlbAndFourthSkill) {
        roadmap.push({
          priority: 'HIGH',
          category: 'Uncap_Awakening',
          targetItem: `${c.catalog.name} (5★ FLB Lv${c.catalog.minLevelRequired} + 4th Skill)`,
          currentGap: `Owned at Lv${c.raw.level ?? 80} (${c.raw.uncapStars ?? 4}★, 4th Skill: ${Boolean(c.raw.hasFourthSkill)})`,
          actionableStep: `Complete Tales of Arcarum / Fate Episodes to unlock ${c.catalog.name}'s 5★ uncap and 4th skill.`,
          expectedHonorOrDamageGain: '+35M to +55M turn damage and Turn-1 field activation without charge bar drain'
        });
      }
    }

    // 3. Check Missing Core Characters in Best Archetype
    for (const slot of evalResult.characterSlots) {
      if (slot.status === 'MISSING' || slot.status === 'FALLBACK_MATCH') {
        const primaryCat = this.catalog.getSieteCharacter(slot.primaryCharacterId);
        const subs = (primaryCat?.substitutes || [])
          .map(s => this.catalog.getSieteCharacter(s.characterId)?.name || s.characterId)
          .join(' or ');
        roadmap.push({
          priority: slot.position === 'frontline' ? 'CRITICAL' : 'HIGH',
          category: 'Character',
          targetItem: slot.primaryCharacterName,
          currentGap:
            slot.status === 'MISSING'
              ? `Slot ${slot.slotNumber} (${slot.slotRole}) is empty`
              : `Using budget fallback ${slot.matchedCharacterName}`,
          actionableStep: `Acquire/slot ${slot.primaryCharacterName}${subs ? ` (or substitute with ${subs})` : ''}.`,
          expectedHonorOrDamageGain: `+${((primaryCat?.estimatedPeakBurstDamage || 45000000) / 1_000_000).toFixed(0)}M peak turn burst damage`
        });
      }
    }

    // 4. Check Resonator Condition for Lord of Flames
    for (const wSlot of evalResult.weaponSlots) {
      if (!wSlot.resonatorConditionMet) {
        roadmap.push({
          priority: 'HIGH',
          category: 'Weapon_Grid',
          targetItem: 'Lord of Flames Resonator (4+ Identical Weapon Types)',
          currentGap: `Max identical weapon type in grid is ${evalResult.damageProjection.maxIdenticalWeaponTypeCount} (requires 4+)`,
          actionableStep:
            'Equip at least 4 Sabres (e.g. Lord of Flames + Ira Volcanic Blades + Extinction Blade + Ultima Sword) to activate +40% EX ATK, +25% DEF, and +7% Special Cap.',
          expectedHonorOrDamageGain: '+25% to +35% effective party damage and +25% defense'
        });
      } else if (wSlot.status === 'MISSING' || wSlot.slotScore < 70) {
        roadmap.push({
          priority: wSlot.primaryWeaponId === 'wpn_fire_scythe_of_repentance' ? 'CRITICAL' : 'HIGH',
          category: 'Weapon_Grid',
          targetItem: `${wSlot.recommendedCopies}x ${wSlot.primaryWeaponName}`,
          currentGap: `Currently slotting: ${wSlot.matchedWeaponsSummary}`,
          actionableStep: `Farm or slot ${wSlot.recommendedCopies}x ${wSlot.primaryWeaponName} (${wSlot.roleLabel}).`,
          expectedHonorOrDamageGain: '+15% to +30% turn damage and higher damage cap'
        });
      }
    }

    // 5. Check Missing Sub-Aura Summons
    for (const missingSub of evalResult.summonCheck.missingSubAuraSummons) {
      roadmap.push({
        priority: missingSub.toLowerCase().includes('sun') || missingSub.toLowerCase().includes('michael') ? 'HIGH' : 'MEDIUM',
        category: 'Summon',
        targetItem: missingSub,
        currentGap: 'Not present in Sub-Aura / Sub Summon slots',
        actionableStep: `Equip ${missingSub} in Sub-Aura slot (works 100% passively through Seofon's 99-turn summon cooldown lock).`,
        expectedHonorOrDamageGain: '+10% Seraphic Amplification / +15% Damage Cap / +30,000 Supplemental'
      });
    }

    // 6. Check MC Class
    if (evalResult.mcStatus === 'MISSING') {
      roadmap.push({
        priority: 'HIGH',
        category: 'MC_Class',
        targetItem: archetype.mcRequirement.primaryClass,
        currentGap: `Active MC class is ${roster.activeMcClass || 'None'}`,
        actionableStep: `Unlock and switch MC to ${archetype.mcRequirement.primaryClass} (or ${archetype.mcRequirement.alternativeClasses.join(' / ')}) with skills: ${archetype.mcRequirement.recommendedSkills.join(', ')}.`,
        expectedHonorOrDamageGain: '+25M to +45M MC turn damage and teamwide burst utility'
      });
    }

    // If everything is already optimal, add an optimization polish tip
    if (roadmap.length === 0) {
      roadmap.push({
        priority: 'LOW',
        category: 'Uncap_Awakening',
        targetItem: 'Perpetuity Rings, Awakening Lv9 & Dark Opus Lv250 Polish',
        currentGap: 'Roster and grid already meet all SS/SSS thresholds for Seofon 4M Honors',
        actionableStep:
          'Apply Attack Awakening Lv9 and Perpetuity Rings (+10% Cap) to Percival (Grand), Zeta (Grand), and Wilnas (Grand) to shave 1 extra turn off your 4M Honors rotation.',
        expectedHonorOrDamageGain: '+8% to +12% faster 4M Blue Chest lock-in'
      });
    }

    return roadmap;
  }

  private scoreToGrade(score: number): SieteReadinessGrade {
    const grades = this.catalog.getSieteReadinessThresholds()?.grades || {
      SSS: 92,
      SS: 85,
      S: 75,
      A: 65,
      B: 50,
      C: 35
    };
    if (score >= grades.SSS) return 'SSS';
    if (score >= grades.SS) return 'SS';
    if (score >= grades.S) return 'S';
    if (score >= grades.A) return 'A';
    if (score >= grades.B) return 'B';
    if (score >= grades.C) return 'C';
    return 'NOT_READY';
  }

  private normalizeToken(input: string): string {
    return (input || '')
      .toLowerCase()
      .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, ' ')
      .trim();
  }

  // ============================================================================
  // REPORT FORMATTERS (MARKDOWN, CONSOLE, DISCORD)
  // ============================================================================

  public formatMarkdownReport(report: SieteReadinessReport): string {
    const lines: string[] = [];
    const best = report.bestArchetypeEvaluation;
    const proj = best.damageProjection;
    const opt = report.synthesizedOptimalSetup;

    lines.push(`# Seofon (Impossible) / Siete HL — 4M Honors Readiness Report`);
    lines.push(``);
    lines.push(`- **Account**: \`${report.accountId}\` (\`${report.source}\`)`);
    lines.push(`- **Target Raid**: **${report.raidName}** (Quest ID \`${report.questId}\`)`);
    lines.push(`- **Blue Chest Target**: **${report.blueChestTargetHonors.toLocaleString()} Honors** (~${report.equivalentTargetDamage.toLocaleString()} Damage)`);
    lines.push(`- **Overall Readiness**: **Grade \`${report.overallGrade}\` (${report.overallReadinessScore}/100)** — ${report.readyFor4MBlueChest ? 'READY FOR 4M BLUE CHEST' : 'NEEDS UPGRADES'}`);
    lines.push(`- **77,777,777 *Emblema* Omen Cancel**: **${report.canCancel77M7Omen ? 'YES' : 'NO'}** (Projected Peak Turn: \`${proj.estimatedPeakBurstTurnDamage.toLocaleString()}\` DMG | Avg Turn: \`${proj.estimatedAverageTurnDamage.toLocaleString()}\` DMG | Est. **${proj.estimatedTurnsTo4MHonors} Turns** to 4M Honors)`);
    lines.push(``);

    lines.push(`## 1. Seofon V2 Hard Gates`);
    lines.push(`| Gate | Severity | Status | Measured | Requirement |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const g of report.hardGateResults) {
      lines.push(
        `| **${g.name}** | \`${g.severity}\` | **${g.passed ? 'PASS' : 'FAIL'}** | ${g.measuredValue} | ${g.requiredThreshold} |`
      );
    }
    lines.push(``);

    lines.push(`## 2. Synthesized Optimal Party & Grid (\`${opt.recommendedArchetypeName}\`)`);
    lines.push(`- **Playstyle**: \`${opt.playstyle}\``);
    lines.push(`- **MC Class & Skills**: **${opt.mcClass}** (${opt.mcSkills.join(', ')})`);
    lines.push(`- **Mainhand Weapon**: **${opt.mainhandWeapon}**`);
    lines.push(`- **Frontline Allies**:`);
    for (const f of opt.frontlineCharacters) {
      lines.push(`  - ${f}`);
    }
    lines.push(`- **Backline Sub-Allies**:`);
    for (const b of opt.backlineCharacters) {
      lines.push(`  - ${b}`);
    }
    lines.push(`- **Core Weapon Grid**:`);
    for (const w of opt.coreGridWeapons) {
      lines.push(`  - ${w}`);
    }
    lines.push(`- **Main x Supporter Summons**: **${opt.mainAndSupportSummons}**`);
    lines.push(`- **Passive Sub-Aura Summons**: ${opt.subAuraSummons.join(', ')}`);
    lines.push(``);

    lines.push(`## 3. Turn-by-Turn 4M Honors Rotation`);
    for (const step of opt.turnByTurnExecutionPlan) {
      lines.push(`- ${step}`);
    }
    lines.push(``);

    lines.push(`## 4. All 5 Siete Party Archetypes Comparison`);
    lines.push(`| Archetype | Playstyle | Grade | Score | Peak Turn DMG | Est. Turns to 4M | 77.77M Cancel |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`);
    for (const a of report.allArchetypeEvaluations) {
      lines.push(
        `| **${a.archetypeName}** | \`${a.playstyle}\` | \`${a.grade}\` | \`${a.overallScore}/100\` | \`${a.damageProjection.estimatedPeakBurstTurnDamage.toLocaleString()}\` | **${a.damageProjection.estimatedTurnsTo4MHonors}T** | ${a.damageProjection.clears77M7EmblemaOmen ? 'YES' : 'NO'} |`
      );
    }
    lines.push(``);

    lines.push(`## 5. Prioritized Upgrade Roadmap`);
    for (const u of report.upgradeRoadmap) {
      lines.push(
        `- **[${u.priority}] (${u.category}) ${u.targetItem}**: ${u.actionableStep} *(Current: ${u.currentGap} -> Impact: ${u.expectedHonorOrDamageGain})*`
      );
    }
    lines.push(``);

    return lines.join('\n');
  }

  public formatConsoleReport(report: SieteReadinessReport): string {
    const best = report.bestArchetypeEvaluation;
    const proj = best.damageProjection;
    const opt = report.synthesizedOptimalSetup;
    const lines: string[] = [];

    lines.push(`================================================================================`);
    lines.push(`  SEOFON (IMPOSSIBLE) / SIETE HL — 4,000,000 HONORS READINESS AUTO-CHECKER`);
    lines.push(`================================================================================`);
    lines.push(`  Account:            ${report.accountId} (${report.source})`);
    lines.push(`  Overall Grade:      [${report.overallGrade}] (${report.overallReadinessScore}/100)`);
    lines.push(`  4M Blue Chest:      ${report.readyFor4MBlueChest ? 'READY' : 'NOT READY'}`);
    lines.push(`  77.77M Omen Cancel: ${report.canCancel77M7Omen ? 'YES' : 'NO'} (Peak: ${(proj.estimatedPeakBurstTurnDamage / 1_000_000).toFixed(1)}M DMG | Avg: ${(proj.estimatedAverageTurnDamage / 1_000_000).toFixed(1)}M/turn)`);
    lines.push(`  Est. Pace to 4M:    ~${proj.estimatedTurnsTo4MHonors} Turns (~${(proj.estimatedAverageHonorsPerTurn / 1000).toFixed(0)}k Honors/turn | Party HP: ${proj.estimatedPartyHp.toLocaleString()})`);
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`  HARD GATES:`);
    for (const g of report.hardGateResults) {
      lines.push(`    [${g.passed ? 'PASS' : 'FAIL'}] ${g.name}: ${g.measuredValue}`);
    }
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`  BEST ARCHETYPE:     ${opt.recommendedArchetypeName} (${opt.playstyle})`);
    lines.push(`  MC Class & MH:      ${opt.mcClass} (${opt.mcSkills.join(', ')}) | MH: ${opt.mainhandWeapon}`);
    lines.push(`  Frontline:          ${opt.frontlineCharacters.join(' | ')}`);
    lines.push(`  Backline:           ${opt.backlineCharacters.join(' | ')}`);
    lines.push(`  Summons:            ${opt.mainAndSupportSummons} | Sub: ${opt.subAuraSummons.join(', ')}`);
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`  ALL ARCHETYPES SUMMARY:`);
    for (const a of report.allArchetypeEvaluations) {
      lines.push(
        `    - [${a.grade.padEnd(3, ' ')} | ${String(a.overallScore).padStart(3, ' ')}%] ${a.archetypeId.padEnd(38, ' ')} -> Peak ${(a.damageProjection.estimatedPeakBurstTurnDamage / 1_000_000).toFixed(1)}M | ~${a.damageProjection.estimatedTurnsTo4MHonors}T to 4M`
      );
    }
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`  PRIORITIZED UPGRADE ROADMAP:`);
    for (const u of report.upgradeRoadmap.slice(0, 6)) {
      lines.push(`    * [${u.priority}] ${u.targetItem}: ${u.actionableStep}`);
    }
    lines.push(`================================================================================`);

    return lines.join('\n');
  }
}

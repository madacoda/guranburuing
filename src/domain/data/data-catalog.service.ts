// src/domain/data/data-catalog.service.ts
import fs from 'fs';
import path from 'path';
import {
  RaidCatalogItem,
  RaidCategoryDefinition,
  ModalDefinition,
  NavigationRouteDefinition,
  EndpointDefinition,
  DailyAutomationTask,
  ElementDefinition,
  ElementMatrixItem,
  PartySelectionRuleItem,
  V2OmenDefinition,
  V2ConditionResolver,
  PlainDamageSummon,
  PlainDamageCharacter,
  PlainDamageMC,
  PlainDamageSolverStep,
  PlainDamageRaidOmenMapping,
  BossBuffDefinition,
  PartyDebuffDefinition,
  DispelSourceSummon,
  DispelSourceMCSkill,
  DispelSourceCharacter,
  CleanseSourceMCSkill,
  CleanseSourceSummon,
  CleanseSourceCharacter,
  GridArchetypeDefinition,
  ElementalSupportersDefinition,
  SupporterSelectionMatrixItem,
  RaidActionPolicy,
  RaidJoinProfile,
  RaidJoinDecisionStep,
  TacticalExecutionTier
} from './data-catalog.types.js';

/**
 * DataCatalogService (Singleton / Provider)
 *
 * Adheres to SOLID principles:
 * - Single Responsibility: Manages, indexes, and serves authoritative static game data from data/.
 * - Open/Closed: Extensible via modular JSON loading without code modification.
 * - High Performance: O(1) indexed Map lookups for raids, tasks, selectors, endpoints, elements, V2 omens, plain damage, status effects, and supporter summons.
 */
export class DataCatalogService {
  private static instance: DataCatalogService | null = null;

  private raidsById = new Map<string, RaidCatalogItem>();
  private raidsByQuestId = new Map<string, RaidCatalogItem>();
  private categoriesById = new Map<string, RaidCategoryDefinition>();
  private modalsById = new Map<string, ModalDefinition>();
  private routesByHash = new Map<string, NavigationRouteDefinition>();
  private endpointsByName = new Map<string, EndpointDefinition>();
  private tasksByTagOrId = new Map<string, DailyAutomationTask>();
  private elementsById = new Map<string, ElementDefinition>();
  private elementsByInternalId = new Map<number, ElementDefinition>();
  private matrixByKey = new Map<string, ElementMatrixItem>();
  private partySelectionRules = new Map<string, PartySelectionRuleItem>();
  private omensById = new Map<string, V2OmenDefinition>();
  private omensByRaidId = new Map<string, V2OmenDefinition[]>();
  private conditionResolvers = new Map<string, V2ConditionResolver>();
  private plainSummonsById = new Map<string, PlainDamageSummon>();
  private plainCharactersById = new Map<string, PlainDamageCharacter>();
  private plainCharactersByElement = new Map<string, PlainDamageCharacter[]>();
  private plainMCById = new Map<string, PlainDamageMC>();
  private plainSolverPipeline: PlainDamageSolverStep[] = [];
  private plainRaidMappings: PlainDamageRaidOmenMapping[] = [];

  // KMS Extensions: Status Effects, Dispel & Cleanse
  private bossBuffsById = new Map<string, BossBuffDefinition>();
  private partyDebuffsById = new Map<string, PartyDebuffDefinition>();
  private dispelSummons: DispelSourceSummon[] = [];
  private dispelMCSkills: DispelSourceMCSkill[] = [];
  private dispelCharacters: DispelSourceCharacter[] = [];
  private cleanseMCSkills: CleanseSourceMCSkill[] = [];
  private cleanseSummons: CleanseSourceSummon[] = [];
  private cleanseCharacters: CleanseSourceCharacter[] = [];
  private zombifiedLockoutActions: string[] = [];

  // KMS Extensions: Supporter Summons & Grid Archetypes
  private gridArchetypesById = new Map<string, GridArchetypeDefinition>();
  private elementalSupportersByElement = new Map<string, ElementalSupportersDefinition>();
  private supporterSelectionRules: SupporterSelectionMatrixItem[] = [];

  // KMS Extensions: Raid Evaluation & Action Priorities
  private raidActionPolicies: RaidActionPolicy[] = [];
  private raidJoinProfilesById = new Map<string, RaidJoinProfile>();
  private raidJoinDecisionSteps: RaidJoinDecisionStep[] = [];
  private tacticalExecutionTiers: TacticalExecutionTier[] = [];

  private rawSelectors: Record<string, any> = {};

  private dataBasePath: string;
  private initialized = false;

  private constructor(basePath?: string) {
    this.dataBasePath = basePath || path.resolve(process.cwd(), 'data');
    this.loadCatalog();
  }

  public static getInstance(basePath?: string): DataCatalogService {
    if (!DataCatalogService.instance) {
      DataCatalogService.instance = new DataCatalogService(basePath);
    }
    return DataCatalogService.instance;
  }

  private loadCatalog(): void {
    try {
      // 1. Load Raids Catalog
      const raidsPath = path.join(this.dataBasePath, 'raids', 'raids.catalog.json');
      if (fs.existsSync(raidsPath)) {
        const data = JSON.parse(fs.readFileSync(raidsPath, 'utf-8'));
        for (const raid of data.raids || []) {
          this.raidsById.set(raid.id.toLowerCase(), raid);
          this.raidsByQuestId.set(raid.questId, raid);
        }
      }

      // 2. Load Categories
      const catPath = path.join(this.dataBasePath, 'raids', 'categories.json');
      if (fs.existsSync(catPath)) {
        const data = JSON.parse(fs.readFileSync(catPath, 'utf-8'));
        for (const cat of data.categories || []) {
          this.categoriesById.set(cat.id.toLowerCase(), cat);
        }
      }

      // 3. Load UI Modals
      const modalsPath = path.join(this.dataBasePath, 'ui', 'modals.catalog.json');
      if (fs.existsSync(modalsPath)) {
        const data = JSON.parse(fs.readFileSync(modalsPath, 'utf-8'));
        for (const modal of data.modals || []) {
          this.modalsById.set(modal.id.toLowerCase(), modal);
        }
      }

      // 4. Load UI Routes
      const routesPath = path.join(this.dataBasePath, 'ui', 'navigation-routes.json');
      if (fs.existsSync(routesPath)) {
        const data = JSON.parse(fs.readFileSync(routesPath, 'utf-8'));
        for (const route of data.routes || []) {
          this.routesByHash.set(route.hash.toLowerCase(), route);
        }
      }

      // 5. Load UI Selectors
      const selectorsPath = path.join(this.dataBasePath, 'ui', 'selectors.catalog.json');
      if (fs.existsSync(selectorsPath)) {
        const data = JSON.parse(fs.readFileSync(selectorsPath, 'utf-8'));
        this.rawSelectors = data.selectors || {};
      }

      // 6. Load Endpoints
      const endpointsPath = path.join(this.dataBasePath, 'network', 'endpoints.catalog.json');
      if (fs.existsSync(endpointsPath)) {
        const data = JSON.parse(fs.readFileSync(endpointsPath, 'utf-8'));
        for (const [name, def] of Object.entries(data.endpoints || {})) {
          this.endpointsByName.set(name.toLowerCase(), def as EndpointDefinition);
        }
      }

      // 7. Load Daily Tasks
      const tasksPath = path.join(this.dataBasePath, 'automation', 'daily-routines.json');
      if (fs.existsSync(tasksPath)) {
        const data = JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
        for (const task of data.tasks || []) {
          this.tasksByTagOrId.set(task.id.toLowerCase(), task);
          if (task.tag) this.tasksByTagOrId.set(task.tag.toLowerCase(), task);
        }
      }

      // 8. Load Elements Catalog
      const elementsPath = path.join(this.dataBasePath, 'elements', 'elements.catalog.json');
      if (fs.existsSync(elementsPath)) {
        const data = JSON.parse(fs.readFileSync(elementsPath, 'utf-8'));
        for (const el of data.elements || []) {
          this.elementsById.set(el.id.toLowerCase(), el);
          this.elementsByInternalId.set(el.internalId, el);
        }
      }

      // 9. Load Elemental Matrix
      const matrixPath = path.join(this.dataBasePath, 'elements', 'elemental-matrix.json');
      if (fs.existsSync(matrixPath)) {
        const data = JSON.parse(fs.readFileSync(matrixPath, 'utf-8'));
        for (const item of data.matrix || []) {
          const key = `${item.attacker.toLowerCase()}_${item.defender.toLowerCase()}`;
          this.matrixByKey.set(key, item);
        }
      }

      // 10. Load Party Selection Rules
      const partyRulesPath = path.join(this.dataBasePath, 'elements', 'party-selection-rules.json');
      if (fs.existsSync(partyRulesPath)) {
        const data = JSON.parse(fs.readFileSync(partyRulesPath, 'utf-8'));
        const rules = data.partySelectionRules?.bossElementToPartyElement || {};
        for (const [bossElem, rule] of Object.entries(rules)) {
          this.partySelectionRules.set(bossElem.toLowerCase(), rule as PartySelectionRuleItem);
        }
      }

      // 11. Load V2 Omens Catalog
      const omensPath = path.join(this.dataBasePath, 'combat', 'omens.catalog.json');
      if (fs.existsSync(omensPath)) {
        const data = JSON.parse(fs.readFileSync(omensPath, 'utf-8'));
        for (const omen of data.omens || []) {
          this.omensById.set(omen.id.toLowerCase(), omen);
          const rId = omen.raidId.toLowerCase();
          const existing = this.omensByRaidId.get(rId) || [];
          existing.push(omen);
          this.omensByRaidId.set(rId, existing);
        }
      }

      // 12. Load V2 Counter Taxonomy
      const taxonomyPath = path.join(this.dataBasePath, 'combat', 'v2-counter-taxonomy.json');
      if (fs.existsSync(taxonomyPath)) {
        const data = JSON.parse(fs.readFileSync(taxonomyPath, 'utf-8'));
        const resolvers = data.conditionResolvers || {};
        for (const [condType, resolver] of Object.entries(resolvers)) {
          this.conditionResolvers.set(condType.toLowerCase(), resolver as V2ConditionResolver);
        }
      }

      // 13. Load Plain Damage Sources Catalog
      const plainSourcesPath = path.join(this.dataBasePath, 'combat', 'plain-damage.catalog.json');
      if (fs.existsSync(plainSourcesPath)) {
        const data = JSON.parse(fs.readFileSync(plainSourcesPath, 'utf-8'));
        const sources = data.sources || {};
        for (const summon of sources.summons || []) {
          this.plainSummonsById.set(summon.id.toLowerCase(), summon);
        }
        for (const character of sources.characters || []) {
          this.plainCharactersById.set(character.id.toLowerCase(), character);
          const elem = character.element.toLowerCase();
          const list = this.plainCharactersByElement.get(elem) || [];
          list.push(character);
          this.plainCharactersByElement.set(elem, list);
        }
        for (const mc of sources.mcClassesAndWeapons || []) {
          this.plainMCById.set(mc.id.toLowerCase(), mc);
        }
      }

      // 14. Load Plain Damage Counter Engine
      const plainEnginePath = path.join(this.dataBasePath, 'combat', 'plain-damage-counter-engine.json');
      if (fs.existsSync(plainEnginePath)) {
        const data = JSON.parse(fs.readFileSync(plainEnginePath, 'utf-8'));
        this.plainSolverPipeline = data.solverPipeline || [];
        this.plainRaidMappings = data.raidOmenMappings || [];
      }

      // 15. Load Status Effects, Dispel & Cleanse Catalog
      const statusEffectsPath = path.join(this.dataBasePath, 'combat', 'status-effects.catalog.json');
      if (fs.existsSync(statusEffectsPath)) {
        const data = JSON.parse(fs.readFileSync(statusEffectsPath, 'utf-8'));
        for (const buff of data.bossBuffs || []) {
          this.bossBuffsById.set(buff.id.toLowerCase(), buff);
        }
        for (const debuff of data.partyDebuffs || []) {
          this.partyDebuffsById.set(debuff.id.toLowerCase(), debuff);
        }
        this.dispelSummons = data.dispelSources?.summons || [];
        this.dispelMCSkills = data.dispelSources?.mcSkills || [];
        this.dispelCharacters = data.dispelSources?.characterHighlights || [];
        this.cleanseMCSkills = data.cleanseSources?.mcSkills || [];
        this.cleanseSummons = data.cleanseSources?.summons || [];
        this.cleanseCharacters = data.cleanseSources?.characterHighlights || [];
        this.zombifiedLockoutActions = data.decisionEngine?.zombifiedSafetyInterlock?.lockoutActions || [];
      }

      // 16. Load Supporter Summons & Grid Archetypes
      const supporterSummonsPath = path.join(this.dataBasePath, 'combat', 'supporter-summons.catalog.json');
      if (fs.existsSync(supporterSummonsPath)) {
        const data = JSON.parse(fs.readFileSync(supporterSummonsPath, 'utf-8'));
        for (const arch of data.gridArchetypes || []) {
          this.gridArchetypesById.set(arch.id.toLowerCase(), arch);
        }
        for (const elemSupp of data.elementalSupporters || []) {
          this.elementalSupportersByElement.set(elemSupp.element.toLowerCase(), elemSupp);
        }
        this.supporterSelectionRules = data.selectionMatrix || [];
      }

      // 17. Load Raid Join Decision Catalog
      const raidJoinPath = path.join(this.dataBasePath, 'raids', 'raid-join-decision.json');
      if (fs.existsSync(raidJoinPath)) {
        const data = JSON.parse(fs.readFileSync(raidJoinPath, 'utf-8'));
        this.raidActionPolicies = data.actionPolicies || [];
        for (const profile of data.raidProfiles || []) {
          this.raidJoinProfilesById.set(profile.raidId.toLowerCase(), profile);
        }
        this.raidJoinDecisionSteps = data.decisionPipeline || [];
      }

      // 18. Load Tactical Action Priority Matrix
      const tacticalPath = path.join(this.dataBasePath, 'combat', 'tactical-action-priority.json');
      if (fs.existsSync(tacticalPath)) {
        const data = JSON.parse(fs.readFileSync(tacticalPath, 'utf-8'));
        this.tacticalExecutionTiers = data.executionTiers || [];
      }

      this.initialized = true;
    } catch (err: any) {
      console.warn('[DataCatalogService] Warning: Failed to load some catalogs:', err.message);
    }
  }

  // Raid Queries
  public getRaidById(raidId: string): RaidCatalogItem | undefined {
    return this.raidsById.get(raidId.toLowerCase());
  }

  public getRaidByQuestId(questId: string): RaidCatalogItem | undefined {
    return this.raidsByQuestId.get(questId);
  }

  public getAllRaids(): RaidCatalogItem[] {
    return Array.from(this.raidsById.values());
  }

  public getRaidsByCategory(category: string): RaidCatalogItem[] {
    return this.getAllRaids().filter(r => r.category.toLowerCase() === category.toLowerCase());
  }

  // Category Queries
  public getCategory(categoryId: string): RaidCategoryDefinition | undefined {
    return this.categoriesById.get(categoryId.toLowerCase());
  }

  public getAllCategories(): RaidCategoryDefinition[] {
    return Array.from(this.categoriesById.values());
  }

  // Modal & Route Queries
  public getModal(modalId: string): ModalDefinition | undefined {
    return this.modalsById.get(modalId.toLowerCase());
  }

  public getRoute(hash: string): NavigationRouteDefinition | undefined {
    return this.routesByHash.get(hash.toLowerCase());
  }

  public getSelectors(): Record<string, any> {
    return this.rawSelectors;
  }

  // Endpoint Queries
  public getEndpoint(name: string): EndpointDefinition | undefined {
    return this.endpointsByName.get(name.toLowerCase());
  }

  // Daily Task Queries
  public getDailyTask(tagOrId: string): DailyAutomationTask | undefined {
    return this.tasksByTagOrId.get(tagOrId.toLowerCase());
  }

  public getAllDailyTasks(): DailyAutomationTask[] {
    // Unique by id
    const seen = new Set<string>();
    const results: DailyAutomationTask[] = [];
    for (const t of this.tasksByTagOrId.values()) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        results.push(t);
      }
    }
    return results;
  }

  // Element Queries
  public getElement(idOrInternalId: string | number): ElementDefinition | undefined {
    if (typeof idOrInternalId === 'number') {
      return this.elementsByInternalId.get(idOrInternalId);
    }
    const num = parseInt(idOrInternalId, 10);
    if (!isNaN(num) && this.elementsByInternalId.has(num)) {
      return this.elementsByInternalId.get(num);
    }
    return this.elementsById.get(idOrInternalId.toLowerCase());
  }

  public getAllElements(): ElementDefinition[] {
    return Array.from(this.elementsById.values());
  }

  public getOptimalElementForBoss(bossElement: string): string {
    const rule = this.partySelectionRules.get(bossElement.toLowerCase());
    if (rule) return rule.optimalPartyElement;
    switch (bossElement.toLowerCase()) {
      case 'fire': return 'water';
      case 'water': return 'earth';
      case 'earth': return 'wind';
      case 'wind': return 'fire';
      case 'light': return 'dark';
      case 'dark': return 'light';
      default: return 'light';
    }
  }

  public getElementMatrix(attacker: string, defender: string): ElementMatrixItem | undefined {
    const key = `${attacker.toLowerCase()}_${defender.toLowerCase()}`;
    return this.matrixByKey.get(key);
  }

  public getSupporterTabForElement(element: string): number {
    const el = this.getElement(element);
    return el ? el.supporterTabAttribute : 7;
  }

  public getPartySelectionRule(bossElement: string): PartySelectionRuleItem | undefined {
    return this.partySelectionRules.get(bossElement.toLowerCase());
  }

  // V2 Omens & Counter Queries
  public getOmenById(id: string): V2OmenDefinition | undefined {
    return this.omensById.get(id.toLowerCase());
  }

  public getOmensByRaidId(raidId: string): V2OmenDefinition[] {
    return this.omensByRaidId.get(raidId.toLowerCase()) || [];
  }

  public getAllOmens(): V2OmenDefinition[] {
    return Array.from(this.omensById.values());
  }

  public getConditionResolver(conditionType: string): V2ConditionResolver | undefined {
    return this.conditionResolvers.get(conditionType.toLowerCase());
  }

  // Plain Damage & Counter Engine Queries
  public getPlainDamageSummons(): PlainDamageSummon[] {
    return Array.from(this.plainSummonsById.values());
  }

  public getPlainDamageSummonById(id: string): PlainDamageSummon | undefined {
    return this.plainSummonsById.get(id.toLowerCase());
  }

  public getPlainDamageCharacters(element?: string): PlainDamageCharacter[] {
    if (element) {
      return this.plainCharactersByElement.get(element.toLowerCase()) || [];
    }
    return Array.from(this.plainCharactersById.values());
  }

  public getPlainDamageCharacterById(id: string): PlainDamageCharacter | undefined {
    return this.plainCharactersById.get(id.toLowerCase());
  }

  public getPlainDamageMCItems(): PlainDamageMC[] {
    return Array.from(this.plainMCById.values());
  }

  public getPlainDamageMCById(id: string): PlainDamageMC | undefined {
    return this.plainMCById.get(id.toLowerCase());
  }

  public getPlainDamageSolverPipeline(): PlainDamageSolverStep[] {
    return this.plainSolverPipeline;
  }

  public getPlainDamageRaidMappings(): PlainDamageRaidOmenMapping[] {
    return this.plainRaidMappings;
  }

  public getPlainDamageMappingForRaid(raidId: string): PlainDamageRaidOmenMapping | undefined {
    return this.plainRaidMappings.find(m => m.raidId.toLowerCase() === raidId.toLowerCase());
  }

  // KMS Queries: Status Effects, Dispel & Cleanse
  public getBossBuff(id: string): BossBuffDefinition | undefined {
    return this.bossBuffsById.get(id.toLowerCase());
  }

  public getAllBossBuffs(): BossBuffDefinition[] {
    return Array.from(this.bossBuffsById.values());
  }

  public getPartyDebuff(id: string): PartyDebuffDefinition | undefined {
    return this.partyDebuffsById.get(id.toLowerCase());
  }

  public getAllPartyDebuffs(): PartyDebuffDefinition[] {
    return Array.from(this.partyDebuffsById.values());
  }

  public isActionBlockedByZombified(action: string): boolean {
    return this.zombifiedLockoutActions.includes(action.toLowerCase());
  }

  public getDispelSummons(): DispelSourceSummon[] {
    return this.dispelSummons;
  }

  public getCleanseMCSkills(): CleanseSourceMCSkill[] {
    return this.cleanseMCSkills;
  }

  // KMS Queries: Supporter Summons & Grid Archetypes
  public getGridArchetype(id: string): GridArchetypeDefinition | undefined {
    return this.gridArchetypesById.get(id.toLowerCase());
  }

  public getAllGridArchetypes(): GridArchetypeDefinition[] {
    return Array.from(this.gridArchetypesById.values());
  }

  public getElementalSupporters(element: string): ElementalSupportersDefinition | undefined {
    return this.elementalSupportersByElement.get(element.toLowerCase());
  }

  public getSupporterSelectionRule(questType: string): SupporterSelectionMatrixItem | undefined {
    return this.supporterSelectionRules.find(r => r.questType.toLowerCase() === questType.toLowerCase());
  }

  // KMS Queries: Raid Join Decision & Evaluation
  public getRaidJoinProfile(raidId: string): RaidJoinProfile | undefined {
    return this.raidJoinProfilesById.get(raidId.toLowerCase());
  }

  public getAllRaidJoinProfiles(): RaidJoinProfile[] {
    return Array.from(this.raidJoinProfilesById.values());
  }

  public getRaidActionPolicies(): RaidActionPolicy[] {
    return this.raidActionPolicies;
  }

  public getTacticalExecutionTiers(): TacticalExecutionTier[] {
    return this.tacticalExecutionTiers;
  }
}

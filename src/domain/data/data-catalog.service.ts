// src/domain/data/data-catalog.service.ts
import fs from 'fs';
import path from 'path';
import {
  RaidCatalogItem,
  RaidCategoryDefinition,
  ModalDefinition,
  NavigationRouteDefinition,
  EndpointDefinition,
  DailyAutomationTask
} from './data-catalog.types.js';

/**
 * DataCatalogService (Singleton / Provider)
 *
 * Adheres to SOLID principles:
 * - Single Responsibility: Manages, indexes, and serves authoritative static game data from data/.
 * - Open/Closed: Extensible via modular JSON loading without code modification.
 * - High Performance: O(1) indexed Map lookups for raids, tasks, selectors, and endpoints.
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
}

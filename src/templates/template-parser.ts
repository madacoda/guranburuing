// src/templates/template-parser.ts
import fs from 'fs';
import path from 'path';
import {
  WorkflowTemplate,
  WorkflowStep
} from '../types/workflow.types.js';
import {
  validateWorkflowTemplate,
  TemplateValidationResult
} from './template-schema.js';
import {
  parseShorthandDsl as compileShorthandDsl,
  parseSingleDslAction as compileSingleDslAction
} from './dsl-compiler.js';
import {
  serializeToDsl as formatTemplateToDsl,
  serializeToJson as formatTemplateToJson
} from './dsl-serializer.js';

// Canonical template alias registry to prevent duplicate workflow files on disk
const CANONICAL_ALIASES: Readonly<Record<string, string>> = {
  'gb-pbhl-universal': 'gb-pbhl',
  'arcarum-faymian-fortress-smart': 'arcarum-faymian-fortress',
  'arcarum-lady-of-redemption-rotation': 'arcarum-lady-of-redemption-smart',
  'arcarum-lilywhite-paragon-rotation': 'arcarum-lilywhite-paragon-smart',
  'arcarum-xeno-cocytus-militis-rotation': 'arcarum-xeno-cocytus-militis',
  'theworld-raid': 'raid-the-world',
  'the-world-raid': 'raid-the-world',
  'world-raid': 'raid-the-world',
  'raid-theworld': 'raid-the-world',
  'arcarum-theworld-raid': 'raid-the-world',
  'arcarum-xeno-cocytus-militis-smart': 'arcarum-xeno-cocytus-militis',
  'arcarum-xeno-cocytus': 'arcarum-xeno-cocytus-militis',
  'xeno-cocytus-militis': 'arcarum-xeno-cocytus-militis',
  'xeno-cocytus': 'arcarum-xeno-cocytus-militis',
  'cocytus-militis': 'arcarum-xeno-cocytus-militis',
  'cocytus': 'arcarum-xeno-cocytus-militis',
  'arcarum-xeno-ifrit-militis-rotation': 'arcarum-xeno-ifrit-militis',
  'arcarum-xeno-ifrit-militis-smart': 'arcarum-xeno-ifrit-militis',
  'arcarum-xeno-ifrit': 'arcarum-xeno-ifrit-militis',
  'xeno-ifrit-militis': 'arcarum-xeno-ifrit-militis',
  'xeno-ifrit': 'arcarum-xeno-ifrit-militis',
  'ifrit-militis': 'arcarum-xeno-ifrit-militis',
  'ifrit': 'arcarum-xeno-ifrit-militis',
  'dark-rapture-hard': 'raid-dark-rapture-hard',
  'dark-rapture-hl': 'raid-dark-rapture-hard',
  'dark-rapture': 'raid-dark-rapture-hard',
  'faahl': 'raid-dark-rapture-hard',
  'faa-hl': 'raid-dark-rapture-hard',
  'lucilius-hard': 'raid-dark-rapture-hard',
  'lucilius-hl': 'raid-dark-rapture-hard',
  'raid-dark-rapture': 'raid-dark-rapture-hard',
  'leech-dark-rapture-hard': 'raid-dark-rapture-hard',
  'leech-faahl': 'raid-dark-rapture-hard',
  'the-fallen-angel-of-cunning': 'raid-the-fallen-angel-of-cunning',
  'fallen-angel-of-cunning': 'raid-the-fallen-angel-of-cunning',
  'fallen-angel': 'raid-the-fallen-angel-of-cunning',
  'cunning': 'raid-the-fallen-angel-of-cunning',
  'belial': 'raid-the-fallen-angel-of-cunning',
  'belial-hl': 'raid-the-fallen-angel-of-cunning',
  'belial-raid': 'raid-the-fallen-angel-of-cunning',
  'raid-belial': 'raid-the-fallen-angel-of-cunning',
  'raid-fallen-angel-of-cunning': 'raid-the-fallen-angel-of-cunning',
  'leech-belial': 'raid-the-fallen-angel-of-cunning',
  'leech-the-fallen-angel-of-cunning': 'raid-the-fallen-angel-of-cunning',
  'long-live-the-king': 'raid-long-live-the-king',
  'the-birth-of-new-king': 'raid-long-live-the-king',
  'birth-of-new-king': 'raid-long-live-the-king',
  'beelzebub': 'raid-long-live-the-king',
  'beelzebub-hl': 'raid-long-live-the-king',
  'bubz': 'raid-long-live-the-king',
  'bubz-hl': 'raid-long-live-the-king',
  'bubs': 'raid-long-live-the-king',
  'bubs-hl': 'raid-long-live-the-king',
  'raid-beelzebub': 'raid-long-live-the-king',
  'raid-bubz': 'raid-long-live-the-king',
  'raid-bubs': 'raid-long-live-the-king',
  'raid-long-live-the-king': 'raid-long-live-the-king',
  'leech-beelzebub': 'raid-long-live-the-king',
  'leech-bubz': 'raid-long-live-the-king',
  'leech-bubs': 'raid-long-live-the-king',
  'leech-long-live-the-king': 'raid-long-live-the-king',
  'fediel': 'raid-fediel',
  'fediel-hl': 'raid-fediel',
  'fediel-raid': 'raid-fediel',
  'raid-fediel': 'raid-fediel',
  'leech-fediel': 'raid-fediel',
  'six-dragons-fediel': 'raid-fediel',
  'dragon-fediel': 'raid-fediel',
  'wilnas': 'raid-wilnas',
  'wilnas-hl': 'raid-wilnas',
  'wilnas-raid': 'raid-wilnas',
  'raid-wilnas': 'raid-wilnas',
  'leech-wilnas': 'raid-wilnas',
  'six-dragons-wilnas': 'raid-wilnas',
  'dragon-wilnas': 'raid-wilnas',
  'lindwurm': 'raid-empyreal-ascension',
  'lindwurm-hl': 'raid-empyreal-ascension',
  'lindwurm-raid': 'raid-empyreal-ascension',
  'raid-lindwurm': 'raid-empyreal-ascension',
  'leech-lindwurm': 'raid-empyreal-ascension',
  'empyreal-ascension': 'raid-empyreal-ascension',
  'empyreal-ascension-impossible': 'raid-empyreal-ascension',
  'emperial-ascension': 'raid-empyreal-ascension',
  'emperial-ascension-impossible': 'raid-empyreal-ascension',
  'empyreal': 'raid-empyreal-ascension',
  'emperial': 'raid-empyreal-ascension',
  'raid-empyreal': 'raid-empyreal-ascension',
  'raid-emperial': 'raid-empyreal-ascension',
  'raid-empyreal-ascension': 'raid-empyreal-ascension',
  'raid-emperial-ascension': 'raid-empyreal-ascension',
  'slime': 'shiny-slime-search',
  'slime-vh': 'shiny-slime-search',
  'shiny-slime': 'shiny-slime-search',
  'shiny-slime-vh': 'shiny-slime-search',
  'shiny-slime-search': 'shiny-slime-search',
  'shiny-slime-search-vh': 'shiny-slime-search',
  'quest-shiny-slime-search': 'shiny-slime-search',
  'quest-slime': 'shiny-slime-search',
  'farm-leviathan': 'farm-leviathan-mare',
  'farm-levi': 'farm-leviathan-mare',
  'farm:leviathan': 'farm-leviathan-mare',
  'farm:levi': 'farm-leviathan-mare',
  'raid-leviathan-mare': 'farm-leviathan-mare',
  'raid-leviathan': 'farm-leviathan-mare',
  'raid-levi': 'farm-leviathan-mare',
  'farm-celeste': 'farm-celeste-ater',
  'farm:celeste': 'farm-celeste-ater',
  'farm-celeste-ater': 'farm-celeste-ater',
  'farm:celeste-ater': 'farm-celeste-ater',
  'farm-ater': 'farm-celeste-ater',
  'farm:ater': 'farm-celeste-ater',
  'raid-celeste-ater': 'farm-celeste-ater',
  'raid-celeste': 'farm-celeste-ater',
  'farm-colossus': 'farm-colossus-ira',
  'farm:colossus': 'farm-colossus-ira',
  'farm-colossus-ira': 'farm-colossus-ira',
  'farm:colossus-ira': 'farm-colossus-ira',
  'farm-ira': 'farm-colossus-ira',
  'farm:ira': 'farm-colossus-ira',
  'raid-colossus-ira': 'farm-colossus-ira',
  'raid-colossus': 'farm-colossus-ira',
  'farm-tiamat': 'farm-tiamat-aura',
  'farm:tiamat': 'farm-tiamat-aura',
  'farm-tiamat-aura': 'farm-tiamat-aura',
  'farm:tiamat-aura': 'farm-tiamat-aura',
  'farm-aura': 'farm-tiamat-aura',
  'farm:aura': 'farm-tiamat-aura',
  'raid-tiamat-aura': 'farm-tiamat-aura',
  'raid-tiamat': 'farm-tiamat-aura',
  'farm-yggdrasil': 'farm-yggdrasil-arbos',
  'farm:yggdrasil': 'farm-yggdrasil-arbos',
  'farm-yggdrasil-arbos': 'farm-yggdrasil-arbos',
  'farm:yggdrasil-arbos': 'farm-yggdrasil-arbos',
  'farm-ygg': 'farm-yggdrasil-arbos',
  'farm:ygg': 'farm-yggdrasil-arbos',
  'farm-arbos': 'farm-yggdrasil-arbos',
  'farm:arbos': 'farm-yggdrasil-arbos',
  'raid-yggdrasil-arbos': 'farm-yggdrasil-arbos',
  'raid-yggdrasil': 'farm-yggdrasil-arbos',
  'farm-luminiera': 'farm-luminiera-credo',
  'farm:luminiera': 'farm-luminiera-credo',
  'farm-luminiera-credo': 'farm-luminiera-credo',
  'farm:luminiera-credo': 'farm-luminiera-credo',
  'farm-lumi': 'farm-luminiera-credo',
  'farm:lumi': 'farm-luminiera-credo',
  'farm-credo': 'farm-luminiera-credo',
  'farm:credo': 'farm-luminiera-credo',
  'raid-luminiera-credo': 'farm-luminiera-credo',
  'raid-luminiera': 'farm-luminiera-credo',
};

const RX_TEMPLATE_EXT = /\.(json|txt|dsl|yaml|yml)$/i;
const RX_JSON_EXT = /\.json$/i;

interface CachedTemplateEntry {
  mtimeMs: number;
  template: WorkflowTemplate;
}

export class TemplateParser {
  private static readonly TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');
  private static readonly templateCache = new Map<string, CachedTemplateEntry>();
  private static readonly nameToPathCache = new Map<string, string>();

  /**
   * Clears the in-memory template cache.
   */
  public static clearCache(): void {
    this.templateCache.clear();
    this.nameToPathCache.clear();
  }

  /**
   * Lists all available JSON workflow template names in the templates directory.
   */
  public static listAvailableTemplates(): string[] {
    if (!fs.existsSync(this.TEMPLATES_DIR)) {
      fs.mkdirSync(this.TEMPLATES_DIR, { recursive: true });
      return [];
    }

    const files = fs.readdirSync(this.TEMPLATES_DIR);
    const seen = new Set<string>();
    for (const f of files) {
      if (RX_JSON_EXT.test(f)) {
        seen.add(f.replace(RX_JSON_EXT, ''));
      }
    }
    return Array.from(seen).sort();
  }

  /**
   * Validates a template object or raw data using strict Zod schema validation.
   */
  public static validate(data: unknown): TemplateValidationResult {
    return validateWorkflowTemplate(data);
  }

  /**
   * Loads and parses a JSON workflow template file by name from templates/*.json.
   * Uses an mtime-validated in-memory cache with deep cloning to prevent mutation leaks.
   */
  public static loadTemplate(templateName: string): WorkflowTemplate {
    const baseName = templateName.replace(RX_TEMPLATE_EXT, '');
    let filePath = this.nameToPathCache.get(baseName);

    if (filePath && !fs.existsSync(filePath)) {
      this.nameToPathCache.delete(baseName);
      filePath = undefined;
    }

    if (!filePath) {
      const altNames = [baseName];

      if (CANONICAL_ALIASES[baseName]) {
        altNames.push(CANONICAL_ALIASES[baseName]);
      }

      if (baseName.startsWith('otkraid-')) {
        altNames.push(`leech-${baseName.slice(8)}`);
      } else if (baseName.startsWith('leech-')) {
        altNames.push(`otkraid-${baseName.slice(6)}`);
      } else {
        altNames.push(`leech-${baseName}`);
        altNames.push(`otkraid-${baseName}`);
      }

      for (const name of altNames) {
        const candidate = path.join(this.TEMPLATES_DIR, `${name}.json`);
        if (fs.existsSync(candidate)) {
          filePath = candidate;
          this.nameToPathCache.set(baseName, candidate);
          break;
        }
      }
    }

    if (!filePath) {
      throw new Error(
        `[TemplateParser] JSON workflow template "${templateName}" not found in ${this.TEMPLATES_DIR}.\nAvailable: ${this.listAvailableTemplates().join(', ') || 'None'}`
      );
    }

    const stat = fs.statSync(filePath);
    const cached = this.templateCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return structuredClone(cached.template);
    }

    const rawContent = fs.readFileSync(filePath, 'utf-8').trim();

    try {
      const rawJson = JSON.parse(rawContent);
      const validation = validateWorkflowTemplate(rawJson);
      if (validation.valid && validation.template) {
        if (validation.warnings.length > 0) {
          console.warn(`[TemplateParser] ⚠️ Warnings in "${templateName}":\n  - ${validation.warnings.join('\n  - ')}`);
        }
        this.templateCache.set(filePath, { mtimeMs: stat.mtimeMs, template: validation.template });
        return structuredClone(validation.template);
      } else {
        throw new Error(
          `[TemplateParser] Invalid template structure in "${filePath}":\n  - ${validation.errors.join('\n  - ')}`
        );
      }
    } catch (err: any) {
      if (err.message.includes('[TemplateParser] Invalid template structure')) {
        throw err;
      }
      throw new Error(`[TemplateParser] JSON syntax error in "${filePath}": ${err.message}`);
    }
  }

  /**
   * Parses human-written shorthand DSL text. Alias for parseShorthandDsl.
   */
  public static parseDsl(content: string, defaultName = 'dsl-template'): WorkflowTemplate {
    return compileShorthandDsl(content, defaultName);
  }

  /**
   * Parses human-written shorthand DSL text supporting metadata directives,
   * compact action abbreviations, repeat blocks, and conditional exits.
   */
  public static parseShorthandDsl(content: string, defaultName: string): WorkflowTemplate {
    return compileShorthandDsl(content, defaultName);
  }

  /**
   * Helper that parses an individual action line into a typed WorkflowStep.
   */
  private static parseSingleDslAction(
    rawLine: string,
    stepIndex: number,
    getReadyOccurrence?: () => number,
    hasPriorCombatActions?: () => boolean
  ): WorkflowStep | null {
    return compileSingleDslAction(rawLine, stepIndex, getReadyOccurrence, hasPriorCombatActions);
  }

  /**
   * Serializes a WorkflowTemplate into clean, human-readable DSL format.
   */
  public static serializeToDsl(template: WorkflowTemplate): string {
    return formatTemplateToDsl(template);
  }

  /**
   * Serializes a WorkflowTemplate to a JSON string.
   */
  public static serializeToJson(template: WorkflowTemplate, pretty = true): string {
    return formatTemplateToJson(template, pretty);
  }

  /**
   * Saves a WorkflowTemplate to the templates directory in JSON or DSL format.
   */
  public static saveTemplate(
    template: WorkflowTemplate,
    format: 'json' | 'dsl' = 'json',
    fileName?: string
  ): string {
    const slug = (fileName || template.name).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const targetFile = path.join(this.TEMPLATES_DIR, `${slug}.${format}`);
    const content = format === 'dsl' ? this.serializeToDsl(template) : this.serializeToJson(template);
    fs.writeFileSync(targetFile, content, 'utf-8');
    this.templateCache.delete(targetFile);
    return targetFile;
  }
}

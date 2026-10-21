// src/domain/assist/search-raid.catalog.ts
import { SearchRaidDefinition, SearchRaidQuery } from './search-raid.types.js';

/**
 * Authoritative Catalog of searchable raids in Granblue Fantasy Backup Requests (#quest/assist).
 * Mapped directly from live in-game CDP inspection of the Set Filters modal (.pop-search-setting).
 */
export const SEARCH_RAID_CATALOG: readonly SearchRaidDefinition[] = Object.freeze([
  // ---------------------------------------------------------------------------
  // Endgame HL Raids: Stage 12071 (Dark Rapture Hard, Beelzebub, Belial, The World)
  // ---------------------------------------------------------------------------
  {
    questId: '305181',
    stageId: '12071',
    stageType: '2',
    name: 'Long Live the King',
    aliases: [
      'long live the king', 'beelzebub', 'beelzebub-hl', 'bubz', 'bubz-hl',
      'bubs', 'bubs-hl', 'the birth of new king', 'birth of new king',
      'ベルゼバブ', 'バブhl', 'バブさん', 'バース・オブ・ニューキング'
    ],
    bossName: 'Beelzebub',
    category: 'endgame'
  },
  {
    questId: '303281',
    stageId: '12071',
    stageType: '2',
    name: 'Dark Rapture (Hard)',
    aliases: [
      'dark rapture (hard)', 'dark rapture hard', 'lucilius', 'faahl', 'faa-hl',
      'faa', 'ルシファーhl', 'ルシhl', 'ダーク・ラプチャー'
    ],
    bossName: 'Lucilius',
    category: 'endgame'
  },
  {
    questId: '305281',
    stageId: '12071',
    stageType: '2',
    name: 'The Fallen Angel of Cunning',
    aliases: [
      'the fallen angel of cunning', 'fallen angel', 'belial', 'belial-hl',
      'ベリアル', 'ベリアルhl', '狡知'
    ],
    bossName: 'Belial',
    category: 'endgame'
  },
  {
    questId: '305571',
    stageId: '12071',
    stageType: '2',
    name: 'The World (Impossible)',
    aliases: [
      'the world (impossible)', 'the world', 'world', 'ザ・ワールド', 'ワールドhl'
    ],
    bossName: 'The World',
    category: 'endgame'
  },

  // ---------------------------------------------------------------------------
  // Magna 3 / Omega 3 Raids: Stage 12042
  // ---------------------------------------------------------------------------
  {
    questId: '305601',
    stageId: '12042',
    stageType: '2',
    name: 'Tiamat Aura Omega (Impossible)',
    aliases: [
      'tiamat aura omega (impossible)', 'tiamat aura', 'tiamat aura omega',
      'tiamat m3', 'm3 wind', 'ティアマト・アウラ', 'ティアマト・アウラ・マグナ'
    ],
    bossName: 'Tiamat Aura Omega',
    category: 'magna3'
  },
  {
    questId: '305611',
    stageId: '12042',
    stageType: '2',
    name: 'Colossus Ira Omega (Impossible)',
    aliases: [
      'colossus ira omega (impossible)', 'colossus ira', 'colossus ira omega',
      'colossus m3', 'm3 fire', 'コロッサス・アイラ', 'コロッサス・アイラ・マグナ'
    ],
    bossName: 'Colossus Ira Omega',
    category: 'magna3'
  },
  {
    questId: '305631',
    stageId: '12042',
    stageType: '2',
    name: 'Leviathan Mare Omega (Impossible)',
    aliases: [
      'leviathan mare omega (impossible)', 'leviathan mare', 'leviathan mare omega',
      'leviathan m3', 'm3 water', 'リヴァイアサン・マレ', 'リヴァイアサン・マレ・マグナ'
    ],
    bossName: 'Leviathan Mare Omega',
    category: 'magna3'
  },
  {
    questId: '305641',
    stageId: '12042',
    stageType: '2',
    name: 'Yggdrasil Arbos Omega (Impossible)',
    aliases: [
      'yggdrasil arbos omega (impossible)', 'yggdrasil arbos', 'yggdrasil arbos omega',
      'yggdrasil m3', 'm3 earth', 'ユグドラシル・アルボース', 'ユグドラシル・アルボース・マグナ'
    ],
    bossName: 'Yggdrasil Arbos Omega',
    category: 'magna3'
  },
  {
    questId: '305591',
    stageId: '12042',
    stageType: '2',
    name: 'Luminiera Credo Omega (Impossible)',
    aliases: [
      'luminiera credo omega (impossible)', 'luminiera credo', 'luminiera credo omega',
      'chevalier credo', 'luminiera m3', 'm3 light', 'シュヴァリエ・クレド', 'シュヴァリエ・クレド・マグナ'
    ],
    bossName: 'Luminiera Credo Omega',
    category: 'magna3'
  },
  {
    questId: '305621',
    stageId: '12042',
    stageType: '2',
    name: 'Celeste Ater Omega (Impossible)',
    aliases: [
      'celeste ater omega (impossible)', 'celeste ater', 'celeste ater omega',
      'celeste m3', 'm3 dark', 'セレスト・アテル', 'セレスト・アテル・マグナ'
    ],
    bossName: 'Celeste Ater Omega',
    category: 'magna3'
  },

  // ---------------------------------------------------------------------------
  // High Level Gold Bar / Uncapping: Stage 12061
  // ---------------------------------------------------------------------------
  {
    questId: '301061',
    stageId: '12061',
    stageType: '2',
    name: 'Wings of Terror (Impossible)',
    aliases: [
      'wings of terror (impossible)', 'wings of terror', 'proto bahamut', 'proto bahamut hl',
      'pbhl', 'つよバハ', 'プロトバハムートhl'
    ],
    bossName: 'Proto Bahamut',
    category: 'hl_gold_bar'
  },
  {
    questId: '303251',
    stageId: '12061',
    stageType: '2',
    name: 'Omen of the Broken Skies',
    aliases: [
      'omen of the broken skies', 'akasha', 'akasha hl', 'アーカーシャ', 'アーカーシャhl'
    ],
    bossName: 'Akasha',
    category: 'hl_gold_bar'
  },
  {
    questId: '305161',
    stageId: '12061',
    stageType: '2',
    name: "The Peacemaker's Wings (Impossible)",
    aliases: [
      "the peacemaker's wings (impossible)", "the peacemaker's wings", 'peacemaker',
      'grand order', 'grand order hl', 'gohl', 'グランデhl', 'ジ・オーダー・グランデ'
    ],
    bossName: 'Grand Order',
    category: 'hl_gold_bar'
  },
  {
    questId: '303141',
    stageId: '12061',
    stageType: '2',
    name: 'Empyreal Ascension (Impossible)',
    aliases: [
      'empyreal ascension (impossible)', 'empyreal ascension', 'lindwurm', 'lindwurm hl',
      'リンドブルム', 'リンドブルムhl'
    ],
    bossName: 'Lindwurm',
    category: 'hl_gold_bar'
  },

  // ---------------------------------------------------------------------------
  // Six Dragons: Stage 12051
  // ---------------------------------------------------------------------------
  {
    questId: '305191',
    stageId: '12051',
    stageType: '2',
    name: 'Wilnas (Impossible)',
    aliases: ['wilnas (impossible)', 'wilnas', 'ウィルナス', 'ウィルナスhl'],
    bossName: 'Wilnas',
    category: 'dragons'
  },
  {
    questId: '305201',
    stageId: '12051',
    stageType: '2',
    name: 'Wamdus (Impossible)',
    aliases: ['wamdus (impossible)', 'wamdus', 'ワムデュス', 'ワムデュスhl'],
    bossName: 'Wamdus',
    category: 'dragons'
  },
  {
    questId: '305211',
    stageId: '12051',
    stageType: '2',
    name: 'Galleon (Impossible)',
    aliases: ['galleon (impossible)', 'galleon', 'ガレヲン', 'ガレヲンhl'],
    bossName: 'Galleon',
    category: 'dragons'
  },
  {
    questId: '305221',
    stageId: '12051',
    stageType: '2',
    name: 'Ewiyar (Impossible)',
    aliases: ['ewiyar (impossible)', 'ewiyar', 'イーウィヤ', 'イーウィヤhl'],
    bossName: 'Ewiyar',
    category: 'dragons'
  },
  {
    questId: '305231',
    stageId: '12051',
    stageType: '2',
    name: 'Lu Woh (Impossible)',
    aliases: ['lu woh (impossible)', 'lu woh', 'ル・オー', 'ル・オーhl'],
    bossName: 'Lu Woh',
    category: 'dragons'
  },
  {
    questId: '305241',
    stageId: '12051',
    stageType: '2',
    name: 'Fediel (Impossible)',
    aliases: ['fediel (impossible)', 'fediel', 'フェディエル', 'フェディエルhl'],
    bossName: 'Fediel',
    category: 'dragons'
  },

  // ---------------------------------------------------------------------------
  // Revans Series: Stage 12072
  // ---------------------------------------------------------------------------
  {
    questId: '305381',
    stageId: '12072',
    stageType: '2',
    name: 'Mugen (Impossible)',
    aliases: ['mugen (impossible)', 'mugen', 'ムゲン', 'ムゲンhl'],
    bossName: 'Mugen',
    category: 'revans'
  },
  {
    questId: '305391',
    stageId: '12072',
    stageType: '2',
    name: 'Diaspora (Impossible)',
    aliases: ['diaspora (impossible)', 'diaspora', 'ディアスポラ', 'ディアスポラhl'],
    bossName: 'Diaspora',
    category: 'revans'
  },
  {
    questId: '305401',
    stageId: '12072',
    stageType: '2',
    name: 'Siegfried (Impossible)',
    aliases: ['siegfried (impossible)', 'siegfried', 'ジークフリート', 'ジークフリートhl'],
    bossName: 'Siegfried',
    category: 'revans'
  },
  {
    questId: '305411',
    stageId: '12072',
    stageType: '2',
    name: 'Seofon (Impossible)',
    aliases: ['seofon (impossible)', 'seofon', 'siete', 'シエテ', 'シエテhl'],
    bossName: 'Seofon',
    category: 'revans'
  },
  {
    questId: '305481',
    stageId: '12072',
    stageType: '2',
    name: 'Agastia (Impossible)',
    aliases: ['agastia (impossible)', 'agastia', 'アガスティア', 'アガスティアhl'],
    bossName: 'Agastia',
    category: 'revans'
  },
  {
    questId: '305491',
    stageId: '12072',
    stageType: '2',
    name: 'Cosmos (Impossible)',
    aliases: ['cosmos (impossible)', 'cosmos', 'コスモス', 'コスモスhl'],
    bossName: 'Cosmos',
    category: 'revans'
  },

  // ---------------------------------------------------------------------------
  // Apex / Super Endgame: Stage 12081 & 12091
  // ---------------------------------------------------------------------------
  {
    questId: '305361',
    stageId: '12081',
    stageType: '2',
    name: 'Super Ultimate Bahamut',
    aliases: ['super ultimate bahamut', 'subaha', 'スパバハ', 'スーパーアルティメットバハムート'],
    bossName: 'Super Ultimate Bahamut',
    category: 'apex'
  },
  {
    questId: '305541',
    stageId: '12081',
    stageType: '2',
    name: 'The Six Dragons of Hexachrome',
    aliases: ['the six dragons of hexachrome', 'hexachrome', '天元', '天元たる六色の理'],
    bossName: 'Hexachrome',
    category: 'apex'
  },
  {
    questId: '305581',
    stageId: '12081',
    stageType: '2',
    name: 'Dark Rapture (Zero)',
    aliases: ['dark rapture (zero)', 'dark rapture zero', 'faazero', 'faa-zero', 'ルシゼロ'],
    bossName: 'Lucilius (Zero)',
    category: 'apex'
  }
]);

/**
 * Resolves a search raid definition from query strings (questId, targetEnemy, template name, etc.) or a plain string.
 */
export function resolveSearchRaid(query: string | SearchRaidQuery): SearchRaidDefinition | null {
  if (typeof query === 'string') {
    const raw = query.trim();
    if (!raw) return null;
    query = {
      questId: /^\d+$/.test(raw) ? raw : undefined,
      targetEnemy: raw,
      name: raw
    };
  }

  const qIdStr = query.questId ? String(query.questId).trim() : '';

  // 1. Direct questId lookup
  if (qIdStr) {
    const directMatch = SEARCH_RAID_CATALOG.find(r => r.questId === qIdStr);
    if (directMatch) return directMatch;
  }

  // 2. Aggregate searchable terms
  const searchTerms = [
    query.targetEnemy,
    query.name,
    query.description
  ]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(s => s.toLowerCase());

  if (searchTerms.length === 0) return null;

  // 3. Exact alias match
  for (const term of searchTerms) {
    for (const raid of SEARCH_RAID_CATALOG) {
      if (raid.name.toLowerCase() === term) return raid;
      if (raid.aliases.some(a => a.toLowerCase() === term)) return raid;
    }
  }

  // 4. Substring / Token match
  for (const term of searchTerms) {
    for (const raid of SEARCH_RAID_CATALOG) {
      if (term.includes(raid.name.toLowerCase())) return raid;
      if (raid.aliases.some(a => term.includes(a.toLowerCase()))) return raid;
    }
  }

  return null;
}

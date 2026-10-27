// src/domain/assist/search-raid.catalog.ts
import { SearchRaidDefinition, SearchRaidQuery, RaidCardFilterSpec } from './search-raid.types.js';

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
      'pbhl', 'つよバハ', 'プロトバハムートhl', 'プロトバハムート'
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
      'grand order', 'grand order hl', 'gohl', 'グランデhl', 'ジ・オーダー・グランデ', 'グランデ'
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
    questId: '305421',
    stageId: '12072',
    stageType: '2',
    name: 'Cosmos (Impossible)',
    aliases: ['cosmos (impossible)', 'cosmos', 'コスモス', 'コスモスhl'],
    bossName: 'Cosmos',
    category: 'revans'
  },
  {
    questId: '305431',
    stageId: '12072',
    stageType: '2',
    name: 'Agastia (Impossible)',
    aliases: ['agastia (impossible)', 'agastia', 'アガスティア', 'アガスティアhl'],
    bossName: 'Agastia',
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
  },

  // ---------------------------------------------------------------------------
  // Regalia / Magna 2 (Impossible): Stage 12021
  // ---------------------------------------------------------------------------
  {
    questId: '303151',
    stageId: '12021',
    stageType: '2',
    name: 'Shiva (Impossible)',
    aliases: ['shiva (impossible)', 'shiva hl', 'シヴァhl', 'シヴァ (hl)'],
    bossName: 'Shiva',
    category: 'regalia_m2'
  },
  {
    questId: '303161',
    stageId: '12021',
    stageType: '2',
    name: 'Europa (Impossible)',
    aliases: ['europa (impossible)', 'europa hl', 'エウロペhl', 'エウロペ (hl)'],
    bossName: 'Europa',
    category: 'regalia_m2'
  },
  {
    questId: '303171',
    stageId: '12021',
    stageType: '2',
    name: 'Godsworn Alexiel (Impossible)',
    aliases: ['godsworn alexiel (impossible)', 'alexiel (impossible)', 'alexiel hl', 'ブローディアhl'],
    bossName: 'Godsworn Alexiel',
    category: 'regalia_m2'
  },
  {
    questId: '303181',
    stageId: '12021',
    stageType: '2',
    name: 'Grimnir (Impossible)',
    aliases: ['grimnir (impossible)', 'grimnir hl', 'グリームニルhl'],
    bossName: 'Grimnir',
    category: 'regalia_m2'
  },
  {
    questId: '303191',
    stageId: '12021',
    stageType: '2',
    name: 'Metatron (Impossible)',
    aliases: ['metatron (impossible)', 'metatron hl', 'メタトロンhl'],
    bossName: 'Metatron',
    category: 'regalia_m2'
  },
  {
    questId: '303201',
    stageId: '12021',
    stageType: '2',
    name: 'Avatar (Impossible)',
    aliases: ['avatar (impossible)', 'avatar hl', 'アバターhl'],
    bossName: 'Avatar',
    category: 'regalia_m2'
  },

  // ---------------------------------------------------------------------------
  // Ennead Series: Stage 12022
  // ---------------------------------------------------------------------------
  {
    questId: '305301',
    stageId: '12022',
    stageType: '2',
    name: 'Atum (Impossible)',
    aliases: ['atum (impossible)', 'atum hl', 'アトゥムhl'],
    bossName: 'Atum',
    category: 'ennead'
  },
  {
    questId: '305291',
    stageId: '12022',
    stageType: '2',
    name: 'Tefnut (Impossible)',
    aliases: ['tefnut (impossible)', 'tefnut hl', 'テフヌトhl'],
    bossName: 'Tefnut',
    category: 'ennead'
  },
  {
    questId: '305341',
    stageId: '12022',
    stageType: '2',
    name: 'Bennu (Impossible)',
    aliases: ['bennu (impossible)', 'bennu hl', 'ベンヌhl'],
    bossName: 'Bennu',
    category: 'ennead'
  },
  {
    questId: '305351',
    stageId: '12022',
    stageType: '2',
    name: 'Ra (Impossible)',
    aliases: ['ra (impossible)', 'ra hl', 'ラーhl'],
    bossName: 'Ra',
    category: 'ennead'
  },
  {
    questId: '305331',
    stageId: '12022',
    stageType: '2',
    name: 'Horus (Impossible)',
    aliases: ['horus (impossible)', 'horus hl', 'ホルスhl'],
    bossName: 'Horus',
    category: 'ennead'
  },
  {
    questId: '305321',
    stageId: '12022',
    stageType: '2',
    name: 'Osiris (Impossible)',
    aliases: ['osiris (impossible)', 'osiris hl', 'オシリスhl'],
    bossName: 'Osiris',
    category: 'ennead'
  },

  // ---------------------------------------------------------------------------
  // Malice & Menace Series: Stage 12031
  // ---------------------------------------------------------------------------
  {
    questId: '303241',
    stageId: '12031',
    stageType: '2',
    name: 'Tiamat Malice (Impossible)',
    aliases: ['tiamat malice (impossible)', 'tiamat malice', 'ティアマト・マリス'],
    bossName: 'Tiamat Malice',
    category: 'malice_menace'
  },
  {
    questId: '305141',
    stageId: '12031',
    stageType: '2',
    name: 'Leviathan Malice (Impossible)',
    aliases: ['leviathan malice (impossible)', 'leviathan malice', 'リヴァイアサン・マリス'],
    bossName: 'Leviathan Malice',
    category: 'malice_menace'
  },
  {
    questId: '305171',
    stageId: '12031',
    stageType: '2',
    name: 'Phronesis (Impossible)',
    aliases: ['phronesis (impossible)', 'phronesis', 'フロネシス', 'フロネシスhl'],
    bossName: 'Phronesis',
    category: 'malice_menace'
  },
  {
    questId: '305251',
    stageId: '12031',
    stageType: '2',
    name: 'Luminiera Malice (Impossible)',
    aliases: ['luminiera malice (impossible)', 'luminiera malice', 'シュヴァリエ・マリス'],
    bossName: 'Luminiera Malice',
    category: 'malice_menace'
  },
  {
    questId: '305271',
    stageId: '12031',
    stageType: '2',
    name: 'Anima-Animus Core (Impossible)',
    aliases: ['anima-animus core (impossible)', 'anima-animus core', 'anima animus', 'アニマ・アニムス・コア'],
    bossName: 'Anima-Animus Core',
    category: 'malice_menace'
  },
  {
    questId: '305371',
    stageId: '12031',
    stageType: '2',
    name: 'Legion Void (Impossible)',
    aliases: ['legion void (impossible)', 'legion void', 'レギオン・ヴォイド'],
    bossName: 'Legion Void',
    category: 'malice_menace'
  },

  // ---------------------------------------------------------------------------
  // Primarchs & Huanglong / Qilin / Ultimate Bahamut HL: Stage 12041 & 12061
  // ---------------------------------------------------------------------------
  {
    questId: '303131',
    stageId: '12041',
    stageType: '2',
    name: 'The Four Primarchs (Impossible)',
    aliases: ['the four primarchs (impossible)', 'the four primarchs', 'four primarchs', '四大天司hl'],
    bossName: 'The Four Primarchs',
    category: 'primarch_and_qilin'
  },
  {
    questId: '303061',
    stageId: '12041',
    stageType: '2',
    name: 'Huanglong & Qilin (Impossible)',
    aliases: ['huanglong & qilin (impossible)', 'huanglong & qilin', 'huanglong and qilin', '黄龍・黒麒麟hl'],
    bossName: 'Huanglong & Qilin',
    category: 'primarch_and_qilin'
  },
  {
    questId: '303051',
    stageId: '12061',
    stageType: '2',
    name: 'Ultimate Bahamut (Impossible)',
    aliases: ['ultimate bahamut (impossible)', 'ultimate bahamut hl', 'ubhl', 'アルバハhl', 'アルティメットバハムートhl'],
    bossName: 'Ultimate Bahamut',
    category: 'hl_gold_bar'
  }
]);

function matchesTermToken(term: string, token: string): boolean {
  const lowerToken = token.toLowerCase();
  if (!lowerToken) return false;
  if (term === lowerToken) return true;
  // For short pure-ASCII tokens (<= 4 chars), enforce word boundary to prevent substring false positives
  if (/^[a-z0-9-]+$/i.test(lowerToken) && lowerToken.length <= 4) {
    const escaped = lowerToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(term);
  }
  return term.includes(lowerToken);
}

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
      if (raid.bossName && raid.bossName.toLowerCase() === term) return raid;
      if (raid.aliases.some(a => a.toLowerCase() === term)) return raid;
    }
  }

  // 4. Substring / Token match
  for (const term of searchTerms) {
    for (const raid of SEARCH_RAID_CATALOG) {
      if (matchesTermToken(term, raid.name)) return raid;
      if (raid.aliases.some(a => matchesTermToken(term, a))) return raid;
    }
  }

  return null;
}

/**
 * Builds a serializable RaidCardFilterSpec for verifying DOM cards in #prt-search-list
 * against the target raid and rejecting cross-slot contamination from any other raid in the catalog.
 */
export function buildRaidCardFilterSpec(
  queryOrRaid?: SearchRaidDefinition | SearchRaidQuery | string | null
): RaidCardFilterSpec {
  const targetRaid: SearchRaidDefinition | null =
    !queryOrRaid
      ? null
      : typeof queryOrRaid === 'object' && 'stageId' in queryOrRaid && 'aliases' in queryOrRaid
        ? (queryOrRaid as SearchRaidDefinition)
        : resolveSearchRaid(queryOrRaid as SearchRaidQuery | string);

  if (!targetRaid) {
    return {
      positiveTokens: [],
      foreignQuestIds: [],
      foreignTokens: []
    };
  }

  const positiveSet = new Set<string>();
  positiveSet.add(targetRaid.name.toLowerCase());
  if (targetRaid.bossName) positiveSet.add(targetRaid.bossName.toLowerCase());
  for (const alias of targetRaid.aliases) {
    if (alias.trim().length >= 3) {
      positiveSet.add(alias.toLowerCase());
    }
  }
  const positiveTokens = Array.from(positiveSet);

  const foreignQuestIdSet = new Set<string>();
  const foreignTokenSet = new Set<string>();

  for (const other of SEARCH_RAID_CATALOG) {
    if (other.questId === targetRaid.questId) continue;
    foreignQuestIdSet.add(other.questId);

    const candidateForeignStrings = [
      other.name.toLowerCase(),
      other.bossName?.toLowerCase(),
      ...other.aliases.map(a => a.toLowerCase())
    ].filter((s): s is string => !!s && s.length >= 3);

    for (const token of candidateForeignStrings) {
      // Do not add a foreign token if it is a substring of the target raid's own canonical name or bossName
      const isSubstringOfTarget =
        targetRaid.name.toLowerCase().includes(token) ||
        (targetRaid.bossName ? targetRaid.bossName.toLowerCase().includes(token) : false);
      if (!isSubstringOfTarget && !positiveSet.has(token)) {
        foreignTokenSet.add(token);
      }
    }
  }

  return {
    targetQuestId: targetRaid.questId,
    targetName: targetRaid.name,
    positiveTokens,
    foreignQuestIds: Array.from(foreignQuestIdSet),
    foreignTokens: Array.from(foreignTokenSet)
  };
}

/**
 * Pure helper (also usable inside page.evaluate or unit tests) that verifies whether
 * a scanned raid card's title and thumbnail image match the target RaidCardFilterSpec.
 */
export function matchesRaidCardFilter(
  cardTitle: string,
  cardImgSrc: string,
  spec: RaidCardFilterSpec
): boolean {
  if (!spec || (!spec.targetQuestId && spec.positiveTokens.length === 0)) {
    return true;
  }

  const imgSrc = (cardImgSrc || '').trim();
  const title = (cardTitle || '').toLowerCase().trim();

  // 1. Exact Quest ID match in thumbnail image URL
  if (spec.targetQuestId && imgSrc.includes(spec.targetQuestId)) {
    return true;
  }

  // 2. Foreign Quest ID in thumbnail image URL -> immediate cross-slot rejection
  if (imgSrc && spec.foreignQuestIds.some(fid => imgSrc.includes(fid))) {
    return false;
  }

  // 3. Title inspection
  if (title) {
    // Check if any foreign token appears in the card title
    const matchedForeignTokens = spec.foreignTokens.filter(ft => title.includes(ft));
    if (matchedForeignTokens.length > 0) {
      // Only allow if a positive token is present that is longer/more specific than every matched foreign token
      const maxForeignLen = Math.max(...matchedForeignTokens.map(ft => ft.length));
      const hasMoreSpecificPositive = spec.positiveTokens.some(
        pt => title.includes(pt) && pt.length > maxForeignLen
      );
      if (!hasMoreSpecificPositive) {
        return false;
      }
    }
  }

  return true;
}

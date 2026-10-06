// src/relay/presence-templates.ts
import fs from 'fs';
import path from 'path';

export type PresenceMode = 'work' | 'gbf' | 'trade';

export interface FormattedPresence {
  name: string;        // Bot Status Activity Name (e.g. "Working on Every Hero", "Raid Akasha 152", "Market Execution")
  details: string;     // Top subtitle
  state: string;       // Bottom subtitle
  smallText?: string;  // Hover tooltip on small badge
  largeText?: string;  // Hover tooltip on large badge
}

export interface PresenceCustomOptions {
  mode?: PresenceMode;
  project?: string;
  task?: string;
  quote?: string;
  author?: string;
  ticker?: string;
}

export interface PresenceStorageData {
  mode: PresenceMode;
  project?: string;
  task?: string;
  quote?: string;
  updatedAt?: string;
}

export const TRADING_QUOTES = [
  { quote: 'Plan your trade and trade your plan.', author: 'Risk Principle' },
  { quote: 'Cut your losses quickly, let your winners run.', author: 'Jesse Livermore' },
  { quote: 'Risk comes from not knowing what you are doing.', author: 'Warren Buffett' },
  { quote: 'Amateurs focus on profits. Professionals focus on risk.', author: 'Mark Douglas' },
  { quote: "Don't focus on making money, focus on protecting capital.", author: 'Paul Tudor Jones' },
  { quote: 'The market transfers wealth from the impatient to the patient.', author: 'Warren Buffett' },
  { quote: 'Trade what you see, not what you think.', author: 'Technical Axiom' },
  { quote: 'Patience is the currency of the successful trader.', author: 'Trading Psychology' },
  { quote: 'Discipline over emotions. Execution over hesitation.', author: 'Mental Edge' },
  { quote: 'The trend is your friend until the end when it bends.', author: 'Ed Seykota' },
  { quote: "It's not about being right, it's about staying solvent.", author: 'Risk Paradigm' }
];

const MODE_CONFIG_FILE = path.resolve(process.cwd(), 'data', 'presence-mode.json');

/**
 * Loads persisted presence mode configuration from data/presence-mode.json
 */
export function loadPresenceConfig(): PresenceStorageData {
  try {
    if (fs.existsSync(MODE_CONFIG_FILE)) {
      const raw = fs.readFileSync(MODE_CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.mode === 'string') {
        return parsed;
      }
    }
  } catch {}

  const envMode = (process.env.DISCORD_PRESENCE_MODE || 'gbf').toLowerCase() as PresenceMode;
  return {
    mode: ['work', 'trade', 'gbf'].includes(envMode) ? envMode : 'gbf',
    project: process.env.DISCORD_PRESENCE_PROJECT || 'Every Hero'
  };
}

/**
 * Persists presence mode selection to data/presence-mode.json
 */
export function savePresenceConfig(data: PresenceStorageData): void {
  try {
    const dataDir = path.dirname(MODE_CONFIG_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const payload: PresenceStorageData = {
      ...data,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(MODE_CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('[Presence] Notice saving mode config:', err.message);
  }
}

/**
 * Formats presence for "work" template
 * Example:
 * Name: "Working on Every Hero"
 * Details: "Working hard on Every Hero"
 * State: "Deep focus mode 🚀 | In the zone"
 */
export function formatWorkPresence(options?: PresenceCustomOptions): FormattedPresence {
  const project = options?.project || process.env.DISCORD_PRESENCE_PROJECT || 'Every Hero';
  const task = options?.task || `Working hard on ${project}`;

  return {
    name: `Working on ${project}`,
    details: task,
    state: `Deep focus mode 🚀 | Building features`,
    largeText: `${project} Architecture`,
    smallText: `In the Zone 💻`
  };
}

/**
 * Formats presence for "trade" template
 * Selects a powerful trading wisdom quote or uses custom quote.
 * Example:
 * Name: "Market Execution 📈"
 * Details: "Trading Strategy & Risk Management"
 * State: "\"Plan your trade and trade your plan.\""
 */
export function formatTradePresence(options?: PresenceCustomOptions): FormattedPresence {
  let quoteText = options?.quote;
  let author = options?.author;

  if (!quoteText) {
    // Deterministic random or hourly cycling quote
    const hourIdx = Math.floor(Date.now() / (1000 * 60 * 30)) % TRADING_QUOTES.length;
    const selected = TRADING_QUOTES[hourIdx] || TRADING_QUOTES[0];
    quoteText = selected.quote;
    author = selected.author;
  }

  const stateLine = author ? `"${quoteText}" — ${author}` : `"${quoteText}"`;

  return {
    name: 'Market Execution 📈',
    details: 'Trading Strategy & Risk Management',
    state: stateLine.length > 120 ? `"${quoteText}"` : stateLine,
    largeText: 'Quantitative Discipline',
    smallText: 'Risk Management First 📊'
  };
}

/**
 * Formats presence for "gbf" template (Granblue Fantasy farming telemetry)
 */
export function formatGbfPresence(state: any): FormattedPresence {
  let rawName = state.raidName || 'Granblue Fantasy';
  let cleanName = rawName
    .replace(/^GB\s*Farm\s*-\s*/i, '')
    .replace(/\s*HL$/i, ' HL')
    .trim();

  if (cleanName.toLowerCase().includes('akasha')) cleanName = 'Akasha';
  else if (cleanName.toLowerCase().includes('pbhl') || cleanName.toLowerCase().includes('proto bahamut') || cleanName.toLowerCase().includes('pb hl')) cleanName = 'PBHL';
  else if (cleanName.toLowerCase().includes('go') || cleanName.toLowerCase().includes('grand order')) cleanName = 'GO';

  const runNum = state.runNumber || 1;
  const gbCount = state.goldBars || 0;
  const gbLabel = gbCount === 1 ? '1 GB Drop' : `${gbCount} GB Drop`;

  let name = `Raid ${cleanName} ${runNum} - ${gbLabel}`;
  if (!state.raidName) {
    name = `GBF Automation ${runNum}`;
  }

  let details = `Raid ${cleanName}`;
  if (state.status === 'In Combat' && state.turn && state.turn > 0) {
    details = `Combat Turn ${state.turn}`;
  } else if (state.status === 'Searching') {
    details = 'Searching Raid';
  } else if (state.status && !state.status.toLowerCase().startsWith('farming')) {
    details = state.status;
  }

  const dryMode = state.dryStreakMode || 'blue_chest';
  const dryCount = state.dryStreak !== undefined ? state.dryStreak : 0;
  const blueCount = state.blueChests !== undefined ? state.blueChests : 0;

  let honorsStr = '';
  const numericHonors = typeof state.honors === 'number'
    ? state.honors
    : (typeof state.honors === 'string' ? parseInt(state.honors.replace(/\D/g, ''), 10) || 0 : 0);

  if (numericHonors >= 1000000) {
    honorsStr = `${(numericHonors / 1000000).toFixed(2)}M`;
  } else if (numericHonors > 0) {
    honorsStr = `${Math.round(numericHonors / 1000)}k`;
  } else if (state.honors) {
    honorsStr = String(state.honors).replace(/\s*pt/i, '').trim();
  }

  const stateParts: string[] = [];
  if (dryMode === 'blue_chest') {
    stateParts.push(`💎 Blue: ${blueCount} (Dry: ${dryCount})`);
  } else if (dryMode === 'min_honor') {
    stateParts.push(`💎 Blue: ${blueCount} (Dry: ${dryCount} Met)`);
  } else {
    stateParts.push(`💎 Blue: ${blueCount}`);
    stateParts.push(`Dry: ${dryCount} Runs`);
  }

  if (state.goldBarsToday !== undefined) {
    let gbStr = `🌟 Today: ${state.goldBarsToday}`;
    if (state.goldBarsSession && state.goldBarsSession > 0) {
      gbStr += ` (+${state.goldBarsSession}s)`;
    }
    stateParts.push(gbStr);
  }

  if (honorsStr) {
    stateParts.push(`${honorsStr} honors`);
  }

  const stateLine = stateParts.join(' | ') || 'Active Session';

  return {
    name,
    details,
    state: stateLine,
    largeText: `Raid ${cleanName}`,
    smallText: `${state.goldBars || 0} Total Gold Bars (${state.goldBarsToday || 0} Today)`
  };
}

/**
 * Master dispatcher that selects and renders the appropriate template
 */
export function formatPresenceByMode(mode: PresenceMode, state: any, options?: PresenceCustomOptions): FormattedPresence {
  switch (mode) {
    case 'work':
      return formatWorkPresence({
        project: options?.project || state?.projectName || state?.project,
        task: options?.task || state?.taskDetails || state?.task
      });
    case 'trade':
      return formatTradePresence({
        quote: options?.quote || state?.quote,
        author: options?.author || state?.quoteAuthor
      });
    case 'gbf':
    default:
      return formatGbfPresence(state);
  }
}

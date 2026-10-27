// src/engines/raid-evaluator.ts
import { rustBridge } from '../core/rust-bridge.js';

export type RaidGrade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export type RaidEvaluatorStrategy = 'honor' | 'otk_burst' | 'leech' | 'farm';

/**
 * Bitmask flags representing specific disqualification criteria.
 * Enables ultra-fast bitwise diagnostics and filtering.
 */
export enum RaidDisqualificationReason {
  NONE = 0,
  BLACKLISTED = 1 << 0,
  FULL = 1 << 1,
  HP_BELOW_MIN = 1 << 2,
  HP_ABOVE_MAX = 1 << 3,
  PLAYERS_BELOW_MIN = 1 << 4,
  PLAYERS_EXCEEDED = 1 << 5,
  BURN_RATE_EXCESSIVE = 1 << 6,
  HP_PER_PLAYER_TOO_LOW = 1 << 7,
  SCORE_BELOW_MIN = 1 << 8,
  FAILED_ASYNC_CONDITION = 1 << 9,
  STALLED = 1 << 10
}

/**
 * Real-time velocity and momentum metrics computed across consecutive Finder scans.
 */
export interface RaidVelocityMetrics {
  observations: number;
  elapsedSec: number;
  hpBurnPerSec: number;           // Positive % HP lost per second
  playerJoinRate: number;         // Players gained per second
  estimatedTtdSec: number | null; // Estimated Time-to-Death in seconds (null if 0 burn)
  isStalled: boolean;             // Flagged when seen across multiple scans with 0% HP change and low players
}

export interface RaidEvaluationResult {
  score: number;
  grade: RaidGrade;
  viable: boolean;
  reason: string;
  details: {
    hpScore: number;
    playerScore: number;
    sweetSpotBonus: number;
    burnPenalty: number;
    hpPerPlayer: number;
    velocityBonus?: number;
    estimatedTtdSec?: number | null;
    isStalled?: boolean;
    flags?: number;
    flagsSummary?: string[];
  };
}

export interface RaidCandidate {
  index: number;
  raidId: string;
  hpPct: number;
  players: number;
  maxPlayers: number;
  x?: number;
  y?: number;
  score?: number;
  grade?: RaidGrade;
  viable?: boolean;
  reason?: string;
  evaluation?: RaidEvaluationResult;
  velocity?: RaidVelocityMetrics;
}

export type AsyncRaidCondition = (candidate: RaidCandidate) => Promise<boolean> | boolean;

export interface RaidEvaluationOptions {
  strategy?: RaidEvaluatorStrategy; // 'honor' (high HP/low players), 'otk_burst' / 'leech' (low HP/active players), or 'farm' (damage output, high players, lowest HP)
  minScore?: number;        // Minimum score to be eligible to join (default: 40 for honor, 30 for leech, 20 for farm)
  minHpPct?: number;        // Hard minimum HP% (default: 25 for honor, 1 for otk_burst/farm)
  maxHpPct?: number;        // Hard maximum HP% (default: 20 for otk_burst, 95 for farm)
  minPlayers?: number;      // Hard minimum players (default: 1 for honor, 3 for otk_burst, 2 for farm)
  maxPlayers?: number;      // Hard max players (default: 8 for honor, 29 for otk_burst/farm)
  deadRaidIds?: string[] | Set<string> | Map<string, any>; // Blacklisted / recently ended or full raid IDs
  useCache?: boolean;       // Enable high-speed LRU result memoization (default: false)
  cacheTtlMs?: number;      // Cache time-to-live in ms (default: 5000)
  asyncConditions?: AsyncRaidCondition[]; // Multiple async conditions evaluated in parallel
  asyncValidator?: AsyncRaidCondition;   // Single async predicate evaluated in parallel
  adaptive?: boolean;       // Enable adaptive fallback: if no candidate meets strict S/A thresholds, degrade to pick best most-joined active raid
  velocity?: RaidVelocityMetrics; // Live velocity telemetry for candidate
  trackVelocity?: boolean;  // Automatically look up / record velocity in RaidVelocityTracker
}

export interface ParallelEvaluationOptions {
  concurrency?: number;     // Max concurrent evaluations in batch (default: unconstrained)
  useCache?: boolean;       // Enable result cache
  cacheTtlMs?: number;
}

export interface MultiSlotSelectionResult {
  slotResults: Record<number | string, {
    best: RaidCandidate | null;
    viableCandidates: RaidCandidate[];
    nonViableCandidates: RaidCandidate[];
  }>;
  globalBest: (RaidCandidate & { slot: number | string }) | null;
}

// Zero-allocation rounding utilities using IEEE-754 epsilon
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const round1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10;

/**
 * Bounded High-Speed In-Memory Evaluation Cache
 */
export class RaidEvaluationCache {
  private static cache = new Map<string, { result: RaidEvaluationResult; timestamp: number }>();
  public static defaultTtlMs = 5000;
  public static maxEntries = 2000;

  public static get(key: string, ttlMs = RaidEvaluationCache.defaultTtlMs): RaidEvaluationResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  public static set(key: string, result: RaidEvaluationResult): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  public static clear(): void {
    this.cache.clear();
  }

  public static size(): number {
    return this.cache.size;
  }
}

interface RaidVelocityEntry {
  firstSeenAt: number;
  lastSeenAt: number;
  initialHpPct: number;
  lastHpPct: number;
  initialPlayers: number;
  lastPlayers: number;
  observations: number;
}

/**
 * Real-Time Raid Velocity Tracker
 *
 * Tracks raid IDs across consecutive #quest/assist Finder scans to compute:
 * - Boss HP burn rate (% HP lost per second)
 * - Player join velocity (players gained per second)
 * - Estimated Time-to-Death (TTD in seconds)
 * - Stalled / Abandoned room detection (0% HP movement across multiple refreshes with <= 2 players)
 */
export class RaidVelocityTracker {
  private static entries = new Map<string, RaidVelocityEntry>();
  public static maxEntries = 500;
  public static ttlMs = 180000; // 3 minutes

  public static recordObservation(
    raidId: string,
    hpPct: number,
    players: number,
    now = Date.now()
  ): RaidVelocityMetrics {
    if (!raidId) {
      return {
        observations: 1,
        elapsedSec: 0,
        hpBurnPerSec: 0,
        playerJoinRate: 0,
        estimatedTtdSec: null,
        isStalled: false
      };
    }

    const nativeVelocity = rustBridge.recordRaidVelocity(raidId, hpPct, players, now, this.ttlMs);
    if (nativeVelocity !== null && this.maxEntries === 500) {
      return nativeVelocity;
    }

    this.prune(now);

    const existing = this.entries.get(raidId);
    if (!existing) {
      this.entries.set(raidId, {
        firstSeenAt: now,
        lastSeenAt: now,
        initialHpPct: hpPct,
        lastHpPct: hpPct,
        initialPlayers: players,
        lastPlayers: players,
        observations: 1
      });
      return {
        observations: 1,
        elapsedSec: 0,
        hpBurnPerSec: 0,
        playerJoinRate: 0,
        estimatedTtdSec: null,
        isStalled: false
      };
    }

    // Only increment observation count if at least 200ms elapsed or state changed
    if (now - existing.lastSeenAt >= 200 || existing.lastHpPct !== hpPct || existing.lastPlayers !== players) {
      existing.observations += 1;
      existing.lastSeenAt = now;
      existing.lastHpPct = hpPct;
      existing.lastPlayers = players;
    }

    return this.computeMetrics(existing, now);
  }

  public static recordBatch(candidates: RaidCandidate[], now = Date.now()): RaidCandidate[] {
    return candidates.map(c => {
      if (!c.raidId) return c;
      const velocity = this.recordObservation(c.raidId, c.hpPct, c.players, now);
      return { ...c, velocity };
    });
  }

  public static getMetrics(raidId: string, now = Date.now()): RaidVelocityMetrics | undefined {
    const nativeMetrics = rustBridge.getRaidVelocity(raidId, now, this.ttlMs);
    if (nativeMetrics !== null && this.maxEntries === 500) {
      return nativeMetrics;
    }
    const entry = this.entries.get(raidId);
    if (!entry) return undefined;
    if (now - entry.lastSeenAt > this.ttlMs) {
      this.entries.delete(raidId);
      return undefined;
    }
    return this.computeMetrics(entry, now);
  }

  private static computeMetrics(entry: RaidVelocityEntry, now: number): RaidVelocityMetrics {
    const elapsedMs = Math.max(0, now - entry.firstSeenAt);
    const elapsedSec = round2(elapsedMs / 1000);
    const hpLost = Math.max(0, entry.initialHpPct - entry.lastHpPct);
    const playerDelta = entry.lastPlayers - entry.initialPlayers;

    const hpBurnPerSec = elapsedSec >= 0.4 ? round2(hpLost / elapsedSec) : 0;
    const playerJoinRate = elapsedSec >= 0.4 ? round2(playerDelta / elapsedSec) : 0;
    const estimatedTtdSec = hpBurnPerSec > 0.05 ? round1(entry.lastHpPct / hpBurnPerSec) : null;

    // Stalled room heuristic: seen >= 2 times across >= 3.5s with 0% HP drop, <= 0 player growth, and <= 2 players
    const isStalled =
      entry.observations >= 2 &&
      elapsedSec >= 3.5 &&
      hpLost === 0 &&
      playerDelta <= 0 &&
      entry.lastPlayers <= 2;

    return {
      observations: entry.observations,
      elapsedSec,
      hpBurnPerSec,
      playerJoinRate,
      estimatedTtdSec,
      isStalled
    };
  }

  public static prune(now = Date.now()): void {
    if (this.entries.size === 0) return;
    for (const [id, entry] of this.entries.entries()) {
      if (now - entry.lastSeenAt > this.ttlMs) {
        this.entries.delete(id);
      }
    }
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  public static clear(): void {
    rustBridge.clearRaidVelocity();
    this.entries.clear();
  }

  public static size(): number {
    const nativeSize = rustBridge.getRaidVelocitySize();
    if (nativeSize !== null && this.maxEntries === 500 && this.entries.size === 0) {
      return nativeSize;
    }
    return this.entries.size;
  }
}

export class RaidEvaluator {
  public static readonly DEFAULT_MIN_SCORE = 40;
  public static readonly DEFAULT_MIN_HP = 25;
  public static readonly DEFAULT_MAX_PLAYERS = 8;
  public static readonly DEFAULT_OTK_MAX_HP = 20;
  public static readonly DEFAULT_OTK_MIN_PLAYERS = 3;
  public static readonly DEFAULT_FARM_MIN_SCORE = 20;
  public static readonly DEFAULT_FARM_MAX_HP = 95;
  public static readonly DEFAULT_FARM_MIN_PLAYERS = 2;

  /**
   * Fast normalization of deadRaidIds to Set<string> for O(1) membership lookup.
   */
  public static normalizeDeadIds(deadRaidIds?: string[] | Set<string> | Map<string, any>): Set<string> {
    if (!deadRaidIds) return new Set<string>();
    if (deadRaidIds instanceof Set) return deadRaidIds;
    if (deadRaidIds instanceof Map) return new Set<string>(deadRaidIds.keys());
    return new Set<string>(deadRaidIds);
  }

  /**
   * Generates a deterministic cache key for memoization.
   */
  private static getCacheKey(
    raidId: string | undefined,
    hpPct: number,
    players: number,
    maxPlayers: number,
    options: RaidEvaluationOptions
  ): string {
    const vKey = options.velocity
      ? `${options.velocity.observations}:${options.velocity.hpBurnPerSec}:${options.velocity.isStalled ? 1 : 0}`
      : 'nov';
    return `${raidId || 'noid'}:${hpPct}:${players}:${maxPlayers}:${options.strategy || 'honor'}:${options.minScore ?? 40}:${options.minHpPct ?? 0}:${options.maxHpPct ?? 0}:${options.minPlayers ?? 0}:${options.maxPlayers ?? 0}:${vKey}`;
  }

  /**
   * Evaluates a single candidate raid synchronously and calculates a quality/viability score (0 - 100).
   * Supports three distinct strategies:
   * 1. 'honor' (default): Targets fresh raids (HP > 85%, players <= 2) to build max honors for Blue Chest.
   * 2. 'otk_burst' / 'leech': Targets dying raids (HP <= 20%, players >= 3) for rapid leech/participation drops and fast clear.
   * 3. 'farm': Targets active, highly-joined raids (many players) with lowest HP for rapid damage clearing and fast rerun cadence without idle waiting.
   */
  public static evaluateCandidate(
    hpPct: number,
    players: number,
    maxPlayers: number = 30,
    options: RaidEvaluationOptions = {},
    raidId?: string,
    precomputedDeadSet?: Set<string>
  ): RaidEvaluationResult {
    // Check memoization cache if enabled
    if (options.useCache) {
      const cacheKey = this.getCacheKey(raidId, hpPct, players, maxPlayers, options);
      const cached = RaidEvaluationCache.get(cacheKey, options.cacheTtlMs);
      if (cached) return cached;
    }

    let result: RaidEvaluationResult;
    if (options.strategy === 'farm') {
      result = this.evaluateFarmCandidate(hpPct, players, maxPlayers, options, raidId, precomputedDeadSet);
    } else if (options.strategy === 'otk_burst' || options.strategy === 'leech') {
      result = this.evaluateOtkBurstCandidate(hpPct, players, maxPlayers, options, raidId, precomputedDeadSet);
    } else {
      result = this.evaluateHonorCandidate(hpPct, players, maxPlayers, options, raidId, precomputedDeadSet);
    }

    if (options.useCache) {
      const cacheKey = this.getCacheKey(raidId, hpPct, players, maxPlayers, options);
      RaidEvaluationCache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Evaluates candidate raid using the 'honor' strategy (Blue Chest / Fresh Raid focus).
   */
  private static evaluateHonorCandidate(
    hpPct: number,
    players: number,
    maxPlayers: number = 30,
    options: RaidEvaluationOptions = {},
    raidId?: string,
    precomputedDeadSet?: Set<string>
  ): RaidEvaluationResult {
    const minScore = options.minScore ?? RaidEvaluator.DEFAULT_MIN_SCORE;
    const minHp = options.minHpPct ?? RaidEvaluator.DEFAULT_MIN_HP;
    const maxP = options.maxPlayers ?? RaidEvaluator.DEFAULT_MAX_PLAYERS;
    const deadSet = precomputedDeadSet || this.normalizeDeadIds(options.deadRaidIds);

    let flags = RaidDisqualificationReason.NONE;
    const flagSummaries: string[] = [];

    // 1. Blacklist check (already full or ended) - Instant O(1)
    if (raidId && deadSet.has(raidId)) {
      flags |= RaidDisqualificationReason.BLACKLISTED;
      flagSummaries.push('BLACKLISTED');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: 'Raid marked full or ended in recent attempts (blacklisted)',
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 2. Hard absolute minimum HP threshold
    if (hpPct < minHp) {
      flags |= RaidDisqualificationReason.HP_BELOW_MIN;
      flagSummaries.push('HP_BELOW_MIN');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP (${hpPct}%) is below minimum threshold (${minHp}%)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 2b. Hard absolute maximum HP threshold (customizable on workflow)
    if (options.maxHpPct !== undefined && hpPct > options.maxHpPct) {
      flags |= RaidDisqualificationReason.HP_ABOVE_MAX;
      flagSummaries.push('HP_ABOVE_MAX');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP (${hpPct}%) is above maximum threshold (${options.maxHpPct}%)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 3. Hard maximum player ceiling
    if (players > maxP) {
      flags |= RaidDisqualificationReason.PLAYERS_EXCEEDED;
      flagSummaries.push('PLAYERS_EXCEEDED');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Players (${players}/${maxPlayers}) exceeds player limit (${maxP})`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 4. Critical burn rate / Doomed raid disqualification (honored if custom minHpPct is unspecified or >= 30)
    const hasCustomLowMinHp = options.minHpPct !== undefined && options.minHpPct < 30;
    if (!hasCustomLowMinHp && hpPct < 30 && players >= 5) {
      flags |= RaidDisqualificationReason.BURN_RATE_EXCESSIVE;
      flagSummaries.push('BURN_RATE_EXCESSIVE');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP < 30% (${hpPct}%) with ${players} players: fast burn will terminate battle before minimum honors`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    if (!hasCustomLowMinHp && hpPct < 40 && players >= 8) {
      flags |= RaidDisqualificationReason.BURN_RATE_EXCESSIVE;
      flagSummaries.push('BURN_RATE_EXCESSIVE');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP < 40% (${hpPct}%) with ${players} players: excessive burn rate`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    const effectivePlayers = Math.max(players, 1);
    const hpPerPlayer = round2(hpPct / effectivePlayers);

    if (!hasCustomLowMinHp && hpPerPlayer < 5.0) {
      flags |= RaidDisqualificationReason.HP_PER_PLAYER_TOO_LOW;
      flagSummaries.push('HP_PER_PLAYER_TOO_LOW');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Remaining HP per player (${hpPerPlayer}%) < 5.0%: raid lifespan too short to guarantee blue chest`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer, flags, flagsSummary: flagSummaries }
      };
    }

    // 4b. Live Velocity & TTD Check (when multi-scan velocity telemetry is available)
    const velocity = options.velocity || (options.trackVelocity && raidId ? RaidVelocityTracker.getMetrics(raidId) : undefined);
    if (velocity && velocity.observations >= 2) {
      if (!hasCustomLowMinHp && velocity.estimatedTtdSec !== null && velocity.estimatedTtdSec < 8) {
        flags |= RaidDisqualificationReason.BURN_RATE_EXCESSIVE;
        flagSummaries.push('BURN_RATE_EXCESSIVE');
        return {
          score: 0,
          grade: 'F',
          viable: false,
          reason: `Estimated TTD (${velocity.estimatedTtdSec}s) < 8s: boss will die before burst rotation completes`,
          details: {
            hpScore: 0,
            playerScore: 0,
            sweetSpotBonus: 0,
            burnPenalty: 0,
            hpPerPlayer,
            estimatedTtdSec: velocity.estimatedTtdSec,
            isStalled: velocity.isStalled,
            flags,
            flagsSummary: flagSummaries
          }
        };
      }
    }

    // 5. HP Quality Score (0 to 55 points)
    let hpScore = 0;
    if (hpPct >= 85) {
      hpScore = 48 + ((hpPct - 85) / 15) * 7;
    } else if (hpPct >= 65) {
      hpScore = 32 + ((hpPct - 65) / 20) * 15;
    } else if (hpPct >= 45) {
      hpScore = 18 + ((hpPct - 45) / 20) * 13;
    } else {
      hpScore = 5 + ((hpPct - 20) / 25) * 12;
    }

    // 6. Player Count Points (0 to 40 points)
    let playerScore = 0;
    if (players <= 1) playerScore = 40;
    else if (players === 2) playerScore = 38;
    else if (players === 3) playerScore = 32;
    else if (players === 4) playerScore = 25;
    else if (players === 5) playerScore = 18;
    else if (players === 6) playerScore = 12;
    else if (players === 7) playerScore = 6;
    else if (players === 8) playerScore = 2;
    else playerScore = 0;

    // 7. Sweet Spot Synergy Bonus (+5 points)
    let sweetSpotBonus = 0;
    if (hpPct >= 85 && players <= 2) {
      sweetSpotBonus = 5;
    }

    // 8. Burn Rate Penalty
    let burnPenalty = 0;
    if (hpPerPlayer < 12) {
      burnPenalty = round1((12 - hpPerPlayer) * 1.5);
    }
    if (velocity && velocity.observations >= 2 && velocity.hpBurnPerSec > 4.0) {
      burnPenalty = round1(burnPenalty + (velocity.hpBurnPerSec - 4.0) * 1.5);
    }

    // Calculate total score
    const rawScore = hpScore + playerScore + sweetSpotBonus - burnPenalty;
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Assign Grade
    let grade: RaidGrade = 'F';
    if (finalScore >= 95) grade = 'S+';
    else if (finalScore >= 90) grade = 'S';
    else if (finalScore >= 75) grade = 'A';
    else if (finalScore >= 60) grade = 'B';
    else if (finalScore >= 40) grade = 'C';
    else if (finalScore >= 20) grade = 'D';
    else grade = 'F';

    const viable = finalScore >= minScore;
    if (!viable) {
      flags |= RaidDisqualificationReason.SCORE_BELOW_MIN;
      flagSummaries.push('SCORE_BELOW_MIN');
    }

    const reason = viable
      ? `Viable raid (Score: ${finalScore} pt, Grade: ${grade}, HP: ${hpPct}%, Players: ${players}/${maxPlayers})`
      : `Score ${finalScore} pt (Grade ${grade}) is below minimum acceptable threshold (${minScore} pt)`;

    return {
      score: finalScore,
      grade,
      viable,
      reason,
      details: {
        hpScore: round1(hpScore),
        playerScore,
        sweetSpotBonus,
        burnPenalty,
        hpPerPlayer,
        estimatedTtdSec: velocity?.estimatedTtdSec ?? null,
        isStalled: velocity?.isStalled ?? false,
        flags,
        flagsSummary: flagSummaries
      }
    };
  }

  /**
   * Evaluates candidate raid using the 'otk_burst' strategy.
   * Priority: Dying raid (HP <= 20%) with active clearing players (players >= 3)
   * for fast participation reward turn-around.
   */
  private static evaluateOtkBurstCandidate(
    hpPct: number,
    players: number,
    maxPlayers: number = 30,
    options: RaidEvaluationOptions = {},
    raidId?: string,
    precomputedDeadSet?: Set<string>
  ): RaidEvaluationResult {
    const minScore = options.minScore ?? RaidEvaluator.DEFAULT_MIN_SCORE;
    const minHp = options.minHpPct ?? 1;
    const maxHp = options.maxHpPct ?? RaidEvaluator.DEFAULT_OTK_MAX_HP;
    const minP = options.minPlayers ?? RaidEvaluator.DEFAULT_OTK_MIN_PLAYERS;
    const maxP = options.maxPlayers ?? 29;
    const deadSet = precomputedDeadSet || this.normalizeDeadIds(options.deadRaidIds);

    let flags = RaidDisqualificationReason.NONE;
    const flagSummaries: string[] = [];

    // 1. Blacklist check - Instant O(1)
    if (raidId && deadSet.has(raidId)) {
      flags |= RaidDisqualificationReason.BLACKLISTED;
      flagSummaries.push('BLACKLISTED');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: 'Raid marked full or ended in recent attempts (blacklisted)',
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 2. Full raid check
    if (players >= maxPlayers || players > maxP) {
      flags |= RaidDisqualificationReason.FULL;
      flagSummaries.push('FULL');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid is full (${players}/${maxPlayers} players)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 3. Dead or 0% HP raid check
    if (hpPct < minHp) {
      flags |= RaidDisqualificationReason.HP_BELOW_MIN;
      flagSummaries.push('HP_BELOW_MIN');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid HP (${hpPct}%) is below minimum (${minHp}%): raid is already cleared or dying`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 4. Minimum player count check (must have enough active players to guarantee fast clear)
    if (players < minP) {
      flags |= RaidDisqualificationReason.PLAYERS_BELOW_MIN;
      flagSummaries.push('PLAYERS_BELOW_MIN');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Players (${players}) is below minimum (${minP}): risk of stalled raid / slow clear`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 5. Hard maximum HP ceiling check
    const hardMaxHp = options.maxHpPct !== undefined ? options.maxHpPct : maxHp + 15;
    if (hpPct > hardMaxHp) {
      flags |= RaidDisqualificationReason.HP_ABOVE_MAX;
      flagSummaries.push('HP_ABOVE_MAX');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP (${hpPct}%) exceeds maximum threshold (${options.maxHpPct ?? maxHp}%)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    const effectivePlayers = Math.max(players, 1);
    const hpPerPlayer = round2(hpPct / effectivePlayers);

    // 5b. Live Velocity & Stalled Room Check
    const velocity = options.velocity || (options.trackVelocity && raidId ? RaidVelocityTracker.getMetrics(raidId) : undefined);
    if (velocity && velocity.isStalled) {
      flags |= RaidDisqualificationReason.STALLED;
      flagSummaries.push('STALLED');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid is stalled (0% HP change over ${velocity.elapsedSec}s with ${players} players)`,
        details: {
          hpScore: 0,
          playerScore: 0,
          sweetSpotBonus: 0,
          burnPenalty: 0,
          hpPerPlayer,
          velocityBonus: 0,
          estimatedTtdSec: velocity.estimatedTtdSec,
          isStalled: true,
          flags,
          flagsSummary: flagSummaries
        }
      };
    }

    // 6. HP Quality Score (0 to 55 points)
    let hpScore = 0;
    if (hpPct <= maxHp) {
      if (maxHp <= 25) {
        if (hpPct >= 3 && hpPct <= 12) {
          hpScore = 55 - (Math.abs(hpPct - 6) * 0.7);
        } else if (hpPct > 12) {
          hpScore = Math.max(10, 50 - ((hpPct - 12) / 8) * 12);
        } else {
          hpScore = 46 + (hpPct - 1) * 2;
        }
      } else {
        // Generalized leech/burst scoring for wide custom maxHp ranges
        const span = Math.max(1, maxHp - minHp);
        const norm = Math.max(0, Math.min(1, (hpPct - minHp) / span));
        hpScore = Math.round(50 - (norm * 25)); // 50 (at minHp) down to 25 (at maxHp)
      }
    } else {
      hpScore = Math.max(5, 35 - ((hpPct - maxHp) / 15) * 25);
    }

    // 7. Player Count Score (0 to 40 points)
    let playerScore = 0;
    if (players >= 10) playerScore = 40;
    else if (players >= 7) playerScore = 38;
    else if (players >= 5) playerScore = 35;
    else if (players === 4) playerScore = 31;
    else if (players === 3) playerScore = 26;
    else playerScore = 10;

    // 8. Sweet Spot Synergy & Live Velocity Bonus (+5 base + up to +6 velocity momentum)
    let sweetSpotBonus = 0;
    if (hpPct <= maxHp && players >= minP) {
      sweetSpotBonus = 5;
    }

    let velocityBonus = 0;
    if (velocity && velocity.observations >= 2) {
      if (velocity.hpBurnPerSec >= 0.5 || velocity.playerJoinRate >= 0.2) {
        velocityBonus = Math.min(6, Math.round(velocity.hpBurnPerSec * 1.5 + Math.max(0, velocity.playerJoinRate) * 3));
      } else if (velocity.elapsedSec >= 3 && velocity.hpBurnPerSec === 0 && velocity.playerJoinRate <= 0 && players <= 4) {
        velocityBonus = -10;
      }
      sweetSpotBonus += velocityBonus;
    }

    const rawScore = hpScore + playerScore + sweetSpotBonus;
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    let grade: RaidGrade = 'F';
    if (finalScore >= 95) grade = 'S+';
    else if (finalScore >= 90) grade = 'S';
    else if (finalScore >= 75) grade = 'A';
    else if (finalScore >= 60) grade = 'B';
    else if (finalScore >= 40) grade = 'C';
    else if (finalScore >= 20) grade = 'D';
    else grade = 'F';

    const viable = finalScore >= minScore && hpPct <= maxHp && players >= minP;
    if (!viable) {
      if (hpPct > maxHp) {
        flags |= RaidDisqualificationReason.HP_ABOVE_MAX;
        flagSummaries.push('HP_ABOVE_MAX');
      }
      if (finalScore < minScore) {
        flags |= RaidDisqualificationReason.SCORE_BELOW_MIN;
        flagSummaries.push('SCORE_BELOW_MIN');
      }
    }

    const reason = viable
      ? `Viable OTK burst raid (Score: ${finalScore} pt, Grade: ${grade}, HP: ${hpPct}%, Players: ${players}/${maxPlayers})`
      : (hpPct > maxHp
          ? `HP (${hpPct}%) exceeds target OTK threshold (${maxHp}%)`
          : `Score ${finalScore} pt (Grade ${grade}) is below minimum acceptable threshold (${minScore} pt)`);

    return {
      score: finalScore,
      grade,
      viable,
      reason,
      details: {
        hpScore: round1(hpScore),
        playerScore,
        sweetSpotBonus,
        burnPenalty: 0,
        hpPerPlayer,
        velocityBonus,
        estimatedTtdSec: velocity?.estimatedTtdSec ?? null,
        isStalled: velocity?.isStalled ?? false,
        flags,
        flagsSummary: flagSummaries
      }
    };
  }

  /**
   * Evaluates candidate raid using the 'farm' strategy.
   * Priority: Active, highly-joined raids (many players) with lowest HP to ensure fast clear and rapid rerun cadence.
   * Unlike pure leech (which requires HP <= 20% or 40%), farm allows dealing full rotation damage (HP up to 90-95%)
   * while heavily weighting player density to ensure the boss melts quickly and the raid clears.
   */
  private static evaluateFarmCandidate(
    hpPct: number,
    players: number,
    maxPlayers: number = 30,
    options: RaidEvaluationOptions = {},
    raidId?: string,
    precomputedDeadSet?: Set<string>
  ): RaidEvaluationResult {
    const minScore = options.minScore ?? RaidEvaluator.DEFAULT_FARM_MIN_SCORE;
    const minHp = options.minHpPct ?? 1;
    const maxHp = options.maxHpPct ?? RaidEvaluator.DEFAULT_FARM_MAX_HP;
    const minP = options.minPlayers ?? RaidEvaluator.DEFAULT_FARM_MIN_PLAYERS;
    const maxP = options.maxPlayers ?? (maxPlayers - 1);
    const deadSet = precomputedDeadSet || this.normalizeDeadIds(options.deadRaidIds);

    let flags = RaidDisqualificationReason.NONE;
    const flagSummaries: string[] = [];

    // 1. Blacklist check - Instant O(1)
    if (raidId && deadSet.has(raidId)) {
      flags |= RaidDisqualificationReason.BLACKLISTED;
      flagSummaries.push('BLACKLISTED');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: 'Raid marked full or ended in recent attempts (blacklisted)',
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 2. Full raid check
    if (players >= maxPlayers || players > maxP) {
      flags |= RaidDisqualificationReason.FULL;
      flagSummaries.push('FULL');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid is full (${players}/${maxPlayers} players)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 3. Boss already dead or 0% HP check
    if (hpPct < minHp) {
      flags |= RaidDisqualificationReason.HP_BELOW_MIN;
      flagSummaries.push('HP_BELOW_MIN');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid HP (${hpPct}%) is below minimum (${minHp}%): boss already defeated`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 4. Hard maximum HP check
    if (hpPct > maxHp) {
      flags |= RaidDisqualificationReason.HP_ABOVE_MAX;
      flagSummaries.push('HP_ABOVE_MAX');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid HP (${hpPct}%) exceeds farm threshold (${maxHp}%)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    // 5. Minimum player check (prevent dead solo hosts unless HP is nearly 0)
    if (players < minP && hpPct > 10) {
      flags |= RaidDisqualificationReason.PLAYERS_BELOW_MIN;
      flagSummaries.push('PLAYERS_BELOW_MIN');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Players (${players}) is below minimum (${minP}): risk of stalled / abandoned raid`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    const effectivePlayers = Math.max(players, 1);
    const hpPerPlayer = round2(hpPct / effectivePlayers);

    // 5b. Live Velocity & Stalled Room Check
    const velocity = options.velocity || (options.trackVelocity && raidId ? RaidVelocityTracker.getMetrics(raidId) : undefined);
    if (velocity && velocity.isStalled) {
      flags |= RaidDisqualificationReason.STALLED;
      flagSummaries.push('STALLED');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Raid is stalled (0% HP change over ${velocity.elapsedSec}s with ${players} players)`,
        details: {
          hpScore: 0,
          playerScore: 0,
          sweetSpotBonus: 0,
          burnPenalty: 0,
          hpPerPlayer,
          velocityBonus: 0,
          estimatedTtdSec: velocity.estimatedTtdSec,
          isStalled: true,
          flags,
          flagsSummary: flagSummaries
        }
      };
    }

    // 6. Player Count Score (0 to 45 points) - Heavily favors "most joined raid"
    // More players = faster clear speed = faster turnaround and more reruns
    let playerScore = 0;
    if (players >= 20) playerScore = 45;
    else if (players >= 15) playerScore = 40;
    else if (players >= 10) playerScore = 35;
    else if (players >= 7) playerScore = 30;
    else if (players >= 5) playerScore = 25;
    else if (players >= 3) playerScore = 18;
    else if (players >= 2) playerScore = 12;
    else playerScore = 5;

    // 7. HP Score (0 to 45 points) - Prioritizes lowest HP for faster raid finish
    let hpScore = 0;
    if (hpPct <= 15) {
      hpScore = 45;
    } else if (hpPct <= 30) {
      hpScore = 40 + Math.round(((30 - hpPct) / 15) * 4); // 40 to 44
    } else if (hpPct <= 50) {
      hpScore = 32 + Math.round(((50 - hpPct) / 20) * 7); // 32 to 39
    } else if (hpPct <= 70) {
      hpScore = 22 + Math.round(((70 - hpPct) / 20) * 9); // 22 to 31
    } else if (hpPct <= 85) {
      hpScore = 12 + Math.round(((85 - hpPct) / 15) * 9); // 12 to 21
    } else {
      hpScore = Math.max(5, Math.round(10 - ((hpPct - 85) / 15) * 5)); // 5 to 10
    }

    // 8. Swarm Synergy & Burn Rate Bonus (0 to 10 points)
    let sweetSpotBonus = 0;
    // Golden sweet spot: Many players (10+) and HP <= 50% -> raid will melt instantly!
    if (players >= 10 && hpPct <= 50) {
      sweetSpotBonus += 6;
    } else if (players >= 6 && hpPct <= 70) {
      sweetSpotBonus += 3;
    }

    // High burn rate bonus: remaining HP per player <= 3.5%
    if (hpPerPlayer <= 3.5 && players >= 5) {
      sweetSpotBonus += 4;
    } else if (hpPerPlayer > 30.0 && players < 3) {
      // Sluggish penalty: high HP per player with few players
      sweetSpotBonus -= 10;
    }

    let velocityBonus = 0;
    if (velocity && velocity.observations >= 2) {
      if (velocity.hpBurnPerSec >= 0.5 || velocity.playerJoinRate >= 0.2) {
        velocityBonus = Math.min(6, Math.round(velocity.hpBurnPerSec * 1.5 + Math.max(0, velocity.playerJoinRate) * 3));
      } else if (velocity.elapsedSec >= 3 && velocity.hpBurnPerSec === 0 && velocity.playerJoinRate <= 0 && players <= 4) {
        velocityBonus = -10;
      }
      sweetSpotBonus += velocityBonus;
    }

    const rawScore = hpScore + playerScore + sweetSpotBonus;
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    let grade: RaidGrade = 'F';
    if (finalScore >= 95) grade = 'S+';
    else if (finalScore >= 90) grade = 'S';
    else if (finalScore >= 75) grade = 'A';
    else if (finalScore >= 60) grade = 'B';
    else if (finalScore >= 40) grade = 'C';
    else if (finalScore >= 20) grade = 'D';
    else grade = 'F';

    const viable = finalScore >= minScore;
    if (!viable) {
      flags |= RaidDisqualificationReason.SCORE_BELOW_MIN;
      flagSummaries.push('SCORE_BELOW_MIN');
    }

    const reason = viable
      ? `Viable farm raid (Score: ${finalScore} pt, Grade: ${grade}, HP: ${hpPct}%, Players: ${players}/${maxPlayers})`
      : `Score ${finalScore} pt (Grade ${grade}) is below minimum acceptable threshold (${minScore} pt)`;

    return {
      score: finalScore,
      grade,
      viable,
      reason,
      details: {
        hpScore: round1(hpScore),
        playerScore,
        sweetSpotBonus,
        burnPenalty: sweetSpotBonus < 0 ? Math.abs(sweetSpotBonus) : 0,
        hpPerPlayer,
        velocityBonus,
        estimatedTtdSec: velocity?.estimatedTtdSec ?? null,
        isStalled: velocity?.isStalled ?? false,
        flags,
        flagsSummary: flagSummaries
      }
    };
  }

  /**
   * Evaluates multiple arbitrary conditions against a candidate concurrently in parallel.
   */
  public static async checkConditionsParallel(
    candidate: RaidCandidate,
    conditions: Array<AsyncRaidCondition>
  ): Promise<{ passed: boolean; results: boolean[]; failedIndex?: number }> {
    if (!conditions || conditions.length === 0) {
      return { passed: true, results: [] };
    }

    const results = await Promise.all(
      conditions.map(async cond => {
        try {
          return await cond(candidate);
        } catch {
          return false;
        }
      })
    );

    const failedIndex = results.findIndex(r => !r);
    return {
      passed: failedIndex === -1,
      results,
      failedIndex: failedIndex !== -1 ? failedIndex : undefined
    };
  }

  /**
   * Sorts and selects the optimal raid candidate synchronously from an array of scanned cards.
   * Utilizes precomputed Set for O(1) blacklist lookups.
   */
  public static selectBestCandidate(
    candidates: RaidCandidate[],
    options: RaidEvaluationOptions = {}
  ): { best: RaidCandidate | null; viableCandidates: RaidCandidate[]; nonViableCandidates: RaidCandidate[] } {
    const deadSet = this.normalizeDeadIds(options.deadRaidIds);

    const evaluated = candidates.map(c => {
      const candidateOptions = c.velocity ? { ...options, velocity: c.velocity } : options;
      const evaluation = RaidEvaluator.evaluateCandidate(
        c.hpPct,
        c.players,
        c.maxPlayers,
        candidateOptions,
        c.raidId,
        deadSet
      );
      return {
        ...c,
        score: evaluation.score,
        grade: evaluation.grade,
        viable: evaluation.viable,
        reason: evaluation.reason,
        evaluation
      };
    });

    const viableCandidates = evaluated.filter(c => c.viable);
    const nonViableCandidates = evaluated.filter(c => !c.viable);

    if (viableCandidates.length === 0) {
      if (options.adaptive) {
        const adaptiveCandidates = evaluated.filter(c => {
          if (c.raidId && deadSet.has(c.raidId)) return false;
          if (c.players >= (c.maxPlayers || 30)) return false;
          if (c.hpPct < (options.minHpPct ?? 1)) return false;
          if (options.maxHpPct !== undefined && c.hpPct > options.maxHpPct) return false;
          if (c.players < 1) return false;
          return true;
        });

        if (adaptiveCandidates.length > 0) {
          adaptiveCandidates.sort((a, b) => {
            if (b.players !== a.players) {
              return b.players - a.players;
            }
            return a.hpPct - b.hpPct;
          });

          const bestAdaptive = adaptiveCandidates[0];
          bestAdaptive.viable = true;
          bestAdaptive.score = Math.max(bestAdaptive.score || 0, 30);
          bestAdaptive.grade = bestAdaptive.score >= 60 ? 'B' : (bestAdaptive.score >= 40 ? 'C' : 'D');
          bestAdaptive.reason = `Adaptively selected most-joined raid (HP: ${bestAdaptive.hpPct}%, Players: ${bestAdaptive.players}/${bestAdaptive.maxPlayers || 30}) to ensure fast clear and prevent idle standby`;

          return {
            best: bestAdaptive,
            viableCandidates: [bestAdaptive],
            nonViableCandidates: evaluated.filter(c => c !== bestAdaptive)
          };
        }
      }

      nonViableCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { best: null, viableCandidates: [], nonViableCandidates };
    }

    this.sortViableCandidates(viableCandidates, options.strategy);

    return {
      best: viableCandidates[0],
      viableCandidates,
      nonViableCandidates
    };
  }

  /**
   * Evaluates an array of candidates in parallel with support for async conditions,
   * batching, and zero event loop lag.
   */
  public static async evaluateCandidatesParallel(
    candidates: RaidCandidate[],
    options: RaidEvaluationOptions = {},
    parallelOptions: ParallelEvaluationOptions = {}
  ): Promise<RaidCandidate[]> {
    if (candidates.length === 0) return [];

    const deadSet = this.normalizeDeadIds(options.deadRaidIds);
    const concurrency = parallelOptions.concurrency && parallelOptions.concurrency > 0
      ? parallelOptions.concurrency
      : candidates.length;

    const asyncConditions = [
      ...(options.asyncConditions || []),
      ...(options.asyncValidator ? [options.asyncValidator] : [])
    ];

    const evaluateSingle = async (c: RaidCandidate): Promise<RaidCandidate> => {
      const candidateOptions = c.velocity ? { ...options, velocity: c.velocity } : options;
      const evaluation = RaidEvaluator.evaluateCandidate(
        c.hpPct,
        c.players,
        c.maxPlayers,
        candidateOptions,
        c.raidId,
        deadSet
      );

      let finalViable = evaluation.viable;
      let finalReason = evaluation.reason;
      let finalFlags = evaluation.details.flags || 0;

      // Run async conditions in parallel if candidate passed base sync checks
      if (finalViable && asyncConditions.length > 0) {
        const condCheck = await this.checkConditionsParallel(c, asyncConditions);
        if (!condCheck.passed) {
          finalViable = false;
          finalFlags |= RaidDisqualificationReason.FAILED_ASYNC_CONDITION;
          finalReason = `Failed parallel async validation check (condition #${condCheck.failedIndex})`;
        }
      }

      return {
        ...c,
        score: evaluation.score,
        grade: evaluation.grade,
        viable: finalViable,
        reason: finalReason,
        evaluation: {
          ...evaluation,
          viable: finalViable,
          reason: finalReason,
          details: {
            ...evaluation.details,
            flags: finalFlags
          }
        }
      };
    };

    // If concurrency equals or exceeds length, execute all at once
    if (concurrency >= candidates.length) {
      return Promise.all(candidates.map(evaluateSingle));
    }

    // Chunked parallel execution
    const results: RaidCandidate[] = [];
    for (let i = 0; i < candidates.length; i += concurrency) {
      const chunk = candidates.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map(evaluateSingle));
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Evaluates candidates in parallel and selects the best candidate.
   */
  public static async selectBestCandidateParallel(
    candidates: RaidCandidate[],
    options: RaidEvaluationOptions = {},
    parallelOptions: ParallelEvaluationOptions = {}
  ): Promise<{ best: RaidCandidate | null; viableCandidates: RaidCandidate[]; nonViableCandidates: RaidCandidate[] }> {
    const evaluated = await this.evaluateCandidatesParallel(candidates, options, parallelOptions);

    const viableCandidates = evaluated.filter(c => c.viable);
    const nonViableCandidates = evaluated.filter(c => !c.viable);

    if (viableCandidates.length === 0) {
      if (options.adaptive) {
        const deadSet = this.normalizeDeadIds(options.deadRaidIds);
        const adaptiveCandidates = evaluated.filter(c => {
          if (c.raidId && deadSet.has(c.raidId)) return false;
          if (c.players >= (c.maxPlayers || 30)) return false;
          if (c.hpPct < (options.minHpPct ?? 1)) return false;
          if (options.maxHpPct !== undefined && c.hpPct > options.maxHpPct) return false;
          if (c.players < 1) return false;
          return true;
        });

        if (adaptiveCandidates.length > 0) {
          adaptiveCandidates.sort((a, b) => {
            if (b.players !== a.players) {
              return b.players - a.players;
            }
            return a.hpPct - b.hpPct;
          });

          const bestAdaptive = adaptiveCandidates[0];
          bestAdaptive.viable = true;
          bestAdaptive.score = Math.max(bestAdaptive.score || 0, 30);
          bestAdaptive.grade = bestAdaptive.score >= 60 ? 'B' : (bestAdaptive.score >= 40 ? 'C' : 'D');
          bestAdaptive.reason = `Adaptively selected most-joined raid (HP: ${bestAdaptive.hpPct}%, Players: ${bestAdaptive.players}/${bestAdaptive.maxPlayers || 30}) to ensure fast clear and prevent idle standby`;

          return {
            best: bestAdaptive,
            viableCandidates: [bestAdaptive],
            nonViableCandidates: evaluated.filter(c => c !== bestAdaptive)
          };
        }
      }

      nonViableCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { best: null, viableCandidates: [], nonViableCandidates };
    }

    this.sortViableCandidates(viableCandidates, options.strategy);

    return {
      best: viableCandidates[0],
      viableCandidates,
      nonViableCandidates
    };
  }

  /**
   * Evaluates multiple assist slots (e.g. Tab 1 Colossus, Tab 2 GO, Tab 3 Akasha, Tab 4 PBHL)
   * simultaneously in parallel.
   */
  public static async evaluateMultiSlotParallel(
    slots: Record<number | string, RaidCandidate[]>,
    options?: Record<number | string, RaidEvaluationOptions> | RaidEvaluationOptions
  ): Promise<MultiSlotSelectionResult> {
    const slotKeys = Object.keys(slots);
    const slotPromises = slotKeys.map(async slotKey => {
      const candidates = slots[slotKey] || [];
      const slotOptions = (options && typeof options === 'object' && slotKey in options)
        ? (options as Record<number | string, RaidEvaluationOptions>)[slotKey]
        : (options as RaidEvaluationOptions || {});

      const selection = await this.selectBestCandidateParallel(candidates, slotOptions);
      return { slotKey, selection };
    });

    const evaluatedSlots = await Promise.all(slotPromises);

    const slotResults: MultiSlotSelectionResult['slotResults'] = {};
    const viableAcrossSlots: Array<RaidCandidate & { slot: number | string }> = [];

    for (const { slotKey, selection } of evaluatedSlots) {
      slotResults[slotKey] = selection;
      if (selection.best) {
        viableAcrossSlots.push({ ...selection.best, slot: slotKey });
      }
    }

    let globalBest: (RaidCandidate & { slot: number | string }) | null = null;
    if (viableAcrossSlots.length > 0) {
      viableAcrossSlots.sort((a, b) => (b.score || 0) - (a.score || 0));
      globalBest = viableAcrossSlots[0];
    }

    return {
      slotResults,
      globalBest
    };
  }

  /**
   * Sorts viable candidates in place based on strategy priority.
   */
  private static sortViableCandidates(viableCandidates: RaidCandidate[], strategyOrIsOtk?: RaidEvaluatorStrategy | boolean): void {
    const isFarm = strategyOrIsOtk === 'farm';
    const isOtk = strategyOrIsOtk === 'otk_burst' || strategyOrIsOtk === 'leech' || strategyOrIsOtk === true;

    viableCandidates.sort((a, b) => {
      // Primary: Score descending
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      if (isFarm) {
        // In farm mode: Most players first ("most joined raid" clears fastest), then lowest HP
        if (b.players !== a.players) {
          return b.players - a.players;
        }
        return a.hpPct - b.hpPct;
      } else if (isOtk) {
        // In OTK burst mode: Lowest HP first (dies sooner), then most players first (clears faster)
        if (a.hpPct !== b.hpPct) {
          return a.hpPct - b.hpPct;
        }
        return b.players - a.players;
      } else {
        // In honor mode: Highest HP first, then fewest players
        if (b.hpPct !== a.hpPct) {
          return b.hpPct - a.hpPct;
        }
        return a.players - b.players;
      }
    });
  }

  /**
   * Clears the evaluation cache.
   */
  public static clearCache(): void {
    RaidEvaluationCache.clear();
  }

  /**
   * Returns cache metrics.
   */
  public static getCacheStats(): { size: number; maxEntries: number } {
    return {
      size: RaidEvaluationCache.size(),
      maxEntries: RaidEvaluationCache.maxEntries
    };
  }
}


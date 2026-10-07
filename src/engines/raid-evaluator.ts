// src/engines/raid-evaluator.ts

export type RaidGrade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
export type RaidEvaluatorStrategy = 'honor' | 'otk_burst';

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
  FAILED_ASYNC_CONDITION = 1 << 9
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
}

export type AsyncRaidCondition = (candidate: RaidCandidate) => Promise<boolean> | boolean;

export interface RaidEvaluationOptions {
  strategy?: RaidEvaluatorStrategy; // 'honor' (default, high HP/low players) or 'otk_burst' (low HP/active players)
  minScore?: number;        // Minimum score to be eligible to join (default: 40)
  minHpPct?: number;        // Hard minimum HP% (default: 25 for honor, 1 for otk_burst)
  maxHpPct?: number;        // Hard maximum HP% (default: 20 for otk_burst)
  minPlayers?: number;      // Hard minimum players (default: 1 for honor, 3 for otk_burst)
  maxPlayers?: number;      // Hard max players (default: 8 for honor, 29 for otk_burst)
  deadRaidIds?: string[] | Set<string> | Map<string, any>; // Blacklisted / recently ended or full raid IDs
  useCache?: boolean;       // Enable high-speed LRU result memoization (default: false)
  cacheTtlMs?: number;      // Cache time-to-live in ms (default: 5000)
  asyncConditions?: AsyncRaidCondition[]; // Multiple async conditions evaluated in parallel
  asyncValidator?: AsyncRaidCondition;   // Single async predicate evaluated in parallel
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

export class RaidEvaluator {
  public static readonly DEFAULT_MIN_SCORE = 40;
  public static readonly DEFAULT_MIN_HP = 25;
  public static readonly DEFAULT_MAX_PLAYERS = 8;
  public static readonly DEFAULT_OTK_MAX_HP = 20;
  public static readonly DEFAULT_OTK_MIN_PLAYERS = 3;

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
    return `${raidId || 'noid'}:${hpPct}:${players}:${maxPlayers}:${options.strategy || 'honor'}:${options.minScore ?? 40}:${options.minHpPct ?? 0}:${options.maxHpPct ?? 0}:${options.minPlayers ?? 0}:${options.maxPlayers ?? 0}`;
  }

  /**
   * Evaluates a single candidate raid synchronously and calculates a quality/viability score (0 - 100).
   * Supports two distinct strategies:
   * 1. 'honor' (default): Targets fresh raids (HP > 85%, players <= 2) to build max honors for Blue Chest.
   * 2. 'otk_burst': Targets dying raids (HP <= 20%, players >= 3) for rapid leech/participation drops and fast clear.
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
    if (options.strategy === 'otk_burst') {
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

    // 4. Critical burn rate / Doomed raid disqualification
    if (hpPct < 30 && players >= 5) {
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

    if (hpPct < 40 && players >= 8) {
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

    if (hpPerPlayer < 5.0) {
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

    // 5. Hard maximum HP ceiling check (HP too high will take minutes to clear)
    if (hpPct > maxHp + 15) {
      flags |= RaidDisqualificationReason.HP_ABOVE_MAX;
      flagSummaries.push('HP_ABOVE_MAX');
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP (${hpPct}%) significantly exceeds OTK burst limit (${maxHp}%): raid will take too long to clear`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer: 0, flags, flagsSummary: flagSummaries }
      };
    }

    const effectivePlayers = Math.max(players, 1);
    const hpPerPlayer = round2(hpPct / effectivePlayers);

    // 6. HP Quality Score (0 to 55 points)
    let hpScore = 0;
    if (hpPct <= maxHp) {
      if (hpPct >= 3 && hpPct <= 12) {
        hpScore = 55 - (Math.abs(hpPct - 6) * 0.7);
      } else if (hpPct > 12) {
        hpScore = 50 - ((hpPct - 12) / 8) * 12;
      } else {
        hpScore = 46 + (hpPct - 1) * 2;
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

    // 8. Sweet Spot Synergy Bonus (+5 points)
    let sweetSpotBonus = 0;
    if (hpPct <= maxHp && players >= minP) {
      sweetSpotBonus = 5;
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
      const evaluation = RaidEvaluator.evaluateCandidate(
        c.hpPct,
        c.players,
        c.maxPlayers,
        options,
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
      nonViableCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { best: null, viableCandidates: [], nonViableCandidates };
    }

    this.sortViableCandidates(viableCandidates, options.strategy === 'otk_burst');

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
      const evaluation = RaidEvaluator.evaluateCandidate(
        c.hpPct,
        c.players,
        c.maxPlayers,
        options,
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
      nonViableCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
      return { best: null, viableCandidates: [], nonViableCandidates };
    }

    this.sortViableCandidates(viableCandidates, options.strategy === 'otk_burst');

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
  private static sortViableCandidates(viableCandidates: RaidCandidate[], isOtk: boolean): void {
    viableCandidates.sort((a, b) => {
      // Primary: Score descending
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      if (isOtk) {
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


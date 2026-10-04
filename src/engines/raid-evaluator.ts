// src/engines/raid-evaluator.ts

export type RaidGrade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

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

export interface RaidEvaluationOptions {
  minScore?: number;        // Minimum score to be eligible to join (default: 40)
  minHpPct?: number;        // Hard minimum HP% (default: 25)
  maxPlayers?: number;      // Hard max players (default: 8)
  deadRaidIds?: string[];   // Blacklisted / recently ended or full raid IDs
}

export class RaidEvaluator {
  public static readonly DEFAULT_MIN_SCORE = 40;
  public static readonly DEFAULT_MIN_HP = 25;
  public static readonly DEFAULT_MAX_PLAYERS = 8;

  /**
   * Evaluates a single candidate raid and calculates a quality/viability score (0 - 100).
   *
   * Scoring Breakdown:
   * - HP > 85% and players <= 2: Sweet spot / Top Tier (Score 90-100, Grade S/S+)
   * - High HP + Few Players: Score gradually decreases as HP drops or player count increases
   * - Low HP + High Players (e.g. HP < 30% with 5+ players, HP < 40% with 8+ players, or HP < 20%):
   *   Unviable burn rate -> Disqualified (Score 0, Grade F)
   */
  public static evaluateCandidate(
    hpPct: number,
    players: number,
    maxPlayers: number = 30,
    options: RaidEvaluationOptions = {},
    raidId?: string
  ): RaidEvaluationResult {
    const minScore = options.minScore ?? RaidEvaluator.DEFAULT_MIN_SCORE;
    const minHp = options.minHpPct ?? RaidEvaluator.DEFAULT_MIN_HP;
    const maxP = options.maxPlayers ?? RaidEvaluator.DEFAULT_MAX_PLAYERS;
    const deadIds = options.deadRaidIds || [];

    const effectivePlayers = Math.max(players, 1);
    const hpPerPlayer = Number((hpPct / effectivePlayers).toFixed(2));

    // 1. Blacklist check (already full or ended)
    if (raidId && deadIds.includes(raidId)) {
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: 'Raid marked full or ended in recent attempts (blacklisted)',
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer }
      };
    }

    // 2. Hard absolute minimum HP threshold
    if (hpPct < minHp) {
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP (${hpPct}%) is below minimum threshold (${minHp}%)`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer }
      };
    }

    // 3. Hard maximum player ceiling
    if (players > maxP) {
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Players (${players}/${maxPlayers}) exceeds player limit (${maxP})`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer }
      };
    }

    // 4. Critical burn rate / Doomed raid disqualification
    // As requested: HP < 30% and joined raid is 9 (or >= 5) cannot reach minimum honors before wipe
    if (hpPct < 30 && players >= 5) {
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP < 30% (${hpPct}%) with ${players} players: fast burn will terminate battle before minimum honors`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer }
      };
    }

    if (hpPct < 40 && players >= 8) {
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `HP < 40% (${hpPct}%) with ${players} players: excessive burn rate`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer }
      };
    }

    if (hpPerPlayer < 5.0) {
      return {
        score: 0,
        grade: 'F',
        viable: false,
        reason: `Remaining HP per player (${hpPerPlayer}%) < 5.0%: raid lifespan too short to guarantee blue chest`,
        details: { hpScore: 0, playerScore: 0, sweetSpotBonus: 0, burnPenalty: 0, hpPerPlayer }
      };
    }

    // 5. HP Quality Score (0 to 55 points)
    let hpScore = 0;
    if (hpPct >= 85) {
      // 85% - 100%: 48 to 55 points
      hpScore = 48 + ((hpPct - 85) / 15) * 7;
    } else if (hpPct >= 65) {
      // 65% - 84%: 32 to 47 points
      hpScore = 32 + ((hpPct - 65) / 20) * 15;
    } else if (hpPct >= 45) {
      // 45% - 64%: 18 to 31 points
      hpScore = 18 + ((hpPct - 45) / 20) * 13;
    } else {
      // 20% - 44%: 5 to 17 points
      hpScore = 5 + ((hpPct - 20) / 25) * 12;
    }

    // 6. Player Count Points (0 to 40 points)
    let playerScore = 0;
    if (players <= 1) {
      playerScore = 40;
    } else if (players === 2) {
      playerScore = 38;
    } else if (players === 3) {
      playerScore = 32;
    } else if (players === 4) {
      playerScore = 25;
    } else if (players === 5) {
      playerScore = 18;
    } else if (players === 6) {
      playerScore = 12;
    } else if (players === 7) {
      playerScore = 6;
    } else if (players === 8) {
      playerScore = 2;
    } else {
      playerScore = 0;
    }

    // 7. Sweet Spot Synergy Bonus (+5 points)
    // When HP >= 85% and players <= 2, maximum priority
    let sweetSpotBonus = 0;
    if (hpPct >= 85 && players <= 2) {
      sweetSpotBonus = 5;
    }

    // 8. Burn Rate Penalty
    // If remaining HP per player is low (< 12%), apply penalty
    let burnPenalty = 0;
    if (hpPerPlayer < 12) {
      burnPenalty = Number(((12 - hpPerPlayer) * 1.5).toFixed(1));
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
    const reason = viable
      ? `Viable raid (Score: ${finalScore} pt, Grade: ${grade}, HP: ${hpPct}%, Players: ${players}/${maxPlayers})`
      : `Score ${finalScore} pt (Grade ${grade}) is below minimum acceptable threshold (${minScore} pt)`;

    return {
      score: finalScore,
      grade,
      viable,
      reason,
      details: {
        hpScore: Number(hpScore.toFixed(1)),
        playerScore,
        sweetSpotBonus,
        burnPenalty,
        hpPerPlayer
      }
    };
  }

  /**
   * Sorts and selects the optimal raid candidate from an array of scanned cards.
   * Returns null if no candidates are viable (allowing caller to wait and refresh).
   */
  public static selectBestCandidate(
    candidates: RaidCandidate[],
    options: RaidEvaluationOptions = {}
  ): { best: RaidCandidate | null; viableCandidates: RaidCandidate[]; nonViableCandidates: RaidCandidate[] } {
    const evaluated = candidates.map(c => {
      const evaluation = RaidEvaluator.evaluateCandidate(
        c.hpPct,
        c.players,
        c.maxPlayers,
        options,
        c.raidId
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

    // Sort viable candidates: Highest score first, then highest HP, then fewest players
    viableCandidates.sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      if (b.hpPct !== a.hpPct) {
        return b.hpPct - a.hpPct;
      }
      return a.players - b.players;
    });

    return {
      best: viableCandidates[0],
      viableCandidates,
      nonViableCandidates
    };
  }
}

import type {
  Color,
  GameRecord,
  Pairing,
  PairingResult,
  Player,
  Round,
} from './types.js';

/** Points the white player earns for a given result. */
export function whitePoints(result: PairingResult): number {
  switch (result) {
    case 'WHITE_WIN':
    case 'WHITE_WIN_FORFEIT':
    case 'FULL_POINT_BYE':
      return 1;
    case 'DRAW':
      return 0.5;
    case 'HALF_POINT_BYE':
      return 0.5;
    case 'BLACK_WIN':
    case 'BLACK_WIN_FORFEIT':
    case 'DOUBLE_FORFEIT':
    case 'ZERO_POINT_BYE':
    case 'PENDING':
      return 0;
  }
}

/** Points the black player earns. Undefined for bye pairings (no black). */
export function blackPoints(result: PairingResult): number {
  switch (result) {
    case 'BLACK_WIN':
    case 'BLACK_WIN_FORFEIT':
      return 1;
    case 'DRAW':
      return 0.5;
    case 'WHITE_WIN':
    case 'WHITE_WIN_FORFEIT':
    case 'DOUBLE_FORFEIT':
    case 'PENDING':
    default:
      return 0;
  }
}

export function isByeResult(result: PairingResult): boolean {
  return (
    result === 'FULL_POINT_BYE' ||
    result === 'HALF_POINT_BYE' ||
    result === 'ZERO_POINT_BYE'
  );
}

export function isForfeitResult(result: PairingResult): boolean {
  return (
    result === 'WHITE_WIN_FORFEIT' ||
    result === 'BLACK_WIN_FORFEIT' ||
    result === 'DOUBLE_FORFEIT'
  );
}

export function isResultEntered(result: PairingResult): boolean {
  return result !== 'PENDING';
}

/**
 * Build the complete, ordered game history for one player across all rounds.
 * This is the canonical projection consumed by TRF serialization and
 * tie-break computation — it must reflect every round, including byes.
 */
export function buildPlayerHistory(playerId: string, rounds: Round[]): GameRecord[] {
  const ordered = [...rounds].sort((a, b) => a.index - b.index);
  const history: GameRecord[] = [];

  for (const round of ordered) {
    const pairing = round.pairings.find(
      (p) => p.whiteId === playerId || p.blackId === playerId,
    );
    if (!pairing) continue; // player not paired this round (e.g. not yet entered)

    if (pairing.blackId === null) {
      // Single-player allocation (bye of some kind).
      history.push({
        roundIndex: round.index,
        opponentId: null,
        color: null,
        points: whitePoints(pairing.result),
        forfeit: false,
        bye: true,
      });
      continue;
    }

    const isWhite = pairing.whiteId === playerId;
    const color: Color = isWhite ? 'W' : 'B';
    const points = isWhite ? whitePoints(pairing.result) : blackPoints(pairing.result);
    history.push({
      roundIndex: round.index,
      opponentId: isWhite ? pairing.blackId : pairing.whiteId,
      color,
      points,
      forfeit: isForfeitResult(pairing.result),
      bye: false,
    });
  }

  return history;
}

/** Total score for a player from a prebuilt history. */
export function scoreFromHistory(history: GameRecord[]): number {
  return history.reduce((sum, g) => sum + g.points, 0);
}

/** Convenience: total score for a player given the rounds. */
export function playerScore(playerId: string, rounds: Round[]): number {
  return scoreFromHistory(buildPlayerHistory(playerId, rounds));
}

/** Color balance n = (#whites − #blacks) from a history. */
export function colorBalance(history: GameRecord[]): number {
  let n = 0;
  for (const g of history) {
    if (g.color === 'W') n += 1;
    else if (g.color === 'B') n -= 1;
  }
  return n;
}

/**
 * Number of consecutive games (from the most recent backwards) the player had
 * the given color. Byes break the streak.
 */
export function trailingColorStreak(history: GameRecord[], color: Color): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const g = history[i]!;
    if (g.color === color) streak += 1;
    else break;
  }
  return streak;
}

export function hasReceivedBye(history: GameRecord[]): boolean {
  return history.some((g) => g.bye);
}

/** True if the player has ever won by forfeit (relevant to bye eligibility). */
export function hasWonByForfeit(playerId: string, rounds: Round[]): boolean {
  for (const round of rounds) {
    for (const p of round.pairings) {
      if (p.result === 'WHITE_WIN_FORFEIT' && p.whiteId === playerId) return true;
      if (p.result === 'BLACK_WIN_FORFEIT' && p.blackId === playerId) return true;
    }
  }
  return false;
}

/**
 * Players a given player has already faced (excludes byes / null opponents).
 * Drives the opponents matrix and rematch prevention.
 */
export function opponentsOf(playerId: string, rounds: Round[]): Set<string> {
  const set = new Set<string>();
  for (const g of buildPlayerHistory(playerId, rounds)) {
    if (g.opponentId) set.add(g.opponentId);
  }
  return set;
}

/** Title precedence helper: lower number = stronger title. */
export function titleRank(title: Player['fideTitle']): number {
  const order: Player['fideTitle'][] = [
    'GM',
    'IM',
    'WGM',
    'FM',
    'WIM',
    'CM',
    'WFM',
    'WCM',
    'NONE',
  ];
  const idx = order.indexOf(title);
  return idx === -1 ? order.length : idx;
}

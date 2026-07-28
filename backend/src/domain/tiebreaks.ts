// Tie-break systems (§5). These order players on equal points for standings and
// final classification — they are NOT used for pairing (the engine handles
// that). Config is an ordered list of codes per tournament.
//
// Unplayed games (byes and forfeits) use FIDE's VIRTUAL OPPONENT rule: a real
// opponent's score cannot be used because no game took place, so a fictitious
// opponent is scored as
//
//     VO = (player's score before round r) + (1 − points the player got in r)
//          + 0.5 × (number of rounds after r)
//
// i.e. the virtual opponent matches the player up to that round, takes the
// complementary result, then draws every remaining round. This matters whenever
// a field has byes or walkovers — without it, players with a bye get an
// artificially low Buchholz.

import { buildPlayerHistory, scoreFromHistory } from './scoring.js';
import type { GameRecord, Player, Round } from './types.js';

export type TieBreakCode =
  | 'BUCHHOLZ'
  | 'BUCHHOLZ_CUT1'
  | 'BUCHHOLZ_MEDIAN'
  | 'SONNEBORN_BERGER'
  | 'PROGRESSIVE'
  | 'ARO' // average rating of opponents
  | 'WINS'
  | 'DIRECT_ENCOUNTER';

export const TIE_BREAK_LABELS: Record<TieBreakCode, string> = {
  BUCHHOLZ: 'Buchholz',
  BUCHHOLZ_CUT1: 'Buchholz Cut-1',
  BUCHHOLZ_MEDIAN: 'Median Buchholz',
  SONNEBORN_BERGER: 'Sonneborn-Berger',
  PROGRESSIVE: 'Progressive (cumulative)',
  ARO: 'Avg. rating of opponents',
  WINS: 'Number of wins',
  DIRECT_ENCOUNTER: 'Direct encounter',
};

export function isTieBreakCode(s: string): s is TieBreakCode {
  return s in TIE_BREAK_LABELS;
}

interface Context {
  rounds: Round[];
  /** playerId -> total score (precomputed). */
  scoreById: Map<string, number>;
  /** playerId -> player (for ratings). */
  playerById: Map<string, Player>;
  /** Total rounds the event is scheduled for (needed by the virtual opponent). */
  numberOfRounds: number;
}

function buildContext(
  players: Player[],
  rounds: Round[],
  numberOfRounds: number,
): Context {
  const scoreById = new Map<string, number>();
  const playerById = new Map<string, Player>();
  for (const p of players) {
    playerById.set(p.id, p);
    scoreById.set(p.id, scoreFromHistory(buildPlayerHistory(p.id, rounds)));
  }
  return { rounds, scoreById, playerById, numberOfRounds };
}

/** A game with no real opponent behind it: byes and walkovers. */
function isUnplayed(g: GameRecord): boolean {
  return g.bye || g.forfeit;
}

/**
 * Score of the fictitious opponent standing in for an unplayed game (FIDE).
 * Assumes `history` is ordered by round.
 */
function virtualOpponentScore(
  history: GameRecord[],
  game: GameRecord,
  numberOfRounds: number,
): number {
  const scoreBefore = history
    .filter((g) => g.roundIndex < game.roundIndex)
    .reduce((sum, g) => sum + g.points, 0);
  const roundsAfter = Math.max(0, numberOfRounds - game.roundIndex);
  return scoreBefore + (1 - game.points) + 0.5 * roundsAfter;
}

/**
 * The opponent score to use for each game: the real opponent's total, or the
 * virtual opponent's score when the game was not played.
 */
function opponentScores(history: GameRecord[], ctx: Context): number[] {
  const ordered = [...history].sort((a, b) => a.roundIndex - b.roundIndex);
  return ordered.map((g) =>
    isUnplayed(g) || !g.opponentId
      ? virtualOpponentScore(ordered, g, ctx.numberOfRounds)
      : (ctx.scoreById.get(g.opponentId) ?? 0),
  );
}

function buchholz(history: GameRecord[], ctx: Context): number {
  return opponentScores(history, ctx).reduce((a, b) => a + b, 0);
}

function buchholzCut1(history: GameRecord[], ctx: Context): number {
  const scores = opponentScores(history, ctx).sort((a, b) => a - b);
  if (scores.length === 0) return 0;
  return scores.slice(1).reduce((a, b) => a + b, 0); // drop the lowest
}

function buchholzMedian(history: GameRecord[], ctx: Context): number {
  const scores = opponentScores(history, ctx).sort((a, b) => a - b);
  if (scores.length <= 2) return 0;
  return scores.slice(1, -1).reduce((a, b) => a + b, 0); // drop lowest & highest
}

function sonnebornBerger(history: GameRecord[], ctx: Context): number {
  const ordered = [...history].sort((a, b) => a.roundIndex - b.roundIndex);
  const scores = opponentScores(ordered, ctx);
  // Sum of (opponent's score x points scored against them), with unplayed
  // games contributing via their virtual opponent.
  return ordered.reduce((sb, g, i) => sb + (scores[i] ?? 0) * g.points, 0);
}

function progressive(history: GameRecord[]): number {
  // Sum of the running score after each round (cumulative score).
  let running = 0;
  let total = 0;
  const ordered = [...history].sort((a, b) => a.roundIndex - b.roundIndex);
  for (const g of ordered) {
    running += g.points;
    total += running;
  }
  return total;
}

function aro(history: GameRecord[], ctx: Context): number {
  const ratings = history
    .filter((g) => g.opponentId)
    .map((g) => ctx.playerById.get(g.opponentId!)?.pairingRating ?? 0);
  if (ratings.length === 0) return 0;
  return Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length);
}

function wins(history: GameRecord[]): number {
  return history.filter((g) => !g.bye && g.points === 1).length;
}

/** Compute a single tie-break value for a player. */
export function computeTieBreak(
  code: TieBreakCode,
  playerId: string,
  ctx: Context,
): number {
  const history = buildPlayerHistory(playerId, ctx.rounds);
  switch (code) {
    case 'BUCHHOLZ':
      return buchholz(history, ctx);
    case 'BUCHHOLZ_CUT1':
      return buchholzCut1(history, ctx);
    case 'BUCHHOLZ_MEDIAN':
      return buchholzMedian(history, ctx);
    case 'SONNEBORN_BERGER':
      return sonnebornBerger(history, ctx);
    case 'PROGRESSIVE':
      return progressive(history);
    case 'ARO':
      return aro(history, ctx);
    case 'WINS':
      return wins(history);
    case 'DIRECT_ENCOUNTER':
      return 0; // resolved pairwise in the comparator, not as a scalar
  }
}

export { buildContext };
export type { Context as TieBreakContext };

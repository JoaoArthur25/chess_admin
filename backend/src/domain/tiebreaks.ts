// Tie-break systems (§5). These order players on equal points for standings and
// final classification — they are NOT used for pairing (the engine handles
// that). Config is an ordered list of codes per tournament.
//
// NOTE on unplayed games: FIDE's modern regulations specify a "virtual
// opponent" adjustment for byes/forfeits in Buchholz-type tie-breaks. This
// implementation computes the classic sum-of-opponents'-scores form over the
// real opponents the player actually faced. The virtual-opponent refinement is
// a documented follow-up (it affects ordering only within already-tied groups).

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
}

function buildContext(players: Player[], rounds: Round[]): Context {
  const scoreById = new Map<string, number>();
  const playerById = new Map<string, Player>();
  for (const p of players) {
    playerById.set(p.id, p);
    scoreById.set(p.id, scoreFromHistory(buildPlayerHistory(p.id, rounds)));
  }
  return { rounds, scoreById, playerById };
}

function realOpponentScores(history: GameRecord[], ctx: Context): number[] {
  return history
    .filter((g) => g.opponentId)
    .map((g) => ctx.scoreById.get(g.opponentId!) ?? 0);
}

function buchholz(history: GameRecord[], ctx: Context): number {
  return realOpponentScores(history, ctx).reduce((a, b) => a + b, 0);
}

function buchholzCut1(history: GameRecord[], ctx: Context): number {
  const scores = realOpponentScores(history, ctx).sort((a, b) => a - b);
  if (scores.length === 0) return 0;
  return scores.slice(1).reduce((a, b) => a + b, 0); // drop the lowest
}

function buchholzMedian(history: GameRecord[], ctx: Context): number {
  const scores = realOpponentScores(history, ctx).sort((a, b) => a - b);
  if (scores.length <= 2) return 0;
  return scores.slice(1, -1).reduce((a, b) => a + b, 0); // drop lowest & highest
}

function sonnebornBerger(history: GameRecord[], ctx: Context): number {
  let sb = 0;
  for (const g of history) {
    if (!g.opponentId) continue;
    sb += (ctx.scoreById.get(g.opponentId) ?? 0) * g.points;
  }
  return sb;
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

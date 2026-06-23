// Live standings (§6). Orders players by points, then the configured tie-break
// chain, then direct encounter, then starting rank. Also surfaces per-player
// colour history for the UI to display.

import { buildPlayerHistory, colorBalance } from './scoring.js';
import {
  buildContext,
  computeTieBreak,
  isTieBreakCode,
  type TieBreakCode,
} from './tiebreaks.js';
import type { Color, Player, Round, Tournament } from './types.js';

export interface StandingRow {
  rank: number;
  player: Player;
  points: number;
  /** Tie-break values keyed by code, in the tournament's configured order. */
  tieBreaks: { code: TieBreakCode; value: number }[];
  /** Colours played, in round order (for the colour-history column). */
  colors: (Color | null)[];
  colorBalance: number;
  opponents: (string | null)[];
}

/** Direct encounter between two players: +1 if a beat b on aggregate, -1, or 0. */
function directEncounter(aId: string, bId: string, rounds: Round[]): number {
  let aPoints = 0;
  let bPoints = 0;
  let met = false;
  for (const g of buildPlayerHistory(aId, rounds)) {
    if (g.opponentId === bId) {
      met = true;
      aPoints += g.points;
    }
  }
  for (const g of buildPlayerHistory(bId, rounds)) {
    if (g.opponentId === aId) bPoints += g.points;
  }
  if (!met) return 0;
  return Math.sign(aPoints - bPoints);
}

export function computeStandings(t: Tournament): StandingRow[] {
  const codes = t.tieBreaks.filter(isTieBreakCode);
  const ranked = t.players.filter((p) => p.startingRank != null);
  const ctx = buildContext(ranked, t.rounds);

  interface Pre {
    player: Player;
    points: number;
    tb: { code: TieBreakCode; value: number }[];
    colors: (Color | null)[];
    opponents: (string | null)[];
  }

  const pre: Pre[] = ranked.map((p) => {
    const history = buildPlayerHistory(p.id, t.rounds);
    return {
      player: p,
      points: ctx.scoreById.get(p.id) ?? 0,
      tb: codes.map((code) => ({ code, value: computeTieBreak(code, p.id, ctx) })),
      colors: history.map((g) => g.color),
      opponents: history.map((g) => g.opponentId),
    };
  });

  pre.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    for (let i = 0; i < codes.length; i += 1) {
      const code = codes[i]!;
      if (code === 'DIRECT_ENCOUNTER') {
        const de = directEncounter(b.player.id, a.player.id, t.rounds);
        if (de !== 0) return de; // de>0 => b beat a => b ranks higher
        continue;
      }
      const av = a.tb[i]!.value;
      const bv = b.tb[i]!.value;
      if (bv !== av) return bv - av;
    }
    // Final stable fallback: starting rank (TPN).
    return (a.player.startingRank ?? 0) - (b.player.startingRank ?? 0);
  });

  return pre.map((row, i) => ({
    rank: i + 1,
    player: row.player,
    points: row.points,
    tieBreaks: row.tb,
    colors: row.colors,
    colorBalance: colorBalance(buildPlayerHistory(row.player.id, t.rounds)),
    opponents: row.opponents,
  }));
}

/**
 * The opponents matrix (§5): rows/cols indexed by starting rank, cell = the
 * round index in which the two players met, or null. Drives the audit UI and
 * rematch prevention.
 */
export function opponentsMatrix(t: Tournament): {
  ranks: number[];
  cell: (a: number, b: number) => number | null;
} {
  const ranked = t.players.filter((p) => p.startingRank != null);
  const idByRank = new Map<number, string>();
  for (const p of ranked) idByRank.set(p.startingRank!, p.id);

  const met = new Map<string, number>(); // "aId|bId" -> round index
  for (const round of t.rounds) {
    for (const p of round.pairings) {
      if (p.blackId) {
        met.set(`${p.whiteId}|${p.blackId}`, round.index);
        met.set(`${p.blackId}|${p.whiteId}`, round.index);
      }
    }
  }

  const ranks = ranked.map((p) => p.startingRank!).sort((a, b) => a - b);
  return {
    ranks,
    cell: (a, b) => {
      const aId = idByRank.get(a);
      const bId = idByRank.get(b);
      if (!aId || !bId) return null;
      return met.get(`${aId}|${bId}`) ?? null;
    },
  };
}

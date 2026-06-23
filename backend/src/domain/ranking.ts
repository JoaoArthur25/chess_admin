import type { Player } from './types.js';
import { titleRank } from './scoring.js';

/**
 * Compute the Tournament Pairing Number (TPN) order: the initial ranking.
 * Sort key per FIDE: pairing rating (desc), then title precedence, then name
 * (alphabetical, locale-insensitive). LATE_ENTRY players are appended at the
 * end of the list regardless of rating, per §4.
 *
 * Returns a new array of players in TPN order. `startingRank` is the 1-based
 * index in this array.
 */
export function computeTpnOrder(players: Player[]): Player[] {
  const regular = players.filter((p) => p.status !== 'LATE_ENTRY');
  const late = players.filter((p) => p.status === 'LATE_ENTRY');

  const byStrength = (a: Player, b: Player): number => {
    if (b.pairingRating !== a.pairingRating) return b.pairingRating - a.pairingRating;
    const tr = titleRank(a.fideTitle) - titleRank(b.fideTitle);
    if (tr !== 0) return tr;
    return a.fullName.localeCompare(b.fullName, 'en', { sensitivity: 'base' });
  };

  return [...regular.sort(byStrength), ...late.sort(byStrength)];
}

/** Assign 1-based startingRank to each player based on TPN order. */
export function assignStartingRanks(players: Player[]): Map<string, number> {
  const ordered = computeTpnOrder(players);
  const ranks = new Map<string, number>();
  ordered.forEach((p, i) => ranks.set(p.id, i + 1));
  return ranks;
}

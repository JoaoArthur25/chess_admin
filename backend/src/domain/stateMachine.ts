// Tournament state machine (§4/§5). The Swiss system is dynamic: round N can
// only be generated once round N-1 is fully complete and confirmed. These are
// pure predicates; the service enforces them on every transition.

import { isResultEntered } from './scoring.js';
import type { Round, Tournament } from './types.js';

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

/** A round is complete when every pairing has a result entered. */
export function isRoundComplete(round: Round): boolean {
  return round.pairings.length > 0 && round.pairings.every((p) => isResultEntered(p.result));
}

/** All rounds that currently exist, sorted by index. */
function sortedRounds(t: Tournament): Round[] {
  return [...t.rounds].sort((a, b) => a.index - b.index);
}

/**
 * Whether the next round can be generated. Requires:
 *  - the tournament is not FINISHED and has rounds left,
 *  - every existing round is COMPLETED.
 */
export function canGenerateNextRound(t: Tournament): { ok: boolean; reason?: string } {
  if (t.state === 'FINISHED') return { ok: false, reason: 'Tournament is finished.' };
  if (t.players.filter((p) => p.startingRank != null).length < 2) {
    return { ok: false, reason: 'At least two ranked players are required.' };
  }

  const rounds = sortedRounds(t);
  if (rounds.length >= t.numberOfRounds) {
    return { ok: false, reason: 'All rounds have already been generated.' };
  }

  const incomplete = rounds.find((r) => !isRoundComplete(r));
  if (incomplete) {
    return {
      ok: false,
      reason: `Round ${incomplete.index} is not complete; finish it before generating the next round.`,
    };
  }

  return { ok: true };
}

/** Assert-style wrapper that throws StateError when generation is not allowed. */
export function assertCanGenerateNextRound(t: Tournament): void {
  const { ok, reason } = canGenerateNextRound(t);
  if (!ok) throw new StateError(reason ?? 'Cannot generate the next round.');
}

/** The index of the round that would be generated next (1-based). */
export function nextRoundIndex(t: Tournament): number {
  return sortedRounds(t).length + 1;
}

/** Whether the tournament is complete (all rounds generated and completed). */
export function isTournamentComplete(t: Tournament): boolean {
  const rounds = sortedRounds(t);
  return rounds.length === t.numberOfRounds && rounds.every(isRoundComplete);
}

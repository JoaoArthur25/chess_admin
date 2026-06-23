import { describe, expect, it } from 'vitest';
import {
  colorAlerts,
  detectRetroactiveEdit,
  hasBlockingError,
  validateByeAssignment,
  validateManualPairing,
} from '../src/domain/rules.js';
import {
  canGenerateNextRound,
  isRoundComplete,
  isTournamentComplete,
} from '../src/domain/stateMachine.js';
import { makePairing, makePlayer, makeRound, makeTournament } from './helpers.js';
import type { Round } from '../src/domain/types.js';

describe('manual pairing validation', () => {
  it('blocks a rematch as an ERROR', () => {
    const rounds: Round[] = [makeRound(1, [makePairing('a', 'b', 'WHITE_WIN')])];
    const alerts = validateManualPairing('a', 'b', rounds);
    expect(alerts.some((x) => x.code === 'REMATCH' && x.severity === 'ERROR')).toBe(true);
    expect(hasBlockingError(alerts)).toBe(true);
  });

  it('blocks self-pairing', () => {
    const alerts = validateManualPairing('a', 'a', []);
    expect(alerts[0]!.code).toBe('SELF_PAIRING');
  });

  it('allows a fresh pairing with no alerts', () => {
    const rounds: Round[] = [makeRound(1, [makePairing('a', 'c', 'DRAW')])];
    const alerts = validateManualPairing('a', 'b', rounds);
    expect(alerts).toHaveLength(0);
  });
});

describe('colour alerts', () => {
  it('warns on the same colour three times in a row', () => {
    const rounds: Round[] = [
      makeRound(1, [makePairing('a', 'x', 'WHITE_WIN')]),
      makeRound(2, [makePairing('a', 'y', 'WHITE_WIN')]),
    ];
    const alerts = colorAlerts('a', 'W', rounds);
    expect(alerts.some((x) => x.code === 'COLOR_STREAK')).toBe(true);
  });

  it('warns when colour difference would exceed 2', () => {
    const rounds: Round[] = [
      makeRound(1, [makePairing('a', 'x', 'WHITE_WIN')]),
      makeRound(2, [makePairing('a', 'y', 'DRAW')]),
      // a is white twice (n=2); a third white pushes n=3 (>2).
    ];
    const alerts = colorAlerts('a', 'W', rounds);
    expect(alerts.some((x) => x.code === 'COLOR_DIFFERENCE')).toBe(true);
  });

  it('does not warn for a balanced player getting either colour', () => {
    const rounds: Round[] = [
      makeRound(1, [makePairing('a', 'x', 'WHITE_WIN')]),
      makeRound(2, [makePairing('y', 'a', 'DRAW')]),
    ];
    expect(colorAlerts('a', 'W', rounds)).toHaveLength(0);
    expect(colorAlerts('a', 'B', rounds)).toHaveLength(0);
  });
});

describe('bye validation', () => {
  it('blocks a second full-point bye', () => {
    const rounds: Round[] = [makeRound(1, [makePairing('a', null, 'FULL_POINT_BYE')])];
    const alerts = validateByeAssignment('a', 'FULL_POINT_BYE', rounds);
    expect(alerts.some((x) => x.code === 'BYE_ALREADY_GIVEN')).toBe(true);
  });

  it('blocks a full-point bye after a forfeit win', () => {
    const rounds: Round[] = [makeRound(1, [makePairing('a', 'b', 'WHITE_WIN_FORFEIT')])];
    const alerts = validateByeAssignment('a', 'FULL_POINT_BYE', rounds);
    expect(alerts.some((x) => x.code === 'BYE_AFTER_FORFEIT_WIN')).toBe(true);
  });

  it('permits half-point byes freely', () => {
    const rounds: Round[] = [makeRound(1, [makePairing('a', null, 'FULL_POINT_BYE')])];
    expect(validateByeAssignment('a', 'HALF_POINT_BYE', rounds)).toHaveLength(0);
  });
});

describe('retroactive edit detection', () => {
  it('flags edits to a completed earlier round', () => {
    expect(detectRetroactiveEdit(1, 3)).not.toBeNull();
    expect(detectRetroactiveEdit(1, 3)!.code).toBe('RETROACTIVE_EDIT');
  });
  it('does not flag edits to the current round', () => {
    expect(detectRetroactiveEdit(3, 3)).toBeNull();
  });
});

describe('state machine', () => {
  it('blocks the next round until the current one is complete', () => {
    const players = [
      makePlayer({ id: 'a', startingRank: 1 }),
      makePlayer({ id: 'b', startingRank: 2 }),
    ];
    const incomplete = makeRound(1, [makePairing('a', 'b', 'PENDING')]);
    const t = makeTournament({
      players,
      state: 'RUNNING',
      numberOfRounds: 3,
      rounds: [incomplete],
    });
    expect(isRoundComplete(incomplete)).toBe(false);
    expect(canGenerateNextRound(t).ok).toBe(false);
  });

  it('allows the next round once the current one is complete', () => {
    const players = [
      makePlayer({ id: 'a', startingRank: 1 }),
      makePlayer({ id: 'b', startingRank: 2 }),
    ];
    const done = makeRound(1, [makePairing('a', 'b', 'WHITE_WIN')]);
    const t = makeTournament({
      players,
      state: 'RUNNING',
      numberOfRounds: 3,
      rounds: [done],
    });
    expect(canGenerateNextRound(t).ok).toBe(true);
  });

  it('reports completion when all rounds are done', () => {
    const players = [
      makePlayer({ id: 'a', startingRank: 1 }),
      makePlayer({ id: 'b', startingRank: 2 }),
    ];
    const t = makeTournament({
      players,
      state: 'RUNNING',
      numberOfRounds: 1,
      rounds: [makeRound(1, [makePairing('a', 'b', 'WHITE_WIN')])],
    });
    expect(isTournamentComplete(t)).toBe(true);
    expect(canGenerateNextRound(t).ok).toBe(false);
  });
});

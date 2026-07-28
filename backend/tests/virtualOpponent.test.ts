import { describe, expect, it } from 'vitest';
import { computeStandings } from '../src/domain/standings.js';
import { assignStartingRanks } from '../src/domain/ranking.js';
import { makePairing, makePlayer, makeRound, makeTournament } from './helpers.js';
import type { Tournament } from '../src/domain/types.js';

function ranked(t: Tournament): Tournament {
  const ranks = assignStartingRanks(t.players);
  t.players = t.players.map((p) => ({ ...p, startingRank: ranks.get(p.id) ?? null }));
  return t;
}

function bh(t: Tournament, playerId: string): number {
  const row = computeStandings(t).find((s) => s.player.id === playerId)!;
  return row.tieBreaks.find((x) => x.code === 'BUCHHOLZ')!.value;
}

describe('virtual opponent (FIDE unplayed-game rule)', () => {
  it('scores a full-point bye via the virtual opponent formula', () => {
    // 3-round event. "bye" player: loses R1, gets a full-point bye in R2,
    // wins R3.
    const a = makePlayer({ id: 'a', pairingRating: 2000 });
    const b = makePlayer({ id: 'b', pairingRating: 1900 });
    const c = makePlayer({ id: 'c', pairingRating: 1800 });

    let t = makeTournament({
      players: [a, b, c],
      numberOfRounds: 3,
      tieBreaks: ['BUCHHOLZ'],
      state: 'RUNNING',
    });
    t = ranked(t);
    t.rounds = [
      makeRound(1, [makePairing('b', 'a', 'WHITE_WIN'), makePairing('c', null, 'FULL_POINT_BYE')]),
      makeRound(2, [makePairing('b', 'c', 'WHITE_WIN'), makePairing('a', null, 'FULL_POINT_BYE')]),
      makeRound(3, [makePairing('a', 'c', 'WHITE_WIN'), makePairing('b', null, 'FULL_POINT_BYE')]),
    ];

    // Scores: a = 0 (R1 loss) + 1 (R2 bye) + 1 (R3 win) = 2
    //         b = 1 + 1 + 1 = 3
    //         c = 1 (R1 bye) + 0 + 0 = 1
    const standings = computeStandings(t);
    expect(standings.find((s) => s.player.id === 'a')!.points).toBe(2);
    expect(standings.find((s) => s.player.id === 'b')!.points).toBe(3);
    expect(standings.find((s) => s.player.id === 'c')!.points).toBe(1);

    // Player a's Buchholz:
    //   R1 vs b (real)  -> b's score = 3
    //   R2 bye          -> VO = scoreBefore(0) + (1 - 1) + 0.5*(3-2) = 0.5
    //   R3 vs c (real)  -> c's score = 1
    //   total = 3 + 0.5 + 1 = 4.5
    expect(bh(t, 'a')).toBe(4.5);

    // Player c's Buchholz:
    //   R1 bye          -> VO = 0 + (1 - 1) + 0.5*(3-1) = 1
    //   R2 vs b (real)  -> 3
    //   R3 vs a (real)  -> 2
    //   total = 1 + 3 + 2 = 6
    expect(bh(t, 'c')).toBe(6);
  });

  it('gives a zero-point bye a higher virtual opponent than a full-point bye', () => {
    // The VO takes the complementary result, so losing the unplayed game
    // yields a STRONGER virtual opponent — that is the point of the rule.
    const build = (result: 'FULL_POINT_BYE' | 'ZERO_POINT_BYE') => {
      const a = makePlayer({ id: 'a', pairingRating: 2000 });
      const b = makePlayer({ id: 'b', pairingRating: 1900 });
      let t = makeTournament({
        players: [a, b],
        numberOfRounds: 2,
        tieBreaks: ['BUCHHOLZ'],
        state: 'RUNNING',
      });
      t = ranked(t);
      t.rounds = [
        makeRound(1, [makePairing('a', null, result), makePairing('b', null, 'ZERO_POINT_BYE')]),
      ];
      return bh(t, 'a');
    };

    // full point: VO = 0 + (1-1) + 0.5*(2-1) = 0.5
    // zero point: VO = 0 + (1-0) + 0.5*(2-1) = 1.5
    expect(build('FULL_POINT_BYE')).toBe(0.5);
    expect(build('ZERO_POINT_BYE')).toBe(1.5);
  });

  it('applies the virtual opponent to forfeits too, not just byes', () => {
    const a = makePlayer({ id: 'a', pairingRating: 2000 });
    const b = makePlayer({ id: 'b', pairingRating: 1900 });
    let t = makeTournament({
      players: [a, b],
      numberOfRounds: 2,
      tieBreaks: ['BUCHHOLZ'],
      state: 'RUNNING',
    });
    t = ranked(t);
    // a wins by forfeit — no game was actually played, so b's real score must
    // NOT be used for a's Buchholz.
    t.rounds = [makeRound(1, [makePairing('a', 'b', 'WHITE_WIN_FORFEIT')])];

    // b's real score is 0; the virtual opponent is 0 + (1-1) + 0.5*(2-1) = 0.5
    expect(bh(t, 'a')).toBe(0.5);
  });

  it('leaves fields with no unplayed games unchanged', () => {
    const a = makePlayer({ id: 'a', pairingRating: 2000 });
    const b = makePlayer({ id: 'b', pairingRating: 1900 });
    const c = makePlayer({ id: 'c', pairingRating: 1800 });
    const d = makePlayer({ id: 'd', pairingRating: 1700 });
    let t = makeTournament({
      players: [a, b, c, d],
      numberOfRounds: 2,
      tieBreaks: ['BUCHHOLZ'],
      state: 'RUNNING',
    });
    t = ranked(t);
    t.rounds = [
      makeRound(1, [makePairing('a', 'b', 'WHITE_WIN'), makePairing('c', 'd', 'WHITE_WIN')]),
      makeRound(2, [makePairing('a', 'c', 'WHITE_WIN'), makePairing('b', 'd', 'DRAW')]),
    ];
    // a played b (0.5) and c (1) -> 1.5, plain sum, no virtual opponents.
    expect(bh(t, 'a')).toBe(1.5);
  });
});

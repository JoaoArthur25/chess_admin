import { describe, expect, it } from 'vitest';
import { computeStandings, opponentsMatrix } from '../src/domain/standings.js';
import { assignStartingRanks } from '../src/domain/ranking.js';
import { makePairing, makePlayer, makeRound, makeTournament } from './helpers.js';
import type { Tournament } from '../src/domain/types.js';

function ranked(t: Tournament): Tournament {
  const ranks = assignStartingRanks(t.players);
  t.players = t.players.map((p) => ({ ...p, startingRank: ranks.get(p.id) ?? null }));
  return t;
}

describe('standings & tie-breaks', () => {
  it('orders by points, then Buchholz', () => {
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
      // a and c both 1 pt going into rd2; a beats c, b beats d.
      makeRound(2, [makePairing('a', 'c', 'WHITE_WIN'), makePairing('b', 'd', 'WHITE_WIN')]),
    ];

    const standings = computeStandings(t);
    expect(standings[0]!.player.id).toBe('a'); // 2 pts
    // b and c both have 1 pt; Buchholz breaks the tie.
    const bRow = standings.find((s) => s.player.id === 'b')!;
    const cRow = standings.find((s) => s.player.id === 'c')!;
    expect(bRow.points).toBe(1);
    expect(cRow.points).toBe(1);
    // c played a(2) and d(0) => Buchholz 2; b played a(2) and d(0) => 2. Equal here.
    expect(bRow.tieBreaks[0]!.code).toBe('BUCHHOLZ');
  });

  it('computes Sonneborn-Berger and progressive', () => {
    const a = makePlayer({ id: 'a' });
    const b = makePlayer({ id: 'b' });
    let t = makeTournament({
      players: [a, b],
      numberOfRounds: 2,
      tieBreaks: ['SONNEBORN_BERGER', 'PROGRESSIVE', 'WINS', 'ARO'],
      state: 'RUNNING',
    });
    t = ranked(t);
    t.rounds = [
      makeRound(1, [makePairing('a', 'b', 'WHITE_WIN')]),
      makeRound(2, [makePairing('b', 'a', 'DRAW')]),
    ];
    const standings = computeStandings(t);
    const aRow = standings.find((s) => s.player.id === 'a')!;
    expect(aRow.points).toBe(1.5);
    // progressive for a: after r1 = 1, after r2 = 1.5 => 2.5
    const prog = aRow.tieBreaks.find((x) => x.code === 'PROGRESSIVE')!;
    expect(prog.value).toBe(2.5);
    const winsTb = aRow.tieBreaks.find((x) => x.code === 'WINS')!;
    expect(winsTb.value).toBe(1);
  });

  it('exposes colour history and balance', () => {
    const a = makePlayer({ id: 'a' });
    const b = makePlayer({ id: 'b' });
    let t = makeTournament({ players: [a, b], numberOfRounds: 2, state: 'RUNNING' });
    t = ranked(t);
    t.rounds = [
      makeRound(1, [makePairing('a', 'b', 'WHITE_WIN')]),
      makeRound(2, [makePairing('b', 'a', 'DRAW')]),
    ];
    const aRow = computeStandings(t).find((s) => s.player.id === 'a')!;
    expect(aRow.colors).toEqual(['W', 'B']);
    expect(aRow.colorBalance).toBe(0);
  });

  it('builds an opponents matrix', () => {
    const a = makePlayer({ id: 'a' });
    const b = makePlayer({ id: 'b' });
    let t = makeTournament({ players: [a, b], numberOfRounds: 1, state: 'RUNNING' });
    t = ranked(t);
    t.rounds = [makeRound(1, [makePairing('a', 'b', 'WHITE_WIN')])];
    const m = opponentsMatrix(t);
    const ra = t.players.find((p) => p.id === 'a')!.startingRank!;
    const rb = t.players.find((p) => p.id === 'b')!.startingRank!;
    expect(m.cell(ra, rb)).toBe(1);
    expect(m.cell(ra, ra)).toBeNull();
  });
});

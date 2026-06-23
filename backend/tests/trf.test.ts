import { describe, expect, it } from 'vitest';
import { serializeTournament } from '../src/trf/serialize.js';
import { parseTournament } from '../src/trf/parse.js';
import { tournamentToTrf } from '../src/trf/fromDomain.js';
import { toTrfCode } from '../src/trf/codes.js';
import { assignStartingRanks } from '../src/domain/ranking.js';
import { makePairing, makePlayer, makeRound, makeTournament } from './helpers.js';
import type { TrfTournament } from '../src/trf/types.js';

function rankTournament(t: ReturnType<typeof makeTournament>) {
  const ranks = assignStartingRanks(t.players);
  t.players = t.players.map((p) => ({ ...p, startingRank: ranks.get(p.id) ?? null }));
  return t;
}

describe('TRF result codes', () => {
  it('maps a white win to W/L', () => {
    expect(toTrfCode('WHITE_WIN', true, true).code).toBe('W');
    expect(toTrfCode('WHITE_WIN', false, true).code).toBe('L');
  });
  it('maps draws to D for both sides', () => {
    expect(toTrfCode('DRAW', true, true).code).toBe('D');
    expect(toTrfCode('DRAW', false, true).code).toBe('D');
  });
  it('maps forfeits to + / -', () => {
    expect(toTrfCode('WHITE_WIN_FORFEIT', true, true).code).toBe('+');
    expect(toTrfCode('WHITE_WIN_FORFEIT', false, true).code).toBe('-');
  });
  it('maps byes with no opponent', () => {
    expect(toTrfCode('FULL_POINT_BYE', true, false).code).toBe('U');
    expect(toTrfCode('HALF_POINT_BYE', true, false).code).toBe('H');
    expect(toTrfCode('ZERO_POINT_BYE', true, false).code).toBe('Z');
  });
});

describe('TRF round-trip', () => {
  it('serialize -> parse preserves player fields and results', () => {
    const a = makePlayer({ id: 'a', fullName: 'Carlsen, Magnus', fideTitle: 'GM', pairingRating: 2830, fideId: '1503014', federation: 'NOR' });
    const b = makePlayer({ id: 'b', fullName: 'Nakamura, Hikaru', fideTitle: 'GM', pairingRating: 2780, fideId: '2016192', federation: 'USA' });
    const c = makePlayer({ id: 'c', fullName: 'Polgar, Judit', sex: 'F', fideTitle: 'GM', pairingRating: 2700, fideId: '700070', federation: 'HUN' });

    let t = makeTournament({ players: [a, b, c], numberOfRounds: 3 });
    t = rankTournament(t);
    // Round 1: a beats b (white), c gets full-point bye.
    t.rounds = [
      makeRound(1, [makePairing('a', 'b', 'WHITE_WIN', 1), makePairing('c', null, 'FULL_POINT_BYE', 2)]),
    ];

    const trf: TrfTournament = tournamentToTrf(t);
    const text = serializeTournament(trf);
    const parsed = parseTournament(text);

    expect(parsed.name).toBe('Test Open');
    expect(parsed.numberOfRounds).toBe(3);
    expect(parsed.players).toHaveLength(3);

    const pa = parsed.players.find((p) => p.name === 'Carlsen, Magnus')!;
    expect(pa.title).toBe('GM');
    expect(pa.rating).toBe(2830);
    expect(pa.federation).toBe('NOR');
    expect(pa.fideId).toBe('1503014');
    expect(pa.points).toBe(1);
    expect(pa.rounds[0]!.result).toBe('W');
    expect(pa.rounds[0]!.color).toBe('w');

    const pc = parsed.players.find((p) => p.name === 'Polgar, Judit')!;
    expect(pc.sex).toBe('w');
    expect(pc.points).toBe(1);
    expect(pc.rounds[0]!.opponent).toBe(0);
    expect(pc.rounds[0]!.result).toBe('U');
  });

  it('is idempotent: serialize -> parse -> serialize is stable', () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      makePlayer({ id: `p${i}`, fullName: `Lastname${i}, First`, pairingRating: 2400 - i * 25 }),
    );
    let t = makeTournament({ players, numberOfRounds: 5 });
    t = rankTournament(t);
    t.rounds = [
      makeRound(1, [
        makePairing('p0', 'p4', 'WHITE_WIN', 1),
        makePairing('p1', 'p5', 'DRAW', 2),
        makePairing('p2', 'p6', 'BLACK_WIN', 3),
        makePairing('p3', 'p7', 'WHITE_WIN_FORFEIT', 4),
      ]),
    ];

    const text1 = serializeTournament(tournamentToTrf(t));
    const text2 = serializeTournament(
      // re-serialize the parsed form by feeding it back through the player records
      { ...parseTournament(text1) },
    );
    expect(text2).toBe(text1);
  });

  it('places fixed-width fields at the documented columns', () => {
    const a = makePlayer({ id: 'a', fullName: 'Test, Name', fideTitle: 'IM', pairingRating: 2450, fideId: '123', federation: 'BRA' });
    let t = makeTournament({ players: [a], numberOfRounds: 1 });
    t = rankTournament(t);
    const line = serializeTournament(tournamentToTrf(t)).split('\n').find((l) => l.startsWith('001'))!;
    expect(line.slice(0, 3)).toBe('001');
    expect(line.slice(4, 8).trim()).toBe('1'); // starting rank, cols 5-8
    expect(line.slice(9, 10)).toBe('m'); // sex, col 10
    expect(line.slice(10, 13).trim()).toBe('IM'); // title, cols 11-13
  });
});

import { describe, expect, it } from 'vitest';
import { FakePairingEngine } from '../src/engine/fake.js';
import { tournamentToTrf } from '../src/trf/fromDomain.js';
import { serializeTournament } from '../src/trf/serialize.js';
import { assignStartingRanks } from '../src/domain/ranking.js';
import { buildPlayerHistory, opponentsOf } from '../src/domain/scoring.js';
import type { Pairing, PairingResult, Round } from '../src/domain/types.js';
import { makePlayer, makeRound, makeTournament } from './helpers.js';

/** Simulate a full Swiss event through the fake engine, asserting invariants. */
async function simulate(numPlayers: number, numRounds: number) {
  const engine = new FakePairingEngine();
  const players = Array.from({ length: numPlayers }, (_, i) =>
    makePlayer({ id: `p${i}`, fullName: `P${String(i).padStart(2, '0')}`, pairingRating: 2400 - i * 10 }),
  );
  const ranks = assignStartingRanks(players);
  const ranked = players.map((p) => ({ ...p, startingRank: ranks.get(p.id)! }));
  const rankToId = new Map<number, string>();
  for (const p of ranked) rankToId.set(p.startingRank!, p.id);

  const t = makeTournament({ players: ranked, numberOfRounds: numRounds, state: 'RUNNING' });
  const rounds: Round[] = [];

  for (let r = 1; r <= numRounds; r += 1) {
    t.rounds = rounds;
    const trf = serializeTournament(tournamentToTrf(t));
    const result = await engine.pairNextRound(trf);

    const pairings: Pairing[] = result.pairings.map((ep, idx) => {
      const whiteId = rankToId.get(ep.white)!;
      if (ep.black === 0) {
        return { id: `r${r}-bye`, boardNumber: ep.boardNumber, whiteId, blackId: null, result: 'FULL_POINT_BYE' as PairingResult };
      }
      const blackId = rankToId.get(ep.black)!;
      // Deterministic outcome: higher seed (lower rank) wins.
      const res: PairingResult = ep.white < ep.black ? 'WHITE_WIN' : 'BLACK_WIN';
      return { id: `r${r}-${idx}`, boardNumber: ep.boardNumber, whiteId, blackId, result: res };
    });

    rounds.push(makeRound(r, pairings));

    // Invariant: every active player paired exactly once this round.
    const appearances = new Map<string, number>();
    for (const p of pairings) {
      appearances.set(p.whiteId, (appearances.get(p.whiteId) ?? 0) + 1);
      if (p.blackId) appearances.set(p.blackId, (appearances.get(p.blackId) ?? 0) + 1);
    }
    for (const p of ranked) {
      expect(appearances.get(p.id), `player ${p.id} round ${r}`).toBe(1);
    }
  }

  return { rounds, ranked };
}

describe('FakePairingEngine end-to-end', () => {
  it('pairs every player each round (even field)', async () => {
    await simulate(8, 5);
  });

  it('handles an odd field with a bye each round', async () => {
    const { rounds, ranked } = await simulate(7, 5);
    // Exactly one bye per round.
    for (const r of rounds) {
      const byes = r.pairings.filter((p) => p.blackId === null);
      expect(byes).toHaveLength(1);
    }
    // No player receives more than one bye while others have none (fake rule).
    const byeCounts = ranked.map((p) =>
      buildPlayerHistory(p.id, rounds).filter((g) => g.bye).length,
    );
    expect(Math.max(...byeCounts) - Math.min(...byeCounts)).toBeLessThanOrEqual(1);
  });

  it('produces no rematches in the early (always-avoidable) rounds', async () => {
    // Rounds 1-2 can ALWAYS be paired without rematches; the fake must get
    // this right. (Strict no-rematch over a full event is the real engine's
    // guarantee, verified by black-box tests against bbpPairings — the fake's
    // naive float rule is allowed to occasionally force a late rematch.)
    const { rounds, ranked } = await simulate(8, 2);
    for (const p of ranked) {
      const opponents = buildPlayerHistory(p.id, rounds)
        .filter((g) => g.opponentId)
        .map((g) => g.opponentId);
      expect(new Set(opponents).size).toBe(opponents.length);
    }
    void opponentsOf; // (exercised indirectly)
  });

  it('keeps rematches minimal over a longer event', async () => {
    const { rounds, ranked } = await simulate(8, 4);
    let rematches = 0;
    for (const p of ranked) {
      const opponents = buildPlayerHistory(p.id, rounds)
        .filter((g) => g.opponentId)
        .map((g) => g.opponentId);
      rematches += opponents.length - new Set(opponents).size;
    }
    // At most one rematch pair (counted from both sides) for the fake.
    expect(rematches).toBeLessThanOrEqual(2);
  });

  it('is deterministic for identical input', async () => {
    const a = await simulate(8, 3);
    const b = await simulate(8, 3);
    const flatten = (rounds: Round[]) =>
      rounds.map((r) => r.pairings.map((p) => `${p.whiteId}-${p.blackId}`).join(','));
    expect(flatten(a.rounds)).toEqual(flatten(b.rounds));
  });
});

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BbpPairingsEngine } from '../src/engine/bbpPairings.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { TournamentService } from '../src/services/tournamentService.js';
import {
  buildPlayerHistory,
  colorBalance,
  trailingColorStreak,
} from '../src/domain/scoring.js';
import type { PairingResult, Tournament } from '../src/domain/types.js';

// Black-box tests against the REAL FIDE engine (§8). FIDE endorses engines by
// simulating many tournaments and checking invariants; we mirror that here to
// validate OUR side of the contract — the TRF we emit and the output we parse.
//
// Skipped automatically when the binary is absent, so the suite still passes on
// a machine that has not built bbpPairings.
const BINARY =
  process.env.PAIRING_ENGINE_PATH ?? 'C:/Trabalhos-Dev/bbpPairings/bbpPairings.exe';
const HAS_ENGINE = existsSync(BINARY);

function service() {
  return new TournamentService(
    new InMemoryRepository(),
    new BbpPairingsEngine({ binaryPath: BINARY }),
  );
}

/** Deterministic pseudo-random so failures are reproducible. */
function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

async function runTournament(
  players: number,
  rounds: number,
  seed: number,
  /** Rounds the event is configured for; defaults to the number actually played. */
  configuredRounds = rounds,
) {
  const svc = service();
  const rng = makeRng(seed);
  const t = await svc.createTournament({
    name: `Sim ${seed}`,
    numberOfRounds: configuredRounds,
  });
  for (let i = 0; i < players; i += 1) {
    await svc.addPlayer(t.id, {
      fullName: `Player ${String(i).padStart(3, '0')}`,
      sex: i % 4 === 0 ? 'F' : 'M',
      pairingRating: 2400 - i * 17,
      fideId: String(2000000 + i),
    });
  }
  await svc.startTournament(t.id);

  for (let r = 1; r <= rounds; r += 1) {
    await svc.generateNextRound(t.id);
    const cur = await svc.getTournament(t.id);
    const last = [...cur.rounds].sort((a, b) => b.index - a.index)[0]!;
    for (const p of last.pairings) {
      if (p.result !== 'PENDING') continue;
      const roll = rng();
      const res: PairingResult = roll < 0.4 ? 'WHITE_WIN' : roll < 0.7 ? 'BLACK_WIN' : 'DRAW';
      await svc.enterResult(t.id, p.id, res);
    }
  }
  return { svc, tournamentId: t.id, tournament: await svc.getTournament(t.id) };
}

/** Assert the FIDE invariants that must hold for every finished simulation. */
function assertInvariants(t: Tournament, label: string) {
  const ranked = t.players.filter((p) => p.startingRank != null);

  for (const round of t.rounds) {
    // Every player appears exactly once per round (game or bye).
    const seen = new Map<string, number>();
    for (const p of round.pairings) {
      seen.set(p.whiteId, (seen.get(p.whiteId) ?? 0) + 1);
      if (p.blackId) seen.set(p.blackId, (seen.get(p.blackId) ?? 0) + 1);
    }
    for (const p of ranked) {
      expect(seen.get(p.id), `${label} R${round.index}: ${p.fullName} paired once`).toBe(1);
    }
    // At most one bye per round.
    expect(
      round.pairings.filter((p) => p.blackId === null).length,
      `${label} R${round.index}: at most one bye`,
    ).toBeLessThanOrEqual(1);
  }

  for (const p of ranked) {
    const history = buildPlayerHistory(p.id, t.rounds);

    // No rematches — the hard Swiss rule.
    const opponents = history.filter((g) => g.opponentId).map((g) => g.opponentId);
    expect(new Set(opponents).size, `${label}: ${p.fullName} has no rematch`).toBe(
      opponents.length,
    );

    // Colour difference must stay within |2|.
    expect(
      Math.abs(colorBalance(history)),
      `${label}: ${p.fullName} colour balance within 2`,
    ).toBeLessThanOrEqual(2);

    // Never the same colour three times in a row.
    for (const color of ['W', 'B'] as const) {
      for (let i = 0; i < history.length; i += 1) {
        const window = history.slice(0, i + 1);
        expect(
          trailingColorStreak(window, color),
          `${label}: ${p.fullName} colour ${color} streak`,
        ).toBeLessThanOrEqual(2);
      }
    }

    // At most one bye across the event.
    expect(
      history.filter((g) => g.bye).length,
      `${label}: ${p.fullName} at most one bye`,
    ).toBeLessThanOrEqual(1);
  }
}

describe.skipIf(!HAS_ENGINE)('real bbpPairings engine (black-box)', () => {
  it('accepts our TRF and returns parseable pairings', async () => {
    const { tournament: t } = await runTournament(8, 1, 1);
    expect(t.rounds).toHaveLength(1);
    expect(t.rounds[0]!.pairings.length).toBeGreaterThan(0);
  });

  it('holds all FIDE invariants over an even field', async () => {
    const { tournament: t } = await runTournament(10, 5, 42);
    assertInvariants(t, '10p/5r');
  });

  it('holds all FIDE invariants over an odd field (byes)', async () => {
    const { tournament: t } = await runTournament(11, 5, 7);
    assertInvariants(t, '11p/5r');
    // An odd field must produce exactly one bye per round.
    for (const r of t.rounds) {
      expect(r.pairings.filter((p) => p.blackId === null)).toHaveLength(1);
    }
  });

  it('holds invariants across several seeds and field sizes', async () => {
    for (const [players, rounds, seed] of [
      [6, 3, 101],
      [9, 4, 202],
      [16, 5, 303],
      [12, 6, 404],
    ] as const) {
      const { tournament: t } = await runTournament(players, rounds, seed);
      assertInvariants(t, `${players}p/${rounds}r seed${seed}`);
    }
  }, 180_000);

  it('surfaces an unpairable round as a 409, not a crash', async () => {
    // A small field can genuinely dead-end: with 6 players and seed 101, after
    // 3 rounds the not-yet-played graph is two disjoint triangles ({1,3,5} and
    // {2,4,6}) — a 2-regular graph with no perfect matching, so round 4 is
    // impossible without a rematch. The engine exits 1 and we must treat that
    // as a domain condition (CLAUDE.md §6), never a 500.
    // Configured for 4 rounds but only 3 played, so the state machine allows a
    // 4th round and the engine is the one that must reject it.
    const { svc, tournamentId } = await runTournament(6, 3, 101, 4);

    await expect(svc.generateNextRound(tournamentId)).rejects.toMatchObject({
      name: 'DomainError',
      status: 409,
    });
  });

  it('reports a clean bill of health via the engine checker', async () => {
    const svc = service();
    const t = await svc.createTournament({ name: 'Checked', numberOfRounds: 3 });
    for (let i = 0; i < 8; i += 1) {
      await svc.addPlayer(t.id, {
        fullName: `P${i}`,
        sex: 'M',
        pairingRating: 2200 - i * 25,
      });
    }
    await svc.startTournament(t.id);
    for (let r = 1; r <= 3; r += 1) {
      await svc.generateNextRound(t.id);
      const cur = await svc.getTournament(t.id);
      const last = [...cur.rounds].sort((a, b) => b.index - a.index)[0]!;
      for (const p of last.pairings) {
        if (p.result === 'PENDING') await svc.enterResult(t.id, p.id, 'WHITE_WIN');
      }
    }
    const check = await svc.checkTournament(t.id);
    expect(check.discrepancies, JSON.stringify(check.discrepancies)).toHaveLength(0);
    expect(check.ok).toBe(true);
  });
});

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BbpPairingsEngine } from '../src/engine/bbpPairings.js';
import { JaVaFoEngine } from '../src/engine/javafo.js';
import { crossCheckRound } from '../src/engine/crossCheck.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { TournamentService } from '../src/services/tournamentService.js';
import type { PairingResult } from '../src/domain/types.js';

// Cross-validation between two FIDE-endorsed engines.
//
// WHY: C.04.2 demands that different approved programs arrive at IDENTICAL
// pairings. The invariant tests in realEngine.test.ts prove our output is
// LEGAL; these prove it is the SAME pairing an independent reference produces,
// which is the stronger claim the regulation actually asks for.
//
// IMPORTANT — the two engines implement DIFFERENT EDITIONS of the Dutch rules:
//
//   bbpPairings v6.0.0 (2026-02-01) — "Switch to 2025 Dutch rules"
//   JaVaFo 2.2         (circa 2018) — the preceding edition; rrweb.org still
//                                     serves 2.2 as current, so there is no
//                                     JaVaFo build on the 2025 rules
//
// Empirically the divergence is confined to ODD fields, at the
// pairing-allocated bye — consistent with the 2026 edition treating the PAB as
// an optimisation criterion (C.04.3 art. 2.3.1 [C5], "minimise the score of the
// assignee") rather than a pre-assignment. Even fields, which have no bye,
// agree on every board of every round.
//
// So the tests below assert identity ONLY where the rule editions coincide.
// That is not a workaround: an even-field match across full events is precisely
// what validates OUR side — the TRF we emit, the history we model, the output
// we parse. A divergence there would mean a bug in this codebase.
//
// Skips unless BOTH engines are installed.
const BBP = process.env.PAIRING_ENGINE_PATH ?? 'C:/Trabalhos-Dev/bbpPairings/bbpPairings.exe';
const JAR = process.env.JAVAFO_PATH ?? 'C:/Trabalhos-Dev/javafo/javafo.jar';
const HAS_BOTH = existsSync(BBP) && existsSync(JAR);

const bbp = () => new BbpPairingsEngine({ binaryPath: BBP });
const javafo = () => new JaVaFoEngine({ jarPath: JAR });

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface Mismatch {
  round: number;
  detail: string;
  /** True when both engines placed the bye on the same player (or there is none). */
  sameByeAssignee: boolean;
}

/**
 * Play a tournament with bbpPairings, cross-checking every round against JaVaFo
 * before accepting the pairing.
 */
async function playAndCrossCheck(players: number, rounds: number, seed: number) {
  const svc = new TournamentService(new InMemoryRepository(), bbp());
  const rng = makeRng(seed);
  const t = await svc.createTournament({ name: `Cross ${seed}`, numberOfRounds: rounds });
  for (let i = 0; i < players; i += 1) {
    await svc.addPlayer(t.id, {
      fullName: `Player ${String(i).padStart(3, '0')}`,
      sex: i % 4 === 0 ? 'F' : 'M',
      pairingRating: 2400 - i * 17,
      fideId: String(3000000 + i),
    });
  }
  await svc.startTournament(t.id);

  const mismatches: Mismatch[] = [];

  for (let r = 1; r <= rounds; r += 1) {
    const trf = await svc.exportTrf(t.id);
    const check = await crossCheckRound(trf, bbp(), javafo());

    if (!check.identical) {
      const byeOf = (ps: { white: number; black: number }[]) =>
        ps.find((p) => p.black === 0)?.white ?? null;
      mismatches.push({
        round: r,
        sameByeAssignee: byeOf(check.referencePairings) === byeOf(check.candidatePairings),
        detail:
          check.disagreementOnFeasibility ??
          check.differences
            .map((d) => `board ${d.boardNumber}: bbp=${d.reference} javafo=${d.candidate}`)
            .join('; '),
      });
    }

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

  return mismatches;
}

describe.skipIf(!HAS_BOTH)('cross-validation: bbpPairings vs JaVaFo', () => {
  it('both engines are present and identify themselves', async () => {
    const [a, b] = await Promise.all([bbp().describe(), javafo().describe()]);
    expect(a.name).toBe('bbpPairings');
    expect(b.name).toBe('JaVaFo');
    // The exact builds compared — this is what an arbiter records.
    console.log(`  reference: ${a.version}`);
    console.log(`  candidate: ${b.version}`);
  });

  // ── Where the rule editions coincide: identity is required ────────────────

  it('agrees on every board of a full EVEN-field event', async () => {
    // No bye anywhere, so both editions must produce the same pairing. Any
    // difference here would indicate a defect on our side, not in the rules.
    const mismatches = await playAndCrossCheck(12, 5, 42);
    expect(mismatches, JSON.stringify(mismatches, null, 2)).toHaveLength(0);
  }, 180_000);

  it('agrees on even fields across several sizes and seeds', async () => {
    const failing: { size: number; seed: number; mismatches: Mismatch[] }[] = [];
    for (const [players, rounds, seed] of [
      [8, 4, 101],
      [10, 4, 202],
      [16, 5, 303],
      [14, 5, 404],
    ] as const) {
      const mismatches = await playAndCrossCheck(players, rounds, seed);
      if (mismatches.length > 0) failing.push({ size: players, seed, mismatches });
    }
    expect(failing, JSON.stringify(failing, null, 2)).toHaveLength(0);
  }, 300_000);

  // ── Where they diverge: record it, do not pretend it is agreement ─────────

  it('on ODD fields, any divergence is confined to the bye allocation', async () => {
    // Documented expectation, not a pass-by-default: the engines follow
    // different editions of the PAB rule, so they may pick a different player
    // for the bye — and everything downstream shifts with it. What must NOT
    // happen is the two agreeing on the bye and still differing elsewhere;
    // that would point at us.
    const all: Mismatch[] = [];
    for (const [players, rounds, seed] of [
      [11, 5, 7],
      [9, 4, 202],
    ] as const) {
      all.push(...(await playAndCrossCheck(players, rounds, seed)));
    }

    const sameByeButDifferent = all.filter((m) => m.sameByeAssignee);
    expect(
      sameByeButDifferent,
      `Divergence NOT explained by the bye rule — investigate:\n${JSON.stringify(sameByeButDifferent, null, 2)}`,
    ).toHaveLength(0);

    if (all.length > 0) {
      console.log(
        `  ${all.length} round(s) diverged at the bye, as expected between rule editions.`,
      );
    }
  }, 300_000);
});

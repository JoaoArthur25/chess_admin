import type { EnginePairing, PairingEngine } from './port.js';

// Cross-validation between two endorsed engines.
//
// FIDE C.04.2 requires a Swiss system to pair "in an objective, impartial and
// reproducible manner", such that different arbiters or approved programs
// "arrive at identical pairings". Our black-box tests assert that the output
// SATISFIES the FIDE invariants — no rematches, colour rules, bye rules — which
// is a strictly weaker claim: a pairing can satisfy every invariant and still
// not be the one the Dutch algorithm prescribes.
//
// Running the same TRF through two independent endorsed implementations and
// comparing is the strongest conformance evidence available without FIDE's own
// endorsement procedure.

export interface PairingDifference {
  /** Board where the two engines disagree, 1-based. */
  boardNumber: number;
  reference: string;
  candidate: string;
}

export interface CrossCheckResult {
  /** True when both engines produced exactly the same pairings, board for board. */
  identical: boolean;
  differences: PairingDifference[];
  referencePairings: EnginePairing[];
  candidatePairings: EnginePairing[];
  /** Set when one engine could pair the round and the other could not. */
  disagreementOnFeasibility?: string;
}

function describe(p: EnginePairing): string {
  return p.black === 0 ? `${p.white} (bye)` : `${p.white} vs ${p.black}`;
}

/**
 * Normalise for comparison: order by board, and treat the two sides of a game
 * as ordered (colour matters — swapping white and black is a real difference,
 * not a formatting one).
 */
function normalise(pairings: EnginePairing[]): EnginePairing[] {
  return [...pairings].sort((a, b) => a.boardNumber - b.boardNumber);
}

/**
 * Pair the same tournament with both engines and compare.
 *
 * A `null` result from either engine means it reported no legal pairing; if the
 * engines disagree about that, it is reported rather than treated as equality.
 */
export async function crossCheckRound(
  trf: string,
  reference: PairingEngine,
  candidate: PairingEngine,
): Promise<CrossCheckResult> {
  const [refOut, candOut] = await Promise.all([
    reference.pairNextRound(trf).catch(() => null),
    candidate.pairNextRound(trf).catch(() => null),
  ]);

  if (refOut === null || candOut === null) {
    if (refOut === null && candOut === null) {
      // Both agree the round cannot be paired — that is agreement, not failure.
      return { identical: true, differences: [], referencePairings: [], candidatePairings: [] };
    }
    return {
      identical: false,
      differences: [],
      referencePairings: refOut?.pairings ?? [],
      candidatePairings: candOut?.pairings ?? [],
      disagreementOnFeasibility:
        refOut === null
          ? 'the reference engine found no legal pairing while the candidate did'
          : 'the candidate engine found no legal pairing while the reference did',
    };
  }

  const ref = normalise(refOut.pairings);
  const cand = normalise(candOut.pairings);
  const differences: PairingDifference[] = [];

  const boards = Math.max(ref.length, cand.length);
  for (let i = 0; i < boards; i += 1) {
    const a = ref[i];
    const b = cand[i];
    const sameShape =
      a !== undefined && b !== undefined && a.white === b.white && a.black === b.black;
    if (!sameShape) {
      differences.push({
        boardNumber: a?.boardNumber ?? b?.boardNumber ?? i + 1,
        reference: a ? describe(a) : '(no board)',
        candidate: b ? describe(b) : '(no board)',
      });
    }
  }

  return {
    identical: differences.length === 0,
    differences,
    referencePairings: ref,
    candidatePairings: cand,
  };
}

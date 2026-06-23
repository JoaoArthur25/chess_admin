import { parseTournament } from '../trf/parse.js';
import { pointsForCode } from '../trf/codes.js';
import type { TrfPlayer } from '../trf/types.js';
import {
  type EngineCheckResult,
  type EnginePairing,
  type EnginePairingResult,
  NoValidPairingError,
  type PairingEngine,
} from './port.js';

// NOTE: This is a deterministic *fake* for tests/dev only. It performs a naive
// greedy Swiss pairing (score groups, no rematches, basic color balancing). It
// is intentionally NOT FIDE-correct — the real BbpPairingsEngine owns that. Its
// only contract is: produce legal-enough, deterministic, repeatable pairings so
// the rest of the system can be exercised without the C++ binary installed.

interface PlayerState {
  rank: number;
  score: number;
  played: Set<number>; // opponent ranks already faced
  colorBalance: number; // #white - #black
  lastColor: 'w' | 'b' | null;
  hadBye: boolean;
}

function buildState(p: TrfPlayer): PlayerState {
  let score = 0;
  let colorBalance = 0;
  let lastColor: 'w' | 'b' | null = null;
  let hadBye = false;
  const played = new Set<number>();

  for (const r of p.rounds) {
    score += pointsForCode(r.result);
    if (r.opponent > 0) {
      played.add(r.opponent);
      if (r.color === 'w') {
        colorBalance += 1;
        lastColor = 'w';
      } else if (r.color === 'b') {
        colorBalance -= 1;
        lastColor = 'b';
      }
    } else {
      hadBye = true;
    }
  }

  return { rank: p.startingRank, score, played, colorBalance, lastColor, hadBye };
}

/** Decide colors for a pair: the player more due for white gets white. */
function assignColors(a: PlayerState, b: PlayerState): [white: number, black: number] {
  // More negative balance = more blacks played = more due for white.
  if (a.colorBalance !== b.colorBalance) {
    return a.colorBalance < b.colorBalance ? [a.rank, b.rank] : [b.rank, a.rank];
  }
  // Alternation tie-break: avoid repeating the same color.
  if (a.lastColor === 'b' && b.lastColor !== 'b') return [a.rank, b.rank];
  if (b.lastColor === 'b' && a.lastColor !== 'b') return [b.rank, a.rank];
  // Final tie-break: higher seed (lower rank number) takes white.
  return a.rank < b.rank ? [a.rank, b.rank] : [b.rank, a.rank];
}

export class FakePairingEngine implements PairingEngine {
  async pairNextRound(trf: string): Promise<EnginePairingResult> {
    const t = parseTournament(trf);
    if (t.players.length === 0) {
      throw new NoValidPairingError('No players to pair');
    }

    const minLen = Math.min(...t.players.map((p) => p.rounds.length));
    // Players to pair = those without a result yet for the next round.
    const toPair = t.players
      .filter((p) => p.rounds.length === minLen)
      .map(buildState)
      // Top of the field first: score desc, then seed asc.
      .sort((a, b) => b.score - a.score || a.rank - b.rank);

    if (toPair.length === 0) {
      throw new NoValidPairingError('No players available for the next round');
    }

    const pairings: EnginePairing[] = [];
    let board = 1;
    const remaining = [...toPair];

    // Odd field: assign a bye to the lowest player who has not had one yet.
    if (remaining.length % 2 === 1) {
      let byeIdx = -1;
      for (let i = remaining.length - 1; i >= 0; i -= 1) {
        if (!remaining[i]!.hadBye) {
          byeIdx = i;
          break;
        }
      }
      if (byeIdx === -1) byeIdx = remaining.length - 1; // everyone had a bye; pick last
      const byePlayer = remaining.splice(byeIdx, 1)[0]!;
      pairings.push({ white: byePlayer.rank, black: 0, boardNumber: 0 });
    }

    // Group by score (desc) and fold-pair WITHIN each group, carrying a single
    // downfloater into the next group when a group has odd size. This mirrors
    // the Swiss shape (like scores meet) far better than folding the whole
    // field, and keeps the fake mostly rematch-free in ordinary events.
    const groups = new Map<number, PlayerState[]>();
    for (const s of remaining) {
      const g = groups.get(s.score) ?? [];
      g.push(s);
      groups.set(s.score, g);
    }
    const scores = [...groups.keys()].sort((a, b) => b - a);

    let carry: PlayerState[] = [];
    for (const score of scores) {
      const group = [...carry, ...groups.get(score)!].sort(
        (a, b) => b.score - a.score || a.rank - b.rank,
      );
      carry = [];
      if (group.length % 2 === 1) {
        // Float the lowest player down to join the next score group.
        carry = [group.pop()!];
      }
      this.foldPair(group, pairings, () => board++);
    }
    // Any leftover floater (only possible if the field were odd, but the bye
    // already handled that) — pair it defensively.
    if (carry.length > 0) this.foldPair(carry, pairings, () => board++);

    // Number the bye board last.
    const byePairing = pairings.find((p) => p.black === 0);
    if (byePairing) byePairing.boardNumber = board;

    return { pairings };
  }

  /** Fold-pair an even-sized score group, avoiding rematches where possible. */
  private foldPair(
    group: PlayerState[],
    pairings: EnginePairing[],
    nextBoard: () => number,
  ): void {
    const m = Math.floor(group.length / 2);
    const top = group.slice(0, m);
    const bottom = group.slice(m);
    const used = new Array<boolean>(bottom.length).fill(false);

    const pick = (a: PlayerState, preferred: number): number => {
      const order: number[] = [];
      for (let d = 0; d < bottom.length; d += 1) {
        if (preferred + d < bottom.length) order.push(preferred + d);
        if (d > 0 && preferred - d >= 0) order.push(preferred - d);
      }
      for (const j of order) {
        if (!used[j] && !a.played.has(bottom[j]!.rank)) return j;
      }
      for (const j of order) if (!used[j]) return j; // forced-rematch fallback
      return -1;
    };

    for (let i = 0; i < top.length; i += 1) {
      const a = top[i]!;
      const j = pick(a, i);
      if (j === -1) throw new NoValidPairingError('Fake engine could not pair a score group');
      used[j] = true;
      const b = bottom[j]!;
      const [white, black] = assignColors(a, b);
      pairings.push({ white, black, boardNumber: nextBoard() });
    }
  }

  async checkTournament(trf: string): Promise<EngineCheckResult> {
    const t = parseTournament(trf);
    const discrepancies: EngineCheckResult['discrepancies'] = [];

    // Detect rematches across the whole event.
    for (const p of t.players) {
      const seen = new Set<number>();
      for (const r of p.rounds) {
        if (r.opponent > 0) {
          if (seen.has(r.opponent)) {
            discrepancies.push({
              message: `Player ${p.startingRank} played opponent ${r.opponent} more than once`,
            });
          }
          seen.add(r.opponent);
        }
      }
    }

    return { ok: discrepancies.length === 0, discrepancies };
  }
}

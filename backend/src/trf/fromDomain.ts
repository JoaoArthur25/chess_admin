import {
  buildPlayerHistory,
  scoreFromHistory,
} from '../domain/scoring.js';
import type { Player, Round, Tournament } from '../domain/types.js';
import { toTrfCode } from './codes.js';
import type { TrfPlayer, TrfRoundResult, TrfTournament } from './types.js';

function sexToTrf(sex: Player['sex']): 'm' | 'w' {
  return sex === 'F' ? 'w' : 'm';
}

function titleToTrf(title: Player['fideTitle']): string {
  return title === 'NONE' ? '' : title;
}

/**
 * Build the per-round TRF results for one player from the round data. Uses
 * starting ranks (TPN) as opponent identifiers — the numbering the engine speaks.
 */
function playerRounds(
  player: Player,
  rounds: Round[],
  rankById: Map<string, number>,
): TrfRoundResult[] {
  const ordered = [...rounds].sort((a, b) => a.index - b.index);
  const out: TrfRoundResult[] = [];

  for (const round of ordered) {
    const pairing = round.pairings.find(
      (p) => p.whiteId === player.id || p.blackId === player.id,
    );
    if (!pairing) continue;

    if (pairing.blackId === null) {
      const code = toTrfCode(pairing.result, true, false);
      out.push({ opponent: 0, color: code.color, result: code.code });
      continue;
    }

    const isWhite = pairing.whiteId === player.id;
    const opponentId = isWhite ? pairing.blackId : pairing.whiteId;
    const code = toTrfCode(pairing.result, isWhite, true);
    out.push({
      opponent: rankById.get(opponentId) ?? 0,
      color: code.color,
      result: code.code,
    });
  }

  return out;
}

export function tournamentToTrf(t: Tournament): TrfTournament {
  const rankById = new Map<string, number>();
  for (const p of t.players) {
    if (p.startingRank != null) rankById.set(p.id, p.startingRank);
  }

  // Standings rank (by current points) for the rank field — informational for
  // the engine; pairing uses starting rank + history, not this.
  const scored = t.players.map((p) => ({
    p,
    score: scoreFromHistory(buildPlayerHistory(p.id, t.rounds)),
  }));
  const rankOrder = [...scored].sort((a, b) => b.score - a.score);
  const finalRankById = new Map<string, number>();
  rankOrder.forEach((s, i) => finalRankById.set(s.p.id, i + 1));

  const trfPlayers: TrfPlayer[] = t.players
    .filter((p) => p.startingRank != null)
    .map((p) => {
      const history = buildPlayerHistory(p.id, t.rounds);
      return {
        startingRank: p.startingRank!,
        sex: sexToTrf(p.sex),
        title: titleToTrf(p.fideTitle),
        name: p.fullName,
        rating: p.pairingRating,
        federation: p.federation ?? '',
        fideId: p.fideId ?? '',
        birthDate: p.birthYear ? `${p.birthYear}/00/00` : '',
        points: scoreFromHistory(history),
        rank: finalRankById.get(p.id) ?? 0,
        rounds: playerRounds(p, t.rounds, rankById),
      };
    });

  return {
    name: t.name,
    city: '',
    federation: '',
    startDate: toTrfDate(t.date),
    numberOfRounds: t.numberOfRounds,
    firstBoardColor: 'white',
    players: trfPlayers,
  };
}

function toTrfDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

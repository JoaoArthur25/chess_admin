import type {
  Pairing,
  PairingResult,
  Player,
  Round,
  Tournament,
} from '../src/domain/types.js';

let pid = 0;
export function makePlayer(overrides: Partial<Player> = {}): Player {
  pid += 1;
  return {
    id: overrides.id ?? `p${pid}`,
    fideId: overrides.fideId ?? `${1000000 + pid}`,
    fullName: overrides.fullName ?? `Player ${pid}`,
    sex: overrides.sex ?? 'M',
    fideTitle: overrides.fideTitle ?? 'NONE',
    federation: overrides.federation ?? 'BRA',
    pairingRating: overrides.pairingRating ?? 2000 - pid,
    officialRating: overrides.officialRating ?? null,
    birthYear: overrides.birthYear ?? 2000,
    status: overrides.status ?? 'ACTIVE',
    startingRank: overrides.startingRank ?? null,
  };
}

export function makePairing(
  white: string,
  black: string | null,
  result: PairingResult,
  boardNumber = 1,
): Pairing {
  return {
    id: `${white}-${black ?? 'bye'}-${boardNumber}`,
    boardNumber,
    whiteId: white,
    blackId: black,
    result,
  };
}

export function makeRound(index: number, pairings: Pairing[]): Round {
  return { id: `r${index}`, index, status: 'COMPLETED', pairings };
}

export function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: overrides.id ?? 't1',
    name: overrides.name ?? 'Test Open',
    date: overrides.date ?? new Date('2026-02-01T00:00:00Z'),
    numberOfRounds: overrides.numberOfRounds ?? 5,
    currentRound: overrides.currentRound ?? 0,
    state: overrides.state ?? 'DRAFT',
    tieBreaks: overrides.tieBreaks ?? [],
    lateEntryPoints: overrides.lateEntryPoints ?? 0,
    players: overrides.players ?? [],
    rounds: overrides.rounds ?? [],
  };
}

// Intermediate representation for TRF(x). The serializer turns this into text;
// the parser turns text into this. Domain<->TRF mapping lives in fromDomain.ts
// / toDomain helpers so this stays a pure format concern.

export type TrfColor = 'w' | 'b' | '-';

export interface TrfRoundResult {
  /** Opponent's starting rank, or 0 for a bye / no opponent. */
  opponent: number;
  color: TrfColor;
  /** Single-char TRF result code (see trf/codes.ts). */
  result: string;
}

export interface TrfPlayer {
  startingRank: number;
  sex: 'm' | 'w' | '';
  title: string; // 'GM'.. or '' for untitled
  name: string;
  rating: number;
  federation: string;
  fideId: string;
  birthDate: string; // 'YYYY/MM/DD' or 'YYYY' or ''
  points: number;
  rank: number;
  rounds: TrfRoundResult[];
}

export interface TrfTournament {
  name: string; //          012
  city: string; //          022
  federation: string; //    032
  startDate: string; //     042 — 'YYYY/MM/DD'
  endDate: string; //       052
  ratedPlayers: number; //  072
  tournamentType: string; //092
  chiefArbiter: string; //  102
  deputyArbiters: string; //112
  timeControl: string; //   122
  numberOfRounds: number;
  /** Color of the player on board 1 in round 1: 'white' or 'black'. */
  firstBoardColor: 'white' | 'black';
  players: TrfPlayer[];
  /** Optional acceleration points per player per round, keyed by startingRank. */
  acceleration?: Map<number, number[]>;
}

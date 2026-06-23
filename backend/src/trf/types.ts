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
  name: string;
  city: string;
  federation: string;
  startDate: string; // 'YYYY/MM/DD'
  numberOfRounds: number;
  /** Color of the player on board 1 in round 1: 'white' or 'black'. */
  firstBoardColor: 'white' | 'black';
  players: TrfPlayer[];
  /** Optional acceleration points per player per round, keyed by startingRank. */
  acceleration?: Map<number, number[]>;
}

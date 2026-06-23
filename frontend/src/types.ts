// Mirrors the backend domain shapes (kept in sync manually — small surface).

export type TournamentState = 'DRAFT' | 'RUNNING' | 'FINISHED';
export type RoundStatus = 'PENDING' | 'PAIRED' | 'IN_PROGRESS' | 'COMPLETED';
export type PlayerStatus = 'ACTIVE' | 'WITHDRAWN' | 'LATE_ENTRY' | 'PAUSED';
export type Sex = 'M' | 'F';
export type FideTitle = 'GM' | 'IM' | 'WGM' | 'FM' | 'WIM' | 'CM' | 'WFM' | 'WCM' | 'NONE';

export type PairingResult =
  | 'PENDING'
  | 'WHITE_WIN'
  | 'BLACK_WIN'
  | 'DRAW'
  | 'WHITE_WIN_FORFEIT'
  | 'BLACK_WIN_FORFEIT'
  | 'DOUBLE_FORFEIT'
  | 'FULL_POINT_BYE'
  | 'HALF_POINT_BYE'
  | 'ZERO_POINT_BYE';

export interface Player {
  id: string;
  fideId: string | null;
  fullName: string;
  sex: Sex;
  fideTitle: FideTitle;
  federation: string | null;
  pairingRating: number;
  officialRating: number | null;
  birthYear: number | null;
  status: PlayerStatus;
  startingRank: number | null;
}

export interface Pairing {
  id: string;
  boardNumber: number;
  whiteId: string;
  blackId: string | null;
  result: PairingResult;
}

export interface Round {
  id: string;
  index: number;
  status: RoundStatus;
  pairings: Pairing[];
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  numberOfRounds: number;
  currentRound: number;
  state: TournamentState;
  tieBreaks: string[];
  lateEntryPoints: number;
  players: Player[];
  rounds: Round[];
}

export interface TournamentSummary {
  id: string;
  name: string;
  date: string;
  numberOfRounds: number;
  currentRound: number;
  state: TournamentState;
  playerCount: number;
}

export interface StandingRow {
  rank: number;
  player: Player;
  points: number;
  tieBreaks: { code: string; value: number }[];
  colors: (('W' | 'B') | null)[];
  colorBalance: number;
  opponents: (string | null)[];
}

export interface ValidationAlert {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  playerIds?: string[];
}

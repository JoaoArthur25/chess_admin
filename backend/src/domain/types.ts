// Pure domain types. Intentionally NOT importing from @prisma/client so that
// the core logic (rules, TRF, tie-breaks, engine adapters) is testable without
// a database or generated client. The values are kept string-identical to the
// Prisma enums so mapping is a trivial cast at the persistence boundary.

export type TournamentState = 'DRAFT' | 'RUNNING' | 'FINISHED';

export type RoundStatus = 'PENDING' | 'PAIRED' | 'IN_PROGRESS' | 'COMPLETED';

export type PlayerStatus = 'ACTIVE' | 'WITHDRAWN' | 'LATE_ENTRY' | 'PAUSED';

export type Sex = 'M' | 'F';

// Highest precedence first; index = rank (lower is stronger).
export const FIDE_TITLE_ORDER = [
  'GM',
  'IM',
  'WGM',
  'FM',
  'WIM',
  'CM',
  'WFM',
  'WCM',
  'NONE',
] as const;

export type FideTitle = (typeof FIDE_TITLE_ORDER)[number];

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

export type Color = 'W' | 'B';

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
  date: Date;
  numberOfRounds: number;
  currentRound: number;
  state: TournamentState;
  tieBreaks: string[];
  lateEntryPoints: number;
  players: Player[];
  rounds: Round[];
}

/** A single game from one player's perspective — the unit TRF & tie-breaks use. */
export interface GameRecord {
  roundIndex: number;
  opponentId: string | null; // null = bye / no opponent
  color: Color | null; // null when there was no game (bye)
  /** Points the player earned in this game (0, 0.5, 1). */
  points: number;
  /** True when the result was a forfeit/walkover (affects bye eligibility). */
  forfeit: boolean;
  /** True when this record is a bye (full/half/zero point bye). */
  bye: boolean;
}

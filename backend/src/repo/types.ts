// Repository port. The service depends only on this interface; concrete
// adapters (in-memory for dev/test, Prisma for production) implement it. This
// keeps the orchestration logic free of any ORM details.

import type {
  FideTitle,
  PairingResult,
  Player,
  PlayerStatus,
  Round,
  Sex,
  Tournament,
  TournamentState,
} from '../domain/types.js';

export interface TournamentSummary {
  id: string;
  name: string;
  date: Date;
  numberOfRounds: number;
  currentRound: number;
  state: TournamentState;
  playerCount: number;
}

export interface CreateTournamentInput {
  name: string;
  date?: Date;
  numberOfRounds: number;
  tieBreaks?: string[];
  lateEntryPoints?: number;
  ownerId?: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
}

export interface UserRepository {
  createUser(input: CreateUserInput): Promise<UserRecord>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
}

export interface CreatePlayerInput {
  fullName: string;
  sex: Sex;
  fideTitle?: FideTitle;
  federation?: string | null;
  pairingRating?: number;
  officialRating?: number | null;
  birthYear?: number | null;
  fideId?: string | null;
  status?: PlayerStatus;
}

export type UpdatePlayerInput = Partial<CreatePlayerInput>;

/** A pairing to persist for a freshly generated round. */
export interface NewPairing {
  boardNumber: number;
  whiteId: string;
  blackId: string | null;
  result: PairingResult;
}

export interface TournamentRepository extends UserRepository {
  createTournament(input: CreateTournamentInput): Promise<Tournament>;
  /** List tournaments; when ownerId is given, only that owner's events. */
  listTournaments(ownerId?: string): Promise<TournamentSummary[]>;
  getTournament(id: string): Promise<Tournament | null>;
  updateTournament(
    id: string,
    patch: Partial<Pick<Tournament, 'name' | 'numberOfRounds' | 'tieBreaks' | 'lateEntryPoints' | 'date'>>,
  ): Promise<void>;
  setTournamentState(id: string, state: TournamentState, currentRound: number): Promise<void>;
  deleteTournament(id: string): Promise<void>;

  addPlayer(tournamentId: string, input: CreatePlayerInput): Promise<Player>;
  updatePlayer(playerId: string, patch: UpdatePlayerInput): Promise<void>;
  removePlayer(playerId: string): Promise<void>;
  setStartingRanks(ranks: Map<string, number>): Promise<void>;

  /** Persist a new round with its pairings; returns the created round. */
  addRound(tournamentId: string, index: number, pairings: NewPairing[]): Promise<Round>;
  /** Append a pairing to an existing round (e.g. a late entry's missed-round bye). */
  addPairing(roundId: string, pairing: NewPairing): Promise<void>;
  deleteRound(roundId: string): Promise<void>;
  setRoundStatus(roundId: string, status: Round['status']): Promise<void>;
  setPairingResult(pairingId: string, result: PairingResult): Promise<void>;
}

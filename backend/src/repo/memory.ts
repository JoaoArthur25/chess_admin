import { randomUUID } from 'node:crypto';
import type { Player, Round, Tournament } from '../domain/types.js';
import type {
  CreatePlayerInput,
  CreateTournamentInput,
  NewPairing,
  TournamentRepository,
  TournamentSummary,
  UpdatePlayerInput,
} from './types.js';

// In-memory repository — used for the dev server (no DB required) and tests.
// It stores a normalized model and rebuilds the domain aggregate on read, so it
// behaves like the Prisma adapter from the service's point of view.

interface StoredPairing extends NewPairing {
  id: string;
  roundId: string;
}
interface StoredRound {
  id: string;
  tournamentId: string;
  index: number;
  status: Round['status'];
}

export class InMemoryRepository implements TournamentRepository {
  private tournaments = new Map<string, Tournament>();
  private players = new Map<string, Player & { tournamentId: string }>();
  private rounds = new Map<string, StoredRound>();
  private pairings = new Map<string, StoredPairing>();

  async createTournament(input: CreateTournamentInput): Promise<Tournament> {
    const id = randomUUID();
    const t: Tournament = {
      id,
      name: input.name,
      date: input.date ?? new Date(),
      numberOfRounds: input.numberOfRounds,
      currentRound: 0,
      state: 'DRAFT',
      tieBreaks: input.tieBreaks ?? [],
      lateEntryPoints: input.lateEntryPoints ?? 0,
      players: [],
      rounds: [],
    };
    this.tournaments.set(id, t);
    return this.getTournament(id) as Promise<Tournament>;
  }

  async listTournaments(): Promise<TournamentSummary[]> {
    return [...this.tournaments.values()].map((t) => ({
      id: t.id,
      name: t.name,
      date: t.date,
      numberOfRounds: t.numberOfRounds,
      currentRound: t.currentRound,
      state: t.state,
      playerCount: [...this.players.values()].filter((p) => p.tournamentId === t.id).length,
    }));
  }

  async getTournament(id: string): Promise<Tournament | null> {
    const t = this.tournaments.get(id);
    if (!t) return null;

    const players: Player[] = [...this.players.values()]
      .filter((p) => p.tournamentId === id)
      .map(({ tournamentId: _t, ...p }) => p);

    const rounds: Round[] = [...this.rounds.values()]
      .filter((r) => r.tournamentId === id)
      .sort((a, b) => a.index - b.index)
      .map((r) => ({
        id: r.id,
        index: r.index,
        status: r.status,
        pairings: [...this.pairings.values()]
          .filter((p) => p.roundId === r.id)
          .sort((a, b) => a.boardNumber - b.boardNumber)
          .map((p) => ({
            id: p.id,
            boardNumber: p.boardNumber,
            whiteId: p.whiteId,
            blackId: p.blackId,
            result: p.result,
          })),
      }));

    return { ...t, players, rounds };
  }

  async updateTournament(id: string, patch: Partial<Tournament>): Promise<void> {
    const t = this.tournaments.get(id);
    if (t) Object.assign(t, patch);
  }

  async setTournamentState(
    id: string,
    state: Tournament['state'],
    currentRound: number,
  ): Promise<void> {
    const t = this.tournaments.get(id);
    if (t) {
      t.state = state;
      t.currentRound = currentRound;
    }
  }

  async deleteTournament(id: string): Promise<void> {
    this.tournaments.delete(id);
    for (const [pid, p] of this.players) if (p.tournamentId === id) this.players.delete(pid);
    for (const [rid, r] of this.rounds) {
      if (r.tournamentId === id) {
        for (const [paid, pa] of this.pairings) if (pa.roundId === rid) this.pairings.delete(paid);
        this.rounds.delete(rid);
      }
    }
  }

  async addPlayer(tournamentId: string, input: CreatePlayerInput): Promise<Player> {
    const id = randomUUID();
    const player: Player & { tournamentId: string } = {
      id,
      tournamentId,
      fideId: input.fideId ?? null,
      fullName: input.fullName,
      sex: input.sex,
      fideTitle: input.fideTitle ?? 'NONE',
      federation: input.federation ?? null,
      pairingRating: input.pairingRating ?? 0,
      officialRating: input.officialRating ?? null,
      birthYear: input.birthYear ?? null,
      status: input.status ?? 'ACTIVE',
      startingRank: null,
    };
    this.players.set(id, player);
    const { tournamentId: _t, ...rest } = player;
    return rest;
  }

  async updatePlayer(playerId: string, patch: UpdatePlayerInput): Promise<void> {
    const p = this.players.get(playerId);
    if (p) Object.assign(p, patch);
  }

  async removePlayer(playerId: string): Promise<void> {
    this.players.delete(playerId);
  }

  async setStartingRanks(ranks: Map<string, number>): Promise<void> {
    for (const [pid, rank] of ranks) {
      const p = this.players.get(pid);
      if (p) p.startingRank = rank;
    }
  }

  async addRound(tournamentId: string, index: number, pairings: NewPairing[]): Promise<Round> {
    const roundId = randomUUID();
    this.rounds.set(roundId, { id: roundId, tournamentId, index, status: 'PAIRED' });
    for (const np of pairings) {
      const pid = randomUUID();
      this.pairings.set(pid, { ...np, id: pid, roundId });
    }
    const t = await this.getTournament(tournamentId);
    return t!.rounds.find((r) => r.id === roundId)!;
  }

  async deleteRound(roundId: string): Promise<void> {
    this.rounds.delete(roundId);
    for (const [paid, pa] of this.pairings) if (pa.roundId === roundId) this.pairings.delete(paid);
  }

  async setRoundStatus(roundId: string, status: Round['status']): Promise<void> {
    const r = this.rounds.get(roundId);
    if (r) r.status = status;
  }

  async setPairingResult(pairingId: string, result: NewPairing['result']): Promise<void> {
    const p = this.pairings.get(pairingId);
    if (p) p.result = result;
  }
}

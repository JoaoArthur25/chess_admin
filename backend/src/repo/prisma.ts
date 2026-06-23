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
import { prisma } from '../db/prisma.js';
import type {
  CreatePlayerInput,
  CreateTournamentInput,
  NewPairing,
  TournamentRepository,
  TournamentSummary,
  UpdatePlayerInput,
} from './types.js';

// Prisma-backed adapter (production). The DB enums are string-identical to the
// domain enums, so mapping is a structural copy with narrowing casts.

type PrismaPlayer = Awaited<ReturnType<typeof prisma.player.findFirstOrThrow>>;

function mapPlayer(p: PrismaPlayer): Player {
  return {
    id: p.id,
    fideId: p.fideId,
    fullName: p.fullName,
    sex: p.sex as Sex,
    fideTitle: p.fideTitle as FideTitle,
    federation: p.federation,
    pairingRating: p.pairingRating,
    officialRating: p.officialRating,
    birthYear: p.birthYear,
    status: p.status as PlayerStatus,
    startingRank: p.startingRank,
  };
}

export class PrismaRepository implements TournamentRepository {
  async createTournament(input: CreateTournamentInput): Promise<Tournament> {
    const t = await prisma.tournament.create({
      data: {
        name: input.name,
        date: input.date ?? new Date(),
        numberOfRounds: input.numberOfRounds,
        tieBreaks: input.tieBreaks ?? [],
        lateEntryPoints: input.lateEntryPoints ?? 0,
      },
    });
    return (await this.getTournament(t.id))!;
  }

  async listTournaments(): Promise<TournamentSummary[]> {
    const ts = await prisma.tournament.findMany({
      include: { _count: { select: { players: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return ts.map((t) => ({
      id: t.id,
      name: t.name,
      date: t.date,
      numberOfRounds: t.numberOfRounds,
      currentRound: t.currentRound,
      state: t.state as TournamentState,
      playerCount: t._count.players,
    }));
  }

  async getTournament(id: string): Promise<Tournament | null> {
    const t = await prisma.tournament.findUnique({
      where: { id },
      include: {
        players: true,
        rounds: { include: { pairings: true }, orderBy: { index: 'asc' } },
      },
    });
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      date: t.date,
      numberOfRounds: t.numberOfRounds,
      currentRound: t.currentRound,
      state: t.state as TournamentState,
      tieBreaks: t.tieBreaks,
      lateEntryPoints: t.lateEntryPoints,
      players: t.players.map(mapPlayer),
      rounds: t.rounds.map(
        (r): Round => ({
          id: r.id,
          index: r.index,
          status: r.status as Round['status'],
          pairings: r.pairings
            .sort((a, b) => a.boardNumber - b.boardNumber)
            .map((p) => ({
              id: p.id,
              boardNumber: p.boardNumber,
              whiteId: p.whiteId,
              blackId: p.blackId,
              result: p.result as PairingResult,
            })),
        }),
      ),
    };
  }

  async updateTournament(
    id: string,
    patch: Partial<Pick<Tournament, 'name' | 'numberOfRounds' | 'tieBreaks' | 'lateEntryPoints' | 'date'>>,
  ): Promise<void> {
    await prisma.tournament.update({ where: { id }, data: patch });
  }

  async setTournamentState(id: string, state: TournamentState, currentRound: number): Promise<void> {
    await prisma.tournament.update({ where: { id }, data: { state, currentRound } });
  }

  async deleteTournament(id: string): Promise<void> {
    await prisma.tournament.delete({ where: { id } });
  }

  async addPlayer(tournamentId: string, input: CreatePlayerInput): Promise<Player> {
    const p = await prisma.player.create({
      data: {
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
      },
    });
    return mapPlayer(p);
  }

  async updatePlayer(playerId: string, patch: UpdatePlayerInput): Promise<void> {
    await prisma.player.update({ where: { id: playerId }, data: patch });
  }

  async removePlayer(playerId: string): Promise<void> {
    await prisma.player.delete({ where: { id: playerId } });
  }

  async setStartingRanks(ranks: Map<string, number>): Promise<void> {
    await prisma.$transaction(
      [...ranks.entries()].map(([id, startingRank]) =>
        prisma.player.update({ where: { id }, data: { startingRank } }),
      ),
    );
  }

  async addRound(tournamentId: string, index: number, pairings: NewPairing[]): Promise<Round> {
    const round = await prisma.round.create({
      data: {
        tournamentId,
        index,
        status: 'PAIRED',
        pairings: {
          create: pairings.map((p) => ({
            boardNumber: p.boardNumber,
            whiteId: p.whiteId,
            blackId: p.blackId,
            result: p.result,
          })),
        },
      },
      include: { pairings: true },
    });
    return {
      id: round.id,
      index: round.index,
      status: round.status as Round['status'],
      pairings: round.pairings
        .sort((a, b) => a.boardNumber - b.boardNumber)
        .map((p) => ({
          id: p.id,
          boardNumber: p.boardNumber,
          whiteId: p.whiteId,
          blackId: p.blackId,
          result: p.result as PairingResult,
        })),
    };
  }

  async deleteRound(roundId: string): Promise<void> {
    await prisma.round.delete({ where: { id: roundId } });
  }

  async setRoundStatus(roundId: string, status: Round['status']): Promise<void> {
    await prisma.round.update({ where: { id: roundId }, data: { status } });
  }

  async setPairingResult(pairingId: string, result: PairingResult): Promise<void> {
    await prisma.pairing.update({ where: { id: pairingId }, data: { result } });
  }
}

import type { PairingEngine } from '../engine/port.js';
import { NoValidPairingError } from '../engine/port.js';
import { assignStartingRanks } from '../domain/ranking.js';
import {
  detectRetroactiveEdit,
  validateByeAssignment,
  validateManualPairing,
  type ValidationAlert,
} from '../domain/rules.js';
import { isResultEntered } from '../domain/scoring.js';
import { computeStandings, opponentsMatrix } from '../domain/standings.js';
import {
  assertCanGenerateNextRound,
  canGenerateNextRound,
  isRoundComplete,
  isTournamentComplete,
  nextRoundIndex,
  StateError,
} from '../domain/stateMachine.js';
import type { PairingResult, Round, Tournament } from '../domain/types.js';
import { tournamentToTrf } from '../trf/fromDomain.js';
import { serializeTournament } from '../trf/serialize.js';
import type {
  CreatePlayerInput,
  CreateTournamentInput,
  NewPairing,
  TournamentRepository,
  UpdatePlayerInput,
} from '../repo/types.js';

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly alerts?: ValidationAlert[],
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

const GAME_RESULTS: PairingResult[] = [
  'WHITE_WIN',
  'BLACK_WIN',
  'DRAW',
  'WHITE_WIN_FORFEIT',
  'BLACK_WIN_FORFEIT',
  'DOUBLE_FORFEIT',
];
const BYE_RESULTS: PairingResult[] = ['FULL_POINT_BYE', 'HALF_POINT_BYE', 'ZERO_POINT_BYE'];

export class TournamentService {
  constructor(
    private readonly repo: TournamentRepository,
    private readonly engine: PairingEngine,
  ) {}

  private async load(id: string): Promise<Tournament> {
    const t = await this.repo.getTournament(id);
    if (!t) throw new DomainError('Tournament not found', 404);
    return t;
  }

  // ── CRUD ────────────────────────────────────────────────────────────────

  createTournament(input: CreateTournamentInput) {
    if (input.numberOfRounds < 1) throw new DomainError('numberOfRounds must be >= 1');
    return this.repo.createTournament(input);
  }

  listTournaments() {
    return this.repo.listTournaments();
  }

  getTournament(id: string) {
    return this.load(id);
  }

  async updateTournament(id: string, patch: Parameters<TournamentRepository['updateTournament']>[1]) {
    const t = await this.load(id);
    if (t.state !== 'DRAFT' && (patch.numberOfRounds != null || patch.date != null)) {
      throw new DomainError('Cannot change rounds/date after the tournament has started');
    }
    await this.repo.updateTournament(id, patch);
    return this.load(id);
  }

  async deleteTournament(id: string) {
    await this.load(id);
    await this.repo.deleteTournament(id);
  }

  // ── Players ─────────────────────────────────────────────────────────────

  async addPlayer(tournamentId: string, input: CreatePlayerInput) {
    const t = await this.load(tournamentId);
    if (input.fideId) {
      const dup = t.players.find((p) => p.fideId === input.fideId);
      if (dup) throw new DomainError(`A player with FIDE ID ${input.fideId} already exists`);
    }
    // A player registered after the event started is a late entry.
    const status = input.status ?? (t.state === 'RUNNING' ? 'LATE_ENTRY' : 'ACTIVE');
    const player = await this.repo.addPlayer(tournamentId, { ...input, status });

    // Keep TPN ranks consistent once the field is ranked (running tournaments).
    if (t.state !== 'DRAFT') {
      const refreshed = await this.load(tournamentId);
      await this.repo.setStartingRanks(assignStartingRanks(refreshed.players));
    }
    return player;
  }

  async updatePlayer(tournamentId: string, playerId: string, patch: UpdatePlayerInput) {
    const t = await this.load(tournamentId);
    if (!t.players.some((p) => p.id === playerId)) throw new DomainError('Player not found', 404);
    await this.repo.updatePlayer(playerId, patch);
    return this.load(tournamentId);
  }

  async removePlayer(tournamentId: string, playerId: string) {
    const t = await this.load(tournamentId);
    if (t.state !== 'DRAFT') {
      throw new DomainError('Cannot remove a player after the tournament starts; withdraw them instead');
    }
    await this.repo.removePlayer(playerId);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** DRAFT -> RUNNING: assign TPN starting ranks and lock the initial field. */
  async startTournament(id: string) {
    const t = await this.load(id);
    if (t.state !== 'DRAFT') throw new DomainError('Tournament has already started');
    if (t.players.length < 2) throw new DomainError('At least two players are required');

    await this.repo.setStartingRanks(assignStartingRanks(t.players));
    await this.repo.setTournamentState(id, 'RUNNING', 0);
    return this.load(id);
  }

  canGenerate(t: Tournament) {
    return canGenerateNextRound(t);
  }

  /**
   * Generate the next round. Inactive players (WITHDRAWN/PAUSED) are pre-assigned
   * a zero-point bye for this round so the engine skips them while their full
   * history is still sent (required for opponents' tie-breaks). The engine pairs
   * the remaining active field; we map its output back to our players.
   */
  async generateNextRound(id: string) {
    const t = await this.load(id);
    assertCanGenerateNextRound(t);
    const roundIndex = nextRoundIndex(t);

    const rankToId = new Map<number, string>();
    for (const p of t.players) if (p.startingRank != null) rankToId.set(p.startingRank, p.id);

    const inactive = t.players.filter(
      (p) => p.startingRank != null && (p.status === 'WITHDRAWN' || p.status === 'PAUSED'),
    );
    const active = t.players.filter(
      (p) => p.startingRank != null && (p.status === 'ACTIVE' || p.status === 'LATE_ENTRY'),
    );
    if (active.length < 2) {
      throw new DomainError('Not enough active players to pair the next round');
    }

    // Pre-assign zero-point byes to inactive players in this round, so the
    // engine (which pairs everyone lacking a result for the round) skips them.
    const inactivePairings: NewPairing[] = inactive.map((p) => ({
      boardNumber: 0,
      whiteId: p.id,
      blackId: null,
      result: 'ZERO_POINT_BYE',
    }));

    // Build a synthetic tournament whose round `roundIndex` contains only the
    // inactive byes, then serialize for the engine.
    const syntheticRound: Round = {
      id: `synthetic-${roundIndex}`,
      index: roundIndex,
      status: 'PAIRED',
      pairings: inactivePairings.map((np, i) => ({ id: `s${i}`, ...np })),
    };
    const trf = serializeTournament(
      tournamentToTrf({ ...t, rounds: [...t.rounds, syntheticRound] }),
    );

    let enginePairings;
    try {
      enginePairings = (await this.engine.pairNextRound(trf)).pairings;
    } catch (err) {
      if (err instanceof NoValidPairingError) {
        throw new DomainError(`No valid pairing exists for round ${roundIndex}: ${err.message}`, 409);
      }
      throw err;
    }

    let board = 1;
    const gamePairings: NewPairing[] = [];
    for (const ep of enginePairings.sort((a, b) => a.boardNumber - b.boardNumber)) {
      const whiteId = rankToId.get(ep.white);
      if (!whiteId) continue;
      if (ep.black === 0) {
        // Pairing-allocated (full-point) bye for the odd active player.
        gamePairings.push({ boardNumber: 0, whiteId, blackId: null, result: 'FULL_POINT_BYE' });
      } else {
        const blackId = rankToId.get(ep.black);
        if (!blackId) continue;
        gamePairings.push({ boardNumber: board++, whiteId, blackId, result: 'PENDING' });
      }
    }

    // Number byes (inactive + allocated) after the real boards.
    const all = [...gamePairings, ...inactivePairings];
    for (const p of all) if (p.blackId === null) p.boardNumber = board++;

    const round = await this.repo.addRound(id, roundIndex, all);
    await this.repo.setTournamentState(id, 'RUNNING', roundIndex);
    return { round, tournament: await this.load(id) };
  }

  /** Discard the latest round (e.g. to re-pair). Only the most recent one. */
  async deleteLatestRound(id: string) {
    const t = await this.load(id);
    const last = [...t.rounds].sort((a, b) => b.index - a.index)[0];
    if (!last) throw new DomainError('No rounds to delete');
    await this.repo.deleteRound(last.id);
    await this.repo.setTournamentState(id, t.state === 'FINISHED' ? 'RUNNING' : t.state, last.index - 1);
    return this.load(id);
  }

  // ── Results ──────────────────────────────────────────────────────────────

  async enterResult(id: string, pairingId: string, result: PairingResult) {
    const t = await this.load(id);
    const round = t.rounds.find((r) => r.pairings.some((p) => p.id === pairingId));
    if (!round) throw new DomainError('Pairing not found', 404);
    const pairing = round.pairings.find((p) => p.id === pairingId)!;

    const isBye = pairing.blackId === null;
    if (isBye && !BYE_RESULTS.includes(result)) {
      throw new DomainError('A bye pairing can only take a bye result');
    }
    if (!isBye && !GAME_RESULTS.includes(result) && result !== 'PENDING') {
      throw new DomainError('Invalid result for a game pairing');
    }

    const alerts: ValidationAlert[] = [];
    const retro = detectRetroactiveEdit(round.index, t.currentRound);
    if (retro) alerts.push(retro);

    await this.repo.setPairingResult(pairingId, result);

    // Recompute the round's completion status.
    const refreshed = await this.load(id);
    const r = refreshed.rounds.find((x) => x.id === round.id)!;
    const complete = isRoundComplete(r);
    await this.repo.setRoundStatus(
      round.id,
      complete ? 'COMPLETED' : r.pairings.some((p) => isResultEntered(p.result)) ? 'IN_PROGRESS' : 'PAIRED',
    );

    if (isTournamentComplete(await this.load(id))) {
      await this.repo.setTournamentState(id, 'FINISHED', refreshed.numberOfRounds);
    }

    return { alerts, tournament: await this.load(id) };
  }

  // ── Validation / audit ────────────────────────────────────────────────────

  async validatePairing(id: string, whiteId: string, blackId: string | null) {
    const t = await this.load(id);
    const prior = t.rounds;
    if (blackId === null) {
      return validateByeAssignment(whiteId, 'FULL_POINT_BYE', prior);
    }
    return validateManualPairing(whiteId, blackId, prior);
  }

  async getStandings(id: string) {
    return computeStandings(await this.load(id));
  }

  async getMatrix(id: string) {
    const t = await this.load(id);
    const m = opponentsMatrix(t);
    return { ranks: m.ranks, cells: m.ranks.map((a) => m.ranks.map((b) => m.cell(a, b))) };
  }

  async exportTrf(id: string) {
    return serializeTournament(tournamentToTrf(await this.load(id)));
  }

  async checkTournament(id: string) {
    return this.engine.checkTournament(await this.exportTrf(id));
  }
}

export { StateError };

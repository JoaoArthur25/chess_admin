import { beforeEach, describe, expect, it } from 'vitest';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { DomainError, StateError, TournamentService } from '../src/services/tournamentService.js';
import type { PairingResult, Tournament } from '../src/domain/types.js';

function service() {
  return new TournamentService(new InMemoryRepository(), new FakePairingEngine());
}

async function seed(svc: TournamentService, players: number, rounds: number): Promise<string> {
  const t = await svc.createTournament({ name: 'Club Open', numberOfRounds: rounds, tieBreaks: ['BUCHHOLZ'] });
  for (let i = 0; i < players; i += 1) {
    await svc.addPlayer(t.id, {
      fullName: `Player ${String(i).padStart(2, '0')}`,
      sex: i % 3 === 0 ? 'F' : 'M',
      pairingRating: 2200 - i * 30,
      fideId: `${5000000 + i}`,
    });
  }
  return t.id;
}

/** Enter a deterministic result for every pending game pairing in the last round. */
async function completeLastRound(svc: TournamentService, id: string): Promise<void> {
  const t = await svc.getTournament(id);
  const last = [...t.rounds].sort((a, b) => b.index - a.index)[0]!;
  for (const p of last.pairings) {
    if (p.result !== 'PENDING') continue;
    const res: PairingResult = 'WHITE_WIN';
    await svc.enterResult(id, p.id, res);
  }
}

describe('tournament lifecycle', () => {
  let svc: TournamentService;
  beforeEach(() => {
    svc = service();
  });

  it('assigns TPN starting ranks on start (rating desc)', async () => {
    const id = await seed(svc, 6, 3);
    const t = await svc.startTournament(id);
    expect(t.state).toBe('RUNNING');
    const ranks = t.players.map((p) => p.startingRank);
    expect(ranks.every((r) => r != null)).toBe(true);
    const top = t.players.find((p) => p.startingRank === 1)!;
    expect(top.pairingRating).toBe(2200); // highest-rated is seed 1
  });

  it('blocks generating round 2 until round 1 is complete', async () => {
    const id = await seed(svc, 6, 3);
    await svc.startTournament(id);
    await svc.generateNextRound(id);
    // The state-machine guard rejects (mapped to HTTP 409 by the API).
    await expect(svc.generateNextRound(id)).rejects.toBeInstanceOf(StateError);
  });

  it('runs a full event and finishes', async () => {
    const id = await seed(svc, 6, 3);
    await svc.startTournament(id);
    for (let r = 1; r <= 3; r += 1) {
      const { round } = await svc.generateNextRound(id);
      expect(round.index).toBe(r);
      await completeLastRound(svc, id);
    }
    const t = await svc.getTournament(id);
    expect(t.state).toBe('FINISHED');
  });

  it('keeps a withdrawn player out of games but in history', async () => {
    const id = await seed(svc, 6, 3);
    const t0 = await svc.startTournament(id);
    await svc.generateNextRound(id);
    await completeLastRound(svc, id);

    // Withdraw the seed-1 player before round 2.
    const seed1 = t0.players.find((p) => p.startingRank === 1)!;
    await svc.updatePlayer(id, seed1.id, { status: 'WITHDRAWN' });

    const { round } = await svc.generateNextRound(id);
    const inGame = round.pairings.some(
      (p) => p.blackId !== null && (p.whiteId === seed1.id || p.blackId === seed1.id),
    );
    expect(inGame).toBe(false);
    // They still appear with a zero-point bye record this round.
    const byeRow = round.pairings.find((p) => p.whiteId === seed1.id && p.blackId === null);
    expect(byeRow?.result).toBe('ZERO_POINT_BYE');

    // History (round 1 game) is preserved.
    const t = await svc.getTournament(id);
    const r1 = t.rounds.find((rd) => rd.index === 1)!;
    expect(r1.pairings.some((p) => p.whiteId === seed1.id || p.blackId === seed1.id)).toBe(true);
  });

  it('flags a retroactive result edit', async () => {
    const id = await seed(svc, 4, 3);
    await svc.startTournament(id);
    await svc.generateNextRound(id);
    await completeLastRound(svc, id);
    await svc.generateNextRound(id); // now in round 2

    const t = await svc.getTournament(id);
    const r1 = t.rounds.find((rd) => rd.index === 1)!;
    const game = r1.pairings.find((p) => p.blackId !== null)!;
    const { alerts } = await svc.enterResult(id, game.id, 'BLACK_WIN');
    expect(alerts.some((a) => a.code === 'RETROACTIVE_EDIT')).toBe(true);
  });

  it('rejects an invalid result for a bye pairing', async () => {
    const id = await seed(svc, 5, 3); // odd field -> a bye each round
    await svc.startTournament(id);
    const { round } = await svc.generateNextRound(id);
    const bye = round.pairings.find((p) => p.blackId === null)!;
    await expect(svc.enterResult(id, bye.id, 'WHITE_WIN')).rejects.toBeInstanceOf(DomainError);
  });

  it('produces standings and a TRF export', async () => {
    const id = await seed(svc, 6, 2);
    await svc.startTournament(id);
    await svc.generateNextRound(id);
    await completeLastRound(svc, id);

    const standings = await svc.getStandings(id);
    expect(standings).toHaveLength(6);
    expect(standings[0]!.rank).toBe(1);

    const trf = await svc.exportTrf(id);
    expect(trf).toContain('012 Club Open');
    expect(trf.split('\n').filter((l) => l.startsWith('001'))).toHaveLength(6);
  });
});

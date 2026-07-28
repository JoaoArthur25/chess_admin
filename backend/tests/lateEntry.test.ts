import { beforeEach, describe, expect, it } from 'vitest';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { TournamentService } from '../src/services/tournamentService.js';
import { parseTournament } from '../src/trf/parse.js';

function service() {
  return new TournamentService(new InMemoryRepository(), new FakePairingEngine());
}

async function seed(svc: TournamentService, players: number, rounds: number) {
  const t = await svc.createTournament({ name: 'Late Entry Open', numberOfRounds: rounds });
  for (let i = 0; i < players; i += 1) {
    await svc.addPlayer(t.id, {
      fullName: `Player ${String(i).padStart(2, '0')}`,
      sex: 'M',
      pairingRating: 2200 - i * 30,
    });
  }
  await svc.startTournament(t.id);
  return t.id;
}

async function completeLastRound(svc: TournamentService, id: string) {
  const t = await svc.getTournament(id);
  const last = [...t.rounds].sort((a, b) => b.index - a.index)[0]!;
  for (const p of last.pairings) {
    if (p.result === 'PENDING') await svc.enterResult(id, p.id, 'WHITE_WIN');
  }
}

describe('late entry handling', () => {
  let svc: TournamentService;
  beforeEach(() => {
    svc = service();
  });

  it('pairs the whole field in the round after a late entry joins', async () => {
    const id = await seed(svc, 6, 5);
    await svc.generateNextRound(id);
    await completeLastRound(svc, id);

    // A 7th player registers after round 1 -> LATE_ENTRY.
    const late = await svc.addPlayer(id, {
      fullName: 'Latecomer, Ana',
      sex: 'F',
      pairingRating: 1900,
    });
    expect(late.status).toBe('LATE_ENTRY');

    const { round } = await svc.generateNextRound(id);

    // Every one of the 7 players must appear exactly once in round 2.
    const seen = new Map<string, number>();
    for (const p of round.pairings) {
      seen.set(p.whiteId, (seen.get(p.whiteId) ?? 0) + 1);
      if (p.blackId) seen.set(p.blackId, (seen.get(p.blackId) ?? 0) + 1);
    }
    const t = await svc.getTournament(id);
    for (const p of t.players) {
      expect(seen.get(p.id), `player ${p.fullName} must be paired once`).toBe(1);
    }
  });

  it('does not shift a late entry\'s games into earlier round columns in the TRF', async () => {
    const id = await seed(svc, 4, 5);
    await svc.generateNextRound(id);
    await completeLastRound(svc, id);
    await svc.addPlayer(id, { fullName: 'Latecomer, Ana', sex: 'F', pairingRating: 1900 });
    await svc.generateNextRound(id);

    const trf = await svc.exportTrf(id);
    const parsed = parseTournament(trf);
    const late = parsed.players.find((p) => p.name === 'Latecomer, Ana')!;

    // The late entry did NOT play round 1. Their round-1 slot must be an
    // unplayed/absent marker, and their round-2 game must sit in slot 2.
    expect(late.rounds.length, 'must have a record for every played round').toBe(2);
    expect(late.rounds[0]!.opponent, 'round 1 must be a non-game (no opponent)').toBe(0);
    expect(late.rounds[1]!.opponent, 'round 2 must hold the real opponent').toBeGreaterThan(0);
  });

  it('awards the configured late-entry points for missed rounds', async () => {
    const t = await svc.createTournament({
      name: 'Half Point Late',
      numberOfRounds: 5,
      lateEntryPoints: 0.5,
    });
    for (let i = 0; i < 4; i += 1) {
      await svc.addPlayer(t.id, { fullName: `P${i}`, sex: 'M', pairingRating: 2000 - i * 10 });
    }
    await svc.startTournament(t.id);
    await svc.generateNextRound(t.id);
    await completeLastRound(svc, t.id);

    const late = await svc.addPlayer(t.id, {
      fullName: 'Latecomer, Ana',
      sex: 'F',
      pairingRating: 1900,
    });

    const standings = await svc.getStandings(t.id);
    const row = standings.find((s) => s.player.id === late.id)!;
    expect(row.points, 'missed round 1 should be worth the configured 0.5').toBe(0.5);
  });

  it('keeps existing starting ranks stable when a rating is corrected mid-event', async () => {
    const id = await seed(svc, 6, 5);
    const before = await svc.getTournament(id);
    const ranksBefore = new Map(before.players.map((p) => [p.id, p.startingRank]));

    await svc.generateNextRound(id);
    await completeLastRound(svc, id);

    // Arbiter fixes a typo in the bottom player's rating; TPN must NOT reshuffle.
    const bottom = before.players.find((p) => p.startingRank === 6)!;
    await svc.updatePlayer(id, bottom.id, { pairingRating: 2500 });
    await svc.addPlayer(id, { fullName: 'Latecomer, Ana', sex: 'F', pairingRating: 1900 });

    const after = await svc.getTournament(id);
    for (const p of after.players) {
      const prev = ranksBefore.get(p.id);
      if (prev != null) {
        expect(p.startingRank, `${p.fullName} keeps its TPN`).toBe(prev);
      }
    }
  });
});

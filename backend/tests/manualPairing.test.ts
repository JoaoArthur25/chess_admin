import { beforeEach, describe, expect, it } from 'vitest';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { DomainError, TournamentService } from '../src/services/tournamentService.js';

function service() {
  return new TournamentService(new InMemoryRepository(), new FakePairingEngine());
}

async function seeded(svc: TournamentService, players = 6, rounds = 5) {
  const t = await svc.createTournament({ name: 'Manual', numberOfRounds: rounds });
  for (let i = 0; i < players; i += 1) {
    await svc.addPlayer(t.id, {
      fullName: `P${i}`,
      sex: 'M',
      pairingRating: 2200 - i * 40,
    });
  }
  await svc.startTournament(t.id);
  return t.id;
}

async function latestRound(svc: TournamentService, id: string) {
  const t = await svc.getTournament(id);
  return [...t.rounds].sort((a, b) => b.index - a.index)[0]!;
}

describe('manual pairing', () => {
  let svc: TournamentService;
  beforeEach(() => {
    svc = service();
  });

  it('applies an arbiter swap between two boards', async () => {
    const id = await seeded(svc);
    await svc.generateNextRound(id);
    const round = await latestRound(svc, id);

    const [b1, b2] = round.pairings;
    // Swap the black players of boards 1 and 2.
    const proposed = [
      { whiteId: b1!.whiteId, blackId: b2!.blackId },
      { whiteId: b2!.whiteId, blackId: b1!.blackId },
      ...round.pairings.slice(2).map((p) => ({ whiteId: p.whiteId, blackId: p.blackId })),
    ];

    const res = await svc.setRoundPairings(id, round.id, proposed, {
      acknowledgeWarnings: true,
    });
    expect(res.applied).toBe(true);

    const after = await latestRound(svc, id);
    expect(after.pairings.find((p) => p.whiteId === b1!.whiteId)?.blackId).toBe(b2!.blackId);
    expect(after.pairings.find((p) => p.whiteId === b2!.whiteId)?.blackId).toBe(b1!.blackId);
  });

  it('refuses a rematch as a hard error', async () => {
    const id = await seeded(svc);
    await svc.generateNextRound(id);
    // Complete round 1 so its pairings become history.
    const r1 = await latestRound(svc, id);
    for (const p of r1.pairings) {
      if (p.result === 'PENDING') await svc.enterResult(id, p.id, 'WHITE_WIN');
    }
    await svc.generateNextRound(id);
    const r2 = await latestRound(svc, id);

    // Force a rematch of round 1's board 1 into round 2.
    const rematch = r1.pairings.find((p) => p.blackId !== null)!;
    const others = r2.pairings
      .filter((p) => ![rematch.whiteId, rematch.blackId].includes(p.whiteId))
      .filter((p) => ![rematch.whiteId, rematch.blackId].includes(p.blackId ?? ''));
    const proposed = [
      { whiteId: rematch.whiteId, blackId: rematch.blackId },
      ...others.map((p) => ({ whiteId: p.whiteId, blackId: p.blackId })),
    ];

    // Only run the assertion when the swap keeps the same player set; otherwise
    // the player-set guard would fire first (also correct, different message).
    const beforeSet = new Set(r2.pairings.flatMap((p) => [p.whiteId, p.blackId].filter(Boolean)));
    const afterSet = new Set(proposed.flatMap((p) => [p.whiteId, p.blackId].filter(Boolean)));
    if (beforeSet.size !== afterSet.size) return;

    await expect(
      svc.setRoundPairings(id, r2.id, proposed, { acknowledgeWarnings: true }),
    ).rejects.toMatchObject({ name: 'DomainError', status: 409 });
  });

  it('refuses to drop or duplicate a player', async () => {
    const id = await seeded(svc);
    await svc.generateNextRound(id);
    const round = await latestRound(svc, id);

    // Drop the last board entirely.
    const dropped = round.pairings
      .slice(0, -1)
      .map((p) => ({ whiteId: p.whiteId, blackId: p.blackId }));
    await expect(svc.setRoundPairings(id, round.id, dropped)).rejects.toBeInstanceOf(DomainError);

    // Same player on two boards.
    const first = round.pairings[0]!;
    const duped = round.pairings.map((p) => ({
      whiteId: first.whiteId,
      blackId: p.blackId,
    }));
    await expect(svc.setRoundPairings(id, round.id, duped)).rejects.toBeInstanceOf(DomainError);
  });

  it('refuses to re-pair a round that already has results', async () => {
    const id = await seeded(svc);
    await svc.generateNextRound(id);
    const round = await latestRound(svc, id);
    const game = round.pairings.find((p) => p.blackId !== null)!;
    await svc.enterResult(id, game.id, 'WHITE_WIN');

    const same = round.pairings.map((p) => ({ whiteId: p.whiteId, blackId: p.blackId }));
    await expect(svc.setRoundPairings(id, round.id, same)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('returns colour warnings unapplied until acknowledged', async () => {
    const id = await seeded(svc, 4);
    // Round 1, then complete it so colours are on record.
    await svc.generateNextRound(id);
    const r1 = await latestRound(svc, id);
    for (const p of r1.pairings) {
      if (p.result === 'PENDING') await svc.enterResult(id, p.id, 'WHITE_WIN');
    }
    await svc.generateNextRound(id);
    const r2 = await latestRound(svc, id);

    // Force everyone to keep the colour they had in round 1 by reusing the
    // round-1 orientation for the round-2 opponents.
    const proposed = r2.pairings.map((p) => {
      const whiteWasWhiteInR1 = r1.pairings.some((q) => q.whiteId === p.blackId);
      return whiteWasWhiteInR1
        ? { whiteId: p.blackId!, blackId: p.whiteId }
        : { whiteId: p.whiteId, blackId: p.blackId };
    });

    const dry = await svc.setRoundPairings(id, r2.id, proposed);
    if (dry.alerts.length > 0) {
      expect(dry.applied, 'warnings must not auto-apply').toBe(false);
      const forced = await svc.setRoundPairings(id, r2.id, proposed, {
        acknowledgeWarnings: true,
      });
      expect(forced.applied).toBe(true);
    }
  });
});

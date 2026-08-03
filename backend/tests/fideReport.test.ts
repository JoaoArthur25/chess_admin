import { beforeEach, describe, expect, it } from 'vitest';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { TournamentService } from '../src/services/tournamentService.js';
import { missingReportFields, tournamentToTrf } from '../src/trf/fromDomain.js';
import { serializeTournament } from '../src/trf/serialize.js';
import { parseTournament } from '../src/trf/parse.js';
import { makePlayer, makeTournament } from './helpers.js';

function service() {
  return new TournamentService(new InMemoryRepository(), new FakePairingEngine());
}

/** Header lines present in a serialized TRF, e.g. ['012', '022', ...]. */
function headerCodes(trf: string): string[] {
  return trf
    .split('\n')
    .filter((l) => /^\d{3} /.test(l))
    .map((l) => l.slice(0, 3));
}

describe('FIDE report — administrative fields', () => {
  let svc: TournamentService;
  beforeEach(() => {
    svc = service();
  });

  it('omits optional header lines when the data is absent', async () => {
    const t = await svc.createTournament({ name: 'Bare Club Open', numberOfRounds: 3 });
    await svc.addPlayer(t.id, { fullName: 'A, A', sex: 'M', pairingRating: 1800 });
    await svc.addPlayer(t.id, { fullName: 'B, B', sex: 'M', pairingRating: 1700 });
    await svc.startTournament(t.id);

    const codes = headerCodes(await svc.exportTrf(t.id));
    // Always present: name, start date, player count, rated count.
    expect(codes).toEqual(expect.arrayContaining(['012', '042', '062', '072']));
    // A blank administrative field is worse than an absent one.
    expect(codes).not.toContain('022');
    expect(codes).not.toContain('102');
    expect(codes).not.toContain('122');
  });

  it('emits every administrative line once filled in', async () => {
    const t = await svc.createTournament({ name: 'Rated Open', numberOfRounds: 3 });
    await svc.addPlayer(t.id, { fullName: 'A, A', sex: 'M', pairingRating: 1800 });
    await svc.addPlayer(t.id, { fullName: 'B, B', sex: 'M', pairingRating: 1700 });
    await svc.updateTournament(t.id, {
      city: 'Joinville',
      federation: 'BRA',
      endDate: new Date('2026-08-10T00:00:00Z'),
      tournamentType: 'Individual: Swiss-System',
      chiefArbiter: 'Silva, Joao',
      deputyArbiters: 'Souza, Maria',
      timeControl: '90 min + 30 sec/move',
    });
    await svc.startTournament(t.id);

    const trf = await svc.exportTrf(t.id);
    expect(headerCodes(trf)).toEqual(
      expect.arrayContaining(['012', '022', '032', '042', '052', '062', '072', '092', '102', '112', '122']),
    );

    const parsed = parseTournament(trf);
    expect(parsed.city).toBe('Joinville');
    expect(parsed.federation).toBe('BRA');
    expect(parsed.endDate).toBe('2026/08/10');
    expect(parsed.tournamentType).toBe('Individual: Swiss-System');
    expect(parsed.chiefArbiter).toBe('Silva, Joao');
    expect(parsed.deputyArbiters).toBe('Souza, Maria');
    expect(parsed.timeControl).toBe('90 min + 30 sec/move');
  });

  it('counts only rated players in line 072', () => {
    const t = makeTournament({
      players: [
        makePlayer({ id: 'a', pairingRating: 1800, startingRank: 1 }),
        makePlayer({ id: 'b', pairingRating: 0, startingRank: 2 }),
        makePlayer({ id: 'c', pairingRating: 1500, startingRank: 3 }),
      ],
    });
    const trf = serializeTournament(tournamentToTrf(t));
    const line072 = trf.split('\n').find((l) => l.startsWith('072'))!;
    expect(line072.trim()).toBe('072 2');
  });

  it('round-trips the administrative header through the parser', () => {
    const t = makeTournament({
      city: 'Joinville',
      federation: 'BRA',
      endDate: new Date('2026-08-10T00:00:00Z'),
      tournamentType: 'Individual: Swiss-System',
      chiefArbiter: 'Silva, Joao',
      timeControl: '90+30',
      players: [makePlayer({ id: 'a', startingRank: 1 })],
    });
    const text = serializeTournament(tournamentToTrf(t));
    const again = serializeTournament(parseTournament(text));
    expect(again).toBe(text);
  });
});

describe('FIDE report — readiness', () => {
  let svc: TournamentService;
  beforeEach(() => {
    svc = service();
  });

  it('lists what is still missing and does not block the export', async () => {
    const t = await svc.createTournament({ name: 'Half Filled', numberOfRounds: 1 });
    await svc.addPlayer(t.id, { fullName: 'A, A', sex: 'M', pairingRating: 1800 });
    await svc.addPlayer(t.id, { fullName: 'B, B', sex: 'M', pairingRating: 1700 });
    await svc.updateTournament(t.id, { city: 'Joinville', federation: 'BRA' });

    const r = await svc.reportReadiness(t.id);
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(
      expect.arrayContaining(['End date (052)', 'Chief arbiter (102)', 'Time control (122)']),
    );
    expect(r.missing).not.toContain('City (022)');

    // The export still works — readiness is advisory.
    await expect(svc.exportTrf(t.id)).resolves.toContain('012 Half Filled');
  });

  it('is ready only when the data is complete AND the event has finished', async () => {
    const t = await svc.createTournament({ name: 'Complete', numberOfRounds: 1 });
    for (const n of ['A, A', 'B, B']) {
      await svc.addPlayer(t.id, { fullName: n, sex: 'M', pairingRating: 1800 });
    }
    await svc.updateTournament(t.id, {
      city: 'Joinville',
      federation: 'BRA',
      endDate: new Date('2026-08-10T00:00:00Z'),
      tournamentType: 'Individual: Swiss-System',
      chiefArbiter: 'Silva, Joao',
      timeControl: '90+30',
    });
    await svc.startTournament(t.id);

    // Data complete, but the tournament is still running.
    let r = await svc.reportReadiness(t.id);
    expect(r.missing).toHaveLength(0);
    expect(r.finished).toBe(false);
    expect(r.ready).toBe(false);

    await svc.generateNextRound(t.id);
    const cur = await svc.getTournament(t.id);
    for (const p of cur.rounds[0]!.pairings) {
      if (p.result === 'PENDING') await svc.enterResult(t.id, p.id, 'WHITE_WIN');
    }

    r = await svc.reportReadiness(t.id);
    expect(r.finished).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('reports nothing missing for a fully populated tournament', () => {
    const t = makeTournament({
      city: 'Joinville',
      federation: 'BRA',
      endDate: new Date(),
      tournamentType: 'Individual: Swiss-System',
      chiefArbiter: 'Silva, Joao',
      timeControl: '90+30',
    });
    expect(missingReportFields(t)).toHaveLength(0);
  });
});

import { PrismaRepository } from '../src/repo/prisma.js';
import { FakePairingEngine } from '../src/engine/fake.js';
import { TournamentService } from '../src/services/tournamentService.js';

// Seeds a small demo tournament into PostgreSQL (REPO=prisma path).
// Run with: npm run seed  (requires DATABASE_URL + applied migrations)
async function main() {
  const svc = new TournamentService(new PrismaRepository(), new FakePairingEngine());

  const t = await svc.createTournament({
    name: 'Demo Open 2026',
    numberOfRounds: 5,
    tieBreaks: ['BUCHHOLZ', 'BUCHHOLZ_CUT1', 'SONNEBORN_BERGER'],
  });

  const roster: [string, 'M' | 'F', number][] = [
    ['Carlsen, Magnus', 'M', 2830],
    ['Nakamura, Hikaru', 'M', 2780],
    ['Caruana, Fabiano', 'M', 2760],
    ['Nepomniachtchi, Ian', 'M', 2750],
    ['Firouzja, Alireza', 'M', 2745],
    ['Polgar, Judit', 'F', 2700],
    ['Gukesh, D', 'M', 2740],
    ['Hou, Yifan', 'F', 2650],
  ];
  for (const [fullName, sex, rating] of roster) {
    await svc.addPlayer(t.id, { fullName, sex, fideTitle: 'GM', pairingRating: rating });
  }

  await svc.startTournament(t.id);
  console.log(`Seeded tournament ${t.id} ("Demo Open 2026") with ${roster.length} players.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));

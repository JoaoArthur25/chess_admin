import '../src/loadEnv.js'; // must come first — populates process.env
import { PrismaRepository } from '../src/repo/prisma.js';
import { FakePairingEngine } from '../src/engine/fake.js';
import { AuthService } from '../src/services/authService.js';
import { TournamentService } from '../src/services/tournamentService.js';

// Seeds a demo arbiter + tournament into PostgreSQL (REPO=prisma path).
// Run with: npm run seed  (requires DATABASE_URL + applied migrations)

const DEMO_EMAIL = 'demo@chess-admin.local';
const DEMO_PASSWORD = 'demo-password-123';

async function main() {
  const repo = new PrismaRepository();
  const svc = new TournamentService(repo, new FakePairingEngine());
  const auth = new AuthService(repo);

  // A tournament MUST have an owner: listing and every write are scoped by it,
  // so an ownerless event would be invisible and unmanageable once auth is on.
  const existing = await repo.findUserByEmail(DEMO_EMAIL);
  const owner = existing
    ? { id: existing.id }
    : (await auth.register(DEMO_EMAIL, 'Demo Arbiter', DEMO_PASSWORD)).user;

  const t = await svc.createTournament({
    name: 'Demo Open 2026',
    numberOfRounds: 5,
    tieBreaks: ['BUCHHOLZ', 'BUCHHOLZ_CUT1', 'SONNEBORN_BERGER'],
    ownerId: owner.id,
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
  console.log(`Sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD} to manage it.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));

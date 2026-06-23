import { createApp } from './api/app.js';
import { createPairingEngine } from './engine/index.js';
import { createRepository } from './repo/index.js';
import { TournamentService } from './services/tournamentService.js';

async function main() {
  const repo = await createRepository();
  const engine = createPairingEngine();
  const service = new TournamentService(repo, engine);
  const app = createApp(service);

  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => {
    console.log(`Chess Admin API listening on http://localhost:${port}`);
    console.log(`  repository: ${process.env.REPO ?? 'memory'}`);
    console.log(`  engine:     ${process.env.PAIRING_ENGINE ?? 'fake'}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

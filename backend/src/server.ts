import './loadEnv.js'; // must come first — populates process.env
import { createApp } from './api/app.js';
import { validateConfig } from './config.js';
import { createPairingEngine } from './engine/index.js';
import { createMailer } from './mail/index.js';
import { createRepository } from './repo/index.js';
import { AuthService } from './services/authService.js';
import { TournamentService } from './services/tournamentService.js';

async function main() {
  // Refuse to boot a production deployment that is missing anything security
  // relevant, rather than starting in a weakened state.
  validateConfig();

  const repo = await createRepository();
  const engine = createPairingEngine();
  const mailer = await createMailer();
  const service = new TournamentService(repo, engine);
  const app = createApp(service, new AuthService(repo, mailer));

  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => {
    console.log(`Chess Admin API listening on http://localhost:${port}`);
    console.log(`  repository: ${process.env.REPO ?? 'memory'}`);
    console.log(`  engine:     ${process.env.PAIRING_ENGINE ?? 'fake'}`);
    console.log(`  mailer:     ${process.env.SMTP_HOST ? 'smtp' : 'console (prints reset links to this log)'}`);
  });

  // Expired refresh/reset rows can no longer authenticate anything; drop them
  // so the tables do not grow without bound. unref() keeps this from holding
  // the process open on shutdown.
  const HOUR = 60 * 60 * 1000;
  const sweep = async () => {
    try {
      const removed = await repo.deleteExpiredTokens(new Date());
      if (removed > 0) console.log(`Cleaned up ${removed} expired token(s).`);
    } catch (err) {
      console.error('Token cleanup failed:', err);
    }
  };
  void sweep();
  setInterval(() => void sweep(), HOUR).unref();
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

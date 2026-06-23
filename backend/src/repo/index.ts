import { InMemoryRepository } from './memory.js';
import type { TournamentRepository } from './types.js';

export * from './types.js';
export { InMemoryRepository } from './memory.js';

/**
 * Resolve the repository from configuration.
 *   REPO=memory  -> InMemoryRepository (default; no DB needed)
 *   REPO=prisma  -> PrismaRepository   (requires DATABASE_URL + migration)
 * The Prisma adapter is imported lazily so the in-memory path never touches it.
 */
export async function createRepository(): Promise<TournamentRepository> {
  const kind = (process.env.REPO ?? 'memory').toLowerCase();
  if (kind === 'prisma') {
    const { PrismaRepository } = await import('./prisma.js');
    return new PrismaRepository();
  }
  return new InMemoryRepository();
}

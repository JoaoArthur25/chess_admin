import { BbpPairingsEngine } from './bbpPairings.js';
import { FakePairingEngine } from './fake.js';
import type { PairingEngine } from './port.js';

export * from './port.js';
export { FakePairingEngine } from './fake.js';
export { BbpPairingsEngine, parsePairingOutput } from './bbpPairings.js';

/**
 * Resolve the pairing engine from configuration.
 *   PAIRING_ENGINE=fake  -> FakePairingEngine (default in dev/test)
 *   PAIRING_ENGINE=bbp   -> BbpPairingsEngine (requires PAIRING_ENGINE_PATH)
 */
export function createPairingEngine(): PairingEngine {
  const kind = (process.env.PAIRING_ENGINE ?? 'fake').toLowerCase();
  switch (kind) {
    case 'bbp':
    case 'bbppairings':
      return new BbpPairingsEngine();
    case 'fake':
    default:
      return new FakePairingEngine();
  }
}

import { BbpPairingsEngine } from './bbpPairings.js';
import { FakePairingEngine } from './fake.js';
import { JaVaFoEngine } from './javafo.js';
import type { PairingEngine } from './port.js';

export * from './port.js';
export { FakePairingEngine } from './fake.js';
export { BbpPairingsEngine, parsePairingOutput } from './bbpPairings.js';
export { JaVaFoEngine } from './javafo.js';

/**
 * Resolve the pairing engine from configuration.
 *   PAIRING_ENGINE=fake   -> FakePairingEngine (default in dev/test)
 *   PAIRING_ENGINE=bbp    -> BbpPairingsEngine (requires PAIRING_ENGINE_PATH)
 *   PAIRING_ENGINE=javafo -> JaVaFoEngine (requires a JRE and JAVAFO_PATH)
 */
export function createPairingEngine(): PairingEngine {
  const kind = (process.env.PAIRING_ENGINE ?? 'fake').toLowerCase();
  switch (kind) {
    case 'bbp':
    case 'bbppairings':
      return new BbpPairingsEngine();
    case 'javafo':
      return new JaVaFoEngine();
    case 'fake':
    default:
      return new FakePairingEngine();
  }
}

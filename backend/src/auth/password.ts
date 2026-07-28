import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * Hash a password with scrypt (memory-hard, in Node's stdlib — no native build
 * step). Stored as "scrypt$<saltHex>$<hashHex>" so the format can evolve.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Verify a password against a stored hash. Always timing-safe. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  if (salt.length === 0 || expected.length !== KEY_LEN) return false;

  const derived = await scrypt(password, salt, KEY_LEN);
  return timingSafeEqual(derived, expected);
}

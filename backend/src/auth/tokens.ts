import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Minimal signed-token scheme: base64url(payload).base64url(HMAC-SHA256).
// The algorithm is FIXED in code and no header is parsed, so the classic JWT
// "alg: none" / algorithm-confusion attacks are impossible by construction.

export interface TokenPayload {
  sub: string; // user id
  email: string;
  iat: number; // issued at, unix seconds — compared against passwordChangedAt
  exp: number; // unix seconds
}

const TTL_SECONDS = 60 * 60 * 12; // 12h

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Resolve the signing secret. In production AUTH_SECRET is mandatory — we never
 * ship a hardcoded default. In dev a random per-process secret is used, which
 * simply means sessions do not survive a restart.
 */
function resolveSecret(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SECRET must be set (>=16 chars) in production. Refusing to start with an insecure default.',
    );
  }
  if (fromEnv) {
    throw new Error('AUTH_SECRET is too short — use at least 16 characters.');
  }
  return devSecret;
}

// Generated once per process for development convenience.
const devSecret = randomBytes(32).toString('hex');

function sign(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function createToken(user: { id: string; email: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + TTL_SECONDS,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(sign(body, resolveSecret()));
  return `${body}.${sig}`;
}

/** Verify a token. Returns the payload, or null when invalid/expired. */
export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = sign(body, resolveSecret());
  const provided = fromB64url(sig);
  // Compare signatures before touching the payload, and only on equal lengths
  // (timingSafeEqual throws otherwise).
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as TokenPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// Centralised configuration, validated at boot.
//
// Anything that would be a security hole if misconfigured fails the process
// here rather than silently degrading. A server that starts with a weak default
// is worse than one that refuses to start.

export const isProduction = process.env.NODE_ENV === 'production';

/** Origins allowed to call the API with credentials. */
export function allowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (raw) {
    return raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  // Development convenience only — never reached in production (see validate).
  return ['http://localhost:5183', 'http://127.0.0.1:5183'];
}

/** Open registration can be closed once the club's accounts exist. */
export const registrationOpen = process.env.ALLOW_REGISTRATION !== 'false';

export const accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL ?? 15 * 60);
export const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14);

/** Behind a reverse proxy, Express needs this or every client looks like the proxy. */
export const trustProxy = process.env.TRUST_PROXY === 'true';

export const cookieName = 'chess_admin_refresh';
/** Restricting the path keeps the refresh cookie off every other request. */
export const cookiePath = '/api/auth';

/**
 * Refuse to start when a production deployment is missing something that would
 * weaken it. Called from the entrypoint before the server listens.
 */
export function validateConfig(): void {
  if (!isProduction) return;

  const problems: string[] = [];

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    problems.push('AUTH_SECRET must be set and at least 16 characters');
  }
  if (!process.env.CORS_ORIGIN?.trim()) {
    problems.push(
      'CORS_ORIGIN must list the exact frontend origin(s) — a permissive default is not allowed in production',
    );
  }
  if (!process.env.APP_URL?.trim()) {
    problems.push('APP_URL must be set so password-reset links point somewhere real');
  }
  if (process.env.REPO === 'prisma' && !process.env.DATABASE_URL?.trim()) {
    problems.push('DATABASE_URL must be set when REPO=prisma');
  }
  if (!process.env.SMTP_HOST?.trim()) {
    problems.push(
      'SMTP_HOST must be set in production: without it password-reset links are printed to the log, so anyone with log access can take over any account',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start — insecure production configuration:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { AuthService } from '../src/services/authService.js';
import { TournamentService } from '../src/services/tournamentService.js';
import { cookieName } from '../src/config.js';

let repo: InMemoryRepository;
let base: string;
let close: () => void;

beforeEach(() => {
  close?.();
  repo = new InMemoryRepository();
  const app = createApp(
    new TournamentService(repo, new FakePairingEngine()),
    new AuthService(repo),
  );
  const server = app.listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
  close = () => server.close();
});

interface Res {
  status: number;
  body: any;
  setCookie: string[];
  headers: Headers;
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; token?: string; cookie?: string; origin?: string } = {},
): Promise<Res> {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.origin ? { Origin: opts.origin } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, setCookie: res.headers.getSetCookie(), headers: res.headers };
}

/** The refresh cookie as a `name=value` pair ready to send back. */
function refreshCookie(res: Res): string {
  const raw = res.setCookie.find((c) => c.startsWith(`${cookieName}=`))!;
  return raw.split(';')[0]!;
}

const EMAIL = 'arbiter@club.org';
const PASSWORD = 'correct-horse-battery';

async function register(email = EMAIL): Promise<Res> {
  return api('/auth/register', {
    method: 'POST',
    body: { email, name: 'Arbiter', password: PASSWORD },
  });
}

describe('refresh token is kept out of the browser', () => {
  it('is delivered only as an httpOnly cookie, never in the body', async () => {
    const res = await register();
    expect(res.status).toBe(201);

    // The body carries the short-lived access token and the user — nothing else.
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');

    const cookie = res.setCookie.find((c) => c.startsWith(`${cookieName}=`));
    expect(cookie, 'a refresh cookie must be set').toBeTruthy();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // Path-scoped so it is not attached to every API call.
    expect(cookie).toContain('Path=/api/auth');
  });

  it('login sets the cookie too and keeps the token out of the body', async () => {
    await register();
    const res = await api('/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    });
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.setCookie.some((c) => c.includes('HttpOnly'))).toBe(true);
  });
});

describe('refresh rotation', () => {
  it('issues a NEW cookie on every refresh and accepts the new one', async () => {
    const first = await register();
    const cookie1 = refreshCookie(first);

    const refreshed = await api('/auth/refresh', { method: 'POST', cookie: cookie1 });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    const cookie2 = refreshCookie(refreshed);
    expect(cookie2, 'the token must rotate').not.toBe(cookie1);

    // The new cookie works.
    expect((await api('/auth/refresh', { method: 'POST', cookie: cookie2 })).status).toBe(200);
  });

  it('rejects a refresh with no cookie', async () => {
    expect((await api('/auth/refresh', { method: 'POST' })).status).toBe(401);
  });

  it('rejects a replayed token but tolerates a near-simultaneous race', async () => {
    const first = await register();
    const cookie1 = refreshCookie(first);
    const refreshed = await api('/auth/refresh', { method: 'POST', cookie: cookie1 });
    const cookie2 = refreshCookie(refreshed);

    // Replaying the rotated token is refused...
    expect((await api('/auth/refresh', { method: 'POST', cookie: cookie1 })).status).toBe(401);

    // ...but within the grace window it is read as two tabs racing, not theft,
    // so the legitimate session survives. Logging an arbiter out mid-tournament
    // over a benign race is its own harm.
    expect((await api('/auth/refresh', { method: 'POST', cookie: cookie2 })).status).toBe(200);
  });

  it('treats a stale replay as theft and burns every session', async () => {
    const first = await register();
    const cookie1 = refreshCookie(first);
    const refreshed = await api('/auth/refresh', { method: 'POST', cookie: cookie1 });
    const cookie2 = refreshCookie(refreshed);

    // Age the revocation past the grace window: this is no longer a race.
    const raw = cookie1.split('=')[1]!;
    const { createHash } = await import('node:crypto');
    const rec = await repo.findRefreshToken(createHash('sha256').update(raw).digest('hex'));
    rec!.revokedAt = new Date(Date.now() - 60_000);

    expect((await api('/auth/refresh', { method: 'POST', cookie: cookie1 })).status).toBe(401);
    // The whole account is signed out.
    expect((await api('/auth/refresh', { method: 'POST', cookie: cookie2 })).status).toBe(401);
  });
});

describe('logout', () => {
  it('revokes the session so the old cookie stops working', async () => {
    const res = await register();
    const cookie = refreshCookie(res);

    const out = await api('/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(204);

    expect((await api('/auth/refresh', { method: 'POST', cookie })).status).toBe(401);
  });
});

describe('security headers', () => {
  it('sets the headers helmet is there for', async () => {
    const res = await api('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')?.toUpperCase()).toBe('SAMEORIGIN');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('referrer-policy')).toBeTruthy();
    // Express advertising itself is free reconnaissance.
    expect(res.headers.get('x-powered-by')).toBeNull();
  });
});

describe('CORS', () => {
  it('reflects an allowed origin with credentials', async () => {
    const res = await api('/health', { origin: 'http://localhost:5183' });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5183');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('does not authorise an unknown origin', async () => {
    const res = await api('/health', { origin: 'http://evil.example' });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('http://evil.example');
  });
});

describe('rate limiting on credential routes', () => {
  it('starts refusing after the configured number of attempts', async () => {
    let sawLimit = false;
    for (let i = 0; i < 25; i += 1) {
      const res = await api('/auth/login', {
        method: 'POST',
        body: { email: 'nobody@club.org', password: 'wrong-password-guess' },
      });
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
    }
    expect(sawLimit, 'brute force must eventually be throttled').toBe(true);
  });
});

describe('token cleanup', () => {
  it('removes rows that can no longer authenticate anything', async () => {
    const res = await register();
    const cookie = refreshCookie(res);
    const raw = cookie.split('=')[1]!;

    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(raw).digest('hex');
    const rec = await repo.findRefreshToken(hash);
    expect(rec).toBeTruthy();
    rec!.expiresAt = new Date(Date.now() - 1000);

    expect(await repo.deleteExpiredTokens(new Date())).toBeGreaterThan(0);
    expect(await repo.findRefreshToken(hash)).toBeNull();
  });
});

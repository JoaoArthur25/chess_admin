import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { AuthService } from '../src/services/authService.js';
import { TournamentService } from '../src/services/tournamentService.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { createToken, verifyToken } from '../src/auth/tokens.js';

// Drives the real Express app over an ephemeral port, so the middleware chain
// (auth + ownership guard) is exercised exactly as in production.
function startServer() {
  const repo = new InMemoryRepository();
  const app = createApp(
    new TournamentService(repo, new FakePairingEngine()),
    new AuthService(repo),
  );
  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}/api`, close: () => server.close() };
}

let srv: ReturnType<typeof startServer>;
beforeEach(() => {
  srv?.close();
  srv = startServer();
});

async function api(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
) {
  const res = await fetch(srv.base + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json as any };
}

async function registerArbiter(email: string): Promise<string> {
  const res = await api('/auth/register', {
    method: 'POST',
    body: { email, name: 'Arbiter', password: 'correct-horse-battery' },
  });
  expect(res.status).toBe(201);
  return res.body.token as string;
}

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).not.toContain('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
  });
});

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createToken({ id: 'u1', email: 'a@b.c' });
    expect(verifyToken(token)?.sub).toBe('u1');
  });

  it('rejects a tampered payload', () => {
    const token = createToken({ id: 'u1', email: 'a@b.c' });
    const forged =
      Buffer.from(JSON.stringify({ sub: 'admin', email: 'x', exp: 9999999999 }))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '') +
      '.' +
      token.split('.')[1];
    expect(verifyToken(forged)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired =
      Buffer.from(JSON.stringify({ sub: 'u1', email: 'a', exp: 1 })).toString('base64url') +
      '.' +
      'nonsense';
    expect(verifyToken(expired)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyToken('')).toBeNull();
    expect(verifyToken('a.b.c')).toBeNull();
  });
});

describe('auth endpoints', () => {
  it('registers and logs in', async () => {
    const token = await registerArbiter('arbiter@club.org');
    const me = await api('/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('arbiter@club.org');

    const login = await api('/auth/login', {
      method: 'POST',
      body: { email: 'arbiter@club.org', password: 'correct-horse-battery' },
    });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const res = await api('/auth/register', {
      method: 'POST',
      body: { email: 'nohash@club.org', name: 'A', password: 'correct-horse-battery' },
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toContain('scrypt$');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password with the same message as an unknown e-mail', async () => {
    await registerArbiter('real@club.org');
    const wrongPass = await api('/auth/login', {
      method: 'POST',
      body: { email: 'real@club.org', password: 'not-the-password' },
    });
    const unknown = await api('/auth/login', {
      method: 'POST',
      body: { email: 'nobody@club.org', password: 'not-the-password' },
    });
    expect(wrongPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPass.body.error).toBe(unknown.body.error);
  });

  it('refuses duplicate registration and short passwords', async () => {
    await registerArbiter('dup@club.org');
    const dup = await api('/auth/register', {
      method: 'POST',
      body: { email: 'dup@club.org', name: 'B', password: 'correct-horse-battery' },
    });
    expect(dup.status).toBe(409);

    const short = await api('/auth/register', {
      method: 'POST',
      body: { email: 'new@club.org', name: 'B', password: 'short' },
    });
    expect(short.status).toBe(400);
  });
});

describe('authorization', () => {
  it('requires a session to create or list tournaments', async () => {
    expect((await api('/tournaments', { method: 'POST', body: { name: 'X', numberOfRounds: 3 } })).status).toBe(401);
    expect((await api('/tournaments')).status).toBe(401);
    expect((await api('/tournaments', { token: 'bogus' })).status).toBe(401);
  });

  it('lists only the tournaments you own', async () => {
    const a = await registerArbiter('a@club.org');
    const b = await registerArbiter('b@club.org');
    await api('/tournaments', { method: 'POST', token: a, body: { name: 'A Open', numberOfRounds: 3 } });
    await api('/tournaments', { method: 'POST', token: b, body: { name: 'B Open', numberOfRounds: 3 } });

    const listA = await api('/tournaments', { token: a });
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].name).toBe('A Open');
  });

  it("blocks every write to another arbiter's tournament", async () => {
    const owner = await registerArbiter('owner@club.org');
    const attacker = await registerArbiter('attacker@club.org');
    const created = await api('/tournaments', {
      method: 'POST',
      token: owner,
      body: { name: 'Owned', numberOfRounds: 3 },
    });
    const id = created.body.id as string;

    const writes = [
      { path: `/tournaments/${id}`, method: 'DELETE' },
      { path: `/tournaments/${id}`, method: 'PATCH', body: { name: 'Hijacked' } },
      { path: `/tournaments/${id}/start`, method: 'POST' },
      { path: `/tournaments/${id}/rounds`, method: 'POST' },
      { path: `/tournaments/${id}/players`, method: 'POST', body: { fullName: 'X', sex: 'M' } },
    ];
    for (const w of writes) {
      const res = await api(w.path, { method: w.method, body: w.body, token: attacker });
      expect(res.status, `${w.method} ${w.path} must not be allowed`).toBe(404);
    }

    // The tournament is untouched.
    const still = await api(`/tournaments/${id}`);
    expect(still.body.name).toBe('Owned');
    expect(still.body.players).toHaveLength(0);
  });

  it('keeps standings and the tournament readable by spectators without a login', async () => {
    const owner = await registerArbiter('pub@club.org');
    const created = await api('/tournaments', {
      method: 'POST',
      token: owner,
      body: { name: 'Public Open', numberOfRounds: 3 },
    });
    const id = created.body.id as string;

    expect((await api(`/tournaments/${id}`)).status).toBe(200);
    expect((await api(`/tournaments/${id}/standings`)).status).toBe(200);
    expect((await api(`/tournaments/${id}/matrix`)).status).toBe(200);
    expect((await api(`/tournaments/${id}/trf`)).status).toBe(200);
  });
});

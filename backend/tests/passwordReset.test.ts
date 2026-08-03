import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { FakePairingEngine } from '../src/engine/fake.js';
import { InMemoryRepository } from '../src/repo/memory.js';
import { AuthService } from '../src/services/authService.js';
import { TournamentService } from '../src/services/tournamentService.js';
import type { Mailer, Message } from '../src/mail/port.js';

/** Captures messages so tests can read the link the user would receive. */
class CapturingMailer implements Mailer {
  readonly sent: Message[] = [];
  async send(message: Message): Promise<void> {
    this.sent.push(message);
  }
}

let repo: InMemoryRepository;
let mailer: CapturingMailer;
let base: string;
let close: () => void;

beforeEach(() => {
  close?.();
  repo = new InMemoryRepository();
  mailer = new CapturingMailer();
  const app = createApp(
    new TournamentService(repo, new FakePairingEngine()),
    new AuthService(repo, mailer, 'http://app.test'),
  );
  const server = app.listen(0);
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/api`;
  close = () => server.close();
});

async function api(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
) {
  const res = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
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
  return { status: res.status, body };
}

const EMAIL = 'arbiter@club.org';
const OLD_PASSWORD = 'the-old-password';
const NEW_PASSWORD = 'a-brand-new-password';

async function registerArbiter(): Promise<string> {
  const res = await api('/auth/register', {
    method: 'POST',
    body: { email: EMAIL, name: 'Arbiter', password: OLD_PASSWORD },
  });
  return res.body.accessToken as string;
}

/** The token embedded in the most recent reset e-mail. */
function tokenFromMail(): string {
  const last = mailer.sent.at(-1)!;
  return new URL(last.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
}

describe('password reset — happy path', () => {
  it('e-mails a link that lets the user set a new password', async () => {
    await registerArbiter();

    const req = await api('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
    expect(req.status).toBe(202);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe(EMAIL);

    const reset = await api('/auth/reset-password', {
      method: 'POST',
      body: { token: tokenFromMail(), password: NEW_PASSWORD },
    });
    expect(reset.status).toBe(200);

    // New password works, old one does not.
    expect(
      (await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: NEW_PASSWORD } }))
        .status,
    ).toBe(200);
    expect(
      (await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: OLD_PASSWORD } }))
        .status,
    ).toBe(401);
  });
});

describe('password reset — token handling', () => {
  beforeEach(async () => {
    await registerArbiter();
    await api('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
  });

  it('stores only a hash — the raw token is not in the repository', async () => {
    const raw = tokenFromMail();
    // The store is keyed by hash; the plaintext must not resolve directly.
    expect(await repo.findResetToken(raw)).toBeNull();
    expect(JSON.stringify(repo)).not.toContain(raw);
  });

  it('refuses a token that was already used', async () => {
    const token = tokenFromMail();
    expect((await api('/auth/reset-password', { method: 'POST', body: { token, password: NEW_PASSWORD } })).status).toBe(200);

    const second = await api('/auth/reset-password', {
      method: 'POST',
      body: { token, password: 'yet-another-password' },
    });
    expect(second.status).toBe(400);
  });

  it('refuses an expired token', async () => {
    // Age the stored token past its lifetime.
    const raw = tokenFromMail();
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(raw).digest('hex');
    const rec = await repo.findResetToken(hash);
    rec!.expiresAt = new Date(Date.now() - 1000);

    const res = await api('/auth/reset-password', {
      method: 'POST',
      body: { token: raw, password: NEW_PASSWORD },
    });
    expect(res.status).toBe(400);
  });

  it('refuses a forged token', async () => {
    const res = await api('/auth/reset-password', {
      method: 'POST',
      body: { token: 'a'.repeat(64), password: NEW_PASSWORD },
    });
    expect(res.status).toBe(400);
  });

  it('invalidates other outstanding tokens once one is redeemed', async () => {
    const first = tokenFromMail();
    await api('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
    const second = tokenFromMail();
    expect(second).not.toBe(first);

    expect((await api('/auth/reset-password', { method: 'POST', body: { token: second, password: NEW_PASSWORD } })).status).toBe(200);
    // The earlier link must be dead too.
    expect((await api('/auth/reset-password', { method: 'POST', body: { token: first, password: 'third-password-here' } })).status).toBe(400);
  });

  it('enforces the minimum password length', async () => {
    const res = await api('/auth/reset-password', {
      method: 'POST',
      body: { token: tokenFromMail(), password: 'short' },
    });
    expect(res.status).toBe(400);
  });
});

describe('password reset — does not leak account existence', () => {
  it('answers identically for a registered and an unknown e-mail', async () => {
    await registerArbiter();

    const known = await api('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
    const unknown = await api('/auth/forgot-password', {
      method: 'POST',
      body: { email: 'nobody@club.org' },
    });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    // ...and no mail was sent for the address that has no account.
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('password reset — session invalidation', () => {
  it('kills sessions issued before the reset', async () => {
    const oldToken = await registerArbiter();
    // The old session works right now.
    expect((await api('/auth/me', { token: oldToken })).status).toBe(200);

    await api('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
    // Session tokens carry second-precision timestamps; make sure the reset
    // lands strictly after the token was issued.
    await new Promise((r) => setTimeout(r, 1100));
    await api('/auth/reset-password', {
      method: 'POST',
      body: { token: tokenFromMail(), password: NEW_PASSWORD },
    });

    // Resetting because someone got in is pointless if their session survives.
    const after = await api('/auth/me', { token: oldToken });
    expect(after.status, 'the pre-reset session must be rejected').toBe(401);

    // A fresh sign-in works.
    const fresh = await api('/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: NEW_PASSWORD },
    });
    expect((await api('/auth/me', { token: fresh.body.accessToken })).status).toBe(200);
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createToken, type TokenPayload } from '../auth/tokens.js';
import { refreshTokenTtlDays } from '../config.js';
import type { Mailer } from '../mail/port.js';
import type { UserRepository } from '../repo/types.js';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResult {
  /** Short-lived; the browser keeps this in memory only. */
  accessToken: string;
  /**
   * Long-lived. The caller must put this in an httpOnly cookie and MUST NOT
   * return it in a response body — the browser is never allowed to read it.
   */
  refreshToken: string;
  user: PublicUser;
}

const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MINUTES = 60;
/** Window in which replaying a rotated token is treated as a race, not theft. */
const REUSE_GRACE_MS = 15_000;

/**
 * Reset and refresh tokens are high-entropy random values; only their SHA-256
 * hash is stored. A plain hash (not scrypt) is right here: the token already
 * has 256 bits of entropy, so it is not brute-forceable and needs no slow KDF.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  constructor(
    private readonly repo: UserRepository,
    private readonly mailer?: Mailer,
    private readonly appUrl = process.env.APP_URL ?? 'http://localhost:5183',
  ) {}

  async register(email: string, name: string, password: string): Promise<AuthResult> {
    const normalized = email.trim().toLowerCase();
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }
    if (await this.repo.findUserByEmail(normalized)) {
      throw new AuthError('An account with this e-mail already exists', 409);
    }

    const user = await this.repo.createUser({
      email: normalized,
      name: name.trim(),
      passwordHash: await hashPassword(password),
    });
    return this.issueSession(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.repo.findUserByEmail(email.trim().toLowerCase());
    // Same generic message whether the e-mail is unknown or the password is
    // wrong, so the endpoint cannot be used to enumerate accounts.
    const invalid = new AuthError('Invalid e-mail or password');
    if (!user) {
      // Still spend the hashing time so timing does not reveal existence.
      await hashPassword(password);
      throw invalid;
    }
    if (!(await verifyPassword(password, user.passwordHash))) throw invalid;

    return this.issueSession(user);
  }

  /** Mint an access token plus a fresh refresh token, storing only its hash. */
  private async issueSession(user: {
    id: string;
    email: string;
    name: string;
  }): Promise<AuthResult> {
    const refreshToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    await this.repo.createRefreshToken(user.id, hashToken(refreshToken), expiresAt);
    return { accessToken: createToken(user), refreshToken, user: toPublic(user) };
  }

  /**
   * Exchange a refresh token for a new pair, rotating it: the presented token is
   * revoked and a new one issued.
   *
   * Presenting an ALREADY REVOKED token means either a replay or a stolen
   * cookie being used in parallel with the legitimate one. We cannot tell which,
   * so we revoke every session for that account — the safe reading.
   */
  async refreshSession(refreshToken: string): Promise<AuthResult> {
    const invalid = new AuthError('Session expired');

    const record = await this.repo.findRefreshToken(hashToken(refreshToken));
    if (!record) throw invalid;

    if (record.revokedAt !== null) {
      // Reuse of a rotated token is the classic stolen-cookie signal, and the
      // safe response is to burn every session for the account.
      //
      // But a benign race produces the same shape: two tabs, or a retried
      // request, refreshing within moments of each other. Nuking a legitimate
      // arbiter mid-tournament over that is its own harm, so reuse within a
      // short window is rejected WITHOUT the global revocation. Beyond it,
      // replay is not plausibly a race and we assume theft.
      const sinceRevoked = Date.now() - record.revokedAt.getTime();
      if (sinceRevoked > REUSE_GRACE_MS) {
        await this.repo.revokeAllRefreshTokens(record.userId);
      }
      throw invalid;
    }
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;

    const user = await this.repo.findUserById(record.userId);
    if (!user) throw invalid;

    await this.repo.revokeRefreshToken(record.id);
    return this.issueSession(user);
  }

  /** Revoke a single session (sign out on this device). */
  async revokeSession(refreshToken: string): Promise<void> {
    const record = await this.repo.findRefreshToken(hashToken(refreshToken));
    if (record && record.revokedAt === null) {
      await this.repo.revokeRefreshToken(record.id);
    }
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.repo.findUserById(userId);
    if (!user) throw new AuthError('Account no longer exists');
    return toPublic(user);
  }

  /**
   * Is this still-signed, still-unexpired token acceptable? Rejects sessions
   * issued before the last password change, so a reset actually locks out
   * whoever knew the old password instead of leaving them signed in.
   */
  async isSessionValid(payload: TokenPayload): Promise<boolean> {
    const user = await this.repo.findUserById(payload.sub);
    if (!user) return false;
    // Second precision: allow the token issued in the same second as the change.
    return payload.iat >= Math.floor(user.passwordChangedAt.getTime() / 1000);
  }

  // ── Password recovery ────────────────────────────────────────────────────

  /**
   * Start a reset. ALWAYS resolves, whether or not the address is registered —
   * a different response would turn this into an account-enumeration oracle.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.repo.findUserByEmail(email.trim().toLowerCase());
    if (!user) return;

    // 256 bits of entropy; the plaintext exists only in the e-mailed link.
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);
    await this.repo.createResetToken(user.id, hashToken(token), expiresAt);

    const link = `${this.appUrl}/reset-password?token=${token}`;
    await this.mailer?.send({
      to: user.email,
      subject: 'Reset your Chess Admin password',
      text: [
        `Hello ${user.name},`,
        '',
        'Someone asked to reset the password for this Chess Admin account.',
        `Open the link below within ${RESET_TTL_MINUTES} minutes to choose a new one:`,
        '',
        link,
        '',
        'If it was not you, you can ignore this message — nothing has changed.',
      ].join('\n'),
    });
  }

  /** Redeem a reset token and set a new password. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    // Same message for every failure mode, so the endpoint reveals nothing
    // about which tokens exist.
    const invalid = new AuthError('This reset link is invalid or has expired', 400);

    const record = await this.repo.findResetToken(hashToken(token));
    if (!record) throw invalid;
    if (record.usedAt !== null) throw invalid;
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;

    await this.repo.updateUserPassword(record.userId, await hashPassword(newPassword));
    await this.repo.markResetTokenUsed(record.id);
    // Any other outstanding token for this account is now moot.
    await this.repo.invalidateResetTokens(record.userId);
    // And every open session dies with the old password.
    await this.repo.revokeAllRefreshTokens(record.userId);
  }
}

function toPublic(u: { id: string; email: string; name: string }): PublicUser {
  return { id: u.id, email: u.email, name: u.name };
}

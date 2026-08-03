import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createToken, type TokenPayload } from '../auth/tokens.js';
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
  token: string;
  user: PublicUser;
}

const MIN_PASSWORD_LENGTH = 8;
const RESET_TTL_MINUTES = 60;

/**
 * Reset tokens are high-entropy random values; only their SHA-256 hash is
 * stored. A plain hash (not scrypt) is right here: the token already has 256
 * bits of entropy, so it is not brute-forceable and needs no slow KDF.
 */
function hashResetToken(token: string): string {
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
    return { token: createToken(user), user: toPublic(user) };
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

    return { token: createToken(user), user: toPublic(user) };
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
    await this.repo.createResetToken(user.id, hashResetToken(token), expiresAt);

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

    const record = await this.repo.findResetToken(hashResetToken(token));
    if (!record) throw invalid;
    if (record.usedAt !== null) throw invalid;
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;

    await this.repo.updateUserPassword(record.userId, await hashPassword(newPassword));
    await this.repo.markResetTokenUsed(record.id);
    // Any other outstanding token for this account is now moot.
    await this.repo.invalidateResetTokens(record.userId);
  }
}

function toPublic(u: { id: string; email: string; name: string }): PublicUser {
  return { id: u.id, email: u.email, name: u.name };
}

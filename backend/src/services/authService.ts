import { hashPassword, verifyPassword } from '../auth/password.js';
import { createToken } from '../auth/tokens.js';
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

export class AuthService {
  constructor(private readonly repo: UserRepository) {}

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
}

function toPublic(u: { id: string; email: string; name: string }): PublicUser {
  return { id: u.id, email: u.email, name: u.name };
}

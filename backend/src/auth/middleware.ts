import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type TokenPayload } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Attach req.userId when a valid token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearer(req);
  if (token) {
    const payload = verifyToken(token);
    if (payload) req.userId = payload.sub;
  }
  next();
}

/** Something that can vouch a still-valid signature belongs to a live session. */
export interface SessionValidator {
  isSessionValid(payload: TokenPayload): Promise<boolean>;
}

/**
 * Reject the request unless a valid token is present.
 *
 * Beyond signature and expiry, the session is checked against the account's
 * last password change — otherwise a password reset would leave the old
 * session usable for up to the token's lifetime, defeating the point of
 * resetting. That costs one user lookup per authenticated request.
 */
export function makeRequireAuth(validator: SessionValidator) {
  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const token = bearer(req);
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    validator
      .isSessionValid(payload)
      .then((ok) => {
        if (!ok) {
          res.status(401).json({ error: 'Session is no longer valid' });
          return;
        }
        req.userId = payload.sub;
        next();
      })
      .catch(next);
  };
}

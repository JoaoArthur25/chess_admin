import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './tokens.js';

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

/** Reject the request unless a valid token is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearer(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.userId = payload.sub;
  next();
}

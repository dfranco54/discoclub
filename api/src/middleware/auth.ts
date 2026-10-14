import type { NextFunction, Request, Response } from 'express';
import { type AuthClaims, verifyAccessToken } from '../lib/jwt.js';
import type { Role } from '../modules/users/users.repository.js';

export const ACCESS_COOKIE = 'access_token';

// Teach TypeScript that authenticated requests carry `req.auth`
declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

// 401 = "I don't know who you are". Runs BEFORE any role check.
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== 'string') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let claims: AuthClaims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    // Same answer for expired, tampered or malformed: don't help an attacker
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.auth = claims;
  next();
}

// 403 = "I know who you are, but you're not allowed". Use AFTER authenticate.
export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      // Defensive: means authenticate was forgotten on this route
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
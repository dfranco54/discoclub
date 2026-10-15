import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

export interface AuthLimiters {
  login: RequestHandler;
  register: RequestHandler;
}

// For tests that aren't about rate limiting: lets every request through
const passthrough: RequestHandler = (_req, _res, next) => next();
export const noLimiters: AuthLimiters = { login: passthrough, register: passthrough };

const common = {
  standardHeaders: 'draft-7', // RateLimit headers so clients know their quota
  legacyHeaders: false, // no old X-RateLimit-* headers
  message: { error: 'Too many requests, please try again later' },
} as const;

// Each call creates fresh limiters with fresh counters, which keeps tests isolated.
// Counters live in memory: fine for one instance, but they reset on restart and
// aren't shared between instances (a Redis store would fix that later).
export function createAuthLimiters(
  overrides: { loginLimit?: number; registerLimit?: number } = {},
): AuthLimiters {
  return {
    login: rateLimit({
      ...common,
      windowMs: 15 * 60 * 1000,
      limit: overrides.loginLimit ?? 10,
      // Only failed attempts (status >= 400) count, so normal users aren't penalized
      skipSuccessfulRequests: true,
    }),
    register: rateLimit({
      ...common,
      windowMs: 60 * 60 * 1000,
      limit: overrides.registerLimit ?? 10,
    }),
  };
}
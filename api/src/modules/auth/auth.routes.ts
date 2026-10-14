import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config.js';
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from '../../lib/jwt.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { ACCESS_COOKIE, authenticate } from '../../middleware/auth.js';
import { createUser, findUserByEmail, findUserById } from '../users/users.repository.js';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // No min length here: we don't reveal password rules to someone guessing
  password: z.string().min(1).max(128),
});

// A real hash of a throwaway password. When the email doesn't exist we still
// verify against it, so the response time is the same either way and an
// attacker can't discover which emails are registered by measuring timing.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing-equalization');

// httpOnly: JavaScript in the page can't read the cookie (limits XSS damage)
// secure:   only sent over HTTPS (enabled in production)
// sameSite: lax means the browser won't send it on cross-site POST requests (CSRF)
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const;

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await hashPassword(input.password);
  const user = await createUser({
    email: input.email,
    passwordHash,
    name: input.name,
  });
  res.status(201).json({ user });
});

authRouter.post('/login', async (req, res) => {
  const input = loginSchema.parse(req.body);

  const user = await findUserByEmail(input.email);
  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_HASH, input.password);

  if (!user || !passwordOk) {
    // One generic message for "no such email" and "wrong password"
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = await signAccessToken(user);
  res.cookie(ACCESS_COOKIE, token, {
    ...cookieOptions,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000, // maxAge is in milliseconds
  });

  // Strip the hash before responding
  const { passwordHash: _omitted, ...publicUser } = user;
  res.json({ user: publicUser });
});

authRouter.get('/me', authenticate, async (req, res) => {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // The token says who you were when you logged in; the database says who
  // you are now (e.g. the account may have been deleted).
  const user = await findUserById(req.auth.sub);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.status(204).end();
});
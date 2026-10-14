import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db/pool.js';

const app = buildApp();
const credentials = { email: 'ana@test.com', password: 'correct-horse-battery', name: 'Ana' };

async function registerUser(role?: 'STAFF' | 'ADMIN'): Promise<void> {
  await request(app).post('/auth/register').send(credentials);
  if (role) {
    await pool.query('UPDATE users SET role = $1 WHERE email = $2', [role, credentials.email]);
  }
}

// Logs in and returns the raw token from the Set-Cookie header
async function loginAndGetToken(): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ email: credentials.email, password: credentials.password });
  const match = /access_token=([^;]+)/.exec((res.get('Set-Cookie') ?? []).join('; '));
  if (!match?.[1]) throw new Error('Login did not set the access_token cookie');
  return match[1];
}

// Builds a token like ours, with full control over secret and timestamps
async function forgeToken(opts: { secret: string; issuedAt: number; expiresAt: number }, sub: string) {
  return new SignJWT({ role: 'ADMIN' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('discoclub')
    .setIssuedAt(opts.issuedAt)
    .setExpirationTime(opts.expiresAt)
    .sign(new TextEncoder().encode(opts.secret));
}

beforeEach(async () => {
  await pool.query('TRUNCATE users');
});

afterAll(async () => {
  await pool.end();
});

describe('POST /auth/login', () => {
  it('logs in and sets an httpOnly, SameSite=Lax cookie', async () => {
    await registerUser();

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ANA@test.com', password: credentials.password });

    const cookie = (res.get('Set-Cookie') ?? []).join('; ');
    expect(res.status).toBe(200);
    expect(cookie).toMatch(/access_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(res.body.user.email).toBe('ana@test.com');
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it('gives the exact same 401 for a wrong password and an unknown email', async () => {
    await registerUser();

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password-123' });
    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@test.com', password: 'whatever-123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('returns 400 for a malformed body', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'nope' });

    expect(res.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('returns 401 without a cookie', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(401);
  });

  it('returns the current user after login', async () => {
    await registerUser();
    const agent = request.agent(app); // keeps cookies between requests
    await agent.post('/auth/login').send({ email: credentials.email, password: credentials.password });

    const res = await agent.get('/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ana@test.com');
  });

  it('rejects garbage, tampered, wrong-secret and expired tokens', async () => {
    await registerUser();
    const token = await loginAndGetToken();
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users');
    const userId = rows[0]!.id;
    const now = Math.floor(Date.now() / 1000);

    const badTokens = {
      garbage: 'not-a-jwt',
      // Flip the start of the signature (the end of the token can be a no-op)
      tamperedSignature: token.replace(/\.([^.]{2})([^.]*)$/, (_m, a: string, b: string) =>
        `.${a === 'AA' ? 'BB' : 'AA'}${b}`,
      ),
      wrongSecret: await forgeToken(
        { secret: 'a-completely-different-secret-0123456789', issuedAt: now, expiresAt: now + 900 },
        userId,
      ),
      expired: await forgeToken(
        { secret: config.JWT_SECRET, issuedAt: now - 3600, expiresAt: now - 1800 },
        userId,
      ),
    };

    for (const [label, bad] of Object.entries(badTokens)) {
      const res = await request(app).get('/auth/me').set('Cookie', `access_token=${bad}`);
      expect(res.status, label).toBe(401);
    }
  });

  it('returns 401 if the user was deleted after the token was issued', async () => {
    await registerUser();
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: credentials.email, password: credentials.password });
    await pool.query('DELETE FROM users');

    const res = await agent.get('/auth/me');

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears the cookie so the session is gone', async () => {
    await registerUser();
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: credentials.email, password: credentials.password });

    const logout = await agent.post('/auth/logout');
    const me = await agent.get('/auth/me');

    expect(logout.status).toBe(204);
    expect(me.status).toBe(401);
  });
});

describe('role protection (GET /admin/ping)', () => {
  it('401 without authentication', async () => {
    const res = await request(app).get('/admin/ping');

    expect(res.status).toBe(401);
  });

  it('403 for a CUSTOMER', async () => {
    await registerUser();
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: credentials.email, password: credentials.password });

    const res = await agent.get('/admin/ping');

    expect(res.status).toBe(403);
  });

  it('200 for an ADMIN', async () => {
    await registerUser('ADMIN');
    const agent = request.agent(app);
    await agent.post('/auth/login').send({ email: credentials.email, password: credentials.password });

    const res = await agent.get('/admin/ping');

    expect(res.status).toBe(200);
  });
});
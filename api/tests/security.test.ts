import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { createAuthLimiters } from '../src/middleware/rate-limit.js';

beforeEach(async () => {
  await pool.query('TRUNCATE users');
});

afterAll(async () => {
  await pool.end();
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework', async () => {
    const res = await request(buildApp()).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('blocks login after too many failed attempts', async () => {
    const app = buildApp({ authLimiters: createAuthLimiters({ loginLimit: 3 }) });
    const attempt = () =>
      request(app).post('/auth/login').send({ email: 'nobody@test.com', password: 'wrong-password' });

    for (let i = 0; i < 3; i++) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many/i);
  });

  it('does not count successful logins against the limit', async () => {
    const app = buildApp({ authLimiters: createAuthLimiters({ loginLimit: 2, registerLimit: 100 }) });
    const credentials = { email: 'ana@test.com', password: 'correct-horse-battery' };
    await request(app).post('/auth/register').send({ ...credentials, name: 'Ana' });

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/auth/login').send(credentials);
      expect(res.status).toBe(200);
    }
  });

  it('limits account creation', async () => {
    const app = buildApp({ authLimiters: createAuthLimiters({ registerLimit: 2 }) });
    const register = (n: number) =>
      request(app)
        .post('/auth/register')
        .send({ email: `user${n}@test.com`, password: 'correct-horse-battery', name: 'User' });

    expect((await register(1)).status).toBe(201);
    expect((await register(2)).status).toBe(201);
    expect((await register(3)).status).toBe(429);
  });
});
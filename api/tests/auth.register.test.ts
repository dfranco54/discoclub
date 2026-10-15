import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { verifyPassword } from '../src/lib/password.js';
import { findUserByEmail } from '../src/modules/users/users.repository.js';
import { noLimiters } from '../src/middleware/rate-limit.js';

const app = buildApp({ authLimiters: noLimiters });
const valid = { email: 'ana@test.com', password: 'correct-horse-battery', name: 'Ana' };

beforeEach(async () => {
  await pool.query('TRUNCATE users');
});

afterAll(async () => {
  await pool.end();
});

describe('POST /auth/register', () => {
  it('creates the user and never returns the password or its hash', async () => {
    const res = await request(app).post('/auth/register').send(valid);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'ana@test.com', name: 'Ana', role: 'CUSTOMER' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('stores an argon2 hash, not the plain password', async () => {
    await request(app).post('/auth/register').send(valid);

    const stored = await findUserByEmail('ana@test.com');

    expect(stored?.passwordHash).not.toBe(valid.password);
    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored!.passwordHash, valid.password)).toBe(true);
  });

  it('normalizes the email (trim + lowercase)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, email: '  Ana@Test.COM ' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('ana@test.com');
  });

  it('ignores a "role" sent by the client (no privilege escalation)', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, role: 'ADMIN' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
  });

  it('returns 409 when the email is already registered', async () => {
    await request(app).post('/auth/register').send(valid);

    const res = await request(app)
      .post('/auth/register')
      .send({ ...valid, email: 'ANA@test.com' });

    expect(res.status).toBe(409);
  });

  it.each([
    ['invalid email', { ...valid, email: 'not-an-email' }],
    ['short password', { ...valid, password: '1234567' }],
    ['empty name', { ...valid, name: '   ' }],
    ['missing fields', {}],
    ['wrong types', { email: 123, password: true, name: [] }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await request(app).post('/auth/register').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await request(app)
      .post('/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email": ');

    expect(res.status).toBe(400);
  });
});
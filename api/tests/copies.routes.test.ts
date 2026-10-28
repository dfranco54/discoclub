import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { noLimiters } from '../src/middleware/rate-limit.js';
import { upsertMovies } from '../src/modules/movies/movies.repository.js';

const app = buildApp({ authLimiters: noLimiters });
const password = 'correct-horse-battery';

// Registers a user, sets its role, and logs in.
// The role is set BEFORE logging in because the role travels inside the token.
async function agentWithRole(role: 'CUSTOMER' | 'STAFF' | 'ADMIN') {
  const email = `${role.toLowerCase()}@test.com`;
  await request(app).post('/auth/register').send({ email, password, name: role });
  await pool.query('UPDATE users SET role = $1 WHERE email = $2', [role, email]);
  const agent = request.agent(app); // keeps the cookie between requests
  await agent.post('/auth/login').send({ email, password });
  return agent;
}

beforeEach(async () => {
  await pool.query('TRUNCATE users, movies CASCADE');
  await upsertMovies([
    {
      slug: 'alpha',
      title: 'Alpha',
      overview: 'About Alpha.',
      releaseYear: 2000,
      director: 'Some Director',
      genres: ['Drama'],
    },
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe('access control', () => {
  const routes = [
    ['post', '/movies/alpha/copies', { format: 'DVD' }],
    ['get', '/movies/alpha/copies', undefined],
    ['patch', `/copies/${randomUUID()}`, { status: 'RETIRED' }],
  ] as const;

  it.each(routes)('%s %s requires authentication', async (method, path, body) => {
    const res = await request(app)[method](path).send(body);

    expect(res.status).toBe(401);
  });

  it.each(routes)('%s %s is forbidden for a CUSTOMER', async (method, path, body) => {
    const customer = await agentWithRole('CUSTOMER');

    const res = await customer[method](path).send(body);

    expect(res.status).toBe(403);
  });
});

describe('POST /movies/:slug/copies', () => {
  it.each(['STAFF', 'ADMIN'] as const)('%s can add several copies at once', async (role) => {
    const agent = await agentWithRole(role);

    const res = await agent.post('/movies/alpha/copies').send({ format: 'BLURAY', quantity: 3 });

    expect(res.status).toBe(201);
    expect(res.body.copies).toEqual(
      Array(3).fill(expect.objectContaining({ format: 'BLURAY', status: 'ACTIVE' })),
    );
    // The public catalog reflects the new copies
    const detail = await request(app).get('/movies/alpha');
    expect(detail.body.movie.activeCopies).toBe(3);
  });

  it('adds a single copy when no quantity is given', async () => {
    const staff = await agentWithRole('STAFF');

    const res = await staff.post('/movies/alpha/copies').send({ format: 'DVD' });

    expect(res.status).toBe(201);
    expect(res.body.copies).toHaveLength(1);
  });

  it.each([
    ['an unknown format', { format: 'VHS' }],
    ['a quantity of zero', { format: 'DVD', quantity: 0 }],
    ['a quantity above the cap', { format: 'DVD', quantity: 21 }],
    ['a fractional quantity', { format: 'DVD', quantity: 1.5 }],
    ['a missing format', { quantity: 2 }],
  ])('returns 400 for %s', async (_label, body) => {
    const staff = await agentWithRole('STAFF');

    const res = await staff.post('/movies/alpha/copies').send(body);

    expect(res.status).toBe(400);
  });

  it('creates nothing when the movie does not exist', async () => {
    const staff = await agentWithRole('STAFF');

    const res = await staff.post('/movies/ghost/copies').send({ format: 'DVD' });

    expect(res.status).toBe(404);
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM copies');
    expect(rows[0]?.n).toBe(0);
  });
});

describe('GET /movies/:slug/copies', () => {
  it('lists every copy, including retired ones', async () => {
    const staff = await agentWithRole('STAFF');
    const created = await staff.post('/movies/alpha/copies').send({ format: 'DVD', quantity: 2 });
    await staff.patch(`/copies/${created.body.copies[0].id}`).send({ status: 'RETIRED' });

    const res = await staff.get('/movies/alpha/copies');

    expect(res.status).toBe(200);
    expect(res.body.copies).toHaveLength(2);
    expect(res.body.copies.map((c: { status: string }) => c.status).sort()).toEqual([
      'ACTIVE',
      'RETIRED',
    ]);
  });

  it('returns an empty list for a movie without copies, and 404 for an unknown movie', async () => {
    const staff = await agentWithRole('STAFF');

    const empty = await staff.get('/movies/alpha/copies');
    const unknown = await staff.get('/movies/ghost/copies');

    expect(empty.status).toBe(200);
    expect(empty.body.copies).toEqual([]);
    expect(unknown.status).toBe(404);
  });
});

describe('PATCH /copies/:id', () => {
  it('retires a copy instead of deleting it, and can reinstate it', async () => {
    const staff = await agentWithRole('STAFF');
    const created = await staff.post('/movies/alpha/copies').send({ format: 'DVD', quantity: 2 });
    const id: string = created.body.copies[0].id;

    const retired = await staff.patch(`/copies/${id}`).send({ status: 'RETIRED' });

    expect(retired.status).toBe(200);
    expect(retired.body.copy).toMatchObject({ id, status: 'RETIRED' });
    // History is preserved: the row still exists, it just doesn't count as active
    const { rowCount } = await pool.query('SELECT 1 FROM copies WHERE id = $1', [id]);
    expect(rowCount).toBe(1);
    expect((await request(app).get('/movies/alpha')).body.movie.activeCopies).toBe(1);

    await staff.patch(`/copies/${id}`).send({ status: 'ACTIVE' });

    expect((await request(app).get('/movies/alpha')).body.movie.activeCopies).toBe(2);
  });

  it('returns 404 for an unknown copy', async () => {
    const staff = await agentWithRole('STAFF');

    const res = await staff.patch(`/copies/${randomUUID()}`).send({ status: 'RETIRED' });

    expect(res.status).toBe(404);
  });

  it.each([
    ['a malformed id', '/copies/not-a-uuid', { status: 'RETIRED' }],
    ['an invalid status', `/copies/${randomUUID()}`, { status: 'LOST' }],
    ['a missing body', `/copies/${randomUUID()}`, undefined],
  ])('returns 400 for %s', async (_label, path, body) => {
    const staff = await agentWithRole('STAFF');

    const res = await staff.patch(path).send(body);

    expect(res.status).toBe(400);
  });
});
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';
import { type MovieInput, upsertMovies } from '../src/modules/movies/movies.repository.js';

const app = buildApp();

const movie = (slug: string, title: string, overrides: Partial<MovieInput> = {}): MovieInput => ({
  slug,
  title,
  overview: `About ${title}.`,
  releaseYear: 2000,
  director: 'Some Director',
  genres: ['Drama'],
  ...overrides,
});

const fixtures: MovieInput[] = [
  movie('alpha', 'Alpha', { director: 'Ann Lee', genres: ['Drama'] }),
  movie('bravo', 'Bravo', { director: 'Bob Ray', genres: ['Comedy', 'Drama'] }),
  movie('charlie', 'Charlie', { director: 'Ann Lee', genres: ['Horror'] }),
  movie('delta', 'Delta', { director: 'Dan Fox', genres: ['Comedy'] }),
  movie('echo-100', 'Echo 100%', { director: 'Eve Kim', genres: ['Drama'] }),
  movie('foxtrot-1000', 'Foxtrot 1000', { director: 'Finn Roy', genres: ['Thriller'] }),
];

const slugsOf = (body: { movies: { slug: string }[] }): string[] => body.movies.map((m) => m.slug);

beforeEach(async () => {
  await pool.query('TRUNCATE movies CASCADE');
  await upsertMovies(fixtures);
});

afterAll(async () => {
  await pool.end();
});

describe('GET /movies', () => {
  it('lists movies alphabetically and exposes only public fields', async () => {
    const res = await request(app).get('/movies');

    expect(res.status).toBe(200);
    expect(slugsOf(res.body)).toEqual([
      'alpha',
      'bravo',
      'charlie',
      'delta',
      'echo-100',
      'foxtrot-1000',
    ]);
    expect(res.body.nextCursor).toBeNull();
    expect(Object.keys(res.body.movies[0]).sort()).toEqual([
      'director',
      'genres',
      'releaseYear',
      'slug',
      'title',
    ]);
  });

  it('paginates with a cursor, without gaps or repeats', async () => {
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const res: request.Response = await request(app)
        .get('/movies')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      collected.push(...slugsOf(res.body));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(collected).toEqual(fixtures.map((f) => f.slug));
  });

  it('pages correctly through movies that share the same title', async () => {
    await upsertMovies([movie('twin-a', 'Twin'), movie('twin-b', 'Twin')]);
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const res: request.Response = await request(app)
        .get('/movies')
        .query({ limit: 1, ...(cursor ? { cursor } : {}) });
      collected.push(...slugsOf(res.body));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    // The slug tie-breaker means no twin is skipped or repeated
    expect(collected).toHaveLength(8);
    expect(new Set(collected).size).toBe(8);
    expect(collected).toContain('twin-a');
    expect(collected).toContain('twin-b');
  });

  it('searches title and director, ignoring case', async () => {
    const byDirector = await request(app).get('/movies').query({ q: 'ann' });
    const byTitle = await request(app).get('/movies').query({ q: 'ALPHA' });

    expect(slugsOf(byDirector.body)).toEqual(['alpha', 'charlie']);
    expect(slugsOf(byTitle.body)).toEqual(['alpha']);
  });

  it('treats % and _ in the search as literal characters', async () => {
    // Unescaped, "%" would match every movie
    const res = await request(app).get('/movies').query({ q: '%' });

    expect(slugsOf(res.body)).toEqual(['echo-100']);
  });

  it('filters by genre and combines filters', async () => {
    const comedy = await request(app).get('/movies').query({ genre: 'Comedy' });
    const combined = await request(app).get('/movies').query({ q: 'ann', genre: 'Drama' });

    expect(slugsOf(comedy.body)).toEqual(['bravo', 'delta']);
    expect(slugsOf(combined.body)).toEqual(['alpha']);
  });

  it('ignores empty filters', async () => {
    const res = await request(app).get('/movies').query({ q: '', genre: '' });

    expect(res.body.movies).toHaveLength(6);
  });

  it('is safe against SQL injection attempts', async () => {
    const res = await request(app).get('/movies').query({ q: "'; DROP TABLE movies; --" });

    expect(res.status).toBe(200);
    expect(res.body.movies).toEqual([]);
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM movies');
    expect(rows[0]?.count).toBe('6');
  });

  it.each([
    ['limit below 1', { limit: 0 }],
    ['limit above the cap', { limit: 51 }],
    ['non-numeric limit', { limit: 'abc' }],
    ['a garbage cursor', { cursor: 'not-a-real-cursor' }],
  ])('returns 400 for %s', async (_label, query) => {
    const res = await request(app).get('/movies').query(query);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

describe('GET /movies/:slug', () => {
  it('returns the movie with its count of active copies', async () => {
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM movies WHERE slug = 'alpha'`);
    const movieId = rows[0]!.id;
    await pool.query(
      `INSERT INTO copies (movie_id, format, status) VALUES
         ($1, 'DVD', 'ACTIVE'), ($1, 'BLURAY', 'ACTIVE'), ($1, 'DVD', 'RETIRED')`,
      [movieId],
    );

    const res = await request(app).get('/movies/alpha');

    expect(res.status).toBe(200);
    expect(res.body.movie).toMatchObject({
      slug: 'alpha',
      title: 'Alpha',
      overview: 'About Alpha.',
      activeCopies: 2, // the retired copy doesn't count
    });
  });

  it('reports zero copies for a movie without any', async () => {
    const res = await request(app).get('/movies/bravo');

    expect(res.body.movie.activeCopies).toBe(0);
  });

  it('returns 404 for an unknown movie', async () => {
    const res = await request(app).get('/movies/does-not-exist');

    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed slug', async () => {
    const res = await request(app).get('/movies/NOT-VALID');

    expect(res.status).toBe(400);
  });
});
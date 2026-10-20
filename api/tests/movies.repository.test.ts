import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { type MovieInput, upsertMovies } from '../src/modules/movies/movies.repository.js';
import { loadSeedMovies } from '../src/modules/movies/movies.seed.js';

const movie = (overrides: Partial<MovieInput> = {}): MovieInput => ({
  slug: 'test-movie',
  title: 'Test Movie',
  overview: 'A test.',
  releaseYear: 2000,
  director: 'Someone',
  genres: ['Drama', 'Comedy'],
  ...overrides,
});

const countMovies = async (): Promise<number> => {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM movies');
  return Number(rows[0]!.count); // pg returns bigint counts as strings
};

beforeEach(async () => {
  await pool.query('TRUNCATE movies CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('upsertMovies', () => {
  it('stores every field, including the genres array', async () => {
    await upsertMovies([movie()]);

    const { rows } = await pool.query<{
      slug: string;
      title: string;
      release_year: number | null;
      director: string | null;
      genres: string[];
    }>('SELECT slug, title, release_year, director, genres FROM movies');

    expect(rows).toEqual([
      {
        slug: 'test-movie',
        title: 'Test Movie',
        release_year: 2000,
        director: 'Someone',
        genres: ['Drama', 'Comedy'],
      },
    ]);
  });

  it('is idempotent: running twice never duplicates, and it refreshes changed data', async () => {
    await upsertMovies([movie()]);
    await upsertMovies([movie({ title: 'Corrected Title', genres: ['Thriller'] })]);

    const { rows } = await pool.query<{ title: string; genres: string[] }>(
      'SELECT title, genres FROM movies',
    );

    expect(rows).toEqual([{ title: 'Corrected Title', genres: ['Thriller'] }]);
  });

  it('is atomic: if one movie is rejected, none of the batch is saved', async () => {
    const batch = [movie({ slug: 'good-movie' }), movie({ slug: 'BAD SLUG' })];

    await expect(upsertMovies(batch)).rejects.toThrow(/movies_slug_format/);

    expect(await countMovies()).toBe(0);
  });

  it('loads the real seed file idempotently', async () => {
    const seed = await loadSeedMovies();

    await upsertMovies(seed);
    await upsertMovies(seed);

    expect(await countMovies()).toBe(seed.length);
  });
});
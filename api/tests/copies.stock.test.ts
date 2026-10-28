import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { ensureStock } from '../src/modules/copies/copies.stock.js';
import { upsertMovies } from '../src/modules/movies/movies.repository.js';

const movie = (slug: string) => ({
  slug,
  title: slug,
  overview: null,
  releaseYear: 2000,
  director: null,
  genres: [],
});

const countCopies = async (): Promise<number> => {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM copies');
  return rows[0]!.n;
};

beforeEach(async () => {
  await pool.query('TRUNCATE movies CASCADE');
  await upsertMovies([movie('one'), movie('two')]);
});

afterAll(async () => {
  await pool.end();
});

describe('ensureStock', () => {
  it('creates the planned copies', async () => {
    const created = await ensureStock([
      { slug: 'one', format: 'DVD', quantity: 2 },
      { slug: 'two', format: 'BLURAY', quantity: 1 },
    ]);

    expect(created).toBe(3);
    expect(await countCopies()).toBe(3);
  });

  it('is idempotent: running it twice creates nothing the second time', async () => {
    const plan = [{ slug: 'one', format: 'DVD', quantity: 2 }] as const;

    await ensureStock([...plan]);
    const second = await ensureStock([...plan]);

    expect(second).toBe(0);
    expect(await countCopies()).toBe(2);
  });

  it('only tops up: it never removes copies that already exist', async () => {
    await ensureStock([{ slug: 'one', format: 'DVD', quantity: 3 }]);

    const created = await ensureStock([{ slug: 'one', format: 'DVD', quantity: 1 }]);

    expect(created).toBe(0);
    expect(await countCopies()).toBe(3);
  });

  it('replaces retired copies, because only ACTIVE ones count', async () => {
    await ensureStock([{ slug: 'one', format: 'DVD', quantity: 1 }]);
    await pool.query(`UPDATE copies SET status = 'RETIRED'`);

    const created = await ensureStock([{ slug: 'one', format: 'DVD', quantity: 1 }]);

    expect(created).toBe(1);
  });

  it('fails without creating anything when a movie in the plan does not exist', async () => {
    await expect(
      ensureStock([
        { slug: 'one', format: 'DVD', quantity: 1 },
        { slug: 'ghost', format: 'DVD', quantity: 1 },
      ]),
    ).rejects.toThrow(/Unknown movies.*ghost/);

    expect(await countCopies()).toBe(0);
  });
});
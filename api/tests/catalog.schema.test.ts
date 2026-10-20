import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';

async function insertMovie(slug: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO movies (slug, title) VALUES ($1, 'Test movie') RETURNING id`,
    [slug],
  );
  return rows[0]!.id;
}

beforeEach(async () => {
  await pool.query('TRUNCATE movies CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('catalog schema constraints', () => {
  it('rejects two movies with the same slug', async () => {
    await insertMovie('same-slug');

    await expect(insertMovie('same-slug')).rejects.toThrow(/movies_slug_key/);
  });

  it('rejects slugs that are not lowercase-hyphenated', async () => {
    await expect(insertMovie('Not A Slug')).rejects.toThrow(/movies_slug_format/);
  });

  it('rejects a copy that points to a movie that does not exist', async () => {
    await expect(
      pool.query(`INSERT INTO copies (movie_id, format) VALUES ($1, 'DVD')`, [randomUUID()]),
    ).rejects.toThrow(/copies_movie_id_fkey/);
  });

  it('does not allow deleting a movie that still has copies', async () => {
    const movieId = await insertMovie('has-copies');
    await pool.query(`INSERT INTO copies (movie_id, format) VALUES ($1, 'BLURAY')`, [movieId]);

    await expect(pool.query('DELETE FROM movies WHERE id = $1', [movieId])).rejects.toThrow(
      /copies_movie_id_fkey/,
    );
  });
});
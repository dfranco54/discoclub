import { pool } from '../../db/pool.js';
import type { CopyFormat } from './copies.repository.js';

export interface StockItem {
  slug: string;
  format: CopyFormat;
  quantity: number;
}

// Makes sure each movie has AT LEAST `quantity` ACTIVE copies of the given format.
// It only tops up: it never deletes copies, and running it twice changes nothing.
// Returns how many copies were created.
export async function ensureStock(plan: StockItem[]): Promise<number> {
  const slugs = [...new Set(plan.map((item) => item.slug))];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fail early, with a useful hint, if the catalog hasn't been loaded
    const { rows } = await client.query<{ slug: string }>(
      'SELECT slug FROM movies WHERE slug = ANY($1::text[])',
      [slugs],
    );
    const found = new Set(rows.map((row) => row.slug));
    const missing = slugs.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      throw new Error(
        `Unknown movies in the stock plan: ${missing.join(', ')}. Did you run "npm run catalog:seed"?`,
      );
    }

    let created = 0;
    for (const item of plan) {
      // generate_series(1, n) with n <= 0 yields no rows, so a movie that already
      // has enough ACTIVE copies gets nothing new.
      const { rowCount } = await client.query(
        `INSERT INTO copies (movie_id, format)
         SELECT m.id, $2::copy_format
         FROM movies m
         CROSS JOIN generate_series(1, $3::int - (
           SELECT count(*)::int
           FROM copies c
           WHERE c.movie_id = m.id AND c.format = $2::copy_format AND c.status = 'ACTIVE'
         ))
         WHERE m.slug = $1`,
        [item.slug, item.format, item.quantity],
      );
      created += rowCount ?? 0;
    }

    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
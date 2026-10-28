import { pool } from '../../db/pool.js';

export type CopyFormat = 'DVD' | 'BLURAY';
export type CopyStatus = 'ACTIVE' | 'RETIRED';

export interface Copy {
  id: string;
  format: CopyFormat;
  status: CopyStatus;
  createdAt: Date;
}

type CopyRow = { id: string; format: CopyFormat; status: CopyStatus; created_at: Date };

const toCopy = (row: CopyRow): Copy => ({
  id: row.id,
  format: row.format,
  status: row.status,
  createdAt: row.created_at,
});

// Creates `quantity` copies in ONE statement (atomic: all or none).
// generate_series produces N rows per matching movie; if the slug doesn't
// exist the SELECT yields zero rows, so nothing is inserted and we return null.
export async function createCopies(
  movieSlug: string,
  format: CopyFormat,
  quantity: number,
): Promise<Copy[] | null> {
  const { rows } = await pool.query<CopyRow>(
    `INSERT INTO copies (movie_id, format)
     SELECT m.id, $2::copy_format
     FROM movies m
     CROSS JOIN generate_series(1, $3::int)
     WHERE m.slug = $1
     RETURNING id, format, status, created_at`,
    [movieSlug, format, quantity],
  );

  return rows.length > 0 ? rows.map(toCopy) : null;
}

// null  -> the movie doesn't exist
// []    -> the movie exists but has no copies
// The LEFT JOIN is what lets one query tell those two cases apart.
export async function listCopiesByMovieSlug(movieSlug: string): Promise<Copy[] | null> {
  const { rows } = await pool.query<{
    id: string | null;
    format: CopyFormat | null;
    status: CopyStatus | null;
    created_at: Date | null;
  }>(
    `SELECT c.id, c.format, c.status, c.created_at
     FROM movies m
     LEFT JOIN copies c ON c.movie_id = m.id
     WHERE m.slug = $1
     ORDER BY c.created_at, c.id`,
    [movieSlug],
  );

  if (rows.length === 0) return null;

  return rows.flatMap((row) =>
    row.id && row.format && row.status && row.created_at
      ? [toCopy({ id: row.id, format: row.format, status: row.status, created_at: row.created_at })]
      : [],
  );
}

// Retiring is a status change, never a DELETE: history must survive.
// Idempotent: setting the status a copy already has simply returns it.
export async function setCopyStatus(id: string, status: CopyStatus): Promise<Copy | null> {
  const { rows } = await pool.query<CopyRow>(
    `UPDATE copies
     SET status = $2::copy_status
     WHERE id = $1
     RETURNING id, format, status, created_at`,
    [id, status],
  );

  const row = rows[0];
  return row ? toCopy(row) : null;
}
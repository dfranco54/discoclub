import { pool } from '../../db/pool.js';
import type { MovieCursor } from './cursor.js'; // put this import at the top of the file

export interface MovieInput {
  slug: string;
  title: string;
  overview: string | null;
  releaseYear: number | null;
  director: string | null;
  genres: string[];
}

// Inserts new movies and refreshes existing ones (matched by slug).
// All-or-nothing: if any movie fails, the whole batch is rolled back,
// so the catalog is never left half-loaded.
export async function upsertMovies(movies: MovieInput[]): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const movie of movies) {
      // Placeholders ($1...) only: values never get concatenated into the SQL
      await client.query(
        `INSERT INTO movies (slug, title, overview, release_year, director, genres)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET
           title        = EXCLUDED.title,
           overview     = EXCLUDED.overview,
           release_year = EXCLUDED.release_year,
           director     = EXCLUDED.director,
           genres       = EXCLUDED.genres,
           updated_at   = now()`,
        [movie.slug, movie.title, movie.overview, movie.releaseYear, movie.director, movie.genres],
      );
    }

    await client.query('COMMIT');
    return movies.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface MovieSummary {
  slug: string;
  title: string;
  releaseYear: number | null;
  director: string | null;
  genres: string[];
}

export interface MovieDetail extends MovieSummary {
  overview: string | null;
  // Copies in circulation. Real availability (not rented right now) arrives with rentals.
  activeCopies: number;
}

export interface ListMoviesParams {
  q?: string;
  genre?: string;
  limit: number;
  after?: MovieCursor;
}

type SummaryRow = {
  slug: string;
  title: string;
  release_year: number | null;
  director: string | null;
  genres: string[];
};

const toSummary = (row: SummaryRow): MovieSummary => ({
  slug: row.slug,
  title: row.title,
  releaseYear: row.release_year,
  director: row.director,
  genres: row.genres,
});

// "%" and "_" are wildcards in LIKE. Escape them (and the escape character itself)
// so that user input is always matched literally.
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

export async function listMovies(
  params: ListMoviesParams,
): Promise<{ movies: MovieSummary[]; hasMore: boolean }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  // Registers a value and returns its placeholder ($1, $2...).
  // The SQL text only ever contains fixed fragments plus placeholders, never user input:
  // that is how you build dynamic filters without opening the door to SQL injection.
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (params.q) {
    const pattern = bind(`%${escapeLike(params.q)}%`);
    conditions.push(`(title ILIKE ${pattern} OR director ILIKE ${pattern})`);
  }
  if (params.genre) {
    // Array containment: the movie's genres include this one
    conditions.push(`genres @> ${bind([params.genre])}::text[]`);
  }
  if (params.after) {
    // Row comparison: "everything after this (title, slug)", matching the ORDER BY below
    conditions.push(`(title, slug) > (${bind(params.after.title)}, ${bind(params.after.slug)})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  // Ask for one extra row to learn whether a next page exists, without a costly COUNT(*)
  const limit = bind(params.limit + 1);

  const { rows } = await pool.query<SummaryRow>(
    `SELECT slug, title, release_year, director, genres
     FROM movies
     ${where}
     ORDER BY title, slug
     LIMIT ${limit}`,
    values,
  );

  return {
    movies: rows.slice(0, params.limit).map(toSummary),
    hasMore: rows.length > params.limit,
  };
}

export async function findMovieBySlug(slug: string): Promise<MovieDetail | null> {
  const { rows } = await pool.query<
    SummaryRow & { overview: string | null; active_copies: number }
  >(
    `SELECT m.slug, m.title, m.overview, m.release_year, m.director, m.genres,
            (SELECT count(*)::int
               FROM copies c
              WHERE c.movie_id = m.id AND c.status = 'ACTIVE') AS active_copies
     FROM movies m
     WHERE m.slug = $1`,
    [slug],
  );

  const row = rows[0];
  if (!row) return null;
  return { ...toSummary(row), overview: row.overview, activeCopies: row.active_copies };
}
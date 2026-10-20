import { pool } from '../../db/pool.js';

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
import { pool } from '../db/pool.js';
import { upsertMovies } from '../modules/movies/movies.repository.js';
import { loadSeedMovies } from '../modules/movies/movies.seed.js';

// Usage: npm run catalog:seed   (safe to run as many times as you like)
try {
  const movies = await loadSeedMovies();
  const count = await upsertMovies(movies);
  console.log(`Seed complete: ${count} movies inserted or updated`);
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
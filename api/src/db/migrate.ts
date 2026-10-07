import { pool } from './pool.js';
import { runMigrations } from './migrator.js';

try {
  await runMigrations(pool);
  console.log('Migrations up to date');
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
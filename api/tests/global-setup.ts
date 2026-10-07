import pg from 'pg';
import { runMigrations } from '../src/db/migrator.js';
import { TEST_DATABASE_URL } from './config.js';

export async function setup(): Promise<void> {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);

  // Safety net: tests TRUNCATE tables, so they must never touch a real database.
  // The regex also makes the CREATE DATABASE below safe (identifiers can't be
  // parameterized, so we only accept plain lowercase names).
  if (!/^[a-z0-9_]+_test$/.test(dbName)) {
    throw new Error(`Refusing to run tests: "${dbName}" is not a *_test database`);
  }

  // 1. Connect to the maintenance database to create the test DB if missing
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName],
    );
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE ${dbName}`);
    }
  } finally {
    await admin.end();
  }

  // 2. Apply migrations to the test database
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
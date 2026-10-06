import 'dotenv/config';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    // Fail fast at startup instead of with a cryptic error on the first query
    throw new Error('DATABASE_URL is not set');
}

// One shared pool for the whole app: opening a connection per request is slow
export const pool = new pg.Pool({ connectionString, max: 10 });

// Without this handler, an error on an idle connection would crash the process
pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
});
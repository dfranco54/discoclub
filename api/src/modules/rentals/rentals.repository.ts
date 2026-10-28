import { pool } from '../../db/pool.js';
import type { CopyFormat } from '../copies/copies.repository.js';
import {
  MovieNotFoundError,
  NoCopyAvailableError,
  RentalAlreadyReturnedError,
  RentalLimitReachedError,
  RentalNotFoundError,
  UserNotFoundError,
} from './rentals.errors.js';

export const MAX_ACTIVE_RENTALS_PER_USER = 3;
export const RENTAL_PERIOD_DAYS = 3;

export interface Rental {
  id: string;
  movieSlug: string;
  movieTitle: string;
  copyId: string;
  format: CopyFormat;
  rentedAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  status: 'ACTIVE' | 'RETURNED';
  // Derived, never stored: an ACTIVE rental whose due date has passed
  overdue: boolean;
}

type RentalRow = {
  id: string;
  movie_slug: string;
  movie_title: string;
  copy_id: string;
  format: CopyFormat;
  rented_at: Date;
  due_at: Date;
  returned_at: Date | null;
  status: 'ACTIVE' | 'RETURNED';
  overdue: boolean;
};

export async function findRentalById(id: string): Promise<Rental | null> {
  const { rows } = await pool.query<RentalRow>(
    `SELECT r.id, m.slug AS movie_slug, m.title AS movie_title,
            c.id AS copy_id, c.format,
            r.rented_at, r.due_at, r.returned_at, r.status,
            (r.status = 'ACTIVE' AND r.due_at < now()) AS overdue
     FROM rentals r
     JOIN copies c ON c.id = r.copy_id
     JOIN movies m ON m.id = c.movie_id
     WHERE r.id = $1`,
    [id],
  );

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    movieSlug: row.movie_slug,
    movieTitle: row.movie_title,
    copyId: row.copy_id,
    format: row.format,
    rentedAt: row.rented_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    status: row.status,
    overdue: row.overdue,
  };
}

// Rents ONE available copy of a movie to a user, atomically.
//
// Defense in layers (see migration 004):
//   1. Row locks serialize competing transactions (this function)
//   2. A partial unique index makes a double rental of one copy impossible,
//      even if this code had a bug (the database)
//
// READ COMMITTED matters here: after a lock wait ends, the NEXT statement sees
// everything the previous transaction committed. So: lock first, check after.
export async function rentMovie(userId: string, movieSlug: string): Promise<Rental> {
  let rentalId: string;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock the USER row: this user's rentals are processed one at a time,
    //    so the per-user limit can't be bypassed with simultaneous requests.
    //    Lock order is always user -> movie, which rules out deadlocks.
    const user = await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (user.rowCount === 0) throw new UserNotFoundError();

    // 2. Lock the MOVIE row: rentals of the same movie queue up behind each other.
    //    This is what resolves the "last copy" race.
    const movie = await client.query<{ id: string }>(
      'SELECT id FROM movies WHERE slug = $1 FOR UPDATE',
      [movieSlug],
    );
    const movieId = movie.rows[0]?.id;
    if (!movieId) throw new MovieNotFoundError(movieSlug);

    // 3. Per-user limit (not expressible as a simple constraint, hence the user lock)
    const active = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rentals WHERE user_id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_RENTALS_PER_USER) {
      throw new RentalLimitReachedError(MAX_ACTIVE_RENTALS_PER_USER);
    }

    // 4. Find a copy that is in circulation and not currently rented.
    //    Availability is derived from rentals; it is never stored on the copy.
    //    ORDER BY makes the choice deterministic.
    const copy = await client.query<{ id: string }>(
      `SELECT c.id
       FROM copies c
       WHERE c.movie_id = $1
         AND c.status = 'ACTIVE'
         AND NOT EXISTS (
           SELECT 1 FROM rentals r WHERE r.copy_id = c.id AND r.status = 'ACTIVE'
         )
       ORDER BY c.created_at, c.id
       LIMIT 1`,
      [movieId],
    );
    const copyId = copy.rows[0]?.id;
    if (!copyId) throw new NoCopyAvailableError(movieSlug);

    // 5. Create the rental
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO rentals (user_id, copy_id, due_at)
       VALUES ($1, $2, now() + make_interval(days => $3::int))
       RETURNING id`,
      [userId, copyId, RENTAL_PERIOD_DAYS],
    );
    rentalId = inserted.rows[0]!.id;

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    // The connection goes back to the pool BEFORE the read below, so a burst of
    // concurrent rentals can never starve the pool of connections.
    client.release();
  }

  const rental = await findRentalById(rentalId);
  if (!rental) throw new Error('Rental disappeared right after being created');
  return rental;
}

// Registers the physical return of a rental.
// A single conditional UPDATE is atomic: of several simultaneous returns of the
// same rental, exactly one matches "status = ACTIVE"; the others update nothing.
export async function returnRental(rentalId: string): Promise<Rental> {
  const { rowCount } = await pool.query(
    `UPDATE rentals
     SET status = 'RETURNED', returned_at = now()
     WHERE id = $1 AND status = 'ACTIVE'`,
    [rentalId],
  );

  if (rowCount === 0) {
    // Nothing updated: either it doesn't exist or it was already returned
    const existing = await findRentalById(rentalId);
    if (!existing) throw new RentalNotFoundError(rentalId);
    throw new RentalAlreadyReturnedError(rentalId);
  }

  const rental = await findRentalById(rentalId);
  if (!rental) throw new Error('Rental disappeared right after being returned');
  return rental;
}
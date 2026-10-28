import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import { createCopies } from '../src/modules/copies/copies.repository.js';
import { upsertMovies } from '../src/modules/movies/movies.repository.js';
import {
  MovieNotFoundError,
  NoCopyAvailableError,
  RentalAlreadyReturnedError,
  RentalLimitReachedError,
  RentalNotFoundError,
  UserNotFoundError,
} from '../src/modules/rentals/rentals.errors.js';
import {
  findRentalById,
  MAX_ACTIVE_RENTALS_PER_USER,
  rentMovie,
  returnRental,
} from '../src/modules/rentals/rentals.repository.js';
import { createUser, type User } from '../src/modules/users/users.repository.js';

let userCounter = 0;

async function newUser(): Promise<User> {
  userCounter++;
  return createUser({
    email: `user${userCounter}@test.com`,
    passwordHash: 'not-a-real-hash',
    name: `User ${userCounter}`,
  });
}

async function newUsers(count: number): Promise<User[]> {
  const users: User[] = [];
  for (let i = 0; i < count; i++) users.push(await newUser());
  return users;
}

async function newMovie(slug: string, copies = 1): Promise<void> {
  await upsertMovies([
    { slug, title: slug, overview: null, releaseYear: 2000, director: null, genres: [] },
  ]);
  if (copies > 0) await createCopies(slug, 'DVD', copies);
}

const fulfilledValues = <T>(results: PromiseSettledResult<T>[]): T[] =>
  results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

const rejectedReasons = (results: PromiseSettledResult<unknown>[]): unknown[] =>
  results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));

const countActiveRentals = async (): Promise<number> => {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM rentals WHERE status = 'ACTIVE'`,
  );
  return rows[0]!.n;
};

beforeEach(async () => {
  await pool.query('TRUNCATE users, movies CASCADE');
});

afterAll(async () => {
  await pool.end();
});

describe('rentMovie', () => {
  it('rents an available copy and sets the due date', async () => {
    await newMovie('alpha');
    const user = await newUser();

    const rental = await rentMovie(user.id, 'alpha');

    expect(rental).toMatchObject({
      movieSlug: 'alpha',
      format: 'DVD',
      status: 'ACTIVE',
      returnedAt: null,
      overdue: false,
    });
    const hours = (rental.dueAt.getTime() - rental.rentedAt.getTime()) / 3_600_000;
    expect(Math.abs(hours - 72)).toBeLessThanOrEqual(1); // 3 days (tolerates a DST shift)
  });

  it('gives different copies to successive renters', async () => {
    await newMovie('alpha', 2);
    const [a, b] = await newUsers(2);

    const first = await rentMovie(a!.id, 'alpha');
    const second = await rentMovie(b!.id, 'alpha');

    expect(first.copyId).not.toBe(second.copyId);
  });

  it('fails with NoCopyAvailableError when every copy is rented', async () => {
    await newMovie('alpha', 1);
    const [a, b] = await newUsers(2);
    await rentMovie(a!.id, 'alpha');

    await expect(rentMovie(b!.id, 'alpha')).rejects.toBeInstanceOf(NoCopyAvailableError);
  });

  it('never rents a retired copy', async () => {
    await newMovie('alpha', 1);
    await pool.query(`UPDATE copies SET status = 'RETIRED'`);
    const user = await newUser();

    await expect(rentMovie(user.id, 'alpha')).rejects.toBeInstanceOf(NoCopyAvailableError);
  });

  it('fails for an unknown movie or an unknown user', async () => {
    await newMovie('alpha');
    const user = await newUser();

    await expect(rentMovie(user.id, 'ghost')).rejects.toBeInstanceOf(MovieNotFoundError);
    await expect(rentMovie(randomUUID(), 'alpha')).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('enforces the per-user limit, and frees a slot when a rental is returned', async () => {
    const user = await newUser();
    const rentals = [];
    for (let i = 1; i <= MAX_ACTIVE_RENTALS_PER_USER + 1; i++) {
      await newMovie(`movie-${i}`);
    }
    for (let i = 1; i <= MAX_ACTIVE_RENTALS_PER_USER; i++) {
      rentals.push(await rentMovie(user.id, `movie-${i}`));
    }

    await expect(
      rentMovie(user.id, `movie-${MAX_ACTIVE_RENTALS_PER_USER + 1}`),
    ).rejects.toBeInstanceOf(RentalLimitReachedError);

    await returnRental(rentals[0]!.id);

    const another = await rentMovie(user.id, `movie-${MAX_ACTIVE_RENTALS_PER_USER + 1}`);
    expect(another.status).toBe('ACTIVE');
  });
});

describe('returnRental', () => {
  it('marks the rental as returned and makes the copy available again', async () => {
    await newMovie('alpha', 1);
    const [a, b] = await newUsers(2);
    const rental = await rentMovie(a!.id, 'alpha');

    const returned = await returnRental(rental.id);
    const next = await rentMovie(b!.id, 'alpha');

    expect(returned.status).toBe('RETURNED');
    expect(returned.returnedAt).toBeInstanceOf(Date);
    expect(next.copyId).toBe(rental.copyId);
  });

  it('rejects returning twice, and returning something that does not exist', async () => {
    await newMovie('alpha');
    const user = await newUser();
    const rental = await rentMovie(user.id, 'alpha');
    await returnRental(rental.id);

    await expect(returnRental(rental.id)).rejects.toBeInstanceOf(RentalAlreadyReturnedError);
    await expect(returnRental(randomUUID())).rejects.toBeInstanceOf(RentalNotFoundError);
  });

  it('flags an ACTIVE rental past its due date as overdue (derived, never stored)', async () => {
    await newMovie('alpha');
    const user = await newUser();
    const rental = await rentMovie(user.id, 'alpha');

    await pool.query(
      `UPDATE rentals
       SET rented_at = now() - interval '10 days', due_at = now() - interval '7 days'
       WHERE id = $1`,
      [rental.id],
    );

    expect((await findRentalById(rental.id))?.overdue).toBe(true);
    await returnRental(rental.id);
    expect((await findRentalById(rental.id))?.overdue).toBe(false);
  });
});

describe('concurrency', () => {
  it('lets exactly ONE of many simultaneous renters win the last copy', async () => {
    await newMovie('last-copy', 1);
    const users = await newUsers(8);

    const results = await Promise.allSettled(users.map((u) => rentMovie(u.id, 'last-copy')));

    expect(fulfilledValues(results)).toHaveLength(1);
    const reasons = rejectedReasons(results);
    expect(reasons).toHaveLength(7);
    // The losers get a clean business error, NOT a raw database constraint error
    expect(reasons.every((r) => r instanceof NoCopyAvailableError)).toBe(true);
    expect(await countActiveRentals()).toBe(1);
  });

  it('hands out each of several copies exactly once', async () => {
    await newMovie('three-copies', 3);
    const users = await newUsers(6);

    const results = await Promise.allSettled(users.map((u) => rentMovie(u.id, 'three-copies')));

    const winners = fulfilledValues(results);
    expect(winners).toHaveLength(3);
    expect(new Set(winners.map((w) => w.copyId)).size).toBe(3); // three DIFFERENT copies
    expect(rejectedReasons(results).every((r) => r instanceof NoCopyAvailableError)).toBe(true);
  });

  it('cannot exceed the per-user limit with simultaneous requests', async () => {
    const user = await newUser();
    const total = MAX_ACTIVE_RENTALS_PER_USER + 2;
    const slugs = Array.from({ length: total }, (_, i) => `movie-${i + 1}`);
    for (const slug of slugs) await newMovie(slug);

    const results = await Promise.allSettled(slugs.map((slug) => rentMovie(user.id, slug)));

    expect(fulfilledValues(results)).toHaveLength(MAX_ACTIVE_RENTALS_PER_USER);
    expect(rejectedReasons(results).every((r) => r instanceof RentalLimitReachedError)).toBe(true);
    expect(await countActiveRentals()).toBe(MAX_ACTIVE_RENTALS_PER_USER);
  });

  it('lets exactly one of several simultaneous returns succeed', async () => {
    await newMovie('alpha');
    const user = await newUser();
    const rental = await rentMovie(user.id, 'alpha');

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => returnRental(rental.id)),
    );

    expect(fulfilledValues(results)).toHaveLength(1);
    expect(rejectedReasons(results).every((r) => r instanceof RentalAlreadyReturnedError)).toBe(
      true,
    );
  });
});

describe('database safety net (bypassing our code on purpose)', () => {
  async function setupCopy(): Promise<{ copyId: string; users: User[] }> {
    await newMovie('alpha', 1);
    const users = await newUsers(2);
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM copies');
    return { copyId: rows[0]!.id, users };
  }

  const insertRental = (userId: string, copyId: string) =>
    pool.query(
      `INSERT INTO rentals (user_id, copy_id, due_at) VALUES ($1, $2, now() + interval '3 days')`,
      [userId, copyId],
    );

  it('refuses a second ACTIVE rental of the same copy', async () => {
    const { copyId, users } = await setupCopy();
    await insertRental(users[0]!.id, copyId);

    await expect(insertRental(users[1]!.id, copyId)).rejects.toThrow(/rentals_one_active_per_copy/);
  });

  it('allows renting again after a return, keeping the history', async () => {
    const { copyId, users } = await setupCopy();
    await insertRental(users[0]!.id, copyId);
    await pool.query(`UPDATE rentals SET status = 'RETURNED', returned_at = now()`);

    await insertRental(users[1]!.id, copyId);

    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM rentals');
    expect(rows[0]?.n).toBe(2);
  });

  it('rejects a RETURNED rental without a return date', async () => {
    const { copyId, users } = await setupCopy();
    await insertRental(users[0]!.id, copyId);

    await expect(pool.query(`UPDATE rentals SET status = 'RETURNED'`)).rejects.toThrow(
      /rentals_returned_consistency/,
    );
  });
});
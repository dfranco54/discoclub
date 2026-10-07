import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db/pool.js';
import {
  createUser,
  DuplicateEmailError,
  findUserByEmail,
} from '../src/modules/users/users.repository.js';

const input = { email: 'ana@test.com', passwordHash: 'not-a-real-hash', name: 'Ana' };

// Every test starts from an empty table, so tests can't affect each other
beforeEach(async () => {
  await pool.query('TRUNCATE users');
});

afterAll(async () => {
  await pool.end();
});

describe('users repository', () => {
  it('creates a user with the default CUSTOMER role', async () => {
    const user = await createUser(input);

    expect(user).toMatchObject({ email: 'ana@test.com', name: 'Ana', role: 'CUSTOMER' });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    // The public shape must never expose the hash
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('normalizes the email to trimmed lowercase', async () => {
    const user = await createUser({ ...input, email: '  Ana@Test.COM ' });

    expect(user.email).toBe('ana@test.com');
  });

  it('finds a user by email regardless of case, including the hash', async () => {
    await createUser(input);

    const found = await findUserByEmail('ANA@test.com');

    expect(found?.email).toBe('ana@test.com');
    expect(found?.passwordHash).toBe('not-a-real-hash');
  });

  it('returns null when the user does not exist', async () => {
    expect(await findUserByEmail('nobody@test.com')).toBeNull();
  });

  it('rejects a duplicate email, even with different casing', async () => {
    await createUser(input);

    await expect(createUser({ ...input, email: 'ANA@test.com' })).rejects.toBeInstanceOf(
      DuplicateEmailError,
    );
  });

  it('lets exactly one of two simultaneous inserts win', async () => {
    const results = await Promise.allSettled([createUser(input), createUser(input)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(DuplicateEmailError);
  });

  it('enforces lowercase emails in the database itself, bypassing our code', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (email, password_hash, name) VALUES ('Ana@Test.com', 'x', 'Ana')`,
      ),
    ).rejects.toThrow(/users_email_lowercase/);
  });
});
import pg from 'pg';
import { pool } from '../../db/pool.js';

export type Role = 'CUSTOMER' | 'STAFF' | 'ADMIN';

// Public shape of a user: never includes the password hash
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: Date;
}

// Only for authentication code that needs to verify a password
export interface UserWithHash extends User {
  passwordHash: string;
}

// Row exactly as PostgreSQL returns it (snake_case)
type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: Role;
  created_at: Date;
};

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'DuplicateEmailError';
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
  };
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// 23505 = unique_violation. We also check the constraint name so we don't
// confuse it with some other unique constraint failing.
function isDuplicateEmail(err: unknown): boolean {
  return (
    err instanceof pg.DatabaseError &&
    err.code === '23505' &&
    err.constraint === 'users_email_key'
  );
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
}): Promise<User> {
  const email = normalizeEmail(input.email);

  try {
    // Always use $1, $2... placeholders. NEVER build SQL by concatenating
    // user input into the string: that is how SQL injection happens.
    const { rows } = await pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, name)
      VALUES ($1, $2, $3)
      RETURNING id, email, password_hash, name, role, created_at`,
      [email, input.passwordHash, input.name],
    );

    // With noUncheckedIndexedAccess, rows[0] is UserRow | undefined
    const row = rows[0];
    if (!row) throw new Error('INSERT returned no row');
    return toUser(row);
  } catch (err) {
    // We rely on the database constraint instead of "check if it exists, then
    // insert", which has a race condition: two simultaneous requests could
    // both pass the check and both insert.
    if (isDuplicateEmail(err)) throw new DuplicateEmailError(email);
    throw err;
  }
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, password_hash, name, role, created_at
    FROM users
    WHERE email = $1`,
    [normalizeEmail(email)],
  );

  const row = rows[0];
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash };
}
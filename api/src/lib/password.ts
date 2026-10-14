import argon2 from 'argon2';

// argon2id with the library's default parameters (sensible for most apps).
// The returned string already contains the algorithm, parameters and a random
// salt, so we only need to store this one value.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// Note the argument order of argon2.verify: hash first, plain password second
export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { config } from '../config.js';
import type { Role } from '../modules/users/users.repository.js';

const key = new TextEncoder().encode(config.JWT_SECRET);

// Pinning the algorithm on verification blocks "algorithm confusion" attacks
const ALGORITHM = 'HS256';
const ISSUER = 'discoclub';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// Never trust a token's content just because the signature is valid:
// we validate the shape of the claims too.
const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']),
});

export type AuthClaims = z.infer<typeof claimsSchema>;

export function signAccessToken(user: { id: string; role: Role }): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

// Throws if the token is malformed, tampered with, expired or has bad claims
export async function verifyAccessToken(token: string): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
  });
  return claimsSchema.parse(payload);
}
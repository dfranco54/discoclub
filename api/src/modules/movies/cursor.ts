import { z } from 'zod';

export interface MovieCursor {
  title: string;
  slug: string;
}

const payloadSchema = z.object({ t: z.string(), s: z.string() });

// Opaque to clients: they must treat it as a black box and send it back unchanged.
// It is NOT signed: a forged cursor can only change where the list starts,
// and it is always passed to SQL as a parameter, so it is harmless.
export function encodeCursor(cursor: MovieCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.title, s: cursor.slug })).toString('base64url');
}

// Returns null instead of throwing: the caller decides how to report a bad cursor
export function decodeCursor(value: string): MovieCursor | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const parsed = payloadSchema.safeParse(json);
    return parsed.success ? { title: parsed.data.t, slug: parsed.data.s } : null;
  } catch {
    return null;
  }
}
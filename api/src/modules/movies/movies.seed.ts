import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { MovieInput } from './movies.repository.js';

// api/seed/movies.json, resolved relative to this file (works from src/ and dist/)
const DEFAULT_SEED_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../seed/movies.json',
);

// A hand-edited file is untrusted input too: validate it like any other
const seedMovieSchema = z.object({
  // Same rule as the database CHECK constraint
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().trim().min(1),
  year: z.number().int().min(1888).max(2100),
  director: z.string().trim().min(1),
  genres: z.array(z.string().trim().min(1)).min(1),
  overview: z.string().trim().min(1),
});

export function parseSeedMovies(raw: unknown): MovieInput[] {
  const movies = z.array(seedMovieSchema).parse(raw);

  const seen = new Set<string>();
  for (const movie of movies) {
    if (seen.has(movie.slug)) {
      throw new Error(`Duplicate slug in seed file: "${movie.slug}"`);
    }
    seen.add(movie.slug);
  }

  return movies.map((m) => ({
    slug: m.slug,
    title: m.title,
    overview: m.overview,
    releaseYear: m.year,
    director: m.director,
    genres: m.genres,
  }));
}

export async function loadSeedMovies(filePath = DEFAULT_SEED_PATH): Promise<MovieInput[]> {
  const text = await readFile(filePath, 'utf8');
  return parseSeedMovies(JSON.parse(text));
}
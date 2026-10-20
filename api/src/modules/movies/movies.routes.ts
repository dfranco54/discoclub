import { Router } from 'express';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './cursor.js';
import { findMovieBySlug, listMovies } from './movies.repository.js';

// Empty strings (e.g. "?q=") are treated as "not provided"
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((value) => value || undefined);

// Query values always arrive as strings, so numbers need coercion.
// Repeated params (?q=a&q=b) arrive as arrays and are rejected with a 400.
const listQuerySchema = z.object({
  q: optionalText(100),
  genre: optionalText(50),
  limit: z.coerce.number().int().min(1).max(50).default(20), // the cap prevents huge responses
  cursor: z
    .string()
    .max(500)
    .refine((value) => decodeCursor(value) !== null, { error: 'Invalid cursor' })
    .optional(),
});

const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const moviesRouter = Router();

moviesRouter.get('/', async (req, res) => {
  const query = listQuerySchema.parse(req.query);

  const { movies, hasMore } = await listMovies({
    q: query.q,
    genre: query.genre,
    limit: query.limit,
    after: query.cursor ? (decodeCursor(query.cursor) ?? undefined) : undefined,
  });

  const last = movies.at(-1);
  res.json({
    movies,
    nextCursor: hasMore && last ? encodeCursor({ title: last.title, slug: last.slug }) : null,
  });
});

moviesRouter.get('/:slug', async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);

  const movie = await findMovieBySlug(slug);
  if (!movie) {
    res.status(404).json({ error: 'Movie not found' });
    return;
  }
  res.json({ movie });
});
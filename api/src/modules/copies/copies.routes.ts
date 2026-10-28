import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { createCopies, listCopiesByMovieSlug, setCopyStatus } from './copies.repository.js';

const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const createSchema = z.object({
  format: z.enum(['DVD', 'BLURAY']),
  // The cap keeps one request from creating thousands of rows
  quantity: z.number().int().min(1).max(20).default(1),
});

const statusSchema = z.object({ status: z.enum(['ACTIVE', 'RETIRED']) });

const requireStaff = requireRole('STAFF', 'ADMIN');

// Mounted at the app root, so authentication is applied PER ROUTE below.
// A router-wide authenticate would answer 401 for unknown URLs instead of 404.
export const copiesRouter = Router();

copiesRouter.post('/movies/:slug/copies', authenticate, requireStaff, async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);
  const input = createSchema.parse(req.body);

  const copies = await createCopies(slug, input.format, input.quantity);
  if (!copies) {
    res.status(404).json({ error: 'Movie not found' });
    return;
  }
  res.status(201).json({ copies });
});

copiesRouter.get('/movies/:slug/copies', authenticate, requireStaff, async (req, res) => {
  const slug = slugSchema.parse(req.params.slug);

  const copies = await listCopiesByMovieSlug(slug);
  if (!copies) {
    res.status(404).json({ error: 'Movie not found' });
    return;
  }
  res.json({ copies });
});

copiesRouter.patch('/copies/:id', authenticate, requireStaff, async (req, res) => {
  // Validate the id first: a malformed UUID would otherwise make PostgreSQL throw (a 500)
  const id = z.uuid().parse(req.params.id);
  const { status } = statusSchema.parse(req.body);

  const copy = await setCopyStatus(id, status);
  if (!copy) {
    res.status(404).json({ error: 'Copy not found' });
    return;
  }
  res.json({ copy });
});
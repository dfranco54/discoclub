import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { DuplicateEmailError } from '../modules/users/users.repository.js';

// body-parser errors (malformed JSON, payload too large...) carry a `type`
// starting with "entity." and an HTTP status. They are the client's fault (4xx).
function isClientBodyError(err: unknown): err is { status: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof err.type === 'string' &&
    err.type.startsWith('entity.') &&
    'status' in err &&
    typeof err.status === 'number'
  );
}

// Express recognizes error handlers by their 4 parameters
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof DuplicateEmailError) {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  if (isClientBodyError(err)) {
    res.status(err.status).json({ error: 'Invalid request body' });
    return;
  }

  // Anything else is our bug: log it, but never leak internals to the client
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
};
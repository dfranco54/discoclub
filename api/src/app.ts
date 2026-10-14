import express, { type Express, type Request, type Response } from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { authRouter } from './modules/auth/auth.routes.js';

// Factory function: builds the app without starting a server,
// so tests can exercise it without opening a real network port.
export function buildApp(): Express {
  const app = express();

  // Don't advertise the framework in response headers
  app.disable('x-powered-by');

  // Parses JSON bodies into req.body; the limit rejects oversized payloads
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);

  // 404 handler: runs only if no route above matched
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Must be registered last
  app.use(errorHandler);

  return app;
}
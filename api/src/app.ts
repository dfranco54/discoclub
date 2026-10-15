import cookieParser from 'cookie-parser';
import express, { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler } from './middleware/error-handler.js';
import { type AuthLimiters, createAuthLimiters } from './middleware/rate-limit.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';

export interface AppOptions {
  // Injectable so tests can use their own limits (secure by default)
  authLimiters?: AuthLimiters;
}

// Factory function: builds the app without starting a server,
// so tests can exercise it without opening a real network port.
export function buildApp(options: AppOptions = {}): Express {
  const app = express();
  const limiters = options.authLimiters ?? createAuthLimiters();

  // Must be set before any middleware that reads req.ip (the rate limiters)
  app.set('trust proxy', config.TRUST_PROXY);

  // Sets security headers (nosniff, HSTS, frame protection...) and removes X-Powered-By
  app.use(helmet());

  // Parses JSON bodies into req.body; the limit rejects oversized payloads
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Rate limiting is applied by path here, so the auth router stays unaware of it.
  // A limiter calls next() when the request is allowed, which continues on
  // to the matching route in authRouter.
  app.post('/auth/login', limiters.login);
  app.post('/auth/register', limiters.register);

  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);

  // 404 handler: runs only if no route above matched
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Must be registered last
  app.use(errorHandler);

  return app;
}
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

// Factory function: builds the app without starting a server,
// so tests can exercise it without opening a real network port.
export function buildApp(): Express {
  const app = express();

  // Don't advertise the framework in response headers
  app.disable('x-powered-by');

  // Middleware: parses JSON request bodies into req.body
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // 404 handler: runs only if no route above matched
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Error handler: Express recognizes it by its 4 parameters.
  // Never leak internal details to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (process.env.NODE_ENV !== 'test') console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
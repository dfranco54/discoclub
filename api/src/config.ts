import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // How many reverse proxies sit in front of the app (0 locally, usually 1 in production)
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

// Fails fast at startup if the environment is misconfigured
export const config = envSchema.parse(process.env);
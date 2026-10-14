import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Anything shorter than 32 chars is too easy to brute-force
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

// Fails fast at startup if the environment is misconfigured
export const config = envSchema.parse(process.env);
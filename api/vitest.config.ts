import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/config.js';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    // The app's pool reads DATABASE_URL; during tests it must point to the test DB.
    // (dotenv never overrides variables that already exist, so .env can't win.)
    env: { DATABASE_URL: TEST_DATABASE_URL },
    // All test files share one database, so they must not run in parallel
    fileParallelism: false,
  },
});
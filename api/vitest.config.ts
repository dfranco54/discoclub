import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './tests/config.js';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.ts'],
    // The app's pool reads DATABASE_URL; during tests it must point to the test DB.
    // (dotenv never overrides variables that already exist, so .env can't win.)
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Test-only secret: long enough to pass validation, not used anywhere else
      JWT_SECRET: 'test-only-secret-test-only-secret-1234567890',
    },
    // All test files share one database, so they must not run in parallel
    fileParallelism: false,
  },
});
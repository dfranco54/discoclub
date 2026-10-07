// Single source of truth for the test database connection.
// TEST_DATABASE_URL lets CI override it.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://discoclub:discoclub@localhost:5432/discoclub_test';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { ensureStock, type StockItem } from '../modules/copies/copies.stock.js';

// Fake stock is for development only
if (config.NODE_ENV === 'production') {
  console.error('Refusing to run: this script creates fake development data.');
  process.exit(1);
}

const STOCK: StockItem[] = [
  // Exactly ONE copy: ideal for testing the "last copy" race condition
  { slug: 'the-godfather', format: 'DVD', quantity: 1 },
  { slug: 'casablanca', format: 'DVD', quantity: 1 },
  { slug: 'vertigo', format: 'BLURAY', quantity: 1 },
  { slug: 'parasite', format: 'DVD', quantity: 1 },
  { slug: 'spirited-away', format: 'DVD', quantity: 1 },
  { slug: 'whiplash', format: 'BLURAY', quantity: 1 },
  // Two copies
  { slug: 'pulp-fiction', format: 'DVD', quantity: 2 },
  { slug: 'the-matrix', format: 'BLURAY', quantity: 2 },
  { slug: 'inception', format: 'BLURAY', quantity: 2 },
  { slug: 'the-dark-knight', format: 'DVD', quantity: 2 },
  // Three copies, mixed formats
  { slug: 'jurassic-park', format: 'DVD', quantity: 2 },
  { slug: 'jurassic-park', format: 'BLURAY', quantity: 1 },
  { slug: 'toy-story', format: 'DVD', quantity: 3 },
  // All other movies are left without stock on purpose: a realistic catalog
];

// Usage: npm run dev:stock   (safe to re-run)
try {
  const created = await ensureStock(STOCK);
  console.log(`Stock ready: ${created} new copies created`);
} catch (err) {
  console.error('Stock failed:', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
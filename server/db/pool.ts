/**
 * @file server/db/pool.ts
 * @description Singleton pg.Pool constructed from DATABASE_URL.
 * Lazy-created on first import — safe to import anywhere in the server.
 */

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('[db/pool] DATABASE_URL env var is required');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('[db/pool] Unexpected client error:', err.message);
});

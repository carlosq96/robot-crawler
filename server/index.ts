/**
 * @file server/index.ts
 * @description Space Runner Express server — leaderboard API only.
 * Serves JSON endpoints under /api/runs. Static files are served separately
 * by `npx serve` in development and by Vercel in production.
 */

import express from 'express';
import { bootstrapSchema } from './db/bootstrap.js';
import { runsRouter } from './routes/runs.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(express.json());

// CORS for local dev — Vercel/Railway handles this in prod
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.options('*', (_req, res) => { res.sendStatus(204); });

app.use('/api/runs', runsRouter);

app.get('/health', (_req, res) => { res.json({ ok: true }); });

bootstrapSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[server] Space Runner API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[server] Failed to bootstrap DB schema:', err);
    process.exit(1);
  });

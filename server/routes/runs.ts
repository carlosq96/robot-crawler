/**
 * @file server/routes/runs.ts
 * @description Express routes for the Space Runner leaderboard.
 *
 * POST /api/runs  — submit a completed run, get back rank
 * GET  /api/runs/top?limit=N — fetch top-N scores
 */

import { Router, type Request, type Response } from 'express';
import { pool } from '../db/pool.js';

export const runsRouter = Router();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function sanitizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
  return cleaned.length > 0 ? cleaned : null;
}

function isPositiveInt(v: unknown, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max;
}

// ---------------------------------------------------------------------------
// POST /api/runs
// ---------------------------------------------------------------------------

runsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const { username, distance, planetsCleared, crystals, score } = req.body ?? {};

  const cleanUsername = sanitizeUsername(username);
  if (!cleanUsername) {
    res.status(400).json({ error: 'username must be a non-empty alphanumeric string (max 32 chars)' });
    return;
  }
  if (!isPositiveInt(distance, 100_000)) {
    res.status(400).json({ error: 'distance must be an integer in [0, 100000)' });
    return;
  }
  if (!isPositiveInt(planetsCleared, 1_000)) {
    res.status(400).json({ error: 'planetsCleared must be an integer in [0, 1000)' });
    return;
  }
  if (!isPositiveInt(crystals, 100_000)) {
    res.status(400).json({ error: 'crystals must be an integer in [0, 100000)' });
    return;
  }
  if (!isPositiveInt(score, 1_000_000)) {
    res.status(400).json({ error: 'score must be an integer in [0, 1000000)' });
    return;
  }

  try {
    const insertResult = await pool.query<{ id: number }>(
      `INSERT INTO runs (username, distance, planets_cleared, crystals, score)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [cleanUsername, distance, planetsCleared, crystals, score],
    );

    const id = insertResult.rows[0].id;

    const rankResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM runs WHERE score > $1`,
      [score],
    );
    const rank = parseInt(rankResult.rows[0].count, 10) + 1;

    res.status(201).json({ id, rank });
  } catch (err) {
    console.error('[POST /api/runs]', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/top
// ---------------------------------------------------------------------------

runsRouter.get('/top', async (req: Request, res: Response): Promise<void> => {
  const rawLimit = parseInt(String(req.query.limit ?? '10'), 10);
  const limit = Number.isNaN(rawLimit) ? 10 : Math.min(Math.max(rawLimit, 1), 100);

  try {
    const result = await pool.query(
      `SELECT id, username, distance, planets_cleared AS "planetsCleared",
              crystals, score, created_at AS "createdAt"
       FROM runs
       ORDER BY score DESC
       LIMIT $1`,
      [limit],
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[GET /api/runs/top]', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

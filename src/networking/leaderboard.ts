/**
 * @file src/networking/leaderboard.ts
 * @description Client-side leaderboard helpers for Space Runner.
 *
 * - submitRun   — POST /api/runs, returns rank or null on failure
 * - fetchTopRuns — GET /api/runs/top, returns rows or [] on failure
 * - localStorage helpers for username + personal best
 *
 * All functions are safe: they catch network/storage errors and degrade
 * gracefully — the game never crashes because the leaderboard is down.
 */

// ---------------------------------------------------------------------------
// Types (shared with server routes)
// ---------------------------------------------------------------------------

export interface RunSubmission {
  username: string;
  distance: number;
  planetsCleared: number;
  crystals: number;
  score: number;
}

export interface RunRow extends RunSubmission {
  id: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Config — override via importmap or env at build time for prod
// ---------------------------------------------------------------------------

const API_BASE = 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Server calls
// ---------------------------------------------------------------------------

/**
 * Submit a completed run to the leaderboard.
 * @returns `{ id, rank }` on success, `null` on any network/server failure.
 */
export async function submitRun(
  run: RunSubmission,
): Promise<{ id: number; rank: number } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(run),
    });
    if (!res.ok) {
      console.warn(`[leaderboard] submitRun failed: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as { id: number; rank: number };
  } catch (err) {
    console.warn('[leaderboard] submitRun network error:', err);
    return null;
  }
}

/**
 * Fetch the top-N leaderboard entries.
 * @returns Array of run rows (may be empty), never throws.
 */
export async function fetchTopRuns(limit = 10): Promise<RunRow[]> {
  try {
    const res = await fetch(`${API_BASE}/api/runs/top?limit=${limit}`);
    if (!res.ok) {
      console.warn(`[leaderboard] fetchTopRuns failed: HTTP ${res.status}`);
      return [];
    }
    return (await res.json()) as RunRow[];
  } catch (err) {
    console.warn('[leaderboard] fetchTopRuns network error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_USERNAME_KEY = 'spaceRunner.username';
const LS_PB_KEY = 'spaceRunner.personalBest';

export function getStoredUsername(): string | null {
  try {
    return localStorage.getItem(LS_USERNAME_KEY);
  } catch {
    return null;
  }
}

export function setStoredUsername(name: string): void {
  try {
    localStorage.setItem(LS_USERNAME_KEY, name);
  } catch {
    // localStorage blocked — silently ignore
  }
}

export function getPersonalBest(): RunSubmission | null {
  try {
    const raw = localStorage.getItem(LS_PB_KEY);
    return raw ? (JSON.parse(raw) as RunSubmission) : null;
  } catch {
    return null;
  }
}

/**
 * Update personal best if the new run's score exceeds the stored PB.
 * @returns `true` if a new PB was set, `false` otherwise.
 */
export function updatePersonalBest(run: RunSubmission): boolean {
  try {
    const existing = getPersonalBest();
    if (existing && existing.score >= run.score) return false;
    localStorage.setItem(LS_PB_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

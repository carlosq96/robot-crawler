# Quick Design Spec: Persistence Layer

**Type**: New Small System
**Scope**: Server-side leaderboard persistence for Space Runner. A single `runs` Postgres table + two Express HTTP endpoints (POST and GET). Client-side `localStorage` for username + personal best. No auth, no sessions, no user accounts. Replaces the MML 3-table (`players`, `seeds`, `scores`) design with a simpler 1-table scheme since Space Runner is endless + solo.
**Date**: 2026-04-09
**Estimated Implementation**: ~2 hours (S effort — server 1.5h + client 0.5h)

---

## Overview

Persistence Layer stores run results in a single Postgres table and serves them via two Express routes. The client calls `POST /api/runs` at run-end to submit a score, and `GET /api/runs/top?limit=10` to fetch the leaderboard for the Results Screen. Everything else (personal best, last username) lives in the browser's `localStorage`.

No auth because the jam is free and anonymous. A determined cheater can forge leaderboard entries — accepted risk for a free jam, mitigated by a server-side sanity cap (distance < 100000, score < 1000000).

---

## Core Rules

### 1. Database schema

```sql
CREATE TABLE IF NOT EXISTS runs (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(32) NOT NULL,
  distance        INTEGER NOT NULL CHECK (distance >= 0 AND distance < 100000),
  planets_cleared INTEGER NOT NULL CHECK (planets_cleared >= 0 AND planets_cleared < 1000),
  crystals        INTEGER NOT NULL CHECK (crystals >= 0 AND crystals < 100000),
  score           INTEGER NOT NULL CHECK (score >= 0 AND score < 1000000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runs_score_desc ON runs (score DESC);
```

Single table. Index on `score DESC` for fast top-N queries. `CHECK` constraints reject absurd values at the DB level.

### 2. POST /api/runs

Request body:
```json
{ "username": "carlos", "distance": 1834, "planetsCleared": 3, "crystals": 27, "score": 3364 }
```

Server logic:
1. Validate body shape + types (return 400 on bad input)
2. Sanitize `username`: strip to alphanumeric + underscore, max 32 chars
3. Insert row into `runs` table
4. Query the player's rank: `SELECT COUNT(*) FROM runs WHERE score > $1`
5. Return `{ id, rank }` where `rank = count + 1`

### 3. GET /api/runs/top?limit=10

Query params: `limit` (default 10, max 100)

Server logic:
```sql
SELECT username, distance, planets_cleared, crystals, score, created_at
FROM runs
ORDER BY score DESC
LIMIT $1;
```

Returns array of objects.

### 4. Connection pool

`server/db/pool.ts` exports a single `pg.Pool` instance constructed from `process.env.DATABASE_URL` (auto-injected by Railway when the Postgres plugin is linked). Pool is lazy-created on first import.

### 5. Schema bootstrap

`server/db/bootstrap.ts` runs the `CREATE TABLE IF NOT EXISTS` SQL once on server startup. Idempotent — safe to re-run on every deploy.

### 6. Client-side localStorage

Separate from the server. Client stores:
- `spaceRunner.username` — last-used username, prefilled on results screen
- `spaceRunner.personalBest` — `{ distance, planetsCleared, crystals, score, timestamp }`

Both optional. App works fine if localStorage is blocked.

### 7. Error handling

- Network failures on POST are caught client-side and display "couldn't submit score — playing offline" in the Results Screen. Score still shows, just isn't ranked.
- Server errors return 500 with `{ error: "message" }` JSON.
- Never 404 `/api/runs` on an empty table — return `[]`.

---

## Public API Surface (LOCKED contract)

### Server (Express routes in `server/routes/runs.ts`)
```ts
POST /api/runs   body: RunSubmission   → { id: number, rank: number }
GET  /api/runs/top?limit=N             → Array<RunRow>
```

### Client helper (`src/networking/leaderboard.ts`)
```ts
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

export async function submitRun(run: RunSubmission): Promise<{ id: number; rank: number } | null>;
export async function fetchTopRuns(limit?: number): Promise<RunRow[]>;

export function getStoredUsername(): string | null;
export function setStoredUsername(name: string): void;
export function getPersonalBest(): RunSubmission | null;
export function updatePersonalBest(run: RunSubmission): boolean; // returns true if new PB
```

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| max distance allowed | 100000 | — | safety cap | No legit run covers 100 km |
| max score allowed | 1000000 | — | safety cap | No legit run scores 1M |
| top-N default | 10 | 5–100 | UI | Fits on a Results Screen panel |
| username max length | 32 | 8–64 | UI | Enough room for creative names without abuse |

---

## Data Files

No game-data JSON. SQL schema lives at `server/db/schema.sql`. Connection string comes from `DATABASE_URL` env var.

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Run Results Screen | POSTs to `/api/runs`, GETs `/api/runs/top` | Uses the client helper |
| Run Lifecycle | Computes the final score object, hands to Results Screen | Passes through, no direct DB access |
| HUD | Reads personal best for "PB: X" display | Reads from localStorage helper |

---

## Acceptance Criteria

- [ ] Starting the server against a fresh Postgres creates the `runs` table automatically
- [ ] `POST /api/runs` with a valid body inserts a row and returns `{ id, rank }`
- [ ] `POST /api/runs` with a malformed body returns 400
- [ ] `POST /api/runs` with `distance: 999999999` returns 400 (sanity cap)
- [ ] `GET /api/runs/top` returns top 10 rows ordered by score DESC
- [ ] `GET /api/runs/top` on an empty table returns `[]`, not 404
- [ ] Client `submitRun` returns `null` on network failure without throwing
- [ ] Client `updatePersonalBest` returns `true` only when the new score exceeds the stored PB
- [ ] `getStoredUsername` returns `null` when localStorage is unavailable (no throw)

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #3, L0, T1, S-effort. No update needed.

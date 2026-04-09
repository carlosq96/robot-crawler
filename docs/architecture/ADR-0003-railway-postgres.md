# ADR-0003: Railway Postgres over Supabase / Firebase / SQLite

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Robot Crawler needs persistent storage for player profiles, dungeon seeds, and per-seed leaderboards. We use **Railway-managed Postgres in the same Railway project as the Colyseus server** with the `pg` npm package — one platform, one DATABASE_URL, no extra accounts, simple SQL with no ORM overhead.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Node.js server (Postgres client via `pg`) |
| **Domain** | Persistence |
| **Knowledge Risk** | LOW — Postgres + `pg` are stable, well-documented |
| **References Consulted** | https://node-postgres.com/ |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Connection pool works under Railway environment; DATABASE_URL injected correctly |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0002 (Colyseus on Railway — defines the deployment platform) |
| **Enables** | ADR-0006 (Postgres write on dispose), Persistence Layer system, Leaderboard, Seed sharing |
| **Blocks** | Persistence Layer GDD, Lobby System (needs profile lookup), Run Results Screen |
| **Ordering Note** | Schema must be locked before any read/write code is written |

## Context

### Problem Statement

The game produces persistent data: player crystals (currency), Journey Level (progression), discovered seeds (shareable), and per-seed leaderboards. This must survive server restarts, must be queryable for ranking, and must scale to many players (target: thousands of jam players over a weekend).

### Current State

Greenfield project; no persistence layer exists.

### Constraints

- Free tier hosting (Railway free Postgres add-on)
- Solo developer; no DBA time
- Must integrate with Colyseus server (already on Railway per ADR-0002)
- One DATABASE_URL injected via Railway environment variable
- Concurrent writes from multiple Colyseus rooms

### Requirements

- Three logical entities: players, seeds, scores
- Sub-100ms read latency for player profile lookups
- Atomic per-run write (multi-row transaction in `onDispose`, see ADR-0006)
- No mid-run writes (zero per-frame DB load)
- Schema versioning is N/A for jam (greenfield, no migrations needed)

## Decision

Use Railway-managed Postgres in the same Railway project as the Colyseus server. Connect via the `pg` npm package (no ORM). Three tables: `players`, `seeds`, `scores`. Connection pool initialized once at server boot.

### Architecture

```
Colyseus Server (Node.js)
    │
    ├── server/db/pool.ts  (singleton pg.Pool)
    │       │
    │       └── pg.Pool({ connectionString: process.env.DATABASE_URL })
    │
    ├── server/routes/seeds.ts    ← Express HTTP routes (GET/POST)
    ├── server/routes/scores.ts   ← Express HTTP routes (GET/POST)
    │
    └── server/rooms/DungeonRoom.ts
            │
            └── onDispose() → atomic transaction (see ADR-0006)
                    ├── INSERT or UPDATE players
                    ├── INSERT seeds (if new)
                    └── INSERT scores
```

### Key Interfaces

```sql
-- players: one row per player profile
CREATE TABLE players (
  username        TEXT PRIMARY KEY,
  crystals        INTEGER NOT NULL DEFAULT 0,
  journey_level   INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- seeds: one row per published seed
CREATE TABLE seeds (
  id          SERIAL PRIMARY KEY,
  seed        TEXT UNIQUE NOT NULL,
  creator     TEXT REFERENCES players(username),
  difficulty  INTEGER NOT NULL DEFAULT 1,
  published   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- scores: one row per player per cleared seed
CREATE TABLE scores (
  id            SERIAL PRIMARY KEY,
  seed_id       INTEGER REFERENCES seeds(id),
  username      TEXT REFERENCES players(username),
  score         INTEGER NOT NULL,
  clear_time    INTEGER NOT NULL,        -- seconds
  party_size    INTEGER NOT NULL,         -- 1-3
  zero_deaths   BOOLEAN NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scores_seed_id ON scores(seed_id);
CREATE INDEX idx_scores_username ON scores(username);
```

```ts
// server/db/pool.ts
import { Pool } from 'pg';
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});
```

### Implementation Guidelines

- Use parameterized queries (`pool.query('SELECT * FROM players WHERE username = $1', [username])`) — never string-concatenate
- Wrap multi-statement run-end writes in `BEGIN; ... COMMIT;` transactions (see ADR-0006)
- No ORM (Prisma/TypeORM/Sequelize) — adds complexity, jam scope can't justify
- Connection pool size: 10 max (sufficient for jam; Railway free tier connection limit is 100)
- All schema lives in one SQL migration file: `server/db/schema.sql`. Run manually on first deploy.

## Alternatives Considered

### Alternative 1: Supabase (free tier)

- **Description**: Hosted Postgres + auth + auto-generated REST + realtime
- **Pros**: Generous free tier; realtime built-in; good docs
- **Cons**: Separate account; separate auth flow; another platform to manage
- **Estimated Effort**: Low Postgres setup, medium integration with our existing Railway server
- **Rejection Reason**: Why introduce a second platform when Railway already gives us managed Postgres in the same project as the server?

### Alternative 2: Firebase Firestore

- **Description**: Google's NoSQL document store with real-time
- **Pros**: Free tier; mature; real-time built in
- **Cons**: NoSQL fights our naturally relational data; vendor lock-in; expensive at scale
- **Estimated Effort**: Medium (different mental model)
- **Rejection Reason**: Our data is relational (players → seeds → scores); NoSQL is the wrong shape

### Alternative 3: SQLite local file

- **Description**: Embedded SQL database
- **Pros**: No network, no setup, free
- **Cons**: Cannot handle concurrent writes from multiple Colyseus rooms
- **Estimated Effort**: Lowest
- **Rejection Reason**: Multiplayer means multiple rooms writing concurrently; SQLite locks the whole DB on write

### Alternative 4: In-memory only

- **Description**: Just keep state in JS Maps
- **Pros**: Fastest possible
- **Cons**: Dies on every server restart
- **Estimated Effort**: None
- **Rejection Reason**: Players expect their crystals and unlocks to persist

## Consequences

### Positive

- One platform (Railway), one DATABASE_URL, one bill ($0)
- Real SQL with `pg` — well-known, well-documented
- Relational schema fits the data perfectly
- Free tier handles jam-scale traffic
- No ORM = no impedance mismatch

### Negative

- Manual schema management (no migration UI)
- Tied to Railway uptime
- No built-in real-time subscriptions (we don't need them — Colyseus handles realtime)
- Free tier has connection limits (100); we cap at 10 in pool

### Neutral

- All persistence code lives in `server/db/` and `server/routes/`
- Schema is checked into the repo as one `.sql` file

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Railway free Postgres add-on changes terms mid-jam | Low | High | Have a Supabase fallback plan documented (one ADR rewrite + 1 day work) |
| Schema mistake forces a migration mid-jam | Medium | Medium | Lock schema before writing read/write code; only additive changes after |
| Connection pool exhaustion under load | Low | High | Pool max=10; release connections in `try/finally`; monitor at jam load |
| `pg` SQL injection due to bad query | Medium | High | **Never** string-concat; ALWAYS use parameterized queries |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Player profile read latency | N/A | < 10 ms | < 50 ms |
| Run-end write transaction | N/A | 20-50 ms | < 200 ms |
| DB connection pool size | N/A | 10 | 10 |
| Total writes per minute (jam scale) | N/A | < 60 (one room every ~15 min × multiple rooms) | < 600 |

## Migration Plan

N/A — greenfield.

**Rollback plan**: If Railway Postgres becomes unworkable, fall back to Supabase free tier. The migration is mechanical: rewrite the `pg.Pool` connection string to point at Supabase, copy the schema SQL, redeploy. Estimated cost: ~1 day.

## Validation Criteria

- [ ] Schema SQL file lives in `server/db/schema.sql`
- [ ] Connection pool initializes successfully on Railway with injected DATABASE_URL
- [ ] All queries use parameterized syntax (no string concat) — verified by code review
- [ ] Run-end transaction completes in < 100 ms under jam load
- [ ] Leaderboard query for a seed returns top 100 in < 50 ms

## GDD Requirements Addressed

| GDD Document | System | Requirement | How This ADR Satisfies It |
|---|---|---|---|
| design/gdd/game-concept.md | Persistence | "Persistent, no permadeath" | Postgres survives server restarts |
| design/gdd/game-concept.md | Persistence | "Per-seed leaderboard" | `scores` table indexed by `seed_id` |
| design/gdd/game-concept.md | Persistence | "Shareable seeds" | `seeds` table with `published` flag |
| design/gdd/game-concept.md | Progression | "Journey Level increases on clears" | `players.journey_level` column |

## Related

- ADR-0002 (Colyseus on Railway) — same platform = one DATABASE_URL
- ADR-0006 (Postgres write on dispose) — defines exactly when these tables are written to
- design/gdd/systems-index.md → Persistence Layer system

# ADR-0006: Postgres write only on Colyseus Room.onDispose()

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

The server writes to Postgres exactly once per run, in the Colyseus Room's `onDispose()` callback, as a single atomic transaction. No mid-run writes anywhere in the codebase. Mid-run state lives in the Colyseus state schema only.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Colyseus 0.15 + pg (Postgres) |
| **Domain** | Persistence + Networking lifecycle |
| **Knowledge Risk** | LOW — Colyseus lifecycle is documented and stable |
| **References Consulted** | docs/engine-reference/colyseus/COLYSEUS-0.15.md |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | `onDispose()` is reliably called when room ends or all clients leave |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0002 (Colyseus), ADR-0003 (Railway Postgres), ADR-0004 (server-authoritative — server is the only writer) |
| **Enables** | Run Lifecycle GDD (purity), Persistence Layer GDD |
| **Blocks** | Run Results Screen (depends on persisted score), Leaderboard, Ship Cockpit profile |
| **Ordering Note** | Must be locked before any DB write code is written |

## Context

### Problem Statement

Where in the room lifecycle do we write run results to Postgres? Per-frame writes are wasteful and break free-tier connection limits. Per-action writes risk inconsistency on crash. Per-room-transition writes are noisy and partial. We need a single, atomic, well-defined moment.

### Current State

Greenfield; no DB write code exists.

### Constraints

- Free-tier Postgres connection limit (~100 connections, we use a pool of 10)
- Atomic per-run records (one row per player score, one row for new seeds)
- Run Lifecycle should remain a pure state machine (testable without a DB)
- Server crashes mid-run are acceptable losses (jam tolerance)

### Requirements

- Each cleared run produces exactly one set of DB writes
- Writes are atomic: either all of {seed insert (if new), score insert per player, player update} land, or none do
- Run Lifecycle does not import the DB module (purity / DI)
- Failed runs may also write a partial record (penalty crystal log) — TBD per Run Lifecycle GDD

## Decision

Postgres writes happen in **exactly one place**: Colyseus `DungeonRoom.onDispose()`. Run Lifecycle is a pure state machine that mutates the Colyseus state schema. When the room ends (cleared, failed, all-disconnected, or timeout), Colyseus calls `onDispose()`. That handler reads the final state, opens a single transaction, and writes everything.

### Architecture

```
Run begins                                                 Run ends
   │                                                            │
   │  ◀───── Colyseus DungeonRoom (60 Hz tick) ─────▶          │
   │                                                            │
   │     state.players.set(...)                                 │
   │     state.enemies.set(...)                                 │
   │     RunLifecycle.tick(state, dt)  ← pure, mutates state   │
   │     state.crystalPool += pickedUp                          │
   │     state.phase = "exploring" → "boss" → "cleared"         │
   │                                                            │
   │           ┌─────────────────────────────────────┐          │
   │           │   ZERO Postgres writes during this  │          │
   │           │   entire phase. State is only in    │          │
   │           │   Colyseus schema (RAM).            │          │
   │           └─────────────────────────────────────┘          │
   │                                                            │
   ▼                                                            ▼
                                              ┌──────────────────────┐
                                              │  onDispose()         │
                                              │                      │
                                              │  BEGIN;              │
                                              │  INSERT seed (if new)│
                                              │  UPDATE players      │
                                              │    SET crystals=...  │
                                              │  INSERT scores       │
                                              │    (one per player)  │
                                              │  COMMIT;             │
                                              └──────────────────────┘
```

### Key Interfaces

```ts
// server/rooms/DungeonRoom.ts
export class DungeonRoom extends Room<GameState> {
  async onDispose() {
    const cleared = this.state.phase === 'cleared';
    const playerCount = this.state.players.size;
    const crystalsPerPlayer = cleared
      ? Math.floor(this.state.crystalPool / playerCount)
      : Math.floor(this.state.crystalPool * 0.75 / playerCount); // 25% penalty on fail

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert seed (idempotent)
      const seedRes = await client.query(
        `INSERT INTO seeds (seed, creator, published)
         VALUES ($1, $2, true)
         ON CONFLICT (seed) DO UPDATE SET published = true
         RETURNING id`,
        [this.state.seed, this.findHostUsername()]
      );
      const seedId = seedRes.rows[0].id;

      // Per-player updates
      for (const [, player] of this.state.players) {
        await client.query(
          `UPDATE players
              SET crystals = crystals + $1,
                  journey_level = GREATEST(journey_level, $2)
            WHERE username = $3`,
          [crystalsPerPlayer, cleared ? this.state.journeyLevelEarned : 0, player.username]
        );
        if (cleared) {
          await client.query(
            `INSERT INTO scores
               (seed_id, username, score, clear_time, party_size, zero_deaths)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [seedId, player.username, this.computeScore(player),
             this.state.elapsed | 0, playerCount, this.state.zeroDeaths]
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[DungeonRoom.onDispose] persistence failed:', err);
      // Jam tolerance: log and move on. Run is lost.
    } finally {
      client.release();
    }
  }
}
```

### Implementation Guidelines

- **Never** write to Postgres outside `onDispose()`. If you find yourself wanting to, refactor to push the write into the dispose path.
- Use a single explicit transaction (`BEGIN; ... COMMIT;`)
- Always release the connection in `finally`
- On error, log and continue — do not crash the room (it's already disposing)
- Run Lifecycle module **must not** import `pg` or `pool` — it stays pure for testability

## Alternatives Considered

### Alternative 1: Per-room-clear writes

- **Description**: Each time a room is cleared in the dungeon, write progress
- **Pros**: Granular tracking; partial credit on failure
- **Cons**: ~5-10x more writes per run; partial-state risk; complicates rollback semantics
- **Estimated Effort**: Higher
- **Rejection Reason**: No clear benefit for jam scope; one atomic transaction is simpler

### Alternative 2: Per-frame snapshot writes

- **Description**: Periodic state snapshots to DB
- **Pros**: Crash recovery
- **Cons**: Massive DB load; defeats free-tier
- **Estimated Effort**: Higher
- **Rejection Reason**: Out of scope and unnecessary

### Alternative 3: Client-side LocalStorage backup as fallback

- **Description**: Mirror the dispose write into client LocalStorage so a server crash mid-run can be recovered
- **Pros**: Recoverable
- **Cons**: Adds client logic; trust issues (client-authored data); cheating vector
- **Estimated Effort**: Medium
- **Rejection Reason**: Server-authoritative principle (ADR-0004) prohibits trusting client data; jam tolerates the loss

## Consequences

### Positive

- One write per run = minimal DB load (jam free tier safe)
- Atomic per-run records — no partial state
- Run Lifecycle is testable in isolation (no DB dependency)
- Clear ownership: only `onDispose()` touches the DB

### Negative

- Server crash mid-run = lost data for that run (acceptable)
- All score/crystal logic must be deferable until run end (no live leaderboard updates during a run)

### Neutral

- Forces a clean separation between gameplay state (Colyseus) and persistence (Postgres)

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `onDispose()` not called (server crash) | Medium | Low | Accept jam loss; log to console for debugging |
| Transaction fails partway through | Low | Medium | ROLLBACK in catch block; log; do not crash |
| Connection pool exhausted at jam load | Low | High | Pool size 10; release in `finally`; monitor at jam launch |
| Race condition: two runs disposing simultaneously try to upsert the same seed | Low | Low | `ON CONFLICT (seed) DO UPDATE` is the safety net |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Writes per run | N/A | 1 transaction (3-7 statements) | 1 transaction |
| Write latency | N/A | 20-50 ms | < 200 ms |
| DB connections in use | N/A | 1 brief (per dispose) | < 10 (pool max) |

## Migration Plan

N/A — greenfield.

**Rollback plan**: If we discover a need for partial writes (e.g. live leaderboard), supersede with a new ADR. Likely a per-room-clear write pattern.

## Validation Criteria

- [ ] No `pool.query` or `client.query` calls outside `server/rooms/DungeonRoom.ts:onDispose()` and `server/routes/`
- [ ] Run Lifecycle module does not import `pg` or `pool`
- [ ] Disposing a room successfully writes one transaction
- [ ] A failed dispose logs and does not crash the server
- [ ] Connection pool returns to baseline after each dispose

## GDD Requirements Addressed

| GDD Document | System | Requirement | How This ADR Satisfies It |
|---|---|---|---|
| design/gdd/game-concept.md | Persistence | "Persistent, no permadeath" | onDispose writes survive server restart |
| design/gdd/game-concept.md | Score | "Per-seed leaderboard" | scores rows inserted at dispose feed the leaderboard |
| design/gdd/game-concept.md | Run | "Failed run: keep loot collected, -25% crystal penalty" | onDispose computes the 0.75x multiplier on fail |

## Related

- ADR-0002 (Colyseus) — defines the room lifecycle
- ADR-0003 (Railway Postgres) — the target DB
- ADR-0004 (server-authoritative combat) — server is the canonical writer
- design/gdd/systems-index.md → Run Lifecycle, Persistence Layer (Run Lifecycle stays pure thanks to this ADR)

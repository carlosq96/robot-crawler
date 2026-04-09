# ADR-0002: Colyseus over SpacetimeDB / WebRTC for multiplayer

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Robot Crawler needs server-authoritative multiplayer for 1-3 player co-op dungeon sessions. We use **Colyseus 0.15** self-hosted on Railway because the room model maps perfectly onto dungeon runs, the schema sync is binary-efficient, and TypeScript end-to-end matches our existing skill set within a 23-day jam timeline.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Three.js (client) + Node.js (server, Colyseus 0.15) |
| **Domain** | Networking |
| **Knowledge Risk** | LOW — Colyseus 0.15 is well-documented pre-cutoff |
| **References Consulted** | docs/engine-reference/colyseus/COLYSEUS-0.15.md |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Smoke test: 3 clients can join one room and exchange state in <100ms RTT |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0001 (no bundler — affects how @colyseus/sdk is loaded on client) |
| **Enables** | ADR-0004 (server-authoritative combat), ADR-0006 (Postgres on dispose) |
| **Blocks** | Lobby System, In-Room Sync (cannot start until decided) |
| **Ordering Note** | Must be locked before designing the multiplayer GDDs |

## Context

### Problem Statement

The game ships with co-op as a Pillar (game-concept.md → Pillar 3 "Co-op is Pure Cooperation"). We need a multiplayer architecture that:
- Supports 1-3 players in a session (one room per dungeon run)
- Is server-authoritative (no PvP, no cheats, server runs Rapier physics)
- Has efficient state sync (low bandwidth, deterministic)
- Can be self-hosted on Railway free tier
- Is implementable by a solo developer in 23 days

### Current State

Greenfield project; no networking code exists.

### Constraints

- 23-day jam timeline
- Solo developer
- Existing TypeScript/Node experience; no Rust experience
- Railway free tier (~500 hours/month, ~512 MB RAM)
- Must integrate with @dimforge/rapier3d-compat physics (server-side)

### Requirements

- Room creation, join via code, join random
- Maximum 3 players per room
- Binary-efficient state sync (target <10 KB/s per client at 30 Hz)
- Disconnect/reconnect handling with grace period
- Server-side game logic execution (intent → validate → apply → broadcast)

## Decision

Use Colyseus 0.15 server self-hosted on Railway Node.js buildpack, with `@colyseus/sdk` as the client library and `@colyseus/schema` for binary state sync.

### Architecture

```
                            Railway
                          ┌─────────────┐
                          │  Postgres   │  ← ADR-0003
                          └──────┬──────┘
                                 │
                          ┌──────▼──────┐
   Vercel ────WS───────►  │  Colyseus   │
   (client static)         │  Server     │
                           │  ┌────────┐ │
                           │  │ Room A │ │ ← max 3 players, fixed 1/60 tick
                           │  │ Room B │ │
                           │  └────────┘ │
                           └─────────────┘

   Each Room owns:
     - GameState schema (players, enemies, pickups, phase)
     - Rapier physics world (server-authoritative)
     - Run Lifecycle state machine (pure, see ADR-0004)
     - onDispose() → write to Postgres (see ADR-0006)
```

### Key Interfaces

```ts
// server/rooms/DungeonRoom.ts
class DungeonRoom extends Room<GameState> {
  maxClients = 3;
  async onCreate(options: { seed: string }) { ... }
  onJoin(client: Client, options: { username: string }) { ... }
  onLeave(client: Client) { ... }  // grace period for reconnect
  async onDispose() { ... }  // ADR-0006: write to Postgres here
}
```

```js
// src/networking/client.js (or .ts per ADR-0008)
import { Client } from '@colyseus/sdk';
const client = new Client('wss://robot-crawler-server.up.railway.app');
const room = await client.joinOrCreate('dungeon', { seed, username });
room.state.players.onAdd((player, sessionId) => { ... });
room.send('shoot', { dirX, dirY, dirZ });
```

### Implementation Guidelines

- One Colyseus Room class per game mode (only `DungeonRoom` for jam v1)
- All gameplay state lives in the schema, NOT in plain class properties
- Server tick runs at 1/60 (matches ADR-0007 fixed Rapier timestep)
- Client never trusts server predicted state — server is canonical (ADR-0004)
- See `docs/engine-reference/colyseus/COLYSEUS-0.15.md` for schema patterns and footguns

## Alternatives Considered

### Alternative 1: SpacetimeDB

- **Description**: Modern, Rust-based, integrated DB+sync platform
- **Pros**: One tool for state + persistence; excellent performance; growing ecosystem
- **Cons**: Rust required for module code; learning curve; less mature TS client
- **Estimated Effort**: 2-3x baseline due to Rust ramp-up
- **Rejection Reason**: 23-day jam timeline does not accommodate learning Rust + new platform simultaneously

### Alternative 2: Geckos.io / WebRTC peer-to-peer

- **Description**: Peer-to-peer UDP via WebRTC data channels
- **Pros**: Lowest latency (no server hop)
- **Cons**: No authoritative server (cheating risk); no built-in lobby/state sync; NAT traversal pain
- **Estimated Effort**: Low transport, high gameplay logic (have to implement everything)
- **Rejection Reason**: Server authority is non-negotiable; we ship publicly and cannot tolerate cheating

### Alternative 3: Custom WebSocket server

- **Description**: Plain `ws` package, custom protocol
- **Pros**: Maximum control
- **Cons**: Reinventing room/lobby/state sync; lots of boilerplate
- **Estimated Effort**: High
- **Rejection Reason**: Why reimplement what Colyseus already does well

## Consequences

### Positive

- TypeScript end-to-end (server + client + schemas)
- Binary delta sync via @colyseus/schema = efficient bandwidth
- Room model maps 1:1 to dungeon runs
- Built-in lobby semantics (matchMaker, room codes)
- Active maintenance, mature, production-proven

### Negative

- Self-hosted: Railway uptime is our problem
- Tied to Colyseus's specific schema patterns (mild lock-in)
- Schema mutations have gotchas (must use `.set()` on MapSchema, etc.)

### Neutral

- One Node.js process running 24/7 on Railway
- Schema files are shared between client and server (via TypeScript path config)

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Railway free tier hours run out mid-jam | Low | High | Monitor monthly usage; cold-start servers when no players |
| Colyseus schema migration mid-jam (we change a field shape) | Medium | Medium | Lock schema early; only additive changes after |
| Disconnect/reconnect grace period bugs | Medium | Medium | Smoke test the disconnect flow on day 1 of multiplayer implementation |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Server CPU per room | N/A | 5-10% (1 vCPU) | < 25% |
| Server memory per room | N/A | 50-100 MB | < 200 MB |
| Network per client | N/A | 5-10 KB/s at 30 Hz | < 30 KB/s |
| Round-trip latency | N/A | 50-150 ms typical | < 300 ms |

## Migration Plan

N/A — greenfield.

**Rollback plan**: If Colyseus proves unworkable, the fallback is solo-only mode (cut multiplayer entirely). Run Lifecycle stays usable as a single-player state machine (ADR-0004 architecture supports this).

## Validation Criteria

- [ ] 3 clients can join one room and see each other's positions sync within 100 ms
- [ ] Disconnecting a client leaves the room valid for the remaining 2
- [ ] Reconnecting within grace period restores spectator-mode state
- [ ] `onDispose()` writes to Postgres successfully (ADR-0006 integration)
- [ ] Server-authoritative damage: a hacked client cannot inflate score

## GDD Requirements Addressed

| GDD Document | System | Requirement | How This ADR Satisfies It |
|---|---|---|---|
| design/gdd/game-concept.md | Multiplayer | "Co-op 1-3 players" (Pillar 3) | Colyseus rooms with maxClients=3 |
| design/gdd/game-concept.md | Multiplayer | "Disconnect handling: kicked to lobby with reconnect option" | Colyseus `allowReconnection` API + spectator mode |
| design/gdd/game-concept.md | Run Lifecycle | "Server authoritative" | Colyseus room runs simulation; clients send intents only |

## Related

- ADR-0001 (no bundler) — affects @colyseus/sdk loading via importmap
- ADR-0004 (server-authoritative combat) — Colyseus is the enabling layer
- ADR-0006 (Postgres on dispose) — writes happen in Colyseus Room.onDispose()
- ADR-0007 (fixed Rapier timestep) — server tick must match physics step

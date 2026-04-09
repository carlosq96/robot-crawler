# ADR-0004: Server-authoritative combat (no client trust)

## Status

**Superseded** — 2026-04-09 by the Space Runner pivot. This ADR depended on
ADR-0002 (Colyseus) and existed to protect multiplayer combat from client
cheating. The pivot to a solo endless runner removes all multiplayer
combat, so server-authoritative combat is no longer applicable. Space
Runner runs all gameplay logic client-side; the only server interaction is
a single HTTP POST to the leaderboard at run-end.

**Leaderboard integrity note:** Because combat now runs client-side, a
determined cheater could inflate their leaderboard score by modifying the
POST payload. For a free jam with no stakes, this is an accepted risk. A
simple mitigation is a server-side sanity cap (reject distance values
beyond a plausibility threshold). If anti-cheat becomes important
post-jam, this ADR's reasoning is a valid starting point for a revival.

## Date

2026-04-08 (Accepted)
2026-04-09 (Superseded)

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

All combat resolution — damage application, hit detection, lock-on validation, death — runs on the Colyseus server. Clients send **intents** (shoot, move, use sub-weapon); the server validates, simulates, and broadcasts results. This prevents cheating without requiring runtime anti-cheat infrastructure.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Node.js server + Rapier 3D (server-side physics) |
| **Domain** | Networking + Gameplay |
| **Knowledge Risk** | LOW — well-known pattern in multiplayer game dev |
| **References Consulted** | docs/engine-reference/colyseus/COLYSEUS-0.15.md, docs/engine-reference/rapier/RAPIER-0.14.md |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Server-side raycast hit registration matches client-side prediction within tolerance |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0002 (Colyseus), ADR-0007 (fixed Rapier timestep — needed for deterministic server simulation) |
| **Enables** | All combat-related GDDs (Buster Combat, Sub-Weapon, Enemy AI) |
| **Blocks** | Buster Combat GDD, In-Room Sync GDD |
| **Ordering Note** | Must be locked before designing combat systems |

## Context

### Problem Statement

The game ships publicly. Trusted clients = trivial cheating (modify damage in browser devtools, instant-kill enemies, infinite revives, fake leaderboard scores). For a jam project we cannot afford runtime anti-cheat detection. The architectural answer is: never trust the client.

### Current State

Greenfield project; no combat code exists.

### Constraints

- Solo developer (no time for VAC-style anti-cheat)
- Public deployment (cheaters can DM us about it)
- Per-seed leaderboards = strong cheating incentive
- Latency tolerance: combat must feel responsive at <150 ms RTT

### Requirements

- Server is canonical for: HP, damage, hits, kills, deaths, revives, crystals, score
- Client may **predict** locally for responsiveness but must reconcile with server state
- All gameplay-critical messages are server-validated
- Cheating requires compromising the Railway server (out of scope)

## Decision

The Colyseus server runs the Rapier physics simulation, executes the Run Lifecycle state machine, validates all client intents, and broadcasts the resulting state via @colyseus/schema. Clients render server state and send only intents.

### Architecture

```
┌────────────┐                          ┌──────────────┐
│  Client A  │                          │ Colyseus     │
│            │                          │ DungeonRoom  │
│  ┌──────┐  │  ─── intent: "shoot" ───▶│              │
│  │Input │  │                          │  ┌────────┐  │
│  └──────┘  │  ─── intent: "move"  ───▶│  │Validate│  │
│            │                          │  └───┬────┘  │
│  ┌──────┐  │                          │      │        │
│  │ Pre- │  │                          │  ┌───▼────┐  │
│  │ dict │  │  ◀── state delta ──────  │  │Rapier  │  │
│  └──────┘  │      (binary, 30Hz)      │  │ World  │  │
│            │                          │  └───┬────┘  │
│  ┌──────┐  │                          │      │        │
│  │Render│  │                          │  ┌───▼────┐  │
│  └──────┘  │                          │  │ State  │  │
└────────────┘                          │  │ Schema │  │
                                        │  └────────┘  │
                                        └──────────────┘
```

### Key Interfaces

```ts
// Client sends intents only — never authoritative state
room.send('shoot', { dirX, dirY, dirZ });
room.send('move', { x: 1, z: 0 });
room.send('use-sub-weapon', { dirX, dirY, dirZ });
room.send('charge-start', {});
room.send('charge-release', {});

// Server validates and applies
this.onMessage('shoot', (client, msg) => {
  const player = this.state.players.get(client.sessionId);
  if (!player || player.downed) return;                    // dead/down can't shoot
  if (this.now() - player.lastShotMs < BUSTER_COOLDOWN) return; // cooldown check
  // Server-side raycast against the canonical Rapier world
  const ray = new RAPIER.Ray(player.pos, normalize(msg));
  const hit = this.world.castRay(ray, BUSTER_RANGE, true);
  if (hit?.collider.userData.type === 'enemy') {
    const enemy = this.state.enemies.get(hit.collider.userData.id);
    enemy.hp -= player.busterDamage;
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }
  player.lastShotMs = this.now();
});

// Client renders the server-broadcast state
room.state.enemies.onChange((enemy, id) => {
  enemyMeshes[id].position.set(enemy.x, enemy.y, enemy.z);
  enemyMeshes[id].setHP(enemy.hp);  // updates floating health bar
});
```

### Implementation Guidelines

- **Never** mutate gameplay state from a client message handler without validation
- Cooldowns, ranges, line-of-sight, target validity must all be re-checked server-side
- Client may render predicted state for own player movement (latency hiding) but must reconcile when server state arrives
- Damage numbers, hit VFX, screen shake are client-side feedback (visual only) — they must trigger from server-broadcast state changes, not local input
- Score is computed server-side at run end; clients display the value the server sends

## Alternatives Considered

### Alternative 1: Client-authoritative

- **Description**: Each client owns its own player; broadcasts its own position/HP/damage
- **Pros**: Lowest server CPU; fastest perceived input
- **Cons**: Trivial to cheat; instant-kill is one devtools edit away
- **Estimated Effort**: Lowest
- **Rejection Reason**: Public jam = cheaters will find it; leaderboards become meaningless

### Alternative 2: Mixed authority

- **Description**: Client owns own player movement; server owns enemies, damage, score
- **Pros**: Better input feel for player movement
- **Cons**: Mixed authority is the hardest to debug; "who owns this state?" becomes a constant question
- **Estimated Effort**: Medium-high
- **Rejection Reason**: Solo dev — pick the simpler model

### Alternative 3: Replay-based anti-cheat

- **Description**: Client owns everything but server replays the run from input log to verify
- **Pros**: Cheap server CPU during the run
- **Cons**: Massive complexity; cheaters can hack the replay too
- **Estimated Effort**: High
- **Rejection Reason**: Way out of jam scope

## Consequences

### Positive

- Cheating requires compromising the server (out of jam scope = effectively safe)
- One source of truth for game state (no desync)
- Leaderboards are credible
- Forces clean separation of "input intent" vs "world state" (good architecture)

### Negative

- Server CPU is higher (Rapier physics + AI runs server-side)
- Network latency affects responsiveness — must mitigate with client prediction for own-player movement
- More server code (gameplay logic moves from client to server)

### Neutral

- Client becomes a "view + input" layer
- Run Lifecycle state machine (ADR-0006 / Run Lifecycle GDD) is naturally server-side

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Server CPU exceeds Railway free tier under load | Medium | High | Profile early; cap rooms-per-instance; cull off-screen enemies from server simulation |
| Client prediction reconciliation looks janky | High | Medium | Test on day 1 of multiplayer impl; adjust prediction smoothness; accept rubberbanding for low-latency tier |
| A subtle validation bypass becomes a cheat vector | Medium | Medium | Code review every `onMessage` handler; defense-in-depth (cooldown + range + LOS) |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Server CPU per room (3 players, 30 enemies) | N/A | 5-10% | < 25% |
| Server tick frequency | N/A | 60 Hz physics, 30 Hz network broadcast | n/a |
| Client input → visual feedback latency (predicted) | N/A | < 16 ms | < 33 ms |
| Client input → server-confirmed feedback latency | N/A | 50-150 ms | < 250 ms |

## Migration Plan

N/A — greenfield. All combat starts server-authoritative.

**Rollback plan**: There is no rollback. If server CPU is insufficient, scale up Railway tier (paid) before sacrificing authority.

## Validation Criteria

- [ ] A modified client cannot inflate own damage (verified by manual test: hack the buster damage number, observe server rejects/ignores)
- [ ] A modified client cannot grant itself crystals
- [ ] Server-side hit detection matches client-side prediction within ~30 ms tolerance for 90% of shots at <100 ms RTT
- [ ] Score on leaderboard matches server's authoritative score

## GDD Requirements Addressed

| GDD Document | System | Requirement | How This ADR Satisfies It |
|---|---|---|---|
| design/gdd/game-concept.md | Combat | "Buster Combat" pillar | Server validates every shot; clients only render |
| design/gdd/game-concept.md | Multiplayer | "No PvP, no grief" (Pillar 3) | Server arbitrates all damage; no player-vs-player vector |
| design/gdd/game-concept.md | Score | "Per-seed leaderboard" | Score is server-computed; cheating leaderboards requires server compromise |

## Related

- ADR-0002 (Colyseus) — the transport that makes server authority possible
- ADR-0007 (fixed Rapier timestep) — required for deterministic server simulation
- ADR-0006 (Postgres on dispose) — server writes its authoritative result, not the client's claim
- design/gdd/systems-index.md → Buster Combat, Sub-Weapon, In-Room Sync, Run Lifecycle systems

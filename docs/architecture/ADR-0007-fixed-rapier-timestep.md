# ADR-0007: Fixed Rapier timestep (1/60 with accumulator)

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Rapier 3D physics is stepped at a fixed 1/60-second interval using the accumulator pattern, on both the server and the client. This produces deterministic simulation, which is required for multiplayer state sync (ADR-0004) and for the deterministic-seed promise of the Dungeon Generator.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | @dimforge/rapier3d-compat 0.14 |
| **Domain** | Physics / Core loop |
| **Knowledge Risk** | LOW — accumulator pattern is decades-old; Rapier docs recommend it explicitly |
| **References Consulted** | docs/engine-reference/rapier/RAPIER-0.14.md |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Identical seeded simulation produces identical state across runs |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0001 (no bundler — Rapier loaded via importmap) |
| **Enables** | ADR-0004 (server-authoritative combat needs deterministic server simulation) |
| **Blocks** | All physics-based gameplay GDDs |
| **Ordering Note** | Must be locked before Engine Bootstrap GDD (which sets up the main loop) |

## Context

### Problem Statement

Rapier supports any timestep, but the simulation is **only deterministic with a fixed timestep**. Variable timestep means: same inputs + same seed → different outputs. For Robot Crawler this breaks two things:
1. **Multiplayer sync** — server and clients diverge over time
2. **Seed-based dungeon promise** — same seed should produce identical enemy AI behavior in replays

### Current State

Greenfield; no main loop exists.

### Constraints

- Frame budget 16.6 ms total (60 fps target on mid-range laptop)
- Must work on lower-end machines too (variable render rate)
- Server runs Colyseus tick at fixed interval (1000 ms / 60 = 16.67 ms)

### Requirements

- Physics step at exactly 1/60 second
- Visual rendering can run at native frame rate (decoupled from physics)
- Same seed + same inputs = same simulation (determinism)
- No physics step ever uses a variable `dt`

## Decision

Use the accumulator pattern. Each frame, accumulate elapsed real time. While the accumulator exceeds 1/60, step Rapier and subtract. Render after stepping. Server uses the same pattern in its Colyseus simulation interval.

### Architecture

```
Frame N (real elapsed: 22 ms)
  │
  │  accumulator += 0.022      → accumulator = 0.022
  │  while (accumulator >= 1/60):
  │      world.step()          → physics tick #1
  │      accumulator -= 1/60   → accumulator = 0.005
  │  syncMeshesToBodies()
  │  renderer.render(scene, camera)
  │
Frame N+1 (real elapsed: 14 ms)
  │
  │  accumulator += 0.014      → accumulator = 0.019
  │  while (accumulator >= 1/60):
  │      world.step()          → physics tick #2
  │      accumulator -= 1/60   → accumulator = 0.003
  │  syncMeshesToBodies()
  │  renderer.render(scene, camera)
```

### Key Interfaces

```ts
// src/main.ts (or .js per ADR-0008)
import RAPIER from '@dimforge/rapier3d-compat';
import { initScene, render } from './engine/scene.js';
import { initWorld, syncMeshesToBodies } from './engine/physics.js';

await RAPIER.init();
const world = initWorld();
const { scene, camera, renderer } = initScene();

const FIXED_DT = 1 / 60;
let accumulator = 0;
let lastTime = performance.now();

function frame(now: number) {
  const elapsedSec = (now - lastTime) / 1000;
  lastTime = now;

  accumulator += elapsedSec;

  // Cap accumulator to prevent spiral-of-death on tab regain
  if (accumulator > 0.25) accumulator = 0.25;

  while (accumulator >= FIXED_DT) {
    world.step();
    accumulator -= FIXED_DT;
  }

  syncMeshesToBodies();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

```ts
// server/rooms/DungeonRoom.ts
async onCreate() {
  await RAPIER.init();
  this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  // Colyseus simulation interval — fixed 1/60
  this.setSimulationInterval((deltaMs) => {
    const dt = deltaMs / 1000;
    this.accumulator += dt;
    while (this.accumulator >= 1/60) {
      this.world.step();
      RunLifecycle.tick(this.state, 1/60);
      this.accumulator -= 1/60;
    }
  }, 1000 / 60);
}
```

### Implementation Guidelines

- **Never** call `world.step(dt)` with a variable `dt`. Always use the default fixed step.
- The accumulator is per-room (server) or per-window (client) — never shared
- Cap accumulator at 0.25 sec (15 frames) to prevent spiral-of-death after tab unfocus
- Render is decoupled — happens after physics, at native rate
- Visual interpolation between physics states is **optional** for jam (might add later if jitter is visible)

## Alternatives Considered

### Alternative 1: Variable timestep (`world.step(dt)` with real elapsed)

- **Description**: Pass real elapsed time directly to Rapier
- **Pros**: Simpler one-line loop
- **Cons**: Non-deterministic; multiplayer desync; replay determinism broken
- **Estimated Effort**: Lowest
- **Rejection Reason**: Breaks multiplayer (ADR-0004) and dungeon-seed promise

### Alternative 2: Fixed 1/30 timestep (slower step rate)

- **Description**: Step physics at 30 Hz instead of 60 Hz
- **Pros**: Half the CPU cost
- **Cons**: Combat feels laggy; collision detection misses fast-moving projectiles
- **Estimated Effort**: Same
- **Rejection Reason**: Combat is the pillar; can't compromise feel

### Alternative 3: Fixed 1/120 timestep (faster step rate)

- **Description**: Step physics at 120 Hz for smoother feel
- **Pros**: Even smoother
- **Cons**: 2x CPU cost; marginal benefit at 60 fps render
- **Estimated Effort**: Same CPU pain
- **Rejection Reason**: Cost > benefit at jam scale

## Consequences

### Positive

- Deterministic physics
- Multiplayer-safe (server and clients can match each other)
- Replay-able if we ever add it post-jam
- Render decoupled from physics (smooth render even if physics is at 60Hz)

### Negative

- Spiral-of-death risk if frame budget is exceeded (mitigated by 0.25 sec accumulator cap)
- Slight visual jitter possible without interpolation (acceptable for jam)
- Cannot use variable-step Rapier APIs

### Neutral

- Render and physics decouple naturally
- Animation playback uses real elapsed time (separate from physics)

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Tab unfocus → accumulator spiral | High | Medium | Cap accumulator at 0.25 sec |
| Physics CPU exceeds 16ms on low-end machines | Medium | Medium | Profile early; cap enemy count per room; cull off-screen physics |
| Server simulation drifts from client | Low | Medium | Both use the same fixed step + same seed; audit if observed |
| Animation/physics desync due to different time bases | Low | Low | Animations use real elapsed time; physics uses fixed; sync at frame end |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Physics step CPU (per step) | N/A | 3-4 ms (30 bodies) | < 8 ms |
| Steps per frame (typical) | N/A | 1 (when frame ~16 ms) | 1-2 |
| Steps per frame (worst case) | N/A | 2 at 30 fps render | < 4 |
| Total physics CPU per second | N/A | ~180-240 ms (60 steps × 3-4 ms) | < 480 ms |

## Migration Plan

N/A — greenfield.

**Rollback plan**: If determinism turns out unnecessary, we could switch to variable timestep, but this would require also rewriting ADR-0004's server/client sync model. Cost: high. Unlikely.

## Validation Criteria

- [ ] Same seed + same input log → same final state (verified by replay test)
- [ ] Server and client physics state agree within 1 mm tolerance after 60 seconds of simulation
- [ ] Tab unfocus and refocus does NOT cause physics to "catch up" with hundreds of steps
- [ ] Frame time budget held: physics CPU < 8 ms in 95th percentile

## GDD Requirements Addressed

| GDD Document | System | Requirement | How This ADR Satisfies It |
|---|---|---|---|
| design/gdd/game-concept.md | Dungeon | "Same seed = same dungeon for everyone" | Deterministic physics → deterministic enemy AI → reproducible runs |
| design/gdd/game-concept.md | Multiplayer | "Server-authoritative" | Server can serve as canonical simulation only because timestep is fixed |
| design/gdd/game-concept.md | Combat | "Buster combat must feel crunchy" | 60 Hz physics keeps hit detection responsive |

## Related

- ADR-0002 (Colyseus) — server uses the same step rate
- ADR-0004 (server-authoritative combat) — requires deterministic server simulation
- docs/engine-reference/rapier/RAPIER-0.14.md → "Footguns: Variable timestep — non-deterministic, will desync multiplayer"

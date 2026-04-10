# Quick Design Spec: Obstacle System

**Type**: New Small System
**Scope**: Spawnable hazards placed by Track Generator on the running track. Each obstacle has a type, mesh, Rapier sensor collider, and damage-on-touch behaviour. Some are flagged breakable (destroyable by Super-Suit Combat). The system does NOT know where obstacles go (Track Generator does) and does NOT know about player HP (Player System's `takeDamage` does).
**Date**: 2026-04-09
**Estimated Implementation**: ~3 hours (M effort)

---

## Overview

Obstacle System is a factory + registry for hazards. It reads a data-driven definition file (`assets/data/obstacles.json`) that maps a `type` string (e.g. `"boulder"`) to a template describing its mesh, collider shape/size, damage value, and breakable flag. Track Generator calls `spawn(type, x, y, z)` to place obstacles; the system creates the mesh + sensor collider + internal bookkeeping, then returns a handle. On player-obstacle sensor intersection, the system triggers `player.takeDamage(amount)` and plays a hit SFX.

Obstacles are **sensors**, not solid colliders. The player passes through them physically (maintaining auto-run speed), but takes damage + triggers a brief invulnerability window to prevent multi-hit chains from the same obstacle.

---

## Core Rules

### 1. Data-driven obstacle definitions

`assets/data/obstacles.json` defines all obstacle types. Each type has:
```json
{
  "boulder": {
    "mesh":    { "shape": "box", "size": [1.5, 1.5, 1.5], "color": "#6a5a3f" },
    "collider": { "shape": "cuboid", "halfExtents": [0.75, 0.75, 0.75] },
    "damage":  15,
    "breakable": true,
    "sfxHit":  "obstacle_hit_rock"
  }
}
```

For v1 all meshes are Three.js primitives (box / cylinder / sphere). GLB model swaps come later.

### 2. Spawn

```ts
obstacleSystem.spawn('boulder', x, y, z): ObstacleHandle
```

Creates:
- Three.js mesh from `mesh` spec, positioned at `(x, y, z)`, added to scene
- Rapier **sensor** collider (isSensor = true) at same position, matching `collider` spec
- Collider `userData = { kind: 'obstacle', handle }` so sensor-hit callbacks can look up the obstacle
- Entry in internal `Map<ObstacleHandle, ObstacleEntity>` for later despawn

Returns the handle.

### 3. Despawn

```ts
obstacleSystem.despawn(handle): void
```

Removes mesh from scene. Removes collider from Rapier world. Removes entry from map. Idempotent.

### 4. Sensor intersection → instant death (on-touch death model)

**Locked decision 2026-04-09: Space Runner uses a one-hit death model.** Any
obstacle touch kills the player. There is no HP bar, no hit invulnerability,
no staggered damage — touching an obstacle ends the run immediately.

The system registers a single `engine.onBeforeStep` tick that iterates pending
sensor intersection events from the previous Rapier step. For each hit between
an obstacle collider and the player's capsule:

1. If player is already dead (`player.isAlive() === false`), skip — prevents
   double-death events from dense chunks hit in the same tick.
2. Call `player.takeDamage(999)` — any large value triggers the
   `alive → dead` transition since `maxHp: 1`.
3. Emit `onObstacleHit(type)` event for score stats and HUD feedback.
4. Play `sfxHit` via Audio System.

### 5. ~~Hit invulnerability window~~ — REMOVED

Removed in the on-touch death simplification. No invulnerability needed when
one hit kills you. The `hitIWindow` tuning knob is gone. The gating check is
simply "is the player still alive?".

### 6. Breakable obstacles

If `breakable: true`, the obstacle can be destroyed by Super-Suit Combat's `attack()` call. Super-Suit Combat iterates obstacles within its attack cone, filters by `breakable === true`, calls `obstacleSystem.despawn(handle)` on each, and emits `onObstacleBroken(type)` for score.

Super-Suit Combat needs a query: `getObstaclesInRange(origin, radius): ObstacleHandle[]`. System exposes this via an AABB check against the stored obstacle positions.

### 7. Obstacle type pool (v1)

All obstacles are lethal on touch. The `damage` field no longer matters —
any value kills the player. Kept in the data file as metadata for post-jam
return to HP-based if we ever revisit. For v1 it is ignored.

| Type | Biome affinity | Breakable | Mesh primitive |
|---|---|---|---|
| `boulder` | rocky | yes | 1.5³ grey box |
| `ice_pillar` | ice | yes | 0.6r × 2.5h cyan cylinder |
| `crevasse` | rocky | no | 2×0.1×2 dark box in ground |
| `lava_pit` | volcanic | no | 2×0.1×2 red emissive box |
| `icicle` | ice | yes | 0.3r × 1.5h white cone |
| `steam_jet` | volcanic | no | 0.5r × 2h white cylinder (blinks on timer) |
| `low_arch` | any | no | 3×0.3×0.5 crossbeam at shoulder height (requires slide to pass) |

7 types, all from primitives, no assets needed.

### 8. Dispose

Tears down all active obstacles + unregisters the intersection handler. Idempotent.

---

## Public API Surface (LOCKED contract)

```ts
export type ObstacleHandle = number;

export interface ObstacleSystem {
  spawn(type: string, x: number, y: number, z: number): ObstacleHandle;
  despawn(handle: ObstacleHandle): void;
  getObstaclesInRange(origin: THREE.Vector3, radius: number): ObstacleHandle[];
  getObstacleType(handle: ObstacleHandle): string | null;
  isBreakable(handle: ObstacleHandle): boolean;
  onObstacleHit(cb: (type: string) => void): () => void;
  onObstacleBroken(cb: (type: string) => void): () => void;
  dispose(): void;
}

export function createObstacleSystem(
  engine: EngineHandle,
  player: Player,
  audio: AudioSystem,
  defs: ObstacleDefinitions,
  config: ObstacleSystemConfig,
): ObstacleSystem;
```

---

## Tuning Knobs

No tunable knobs in v1 — on-touch death model removed all tuning vectors.
Obstacle placement (which chunks, how dense) is the only difficulty lever
and lives in `assets/data/biomes/[biome].json` (Track Generator's domain,
not Obstacle System's).

---

## Data Files

- `assets/data/obstacles.json` — obstacle type definitions (mesh + collider + breakable). `damage` field kept for future but ignored in v1.

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Player System | Calls `player.takeDamage()` on hit | No change — existing API |
| Audio System | Plays hit SFX | No change — must ship first |
| Track Generator | Consumer of `spawn/despawn` API | API locked here |
| Super-Suit Combat | Queries `getObstaclesInRange`, calls `despawn` + reads `isBreakable` | API locked here |
| HUD | Subscribes to `onObstacleHit` for screen shake | Will be wired in HUD |

---

## Acceptance Criteria

- [ ] `spawn('boulder', 0, 0, -10)` creates a visible mesh + sensor collider
- [ ] Player running into a boulder triggers instant `alive → dead` transition
- [ ] After death, subsequent obstacle contacts are ignored (no double-fire)
- [ ] `despawn(handle)` removes mesh + collider cleanly (verify scene/world counts)
- [ ] `getObstaclesInRange(origin, 3.0)` returns only obstacles within that radius
- [ ] All 7 v1 obstacle types load from `obstacles.json` without error
- [ ] Dispose removes every spawned entity

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #10, L3, T1, M-effort. No update needed.

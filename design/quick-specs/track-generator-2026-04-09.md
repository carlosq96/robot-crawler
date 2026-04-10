# Quick Design Spec: Track Generator

**Type**: New Small System
**Scope**: Produce the linear forward-running terrain for a single planet segment in Space Runner. Given a biome + seed + planet index, lay out a deterministic sequence of pre-authored "obstacle chunks" along world -Z, spawn a jump-gate at the planet's end, stream chunks in ahead of the player and out behind. Does NOT own obstacle logic (Obstacle System does) or pickup logic (Pickup System does) — it only places them.
**Date**: 2026-04-09
**Estimated Implementation**: ~4 hours (M effort)

---

## Overview

Track Generator turns a `(biome, seed, planetIndex)` into a playable planet segment. At planet start it spawns the ground tiles, places invisible lateral walls, spawns the first N chunks of terrain ahead of the player, and places a jump-gate at the planet's end. As the player auto-runs forward, the generator streams new chunks in from the front and removes old chunks from behind. When the player crosses the jump-gate trigger, it fires `onJumpGateReached()` and awaits disposal; Planet/Checkpoint System then creates a fresh Track Generator for the next planet.

The generator is **producer-only**: it instantiates obstacles + pickups via their system factories, emits one event, and knows nothing about HP, scoring, or input.

The core design trick: **chunks are hand-authored JSON templates, not fully procedural.** Each biome has 5 pre-authored chunks; the generator picks from the pool using a seeded PRNG. Trades unbounded variety for guaranteed fairness and controllable difficulty.

---

## Core Rules

### 1. Track geometry is linear along -Z
- Player spawns at world origin `(0, y_spawn, 0)`.
- Track extends in world -Z.
- Track is bounded laterally at `x = ±8`.
- Ground is composed of per-chunk tiles — no shared ground mesh.

### 2. Planet length = 600 meters
- A planet ends at `z = -600` (50 seconds at 12 m/s forward speed).
- The jump-gate object sits at `z ≈ -600`. Crossing its trigger fires `onJumpGateReached()`.
- No planet extends beyond -600. The jump-gate IS the terminator.

### 3. Chunks are 20-meter fixed-length templates
- `CHUNK_LENGTH = 20 m`
- A planet has exactly `PLANET_LENGTH / CHUNK_LENGTH = 30 chunks`.
- **Chunk index 0** is always the safe intro chunk (empty, 1-2 seconds of orientation).
- **Chunk index 29** is always the jump-gate chunk (portal ring + trigger sensor, no obstacles).
- **Chunks 1..28** are selected from the biome's template pool via seeded PRNG.

### 4. Chunk pool per biome: 5 templates × 3 biomes = 15 hand-authored chunks
Each biome has `assets/data/biomes/[biome].json` containing a `chunks` array. Each chunk template defines:
- Obstacle placements: list of `{ type, x, z }` in chunk-local coordinates
- Pickup placements: list of `{ type, x, z }` in chunk-local coordinates
- Authoring constraint: **every chunk must have at least one clear lateral lane** the player can dodge into without collision

### 5. Deterministic chunk selection via seeded PRNG
```ts
function pickChunk(seed: string, planetIndex: number, chunkIndex: number, poolSize: number): number {
  const hash = hashString(`${seed}:${planetIndex}:${chunkIndex}`);
  return hash % poolSize;
}
```
Same `(seed, planetIndex, chunkIndex)` always produces the same chunk → unlocks future daily-seed leaderboards without a redesign.

### 6. Streaming: spawn ahead, despawn behind
- `CHUNKS_AHEAD = 4` — up to 4 chunks ahead of the player are spawned (80 m of visible track)
- `CHUNKS_BEHIND = 1` — up to 1 chunk behind is kept before despawn

Each fixed step, the generator computes the player's current chunk index from `player.body.translation().z`. On chunk-boundary crossing:
- Spawn the chunk at `playerChunkIndex + CHUNKS_AHEAD` if not yet spawned AND within `[0, 29]`
- Despawn the chunk at `playerChunkIndex - CHUNKS_BEHIND - 1` if it exists

Despawn = dispose obstacles + pickups + ground tile + remove from active-chunks map.

### 7. Lateral bounds: invisible walls at x = ±8
Two static Rapier box colliders spawned at planet start, no mesh:
- Left: `translation(-8.5, 1.5, -300)`, `halfExtents(0.5, 3, 300)`
- Right: `translation(+8.5, 1.5, -300)`, `halfExtents(0.5, 3, 300)`

Disposed with the generator.

### 8. Ground tile per chunk
Each chunk has its own 16 m × 20 m PBR box (width = track width, depth = chunk length). Biome config defines color + roughness. Each tile has its own static cuboid collider — no joined ground.

| Biome | Base color | Roughness | Notes |
|---|---|---|---|
| Rocky | `#55503a` | 0.9 | grey-brown, matte |
| Ice | `#c8d8e4` | 0.3 | pale blue, glossy |
| Volcanic | `#3a1a10` | 0.85 | dark, emissive veins (post-v1) |

### 9. Jump-gate chunk (index 29)
- No obstacles, no pickups.
- A glowing torus mesh at local `z = -18` — radius ~4 m, standing upright to frame the track.
- A sensor collider at `z = -18`: `halfExtents(8, 2.5, 0.5)` (full-width trigger, waist-high, thin in Z).
- On first intersection with the player capsule, calls `onJumpGateReached()` exactly once, then ignores further intersections.

### 10. Events
```ts
interface TrackGenerator {
  onJumpGateReached(cb: () => void): () => void;
}
```

### 11. Dispose
- Unsubscribes from `engine.onBeforeStep` (chunk streaming tick)
- Despawns all active chunks (obstacles, pickups, ground meshes, colliders)
- Removes lateral walls
- Clears event subscriber list
- Idempotent

---

## Public API Surface (LOCKED contract)

```ts
export interface TrackGeneratorConfig {
  biome: 'rocky' | 'ice' | 'volcanic';
  seed: string;
  planetIndex: number;
  planetLength: number;      // 600 m default
  chunkLength: number;       // 20 m default
  chunksAhead: number;       // 4 default
  chunksBehind: number;      // 1 default
  lateralBound: number;      // 8 default (walls at ±this)
}

export interface TrackGenerator {
  onJumpGateReached(cb: () => void): () => void;
  getActiveChunkCount(): number;
  getProgress(): number;       // 0..1 fraction of planet length
  dispose(): void;
}

export function createTrackGenerator(
  engine: EngineHandle,
  player: Player,
  obstacles: ObstacleSystem,
  pickups: PickupSystem,
  config: TrackGeneratorConfig,
): TrackGenerator;
```

`ObstacleSystem` and `PickupSystem` are forward-declared interfaces. Track Generator only needs `spawn(typeName, x, y, z): Handle` and `despawn(handle)` from each.

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `planetLength` | 600 m | 300–900 | pacing | 50 s at 12 m/s — "song length" per planet |
| `chunkLength` | 20 m | 10–40 | authoring | 1.67 s/chunk — meaningful pattern, 30 chunks/planet for variety |
| `chunksAhead` | 4 | 2–8 | perf/feel | 80 m visible track — player sees next danger with reaction time |
| `chunksBehind` | 1 | 0–3 | perf | 20 m safety margin before despawn |
| `lateralBound` | 8 | 5–12 | feel | 16 m total track width |
| `chunkPoolSize` (per biome) | 5 | 4–8 | variety | Balance repetition vs authoring workload |

All values live in `assets/data/track.json` + `assets/data/biomes/[biome].json`. Zero hardcoded gameplay values.

---

## Data Files

### `assets/data/track.json`
```json
{
  "planetLength": 600,
  "chunkLength": 20,
  "chunksAhead": 4,
  "chunksBehind": 1,
  "lateralBound": 8,
  "jumpGate": {
    "torusRadius": 4,
    "torusTube": 0.5,
    "triggerHalfWidth": 8,
    "triggerHalfHeight": 2.5,
    "triggerHalfDepth": 0.5,
    "localZOffset": -18
  }
}
```

### `assets/data/biomes/rocky.json` (example)
```json
{
  "name": "Rocky",
  "ground": { "color": "#55503a", "roughness": 0.9, "metallic": 0.0 },
  "chunks": [
    { "id": "rocky_safe_intro", "obstacles": [], "pickups": [] },
    {
      "id": "rocky_boulder_gauntlet",
      "obstacles": [
        { "type": "boulder", "x": -4, "z": -5 },
        { "type": "boulder", "x":  4, "z": -10 },
        { "type": "boulder", "x":  0, "z": -15 }
      ],
      "pickups": [ { "type": "crystal", "x": 0, "z": -8 } ]
    }
    // ... 3 more chunks per biome, 5 total
  ]
}
```

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Engine Bootstrap | Uses `scene`, `world`, `onBeforeStep` | No change |
| **Obstacle System** | Called via `spawn(type, x, y, z)` | **Blocker** — must ship first |
| **Pickup System** | Called via `spawn(type, x, y, z)` | **Blocker** — must ship first |
| Player System | Reads `player.body.translation().z` | No change |
| Planet/Checkpoint | Subscribes to `onJumpGateReached` | Designed in its own spec |
| HUD | Queries `getProgress()` | No change yet |

---

## Acceptance Criteria

- [ ] Given `biome='rocky'`, `seed='abc'`, `planetIndex=0`, the same 30-chunk sequence is produced every run
- [ ] Running at 12 m/s, player reaches the jump-gate in 48–52 seconds
- [ ] At any point, between 3 and 5 chunks are active in the scene
- [ ] Chunks more than 1 behind the player are despawned (verify scene/world counts)
- [ ] Player cannot move beyond `x = ±8`
- [ ] Jump-gate trigger fires `onJumpGateReached` exactly once
- [ ] Disposing the generator removes ALL spawned meshes and Rapier bodies
- [ ] Zero allocations per `onBeforeStep` tick
- [ ] Smoke test: one full Rocky-biome planet end-to-end without crashes or visual gaps

---

## Systems Index
Already present in `design/gdd/systems-index.md` as system #12, L4, T1, M-effort. No update needed.

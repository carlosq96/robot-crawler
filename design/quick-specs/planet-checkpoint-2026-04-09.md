# Quick Design Spec: Planet / Checkpoint System

**Type**: New Small System
**Scope**: Subscribes to the Track Generator's `onJumpGateReached` event and executes the planet-transition "warp" beat: disable input, fade screen, teleport player to the origin, dispose the current generator, pick the next biome, create a new Track Generator, heal the player to full HP, re-enable input. This is the glue that makes the endless planet-hop work.
**Date**: 2026-04-09
**Estimated Implementation**: ~2 hours (S effort)

---

## Overview

Planet/Checkpoint System owns the handoff between one Track Generator and the next. It is a tiny orchestrator — the hardest part is sequencing the dispose/create pair cleanly so the player never sees a broken world mid-warp.

The biome cycle for v1 is a simple array: `['rocky', 'ice', 'volcanic']`. Each time the player crosses a jump-gate, the next biome in the cycle is selected (with wrap-around). Planet index increments each time; difficulty scaling (later) uses the index.

---

## Core Rules

### 1. Biome cycle

```ts
const BIOME_CYCLE: BiomeName[] = ['rocky', 'ice', 'volcanic'];
function nextBiome(planetIndex: number): BiomeName {
  return BIOME_CYCLE[planetIndex % BIOME_CYCLE.length];
}
```

Planet 0 = rocky, planet 1 = ice, planet 2 = volcanic, planet 3 = rocky, etc.

### 2. Warp sequence (on jump-gate hit)

Triggered by `trackGenerator.onJumpGateReached(() => warpToNextPlanet())`.

Sequence (async, total ~1.5 s):

1. **Freeze (t=0)**
   - `movement.setEnabled(false)`
   - `superSuitCombat.setEnabled(false)`
   - Player body keeps its Y velocity (gravity) but X and Z are zeroed
   - Play SFX `jump_gate_warp`
2. **Fade in (t=0 → t=0.5)**
   - Overlay a white DOM div over the canvas, opacity animating 0 → 1
3. **Cut (t=0.5)**
   - Dispose current Track Generator (despawns all chunks, walls, jump-gate)
   - Teleport player body to `(0, y_spawn, 0)`, reset body linvel to `(0, 0, 0)`
   - Heal player to `maxHp` via `player.heal(maxHp)`
   - Advance `planetIndex += 1`
   - Create new Track Generator with `biome = nextBiome(planetIndex), planetIndex`
   - Subscribe to its `onJumpGateReached` (the old subscription was already fired)
   - Play music `biome_[nextBiome]` with a 1.0 s cross-fade
4. **Fade out (t=0.5 → t=1.5)**
   - Overlay opacity 1 → 0
   - Meanwhile, the new track is visible — the player sees the new biome emerge
5. **Unfreeze (t=1.5)**
   - `movement.setEnabled(true)`
   - `superSuitCombat.setEnabled(true)`
   - Emit `onPlanetChanged(biome, planetIndex)` for HUD + Run Lifecycle

### 3. State query

```ts
planetCheckpoint.getCurrentBiome(): BiomeName
planetCheckpoint.getPlanetIndex(): number
planetCheckpoint.isWarping(): boolean
```

### 4. Events

```ts
onPlanetChanged(cb: (biome: BiomeName, planetIndex: number) => void): () => void
```

Fired at the end of the warp, not the start. Subscribers: HUD (update planet label), Run Lifecycle (increment `planetsCleared` counter).

### 5. Dispose

- Unsubscribes from current Track Generator's `onJumpGateReached`
- Disposes the current Track Generator
- Removes the warp overlay div from the DOM
- Idempotent

---

## Public API Surface (LOCKED contract)

```ts
export type BiomeName = 'rocky' | 'ice' | 'volcanic';

export interface PlanetCheckpointConfig {
  startBiome: BiomeName;            // default 'rocky'
  seed: string;                     // passed through to Track Generator
  warpFreezeSec: number;            // 0.5 default
  warpFadeSec: number;              // 1.0 default
  biomeCycle: BiomeName[];          // default ['rocky','ice','volcanic']
}

export interface PlanetCheckpoint {
  getCurrentBiome(): BiomeName;
  getPlanetIndex(): number;
  isWarping(): boolean;
  onPlanetChanged(cb: (biome: BiomeName, planetIndex: number) => void): () => void;
  dispose(): void;
}

export function createPlanetCheckpoint(
  engine: EngineHandle,
  player: Player,
  movement: MovementController,
  superSuit: SuperSuitCombat,
  obstacles: ObstacleSystem,
  pickups: PickupSystem,
  audio: AudioSystem,
  config: PlanetCheckpointConfig,
): PlanetCheckpoint;
```

**Notes on construction:**
- Planet/Checkpoint creates the FIRST Track Generator in its constructor, so main.ts doesn't need to create one manually
- It owns the Track Generator lifecycle; dispose chains to the current generator

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `warpFreezeSec` | 0.5 | 0.2–1.0 | feel | Fade-in time; short enough to feel responsive, long enough to sell the transition |
| `warpFadeSec` | 1.0 | 0.5–2.0 | feel | Fade-out time; new biome becomes visible under the fade |
| biome cycle | `['rocky','ice','volcanic']` | — | content | Data-driven; adding a 4th biome = append to array |

Tuning lives in `assets/data/planet-checkpoint.json`.

---

## Data Files

### `assets/data/planet-checkpoint.json`
```json
{
  "startBiome": "rocky",
  "warpFreezeSec": 0.5,
  "warpFadeSec": 1.0,
  "biomeCycle": ["rocky", "ice", "volcanic"]
}
```

Seed is NOT in this file — it's a runtime parameter passed from Run Lifecycle (which may derive a daily seed or a freshly-generated random one per run).

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Track Generator | Creates and disposes Track Generator instances | Consumed via constructor + `onJumpGateReached` |
| Player System | Calls `heal(maxHp)`, reads body for teleport | No change |
| Movement | `setEnabled(false/true)` during warp | API already exists |
| Super-Suit Combat | `setEnabled(false/true)` during warp | API exists in that spec |
| Audio | Plays warp SFX + cross-fades music | No change |
| HUD | Subscribes to `onPlanetChanged` for planet label | Wired in HUD |
| Run Lifecycle | Subscribes to `onPlanetChanged` to increment planetsCleared | Wired in Run Lifecycle |
| Obstacle System | Forwarded to Track Generator | No direct coupling |
| Pickup System | Forwarded to Track Generator | No direct coupling |

---

## Acceptance Criteria

- [ ] First Track Generator is created on Planet/Checkpoint construction, using the start biome
- [ ] Reaching the jump-gate triggers the warp sequence (freeze → fade → dispose → recreate → fade out → unfreeze)
- [ ] Total warp duration matches `warpFreezeSec + warpFadeSec` (±1 frame)
- [ ] During warp, player input is ignored
- [ ] After warp, player body is at `(0, y_spawn, 0)` with zero linvel
- [ ] After warp, player HP is full
- [ ] After warp, planet index has incremented by 1
- [ ] After warp, the new biome matches `biomeCycle[planetIndex % length]`
- [ ] `onPlanetChanged` fires exactly once per completed warp
- [ ] Music cross-fades to the new biome track
- [ ] Dispose cleans up the current Track Generator, removes overlay, unsubscribes all listeners

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #14, L4, T1, S-effort. No update needed.

# Quick Design Spec: Run Lifecycle

**Type**: New Small System
**Scope**: Pure state machine for the outer loop of Space Runner: `title → running → dead → results → [retry]`. Owns per-run statistics (distance, planets cleared, crystals, score). Consumes events from Player System, Pickup System, Super-Suit Combat, and Planet/Checkpoint. Does NOT own UI rendering (HUD and Results Screen do) and does NOT own persistence (Persistence Layer does).
**Date**: 2026-04-09
**Estimated Implementation**: ~2 hours (S effort)

---

## Overview

Run Lifecycle is the conductor of a single run. It holds the state machine, tracks the accumulating run statistics, and owns the score formula. Every other system reports to it via subscriptions (`player.onDeath`, `pickups.onPickup`, etc.). When the player dies, Run Lifecycle transitions to the `results` state and hands the final run data to the Results Screen.

The state machine is **pure** — no DOM, no Three.js, no Rapier. Unit-testable in isolation. This is the same architectural pattern we had in the MML plan (ADR-0004's Run Lifecycle) minus all the multiplayer sync concerns.

---

## Core Rules

### 1. State machine

States: `title`, `running`, `dead`, `results`

Transitions:
| From | To | Trigger |
|---|---|---|
| `title` | `running` | `start()` called by UI button |
| `running` | `dead` | `player.onDeath` event |
| `dead` | `results` | automatic after `deathHoldSec` |
| `results` | `running` | `retry()` called by UI button |
| `results` | `title` | `toTitle()` called by UI button |
| any | any | REJECTED unless listed above |

Any invalid transition logs a warning and is ignored.

### 2. Per-run state (reset on `start()` or `retry()`)

```ts
interface RunStats {
  startTimeMs: number;
  elapsedMs: number;
  distance: number;          // computed from -player.body.translation().z each tick
  planetsCleared: number;    // incremented on onPlanetChanged
  crystalsCollected: number; // incremented on onPickup('crystal', _)
  obstaclesBroken: number;   // incremented on superSuit.onObstacleBroken
  score: number;             // computed each tick from the formula
}
```

### 3. Score formula

```
score = distance + (planetsCleared * 500) + (crystalsCollected * 10) + (obstaclesBroken * 25)
```

Computed live each `onBeforeRender` tick so HUD can display a running score. Final score is captured at the `running → dead` transition.

### 4. Distance computation

`distance = max(0, -player.body.translation().z)` — floored to integer. Reset to 0 on `start()`. Distance is in meters; with forward speed 12 m/s, 1 minute = 720 m.

### 5. `start()` — entering a run

1. Reset stats to zero
2. `startTimeMs = performance.now()`
3. Transition to `running`
4. Fire `onStateChange('title'|'results', 'running')`
5. Emit `onRunStarted(seed, startingBiome)` — consumed by main.ts to create Planet/Checkpoint

Note: Run Lifecycle does NOT create Planet/Checkpoint directly. It emits an event and main.ts wires the creation. This keeps Run Lifecycle pure.

### 6. `running` tick

Each `onBeforeRender` tick (real dt):
1. Update `distance` from player position
2. Update `elapsedMs = now - startTimeMs`
3. Recompute `score`

No physics, no Rapier, no network. Pure math.

### 7. `running → dead` transition

Triggered by `player.onDeath`:
1. Capture final stats (freeze)
2. Transition to `dead`
3. Fire `onStateChange('running', 'dead')`
4. Start a `deathHoldSec` timer (default 1.5 s) — lets the death animation play out before the Results Screen slides in

### 8. `dead → results` transition

Fires automatically after `deathHoldSec`:
1. Transition to `results`
2. Fire `onStateChange('dead', 'results')` with `finalStats`
3. Emit `onResultsReady(finalStats)` — consumed by Results Screen

### 9. `retry()` — quick restart

1. Reset stats
2. Disable current gameplay (main.ts listens and disposes current Planet/Checkpoint)
3. Transition to `running`
4. Fire `onStateChange('results', 'running')`
5. Emit `onRunStarted(newSeed, startingBiome)` to recreate Planet/Checkpoint

### 10. `toTitle()` — back to title from results

Transition to `title`. Fire events. Main.ts disposes Planet/Checkpoint; the title screen takes over rendering (or the ground stays, depending on UI decision — TBD).

### 11. Subscriptions

In constructor, subscribe to:
- `player.onDeath` → trigger the death transition
- `pickups.onPickup` → increment `crystalsCollected` if type === 'crystal'
- `planetCheckpoint.onPlanetChanged` → increment `planetsCleared`
- `superSuit.onObstacleBroken` → increment `obstaclesBroken`

All subscriptions are captured for dispose.

### 12. Dispose

Unsubscribe from all producer events. Clear subscriber list. Idempotent.

---

## Public API Surface (LOCKED contract)

```ts
export type RunState = 'title' | 'running' | 'dead' | 'results';

export interface RunStats {
  elapsedMs: number;
  distance: number;
  planetsCleared: number;
  crystalsCollected: number;
  obstaclesBroken: number;
  score: number;
}

export interface RunLifecycle {
  getState(): RunState;
  getStats(): RunStats;       // live — updated each tick while running
  start(seed: string): void;
  retry(seed: string): void;
  toTitle(): void;
  onStateChange(cb: (from: RunState, to: RunState) => void): () => void;
  onRunStarted(cb: (seed: string, startingBiome: string) => void): () => void;
  onResultsReady(cb: (finalStats: RunStats) => void): () => void;
  dispose(): void;
}

export interface RunLifecycleConfig {
  startingBiome: string;     // 'rocky' default
  deathHoldSec: number;      // 1.5 default
  scoreWeights: {
    distance: number;        // 1 default
    planetsCleared: number;  // 500 default
    crystalsCollected: number; // 10 default
    obstaclesBroken: number; // 25 default
  };
}

export function createRunLifecycle(
  engine: EngineHandle,
  player: Player,
  pickups: PickupSystem,
  planetCheckpoint: PlanetCheckpoint,
  superSuit: SuperSuitCombat,
  config: RunLifecycleConfig,
): RunLifecycle;
```

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `deathHoldSec` | 1.5 | 0.5–3.0 | feel | Length of death animation before Results slides in |
| `scoreWeights.planetsCleared` | 500 | 100–2000 | balance | Huge bonus — planets are the hook |
| `scoreWeights.crystalsCollected` | 10 | 1–100 | balance | Small incremental reward |
| `scoreWeights.obstaclesBroken` | 25 | 5–100 | balance | Rewards aggressive Super-Suit use |
| `startingBiome` | `'rocky'` | — | content | First planet |

All lives in `assets/data/run-lifecycle.json`.

---

## Data Files

### `assets/data/run-lifecycle.json`
```json
{
  "startingBiome": "rocky",
  "deathHoldSec": 1.5,
  "scoreWeights": {
    "distance": 1,
    "planetsCleared": 500,
    "crystalsCollected": 10,
    "obstaclesBroken": 25
  }
}
```

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Player System | Subscribes to `onDeath` | No change |
| Pickup System | Subscribes to `onPickup` | No change |
| Planet/Checkpoint | Subscribes to `onPlanetChanged` | No change |
| Super-Suit Combat | Subscribes to `onObstacleBroken` | No change |
| HUD | Polls `getStats()` for live display | Wired in HUD |
| Run Results Screen | Subscribes to `onResultsReady` | Wired in Results spec |
| main.ts | Subscribes to `onRunStarted` + `onStateChange` to manage Planet/Checkpoint lifecycle | Must be wired |

---

## Acceptance Criteria

- [ ] Starting in `title`, calling `start('abc')` transitions to `running` and resets stats
- [ ] `running` ticks update `distance` from player Z position
- [ ] `running` ticks recompute `score` from the weighted formula
- [ ] `player.onDeath` transitions `running → dead`, captures final stats
- [ ] After `deathHoldSec`, auto-transitions `dead → results` and emits `onResultsReady(finalStats)`
- [ ] `retry(newSeed)` transitions `results → running` with reset stats
- [ ] `toTitle()` transitions `results → title`
- [ ] Invalid transitions (e.g. `title → dead`) log warning and are ignored
- [ ] Dispose unsubscribes from all producer events
- [ ] Unit-testable without a live Three.js / Rapier instance (inject mock player + systems)

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #15, L5, T1, S-effort. No update needed.

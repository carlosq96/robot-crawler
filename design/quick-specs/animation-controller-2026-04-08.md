# Quick Design Spec: Animation Controller

**Type**: New Small System
**Scope**: A reusable wrapper around `THREE.AnimationMixer` that exposes a state-machine API. Each animated entity (Player, every Enemy, Boss) gets one instance configured via a per-entity JSON. Handles crossfading, loop vs. one-shot, animation events, and return-to-default. Has zero gameplay knowledge.
**Date**: 2026-04-08
**Estimated Implementation**: ~4 hours

---

## Overview

Animation Controller is the abstraction that turns "play the shoot animation" into a single line of gameplay code. Without it, every animated entity in the project would have its own ~50 lines of `mixer.clipAction(...)` boilerplate, its own crossfade logic, and its own way of binding animation timing to game events. With it, the same controller works for the player, every enemy type, and the boss — distinguished only by the per-entity JSON config that maps abstract state names ("idle", "shoot", "death") to actual GLB clip names.

This is the system the user explicitly asked to be "modular and reusable as possible." It saves an estimated 6+ hours of duplicated animation glue across the game.

---

## Core Rules

### 1. State-machine API, not mixer API

Gameplay code calls `anim.play("shoot")`, never `mixer.clipAction("Armature|Shoot_01")`. The mapping from abstract state name to actual clip name lives in the per-entity JSON config (loaded by Player System / Enemy System), not in code.

### 2. Standard state vocabulary

The controller accepts ANY string as a state name, but the project uses a **standard vocabulary** so animators and programmers stay aligned:

| State | Loop? | Returns to | Used by |
|---|---|---|---|
| `idle` | yes | — | All entities |
| `walk` | yes | `idle` | Player, walking enemies |
| `run` | yes | `idle` | Player (sprint, future) |
| `shoot` | no | `idle` (or last walk/idle state) | Player buster |
| `charge` | yes | `idle` (when released) | Player buster charge hold |
| `chargeRelease` | no | `idle` | Player buster fired charged shot |
| `hit` | no | previous state | All entities (damage stagger) |
| `death` | no | (none — entity destroyed) | All entities |

Per-entity custom states are allowed: e.g. boss has `phase2Enrage`, enemy has `flyerLunge`. Each entity's JSON declares its own state list.

### 3. Per-state config (declared in entity JSON)

```json
{
  "animation": {
    "clipMap": {
      "idle": "Armature|Idle_Loop",
      "walk": "Armature|Walk_Cycle",
      "shoot": "Armature|Shoot_01",
      "hit":   "Armature|Hit_React",
      "death": "Armature|Death"
    },
    "loopMap": {
      "idle": true,
      "walk": true,
      "shoot": false,
      "hit":   false,
      "death": false
    },
    "returnState": "idle",
    "defaultCrossfade": 0.2,
    "crossfadeOverrides": {
      "shoot": 0.05,
      "hit":   0.02
    },
    "events": [
      { "state": "shoot", "normalizedTime": 0.3, "name": "shoot.fire" },
      { "state": "shoot", "normalizedTime": 0.8, "name": "shoot.complete" }
    ]
  }
}
```

The Player System reads this from `assets/data/entities/player.json` and passes it to `createAnimationController(...)` along with the loaded mesh.

### 4. Crossfading is automatic

Calling `play("walk")` while in `"idle"` triggers a crossfade over the duration defined in `defaultCrossfade` (or `crossfadeOverrides[targetState]` if set). The previous action fades out as the new action fades in. The mixer handles the math.

### 5. One-shot states return to default

If a state's `loopMap` entry is `false`, the controller subscribes to the mixer's `finished` event and automatically transitions to `returnState` when the clip completes. This is what makes "shoot returns to idle" automatic without gameplay code touching it.

The exception is `hit`: it returns to **the state that was active before** the hit, not the global `returnState`. This lets a walking player keep walking after a hit interrupt.

### 6. Animation events

Animation events fire at a normalized time (0..1) within a clip. They are defined in the entity JSON's `events` array. The Animation Controller polls the mixer's `time` each update and fires the matching event callback when the threshold is crossed.

Use case: the player's `shoot` animation has the buster firing at 30% through the clip. The gameplay code wants to spawn the projectile **on that frame**, not on input. So:

```ts
anim.onEvent('shoot.fire', () => {
  // Spawn projectile here (matches the visual buster fire)
  combatSystem.spawnBusterShot(player);
});
```

Without animation events, the projectile spawns on input, which feels off because the visual lag of the shoot animation is invisible to the gameplay code.

### 7. Update is per-render-frame, not per-physics-tick

`anim.update(realDt)` is called from Engine Bootstrap's `onBeforeRender(dt)` hook. Animations use **real elapsed time** (`realDt`) so they're smooth at native frame rate, decoupled from the fixed physics step. Per ADR-0007, this is the right separation: physics is deterministic, animation is visual.

### 8. Multiple instances are independent

Each animated entity has its own `AnimationController` instance with its own mixer and clip set. Two enemies of the same type each have their own controller — they share the same JSON config but each has a private mixer state. There is no global animation manager.

### 9. Failure handling

- If `clipMap['idle']` references a clip name that doesn't exist in the GLB, log a warning and use the first available clip as a fallback. Do NOT throw.
- If `play('foo')` is called for a state not in `clipMap`, log a warning and ignore. Do NOT throw.
- These prevent gameplay code from crashing on art/data mismatches mid-jam.

---

## Public API Surface

```ts
// src/engine/animation-controller.ts
import * as THREE from 'three';

export interface AnimationControllerConfig {
  clipMap: Record<string, string>;          // stateName → GLB clip name
  loopMap: Record<string, boolean>;         // stateName → does it loop?
  returnState: string;                       // default return after one-shot
  defaultCrossfade: number;                  // seconds
  crossfadeOverrides?: Record<string, number>;
  events?: AnimationEventDef[];
}

export interface AnimationEventDef {
  state: string;
  normalizedTime: number;  // 0..1
  name: string;            // e.g. "shoot.fire"
}

export interface AnimationController {
  play(state: string, options?: { crossfade?: number }): void;
  getCurrentState(): string | null;
  isPlaying(state: string): boolean;
  onEvent(eventName: string, cb: () => void): () => void;  // unsubscribe fn
  update(realDt: number): void;  // call from Engine Bootstrap onBeforeRender
  dispose(): void;
}

export function createAnimationController(
  mesh: THREE.Object3D,
  clips: THREE.AnimationClip[],
  config: AnimationControllerConfig
): AnimationController;
```

The consumer pattern:

```ts
// In Player System
const gltf = await engine.loadGLTF('/assets/models/player.glb');
const playerMesh = gltf.scene;
const playerConfig = await fetch('/assets/data/entities/player.json').then(r => r.json());
const anim = createAnimationController(playerMesh, gltf.animations, playerConfig.animation);
engine.onBeforeRender((dt) => anim.update(dt));
anim.play('idle');

// Later, in Movement
if (input.isActionDown('moveForward')) {
  if (anim.getCurrentState() !== 'walk') anim.play('walk');
} else {
  if (anim.getCurrentState() !== 'idle') anim.play('idle');
}

// Later, in Buster Combat
anim.onEvent('shoot.fire', () => spawnProjectile());
input.onActionPressed('shoot', () => anim.play('shoot'));
```

---

## Tuning Knobs

Animation Controller doesn't have global tuning knobs — all configuration is **per-entity** via the entity JSON. The only globals are sensible defaults:

| Default | Value | Range | Rationale |
|---|---|---|---|
| `defaultCrossfade` (fallback) | `0.2` sec | 0.05 — 0.5 | Smooth blend without lag |
| Standard one-shot states | `shoot, hit, chargeRelease, death` | — | Convention |
| Standard looping states | `idle, walk, run, charge` | — | Convention |

Per-entity overrides live in `assets/data/entities/[entity-name].json`.

---

## Acceptance Criteria

### Functional
- [ ] `createAnimationController(mesh, clips, config)` returns a working instance
- [ ] `play("idle")` plays the configured idle clip
- [ ] `play("walk")` while in `"idle"` crossfades over `defaultCrossfade` seconds
- [ ] `play("shoot")` plays once and automatically returns to `returnState` ("idle")
- [ ] `play("hit")` plays once and returns to the **previous** state (not the global default)
- [ ] `getCurrentState()` returns the active state name (or `null` if none)
- [ ] `isPlaying("walk")` returns `true` while walk is active, `false` otherwise
- [ ] `onEvent("shoot.fire", cb)` fires the callback when shoot's normalized time crosses 0.3
- [ ] Multiple `onEvent` subscribers all receive the event
- [ ] Unsubscribe function actually removes the listener
- [ ] `update(dt)` advances the mixer by real elapsed time
- [ ] `dispose()` is safe to call multiple times

### Robustness
- [ ] Missing clip in `clipMap` logs a warning and uses the first available clip as fallback
- [ ] `play("nonexistent")` logs a warning and is ignored (no throw)
- [ ] Two independent instances do NOT share state
- [ ] An entity with 7+ states works without performance degradation

### Architectural
- [ ] Animation Controller has NO imports from `src/gameplay/`, `src/combat/`, `src/networking/`, `src/ui/`
- [ ] No hardcoded clip names — all from passed config
- [ ] Same controller works for player, enemies, and boss with different configs

---

## Constraining ADRs

| ADR | Constraint |
|---|---|
| ADR-0007 (fixed Rapier timestep) | Animation update uses **real elapsed time**, NOT fixed step (decouples visual smoothness from physics determinism) |
| ADR-0008 (TypeScript) | Source is `.ts`, fully typed config |

---

## Systems Index

Already in `design/gdd/systems-index.md` as system **#12 in the table** (Animation Controller, Core, T1, L1, M effort) and **#5 in design order**. Bottleneck system per the high-risk callout. Update progress tracker to mark as **Approved** after this spec is written.

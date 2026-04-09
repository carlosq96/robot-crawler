# Quick Design Spec: Player System

**Type**: New Small System
**Scope**: The Player entity. Owns the player's mesh (loaded GLB), Rapier physics body (capsule), Animation Controller instance, and a state machine covering alive/downed/dead/spectator. Exposes a stable API consumed by Movement, Buster Combat, Sub-Weapon, HUD, Upgrade System, and In-Room Sync (10 systems total). Holds NO movement logic, NO combat logic — just the entity, its state, and its lifecycle hooks.
**Date**: 2026-04-09
**Estimated Implementation**: ~4 hours

---

## Overview

Player System defines what a Player IS (data + lifecycle), not what a Player DOES (movement, combat, etc.). It loads the player GLB via Engine Bootstrap, creates a capsule Rapier body in the world, instantiates an Animation Controller bound to the GLB clips, and runs a small state machine that governs the alive → downed → dead transitions. Other systems consume the player via a stable interface; they don't reach into private fields.

For the **vertical slice** (player on screen, WASD), we only need:
- The mesh shows up
- The body is in the world
- HP defaults to max
- The state machine starts in `alive`
- The Animation Controller plays `idle` by default

For the **full game**, the same module gains: damage handling, downed/revive logic, spectator state, network sync hooks, server-authoritative validation. This spec covers both layers — vertical-slice essentials with hooks for the full feature set.

---

## Core Rules

### 1. Player is created via async factory

```ts
const player = await createPlayer(engine, config, 'session-id-abc123');
```

The factory:
1. Loads the GLB via `engine.loadGLTF(config.modelUrl)`
2. Adds the mesh to `engine.scene`
3. Creates a Rapier dynamic rigid body (capsule shape) in `engine.world`
4. Creates an `AnimationController` instance bound to the loaded clips and config
5. Starts the controller in the configured initial state (default: `idle`)
6. Registers an `engine.onAfterStep(...)` callback that syncs the mesh transform from the body
7. Returns the `Player` interface

### 2. Body shape is a CAPSULE

Capsules are forgiving for player movement (no edge-catching like boxes, no rolling like spheres). Capsule dimensions come from config:

- `capsuleRadius` — half-width of the player at the waist
- `capsuleHeight` — distance between the two hemisphere centers (NOT total height)
- Total player height = `capsuleHeight + 2 * capsuleRadius`

Default for jam: `radius=0.4, height=1.0` → total ~1.8 m (a roughly human-scale player).

### 3. State machine

```
        ┌─────────┐
        │  alive  │ ──── (HP > 0) ────┐
        └────┬────┘                    │
             │ HP <= 0                 │
             ▼                         │
       ┌──────────┐                    │
       │  downed  │ ── revive ────────►┘
       └────┬─────┘
            │ no revivals left
            ▼
        ┌────────┐
        │  dead  │ ── (terminal — wait for run end)
        └────────┘

       (separate)
       ┌───────────┐
       │ spectator │ ── client-only state for disconnected players
       └───────────┘
```

Transitions:
- `alive → downed`: HP drops to 0 AND `revivals > 0`. Player is incapacitated; teammates can revive. Animation: play `death`, then go static (a "downed" state of the model).
- `alive → dead`: HP drops to 0 AND `revivals === 0`. Permanent for this run.
- `downed → alive`: A teammate uses a revive (decrements their revival count). HP restored to a configured fraction (default: 50%). Animation: play `idle` from start.
- `downed → dead`: All teammates also down at the same time = run fail. Run Lifecycle handles the run state; Player System just transitions on signal.
- `* → spectator`: Client-only — used when the player has been disconnected and is observing. No server-side equivalent.

### 4. Damage application

`player.takeDamage(amount)` is the only way HP decreases. It:
1. Returns immediately if state is not `alive` (no damage to downed/dead)
2. Applies armor defense reduction: `actualDamage = amount * (1 - armorDefenseFraction)` (armor comes from Upgrade System; 0 by default)
3. `hp = max(0, hp - actualDamage)`
4. Fires `onDamage` event with `(amount, currentHp)`
5. Plays `hit` animation
6. If `hp === 0`: trigger state transition (downed or dead)

In multiplayer, only the server calls `takeDamage`. Clients receive HP updates via Colyseus state sync (per ADR-0004).

### 5. Mesh-body sync runs in `onAfterStep`

```ts
engine.onAfterStep(() => {
  const t = body.translation();
  const r = body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
});
```

This is the ONLY place mesh.position is mutated. Movement, Buster Combat, etc. write to the body via Rapier API; the sync makes the visual follow.

### 6. Public API is the contract for 10 dependents

Once defined, this interface MUST NOT churn. Changes require an ADR.

### 7. Revival count comes from Upgrade System

Player's `revivalsRemaining` starts at the value supplied by Upgrade System on player creation (default: 1, max +2 via upgrades). It is decremented when revived. In jam v1, revives only happen between rooms; we don't have a "revive button" yet — that's a Sub-Weapon System concern.

### 8. Multiple players coexist

The factory supports any number of player instances. Each has its own body, mesh, animation controller, and state. The session ID parameter (`'session-id-abc123'`) is used by In-Room Sync to map clients to player instances.

### 9. Disposal cleans up everything

`player.dispose()`:
- Removes the mesh from the scene
- Removes the body from the world
- Disposes the animation controller
- Unregisters the `onAfterStep` callback
- Idempotent

---

## Public API Surface — LOCKED

This is the interface the 10 dependents consume. Changes require an ADR.

```ts
// src/gameplay/player.ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { EngineHandle } from '../engine/bootstrap.js';
import type { AnimationController, AnimationControllerConfig } from '../engine/animation-controller.js';

export type PlayerState = 'alive' | 'downed' | 'dead' | 'spectator';

export interface PlayerConfig {
  modelUrl: string;                // e.g. "/assets/models/player.glb"
  spawnPosition: { x: number; y: number; z: number };
  maxHp: number;                   // default 100
  capsuleRadius: number;           // physics body radius
  capsuleHeight: number;           // physics body height (between hemispheres)
  reviveHpFraction: number;        // 0..1; HP restored on revive (default 0.5)
  initialAnimationState: string;   // default 'idle'
  animation: AnimationControllerConfig;
}

export interface Player {
  // Identity
  readonly id: string;             // session ID

  // Owned resources (read-only references)
  readonly mesh: THREE.Object3D;
  readonly body: RAPIER.RigidBody;
  readonly anim: AnimationController;

  // State queries (cheap)
  getState(): PlayerState;
  getHp(): number;
  getMaxHp(): number;
  getRevivalsRemaining(): number;
  getPosition(): THREE.Vector3;    // returns a fresh Vector3 — caller may keep
  isAlive(): boolean;              // shorthand: state === 'alive'

  // State mutations (server-authoritative in multiplayer)
  takeDamage(amount: number): void;
  heal(amount: number): void;
  setRevivalsRemaining(count: number): void;  // Upgrade System sets this on creation
  revive(reviverId: string): boolean;          // returns success; false if no revivals
  setState(newState: PlayerState): void;       // direct override (for spectator transition)

  // Lifecycle hooks (return unsubscribe fn)
  onStateChange(cb: (oldState: PlayerState, newState: PlayerState) => void): () => void;
  onDamage(cb: (amount: number, currentHp: number) => void): () => void;
  onDeath(cb: () => void): () => void;
  onRevive(cb: (reviverId: string) => void): () => void;

  // Cleanup
  dispose(): void;
}

export async function createPlayer(
  engine: EngineHandle,
  config: PlayerConfig,
  id: string
): Promise<Player>;
```

---

## Tuning Knobs

All values live in `assets/data/entities/player.json` per the `gameplay-code` rule.

```json
{
  "modelUrl": "/assets/models/player.glb",
  "spawnPosition": { "x": 0, "y": 2, "z": 0 },
  "maxHp": 100,
  "capsuleRadius": 0.4,
  "capsuleHeight": 1.0,
  "reviveHpFraction": 0.5,
  "initialAnimationState": "idle",
  "animation": {
    "clipMap": {
      "idle":  "Armature|Idle",
      "walk":  "Armature|Walk",
      "run":   "Armature|Run",
      "shoot": "Armature|Shoot",
      "hit":   "Armature|Hit",
      "death": "Armature|Death"
    },
    "loopMap": {
      "idle": true, "walk": true, "run": true,
      "shoot": false, "hit": false, "death": false
    },
    "returnState": "idle",
    "defaultCrossfade": 0.2,
    "crossfadeOverrides": {
      "shoot": 0.05,
      "hit":   0.02
    },
    "events": [
      { "state": "shoot", "normalizedTime": 0.3, "name": "shoot.fire" }
    ]
  }
}
```

(The animation clip names assume Meshy auto-rig + standard naming. If the actual GLB has different names, edit `clipMap` only — no code change.)

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `maxHp` | 100 | 50 — 200 | feel | 100 is a clean round baseline; upgrades scale by % |
| `capsuleRadius` | 0.4 | 0.2 — 0.8 | tech | Forgiving collision width for player |
| `capsuleHeight` | 1.0 | 0.5 — 2 | tech | Total height ~1.8 m |
| `reviveHpFraction` | 0.5 | 0.1 — 1.0 | feel | Half HP on revive — meaningful comeback without making downed trivial |
| `spawnPosition.y` | 2 | 0 — 5 | tech | Above ground so the capsule doesn't intersect the floor at spawn |

---

## Acceptance Criteria

### Vertical Slice 1 (player on screen)
- [ ] `createPlayer(engine, config, id)` resolves with a working Player after the GLB loads
- [ ] After creation, the mesh is visible in `engine.scene`
- [ ] After creation, the body is in `engine.world` at the configured spawn position
- [ ] Animation Controller starts playing `idle` automatically
- [ ] Mesh transform syncs to body each fixed step (verified by moving the body manually and seeing the mesh follow)
- [ ] Camera Rig can target `player.mesh` and follow it correctly

### State machine
- [ ] Initial state is `alive`
- [ ] `getHp()` returns `maxHp` initially
- [ ] `takeDamage(50)` reduces HP to 50
- [ ] `takeDamage(50)` again with `revivalsRemaining > 0` transitions to `downed`
- [ ] `takeDamage(any)` while `downed` is a no-op (no HP change, no events)
- [ ] `revive(reviverId)` while `downed` and revivals available transitions to `alive` with `hp = maxHp * reviveHpFraction`
- [ ] `revive(reviverId)` while `downed` with no revivals returns `false` and stays downed
- [ ] HP at 0 with `revivalsRemaining === 0` transitions directly to `dead`
- [ ] `dead` is terminal — `setState('alive')` from `dead` is rejected (logged warning)

### Events
- [ ] `onStateChange` fires with `(oldState, newState)` on every transition
- [ ] `onDamage` fires with `(amount, currentHp)` on every `takeDamage` call (when alive)
- [ ] `onDeath` fires once on the `alive → dead` or `downed → dead` transition
- [ ] `onRevive` fires with `(reviverId)` on `downed → alive` transition
- [ ] Multiple subscribers per event all receive the call
- [ ] Unsubscribe function works

### Architectural
- [ ] Player System has NO imports from `src/combat/`, `src/networking/`, `src/ui/` — those systems consume Player, not the reverse
- [ ] Public API matches the spec exactly — no extra fields exposed
- [ ] All values from `player.json`, no hardcoded numbers
- [ ] Two Player instances coexist independently (verified by two separate spawns)
- [ ] `dispose()` is idempotent and removes mesh + body cleanly

---

## Constraining ADRs

| ADR | Constraint |
|---|---|
| ADR-0004 (server-authoritative combat) | In multiplayer, only server-side code calls `takeDamage`; clients receive HP via Colyseus sync |
| ADR-0007 (fixed Rapier timestep) | Body is created in the world that steps at fixed 1/60; mesh sync runs in `onAfterStep` (also fixed timestep) |
| ADR-0008 (TypeScript) | Source is `.ts`; `PlayerState` is a typed union; `Player` interface is the contract |

---

## Out of scope (deferred to other systems)

- **Movement** (WASD → body velocity) — Movement system, system #10
- **Aiming** (mouse → look direction) — Movement or Buster Combat
- **Shooting** — Buster Combat system
- **Sub-weapons** — Sub-Weapon System
- **HP bar rendering** — HUD system (consumes `getHp()` + `onDamage` event)
- **Upgrade application** (buster damage, max HP modifiers) — Upgrade System (sets values via `setRevivalsRemaining`, etc.)
- **Network sync** — In-Room Sync (reads from Player API, broadcasts via Colyseus)
- **Death VFX** — Buster Combat / VFX (subscribes to `onDeath`)

---

## Systems Index

Already in `design/gdd/systems-index.md` as system **#8 in the table** (Player System, Gameplay, T1, L2, M effort) and **#7 in design order**. Bottleneck system per the high-risk callout (10 dependents). Update progress tracker to mark as **Approved** after this spec is written.

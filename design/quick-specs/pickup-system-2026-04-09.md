# Quick Design Spec: Pickup System

**Type**: New Small System
**Scope**: Spawnable collectibles placed by Track Generator on the track. Walk-through pickup with a score value. On collision, emits an event and despawns. One type for v1: `crystal`.
**Date**: 2026-04-09
**Estimated Implementation**: ~2 hours (S effort)

---

## Overview

Pickup System is a tiny factory + registry for collectibles. Each pickup type has a mesh, a small sensor collider, and a score value. Track Generator calls `spawn(type, x, y, z)`; the player's auto-run carries them into the sensor which fires an event, emits the score, and despawns the entity.

The Pickup System owns zero gameplay: it does not track score, does not update HUD, does not play music. It emits `onPickup(type, value)` and Run Lifecycle consumes it.

---

## Core Rules

### 1. Data-driven pickup definitions

`assets/data/pickups.json`:
```json
{
  "crystal": {
    "mesh":     { "shape": "octahedron", "radius": 0.4, "color": "#66ffcc", "emissive": "#22aa88" },
    "collider": { "shape": "ball", "radius": 0.6 },
    "value":    10,
    "sfxPickup": "pickup_crystal"
  }
}
```

V1 ships with `crystal` only. More types (e.g. `gem`, `star`) are additive post-MVP.

### 2. Spawn

```ts
pickupSystem.spawn('crystal', x, y, z): PickupHandle
```

Creates:
- Three.js mesh (octahedron primitive with emissive material), positioned at `(x, y, z)`
- Rapier sensor collider (isSensor = true), collider `userData = { kind: 'pickup', handle }`
- Bobbing animation: mesh hovers via `onBeforeRender` applying `y + sin(elapsed * 2) * 0.15`
- Slow Y-axis spin for visibility (`mesh.rotation.y += dt * 1.5`)
- Entry in internal `Map<PickupHandle, PickupEntity>`

### 3. Despawn

Removes mesh from scene, collider from world, map entry. Idempotent.

### 4. Pickup on sensor intersection

During `onBeforeStep`, iterate pending sensor intersection events. For each hit between a pickup collider and the player's capsule:

1. Emit `onPickup(type, value)` event
2. Play `sfxPickup` via Audio System
3. Auto-despawn the pickup (single-use)

No invulnerability window — pickups are always-on.

### 5. Dispose

Tears down all active pickups + unregisters `onBeforeStep` + `onBeforeRender` hooks. Idempotent.

---

## Public API Surface (LOCKED contract)

```ts
export type PickupHandle = number;

export interface PickupSystem {
  spawn(type: string, x: number, y: number, z: number): PickupHandle;
  despawn(handle: PickupHandle): void;
  onPickup(cb: (type: string, value: number) => void): () => void;
  dispose(): void;
}

export function createPickupSystem(
  engine: EngineHandle,
  player: Player,
  audio: AudioSystem,
  defs: PickupDefinitions,
): PickupSystem;
```

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `crystal.value` | 10 | 1–100 | economy | Base unit; other pickups scale from this |
| bobbing amplitude | 0.15 m | 0.05–0.3 | feel | Subtle life, not distracting |
| bobbing speed | 2.0 rad/s | 1–4 | feel | Slow enough to read from distance |
| spin speed | 1.5 rad/s | 0.5–3 | feel | Catches eye without strobing |

Tuning lives in `assets/data/pickups.json` (bobbing/spin are system-level defaults; per-type values can override).

---

## Data Files

- `assets/data/pickups.json` — pickup type definitions (mesh + collider + value + sfx)

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Player System | Collider hits player | No change |
| Audio System | Plays pickup SFX | No change — must ship first |
| Track Generator | Consumer of `spawn/despawn` | API locked here |
| Run Lifecycle | Subscribes to `onPickup` for score accumulation | Wired in Run Lifecycle spec |
| HUD | Subscribes to `onPickup` for +value popup animation | Wired in HUD spec |

---

## Acceptance Criteria

- [ ] `spawn('crystal', 0, 1, -10)` creates a visible, bobbing, spinning octahedron with emissive material
- [ ] Player auto-running through the crystal triggers `onPickup('crystal', 10)` exactly once
- [ ] Pickup auto-despawns on collect; no residual mesh / collider
- [ ] Multiple pickup subscribers all receive the event
- [ ] Dispose cleans all spawned entities
- [ ] No allocations per `onBeforeStep` tick (reused temp vectors for sensor iteration)

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #11, L3, T1, S-effort. No update needed.

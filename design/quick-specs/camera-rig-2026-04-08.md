# Quick Design Spec: Camera Rig

**Type**: New Small System
**Scope**: Drive `engine.camera` to follow a target Object3D using a swappable rig implementation. Default rig is fixed third-person follow (Megaman Legends style). The interface allows alternate rigs (orbit, free-fly, fixed) to be plugged in later without changes to consumers.
**Date**: 2026-04-08
**Estimated Implementation**: ~2 hours

---

## Overview

Camera Rig owns the position and rotation of `engine.camera` each frame. It is the only system in the game that mutates `camera.position` and `camera.quaternion` — no other system touches the camera transform directly. The rig follows a target (typically the player mesh) using a smooth interpolation that feels responsive without jitter.

The locked design decision in `design/gdd/game-concept.md` requires a **fixed third-person follow** for jam v1, but the architecture must accept alternate rigs (orbit, free-fly) as drop-in replacements via a common `CameraRig` interface. This is the "swappable rig component" the concept doc calls out.

---

## Core Rules

### 1. Single owner of camera transform

After `bootstrap()` returns, the only code that writes to `engine.camera.position` or `engine.camera.quaternion` is the active Camera Rig instance. Other systems that need camera info READ from `engine.camera` but never WRITE to it.

### 2. Rig is updated per render frame

Camera Rig registers an `onBeforeRender` callback with Engine Bootstrap. The callback receives real elapsed time (`realDt`) and is responsible for moving the camera into position before the renderer draws the frame. **Updates use real elapsed time, not the fixed physics step**, so the camera is always smooth even if physics is running below 60 Hz.

### 3. Target is settable

`rig.setTarget(object3D | null)`:
- Setting a target attaches the rig to that Object3D
- Setting `null` detaches (camera freezes in place)
- Switching targets is instant — the new target is followed starting next frame
- The target's `.position` (world space, after matrix update) is what's followed

### 4. Default rig: Follow Camera

The default rig is **`FollowCameraRig`**, a smooth third-person follow:

- Camera is positioned at `target.position + offsetWorld` where `offsetWorld` is defined in tuning knobs (default: behind and above target)
- Camera looks at `target.position + lookAtOffset` (default: slightly above target's feet)
- **Smoothing**: position and lookAt are lerped toward the desired pose with a `followLerpFactor` (0..1, where 1 = instant snap, 0.1 = smooth)
- Lerp uses `Math.pow(1 - factor, dt * 60)` to make it frame-rate independent
- For jam v1: NO collision avoidance (no raycasting away from walls). Acceptable trade-off because dungeon rooms are open and the camera is high enough to rarely clip. Add post-jam if it becomes a problem.

### 5. Rig interface (for future swap)

```ts
export interface CameraRig {
  setTarget(target: THREE.Object3D | null): void;
  update(realDt: number): void;
  dispose(): void;
}
```

Concrete implementations:
- **`FollowCameraRig`** (jam v1) — smooth third-person follow described above
- **`OrbitCameraRig`** (post-jam) — player rotates camera with mouse, fixed distance
- **`FreeFlyCameraRig`** (debug only) — WASD camera movement, decoupled from player

The active rig is constructed once at startup and assigned to a top-level variable. Swapping is a recompile (jam v1); becomes a runtime swap post-jam if we add a settings menu for it.

### 6. Hooked into Engine Bootstrap, not the main loop directly

```ts
const rig = createFollowRig(engine.camera, configFromJSON);
engine.onBeforeRender((dt) => rig.update(dt));
```

Camera Rig does NOT own its own `requestAnimationFrame` loop. It piggybacks on Engine Bootstrap's loop.

### 7. Resize handling

Camera aspect/projection updates on window resize are owned by **Engine Bootstrap**, not Camera Rig (per Engine Bootstrap spec section 4). Camera Rig only touches `camera.position` and `camera.quaternion`.

---

## Public API Surface

```ts
// src/engine/camera-rig.ts
import * as THREE from 'three';

export interface CameraRig {
  setTarget(target: THREE.Object3D | null): void;
  update(realDt: number): void;
  dispose(): void;
}

export interface FollowRigConfig {
  offsetX: number;          // local-space offset behind target
  offsetY: number;          // local-space offset above target
  offsetZ: number;          // local-space offset behind target
  lookAtOffsetY: number;    // look slightly above the target's feet
  followLerpFactor: number; // 0..1; higher = snappier
  lookLerpFactor: number;   // 0..1; higher = snappier
}

export function createFollowRig(
  camera: THREE.PerspectiveCamera,
  config: FollowRigConfig
): CameraRig;

// Future:
// export function createOrbitRig(...): CameraRig;
// export function createFreeFlyRig(...): CameraRig;
```

---

## Tuning Knobs

All values live in `assets/data/camera.json` per the `gameplay-code` rule.

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `offsetX` | `0` | -5 — 5 | feel | Side offset; 0 = directly behind |
| `offsetY` | `4` | 1 — 10 | feel | Height above target; 4 ≈ slight downward angle |
| `offsetZ` | `7` | 3 — 15 | feel | Distance behind target; 7 ≈ MML camera feel |
| `lookAtOffsetY` | `1.2` | 0 — 3 | feel | Look at chest height, not feet |
| `followLerpFactor` | `0.12` | 0.05 — 1.0 | feel | Higher = snappier follow; 0.12 ≈ smooth but responsive |
| `lookLerpFactor` | `0.18` | 0.05 — 1.0 | feel | Slightly snappier than position so look leads movement |

**Default values reproduce the Megaman Legends camera feel: high enough to see the dungeon ahead, far enough behind for situational awareness, smooth enough that a player walking around doesn't trigger motion sickness.**

---

## Acceptance Criteria

### Functional
- [ ] `createFollowRig(camera, config)` returns a `CameraRig` instance
- [ ] `rig.setTarget(playerMesh)` causes the camera to follow the player on subsequent updates
- [ ] `rig.setTarget(null)` causes the camera to freeze (no further movement)
- [ ] After `update(dt)`, `camera.position` is closer to the desired offset than before (smooth approach)
- [ ] After many updates with a stationary target, `camera.position` converges to within 0.01 of the target offset
- [ ] `camera.lookAt(target.position + lookAtOffset)` is satisfied each frame (within lerp tolerance)
- [ ] Switching targets via `setTarget` instantly redirects without breakage
- [ ] `dispose()` is safe to call multiple times

### Behavior
- [ ] Camera does NOT jitter when target moves smoothly
- [ ] Camera does NOT lag noticeably (< 200 ms perceived delay)
- [ ] Camera does NOT clip through the floor (target is above ground; camera offset is positive Y)
- [ ] Frame-rate independent: same visual speed at 30 fps and 144 fps

### Architectural
- [ ] No other system in `src/` writes to `engine.camera.position` or `engine.camera.quaternion` (verified by grep)
- [ ] Camera Rig has NO imports from `src/gameplay/`, `src/combat/`, `src/networking/`, `src/ui/`
- [ ] All tuning values from `camera.json`, no hardcoded numbers
- [ ] `CameraRig` interface is exported and stable — alternate rigs can be added without changing the interface

---

## Constraining ADRs

| ADR | Constraint |
|---|---|
| ADR-0008 (TypeScript) | Source is `.ts`; rig interface is fully typed |
| ADR-0009 (WebGL renderer) | Camera is `PerspectiveCamera`, FOV from Engine Bootstrap config |

Locked design decision from `design/gdd/game-concept.md`: fixed third-person follow for v1, swappable interface for future orbit/free-fly options.

---

## Systems Index

Already in `design/gdd/systems-index.md` as **system #3** (Foundation, T1, L1, S effort). Update progress tracker to mark Camera Rig as **Approved** after this spec is written.

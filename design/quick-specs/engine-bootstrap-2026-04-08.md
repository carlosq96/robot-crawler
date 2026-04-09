# Quick Design Spec: Engine Bootstrap

**Type**: New Small System
**Scope**: Initialize Three.js scene/renderer/camera, Rapier physics world, asset loaders, and the fixed-timestep main loop. Expose a stable public API for all L1+ systems. Owns nothing gameplay-related.
**Date**: 2026-04-08
**Estimated Implementation**: ~4 hours

---

## Overview

Engine Bootstrap is the foundational module run once at app startup. It initializes the entire client-side runtime: Three.js Scene/Camera/WebGLRenderer, Rapier physics World, GLTFLoader+DRACOLoader for asset loading, and the requestAnimationFrame main loop with a fixed-timestep accumulator (per ADR-0007). After init, it exposes an `EngineHandle` object that all 16 downstream systems import from. It contains zero gameplay logic — Player, Enemy, etc. live elsewhere and call into the engine, not the other way around.

**Why it matters**: 16 systems depend on this. Its public API is the most load-bearing interface in the entire client codebase. The systems-index marks it as the highest-risk bottleneck. This spec exists to lock the API surface *before* any L1 system starts so we never have to refactor 16 callers.

---

## Core Rules

### 1. Initialization Order (strict, fail-fast)

The init sequence is sequential and any failure halts execution with a clear error. The order is:

1. `await RAPIER.init()` — Rapier WASM must finish loading before any Rapier API call
2. Construct `THREE.Scene`
3. Construct `THREE.PerspectiveCamera` (FOV from data file, near/far from data file, aspect from canvas)
4. Construct `THREE.WebGLRenderer` (per ADR-0009: NOT WebGPU)
5. Configure renderer:
   - `outputColorSpace = THREE.SRGBColorSpace` (per Three.js r152+ rules in `docs/engine-reference/threejs/VERSION.md`)
   - `toneMapping = THREE.ACESFilmicToneMapping`
   - `toneMappingExposure = 1.0`
   - `setPixelRatio(Math.min(devicePixelRatio, PIXEL_RATIO_CAP))`
   - `setSize(canvas.width, canvas.height)`
   - `shadowMap.enabled = true`
   - `shadowMap.type = THREE.PCFSoftShadowMap`
6. Construct `RAPIER.World` with gravity from data file
7. Construct shared `DRACOLoader` and `GLTFLoader`:
   - `dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')`
   - `gltfLoader.setDRACOLoader(dracoLoader)`
8. Wire window resize listener (debounced to one frame)
9. Start `requestAnimationFrame` loop

If any step throws, log a clear error to console (`[EngineBootstrap] init failed at step N: ...`) and re-throw. The app shows a fallback HTML message; nothing else runs.

### 2. Main Loop (fixed-timestep accumulator per ADR-0007)

Each rAF tick:

1. `dt = (now - lastTime) / 1000` (seconds)
2. `accumulator += dt`
3. **Cap the accumulator at `ACCUMULATOR_CAP_SEC`** (prevent spiral-of-death after tab unfocus)
4. While `accumulator >= FIXED_TIMESTEP_SEC`:
   - Call all `beforeStep` callbacks (input sampling, AI decisions)
   - `world.step()` (Rapier physics tick at 1/60)
   - Call all `afterStep` callbacks (entity sync mesh ← body)
   - `accumulator -= FIXED_TIMESTEP_SEC`
5. Call all `beforeRender` callbacks (HUD update, camera follow, post-FX prep)
6. `renderer.render(scene, camera)`
7. Schedule next frame

**Important:** Animation playback (Three.js `AnimationMixer`) uses **real elapsed time** `dt`, NOT the fixed timestep. Animations are visual, not simulation, so they should be smooth at native frame rate.

### 3. Public API Surface — LOCKED contract

This API is the contract every L1+ system depends on. Changes here require an ADR.

```ts
// src/engine/bootstrap.ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface EngineHandle {
  // Three.js
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  // Rapier
  readonly world: RAPIER.World;

  // Asset loading
  loadGLTF(url: string): Promise<GLTF>;

  // Loop hooks (return unsubscribe function)
  onBeforeStep(cb: () => void): () => void;
  onAfterStep(cb: () => void): () => void;
  onBeforeRender(cb: (realDt: number) => void): () => void;

  // Lifecycle
  dispose(): void;
}

export async function init(canvas: HTMLCanvasElement): Promise<EngineHandle>;
```

**Forbidden in this API:**
- Anything Player-, Enemy-, Combat-, or game-state-related (those live in their own modules)
- Direct mutation of scene contents (callers add their own meshes via `handle.scene.add(...)`)
- Network logic (lives in `src/networking/`)
- HUD / UI logic (lives in `src/ui/`)

### 4. Window resize handling

- Listen for `window.resize`
- Debounce to one rAF tick (don't update on every resize event)
- On resize:
  - `camera.aspect = canvas.clientWidth / canvas.clientHeight`
  - `camera.updateProjectionMatrix()`
  - `renderer.setSize(canvas.clientWidth, canvas.clientHeight)`

### 5. Asset loading

- `loadGLTF(url)` returns a Promise that resolves to the parsed GLTF object
- Single shared GLTFLoader + DRACOLoader instances (do not construct per-call)
- Errors reject the promise; caller handles
- Never blocks the main loop (Promise-based, runs in WebWorker for Draco decode)

### 6. Disposal (for hot reload + teardown)

- `dispose()` removes the resize listener, disposes the WebGL renderer, frees the Rapier world, clears all hook callbacks
- Idempotent — calling twice is safe

---

## Tuning Knobs

All values live in `assets/data/engine.json` (NOT hardcoded — per `gameplay-code` rule).

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `FIXED_TIMESTEP_SEC` | `0.01667` (1/60) | 1/120 to 1/30 | feel | 60 Hz physics matches render target; locked by ADR-0007 |
| `ACCUMULATOR_CAP_SEC` | `0.25` | 0.1 to 1.0 | safety | Caps catch-up after tab unfocus; 0.25 = 15 frames |
| `GRAVITY_X` | `0` | -20 to 20 | feel | Sideways gravity is for puzzle games |
| `GRAVITY_Y` | `-9.81` | -20 to 0 | feel | Real-world gravity baseline; lower = floatier |
| `GRAVITY_Z` | `0` | -20 to 20 | feel | Sideways gravity is for puzzle games |
| `PIXEL_RATIO_CAP` | `2` | 1 to 3 | perf | >2 hurts low-end GPUs; retina at 2 is fine |
| `SHADOW_MAP_SIZE` | `1024` | 256-4096 | perf/quality | Single directional light at 1024 fits frame budget |
| `FOV_DEG` | `60` | 45-90 | feel | Standard third-person FOV |
| `NEAR_PLANE` | `0.1` | 0.01-1 | tech | Standard |
| `FAR_PLANE` | `200` | 50-1000 | tech | Dungeon scale: rooms ~10x10 units, max view ~100 |
| `DRACO_DECODER_PATH` | `https://www.gstatic.com/draco/v1/decoders/` | URL | tech | Google official mirror; stable since 2018 |

---

## Acceptance Criteria

### Functional
- [ ] `init(canvas)` resolves with a valid `EngineHandle` object after Rapier WASM loads
- [ ] After init, `scene`, `camera`, `renderer`, `world` are all defined and usable
- [ ] `loadGLTF()` successfully loads a Draco-compressed test GLB asset
- [ ] Window resize updates the camera aspect ratio (no distortion at any window size)
- [ ] Tab unfocus → refocus does NOT cause a flood of physics steps (accumulator cap held)
- [ ] Calling `dispose()` releases the WebGL context cleanly (verified via DevTools — no leaks)
- [ ] Hook callbacks execute in declared order: beforeStep → step → afterStep → beforeRender → render

### Performance (jam budget per `technical-preferences.md`)
- [ ] Empty scene runs at 60 fps stable on a mid-range 2024 laptop (verified via stats panel)
- [ ] Physics step occurs exactly 60 times per simulated second (verified by counting steps over 10s)
- [ ] Render pass < 8 ms in 95th percentile on empty scene
- [ ] Initial JS heap after init < 100 MB

### Architectural / Determinism
- [ ] `EngineHandle` does NOT expose any direct gameplay state (Player, Enemy, etc.) — verified by code review
- [ ] All values from `engine.json`, NOT hardcoded — verified by grep
- [ ] No `outputEncoding`, `texture.encoding` deprecated APIs used (only `colorSpace`) — verified by lint
- [ ] WebGL renderer used, NOT WebGPU — verified by import statement
- [ ] Same input → same physics state after N seconds (deterministic, per ADR-0007)

### Regression
- [ ] Engine Bootstrap is implementable WITHOUT any L1+ system existing first (no upstream deps)
- [ ] No imports from `src/gameplay/`, `src/combat/`, `src/networking/`, `src/ui/` in `src/engine/bootstrap.ts`

---

## Constraining ADRs (this spec must not contradict)

| ADR | Constraint |
|---|---|
| ADR-0001 (no bundler) | Three.js + Rapier loaded via importmap; relative imports for local files |
| ADR-0005 (Draco) | DRACOLoader configured with gstatic decoder URL |
| ADR-0007 (fixed Rapier timestep) | Accumulator pattern, 1/60 step, max 0.25 cap |
| ADR-0008 (TypeScript) | Source is `.ts`, output per-file `.js`; no bundling |
| ADR-0009 (WebGL over WebGPU) | `WebGLRenderer`, never `WebGPURenderer` |

---

## Systems Index

Already in `design/gdd/systems-index.md` as **system #1** (Foundation, T1, L0, M effort). This spec satisfies the design requirement for that entry. After this spec is approved and written, the progress tracker should mark Engine Bootstrap as **Approved → ready for implementation**.

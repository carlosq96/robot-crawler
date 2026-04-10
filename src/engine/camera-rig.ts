/**
 * @file src/engine/camera-rig.ts
 * @description Camera Rig — owns and drives `engine.camera` position and
 * quaternion each frame. No other system writes to the camera transform.
 *
 * The default rig is a smooth fixed third-person follow (Megaman Legends style).
 * The {@link CameraRig} interface is intentionally minimal so alternate rigs
 * (orbit, free-fly, cinematic) can be swapped in as drop-in implementations
 * without changing any consumer code.
 *
 * Config values are loaded by the CONSUMER from `assets/data/camera.json` and
 * passed to {@link createFollowRig}. This module never fetches data or registers
 * its own `requestAnimationFrame` — both are the consumer's responsibility.
 *
 * Constraining ADRs:
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports;
 *             source is .ts, output is .js via per-file tsc transpile
 *   ADR-0009  WebGLRenderer (never WebGPU) — camera is THREE.PerspectiveCamera
 *
 * Locked design decision (design/gdd/game-concept.md):
 *   Fixed third-person follow for jam v1; rig must be swappable for post-jam
 *   orbit or free-fly options without changing consumer code.
 *
 * Performance contract:
 *   - ZERO heap allocations inside update() — all Vector3 / Quaternion temps
 *     are pre-allocated at module scope and reused every frame.
 *   - update() runs inside engine.onBeforeRender which is the hot render path.
 *
 * @example
 * ```ts
 * import { createFollowRig } from './engine/camera-rig.js';
 *
 * const config = await fetch('/assets/data/camera.json').then(r => r.json());
 * const rig = createFollowRig(engine.camera, config);
 * rig.setTarget(playerMesh);
 *
 * const unsub = engine.onBeforeRender((dt) => rig.update(dt));
 * // When tearing down:
 * unsub();
 * rig.dispose();
 * ```
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Module-scope reusable Vector3 temps — ZERO allocation per update() call.
// Per technical-preferences.md: "no `new Vector3()` in animation loop".
// ---------------------------------------------------------------------------

/** Desired world-space camera position this frame. */
const _desiredPos = new THREE.Vector3();

/** Desired world-space look-at target point this frame. */
const _desiredLookAt = new THREE.Vector3();

/** Scratch vector used to read target world position. */
const _targetWorldPos = new THREE.Vector3();

/** Scratch vector used to hold the local-space offset before rotation. */
const _localOffset = new THREE.Vector3();

/** Scratch quaternion used to read target world quaternion. */
const _targetWorldQuat = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Public API — LOCKED (every consumer that drives the camera depends on this).
// Changes to CameraRig require updating all concrete implementations and an ADR.
// ---------------------------------------------------------------------------

/**
 * Common interface for all camera rig implementations.
 *
 * A CameraRig is the SOLE writer of `camera.position` and `camera.quaternion`.
 * No other system in `src/` touches the camera transform. Consumers read from
 * `engine.camera` but never write to it directly.
 *
 * Planned implementations:
 *  - {@link createFollowRig} — fixed third-person follow (jam v1, this file)
 *  - `createOrbitRig`       — player-controlled orbit (post-jam stretch)
 *  - `createFreeFlyRig`     — debug free-fly camera (dev only)
 *
 * @example
 * ```ts
 * // Swap rigs at startup without changing consumer code:
 * const rig: CameraRig = useFreefly
 *   ? createFreeFlyRig(engine.camera, flyCfg)
 *   : createFollowRig(engine.camera, followCfg);
 *
 * rig.setTarget(playerMesh);
 * engine.onBeforeRender((dt) => rig.update(dt));
 * ```
 */
export interface CameraRig {
  /**
   * Attach the rig to the given target Object3D, or detach it.
   *
   * - Passing an Object3D: subsequent `update()` calls track that object.
   * - Passing `null`: the rig stops moving the camera (camera freezes in place).
   * - Switching to a new target takes effect on the very next `update()` call.
   *
   * @param target - The Three.js object to follow, or `null` to detach.
   *
   * @example
   * ```ts
   * rig.setTarget(playerMesh);   // start following
   * rig.setTarget(null);         // freeze camera
   * rig.setTarget(otherMesh);    // switch target instantly
   * ```
   */
  setTarget(target: THREE.Object3D | null): void;

  /**
   * Advance the rig one frame. Should be called from `engine.onBeforeRender`
   * so the camera is positioned before `renderer.render()` draws the frame.
   *
   * Uses `realDt` (not the fixed physics step) for smooth camera interpolation
   * even when the physics tick rate drops below the display refresh rate.
   *
   * @param realDt - Real elapsed seconds since the last rendered frame.
   */
  update(realDt: number): void;

  /**
   * Tear down the rig. Clears the target reference and marks the rig as
   * disposed so subsequent `update()` calls become no-ops.
   *
   * Idempotent — safe to call multiple times.
   *
   * @example
   * ```ts
   * unsub();      // unregister from engine.onBeforeRender
   * rig.dispose(); // release target ref
   * ```
   */
  dispose(): void;
}

/**
 * Configuration for {@link createFollowRig}.
 *
 * All values map directly to keys in `assets/data/camera.json`.
 * Tuning ranges documented in design/quick-specs/camera-rig-2026-04-08.md.
 */
export interface FollowRigConfig {
  /** World-space X offset from target position. 0 = directly behind. Range: -5 — 5. */
  offsetX: number;

  /** World-space Y offset (height) above target position. Range: 1 — 10. */
  offsetY: number;

  /** World-space Z offset behind target position. Range: 3 — 15. */
  offsetZ: number;

  /**
   * Y offset applied to the look-at point relative to target position.
   * Keeps the camera looking at chest height rather than the target's feet.
   * Range: 0 — 3.
   */
  lookAtOffsetY: number;

  /**
   * Position lerp factor (0..1). Higher = snappier follow.
   * Frame-rate-independent via `Math.pow(1 - factor, dt * 60)`.
   * Range: 0.05 — 1.0. Default: 0.12.
   */
  followLerpFactor: number;

  /**
   * Look-at lerp factor (0..1). Higher = snappier rotation.
   * Slightly higher than `followLerpFactor` so the look leads the movement.
   * Range: 0.05 — 1.0. Default: 0.18.
   */
  lookLerpFactor: number;
}

// ---------------------------------------------------------------------------
// FollowRig implementation
// ---------------------------------------------------------------------------

/**
 * Create a fixed third-person follow rig (Megaman Legends style).
 *
 * The camera is positioned at `target.position + (offsetX, offsetY, offsetZ)`
 * in world space and looks at `target.position + (0, lookAtOffsetY, 0)`.
 * Both position and look-at are smoothed toward their targets each frame with
 * frame-rate-independent lerp.
 *
 * The offset is world-space (not local to the target's facing direction). When
 * the target rotates, the camera does NOT rotate around them — that is an
 * `OrbitRig` concern.
 *
 * **v1 trade-off**: No collision avoidance (no raycasting). Acceptable because
 * dungeon rooms are open and the camera height (offsetY ≈ 4) clears most walls.
 * Add post-jam if wall-clipping becomes a playtest complaint.
 *
 * @param camera - The PerspectiveCamera to drive (owned by Engine Bootstrap).
 * @param config - Tuning values. Load from `assets/data/camera.json` and pass in.
 * @returns A fully initialized {@link CameraRig} ready for use.
 *
 * @example
 * ```ts
 * const cfg = await fetch('/assets/data/camera.json').then(r => r.json());
 * const rig = createFollowRig(engine.camera, cfg);
 * rig.setTarget(playerMesh);
 * const unsub = engine.onBeforeRender((dt) => rig.update(dt));
 * ```
 */
export function createFollowRig(
  camera: THREE.PerspectiveCamera,
  config: FollowRigConfig,
): CameraRig {
  // Current smooth look-at position (world space). Initialized on first update
  // when we know the target's world position. Using a dedicated Vector3 here
  // (not a module temp) because it carries state across frames.
  const currentLookAt = new THREE.Vector3();

  let target: THREE.Object3D | null = null;
  let disposed = false;

  /** Whether currentLookAt has been seeded from the target's position yet. */
  let initialized = false;

  return {
    setTarget(newTarget: THREE.Object3D | null): void {
      target = newTarget;
      // Reset initialized so the new target's position seeds the lookAt point
      // on the next update() call — prevents a one-frame snap artifact when
      // switching targets.
      initialized = false;
    },

    update(realDt: number): void {
      if (disposed || target === null) return;

      // Fetch target's current world position AND world rotation.
      // Using world-space transforms so parented objects work correctly.
      target.getWorldPosition(_targetWorldPos);
      target.getWorldQuaternion(_targetWorldQuat);

      // ------------------------------------------------------------------
      // Camera offset is WORLD-SPACE fixed — not rotated by the target's
      // quaternion. Space Runner's player never yaws (all angular DOF are
      // locked), so rotating the offset by the body's quaternion just
      // introduces jitter from tiny Rapier quaternion drift. The camera
      // sits at a constant world-space position relative to the player.
      //
      // For a game where the player rotates (e.g. the old MML design),
      // uncomment the applyQuaternion line below to make the camera orbit
      // with the player's facing direction.
      // ------------------------------------------------------------------
      _localOffset.set(config.offsetX, config.offsetY, config.offsetZ);
      // _localOffset.applyQuaternion(_targetWorldQuat); // disabled for Space Runner

      // ------------------------------------------------------------------
      // On first update after attaching a target, snap the camera and lookAt
      // to the desired position instantly so there is no "sweep from origin"
      // artifact on the first frame.
      // ------------------------------------------------------------------
      if (!initialized) {
        _desiredPos.set(
          _targetWorldPos.x + _localOffset.x,
          _targetWorldPos.y + _localOffset.y,
          _targetWorldPos.z + _localOffset.z,
        );
        camera.position.copy(_desiredPos);

        currentLookAt.set(
          _targetWorldPos.x,
          _targetWorldPos.y + config.lookAtOffsetY,
          _targetWorldPos.z,
        );
        camera.lookAt(currentLookAt);
        initialized = true;
        return;
      }

      // ------------------------------------------------------------------
      // Compute desired pose this frame.
      // ------------------------------------------------------------------
      _desiredPos.set(
        _targetWorldPos.x + _localOffset.x,
        _targetWorldPos.y + _localOffset.y,
        _targetWorldPos.z + _localOffset.z,
      );

      _desiredLookAt.set(
        _targetWorldPos.x,
        _targetWorldPos.y + config.lookAtOffsetY,
        _targetWorldPos.z,
      );

      // ------------------------------------------------------------------
      // Frame-rate-independent lerp.
      //
      // Formula: alpha = 1 - Math.pow(1 - factor, dt * 60)
      //
      // At dt=1/60 (60 fps): alpha = 1 - (1-factor)^1 = factor  (identity)
      // At dt=1/30 (30 fps): alpha = 1 - (1-factor)^2          (two steps)
      // At dt=1/144 (144fps): alpha = 1 - (1-factor)^(1/2.4)   (fraction)
      //
      // This ensures the same VISUAL speed regardless of frame rate, matching
      // the acceptance criterion: "same visual speed at 30 fps and 144 fps."
      // ------------------------------------------------------------------
      const followAlpha = 1 - Math.pow(1 - config.followLerpFactor, realDt * 60);
      const lookAlpha   = 1 - Math.pow(1 - config.lookLerpFactor,   realDt * 60);

      // Lerp camera position toward desired position.
      camera.position.lerp(_desiredPos, followAlpha);

      // Lerp the look-at tracking point, then point the camera at it.
      // camera.lookAt() writes camera.quaternion — this is the only code path
      // that does so (CameraRig is the sole owner of the camera transform).
      currentLookAt.lerp(_desiredLookAt, lookAlpha);
      camera.lookAt(currentLookAt);
    },

    dispose(): void {
      if (disposed) return; // idempotent
      disposed = true;
      target = null;
    },
  };
}

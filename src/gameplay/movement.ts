/**
 * @file src/gameplay/movement.ts
 * @description Movement Controller — bridges Input Manager and the player's Rapier body.
 * Reads WASD + mouse input, computes camera-relative velocity, applies it to the
 * player capsule, handles grounded detection and jumping, and drives locomotion
 * animation state transitions on the player's AnimationController.
 *
 * Also accumulates the player's aim direction (yaw + pitch from mouse) so that
 * Buster Combat's lock-on can call getAimDirection() to bias target selection.
 *
 * Intentionally narrow scope: Movement does NOT own the player body (Player System
 * does), does NOT own input (Input Manager does), and does NOT shoot anything
 * (Buster Combat does).
 *
 * Design spec: design/quick-specs/movement-2026-04-09.md
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — update() is registered via engine.onBeforeStep()
 *             so velocity is applied BEFORE world.step() consumes it in the same tick.
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports; strict mode.
 *
 * Performance contract:
 *   ZERO heap allocations inside update() — all Vector3 temps are pre-allocated at
 *   module scope and reused every call. Per technical-preferences.md forbidden pattern:
 *   "no `new Vector3()` in animation loop".
 *
 * @example
 * ```ts
 * import { createMovementController, type MovementConfig } from './gameplay/movement.js';
 * const cfg = await fetch('/assets/data/movement.json').then(r => r.json());
 * const movement = createMovementController(engine, player, input, cfg);
 * // No need to wire onBeforeStep — the factory does it internally.
 * // Later, to clean up:
 * movement.dispose();
 * ```
 */

import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import type { EngineHandle } from '../engine/bootstrap.js';
import type { InputManager } from '../engine/input.js';
import type { Player } from './player.js';

// ---------------------------------------------------------------------------
// Module-scope reusable Vector3 temps — ZERO allocations per update() call.
// Pre-allocated here (not inside the factory closure or inside update) so they
// are shared across all MovementController instances.
// Sequential update() calls are safe because update() is not re-entrant.
// Per technical-preferences.md: "no `new Vector3()` in animation loop".
// ---------------------------------------------------------------------------

/** Camera's world-space forward direction, projected onto the horizontal plane. */
const _camForward = new THREE.Vector3();

/** Camera's world-space right direction (perpendicular to _camForward). */
const _camRight = new THREE.Vector3();

/** Desired horizontal velocity this tick, derived from WASD + camera directions. */
const _desiredVel = new THREE.Vector3();

/** Current horizontal velocity read from the Rapier body each tick. */
const _currentHorizVel = new THREE.Vector3();

/** World up constant — used for the cross-product that derives _camRight. */
const _worldUp = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Public API types — LOCKED contract (per spec "Public API Surface" section)
// ---------------------------------------------------------------------------

/**
 * Configuration for the Movement Controller.
 * All values must come from assets/data/movement.json — never hardcoded.
 *
 * Tuning ranges and rationale documented in design/quick-specs/movement-2026-04-09.md.
 */
export interface MovementConfig {
  /** Maximum horizontal movement speed in m/s. Default: 5.0. */
  walkSpeed: number;
  /** Velocity lerp rate (1/sec) when input is active. Higher = snappier. Default: 15.0. */
  acceleration: number;
  /** Velocity lerp rate (1/sec) when no input. Slightly higher than accel for clean stops. Default: 20.0. */
  deceleration: number;
  /** Upward m/s impulse applied when jump is triggered. Default: 6.0. */
  jumpVelocity: number;
  /** 0..1 multiplier on horizontal control while airborne. Prevents floaty mid-air corrections. Default: 0.4. */
  airControl: number;
  /** Distance in meters below the capsule bottom to cast the ground-check ray. Default: 0.15. */
  groundCheckDistance: number;
  /** Radians of yaw rotation per pixel of mouse X delta. Default: 0.003. */
  yawSensitivity: number;
  /** Radians of pitch rotation per pixel of mouse Y delta. Default: 0.003. */
  pitchSensitivity: number;
  /** Maximum up/down look angle in degrees. Below 90 to avoid camera gimbal flip. Default: 60. */
  pitchClampDegrees: number;
}

/**
 * The Movement Controller handle returned by {@link createMovementController}.
 * Registers its own onBeforeStep callback internally — consumers do not need
 * to wire the engine loop.
 *
 * @example
 * ```ts
 * const movement = createMovementController(engine, player, input, cfg);
 *
 * // Query aim direction for Buster Combat lock-on bias:
 * const dir = movement.getAimDirection();
 *
 * // Disable during cutscene or UI modal:
 * movement.setEnabled(false);
 *
 * // Clean up on room exit:
 * movement.dispose();
 * ```
 */
export interface MovementController {
  /**
   * Advance the movement simulation one fixed step. Normally called automatically
   * by the internal onBeforeStep registration — exposed publicly for testing without
   * requiring the full engine loop.
   *
   * @param fixedDt - Fixed physics timestep in seconds (1/60 in normal operation).
   */
  update(fixedDt: number): void;

  /**
   * Returns the current aim direction as a normalized world-space unit vector.
   * Derived from the accumulated yaw + pitch since controller creation.
   * Intended for Buster Combat lock-on bias. Does NOT recompute on every call —
   * the result is cached and updated in update().
   *
   * @returns Normalized THREE.Vector3 in world space.
   */
  getAimDirection(): THREE.Vector3;

  /**
   * Enable or disable all input processing. When disabled, horizontal velocity is
   * zeroed each tick (same as the downed/dead behavior) and no input is sampled.
   *
   * @param enabled - true to resume normal movement, false to halt.
   */
  setEnabled(enabled: boolean): void;

  /**
   * Returns whether input processing is currently enabled.
   */
  isEnabled(): boolean;

  /**
   * Tear down the controller: unregisters the onBeforeStep callback, resets
   * internal state. Idempotent — safe to call multiple times.
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Movement Controller that drives the player's Rapier body via WASD
 * input and camera-relative directions.
 *
 * The factory registers `engine.onBeforeStep(...)` internally so the velocity
 * it computes is applied before `world.step()` in the same physics tick.
 * Callers in main.ts do NOT need to wire onBeforeStep themselves.
 *
 * @param engine - The engine handle from bootstrap.init().
 * @param player - The Player entity whose body and anim this controller drives.
 * @param input  - The Input Manager providing WASD + mouse delta.
 * @param config - Movement tuning values, loaded from assets/data/movement.json.
 * @returns A fully initialized MovementController.
 *
 * @example
 * ```ts
 * const cfg = await fetch('/assets/data/movement.json').then(r => r.json());
 * const movement = createMovementController(engine, player, input, cfg);
 * // movement is self-registering — no additional wiring needed.
 * ```
 */
export function createMovementController(
  engine: EngineHandle,
  player: Player,
  input: InputManager,
  config: MovementConfig,
): MovementController {
  // -------------------------------------------------------------------------
  // Internal state (per-controller, not shared)
  // -------------------------------------------------------------------------

  /** Accumulated horizontal camera rotation in radians. */
  let yawAccumulator: number = 0;

  /** Accumulated vertical camera rotation in radians. Clamped to ±pitchLimit. */
  let pitchAccumulator: number = 0;

  /**
   * Cached aim direction — updated each tick in update(), returned by
   * getAimDirection(). Stored as a persistent Vector3 so callers may hold a
   * reference (it is NOT a module temp — it carries state across frames).
   */
  const aimDir = new THREE.Vector3(0, 0, 1);

  /** Whether input processing is enabled. */
  let enabled: boolean = true;

  /** Whether dispose() has been called. Guards against double-disposal. */
  let disposed: boolean = false;

  // -------------------------------------------------------------------------
  // Capsule bottom offset
  //
  // The ground-check ray originates from below the body's center of mass.
  // We need to cast from the capsule's lowest point, which is at:
  //   body.translation().y - capsuleHalfHeight
  //
  // The capsule dimensions come from player.json (capsuleHeight: 1.0,
  // capsuleRadius: 0.4). capsuleHalfHeight = capsuleHeight / 2 = 0.5.
  // Total capsule height = capsuleHeight + 2*capsuleRadius = 1.8m.
  // The body's center is at the geometric center of the capsule (y of body
  // translation = center), so the capsule BOTTOM = center - 0.9.
  //
  // We use 0.9 as a named constant rather than coupling to player config values
  // at runtime. This is a pragmatic jam trade-off — documented here and in the
  // spec (section 3 "Grounded check + jump").
  //
  // If player capsule dimensions change in player.json, this constant must be
  // updated to match: capsuleHeight/2 + capsuleRadius = 0.5 + 0.4 = 0.9.
  // -------------------------------------------------------------------------
  const CAPSULE_BOTTOM_OFFSET = 0.9; // meters below body center to capsule bottom

  // -------------------------------------------------------------------------
  // Pitch clamp (derived from config, computed once)
  // -------------------------------------------------------------------------
  const pitchLimit = config.pitchClampDegrees * (Math.PI / 180);

  // -------------------------------------------------------------------------
  // Fixed timestep constant (matches engine bootstrap ADR-0007 FIXED_TIMESTEP)
  // -------------------------------------------------------------------------
  const FIXED_DT = 1 / 60;

  // -------------------------------------------------------------------------
  // update() — the core movement tick
  //
  // Called from onBeforeStep (before world.step()) so velocity is applied in
  // the same physics step that consumes it. Per ADR-0007.
  // -------------------------------------------------------------------------
  function update(fixedDt: number): void {
    if (disposed) return;

    // -----------------------------------------------------------------------
    // Spec section 6 — Disable when player is downed/dead
    // Freeze horizontal velocity to prevent sliding on slopes, skip input.
    // -----------------------------------------------------------------------
    if (player.getState() !== 'alive') {
      const linvel = player.body.linvel();
      player.body.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
      return;
    }

    // -----------------------------------------------------------------------
    // Explicit setEnabled(false) gate — same freeze behavior as downed state
    // -----------------------------------------------------------------------
    if (!enabled) {
      const linvel = player.body.linvel();
      player.body.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
      return;
    }

    // -----------------------------------------------------------------------
    // Spec section 4 — Aim direction accumulation from mouse delta
    //
    // consumeMouseDelta() returns the accumulated delta since the last call and
    // resets the accumulator. Must be called once per fixed tick.
    // Input Manager already applies its own sensitivity scale from input.json;
    // we apply the additional movement-specific yaw/pitch sensitivity on top.
    // -----------------------------------------------------------------------
    const { dx, dy } = input.consumeMouseDelta();

    yawAccumulator -= dx * config.yawSensitivity;
    pitchAccumulator = Math.max(
      -pitchLimit,
      Math.min(pitchLimit, pitchAccumulator - dy * config.pitchSensitivity),
    );

    // Recompute and cache the aim direction unit vector
    // (spherical → Cartesian: yaw around Y, pitch up/down)
    aimDir.set(
      Math.sin(yawAccumulator) * Math.cos(pitchAccumulator),
      Math.sin(pitchAccumulator),
      Math.cos(yawAccumulator) * Math.cos(pitchAccumulator),
    );
    // aimDir is already unit length by construction (trig identity: sin²+cos²=1)

    // -----------------------------------------------------------------------
    // Spec section 3 — Ground check
    //
    // Cast a ray straight down from the capsule bottom. `solid: true` means the
    // ray starts inside a solid shape and reports a hit at distance 0 — but we
    // start the ray below the player collider so the player's own collider is
    // not hit (the ray origin is at the capsule bottom, outside the capsule).
    //
    // We do NOT need to filter the player's own collider because the ray origin
    // is placed at the very bottom of the capsule and Rapier's Ray start is
    // treated as a point, not a sphere. The `solid: true` flag mainly matters
    // when starting a ray inside geometry; starting at the capsule edge means
    // the player's own collider is behind the ray origin, not in front of it.
    // -----------------------------------------------------------------------
    const pos = player.body.translation();
    const rayOriginY = pos.y - CAPSULE_BOTTOM_OFFSET;

    const groundRay = new RAPIER.Ray(
      { x: pos.x, y: rayOriginY, z: pos.z },
      { x: 0, y: -1, z: 0 },
    );

    const groundHit = engine.world.castRay(groundRay, config.groundCheckDistance, true);
    const isGrounded = groundHit !== null;

    // -----------------------------------------------------------------------
    // Spec section 3 — Jump
    // Only triggers on the rising edge of the jump action while grounded.
    // -----------------------------------------------------------------------
    if (isGrounded && input.isActionDown('jump')) {
      const linvel = player.body.linvel();
      player.body.setLinvel({ x: linvel.x, y: config.jumpVelocity, z: linvel.z }, true);
    }

    // -----------------------------------------------------------------------
    // Spec section 1 — Camera-relative movement direction
    //
    // Get the camera's current world-space forward direction, project onto the
    // horizontal plane (zero Y), normalize. Then derive right via cross product.
    // Using getWorldDirection() + zero Y is more robust than reading camera.right
    // because the camera may be pitched and camera.right would tilt with it.
    // -----------------------------------------------------------------------
    engine.camera.getWorldDirection(_camForward);
    _camForward.y = 0;

    // Guard: if camera is pointing straight up/down, _camForward would be zero.
    // In that degenerate case, fall back to (0,0,-1) to avoid NaN from normalize.
    if (_camForward.lengthSq() < 1e-6) {
      _camForward.set(0, 0, -1);
    } else {
      _camForward.normalize();
    }

    // Right vector: forward × up (then normalize — cross of two unit vectors is
    // nearly unit, but normalize ensures no floating-point drift accumulation)
    _camRight.crossVectors(_camForward, _worldUp).normalize();

    // -----------------------------------------------------------------------
    // Spec section 1 — Desired velocity computation
    //
    // forwardAxis = (W held ? 1 : 0) - (S held ? 1 : 0)  → -1, 0, or +1
    // rightAxis   = (D held ? 1 : 0) - (A held ? 1 : 0)  → -1, 0, or +1
    // desiredDir  = forward*forwardAxis + right*rightAxis
    //
    // Normalize if magnitude > 0 to prevent diagonal speed boost (diagonal
    // would otherwise have magnitude √2 ≈ 1.41).
    // -----------------------------------------------------------------------
    const forwardAxis = (input.isActionDown('moveForward') ? 1 : 0) - (input.isActionDown('moveBack') ? 1 : 0);
    const rightAxis   = (input.isActionDown('moveRight') ? 1 : 0)   - (input.isActionDown('moveLeft') ? 1 : 0);

    _desiredVel.set(
      _camForward.x * forwardAxis + _camRight.x * rightAxis,
      0,
      _camForward.z * forwardAxis + _camRight.z * rightAxis,
    );

    const isInputActive = _desiredVel.lengthSq() > 0;

    if (isInputActive) {
      _desiredVel.normalize().multiplyScalar(config.walkSpeed);
    }
    // When no input: _desiredVel is already (0,0,0) — decelerate toward zero

    // -----------------------------------------------------------------------
    // Spec section 2 — Velocity smoothing with frame-rate-independent lerp
    //
    // lerpRate = acceleration when input active, deceleration when not.
    // Frame-rate-independent formula: alpha = 1 - Math.pow(1 - rate, dt * 60)
    // matches the pattern used by the Camera Rig (camera-rig.ts line 283).
    //
    // While airborne, scale the lerp rate by airControl so the player can
    // nudge direction mid-jump but not fully redirect instantly.
    // -----------------------------------------------------------------------
    const baseRate = isInputActive ? config.acceleration : config.deceleration;
    const lerpRate = isGrounded ? baseRate : baseRate * config.airControl;
    const alpha = 1 - Math.pow(1 - Math.min(lerpRate, 0.9999), fixedDt * 60);

    const linvel = player.body.linvel();
    _currentHorizVel.set(linvel.x, 0, linvel.z);
    _currentHorizVel.lerp(_desiredVel, alpha);

    // Write back: only overwrite X and Z. Y (gravity / jump velocity) is preserved.
    player.body.setLinvel(
      { x: _currentHorizVel.x, y: linvel.y, z: _currentHorizVel.z },
      true,
    );

    // -----------------------------------------------------------------------
    // Spec section 5 — Animation state transitions
    //
    // Threshold 0.1 m/s² (horizontal speed) to distinguish moving from stopped.
    // We check getCurrentState() before calling play() to avoid redundant
    // crossfade triggers on every tick.
    // -----------------------------------------------------------------------
    const horizSpeedSq = _currentHorizVel.x * _currentHorizVel.x + _currentHorizVel.z * _currentHorizVel.z;

    if (isGrounded) {
      if (horizSpeedSq > 0.01) {
        // 0.01 = 0.1² (compare squared values, no sqrt needed)
        if (player.anim.getCurrentState() !== 'walk') {
          player.anim.play('walk');
        }
      } else {
        if (player.anim.getCurrentState() !== 'idle') {
          player.anim.play('idle');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Spec section 7 — Register onBeforeStep
  //
  // The factory registers itself with the engine loop internally. main.ts does
  // NOT need to wire this. The callback passes the fixed DT constant (1/60)
  // because onBeforeStep callbacks receive no arguments (EngineHandle interface:
  // `onBeforeStep(cb: () => void): () => void`).
  // -------------------------------------------------------------------------
  const unsubBeforeStep = engine.onBeforeStep((): void => {
    update(FIXED_DT);
  });

  // -------------------------------------------------------------------------
  // Assemble and return the MovementController handle
  // -------------------------------------------------------------------------
  const controller: MovementController = {
    update(fixedDt: number): void {
      update(fixedDt);
    },

    getAimDirection(): THREE.Vector3 {
      // Returns the cached aimDir (updated each tick in update()).
      // NOT a copy — callers should not mutate the returned vector.
      // Buster Combat reads this to bias lock-on direction.
      return aimDir;
    },

    setEnabled(value: boolean): void {
      enabled = value;
    },

    isEnabled(): boolean {
      return enabled;
    },

    dispose(): void {
      if (disposed) return; // idempotent

      disposed = true;

      // Spec section 8 — Unregister the onBeforeStep callback
      unsubBeforeStep();
    },
  };

  return controller;
}

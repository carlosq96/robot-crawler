/**
 * @file src/gameplay/movement.ts
 * @description Movement Controller (Space Runner rework) — bridges Input Manager
 * and the player's Rapier body. Applies a CONSTANT forward velocity (auto-run),
 * smoothed lateral dodge (A/D), edge-triggered jump, and a timed slide state with
 * a forward speed boost.
 *
 * Unlike the MML predecessor, this version:
 *   - Ignores the camera (forward is a fixed world axis, -Z)
 *   - Never accumulates mouse aim (no aim, no free-look, no combat lock-on)
 *   - Never rotates the player body (angular DOF fully locked by main.ts)
 *   - Treats "forward" as always-on — there is no W/S input
 *   - Adds a timed slide behavioural state
 *
 * Intentionally narrow scope: Movement does NOT own the player body
 * (Player System does), does NOT own input (Input Manager does), and does NOT
 * shoot anything (Super-Suit Combat will, when it ships).
 *
 * Design spec: design/quick-specs/movement-2026-04-09.md
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — update() is registered via engine.onBeforeStep()
 *             so velocity is applied BEFORE world.step() consumes it in the same tick.
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports; strict mode.
 *
 * Performance contract:
 *   ZERO heap allocations inside update() — no Vector3 temps needed because we
 *   work with scalar x/y/z components directly on the Rapier linvel object.
 *   Per technical-preferences.md: "no `new Vector3()` in animation loop".
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

import * as RAPIER from '@dimforge/rapier3d-compat';
import type { EngineHandle } from '../engine/bootstrap.js';
import type { InputManager } from '../engine/input.js';
import type { Player } from './player.js';

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
  /** Constant forward speed in m/s along world -Z. Default: 12.0. */
  forwardSpeed: number;
  /** Maximum lateral dodge speed in m/s along world ±X. Default: 7.0. */
  lateralSpeed: number;
  /** Lateral velocity lerp rate (1/sec). Higher = snappier dodge. Default: 25.0. */
  lateralAcceleration: number;
  /** Upward m/s impulse applied when jump is triggered. Default: 6.5. */
  jumpVelocity: number;
  /** 0..1 multiplier on lateral control while airborne. Default: 0.6. */
  airControl: number;
  /** Seconds a slide state lasts after activation. Default: 0.6. */
  slideDuration: number;
  /** Extra forward m/s applied during the slide window. Default: 4.0. */
  slideSpeedBoost: number;
  /** Distance in meters below the capsule bottom to cast the ground-check ray. Default: 0.15. */
  groundCheckDistance: number;
  /**
   * Capsule halfHeight used while sliding (makes the collider shorter so the player
   * physically lowers to the ground). Default: 0.1 (crouches from 1.8 m to ~1.0 m).
   */
  slideCapsuleHalfHeight: number;
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
 * // Query slide state for HUD cooldown indicator:
 * if (movement.isSliding()) hud.showSlideBar();
 *
 * // Disable during cutscene or UI modal:
 * movement.setEnabled(false);
 *
 * // Clean up on run end:
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
   * Returns true if the player is currently in the slide state.
   * Read by HUD (cooldown indicator) and future Super-Suit Combat (lockout).
   */
  isSliding(): boolean;

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
   * Subscribe to the moment a jump impulse is applied (grounded + not in lockout).
   * @returns Unsubscribe function.
   */
  onJump(cb: () => void): () => void;

  /**
   * Subscribe to the moment a slide state begins (grounded + not already sliding).
   * @returns Unsubscribe function.
   */
  onSlide(cb: () => void): () => void;

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
 * Create a Movement Controller that drives the player's Rapier body via auto-run,
 * lateral dodge, jump, and slide.
 *
 * The factory registers `engine.onBeforeStep(...)` internally so the velocity
 * it computes is applied before `world.step()` in the same physics tick.
 * Callers in main.ts do NOT need to wire onBeforeStep themselves.
 *
 * @param engine - The engine handle from bootstrap.init().
 * @param player - The Player entity whose body and anim this controller drives.
 * @param input  - The Input Manager providing moveLeft/moveRight/jump/slide actions.
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

  /** Whether input processing is enabled. */
  let enabled: boolean = true;

  /** Whether dispose() has been called. Guards against double-disposal. */
  let disposed: boolean = false;

  /**
   * Edge-triggered jump request. Set to true when the jump action transitions
   * from not-held to held (via onActionPressed). Consumed and reset each update
   * regardless of whether it was used, so a single key press only jumps once.
   */
  let jumpRequested: boolean = false;

  /**
   * Edge-triggered slide request. Set to true on slide key press. Consumed each
   * update; only converts into an active slide if grounded AND not already sliding.
   */
  let slideRequested: boolean = false;

  const jumpSubscribers: Array<() => void> = [];
  const slideSubscribers: Array<() => void> = [];

  /**
   * Seconds remaining in the current slide state. 0 means not sliding.
   * Decremented by fixedDt each tick; when it reaches 0, the slide ends and
   * the animation returns to `run`.
   */
  let slideTimeRemaining: number = 0;

  /**
   * Window-lockout flag that prevents a double-jump from the ground-check ray
   * reporting "grounded" for 1-2 ticks after the jump impulse is applied
   * (because the ray's 0.15m length still hits the floor while the body rises
   * through the first few centimeters of liftoff). Set to true when a jump
   * fires; cleared when the upward velocity decays to zero (peak of arc).
   */
  let justJumpedInGroundWindow: boolean = false;

  // Subscribe to the jump action's rising edge. Input Manager's onActionPressed
  // fires exactly once per keydown, so held jump keys do not retrigger.
  const unsubJumpPressed = input.onActionPressed('jump', (): void => {
    jumpRequested = true;
  });

  // Subscribe to the slide action's rising edge.
  const unsubSlidePressed = input.onActionPressed('slide', (): void => {
    slideRequested = true;
  });

  // -------------------------------------------------------------------------
  // Capsule bottom offset
  //
  // The ground-check ray originates from below the body's center of mass.
  // Capsule dimensions come from player.json (capsuleHeight: 1.0,
  // capsuleRadius: 0.4). Center-to-bottom = capsuleHeight/2 + capsuleRadius
  // = 0.5 + 0.4 = 0.9.
  //
  // If player capsule dimensions change in player.json, this constant must be
  // updated to match.
  // -------------------------------------------------------------------------
  const CAPSULE_BOTTOM_OFFSET = 0.9; // meters below body center to capsule bottom

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
    // Disable-state gates — freeze horizontal velocity and skip processing
    // when the player is downed/dead/disabled. Preserves Y so gravity works.
    // -----------------------------------------------------------------------
    if (player.getState() !== 'alive' || !enabled) {
      const linvel = player.body.linvel();
      player.body.setLinvel({ x: 0, y: linvel.y, z: 0 }, true);
      // Clear any pending slide state so we don't resume sliding after enable.
      if (slideTimeRemaining > 0) {
        player.restoreStandingHeight();
      }
      slideTimeRemaining = 0;
      jumpRequested = false;
      slideRequested = false;
      return;
    }

    // -----------------------------------------------------------------------
    // Ground check — raycast straight down from the capsule bottom.
    //
    // The ray origin is placed at the very bottom of the capsule (outside the
    // collider) so the player's own collider is not hit. `solid: true` mainly
    // matters when starting a ray inside geometry; starting at the capsule
    // edge means the player's own collider is behind the ray origin.
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
    // Jump (edge-triggered, ground-window lockout)
    //
    // jumpRequested is set by the onActionPressed('jump') subscriber (exactly
    // once per key press). justJumpedInGroundWindow prevents double-jumps in
    // the 1-2 ticks after liftoff when the ground raycast still reports
    // grounded. Cleared when upward velocity decays (peak of arc).
    //
    // The jump animation is triggered here as a one-shot. The anim transition
    // block below skips while currentAnimState === 'jump' so the one-shot
    // plays cleanly until the Animation Controller's finished event returns
    // state to 'idle'/'run'.
    // -----------------------------------------------------------------------
    const linvelForJump = player.body.linvel();

    if (jumpRequested && isGrounded && !justJumpedInGroundWindow) {
      player.body.setLinvel(
        { x: linvelForJump.x, y: config.jumpVelocity, z: linvelForJump.z },
        true,
      );
      player.anim.play('jump');
      justJumpedInGroundWindow = true;
      for (const cb of jumpSubscribers) cb();
    }
    // Always consume the request — a single press fires one jump attempt regardless
    // of whether it was applied. Prevents stale requests from accumulating.
    jumpRequested = false;

    // Clear the lockout when the upward impulse is spent.
    // IMPORTANT: read velocity AFTER the jump impulse is applied. Using
    // linvelForJump (sampled before the impulse) would see the pre-jump
    // Y ≈ 0, satisfy the <= 0.01 check, and clear the lockout on the SAME
    // frame the jump fires — causing the animation transition block below
    // to see hasSettled=true and immediately override the jump animation
    // with sprint.
    const postJumpLinvelY = player.body.linvel().y;
    if (justJumpedInGroundWindow && postJumpLinvelY <= 0.01) {
      justJumpedInGroundWindow = false;
    }

    // -----------------------------------------------------------------------
    // Slide (edge-triggered, timed state)
    //
    // Only activate if grounded and not already sliding. Consumes the request
    // regardless (prevents a stale request from triggering mid-air later).
    // -----------------------------------------------------------------------
    const wasSliding = slideTimeRemaining > 0;

    if (slideRequested && isGrounded && !justJumpedInGroundWindow && slideTimeRemaining <= 0) {
      slideTimeRemaining = config.slideDuration;
      player.anim.play('slide');
      player.setCrouchHalfHeight(config.slideCapsuleHalfHeight);
      for (const cb of slideSubscribers) cb();
    }
    slideRequested = false;

    const isSlidingNow = slideTimeRemaining > 0;

    // Tick down slide timer after the activation check so a freshly-started
    // slide still gets a full duration window.
    if (isSlidingNow) {
      slideTimeRemaining -= fixedDt;
    }

    // Restore standing capsule when slide ends
    if (wasSliding && slideTimeRemaining <= 0) {
      player.restoreStandingHeight();
    }

    // -----------------------------------------------------------------------
    // Forward velocity — ALWAYS ON (auto-run)
    //
    // Forward is world -Z. Slide adds an additional forward speed boost.
    // No smoothing on forward — the player is always at full run speed.
    // -----------------------------------------------------------------------
    const desiredForwardZ = -config.forwardSpeed + (isSlidingNow ? -config.slideSpeedBoost : 0);

    // -----------------------------------------------------------------------
    // Lateral velocity — smoothed toward dodge target
    //
    // lateralAxis = (D held ? 1 : 0) - (A held ? 1 : 0)  → -1, 0, or +1
    // desiredLateralX = lateralAxis * lateralSpeed
    //
    // Lerp with rate-based exponential:
    //   alpha = 1 - Math.exp(-rate * dt)
    //
    // Airborne control is scaled by airControl for weight.
    // -----------------------------------------------------------------------
    const lateralAxis =
      (input.isActionDown('moveRight') ? 1 : 0) - (input.isActionDown('moveLeft') ? 1 : 0);
    const desiredLateralX = lateralAxis * config.lateralSpeed;

    const lerpRate = isGrounded
      ? config.lateralAcceleration
      : config.lateralAcceleration * config.airControl;
    const alpha = 1 - Math.exp(-lerpRate * fixedDt);

    const linvel = player.body.linvel();
    const newLateralX = linvel.x + (desiredLateralX - linvel.x) * alpha;

    // Write back: X (smoothed lateral), Y (preserved for gravity/jump), Z (direct forward)
    player.body.setLinvel(
      { x: newLateralX, y: linvel.y, z: desiredForwardZ },
      true,
    );

    // -----------------------------------------------------------------------
    // Animation state transitions
    //
    // The jump clip is shorter than the actual airborne time (~0.5-0.9s clip
    // vs ~1.3s airborne). With holdOnFinish: ["jump"] in the Animation
    // Controller config, the jump clip clamps at its last frame when
    // finished and does NOT auto-return to sprint. Movement owns the
    // jump→sprint transition: it fires when the player actually lands
    // (isGrounded transitions from false → true while anim state is 'jump').
    //
    // Priority (first match wins):
    //   1. death → skip entirely (terminal)
    //   2. attack → skip (one-shot with auto-return, not physics-gated)
    //   3. In 'jump' state AND still airborne → hold (clip is clamped at
    //      last frame via holdOnFinish; do nothing)
    //   4. In 'jump' state AND just landed → play 'sprint' (the landing)
    //   5. Sliding → play 'slide' (if not already)
    //   6. Otherwise → play 'sprint' (if not already)
    //
    // `idle` is unreachable during active gameplay because forward is always
    // on. It only plays when the player is not alive (handled by the
    // disable-state gate at the top of update()).
    // -----------------------------------------------------------------------
    const currentAnimState = player.anim.getCurrentState();

    // Terminal / uninterruptible one-shots
    if (currentAnimState === 'death') {
      // do nothing — death is permanent
    } else if (currentAnimState === 'attack') {
      // attack auto-returns via onMixerFinished; don't override
    } else if (currentAnimState === 'jump') {
      // Jump is held at last frame by holdOnFinish. Only transition to
      // sprint when the player has ACTUALLY settled on the ground — not just
      // when the ground-check ray first touches (which can be 0.15m above
      // the surface while still falling fast). Requiring linvel.y > -1
      // ensures the player's vertical velocity has nearly zeroed out,
      // meaning the capsule is resting on the surface, not skimming past.
      const linvelY = player.body.linvel().y;
      const hasSettled = isGrounded && !justJumpedInGroundWindow && linvelY > -1;
      if (hasSettled) {
        player.anim.play('sprint');
      }
      // Otherwise: still airborne or still falling fast → hold last frame
    } else if (isSlidingNow) {
      if (currentAnimState !== 'slide') {
        player.anim.play('slide');
      }
    } else if (currentAnimState !== 'sprint') {
      player.anim.play('sprint');
    }
  }

  // -------------------------------------------------------------------------
  // Register onBeforeStep
  //
  // The factory registers itself with the engine loop internally. main.ts does
  // NOT need to wire this. The callback passes the fixed DT constant (1/60)
  // because onBeforeStep callbacks receive no arguments.
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

    isSliding(): boolean {
      return slideTimeRemaining > 0;
    },

    setEnabled(value: boolean): void {
      enabled = value;
    },

    isEnabled(): boolean {
      return enabled;
    },

    onJump(cb: () => void): () => void {
      jumpSubscribers.push(cb);
      return () => { const i = jumpSubscribers.indexOf(cb); if (i !== -1) jumpSubscribers.splice(i, 1); };
    },

    onSlide(cb: () => void): () => void {
      slideSubscribers.push(cb);
      return () => { const i = slideSubscribers.indexOf(cb); if (i !== -1) slideSubscribers.splice(i, 1); };
    },

    dispose(): void {
      if (disposed) return; // idempotent

      disposed = true;

      // Unregister all subscriptions
      unsubBeforeStep();
      unsubJumpPressed();
      unsubSlidePressed();
    },
  };

  return controller;
}

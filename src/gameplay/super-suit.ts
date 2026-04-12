/**
 * @file src/gameplay/super-suit.ts
 * @description Super-Suit Combat System — Space Runner's one combat verb.
 *
 * Single-button ability on cooldown. On activation, sweeps a forward cone
 * and destroys all breakable obstacles in range. Non-breakable obstacles
 * are unaffected. No enemies exist in v1 — the sweep only hits obstacles.
 *
 * State machine: ready → active → cooldown → ready
 *
 * Spec: design/quick-specs/super-suit-combat-2026-04-09.md (system #13, L4, T1)
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — input sampled in onBeforeRender (UI rate)
 *   ADR-0008  TypeScript everywhere — .js import extensions
 */

import type { EngineHandle } from '../engine/bootstrap.js';
import type { Player } from './player.js';
import type { InputManager } from '../engine/input.js';
import type { ObstacleSystem } from './obstacles.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Configuration loaded from assets/data/super-suit.json. */
export interface SuperSuitCombatConfig {
  /** Total cooldown in seconds after an attack fires. */
  cooldownSec: number;
  /** Seconds the "active" window lasts before transitioning to cooldown. */
  activeSec: number;
  /** Sphere radius (m) passed to getObstaclesInRange for candidate gathering. */
  attackRange: number;
  /** Half-width of the forward attack corridor (m) — X axis. */
  attackConeHalfWidth: number;
}

export type SuperSuitState = 'ready' | 'active' | 'cooldown';

/** Handle returned by {@link createSuperSuitCombat}. */
export interface SuperSuitCombat {
  /** Current state of the combat ability. */
  getState(): SuperSuitState;
  /**
   * Cooldown progress as a 0..1 fraction.
   * - 0 = just fired (full cooldown remaining)
   * - 1 = ready to fire again
   * Always 1 when state is 'ready' or 'active'.
   */
  getCooldownFraction(): number;
  /**
   * Pause/resume the entire system (input + cooldown tick).
   * Used by Planet/Checkpoint during the warp arc.
   */
  setEnabled(enabled: boolean): void;
  /**
   * Fires once per attack, after the sweep completes.
   * @param cb - brokenCount = obstacles destroyed; types = their type strings.
   */
  onAttackResolved(cb: (brokenCount: number, types: string[]) => void): () => void;
  /**
   * Fires once per broken obstacle (forwarded from ObstacleSystem.breakObstacle).
   * Consumed by Run Lifecycle for score.
   */
  onObstacleBroken(cb: (type: string) => void): () => void;
  /** Tear down: cancel rAF hook, clear subscribers. Idempotent. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the Super-Suit Combat system and begin listening for input.
 *
 * Audio integration is deferred until the Audio System ships — a TODO comment
 * marks the insertion point.
 *
 * @param engine    - Engine handle for the render-rate update hook.
 * @param player    - Player entity — reads body position + plays animation.
 * @param input     - Input manager — polls 'attack' action each frame.
 * @param obstacles - Obstacle system — range query + breakObstacle.
 * @param config    - Loaded from assets/data/super-suit.json by caller.
 */
export function createSuperSuitCombat(
  engine: EngineHandle,
  player: Player,
  input: InputManager,
  obstacles: ObstacleSystem,
  config: SuperSuitCombatConfig,
): SuperSuitCombat {
  const { cooldownSec, activeSec, attackRange, attackConeHalfWidth } = config;

  // -------------------------------------------------------------------------
  // Mutable state
  // -------------------------------------------------------------------------

  let state: SuperSuitState = 'ready';
  let activeTimer = 0;
  let cooldownTimer = 0;
  let enabled = true;
  let disposed = false;

  // Track previous attack button state for edge-trigger (isJustPressed emulation)
  let prevAttackDown = false;

  // -------------------------------------------------------------------------
  // Subscribers
  // -------------------------------------------------------------------------

  const attackResolvedCbs: Array<(brokenCount: number, types: string[]) => void> = [];
  const obstacleBrokenCbs: Array<(type: string) => void> = [];

  // -------------------------------------------------------------------------
  // Attack sweep
  // -------------------------------------------------------------------------

  function performSweep(): void {
    const pos = player.body.translation();

    // Gather all obstacles within the spherical range
    const candidates = obstacles.getObstaclesInRange(pos.x, pos.y, pos.z, attackRange);

    const brokenTypes: string[] = [];

    for (const handle of candidates) {
      const opos = obstacles.getObstaclePosition(handle);
      if (!opos) continue;

      // Must be forward of player (-Z is forward)
      if (opos.z >= pos.z) continue;

      // Must be within the lateral corridor
      if (Math.abs(opos.x - pos.x) > attackConeHalfWidth) continue;

      // Must be breakable
      if (!obstacles.isBreakable(handle)) continue;

      const type = obstacles.getObstacleType(handle) ?? 'unknown';
      brokenTypes.push(type);

      // Emit per-obstacle broken event then despawn
      // breakObstacle internally emits onObstacleBroken then despawns
      obstacles.breakObstacle(handle);

      // Also notify our own subscribers (Run Lifecycle score)
      for (const cb of obstacleBrokenCbs) cb(type);
    }

    // Notify attack-resolved subscribers (HUD flash, etc.)
    for (const cb of attackResolvedCbs) cb(brokenTypes.length, brokenTypes);
  }

  // -------------------------------------------------------------------------
  // Per-frame update (render rate — safe for input + timer)
  // -------------------------------------------------------------------------

  const unsubRender = engine.onBeforeRender((dt: number) => {
    if (disposed || !enabled) return;

    // --- Edge-trigger on attack button ---
    const attackDown = input.isActionDown('attack');
    const justPressed = attackDown && !prevAttackDown;
    prevAttackDown = attackDown;

    // --- State machine ---
    if (state === 'ready') {
      if (justPressed) {
        state = 'active';
        activeTimer = 0;

        // Play placeholder animation (no dedicated "punch" clip in v1)
        player.anim.play('jump');

        // TODO: audio.playSfx('super_suit') when Audio System ships

        performSweep();
      }
    } else if (state === 'active') {
      activeTimer += dt;
      if (activeTimer >= activeSec) {
        state = 'cooldown';
        cooldownTimer = 0;
      }
    } else if (state === 'cooldown') {
      cooldownTimer += dt;
      if (cooldownTimer >= cooldownSec) {
        state = 'ready';
        cooldownTimer = cooldownSec; // clamp to avoid overshoot artefacts
      }
    }
  });

  // -------------------------------------------------------------------------
  // Public handle
  // -------------------------------------------------------------------------

  return {
    getState(): SuperSuitState {
      return state;
    },

    getCooldownFraction(): number {
      if (state === 'ready') return 1;
      if (state === 'active') return 0;
      return Math.min(1, cooldownTimer / cooldownSec);
    },

    setEnabled(value: boolean): void {
      enabled = value;
      if (!value) {
        // Reset edge-trigger so we don't ghost-fire on re-enable
        prevAttackDown = false;
      }
    },

    onAttackResolved(cb: (brokenCount: number, types: string[]) => void): () => void {
      attackResolvedCbs.push(cb);
      return (): void => {
        const i = attackResolvedCbs.indexOf(cb);
        if (i !== -1) attackResolvedCbs.splice(i, 1);
      };
    },

    onObstacleBroken(cb: (type: string) => void): () => void {
      obstacleBrokenCbs.push(cb);
      return (): void => {
        const i = obstacleBrokenCbs.indexOf(cb);
        if (i !== -1) obstacleBrokenCbs.splice(i, 1);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubRender();
      attackResolvedCbs.length = 0;
      obstacleBrokenCbs.length = 0;
    },
  };
}

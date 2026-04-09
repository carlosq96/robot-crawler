/**
 * @file src/gameplay/player.ts
 * @description Player System — defines what a Player IS (data + lifecycle), not
 * what a Player DOES (movement, combat, etc.). Loads the player GLB(s), creates
 * a capsule Rapier rigid body, instantiates an AnimationController, and runs the
 * alive → downed → dead state machine.
 *
 * This is the FIRST gameplay system (system #5 of 22) and the central bottleneck:
 * 10 downstream systems (Movement, Buster Combat, Sub-Weapon, HUD, Upgrade,
 * In-Room Sync, etc.) consume the stable Player interface defined here.
 *
 * Public API is LOCKED — changes require an ADR. See spec:
 *   design/quick-specs/player-system-2026-04-09.md
 *
 * Constraining ADRs:
 *   ADR-0004  Server-authoritative combat — in multiplayer only server calls
 *             takeDamage; for single-player jam builds, client calls are fine
 *   ADR-0007  Fixed Rapier timestep — mesh-body sync runs in onAfterStep, NEVER
 *             in onBeforeRender
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports; strict mode
 *
 * Dual-GLB pattern: robot_hero.glb carries the mesh + skeleton; robot_hero_animations.glb
 * carries the 13 animation clips. Both are loaded and merged before creating the
 * AnimationController, because Meshy auto-rig separates mesh and animation exports.
 *
 * Data-driven: ALL numeric values come from the PlayerConfig parameter (loaded from
 * assets/data/entities/player.json by the caller). Zero hardcoded gameplay values.
 *
 * @example
 * ```ts
 * import { createPlayer } from './gameplay/player.js';
 * const config = await fetch('/assets/data/entities/player.json').then(r => r.json());
 * const player = await createPlayer(engine, config, 'local-player');
 * rig.setTarget(player.mesh);
 * ```
 */

import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import type { EngineHandle } from '../engine/bootstrap.js';
import {
  createAnimationController,
  type AnimationController,
  type AnimationControllerConfig,
} from '../engine/animation-controller.js';

// ---------------------------------------------------------------------------
// Public API — LOCKED contract (10 downstream systems depend on this interface).
// Changes require an ADR.
// ---------------------------------------------------------------------------

/** Union of all valid player lifecycle states. */
export type PlayerState = 'alive' | 'downed' | 'dead' | 'spectator';

/**
 * Configuration passed to {@link createPlayer}. Loaded from
 * assets/data/entities/player.json by the caller (main.ts or a room manager).
 * No defaults are applied here — all fields are required in the JSON.
 *
 * NOTE: animationsUrl is required because Meshy auto-rig exports mesh and
 * animation clips as separate GLBs. Both are loaded and merged at creation time.
 */
export interface PlayerConfig {
  /** URL to the GLB containing the rigged mesh + skeleton (no clips). */
  modelUrl: string;
  /** URL to the GLB containing the animation clips (no mesh). Dual-GLB pattern. */
  animationsUrl: string;
  /** World-space spawn position for the physics body. */
  spawnPosition: { x: number; y: number; z: number };
  /** Maximum HP. Default in JSON: 100. */
  maxHp: number;
  /** Capsule collider radius (half-width at waist). Default: 0.4. */
  capsuleRadius: number;
  /**
   * Distance between the two hemisphere centers of the capsule (NOT total height).
   * Total height = capsuleHeight + 2 * capsuleRadius.
   * Default: 1.0 → total ~1.8 m (human scale).
   */
  capsuleHeight: number;
  /** Fraction of maxHp restored on revive (0..1). Default: 0.5. */
  reviveHpFraction: number;
  /** State name to play on the AnimationController at creation time. Default: 'idle'. */
  initialAnimationState: string;
  /** Per-entity animation configuration forwarded to createAnimationController(). */
  animation: AnimationControllerConfig;
}

/**
 * The Player handle returned by {@link createPlayer}.
 * One instance per player entity; each has its own body, mesh, state machine, and
 * animation controller.
 *
 * This interface is the SOLE public surface for the Player System. Downstream
 * systems (Movement, HUD, Buster Combat, etc.) consume it via this interface and
 * never reach into private state.
 *
 * @example
 * ```ts
 * const player = await createPlayer(engine, config, 'session-abc');
 *
 * // Movement System writes velocity via Rapier:
 * player.body.setLinvel({ x: vx, y: vy, z: vz }, true);
 *
 * // HUD System reads state:
 * const hpFrac = player.getHp() / player.getMaxHp();
 * const unsub = player.onDamage((amount, hp) => hud.updateHealthBar(hp / player.getMaxHp()));
 *
 * // In-Room Sync reads position:
 * const pos = player.getPosition();
 * ```
 */
export interface Player {
  // Identity
  /** Session ID — maps this instance to a Colyseus client in multiplayer. */
  readonly id: string;

  // Owned resources (read-only references — Movement and Combat write via API)
  /** The Three.js mesh hierarchy root. Camera Rig targets this object. */
  readonly mesh: THREE.Object3D;
  /**
   * The Rapier dynamic rigid body. Movement System applies velocity to this.
   * Position is authoritative — mesh.position mirrors it via onAfterStep sync.
   */
  readonly body: RAPIER.RigidBody;
  /**
   * The Animation Controller instance. Movement and Combat systems call
   * anim.play('walk'), anim.play('shoot'), etc.
   */
  readonly anim: AnimationController;

  // State queries (cheap, call every frame if needed)
  /** Current lifecycle state. */
  getState(): PlayerState;
  /** Current HP. Always in range [0, maxHp]. */
  getHp(): number;
  /** Maximum HP (from config). */
  getMaxHp(): number;
  /** Revivals remaining before death is permanent. Set by Upgrade System. */
  getRevivalsRemaining(): number;
  /**
   * Returns a fresh THREE.Vector3 with the current world position.
   * Caller may keep the reference — it is NOT a shared temp.
   */
  getPosition(): THREE.Vector3;
  /** Shorthand: state === 'alive'. */
  isAlive(): boolean;

  // State mutations (server-authoritative in multiplayer per ADR-0004)
  /**
   * Reduce HP by amount (gated on alive state; applies armor reduction formula).
   * Fires onDamage event. Plays 'hit' animation. Transitions on hp === 0.
   */
  takeDamage(amount: number): void;
  /**
   * Increase HP by amount, clamped to maxHp. No-op if not alive.
   * Does NOT trigger onRevive — heal is a separate mechanic.
   */
  heal(amount: number): void;
  /**
   * Set the number of revivals remaining. Called by Upgrade System on room entry.
   * Default in JSON: 1.
   */
  setRevivalsRemaining(count: number): void;
  /**
   * Attempt to revive this player from downed state.
   * Decrements revivalsRemaining, restores hp to maxHp * reviveHpFraction,
   * transitions to alive, fires onRevive and onStateChange.
   *
   * @returns true if revive succeeded; false if state is not downed or no revivals left
   */
  revive(reviverId: string): boolean;
  /**
   * Direct state override (for spectator transition or server-driven corrections).
   * Rejected with a console.warn if transitioning OUT of 'dead' — dead is terminal.
   */
  setState(newState: PlayerState): void;

  // Lifecycle hooks — each returns an unsubscribe function
  /**
   * Subscribe to any state transition. Fires with (oldState, newState).
   * Multiple subscribers all receive the event.
   * @returns Unsubscribe function.
   */
  onStateChange(cb: (oldState: PlayerState, newState: PlayerState) => void): () => void;
  /**
   * Subscribe to every takeDamage call (when alive). Fires with (amount, currentHp).
   * @returns Unsubscribe function.
   */
  onDamage(cb: (amount: number, currentHp: number) => void): () => void;
  /**
   * Subscribe to the alive→dead or downed→dead transition. Fires once.
   * @returns Unsubscribe function.
   */
  onDeath(cb: () => void): () => void;
  /**
   * Subscribe to the downed→alive transition. Fires with the reviver's ID.
   * @returns Unsubscribe function.
   */
  onRevive(cb: (reviverId: string) => void): () => void;

  // Cleanup
  /**
   * Tear down this player:
   *   - Removes mesh from scene
   *   - Removes body from world
   *   - Disposes AnimationController
   *   - Unregisters onAfterStep and onBeforeRender callbacks
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// State machine transition table
//
// Valid transitions (per spec section 3):
//   alive    → downed    : hp <= 0 AND revivalsRemaining > 0
//   alive    → dead      : hp <= 0 AND revivalsRemaining === 0
//   downed   → alive     : revive() called with revivals remaining
//   downed   → dead      : setState('dead') — called by Run Lifecycle or teammates down
//   *        → spectator : setState('spectator') — client-only, no hp change
//   dead     → *         : REJECTED (dead is terminal)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-scope reusable Vector3 — avoids allocations in the onAfterStep callback.
// Per technical-preferences.md: "no new Vector3() in animation loop".
// ---------------------------------------------------------------------------
const _syncPos = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Player entity. Async because it loads two GLBs (mesh + animations).
 *
 * Initialization order:
 *  1. Load robot_hero.glb (rigged mesh + skeleton)
 *  2. Load robot_hero_animations.glb (13 animation clips)
 *  3. Add mesh to engine.scene at spawnPosition
 *  4. Configure shadow casting/receiving on every Mesh in the hierarchy
 *  5. Create Rapier dynamic rigid body at spawnPosition with linear damping
 *  6. Attach capsule collider to body
 *  7. Create AnimationController with merged clips
 *  8. Play initial animation state
 *  9. Register engine.onAfterStep() for mesh-body sync (ADR-0007)
 * 10. Register engine.onBeforeRender() for animation update (real dt, not fixed)
 * 11. Return the Player handle
 *
 * @param engine  - The engine handle from bootstrap.init()
 * @param config  - Player config loaded from assets/data/entities/player.json
 * @param id      - Session ID; used by In-Room Sync to map Colyseus clients
 * @returns       A fully initialized Player handle
 *
 * @example
 * ```ts
 * const config = await fetch('/assets/data/entities/player.json').then(r => r.json());
 * const player = await createPlayer(engine, config, 'local-player');
 * rig.setTarget(player.mesh);
 * ```
 */
export async function createPlayer(
  engine: EngineHandle,
  config: PlayerConfig,
  id: string,
): Promise<Player> {
  // -------------------------------------------------------------------------
  // Step 1 + 2 — Load mesh GLB and animations GLB in parallel for speed
  // -------------------------------------------------------------------------
  const [modelGLTF, animsGLTF] = await Promise.all([
    engine.loadGLTF(config.modelUrl),
    engine.loadGLTF(config.animationsUrl),
  ]);

  // -------------------------------------------------------------------------
  // Step 3 — Add mesh to scene at spawn position
  //
  // The spawn y is set from config (default: 2) so the capsule doesn't
  // intersect the floor geometry on the first physics step.
  // -------------------------------------------------------------------------
  const playerMesh = modelGLTF.scene;
  const { x: sx, y: sy, z: sz } = config.spawnPosition;
  playerMesh.position.set(sx, sy, sz);
  engine.scene.add(playerMesh);

  // -------------------------------------------------------------------------
  // Step 4 — Shadow configuration: traverse the whole hierarchy and enable
  // castShadow + receiveShadow on every THREE.Mesh node.
  // The root (playerMesh) is an Object3D — shadows are on Mesh children.
  // -------------------------------------------------------------------------
  playerMesh.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });

  // -------------------------------------------------------------------------
  // Step 5 — Create Rapier dynamic rigid body at spawn position
  //
  // Linear damping of 0.5 prevents infinite sliding in zero-friction conditions.
  // Per Rapier reference docs footgun #4: "No setLinearDamping — bodies slide
  // forever in zero-friction conditions".
  // -------------------------------------------------------------------------
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(sx, sy, sz)
    .setLinearDamping(0.5);
  const body = engine.world.createRigidBody(bodyDesc);

  // -------------------------------------------------------------------------
  // Step 6 — Attach capsule collider
  //
  // RAPIER.ColliderDesc.capsule(halfHeight, radius):
  //   halfHeight = capsuleHeight / 2 = distance from CENTER to hemisphere center
  //   (Rapier's capsule constructor takes halfHeight, not full height)
  // Total player height = capsuleHeight + 2 * capsuleRadius = ~1.8 m at defaults
  // -------------------------------------------------------------------------
  const capsuleHalfHeight = config.capsuleHeight / 2;
  const colliderDesc = RAPIER.ColliderDesc.capsule(capsuleHalfHeight, config.capsuleRadius);
  engine.world.createCollider(colliderDesc, body);

  // -------------------------------------------------------------------------
  // Step 7 — Create AnimationController with merged clips
  //
  // modelGLTF.scene holds the skeleton; animsGLTF.animations holds the clips.
  // The skeletons match because both come from the same Meshy auto-rig export.
  // We pass the clips array from animsGLTF — the controller binds them to the
  // mixer created from playerMesh.
  // -------------------------------------------------------------------------
  const animationClips = animsGLTF.animations;
  const anim = createAnimationController(playerMesh, animationClips, config.animation);

  // -------------------------------------------------------------------------
  // Step 8 — Play initial animation state
  // -------------------------------------------------------------------------
  anim.play(config.initialAnimationState);

  // -------------------------------------------------------------------------
  // Mutable player state
  // -------------------------------------------------------------------------
  let state: PlayerState = 'alive';
  let hp: number = config.maxHp;
  let revivalsRemaining: number = 1; // Upgrade System sets this via setRevivalsRemaining()

  /**
   * Armor defense fraction applied during takeDamage.
   * Formula: actualDamage = amount * (1 - armorDefenseFraction)
   * Default: 0.0 (no armor). Upgrade System will set this when armor system is built.
   * Stored as a module-local mutable so armor integration requires no API change.
   */
  let armorDefenseFraction: number = 0;

  /** Guards against double-disposal. */
  let disposed = false;

  // -------------------------------------------------------------------------
  // Event subscriber registries
  // -------------------------------------------------------------------------
  const stateChangeSubscribers: Array<(oldState: PlayerState, newState: PlayerState) => void> = [];
  const damageSubscribers: Array<(amount: number, currentHp: number) => void> = [];
  const deathSubscribers: Array<() => void> = [];
  const reviveSubscribers: Array<(reviverId: string) => void> = [];

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Execute a state transition, fire onStateChange subscribers, and return the
   * old state for callers that need it.
   */
  function transitionState(newState: PlayerState): PlayerState {
    const oldState = state;
    state = newState;
    for (const cb of stateChangeSubscribers) cb(oldState, newState);
    return oldState;
  }

  /**
   * Trigger the death path: transition to the appropriate terminal state,
   * fire onDeath subscribers, and play the death animation.
   */
  function triggerDeath(): void {
    transitionState('dead');
    for (const cb of deathSubscribers) cb();
    // Play death animation if available (no-op if 'death' not in clipMap)
    anim.play('death');
  }

  // -------------------------------------------------------------------------
  // Step 9 — Register onAfterStep for mesh ↔ body sync (ADR-0007)
  //
  // This is the ONLY place mesh.position / mesh.quaternion are mutated.
  // Movement, Buster Combat, etc. write to body via Rapier API; the sync here
  // makes the visual mesh follow the authoritative physics position.
  //
  // CAPSULE-BOTTOM OFFSET:
  // The GLB model's origin is at the character's FEET (standard Meshy/Blender
  // export convention), but the Rapier capsule's center sits at body.translation().
  // If we copy body.translation() directly to mesh.position, the mesh's feet
  // appear at the capsule CENTER — the player visually floats ~0.9 m above the
  // ground.
  //
  // Fix: subtract (capsuleHeight/2 + capsuleRadius) from the Y component so the
  // mesh's feet land at the capsule's BOTTOM (ground contact point).
  //
  // We reuse module-level _syncPos to avoid per-step allocations.
  // -------------------------------------------------------------------------
  const meshYOffset = config.capsuleHeight / 2 + config.capsuleRadius;
  const unsubAfterStep = engine.onAfterStep(() => {
    if (disposed) return;
    const t = body.translation();
    const r = body.rotation();
    _syncPos.set(t.x, t.y - meshYOffset, t.z);
    playerMesh.position.copy(_syncPos);
    playerMesh.quaternion.set(r.x, r.y, r.z, r.w);
  });

  // -------------------------------------------------------------------------
  // Step 10 — Register onBeforeRender for animation update (real dt)
  //
  // Animations are visual and must advance at the native frame rate (real dt),
  // NOT at the fixed physics tick rate. Per ADR-0007 and AnimationController spec.
  // The Player System owns this registration — main.ts must NOT register it again.
  // -------------------------------------------------------------------------
  const unsubBeforeRender = engine.onBeforeRender((realDt: number) => {
    if (disposed) return;
    anim.update(realDt);
  });

  // -------------------------------------------------------------------------
  // Assemble and return the Player handle
  // -------------------------------------------------------------------------
  const player: Player = {
    // Identity
    get id(): string { return id; },

    // Owned resources
    get mesh(): THREE.Object3D { return playerMesh; },
    get body(): RAPIER.RigidBody { return body; },
    get anim(): AnimationController { return anim; },

    // State queries
    getState(): PlayerState { return state; },
    getHp(): number { return hp; },
    getMaxHp(): number { return config.maxHp; },
    getRevivalsRemaining(): number { return revivalsRemaining; },

    getPosition(): THREE.Vector3 {
      // Returns a fresh Vector3 so the caller may hold it without aliasing issues.
      const t = body.translation();
      return new THREE.Vector3(t.x, t.y, t.z);
    },

    isAlive(): boolean { return state === 'alive'; },

    // -----------------------------------------------------------------------
    // State mutations
    // -----------------------------------------------------------------------

    takeDamage(amount: number): void {
      // Gate: only alive players take damage (per spec rule 4.1)
      if (state !== 'alive') return;

      // Apply armor defense reduction (Upgrade System sets armorDefenseFraction)
      // Formula: actualDamage = amount * (1 - armorDefenseFraction)
      const actualDamage = amount * (1 - armorDefenseFraction);

      hp = Math.max(0, hp - actualDamage);

      // Fire onDamage event with the ORIGINAL amount and current HP
      for (const cb of damageSubscribers) cb(amount, hp);

      // Play hit animation (no-op if 'hit' is not in clipMap)
      anim.play('hit');

      // Transition on HP reaching 0
      if (hp === 0) {
        if (revivalsRemaining > 0) {
          // alive → downed: teammates can still revive
          transitionState('downed');
          // Play death animation to show the downed pose
          anim.play('death');
        } else {
          // alive → dead: no revivals left, permanent
          triggerDeath();
        }
      }
    },

    heal(amount: number): void {
      // No-op if not alive (heal doesn't revive)
      if (state !== 'alive') return;
      hp = Math.min(config.maxHp, hp + amount);
    },

    setRevivalsRemaining(count: number): void {
      revivalsRemaining = count;
    },

    revive(reviverId: string): boolean {
      // Can only revive from downed state
      if (state !== 'downed') return false;
      // Revivals must be available
      if (revivalsRemaining <= 0) return false;

      revivalsRemaining -= 1;
      hp = Math.floor(config.maxHp * config.reviveHpFraction);

      // downed → alive
      transitionState('alive');

      // Notify revive subscribers
      for (const cb of reviveSubscribers) cb(reviverId);

      // Return to idle animation from revive
      anim.play('idle');

      return true;
    },

    setState(newState: PlayerState): void {
      // Dead is terminal — reject any transition out of dead (per spec acceptance criteria)
      if (state === 'dead') {
        console.warn(
          `[Player:${id}] setState("${newState}") rejected — 'dead' is a terminal state.`,
        );
        return;
      }

      // Spectator is a client-only state with no HP change (per spec section 3).
      // All other explicit setState calls (e.g. downed → dead from Run Lifecycle)
      // bypass the damage/revive logic and fire events directly.
      // Note: state !== 'dead' is already guaranteed by the early return guard above.
      if (newState === 'dead') {
        triggerDeath();
        return;
      }

      transitionState(newState);
    },

    // -----------------------------------------------------------------------
    // Lifecycle hooks
    // -----------------------------------------------------------------------

    onStateChange(cb: (oldState: PlayerState, newState: PlayerState) => void): () => void {
      stateChangeSubscribers.push(cb);
      return (): void => {
        const idx = stateChangeSubscribers.indexOf(cb);
        if (idx !== -1) stateChangeSubscribers.splice(idx, 1);
      };
    },

    onDamage(cb: (amount: number, currentHp: number) => void): () => void {
      damageSubscribers.push(cb);
      return (): void => {
        const idx = damageSubscribers.indexOf(cb);
        if (idx !== -1) damageSubscribers.splice(idx, 1);
      };
    },

    onDeath(cb: () => void): () => void {
      deathSubscribers.push(cb);
      return (): void => {
        const idx = deathSubscribers.indexOf(cb);
        if (idx !== -1) deathSubscribers.splice(idx, 1);
      };
    },

    onRevive(cb: (reviverId: string) => void): () => void {
      reviveSubscribers.push(cb);
      return (): void => {
        const idx = reviveSubscribers.indexOf(cb);
        if (idx !== -1) reviveSubscribers.splice(idx, 1);
      };
    },

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    dispose(): void {
      if (disposed) return; // idempotent

      disposed = true;

      // Unregister loop hooks
      unsubAfterStep();
      unsubBeforeRender();

      // Remove mesh from the Three.js scene
      engine.scene.remove(playerMesh);

      // Remove body from the Rapier world (also removes all attached colliders)
      engine.world.removeRigidBody(body);

      // Tear down AnimationController (stops actions, uncaches clips)
      anim.dispose();

      // Clear all subscriber arrays
      stateChangeSubscribers.length = 0;
      damageSubscribers.length = 0;
      deathSubscribers.length = 0;
      reviveSubscribers.length = 0;
    },
  };

  return player;
}

/**
 * @file src/gameplay/pickups.ts
 * @description Pickup System — factory + registry for collectible Star Dust
 * orbs in the endless runner lane. Provides distance-based collection detection
 * on the XZ plane (no Rapier sensors), idle bobbing + spinning animation, and
 * a typed event bus so downstream systems (HUD, score) can react to collections.
 *
 * All mesh parameters, collection radii, bob/spin rates, and crystal values are
 * loaded from assets/data/pickups.json. Zero gameplay values are hardcoded here.
 *
 * Animation model:
 *   - onBeforeRender accumulates real elapsed time (frame-rate independent).
 *   - Each active pickup's Y position follows a sine wave:
 *       mesh.position.y = spawnY + sin((elapsed + phase) * bobSpeed) * bobAmplitude
 *   - mesh.rotation.y increments by dt * spinSpeed each frame.
 *   - phase = handle * 0.7 ensures orbs spawned close together are visually offset.
 *
 * Collection model (onAfterStep — ADR-0007):
 *   - Compute XZ distance² from player body translation to pickup center.
 *   - If distSq < collectRadiusSq → emit onPickup(type, value), auto-despawn.
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — collection check runs in onAfterStep only
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports
 *   ADR-0009  WebGLRenderer — MeshStandardMaterial with emissive (no WebGPU shaders)
 *
 * @example
 * ```ts
 * const config = await fetch('/assets/data/pickups.json').then(r => r.json());
 * const pickups = createPickupSystem({ engine, player }, config);
 * const unsub = pickups.onPickup((type, value) => hud.addScore(value));
 * const h = pickups.spawn('stardust', 2, 0, -20);
 * // later:
 * pickups.despawn(h);
 * ```
 */

import * as THREE from 'three';
import type { EngineHandle } from '../engine/bootstrap.js';
import type { Player } from './player.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Opaque numeric handle identifying a single spawned pickup instance. */
export type PickupHandle = number;

/** Mesh descriptor for one pickup type, loaded from pickups.json. */
interface PickupMeshDef {
  shape: 'octahedron';
  radius: number;
  color: string;
  /** THREE.MeshStandardMaterial emissive color string (e.g. "#22aa88"). */
  emissive: string;
}

/** Full type definition for one pickup variant. */
interface PickupTypeDef {
  mesh: PickupMeshDef;
  /** XZ collection radius (meters). Squared internally to avoid sqrt in hot path. */
  collectRadius: number;
  /** Score / currency value awarded to the player on collection. */
  value: number;
  /** Sine-wave amplitude for vertical bobbing (meters). */
  bobAmplitude: number;
  /** Sine-wave frequency for vertical bobbing (radians/second). */
  bobSpeed: number;
  /** Y-axis rotation speed (radians/second). */
  spinSpeed: number;
}

/**
 * JSON schema for assets/data/pickups.json.
 * Passed directly to {@link createPickupSystem} — the caller fetches and
 * parses it; this system does not perform I/O.
 */
export interface PickupTypeDefs {
  types: Record<string, PickupTypeDef>;
}

/**
 * The Pickup System handle returned by {@link createPickupSystem}.
 * The Track Generator calls spawn()/despawn(); HUD and score systems
 * subscribe to onPickup.
 */
export interface PickupSystem {
  /**
   * Spawn a pickup of the given type at world position (x, y, z).
   * The mesh is placed at (x, y + radius, z) so the bottom of the orb
   * rests on the y plane at rest position.
   *
   * @param type - Key into PickupTypeDefs.types (e.g. 'stardust').
   * @param x    - World X.
   * @param y    - Floor Y (mesh bottom will sit here at rest).
   * @param z    - World Z.
   * @returns An opaque handle used for despawn calls.
   * @throws If type is not present in the config passed at construction time.
   */
  spawn(type: string, x: number, y: number, z: number): PickupHandle;

  /**
   * Remove a pickup from the scene and the internal registry.
   * Idempotent — safe to call with a handle that has already been despawned
   * (e.g. after it was auto-collected).
   *
   * @param handle - Handle returned by {@link spawn}.
   */
  despawn(handle: PickupHandle): void;

  /**
   * Subscribe to the pickup-collected event. Fired automatically when the
   * player walks within collectRadius of a pickup.
   *
   * @param cb - Called with the pickup type string and its score value.
   * @returns Unsubscribe function.
   */
  onPickup(cb: (type: string, value: number) => void): () => void;

  /**
   * Tear down the Pickup System:
   *   - Despawns all active pickups (removes meshes, disposes geometry + material)
   *   - Unregisters onBeforeRender and onAfterStep callbacks
   *   - Clears all event subscribers
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}

/** Dependencies injected at construction time. */
export interface PickupSystemDeps {
  engine: EngineHandle;
  player: Player;
}

// ---------------------------------------------------------------------------
// Internal entity stored per active pickup
// ---------------------------------------------------------------------------

interface PickupEntity {
  type: string;
  mesh: THREE.Mesh;
  /** Y world position when spawned — bob animation oscillates around this. */
  spawnY: number;
  /** Score value awarded on collection. */
  value: number;
  /** collectRadius² — cached to avoid per-step multiplication. */
  collectRadiusSq: number;
  /** Per-instance phase offset (handle * 0.7) so nearby orbs bob out-of-sync. */
  phase: number;
  /** Spin speed in radians/second from the type def. */
  spinSpeed: number;
  /** Bob amplitude in meters from the type def. */
  bobAmplitude: number;
  /** Bob frequency in radians/second from the type def. */
  bobSpeed: number;
}

// ---------------------------------------------------------------------------
// Module-scope scratch variables — zero allocations in hot path
// ---------------------------------------------------------------------------

/** Reused for XZ distance calculation in the collection loop. */
let _dx = 0;
let _dz = 0;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Pickup System bound to the given engine and player.
 *
 * @param deps   - Engine handle and player reference (injected, not singletons).
 * @param config - Parsed contents of assets/data/pickups.json.
 * @returns      A fully initialized PickupSystem handle.
 *
 * @example
 * ```ts
 * const cfg = await fetch('/assets/data/pickups.json').then(r => r.json());
 * const pickups = createPickupSystem({ engine, player }, cfg);
 * ```
 */
export function createPickupSystem(
  deps: PickupSystemDeps,
  config: PickupTypeDefs,
): PickupSystem {
  const { engine, player } = deps;

  // -------------------------------------------------------------------------
  // Active pickup registry
  // -------------------------------------------------------------------------
  const active = new Map<PickupHandle, PickupEntity>();
  let nextHandle = 1;

  // -------------------------------------------------------------------------
  // Module-scope elapsed accumulator for bob animation
  // Incremented by real dt in onBeforeRender (frame-rate independent).
  // -------------------------------------------------------------------------
  let elapsed = 0;

  // -------------------------------------------------------------------------
  // Event subscriber registries
  // -------------------------------------------------------------------------
  const pickupSubscribers: Array<(type: string, value: number) => void> = [];

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Remove mesh from scene, dispose GPU resources, delete from map. */
  function removeMesh(entity: PickupEntity): void {
    engine.scene.remove(entity.mesh);
    entity.mesh.geometry.dispose();
    if (Array.isArray(entity.mesh.material)) {
      for (const m of entity.mesh.material) m.dispose();
    } else {
      (entity.mesh.material as THREE.Material).dispose();
    }
  }

  // -------------------------------------------------------------------------
  // onBeforeRender — bob + spin animation (real dt, frame-rate independent)
  // -------------------------------------------------------------------------
  const unsubBeforeRender = engine.onBeforeRender((realDt: number): void => {
    elapsed += realDt;

    for (const [, entity] of active) {
      // Vertical bob: oscillate around spawnY
      entity.mesh.position.y =
        entity.spawnY +
        Math.sin((elapsed + entity.phase) * entity.bobSpeed) * entity.bobAmplitude;

      // Continuous Y-axis spin
      entity.mesh.rotation.y += realDt * entity.spinSpeed;
    }
  });

  // -------------------------------------------------------------------------
  // onAfterStep — XZ collection detection (fixed timestep per ADR-0007)
  // -------------------------------------------------------------------------
  const unsubAfterStep = engine.onAfterStep((): void => {
    if (!player.isAlive()) return;

    const bodyPos = player.body.translation();
    const px = bodyPos.x;
    const pz = bodyPos.z;

    // Collect handles to remove after iteration (avoids mutating map mid-loop)
    const toCollect: PickupHandle[] = [];

    for (const [handle, entity] of active) {
      _dx = px - entity.mesh.position.x;
      _dz = pz - entity.mesh.position.z;
      const distSq = _dx * _dx + _dz * _dz;

      if (distSq < entity.collectRadiusSq) {
        toCollect.push(handle);
      }
    }

    for (const handle of toCollect) {
      const entity = active.get(handle);
      if (!entity) continue; // already gone (defensive)

      // Emit event before removal so subscribers can read entity.mesh.position
      for (const cb of pickupSubscribers) cb(entity.type, entity.value);

      removeMesh(entity);
      active.delete(handle);
    }
  });

  // -------------------------------------------------------------------------
  // Assemble and return the PickupSystem handle
  // -------------------------------------------------------------------------
  let disposed = false;

  const system: PickupSystem = {

    spawn(type: string, x: number, y: number, z: number): PickupHandle {
      const def = config.types[type];
      if (!def) {
        throw new Error(`[PickupSystem] Unknown pickup type "${type}". ` +
          `Available: ${Object.keys(config.types).join(', ')}`);
      }

      // OctahedronGeometry: detail=0 gives a clean 8-face gem shape
      const geometry = new THREE.OctahedronGeometry(def.mesh.radius, 0);
      const material = new THREE.MeshStandardMaterial({
        color:    new THREE.Color(def.mesh.color),
        emissive: new THREE.Color(def.mesh.emissive),
        roughness: 0.3,
        metalness: 0.6,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow    = true;
      mesh.receiveShadow = false; // emissive orbs don't need to receive shadows

      // Place mesh center at (x, y + radius, z) so the bottom of the orb
      // sits at y (the floor plane) at rest.
      const spawnY = y + def.mesh.radius;
      mesh.position.set(x, spawnY, z);
      engine.scene.add(mesh);

      const handle = nextHandle++;
      active.set(handle, {
        type,
        mesh,
        spawnY,
        value: def.value,
        collectRadiusSq: def.collectRadius * def.collectRadius,
        phase: handle * 0.7, // stagger bob phase per instance
        spinSpeed:    def.spinSpeed,
        bobAmplitude: def.bobAmplitude,
        bobSpeed:     def.bobSpeed,
      });

      return handle;
    },

    despawn(handle: PickupHandle): void {
      const entity = active.get(handle);
      if (!entity) return; // idempotent
      removeMesh(entity);
      active.delete(handle);
    },

    onPickup(cb: (type: string, value: number) => void): () => void {
      pickupSubscribers.push(cb);
      return (): void => {
        const idx = pickupSubscribers.indexOf(cb);
        if (idx !== -1) pickupSubscribers.splice(idx, 1);
      };
    },

    dispose(): void {
      if (disposed) return; // idempotent
      disposed = true;

      // Despawn all active pickups
      for (const [, entity] of active) {
        removeMesh(entity);
      }
      active.clear();

      // Unregister engine loop hooks
      unsubBeforeRender();
      unsubAfterStep();

      // Clear all event subscriber arrays
      pickupSubscribers.length = 0;
    },
  };

  return system;
}

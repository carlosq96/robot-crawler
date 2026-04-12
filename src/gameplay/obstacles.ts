/**
 * @file src/gameplay/obstacles.ts
 * @description Obstacle System — factory + registry for hazards in the Track
 * Generator's endless runner lane. Provides distance-based hit detection on the
 * XZ plane (no Rapier sensors) and a typed event bus for downstream systems
 * (HUD, score, run-lifecycle) to react to collisions and breaks.
 *
 * All mesh shapes and hit radii are loaded from assets/data/obstacles.json.
 * Zero gameplay values are hardcoded here.
 *
 * Hit detection model (on-touch death per Space Runner spec):
 *   - Each physics step (onAfterStep), iterate active obstacles.
 *   - Compute XZ distance² from player body translation to obstacle center.
 *   - If distance² < hitRadiusSq AND player.isAlive() → player.takeDamage(999),
 *     emit onObstacleHit, break immediately (one death per step).
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — hit detection runs in onAfterStep only
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports
 *   ADR-0009  WebGLRenderer — MeshStandardMaterial only (no WebGPU shaders)
 *
 * @example
 * ```ts
 * const config = await fetch('/assets/data/obstacles.json').then(r => r.json());
 * const obstacles = createObstacleSystem({ engine, player }, config);
 * const unsub = obstacles.onObstacleHit((type) => hud.flashDamage(type));
 * const h = obstacles.spawn('boulder', 4, 0, -30);
 * // later:
 * obstacles.despawn(h);
 * ```
 */

import * as THREE from 'three';
import type { EngineHandle } from '../engine/bootstrap.js';
import type { Player } from './player.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Opaque numeric handle identifying a single spawned obstacle instance. */
export type ObstacleHandle = number;

/** Shape descriptor for one obstacle type, loaded from obstacles.json. */
interface ObstacleMeshDef {
  shape: 'box' | 'cylinder' | 'sphere';
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  color: string;
}

/** Full type definition for one obstacle variant. */
interface ObstacleTypeDef {
  mesh: ObstacleMeshDef;
  /** XZ hit radius (meters). Squared internally to avoid sqrt in hot path. */
  hitRadius: number;
  /** If true, breakObstacle() emits onObstacleBroken before despawning. */
  breakable: boolean;
}

/**
 * JSON schema for assets/data/obstacles.json.
 * Passed directly to {@link createObstacleSystem} — the caller fetches and
 * parses it; this system does not perform I/O.
 */
export interface ObstacleTypeDefs {
  types: Record<string, ObstacleTypeDef>;
}

/**
 * The Obstacle System handle returned by {@link createObstacleSystem}.
 * The Track Generator calls spawn()/despawn(); Combat and Run Lifecycle
 * subscribe to the event hooks.
 */
export interface ObstacleSystem {
  /**
   * Spawn an obstacle of the given type at world position (x, y, z).
   * The mesh is placed at (x, y + halfHeight, z) so the bottom of the
   * geometry rests on the y plane.
   *
   * @param type - Key into ObstacleTypeDefs.types (e.g. 'boulder').
   * @param x    - World X.
   * @param y    - Floor Y (mesh bottom will sit here).
   * @param z    - World Z.
   * @returns An opaque handle used for despawn / query calls.
   * @throws If type is not present in the config passed at construction time.
   */
  spawn(type: string, x: number, y: number, z: number): ObstacleHandle;

  /**
   * Remove an obstacle from the scene and the internal registry.
   * Idempotent — safe to call with a handle that has already been despawned.
   *
   * @param handle - Handle returned by {@link spawn}.
   */
  despawn(handle: ObstacleHandle): void;

  /**
   * Emit the onObstacleBroken event for the given handle, then despawn it.
   * No-op if the handle is no longer active.
   *
   * @param handle - Handle of a breakable obstacle.
   */
  breakObstacle(handle: ObstacleHandle): void;

  /**
   * Return all active obstacle handles whose centers lie within `radius`
   * meters of the point (ox, oy, oz) in 3-D space.
   *
   * @param ox     - Query center X.
   * @param oy     - Query center Y.
   * @param oz     - Query center Z.
   * @param radius - Search radius (meters).
   * @returns Array of handles; empty if none in range.
   */
  getObstaclesInRange(ox: number, oy: number, oz: number, radius: number): ObstacleHandle[];

  /**
   * Return the type string (e.g. 'boulder') for a handle, or null if the
   * handle is not active.
   */
  getObstacleType(handle: ObstacleHandle): string | null;

  /**
   * Return whether the obstacle identified by handle is breakable, or false
   * if the handle is not active.
   */
  isBreakable(handle: ObstacleHandle): boolean;

  /**
   * Return the world-space center position of the obstacle, or null if the
   * handle is not active. Used by Super-Suit Combat for cone filtering.
   */
  getObstaclePosition(handle: ObstacleHandle): { x: number; y: number; z: number } | null;

  /**
   * Subscribe to the obstacle-hit event. Fired once per physics step at most,
   * with the type string of the obstacle that killed the player.
   *
   * @param cb - Called with the obstacle type string.
   * @returns Unsubscribe function.
   */
  onObstacleHit(cb: (type: string) => void): () => void;

  /**
   * Subscribe to the obstacle-broken event. Fired by {@link breakObstacle}
   * before the mesh is removed.
   *
   * @param cb - Called with the obstacle type string.
   * @returns Unsubscribe function.
   */
  onObstacleBroken(cb: (type: string) => void): () => void;

  /**
   * Tear down the Obstacle System:
   *   - Despawns all active obstacles (removes meshes from scene, disposes geometry + material)
   *   - Unregisters the onAfterStep callback
   *   - Clears all event subscribers
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}

/** Dependencies injected at construction time. */
export interface ObstacleSystemDeps {
  engine: EngineHandle;
  player: Player;
}

// ---------------------------------------------------------------------------
// Internal entity stored per active obstacle
// ---------------------------------------------------------------------------

interface ObstacleEntity {
  type: string;
  mesh: THREE.Mesh;
  /** Mesh center X (world space). */
  cx: number;
  /** Mesh center Y (world space) — used only for getObstaclesInRange 3-D query. */
  cy: number;
  /** Mesh center Z (world space). */
  cz: number;
  /** Top of the obstacle in world Y — player capsule bottom must be above this to jump over. */
  topY: number;
  /** hitRadius² — cached to avoid per-step multiplication. */
  hitRadiusSq: number;
  breakable: boolean;
}

// ---------------------------------------------------------------------------
// Module-scope scratch variables — zero allocations in hot path
// ---------------------------------------------------------------------------

/** Reused for XZ distance calculation in the hit-detection loop. */
let _dx = 0;
let _dz = 0;

// ---------------------------------------------------------------------------
// Geometry factory — creates THREE primitives from ObstacleMeshDef
// ---------------------------------------------------------------------------

/**
 * Build a THREE.BufferGeometry from a mesh shape descriptor.
 * CylinderGeometry: 12 segments is sufficient for obstacle-scale objects
 * and keeps the vertex count low (perf-analyst guideline).
 */
function buildGeometry(def: ObstacleMeshDef): THREE.BufferGeometry {
  switch (def.shape) {
    case 'box':
      return new THREE.BoxGeometry(
        def.width  ?? 1,
        def.height ?? 1,
        def.depth  ?? 1,
      );
    case 'cylinder':
      return new THREE.CylinderGeometry(
        def.radiusTop    ?? 0.5,
        def.radiusBottom ?? 0.5,
        def.height       ?? 1,
        12, // radial segments
      );
    case 'sphere':
      return new THREE.SphereGeometry(
        def.radius ?? 0.5,
        16, // width segments
        12, // height segments
      );
    default: {
      // Exhaustive-check fallback — unknown shape treated as unit box.
      const _exhaustive: never = def.shape;
      console.warn(`[ObstacleSystem] Unknown mesh shape "${String(_exhaustive)}" — falling back to BoxGeometry.`);
      return new THREE.BoxGeometry(1, 1, 1);
    }
  }
}

/**
 * Compute the Y-axis half-extent of a mesh def so spawn() can lift the mesh
 * off the floor. Returns half the height dimension regardless of shape.
 */
function halfHeight(def: ObstacleMeshDef): number {
  switch (def.shape) {
    case 'box':
      return (def.height ?? 1) / 2;
    case 'cylinder':
      return (def.height ?? 1) / 2;
    case 'sphere':
      return def.radius ?? 0.5;
    default:
      return 0.5;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an Obstacle System bound to the given engine and player.
 *
 * @param deps   - Engine handle and player reference (injected, not singletons).
 * @param config - Parsed contents of assets/data/obstacles.json.
 * @returns      A fully initialized ObstacleSystem handle.
 *
 * @example
 * ```ts
 * const cfg = await fetch('/assets/data/obstacles.json').then(r => r.json());
 * const obstacles = createObstacleSystem({ engine, player }, cfg);
 * ```
 */
export function createObstacleSystem(
  deps: ObstacleSystemDeps,
  config: ObstacleTypeDefs,
): ObstacleSystem {
  const { engine, player } = deps;

  // -------------------------------------------------------------------------
  // Active obstacle registry
  // -------------------------------------------------------------------------
  const active = new Map<ObstacleHandle, ObstacleEntity>();
  let nextHandle = 1;

  // -------------------------------------------------------------------------
  // Event subscriber registries
  // -------------------------------------------------------------------------
  const hitSubscribers:    Array<(type: string) => void> = [];
  const brokenSubscribers: Array<(type: string) => void> = [];

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Remove mesh from scene, dispose GPU resources, delete from map. */
  function removeMesh(entity: ObstacleEntity): void {
    engine.scene.remove(entity.mesh);
    entity.mesh.geometry.dispose();
    if (Array.isArray(entity.mesh.material)) {
      for (const m of entity.mesh.material) m.dispose();
    } else {
      (entity.mesh.material as THREE.Material).dispose();
    }
  }

  // -------------------------------------------------------------------------
  // onAfterStep — XZ hit detection (one death per physics tick max)
  // -------------------------------------------------------------------------
  const unsubAfterStep = engine.onAfterStep((): void => {
    if (!player.isAlive()) return;

    const bodyPos = player.body.translation();
    const px = bodyPos.x;
    const py = bodyPos.y;
    const pz = bodyPos.z;

    // Player capsule bottom Y (center - halfHeight - radius = py - 0.9).
    // If the capsule bottom is above the obstacle top, the player jumped
    // over it — skip the hit check. Obstacle top = entity.cy + entity.halfHeight.
    // A small tolerance (0.2m) prevents grazing kills at the apex.
    const capsuleBottomY = py - 0.9;

    for (const [handle, entity] of active) {
      // Y-axis check: skip obstacles the player has jumped over
      if (capsuleBottomY > entity.topY + 0.2) {
        void handle;
        continue;
      }

      _dx = px - entity.cx;
      _dz = pz - entity.cz;
      const distSq = _dx * _dx + _dz * _dz;

      if (distSq < entity.hitRadiusSq) {
        // On-touch death: deal lethal damage (maxHp=1 in Space Runner)
        player.takeDamage(999);

        // Notify subscribers with the type that caused the hit
        for (const cb of hitSubscribers) cb(entity.type);

        // One death per tick — stop checking remaining obstacles
        break;
      }

      // Suppress TS unused-variable warning on handle; map iteration needs it.
      void handle;
    }
  });

  // -------------------------------------------------------------------------
  // Assemble and return the ObstacleSystem handle
  // -------------------------------------------------------------------------
  let disposed = false;

  const system: ObstacleSystem = {

    spawn(type: string, x: number, y: number, z: number): ObstacleHandle {
      const def = config.types[type];
      if (!def) {
        throw new Error(`[ObstacleSystem] Unknown obstacle type "${type}". ` +
          `Available: ${Object.keys(config.types).join(', ')}`);
      }

      const geometry = buildGeometry(def.mesh);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(def.mesh.color),
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;

      // Place mesh so its bottom rests on y (floor plane)
      const yCenter = y + halfHeight(def.mesh);
      mesh.position.set(x, yCenter, z);
      engine.scene.add(mesh);

      const handle = nextHandle++;
      active.set(handle, {
        type,
        mesh,
        cx: x,
        cy: yCenter,
        cz: z,
        topY: y + halfHeight(def.mesh) * 2, // top of the obstacle in world Y
        hitRadiusSq: def.hitRadius * def.hitRadius,
        breakable: def.breakable,
      });

      return handle;
    },

    despawn(handle: ObstacleHandle): void {
      const entity = active.get(handle);
      if (!entity) return; // idempotent
      removeMesh(entity);
      active.delete(handle);
    },

    breakObstacle(handle: ObstacleHandle): void {
      const entity = active.get(handle);
      if (!entity) return; // handle already gone — no-op

      // Emit broken event before the mesh is removed so subscribers can
      // spawn VFX at entity.mesh.position if needed.
      for (const cb of brokenSubscribers) cb(entity.type);

      removeMesh(entity);
      active.delete(handle);
    },

    getObstaclesInRange(ox: number, oy: number, oz: number, radius: number): ObstacleHandle[] {
      const radiusSq = radius * radius;
      const result: ObstacleHandle[] = [];
      for (const [handle, entity] of active) {
        const dx = ox - entity.cx;
        const dy = oy - entity.cy;
        const dz = oz - entity.cz;
        if (dx * dx + dy * dy + dz * dz < radiusSq) {
          result.push(handle);
        }
      }
      return result;
    },

    getObstacleType(handle: ObstacleHandle): string | null {
      return active.get(handle)?.type ?? null;
    },

    isBreakable(handle: ObstacleHandle): boolean {
      return active.get(handle)?.breakable ?? false;
    },

    getObstaclePosition(handle: ObstacleHandle): { x: number; y: number; z: number } | null {
      const e = active.get(handle);
      if (!e) return null;
      return { x: e.cx, y: e.cy, z: e.cz };
    },

    onObstacleHit(cb: (type: string) => void): () => void {
      hitSubscribers.push(cb);
      return (): void => {
        const idx = hitSubscribers.indexOf(cb);
        if (idx !== -1) hitSubscribers.splice(idx, 1);
      };
    },

    onObstacleBroken(cb: (type: string) => void): () => void {
      brokenSubscribers.push(cb);
      return (): void => {
        const idx = brokenSubscribers.indexOf(cb);
        if (idx !== -1) brokenSubscribers.splice(idx, 1);
      };
    },

    dispose(): void {
      if (disposed) return; // idempotent
      disposed = true;

      // Despawn all active obstacles (removes meshes + disposes GPU resources)
      for (const [, entity] of active) {
        removeMesh(entity);
      }
      active.clear();

      // Unregister physics hook
      unsubAfterStep();

      // Clear all event subscriber arrays
      hitSubscribers.length    = 0;
      brokenSubscribers.length = 0;
    },
  };

  return system;
}

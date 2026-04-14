/**
 * @file src/gameplay/track-generator.ts
 * @description Track Generator — produces procedural planet segments for Space Runner.
 * Given a biome + seed + planet index, lays out a deterministic sequence of
 * pre-authored "obstacle chunks" along world -Z, spawns a jump-gate at the
 * planet's end, and streams chunks in ahead of the player / out behind.
 *
 * The generator is **producer-only**: it instantiates obstacles + pickups via
 * their system factories, emits one event (onJumpGateReached), and knows
 * nothing about HP, scoring, or input.
 *
 * Core design trick: chunks are hand-authored JSON templates, not fully
 * procedural. Each biome has 5 templates; the generator picks from the pool
 * using a seeded PRNG. Trades unbounded variety for guaranteed fairness.
 *
 * Spec: design/quick-specs/track-generator-2026-04-09.md
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — streaming runs in onBeforeStep
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports
 *   ADR-0009  WebGLRenderer — MeshStandardMaterial only
 */

import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import type { EngineHandle } from '../engine/bootstrap.js';
import type { Player } from './player.js';
import type { ObstacleSystem, ObstacleHandle } from './obstacles.js';
import type { PickupSystem, PickupHandle } from './pickups.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Single obstacle placement within a chunk template (chunk-local coords). */
interface ChunkObstacleDef {
  type: string;
  x: number;
  z: number;
}

/** Single pickup placement within a chunk template (chunk-local coords). */
interface ChunkPickupDef {
  type: string;
  x: number;
  z: number;
}

/** One hand-authored chunk template from the biome JSON. */
export interface ChunkTemplate {
  id: string;
  obstacles: ChunkObstacleDef[];
  pickups: ChunkPickupDef[];
}

/** Biome definition loaded from assets/data/biomes/[biome].json. */
export interface BiomeData {
  name: string;
  ground: { color: string; roughness: number; metallic: number };
  chunks: ChunkTemplate[];
}

/** Jump-gate visual + trigger config from assets/data/track.json. */
export interface JumpGateConfig {
  torusRadius: number;
  torusTube: number;
  triggerHalfWidth: number;
  triggerHalfHeight: number;
  triggerHalfDepth: number;
  localZOffset: number;
  color: string;
  emissiveColor: string;
  emissiveIntensity: number;
}

/** Track-level config loaded from assets/data/track.json (planet-independent). */
export interface TrackConfig {
  planetLength: number;
  chunkLength: number;
  chunksAhead: number;
  chunksBehind: number;
  lateralBound: number;
  jumpGate: JumpGateConfig;
}

/**
 * Per-planet parameters passed when creating a Track Generator instance.
 * Combined with TrackConfig to form the full config.
 */
export interface TrackGeneratorParams {
  biome: BiomeData;
  seed: string;
  planetIndex: number;
}

/**
 * The Track Generator handle returned by {@link createTrackGenerator}.
 * Planet/Checkpoint subscribes to onJumpGateReached; HUD queries getProgress().
 */
export interface TrackGenerator {
  /**
   * Subscribe to the jump-gate-reached event. Fired exactly once when the
   * player crosses the jump-gate trigger at the end of the planet.
   *
   * @param cb - Called with no arguments.
   * @returns Unsubscribe function.
   */
  onJumpGateReached(cb: () => void): () => void;

  /** Return the number of currently active (spawned) chunks. */
  getActiveChunkCount(): number;

  /** Return progress through the planet as a 0..1 fraction. */
  getProgress(): number;

  /**
   * Tear down the Track Generator:
   *   - Despawns all active chunks (obstacles, pickups, ground tiles, colliders)
   *   - Removes lateral walls
   *   - Unregisters onBeforeStep callback
   *   - Clears all event subscribers
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Runtime state for a single spawned chunk. */
interface ChunkInstance {
  groundMesh: THREE.Mesh;
  groundBody: RAPIER.RigidBody;
  obstacleHandles: ObstacleHandle[];
  pickupHandles: PickupHandle[];
  /** Jump-gate torus mesh — only present on the final chunk. */
  gateMesh: THREE.Mesh | null;
}

// ---------------------------------------------------------------------------
// Seeded PRNG — deterministic chunk selection
// ---------------------------------------------------------------------------

/**
 * djb2 string hash — fast, deterministic, good distribution.
 * Returns an unsigned 32-bit integer.
 */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic chunk selection. Same (seed, planetIndex, chunkIndex) always
 * produces the same template index — enables future daily-seed leaderboards.
 */
function pickTemplateIndex(
  seed: string,
  planetIndex: number,
  chunkIndex: number,
  poolSize: number,
): number {
  const hash = hashString(`${seed}:${planetIndex}:${chunkIndex}`);
  return hash % poolSize;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Track Generator for one planet segment.
 *
 * @param engine    - Engine handle (scene, world, loop hooks).
 * @param player    - Player entity — reads body.translation().z for streaming.
 * @param obstacles - Obstacle System — calls spawn()/despawn().
 * @param pickups   - Pickup System — calls spawn()/despawn().
 * @param trackCfg  - Planet-independent track config (from track.json).
 * @param params    - Per-planet parameters (biome data, seed, planet index).
 * @returns A fully initialized TrackGenerator handle.
 *
 * @example
 * ```ts
 * const trackCfg = await fetch('/assets/data/track.json').then(r => r.json());
 * const biome = await fetch('/assets/data/biomes/rocky.json').then(r => r.json());
 * const track = createTrackGenerator(engine, player, obstacles, pickups, trackCfg, {
 *   biome, seed: 'abc', planetIndex: 0,
 * });
 * track.onJumpGateReached(() => console.log('Jump gate!'));
 * // later:
 * track.dispose();
 * ```
 */
export function createTrackGenerator(
  engine: EngineHandle,
  player: Player,
  obstacles: ObstacleSystem,
  pickups: PickupSystem,
  trackCfg: TrackConfig,
  params: TrackGeneratorParams,
): TrackGenerator {
  const { biome, seed, planetIndex } = params;
  const {
    planetLength,
    chunkLength,
    chunksAhead,
    chunksBehind,
    lateralBound,
    jumpGate,
  } = trackCfg;

  const totalChunks = Math.floor(planetLength / chunkLength); // 30
  const trackWidth = lateralBound * 2;                         // 16
  const activeChunks = new Map<number, ChunkInstance>();

  // -------------------------------------------------------------------------
  // Event subscribers
  // -------------------------------------------------------------------------
  const jumpGateCallbacks: Array<() => void> = [];
  let jumpGateTriggered = false;
  let disposed = false;

  // -------------------------------------------------------------------------
  // Shared geometry + material for ground tiles (one alloc, reused per chunk)
  // -------------------------------------------------------------------------
  const groundGeometry = new THREE.BoxGeometry(trackWidth, 0.5, chunkLength);
  const groundMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.ground.color),
    roughness: biome.ground.roughness,
    metalness: biome.ground.metallic,
  });

  // -------------------------------------------------------------------------
  // Lateral walls — invisible physics-only colliders at x = ±(lateralBound + 0.5)
  //
  // Walls span the full planet length, centered at z = -planetLength/2.
  // -------------------------------------------------------------------------
  const wallHalfHeight = 3;
  const wallHalfDepth = planetLength / 2;
  const wallCenterZ = -wallHalfDepth;

  const leftWallBodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(-(lateralBound + 0.5), wallHalfHeight, wallCenterZ);
  const leftWallBody = engine.world.createRigidBody(leftWallBodyDesc);
  engine.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, wallHalfHeight, wallHalfDepth),
    leftWallBody,
  );

  const rightWallBodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(lateralBound + 0.5, wallHalfHeight, wallCenterZ);
  const rightWallBody = engine.world.createRigidBody(rightWallBodyDesc);
  engine.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, wallHalfHeight, wallHalfDepth),
    rightWallBody,
  );

  // -------------------------------------------------------------------------
  // Jump-gate world Z — precomputed for the trigger check
  // -------------------------------------------------------------------------
  const gateChunkStartZ = -((totalChunks - 1) * chunkLength);
  const gateWorldZ = gateChunkStartZ + jumpGate.localZOffset;

  // -------------------------------------------------------------------------
  // Chunk spawn / despawn
  // -------------------------------------------------------------------------

  /** Spawn a single chunk by index. No-op if already active or out of range. */
  function spawnChunk(chunkIdx: number): void {
    if (activeChunks.has(chunkIdx) || chunkIdx < 0 || chunkIdx >= totalChunks) {
      return;
    }

    const chunkStartZ = -(chunkIdx * chunkLength);
    const chunkCenterZ = chunkStartZ - chunkLength / 2;

    // --- Ground tile ---
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    groundMesh.position.set(0, -0.25, chunkCenterZ);
    engine.scene.add(groundMesh);

    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(0, -0.25, chunkCenterZ);
    const groundBody = engine.world.createRigidBody(groundBodyDesc);
    engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(trackWidth / 2, 0.25, chunkLength / 2),
      groundBody,
    );

    const obstacleHandles: ObstacleHandle[] = [];
    const pickupHandles: PickupHandle[] = [];
    let gateMesh: THREE.Mesh | null = null;

    const isIntroChunk = chunkIdx === 0;
    const isGateChunk = chunkIdx === totalChunks - 1;

    if (isGateChunk) {
      // -----------------------------------------------------------------
      // Jump-gate chunk — glowing torus ring, no obstacles
      // -----------------------------------------------------------------
      const torusGeo = new THREE.TorusGeometry(
        jumpGate.torusRadius,
        jumpGate.torusTube,
        16, // radial segments
        48, // tubular segments
      );
      const torusMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(jumpGate.color),
        emissive: new THREE.Color(jumpGate.emissiveColor),
        emissiveIntensity: jumpGate.emissiveIntensity,
      });
      gateMesh = new THREE.Mesh(torusGeo, torusMat);

      // Position: centered on track, lifted so the ring frames the player.
      // TorusGeometry lies in XZ plane by default — no rotation needed since
      // the player runs along -Z and sees the torus as a ring from the front.
      // Actually, default torus is in XZ (flat on ground). Rotate 90° around X
      // to stand it upright in XY plane, facing along Z toward the player.
      gateMesh.position.set(0, jumpGate.torusRadius + 0.5, chunkStartZ + jumpGate.localZOffset);
      gateMesh.rotation.x = Math.PI / 2;
      engine.scene.add(gateMesh);
    } else if (!isIntroChunk) {
      // -----------------------------------------------------------------
      // Regular chunk — select template from biome pool and spawn contents
      // -----------------------------------------------------------------
      const templateIdx = pickTemplateIndex(seed, planetIndex, chunkIdx, biome.chunks.length);
      const template = biome.chunks[templateIdx];

      for (const obs of template.obstacles) {
        const worldZ = chunkStartZ + obs.z;
        const handle = obstacles.spawn(obs.type, obs.x, 0, worldZ);
        obstacleHandles.push(handle);
      }

      for (const pu of template.pickups) {
        const worldZ = chunkStartZ + pu.z;
        // Jitter X so pickups don't form predictable lines across consecutive chunks
        const xJitter = (Math.random() * 2 - 1) * 2.0;
        const spawnX = Math.max(-(lateralBound - 1.5), Math.min(lateralBound - 1.5, pu.x + xJitter));
        const handle = pickups.spawn(pu.type, spawnX, 0.5, worldZ);
        pickupHandles.push(handle);
      }
    }
    // Intro chunk (index 0) — empty, just the ground tile. No obstacles, no pickups.

    activeChunks.set(chunkIdx, {
      groundMesh,
      groundBody,
      obstacleHandles,
      pickupHandles,
      gateMesh,
    });
  }

  /** Despawn a single chunk by index. No-op if not active. */
  function despawnChunk(chunkIdx: number): void {
    const chunk = activeChunks.get(chunkIdx);
    if (!chunk) return;

    // Remove ground tile
    engine.scene.remove(chunk.groundMesh);
    engine.world.removeRigidBody(chunk.groundBody);

    // Remove obstacles
    for (const h of chunk.obstacleHandles) {
      obstacles.despawn(h);
    }

    // Remove pickups
    for (const h of chunk.pickupHandles) {
      pickups.despawn(h);
    }

    // Remove gate mesh if present
    if (chunk.gateMesh) {
      engine.scene.remove(chunk.gateMesh);
      chunk.gateMesh.geometry.dispose();
      (chunk.gateMesh.material as THREE.Material).dispose();
    }

    activeChunks.delete(chunkIdx);
  }

  // -------------------------------------------------------------------------
  // Streaming logic — runs every physics tick via onBeforeStep
  // -------------------------------------------------------------------------

  /** Last processed chunk index — used to detect boundary crossings. */
  let lastChunkIdx = -1;

  /**
   * Per-tick streaming update. Spawns chunks ahead, despawns chunks behind,
   * and checks the jump-gate trigger. Only performs spawn/despawn work on
   * chunk boundary crossings. Jump-gate check is a single comparison per tick.
   */
  function updateStreaming(): void {
    // Read player Z (one Rapier translation read per tick)
    const pz = player.body.translation().z;
    const currentIdx = Math.max(0, Math.floor(-pz / chunkLength));

    // Only run spawn/despawn logic on chunk boundary crossings
    if (currentIdx !== lastChunkIdx) {
      const prevIdx = lastChunkIdx;
      lastChunkIdx = currentIdx;

      // Spawn chunks ahead (no-op for already-active chunks)
      for (let i = 0; i <= chunksAhead; i++) {
        const idx = currentIdx + i;
        if (idx < totalChunks) {
          spawnChunk(idx);
        }
      }

      // Despawn chunks that fell out of the keep range.
      // Keep range: [currentIdx - chunksBehind, currentIdx + chunksAhead].
      // Despawn everything below currentIdx - chunksBehind.
      const keepMin = currentIdx - chunksBehind;
      for (let i = Math.max(0, prevIdx - chunksBehind); i < keepMin; i++) {
        despawnChunk(i);
      }
    }

    // Jump-gate trigger — cheap Z comparison every tick
    if (!jumpGateTriggered && pz < gateWorldZ) {
      jumpGateTriggered = true;
      for (const cb of jumpGateCallbacks) cb();
    }
  }

  // -------------------------------------------------------------------------
  // Initial chunk population — spawn the first batch of chunks
  // -------------------------------------------------------------------------
  for (let i = 0; i <= chunksAhead; i++) {
    if (i < totalChunks) {
      spawnChunk(i);
    }
  }
  lastChunkIdx = 0;

  // Register the streaming tick
  const unsubStep = engine.onBeforeStep(updateStreaming);

  console.log(
    `[TrackGenerator] Planet ${planetIndex} (${biome.name}) — ` +
    `${totalChunks} chunks, ${planetLength}m, seed="${seed}"`,
  );

  // -------------------------------------------------------------------------
  // Return the public handle
  // -------------------------------------------------------------------------
  return {
    onJumpGateReached(cb: () => void): () => void {
      jumpGateCallbacks.push(cb);
      return (): void => {
        const idx = jumpGateCallbacks.indexOf(cb);
        if (idx !== -1) jumpGateCallbacks.splice(idx, 1);
      };
    },

    getActiveChunkCount(): number {
      return activeChunks.size;
    },

    getProgress(): number {
      const pz = player.body.translation().z;
      return Math.min(1, Math.max(0, -pz / planetLength));
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;

      // Unregister physics tick
      unsubStep();

      // Despawn all active chunks (collect keys first to avoid mutation during iteration)
      const indices = [...activeChunks.keys()];
      for (const idx of indices) {
        despawnChunk(idx);
      }

      // Remove lateral walls
      engine.world.removeRigidBody(leftWallBody);
      engine.world.removeRigidBody(rightWallBody);

      // Dispose shared geometry + material
      groundGeometry.dispose();
      groundMaterial.dispose();

      // Clear subscribers
      jumpGateCallbacks.length = 0;

      console.log(`[TrackGenerator] Disposed planet ${planetIndex} (${biome.name})`);
    },
  };
}

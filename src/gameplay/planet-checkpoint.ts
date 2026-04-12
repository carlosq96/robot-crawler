/**
 * @file src/gameplay/planet-checkpoint.ts
 * @description Planet / Checkpoint System — owns the planet-hop loop.
 *
 * When the player crosses the jump-gate at the end of a planet, this system
 * launches them upward into space, swaps the track beneath them at the arc
 * peak, and lets them fall onto the new planet. Input is locked for the
 * duration; movement re-enables on landing.
 *
 * Warp sequence (physics-driven, no screen fade):
 *   t=0       gate hit   → freeze movement, apply Y impulse, disable collision
 *                          damage for duration
 *   t=cutSec  arc peak   → dispose old track, teleport player XZ to start of
 *                          new planet, spawn new biome track
 *   landing   Y ≤ threshold AND falling → re-enable movement, emit onPlanetChanged
 *
 * Spec: design/quick-specs/planet-checkpoint-2026-04-09.md (system #14, L4, T1)
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — onBeforeStep for landing detection
 *   ADR-0008  TypeScript everywhere — .js import extensions
 */

import type { EngineHandle } from '../engine/bootstrap.js';
import type { Player } from './player.js';
import type { MovementController } from './movement.js';
import type { ObstacleSystem } from './obstacles.js';
import type { PickupSystem } from './pickups.js';
import type { TrackConfig, BiomeData, TrackGenerator } from './track-generator.js';
import { createTrackGenerator } from './track-generator.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type BiomeName = 'rocky' | 'ice' | 'volcanic';

/**
 * Configuration loaded from assets/data/planet-checkpoint.json.
 * All values are data-driven — nothing hardcoded in the implementation.
 */
export interface PlanetCheckpointConfig {
  /** First biome on run start. */
  startBiome: BiomeName;
  /** Ordered biome rotation — wraps at end. */
  biomeCycle: BiomeName[];
  /** Upward velocity applied to the player body on gate hit (m/s). */
  warpLaunchVelocityY: number;
  /**
   * Seconds after gate hit to perform the mid-arc cut:
   *   dispose old track + teleport player XZ + spawn new track.
   * Should be timed so the player is near the arc peak (mostly sky visible).
   */
  warpCutTimeSec: number;
  /** X position the player is reset to at the cut. Normally 0 (track centre). */
  playerSpawnX: number;
  /** Z position the player is reset to at the cut (negative = forward). */
  playerSpawnZ: number;
  /** Y spawn height the player is reset to at the cut. */
  playerSpawnY: number;
  /**
   * Y position below which the player is considered "landed" after the arc.
   * Must be above ground (Y=0) to trigger before physics settles.
   */
  landingThresholdY: number;
}

/** The PlanetCheckpoint handle returned by {@link createPlanetCheckpoint}. */
export interface PlanetCheckpoint {
  /** Biome of the currently active planet. */
  getCurrentBiome(): BiomeName;
  /** 0-based index of the currently active planet. Increments each warp. */
  getPlanetIndex(): number;
  /** True while the warp sequence is in progress. */
  isWarping(): boolean;
  /**
   * Subscribe to planet-changed events.
   * Fires once per completed warp, after movement is re-enabled.
   * @returns Unsubscribe function.
   */
  onPlanetChanged(cb: (biome: BiomeName, planetIndex: number) => void): () => void;
  /**
   * Tear down: dispose active Track Generator, unregister engine callbacks.
   * Idempotent.
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the Planet/Checkpoint system and immediately spawn the first planet.
 *
 * This factory OWNS the Track Generator lifecycle. Do NOT create Track
 * Generators in main.ts when using this system.
 *
 * @param engine     - Engine handle (scene, world, loop hooks).
 * @param player     - Player entity.
 * @param movement   - Movement controller (setEnabled for warp freeze).
 * @param obstacles  - Obstacle system (forwarded to Track Generator).
 * @param pickups    - Pickup system (forwarded to Track Generator).
 * @param trackCfg   - Track-level config (from assets/data/track.json).
 * @param biomeMap   - Map from BiomeName to loaded BiomeData (caller loads).
 * @param runSeed    - Seed string for procedural chunk selection.
 * @param config     - Loaded from assets/data/planet-checkpoint.json.
 */
export function createPlanetCheckpoint(
  engine: EngineHandle,
  player: Player,
  movement: MovementController,
  obstacles: ObstacleSystem,
  pickups: PickupSystem,
  trackCfg: TrackConfig,
  biomeMap: Map<BiomeName, BiomeData>,
  runSeed: string,
  config: PlanetCheckpointConfig,
): PlanetCheckpoint {
  const {
    biomeCycle,
    warpLaunchVelocityY,
    warpCutTimeSec,
    playerSpawnX,
    playerSpawnZ,
    landingThresholdY,
  } = config;

  // -------------------------------------------------------------------------
  // Mutable state
  // -------------------------------------------------------------------------

  let planetIndex = 0;
  let currentBiome: BiomeName = config.startBiome;
  let warping = false;
  let warpTimer = 0;
  let cutDone = false;
  let landingArmed = false; // true once cutDone + player starts falling

  let activeTrack: TrackGenerator | null = null;
  let disposed = false;

  const planetChangedCallbacks: Array<(biome: BiomeName, idx: number) => void> = [];

  // -------------------------------------------------------------------------
  // Helper — spawn a new Track Generator for the given planet
  // -------------------------------------------------------------------------

  function spawnTrack(biome: BiomeName, idx: number): TrackGenerator {
    const biomeData = biomeMap.get(biome);
    if (!biomeData) {
      throw new Error(`[PlanetCheckpoint] No biome data loaded for '${biome}'`);
    }
    const track = createTrackGenerator(engine, player, obstacles, pickups, trackCfg, {
      biome: biomeData,
      seed: `${runSeed}-planet-${idx}`,
      planetIndex: idx,
    });

    // Subscribe to the next gate — each gate triggers the next warp
    track.onJumpGateReached(() => {
      if (!disposed && !warping) beginWarp();
    });

    return track;
  }

  // -------------------------------------------------------------------------
  // Warp sequence
  // -------------------------------------------------------------------------

  function beginWarp(): void {
    if (warping || disposed) return;

    warping = true;
    warpTimer = 0;
    cutDone = false;
    landingArmed = false;

    // Freeze player input — physics body keeps gravity, we clear X/Z velocity
    movement.setEnabled(false);

    const vel = player.body.linvel();
    // Keep any existing Y velocity, zero out X and Z so player goes straight up
    player.body.setLinvel({ x: 0, y: vel.y + warpLaunchVelocityY, z: 0 }, true);
  }

  function performCut(): void {
    // Dispose old track — all chunks, walls, gate mesh removed
    if (activeTrack) {
      activeTrack.dispose();
      activeTrack = null;
    }

    // Advance biome + planet index
    planetIndex += 1;
    currentBiome = biomeCycle[planetIndex % biomeCycle.length] as BiomeName;

    // Heal player to full HP for the new planet
    player.heal(player.getMaxHp());

    // Teleport player XZ to start of new planet — Y stays wherever they are
    // in the arc so the transition looks seamless
    const currentPos = player.body.translation();
    player.body.setTranslation(
      { x: playerSpawnX, y: currentPos.y, z: playerSpawnZ },
      true,
    );
    // Keep only Y velocity — preserve the arc momentum
    const currentVel = player.body.linvel();
    player.body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true);
    player.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);

    // Spawn new planet track
    activeTrack = spawnTrack(currentBiome, planetIndex);

    cutDone = true;
  }

  function completeLanding(): void {
    warping = false;
    landingArmed = false;

    movement.setEnabled(true);

    // Notify subscribers (HUD planet label, Run Lifecycle planetsCleared)
    for (const cb of planetChangedCallbacks) cb(currentBiome, planetIndex);
  }

  // -------------------------------------------------------------------------
  // Per-frame warp update — runs in onBeforeRender
  // -------------------------------------------------------------------------

  const unsubRender = engine.onBeforeRender((dt: number) => {
    if (!warping || disposed) return;

    warpTimer += dt;

    // --- Phase 1: wait for cut time then swap planets ---
    if (!cutDone && warpTimer >= warpCutTimeSec) {
      performCut();
      // Arm landing detection once the cut is done
      landingArmed = false; // will arm once player starts descending
      return;
    }

    // --- Phase 2: detect landing on new planet ---
    if (cutDone) {
      const pos = player.body.translation();
      const vel = player.body.linvel();

      // Arm once the player has peaked and is falling
      if (!landingArmed && vel.y < 0) {
        landingArmed = true;
      }

      // Landing: armed + below threshold + still falling (or barely settled)
      if (landingArmed && pos.y <= landingThresholdY) {
        completeLanding();
      }
    }
  });

  // -------------------------------------------------------------------------
  // Spawn the first planet immediately
  // -------------------------------------------------------------------------

  activeTrack = spawnTrack(currentBiome, planetIndex);

  // -------------------------------------------------------------------------
  // Public handle
  // -------------------------------------------------------------------------

  return {
    getCurrentBiome(): BiomeName {
      return currentBiome;
    },

    getPlanetIndex(): number {
      return planetIndex;
    },

    isWarping(): boolean {
      return warping;
    },

    onPlanetChanged(cb: (biome: BiomeName, idx: number) => void): () => void {
      planetChangedCallbacks.push(cb);
      return (): void => {
        const i = planetChangedCallbacks.indexOf(cb);
        if (i !== -1) planetChangedCallbacks.splice(i, 1);
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;

      unsubRender();

      if (activeTrack) {
        activeTrack.dispose();
        activeTrack = null;
      }

      planetChangedCallbacks.length = 0;
    },
  };
}

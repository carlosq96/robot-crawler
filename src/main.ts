/**
 * @file src/main.ts
 * @description Entry point for Space Runner (internal repo: robot-crawler).
 * Loaded by index.html via importmap.
 *
 * Responsibilities:
 *   - Get the <canvas> element and show a graceful fallback if it is missing
 *   - Call init() to boot the engine
 *   - Load the camera config and create the follow rig
 *   - Load the player config and create the player entity (system #5)
 *   - Wire the camera rig to follow the player mesh
 *   - Set up a ground plane so the player has something to stand on
 *   - Initialize Input Manager and create the Movement Controller (system #6)
 *
 * Systems wired here:
 *   - Engine Bootstrap  (src/engine/bootstrap.ts)
 *   - Camera Rig        (src/engine/camera-rig.ts)
 *   - Player System     (src/gameplay/player.ts)
 *   - Input Manager     (src/engine/input.ts)
 *   - Movement System   (src/gameplay/movement.ts)
 *
 * NOTE: Player System registers its own engine.onAfterStep (mesh-body sync)
 * and engine.onBeforeRender (anim.update) callbacks internally. main.ts must
 * NOT re-register those — only the camera rig update lives here.
 * NOTE: Movement Controller registers its own engine.onBeforeStep callback
 * internally. main.ts must NOT register a separate onBeforeStep for movement.
 */

import * as THREE from 'three';
import { init } from './engine/bootstrap.js';
import { init as initInput } from './engine/input.js';
import { createFollowRig, type FollowRigConfig } from './engine/camera-rig.js';
import { createPlayer, type PlayerConfig } from './gameplay/player.js';
import { createMovementController, type MovementConfig } from './gameplay/movement.js';
import { createRunLifecycle, type RunLifecycleConfig } from './gameplay/run-lifecycle.js';
import { createObstacleSystem, type ObstacleTypeDefs } from './gameplay/obstacles.js';
import { createPickupSystem, type PickupTypeDefs } from './gameplay/pickups.js';
import { createTrackGenerator, type TrackConfig, type BiomeData, type TrackGenerator } from './gameplay/track-generator.js';
import { createDawnSky } from './engine/sky.js';
import { createTitleScreen } from './ui/title-screen.js';
import { createResultsScreen } from './ui/results-screen.js';
import { createHUD, type HUDConfig } from './ui/hud.js';

// ---------------------------------------------------------------------------
// Canvas + fallback
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
const fallback = document.getElementById('fallback') as HTMLDivElement | null;

function showFallback(message: string): void {
  console.error('[main]', message);
  if (fallback) {
    fallback.classList.add('visible');
  }
}

if (!canvas) {
  showFallback('No #game-canvas element found in the document.');
  throw new Error('[main] #game-canvas not found — cannot start engine.');
}

// Verify WebGL 2 is available before attempting init
const testCtx = canvas.getContext('webgl2');
if (!testCtx) {
  showFallback('WebGL 2 is not supported in this browser. Please try Chrome, Firefox, Edge, or Safari 17+.');
  throw new Error('[main] WebGL 2 unavailable — cannot start engine.');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

try {
  // -------------------------------------------------------------------------
  // Step 1 — Initialize engine (Rapier WASM, Three.js, main loop)
  // -------------------------------------------------------------------------
  const engine = await init(canvas);
  console.log('[main] Engine bootstrapped successfully');

  // -------------------------------------------------------------------------
  // Step 2 — Load camera config and create follow rig
  // -------------------------------------------------------------------------
  const cameraConfigResp = await fetch('/assets/data/camera.json');
  if (!cameraConfigResp.ok) {
    throw new Error(`[main] Failed to load camera.json: HTTP ${cameraConfigResp.status}`);
  }
  const cameraConfig = (await cameraConfigResp.json()) as FollowRigConfig;
  const rig = createFollowRig(engine.camera, cameraConfig);
  console.log('[main] Camera rig created');

  // -------------------------------------------------------------------------
  // Step 3 — Load player config and create player entity
  //
  // Player System loads both GLBs (mesh + animations) and wires its own
  // engine.onAfterStep (body→mesh sync) and engine.onBeforeRender (anim.update).
  // -------------------------------------------------------------------------
  const playerConfigResp = await fetch('/assets/data/entities/player.json');
  if (!playerConfigResp.ok) {
    throw new Error(`[main] Failed to load player.json: HTTP ${playerConfigResp.status}`);
  }
  const playerConfig = (await playerConfigResp.json()) as PlayerConfig;

  console.log('[main] Loading player GLBs (this may take a moment)...');
  const player = await createPlayer(engine, playerConfig, 'local-player');
  // Space Runner: on-touch death. Zero out the revival counter so the first
  // hit goes alive → dead directly (skipping the legacy 'downed' state).
  player.setRevivalsRemaining(0);
  console.log('[main] Player created — id:', player.id, '| hp:', player.getHp(), '| state:', player.getState(), '| revivals:', player.getRevivalsRemaining());

  // -------------------------------------------------------------------------
  // Step 3.5 — Rotate player to face forward (-Z) + lock ALL angular DOF
  //
  // Space Runner auto-runs along world -Z. The Meshy GLB exports the model
  // facing +Z (toward the viewer). The camera sits behind the player at +Z,
  // so the default orientation shows the player's face. Rotate the body 180°
  // around Y so the model faces -Z (the run direction) and the camera sees
  // its back.
  //
  // Quaternion for 180° around Y: (x=0, y=1, z=0, w=0).
  //
  // THEN: lock ALL three angular DOF. In Space Runner the body never rotates
  // — forward is a fixed world axis, the lateral dodge is pure translation,
  // and the camera is a fixed chase-cam. Unlike the MML version, Y yaw is
  // also locked (no yaw-follow, no face-movement-direction). This eliminates
  // the diagonal-stutter class of bugs entirely.
  // -------------------------------------------------------------------------
  player.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
  player.body.setEnabledRotations(false, false, false, true);
  console.log('[main] Player rotated 180° to face -Z + all angular DOF locked (Space Runner chase-cam)');

  // -------------------------------------------------------------------------
  // Step 4 — Attach camera rig to player mesh and wire update
  // -------------------------------------------------------------------------
  rig.setTarget(player.mesh);
  engine.onBeforeRender((dt: number) => rig.update(dt));
  console.log('[main] Camera rig targeting player mesh');

  // -------------------------------------------------------------------------
  // Step 4b — Make the directional light follow the player so shadows persist
  //
  // The bootstrap creates a directional light at a fixed world position (5,10,5).
  // Space Runner auto-runs in -Z, so the player leaves the shadow frustum
  // within seconds. Fix: find the directional light and update its position +
  // target each frame to track the player mesh. The shadow camera frustum
  // stays centered on the player.
  // -------------------------------------------------------------------------
  let dirLight: THREE.DirectionalLight | null = null;
  engine.scene.traverse((node) => {
    if (node instanceof THREE.DirectionalLight && node.castShadow) {
      dirLight = node;
    }
  });
  if (dirLight) {
    const dl = dirLight as THREE.DirectionalLight;
    // Ensure the light has a target in the scene (Three.js default is (0,0,0))
    engine.scene.add(dl.target);
    engine.onBeforeRender(() => {
      const pos = player.mesh.position;
      dl.position.set(pos.x + 5, pos.y + 15, pos.z + 5);
      dl.target.position.set(pos.x, pos.y, pos.z);
    });
    console.log('[main] Shadow light now follows player');
  }

  // -------------------------------------------------------------------------
  // Step 5 — Load Track Generator config + biome data
  //
  // The Track Generator produces per-chunk ground tiles, obstacles, and pickups
  // procedurally from biome templates. It replaces the old placeholder runway.
  // Track config is planet-independent; biome data is loaded per-planet.
  // For now we start with Rocky biome — Planet/Checkpoint will cycle biomes.
  // -------------------------------------------------------------------------
  const trackConfigResp = await fetch('/assets/data/track.json');
  if (!trackConfigResp.ok) {
    throw new Error(`[main] Failed to load track.json: HTTP ${trackConfigResp.status}`);
  }
  const trackConfig = (await trackConfigResp.json()) as TrackConfig;

  const rockyBiomeResp = await fetch('/assets/data/biomes/rocky.json');
  if (!rockyBiomeResp.ok) {
    throw new Error(`[main] Failed to load rocky.json: HTTP ${rockyBiomeResp.status}`);
  }
  const rockyBiome = (await rockyBiomeResp.json()) as BiomeData;
  console.log('[main] Track config + Rocky biome loaded');

  // -------------------------------------------------------------------------
  // Step 5b — Dawn sky dome (visual only — gradient sky + sun glow + fog)
  // -------------------------------------------------------------------------
  const sky = createDawnSky(engine);
  engine.onBeforeRender(() => sky.update());
  console.log('[main] Dawn sky created');

  // -------------------------------------------------------------------------
  // Step 6 — Initialize Input Manager (system #4)
  //
  // Must be initialized before Movement Controller because the controller
  // holds a reference to the InputManager handle and calls it every tick.
  // Input Manager loads bindings from /assets/data/input-bindings.json and
  // sensitivity config from /assets/data/input.json; both fall back to
  // defaults gracefully without throwing.
  // -------------------------------------------------------------------------
  const input = await initInput(canvas);
  console.log('[main] Input Manager initialized');

  // -------------------------------------------------------------------------
  // Step 7 — Load movement config and create Movement Controller (system #6)
  //
  // Movement Controller registers its own engine.onBeforeStep callback
  // internally — do NOT add an onBeforeStep here for movement.
  // All tuning values come from movement.json; nothing is hardcoded.
  // -------------------------------------------------------------------------
  const movementConfigResp = await fetch('/assets/data/movement.json');
  if (!movementConfigResp.ok) {
    throw new Error(`[main] Failed to load movement.json: HTTP ${movementConfigResp.status}`);
  }
  const movementConfig = (await movementConfigResp.json()) as MovementConfig;

  const movement = createMovementController(engine, player, input, movementConfig);
  console.log('[main] Movement Controller created — auto-run + A/D dodge + Space jump + Shift slide');

  // -------------------------------------------------------------------------
  // Step 8 — Load Run Lifecycle config and create the state machine
  // -------------------------------------------------------------------------
  const runLifecycleResp = await fetch('/assets/data/run-lifecycle.json');
  if (!runLifecycleResp.ok) {
    throw new Error(`[main] Failed to load run-lifecycle.json: HTTP ${runLifecycleResp.status}`);
  }
  const runLifecycleConfig = (await runLifecycleResp.json()) as RunLifecycleConfig;
  const runLifecycle = createRunLifecycle({ engine, player }, runLifecycleConfig);
  console.log('[main] Run Lifecycle created — state:', runLifecycle.getState());

  // -------------------------------------------------------------------------
  // Step 9 — Load Obstacle System
  // -------------------------------------------------------------------------
  const obstaclesResp = await fetch('/assets/data/obstacles.json');
  if (!obstaclesResp.ok) {
    throw new Error(`[main] Failed to load obstacles.json: HTTP ${obstaclesResp.status}`);
  }
  const obstacleTypeDefs = (await obstaclesResp.json()) as ObstacleTypeDefs;
  const obstacles = createObstacleSystem({ engine, player }, obstacleTypeDefs);
  console.log('[main] Obstacle System created');

  // Wire obstacle hits to run lifecycle
  obstacles.onObstacleHit(() => {
    // On-touch death — takeDamage already called by obstacle system
  });
  obstacles.onObstacleBroken(() => {
    runLifecycle.reportObstacleBroken();
  });

  // -------------------------------------------------------------------------
  // Step 10 — Load Pickup System (Star Dust)
  // -------------------------------------------------------------------------
  const pickupsResp = await fetch('/assets/data/pickups.json');
  if (!pickupsResp.ok) {
    throw new Error(`[main] Failed to load pickups.json: HTTP ${pickupsResp.status}`);
  }
  const pickupTypeDefs = (await pickupsResp.json()) as PickupTypeDefs;
  const pickups = createPickupSystem({ engine, player }, pickupTypeDefs);
  console.log('[main] Pickup System created');

  // Wire pickups to run lifecycle
  pickups.onPickup((_type, _value) => {
    runLifecycle.reportPickup(_value);
  });

  // -------------------------------------------------------------------------
  // Step 11 — Create UI screens (Title + Results) + HUD
  // -------------------------------------------------------------------------
  createTitleScreen(runLifecycle);
  createResultsScreen(runLifecycle);

  const hudConfigResp = await fetch('/assets/data/hud.json');
  if (!hudConfigResp.ok) {
    throw new Error(`[main] Failed to load hud.json: HTTP ${hudConfigResp.status}`);
  }
  const hudConfig = (await hudConfigResp.json()) as HUDConfig;
  createHUD(runLifecycle, pickups, hudConfig);
  console.log('[main] UI screens + HUD created');

  // -------------------------------------------------------------------------
  // Step 12 — Wire movement enable/disable + Track Generator to run lifecycle
  //
  // Movement is disabled during title and results screens so the player
  // doesn't run while menus are showing. Enabled only during 'running'.
  //
  // Track Generator is created fresh each run (new seed from run count) and
  // disposed on death. For now all runs use Rocky biome — Planet/Checkpoint
  // system will cycle biomes when implemented.
  // -------------------------------------------------------------------------
  movement.setEnabled(false);
  player.anim.stopAll();

  let activeTrack: TrackGenerator | null = null;
  let runCount = 0;

  runLifecycle.onStateChange((_from, to) => {
    if (to === 'running') {
      // Dispose previous track if any (e.g. retry from results)
      if (activeTrack) {
        activeTrack.dispose();
        activeTrack = null;
      }

      // Full reset for a fresh run
      player.reset();
      player.body.setTranslation({ x: 0, y: 2, z: 0 }, true);
      player.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      player.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);

      // Create a new Track Generator for this run
      runCount++;
      activeTrack = createTrackGenerator(
        engine, player, obstacles, pickups, trackConfig,
        { biome: rockyBiome, seed: `run-${runCount}`, planetIndex: 0 },
      );

      // Wire jump-gate event (placeholder until Planet/Checkpoint system)
      activeTrack.onJumpGateReached(() => {
        console.log('[main] Jump gate reached! (Planet/Checkpoint not yet implemented)');
      });

      movement.setEnabled(true);
    } else if (to === 'title') {
      // Dispose track when returning to title
      if (activeTrack) {
        activeTrack.dispose();
        activeTrack = null;
      }
      player.anim.stopAll();
      player.anim.play('sprint');
    } else {
      // dead / results — disable movement, keep track alive for visual
      movement.setEnabled(false);
    }
  });

  console.log('[main] Space Runner ready — click START to begin');
} catch (err) {
  showFallback('Engine failed to initialize. Open the browser console for details.');
  console.error('[main] Startup failed:', err);
}

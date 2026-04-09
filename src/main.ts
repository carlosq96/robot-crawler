/**
 * @file src/main.ts
 * @description Entry point for Robot Crawler. Loaded by index.html via importmap.
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
import * as RAPIER from '@dimforge/rapier3d-compat';
import { init } from './engine/bootstrap.js';
import { init as initInput } from './engine/input.js';
import { createFollowRig, type FollowRigConfig } from './engine/camera-rig.js';
import { createPlayer, type PlayerConfig } from './gameplay/player.js';
import { createMovementController, type MovementConfig } from './gameplay/movement.js';

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
  console.log('[main] Player created — id:', player.id, '| hp:', player.getHp(), '| state:', player.getState());

  // -------------------------------------------------------------------------
  // Step 3.5 — Rotate player to face away from the camera + lock angular DOF
  //
  // The Meshy GLB exports the model facing +Z (toward the viewer). Our camera
  // sits behind the player at +Z (per camera.json offset), so the default
  // orientation shows the player's face. Rotate the body 180° around Y so we
  // see the player's back. The mesh-body sync in Player System propagates
  // body.rotation → mesh.quaternion every onAfterStep.
  //
  // Quaternion for 180° rotation around Y axis: (x=0, y=1, z=0, w=0).
  //
  // THEN: lock ALL angular rotations. A dynamic capsule with free rotation
  // tumbles when horizontal velocity is applied (the ground-contact friction
  // creates torque at the body bottom while the center of mass moves). The
  // result is the capsule tipping over on every WASD input, which manifests
  // as the player falling on its back/face/side. Standard character-controller
  // fix: disable angular motion entirely. The body translates only; the mesh
  // stays upright at the orientation we just set.
  //
  // When we add "face movement direction" later, we'll re-enable Y rotation
  // via setEnabledRotations(false, true, false, true) and drive Y yaw from
  // Movement. For now, full lock = zero tumbling.
  // -------------------------------------------------------------------------
  player.body.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
  // Lock X and Z angular DOF (anti-tumble) but allow Y (yaw) so Movement can
  // rotate the player to face its velocity direction. This replaces per-direction
  // strafe animations with "walk forward + rotate to face" — modern third-person
  // convention, and the only animation we need is walk. Movement writes yaw each
  // tick; physics will not rotate the body on its own in X or Z.
  player.body.setEnabledRotations(false, true, false, true);
  console.log('[main] Player rotated 180° + X/Z angular lock (Y yaw controlled by Movement)');

  // -------------------------------------------------------------------------
  // Step 4 — Attach camera rig to player mesh and wire update
  // -------------------------------------------------------------------------
  rig.setTarget(player.mesh);
  engine.onBeforeRender((dt: number) => rig.update(dt));
  console.log('[main] Camera rig targeting player mesh');

  // -------------------------------------------------------------------------
  // Step 5 — Ground plane (50×50 so the player won't fall off the edge)
  //
  // A flat box geometry so it receives shadows cleanly.
  // Top surface is at y=0; the box extends downward to y=-0.5.
  // -------------------------------------------------------------------------
  const groundGeo = new THREE.BoxGeometry(50, 0.5, 50);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x303040 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.position.y = -0.25; // top surface sits at y=0
  engine.scene.add(ground);

  // -------------------------------------------------------------------------
  // Step 5b — Rapier ground collider (matches the visual ground exactly)
  //
  // The visual mesh above is just rendering — Rapier needs its OWN body to
  // make the player land on something. We create a static (fixed) body with
  // a cuboid collider matching the BoxGeometry dimensions.
  //
  // RAPIER.ColliderDesc.cuboid takes HALF-extents:
  //   half-X = 25 (full width 50)
  //   half-Y = 0.25 (full height 0.5)
  //   half-Z = 25 (full depth 50)
  //
  // Position matches the visual ground: y = -0.25 so the top surface is at y=0.
  //
  // TODO: when Dungeon Generator (system 15) lands, this is replaced by
  // procedurally-generated room colliders. For Vertical Slice 1 a single
  // 50×50 plane is enough to test movement.
  // -------------------------------------------------------------------------
  const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.25, 0);
  const groundBody = engine.world.createRigidBody(groundBodyDesc);
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(25, 0.25, 25);
  engine.world.createCollider(groundColliderDesc, groundBody);
  console.log('[main] Ground plane added (50×50, visual + Rapier collider)');

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
  console.log('[main] Movement Controller created — WASD + jump + aim active');
  console.log('[main] Aim direction (initial):', movement.getAimDirection());

  console.log('[main] Robot Crawler Vertical Slice 1 ready — WASD to move, Space to jump');
} catch (err) {
  showFallback('Engine failed to initialize. Open the browser console for details.');
  console.error('[main] Startup failed:', err);
}

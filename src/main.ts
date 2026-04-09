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
 *
 * Systems wired here:
 *   - Engine Bootstrap (src/engine/bootstrap.ts)
 *   - Camera Rig      (src/engine/camera-rig.ts)
 *   - Player System   (src/gameplay/player.ts)
 *
 * NOTE: Player System registers its own engine.onAfterStep (mesh-body sync)
 * and engine.onBeforeRender (anim.update) callbacks internally. main.ts must
 * NOT re-register those — only the camera rig update lives here.
 */

import * as THREE from 'three';
import { init } from './engine/bootstrap.js';
import { createFollowRig, type FollowRigConfig } from './engine/camera-rig.js';
import { createPlayer, type PlayerConfig } from './gameplay/player.js';

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
  console.log('[main] Ground plane added (50×50)');

  console.log('[main] Robot Crawler scene ready — player on screen, idle animation playing');
} catch (err) {
  showFallback('Engine failed to initialize. Open the browser console for details.');
  console.error('[main] Startup failed:', err);
}

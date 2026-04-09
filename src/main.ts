/**
 * @file src/main.ts
 * @description Entry point for Robot Crawler. Loaded by index.html via importmap.
 *
 * Responsibilities:
 *   - Get the <canvas> element and show a graceful fallback if it is missing
 *   - Call init() to boot the engine
 *   - Add a minimal bootstrap test scene (ground plane + rotating cube) so we
 *     can visually confirm the loop is running before any gameplay system exists
 *
 * NOTE: This file intentionally loads NO game assets (player model, dungeon, etc.).
 * Those are the responsibility of their respective L1 systems.
 */

import * as THREE from 'three';
import { init } from './engine/bootstrap.js';

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
  const engine = await init(canvas);

  // -------------------------------------------------------------------------
  // Bootstrap test scene — proves the engine is alive.
  // Remove / replace when the real game systems are wired in.
  // -------------------------------------------------------------------------

  // Ground plane — flat box so it can receive shadows
  const groundGeo = new THREE.BoxGeometry(30, 0.5, 30);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x303040 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.position.y = -0.25; // top surface sits at y=0
  engine.scene.add(ground);

  // Rotating test cube — cast shadows; we watch it spin to confirm the loop runs
  const cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  const cubeMat = new THREE.MeshStandardMaterial({ color: 0x44ff44 });
  const cube = new THREE.Mesh(cubeGeo, cubeMat);
  cube.castShadow = true;
  cube.position.set(0, 1.5, 0); // sits on top of the ground plane
  engine.scene.add(cube);

  // Position camera to observe the scene
  engine.camera.position.set(5, 5, 5);
  engine.camera.lookAt(0, 0, 0);

  // Animate cube rotation — uses realDt so it is frame-rate independent
  engine.onBeforeRender((realDt: number) => {
    cube.rotation.y += realDt * 0.5;
  });

  console.log('[main] Robot Crawler bootstrapped successfully');
} catch (err) {
  showFallback('Engine failed to initialize. Open the browser console for details.');
  console.error('[main] Engine init failed:', err);
}

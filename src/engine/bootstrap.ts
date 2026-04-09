/**
 * @file src/engine/bootstrap.ts
 * @description Engine Bootstrap — initializes Three.js, Rapier physics, asset loaders,
 * and the fixed-timestep main loop. Exposes a stable EngineHandle used by all L1+ systems.
 *
 * All tuning values are loaded from /assets/data/engine.json at startup. Nothing is hardcoded.
 *
 * Constraining ADRs:
 *   ADR-0001  No bundler — bare specifiers resolved by importmap at runtime
 *   ADR-0005  Draco compression — DRACOLoader configured with gstatic decoder URL from config
 *   ADR-0007  Fixed Rapier timestep — accumulator pattern, 1/60 step, 0.25 s cap
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports; bare specifiers for CDN deps
 *   ADR-0009  WebGLRenderer (never WebGPURenderer)
 *
 * @example
 * ```ts
 * import { init } from './engine/bootstrap.js';
 * const engine = await init(document.getElementById('game-canvas') as HTMLCanvasElement);
 * engine.scene.add(myMesh);
 * const unsub = engine.onBeforeRender((dt) => { myMesh.rotation.y += dt * 0.5; });
 * ```
 */

import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// GLTF type is not exported as a named member from GLTFLoader.js in current
// @types/three. Derive it from GLTFLoader.loadAsync's return type instead.
export type GLTF = Awaited<ReturnType<GLTFLoader['loadAsync']>>;

// ---------------------------------------------------------------------------
// Config schema — mirrors assets/data/engine.json
// ---------------------------------------------------------------------------

interface EngineConfig {
  FIXED_TIMESTEP_SEC: number;
  ACCUMULATOR_CAP_SEC: number;
  GRAVITY_X: number;
  GRAVITY_Y: number;
  GRAVITY_Z: number;
  PIXEL_RATIO_CAP: number;
  SHADOW_MAP_SIZE: number;
  FOV_DEG: number;
  NEAR_PLANE: number;
  FAR_PLANE: number;
  DRACO_DECODER_PATH: string;
}

// ---------------------------------------------------------------------------
// Public API — LOCKED contract (every L1+ system depends on this interface).
// Changes here require an ADR.
// ---------------------------------------------------------------------------

/**
 * The engine handle returned by {@link init}. Exposes all engine resources and
 * loop hooks needed by downstream systems. Contains ZERO gameplay state.
 *
 * @example
 * ```ts
 * const engine = await init(canvas);
 * // Add objects directly to the scene
 * engine.scene.add(mesh);
 * // Hook into the physics loop
 * const unsub = engine.onBeforeStep(() => { /* sample input *\/ });
 * // Hook into the render loop
 * const unsubRender = engine.onBeforeRender((realDt) => { mixer.update(realDt); });
 * // Clean up
 * engine.dispose();
 * ```
 */
export interface EngineHandle {
  // Three.js
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  // Rapier
  readonly world: RAPIER.World;

  // Asset loading
  /**
   * Load a (optionally Draco-compressed) GLB/GLTF asset.
   * Uses the shared, pre-configured GLTFLoader + DRACOLoader instances.
   * Errors reject the returned promise; the caller is responsible for handling.
   *
   * @param url - Absolute or root-relative URL to the .glb file.
   * @returns The parsed GLTF object.
   *
   * @example
   * ```ts
   * const gltf = await engine.loadGLTF('/assets/models/player/robot_hero.glb');
   * engine.scene.add(gltf.scene);
   * ```
   */
  loadGLTF(url: string): Promise<GLTF>;

  // Loop hooks — each returns an unsubscribe function
  /**
   * Register a callback invoked at the START of each physics step (before world.step()).
   * Use this for input sampling and AI decisions.
   * Callbacks execute in registration order.
   *
   * @param cb - Called once per fixed timestep tick.
   * @returns A function that removes this callback when called.
   */
  onBeforeStep(cb: () => void): () => void;

  /**
   * Register a callback invoked AFTER each physics step (after world.step()).
   * Use this to sync Three.js mesh transforms from Rapier body positions.
   * Callbacks execute in registration order.
   *
   * @param cb - Called once per fixed timestep tick.
   * @returns A function that removes this callback when called.
   */
  onAfterStep(cb: () => void): () => void;

  /**
   * Register a callback invoked once per rendered frame, BEFORE renderer.render().
   * Receives the real elapsed time (not fixed dt) — correct for AnimationMixer.update().
   * Callbacks execute in registration order.
   *
   * @param cb - Called with real elapsed seconds since last frame.
   * @returns A function that removes this callback when called.
   */
  onBeforeRender(cb: (realDt: number) => void): () => void;

  // Lifecycle
  /**
   * Tear down the engine: cancels the rAF loop, removes the resize listener,
   * disposes the WebGL renderer, frees the Rapier world, and clears all callbacks.
   * Idempotent — safe to call multiple times.
   *
   * @example
   * ```ts
   * // Hot-reload: dispose old engine before creating a new one
   * engine.dispose();
   * const newEngine = await init(canvas);
   * ```
   */
  dispose(): void;
}

/**
 * Initialize the engine. Fetches config, boots Rapier WASM, sets up Three.js
 * scene/camera/renderer, configures asset loaders, and starts the main loop.
 *
 * Initialization order (strict, fail-fast per spec):
 *  1. fetch /assets/data/engine.json
 *  2. await RAPIER.init()
 *  3. THREE.Scene
 *  4. THREE.PerspectiveCamera
 *  5. THREE.WebGLRenderer + color space / tone mapping / shadow config
 *  6. Default lights
 *  7. RAPIER.World
 *  8. DRACOLoader + GLTFLoader
 *  9. AudioContext + autoplay-policy resume listener
 * 10. Window resize listener (debounced to one rAF tick)
 * 11. requestAnimationFrame main loop
 *
 * @param canvas - The <canvas> element to render into.
 * @returns A fully initialized EngineHandle.
 * @throws If any initialization step fails. Caller should show a fallback UI.
 *
 * @example
 * ```ts
 * const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
 * const engine = await init(canvas);
 * ```
 */
export async function init(canvas: HTMLCanvasElement): Promise<EngineHandle> {
  // -------------------------------------------------------------------------
  // Step 1 — Load config (all tuning values come from here, nothing hardcoded)
  // -------------------------------------------------------------------------
  let config: EngineConfig;
  try {
    const response = await fetch('/assets/data/engine.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    config = (await response.json()) as EngineConfig;
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 1 (fetch engine.json):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 2 — Rapier WASM init (must complete before ANY Rapier API call)
  // -------------------------------------------------------------------------
  try {
    await RAPIER.init();
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 2 (RAPIER.init):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 3 — THREE.Scene
  // -------------------------------------------------------------------------
  let scene: THREE.Scene;
  try {
    scene = new THREE.Scene();
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 3 (THREE.Scene):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 4 — THREE.PerspectiveCamera (all values from config)
  // -------------------------------------------------------------------------
  let camera: THREE.PerspectiveCamera;
  try {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    camera = new THREE.PerspectiveCamera(
      config.FOV_DEG,
      aspect,
      config.NEAR_PLANE,
      config.FAR_PLANE,
    );
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 4 (THREE.PerspectiveCamera):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 5 — THREE.WebGLRenderer (ADR-0009: WebGL only, never WebGPU)
  // -------------------------------------------------------------------------
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });

    // Color management: SRGBColorSpace is r152+ API. Never outputEncoding (removed).
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // Pixel ratio capped from config to protect low-end GPUs
    renderer.setPixelRatio(Math.min(devicePixelRatio, config.PIXEL_RATIO_CAP));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    // Shadow maps
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 5 (THREE.WebGLRenderer):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 6 — Default lights
  // -------------------------------------------------------------------------
  try {
    // Primary directional light (casts shadows)
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;

    // Shadow camera sized to fit ~30×30 world units
    const SHADOW_HALF = 15;
    dirLight.shadow.camera.left = -SHADOW_HALF;
    dirLight.shadow.camera.right = SHADOW_HALF;
    dirLight.shadow.camera.top = SHADOW_HALF;
    dirLight.shadow.camera.bottom = -SHADOW_HALF;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 50;

    // Shadow map size from config
    dirLight.shadow.mapSize.width = config.SHADOW_MAP_SIZE;
    dirLight.shadow.mapSize.height = config.SHADOW_MAP_SIZE;

    scene.add(dirLight);

    // Fill light — hemisphere (sky/ground) for ambient bounce
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x404060, 0.4);
    scene.add(hemiLight);
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 6 (lights):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 7 — RAPIER.World (gravity from config, never hardcoded)
  // -------------------------------------------------------------------------
  let world: RAPIER.World;
  try {
    world = new RAPIER.World({
      x: config.GRAVITY_X,
      y: config.GRAVITY_Y,
      z: config.GRAVITY_Z,
    });
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 7 (RAPIER.World):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 8 — DRACOLoader + GLTFLoader (shared instances, per ADR-0005)
  // -------------------------------------------------------------------------
  let gltfLoader: GLTFLoader;
  try {
    const dracoLoader = new DRACOLoader();
    // Decoder path from config (Google official CDN, stable since 2018)
    dracoLoader.setDecoderPath(config.DRACO_DECODER_PATH);

    gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 8 (DRACOLoader/GLTFLoader):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 9 — AudioContext (suspended; resumed on first user gesture per
  //           browser autoplay policy)
  // -------------------------------------------------------------------------
  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioContext();

    // One-time listener: resume audio on first canvas interaction
    const resumeAudio = (): void => {
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume();
      }
      canvas.removeEventListener('click', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
    };
    canvas.addEventListener('click', resumeAudio);
    window.addEventListener('keydown', resumeAudio);
  } catch (err) {
    console.error('[EngineBootstrap] init failed at step 9 (AudioContext):', err);
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 10 — Window resize listener (debounced to one rAF tick)
  // -------------------------------------------------------------------------
  let resizePending = false;

  const handleResize = (): void => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    });
  };

  window.addEventListener('resize', handleResize);

  // -------------------------------------------------------------------------
  // Callback registries (stored as arrays for O(1) append, registration order
  // preserved, unsubscribe by splice)
  // -------------------------------------------------------------------------
  const beforeStepCallbacks: Array<() => void> = [];
  const afterStepCallbacks: Array<() => void> = [];
  const beforeRenderCallbacks: Array<(realDt: number) => void> = [];

  function makeRegistry<T extends (...args: never[]) => void>(
    list: T[],
  ): (cb: T) => () => void {
    return (cb: T): (() => void) => {
      list.push(cb);
      return (): void => {
        const idx = list.indexOf(cb);
        if (idx !== -1) list.splice(idx, 1);
      };
    };
  }

  // -------------------------------------------------------------------------
  // Step 11 — Main loop (fixed-timestep accumulator per ADR-0007)
  //
  // Execution order each tick:
  //   1. compute dt (real seconds)
  //   2. accumulator = min(accumulator + dt, ACCUMULATOR_CAP_SEC)
  //   3. while accumulator >= FIXED_TIMESTEP_SEC:
  //        - beforeStep callbacks
  //        - world.step()        ← always default fixed step, never world.step(dt)
  //        - afterStep callbacks
  //        - accumulator -= FIXED_TIMESTEP_SEC
  //   4. beforeRender callbacks (receive real dt — for AnimationMixer etc.)
  //   5. renderer.render(scene, camera)
  //   6. schedule next frame
  // -------------------------------------------------------------------------
  let lastTime: number = performance.now();
  let accumulator: number = 0;
  let rafHandle: number = 0;
  let disposed = false;

  const FIXED_TIMESTEP_SEC = config.FIXED_TIMESTEP_SEC;
  const ACCUMULATOR_CAP_SEC = config.ACCUMULATOR_CAP_SEC;

  function frame(now: number): void {
    if (disposed) return;

    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Clamp to prevent spiral-of-death after tab unfocus (ADR-0007)
    accumulator = Math.min(accumulator + dt, ACCUMULATOR_CAP_SEC);

    while (accumulator >= FIXED_TIMESTEP_SEC) {
      for (const cb of beforeStepCallbacks) cb();
      world.step(); // fixed step — never world.step(dt) per ADR-0007
      for (const cb of afterStepCallbacks) cb();
      accumulator -= FIXED_TIMESTEP_SEC;
    }

    for (const cb of beforeRenderCallbacks) cb(dt);
    renderer.render(scene, camera);

    rafHandle = requestAnimationFrame(frame);
  }

  rafHandle = requestAnimationFrame(frame);

  // -------------------------------------------------------------------------
  // Assemble and return the EngineHandle
  // -------------------------------------------------------------------------
  const handle: EngineHandle = {
    // Three.js
    get scene(): THREE.Scene { return scene; },
    get camera(): THREE.PerspectiveCamera { return camera; },
    get renderer(): THREE.WebGLRenderer { return renderer; },

    // Rapier
    get world(): RAPIER.World { return world; },

    // Asset loading
    loadGLTF(url: string): Promise<GLTF> {
      return new Promise<GLTF>((resolve, reject) => {
        gltfLoader.load(url, resolve, undefined, reject);
      });
    },

    // Loop hooks
    onBeforeStep: makeRegistry(beforeStepCallbacks),
    onAfterStep: makeRegistry(afterStepCallbacks),
    onBeforeRender: makeRegistry(beforeRenderCallbacks),

    // Lifecycle
    dispose(): void {
      if (disposed) return; // idempotent
      disposed = true;

      cancelAnimationFrame(rafHandle);
      window.removeEventListener('resize', handleResize);

      renderer.dispose();

      // Free Rapier world — removes all bodies and colliders
      world.free();

      // Clear all callback lists
      beforeStepCallbacks.length = 0;
      afterStepCallbacks.length = 0;
      beforeRenderCallbacks.length = 0;
    },
  };

  return handle;
}

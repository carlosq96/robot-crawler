/**
 * @file src/engine/sky.ts
 * @description Dawn sky dome — large inverted sphere with a gradient shader
 * and a sun glow on the horizon in the -Z direction (the run direction).
 * Purely visual — no gameplay logic, no physics.
 *
 * The sky dome follows the camera so the horizon never gets closer.
 * Fog is added to the scene to match the horizon color and blend
 * distant ground tiles into the sky.
 *
 * Constraining ADRs:
 *   ADR-0009  WebGLRenderer — raw GLSL ShaderMaterial (no WebGPU)
 */

import * as THREE from 'three';
import type { EngineHandle } from './bootstrap.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Handle returned by createDawnSky. */
export interface DawnSky {
  /** Call once per frame to keep the dome centered on the camera. */
  update(): void;
  /** Remove dome + fog from scene and dispose GPU resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  // Position in local space is on a unit sphere — use it as a direction
  vWorldDir = normalize(position);
  // Place at far plane so it's always behind everything
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // push to far plane
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uDawnColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunSize;
uniform float uSunGlow;

varying vec3 vWorldDir;

void main() {
  vec3 dir = normalize(vWorldDir);
  float y = dir.y;

  // Sky gradient: zenith (top) → horizon (y=0)
  // Above horizon: blend zenith → horizon
  // Below horizon: darken toward ground color
  float aboveHorizon = max(0.0, y);
  float belowHorizon = max(0.0, -y);
  vec3 sky = mix(uHorizonColor, uZenithColor, pow(aboveHorizon, 0.6));
  sky = mix(sky, uHorizonColor * 0.3, pow(belowHorizon, 0.4));

  // Dawn glow band concentrated at the horizon
  float horizonBand = 1.0 - abs(y);
  horizonBand = pow(horizonBand, 5.0);
  sky = mix(sky, uDawnColor, horizonBand * 0.7);

  // Sun disc + soft glow (centered on uSunDir)
  float sunDot = dot(dir, uSunDir);
  // Sharp disc
  float disc = smoothstep(1.0 - uSunSize, 1.0, sunDot);
  // Broad glow
  float glow = pow(max(0.0, sunDot), uSunGlow);

  sky += uSunColor * disc;
  sky += uDawnColor * glow * 0.35;

  gl_FragColor = vec4(sky, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a dawn sky dome and add it to the scene.
 * The dome is a large inverted sphere with a gradient shader.
 * Also adds exponential fog to the scene.
 *
 * @param engine - Engine handle (scene, camera).
 * @returns A DawnSky handle with update() and dispose().
 */
export function createDawnSky(engine: EngineHandle): DawnSky {
  const { scene, camera } = engine;

  // Sun direction: toward -Z (the run direction), slightly above horizon
  const sunDir = new THREE.Vector3(0, 0.08, -1).normalize();

  // Colors — warm dawn palette
  const zenithColor = new THREE.Color(0x0a0a2e);    // deep dark indigo
  const horizonColor = new THREE.Color(0x1a1040);    // dark purple
  const dawnColor = new THREE.Color(0xff6030);        // warm orange
  const sunColor = new THREE.Color(0xffffcc);         // bright pale yellow
  const fogColor = new THREE.Color(0x1a1030);         // matches lower horizon

  // -------------------------------------------------------------------------
  // Sky dome — inverted sphere
  // -------------------------------------------------------------------------
  const geometry = new THREE.SphereGeometry(400, 32, 24);
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uZenithColor: { value: zenithColor },
      uHorizonColor: { value: horizonColor },
      uDawnColor: { value: dawnColor },
      uSunColor: { value: sunColor },
      uSunDir: { value: sunDir },
      uSunSize: { value: 0.01 },
      uSunGlow: { value: 12.0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false, // sky dome must not be affected by scene fog
  });

  const dome = new THREE.Mesh(geometry, material);
  dome.renderOrder = -1; // render before everything else
  scene.add(dome);

  // -------------------------------------------------------------------------
  // Fog — blends distant ground tiles into the horizon
  // -------------------------------------------------------------------------
  scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0035);

  // Also set the renderer clear color to match the fog / lower sky
  engine.renderer.setClearColor(fogColor, 1);

  console.log('[Sky] Dawn sky dome created');

  return {
    update(): void {
      // Keep the dome centered on the camera so the horizon never moves
      dome.position.copy(camera.position);
    },

    dispose(): void {
      scene.remove(dome);
      geometry.dispose();
      material.dispose();
      scene.fog = null;
      console.log('[Sky] Disposed');
    },
  };
}

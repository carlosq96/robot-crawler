# Three.js — Version Reference

| Field | Value |
|-------|-------|
| **Library Version** | Three.js r174 |
| **Release Date** | ~February 2025 |
| **Project Pinned** | 2026-04-08 |
| **Last Docs Verified** | 2026-04-08 |
| **LLM Knowledge Cutoff** | May 2025 |

## Knowledge Gap Warning

Three.js r174 is **just before** the LLM knowledge cutoff. The model should know
most APIs, but the project may use APIs from r175+ if upgraded later. Always
cross-reference this directory and the official docs before suggesting code.

## Critical r152+ Changes (already in our pinned r174)

These changed before our pinned version and the LLM may produce outdated code:

| Change | r152+ behavior | Pre-r152 (deprecated) |
|---|---|---|
| **Color management** | sRGB workflow by default; `WebGLRenderer.outputColorSpace = THREE.SRGBColorSpace` | `outputEncoding = THREE.sRGBEncoding` (removed) |
| **Texture color space** | `texture.colorSpace = THREE.SRGBColorSpace` | `texture.encoding = THREE.sRGBEncoding` (removed) |
| **Lighting** | Physically correct lights default ON | Required `physicallyCorrectLights = true` |
| **Shadows** | `WebGLShadowMap.type = THREE.PCFSoftShadowMap` recommended | Various older types |
| **GLTFLoader** | DRACOLoader optional but recommended | Same |

## Project-Specific Constraints (Robot Crawler / Vibe Jam 2026)

| Constraint | Value | Reason |
|---|---|---|
| **No bundler** | CDN importmap only (esm.sh / unpkg) | Jam rule: instant load, no build step |
| **Asset format** | GLB with Draco compression | Total asset budget under 10 MB |
| **Renderer** | `WebGLRenderer` (NOT `WebGPURenderer`) | WebGPU support varies by browser, jam compatibility |
| **Animation** | `AnimationMixer` for skinned meshes from GLB | Meshy AI exports skinned meshes |
| **Coordinate system** | Right-handed, Y-up (Three.js default) | — |

## Project-Local Skills (Vetted Reference Material)

The following skills live in `.claude/skills/threejs-*` and are loaded
automatically when their domain is touched:

| Skill | When to use |
|---|---|
| `threejs-fundamentals` | Scene/camera/renderer setup, Object3D hierarchy, math primitives |
| `threejs-geometry` | BufferGeometry, custom meshes, dungeon generation, instancing |
| `threejs-materials` | PBR, MeshStandardMaterial, custom ShaderMaterial |
| `threejs-lighting` | Light types, shadows, IBL, environment maps |
| `threejs-loaders` | GLTFLoader, DRACOLoader, async asset patterns |
| `threejs-animation` | AnimationMixer, GLTF animations, skeletal animation |
| `threejs-textures` | Texture types, UV mapping, cubemaps, HDR |
| `threejs-interaction` | Raycasting, picking, OrbitControls, mouse/touch input |
| `threejs-postprocessing` | EffectComposer, bloom, DOF, screen-space effects |
| `threejs-shaders` | GLSL, ShaderMaterial, custom uniforms |

These are the **first source of truth** for Three.js patterns. Prefer them over
training data when they conflict.

## Verified Sources

- Official docs: https://threejs.org/docs/
- Examples: https://threejs.org/examples/
- GitHub: https://github.com/mrdoob/three.js
- Migration guide: https://github.com/mrdoob/three.js/wiki/Migration-Guide
- Changelog (per release): https://github.com/mrdoob/three.js/releases
- ESM CDN (importmap): https://esm.sh/three@0.174.0
- Skills: https://skills.sh/cloudai-x/threejs-skills

## Common Footguns

1. **Forgetting `renderer.setPixelRatio(window.devicePixelRatio)`** — causes blurry rendering on retina
2. **Forgetting `camera.aspect = w/h; camera.updateProjectionMatrix()` on resize** — distorts view
3. **Loading textures without setting `colorSpace`** — washed-out colors
4. **Not disposing geometries/materials/textures** — memory leaks (use `.dispose()`)
5. **Hot path allocation** — never `new Vector3()` in animate(); reuse via module-scope temps
6. **Mixing `Object3D.lookAt()` with quaternions** — order matters; use one or the other
7. **`raycaster.intersectObjects()` with `recursive: false`** — misses children; default is true

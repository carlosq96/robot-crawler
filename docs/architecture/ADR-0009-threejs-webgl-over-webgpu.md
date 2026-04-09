# ADR-0009: Three.js WebGLRenderer over WebGPURenderer

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Three.js r174 supports both `WebGLRenderer` and `WebGPURenderer`. We use **`WebGLRenderer` (WebGL 2.0)** because WebGPU support is incomplete in Firefox and Safari, which would exclude a meaningful portion of Vibe Jam 2026's audience. WebGPU is reconsidered post-jam if browser support reaches ~95%.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Three.js r174 |
| **Domain** | Rendering |
| **Knowledge Risk** | LOW — WebGLRenderer is the historical default and well-known to the LLM |
| **References Consulted** | docs/engine-reference/threejs/VERSION.md, https://caniuse.com/webgpu |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Three.js scene renders identically in Chrome, Firefox, Safari, Edge |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0001 (no bundler — affects how Three.js is loaded) |
| **Enables** | Engine Bootstrap GDD, every visual system |
| **Blocks** | Engine Bootstrap GDD |
| **Ordering Note** | Must be locked before Engine Bootstrap GDD |

## Context

### Problem Statement

Three.js r174 ships two renderers: the mature `WebGLRenderer` (WebGL 2.0 backend) and the newer `WebGPURenderer` (WebGPU backend). WebGPU is faster for high draw call counts, supports compute shaders, and is the future. But WebGPU support in 2026 is uneven:
- Chrome 113+ ✅
- Edge 113+ ✅
- Firefox: behind a flag (or shipped recently — verify)
- Safari: Tech Preview only (or shipped recently — verify)

The jam targets the public — every browser that doesn't support WebGPU is a player we exclude.

### Current State

Greenfield; no rendering code exists.

### Constraints

- Public deployment via Vercel
- Vibe Jam audience = whoever shows up; cannot dictate browsers
- Solo dev; can't double the testing surface (WebGL + WebGPU branches)
- Performance budget: 60 fps with ~200 draw calls

### Requirements

- Renders correctly in Chrome 120+, Firefox 120+, Safari 17+, Edge
- Supports PBR materials (we use Meshy AI exports with PBR maps)
- Supports shadows (or at least baked AO + projected shadow blob)
- Supports post-processing (optional, for charged buster glow effect)
- Stays within 200 draw calls per frame budget (mitigated by instanced rendering)

## Decision

Use `THREE.WebGLRenderer` (WebGL 2.0). Skip WebGPU entirely for jam v1. Re-evaluate post-jam.

### Architecture

```
src/engine/scene.ts
  │
  ├── new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  ├── renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  ├── renderer.setSize(window.innerWidth, window.innerHeight)
  ├── renderer.outputColorSpace = THREE.SRGBColorSpace      ← r152+ (see threejs/VERSION.md)
  ├── renderer.toneMapping = THREE.ACESFilmicToneMapping
  ├── renderer.shadowMap.enabled = true
  └── renderer.shadowMap.type = THREE.PCFSoftShadowMap
```

### Key Interfaces

```ts
// src/engine/scene.ts
import * as THREE from 'three';

export function initRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}
```

### Implementation Guidelines

- **Use `THREE.SRGBColorSpace`** (r152+); never `outputEncoding = sRGBEncoding` (deprecated, removed)
- Cap pixel ratio at 2 — retina displays don't need 3x for jam scale
- Use `MeshStandardMaterial` for PBR (matches Meshy AI exports)
- Use **instanced rendering** (`THREE.InstancedMesh`) for enemies and projectiles to stay under 200 draw calls
- Shadow maps: 1024×1024 max for jam (1 directional light); use blob shadows under enemies if perf is tight
- Post-processing via `EffectComposer` from `three/addons/postprocessing/` if/when we add the buster glow effect

## Alternatives Considered

### Alternative 1: WebGPURenderer

- **Description**: Use Three.js's modern WebGPU backend
- **Pros**: Faster for high draw call counts; compute shaders; future of web rendering
- **Cons**: Firefox and Safari support uneven in 2026; doubles testing matrix
- **Estimated Effort**: Same setup, much higher testing
- **Rejection Reason**: Excluding Firefox/Safari users is unacceptable for a public jam entry

### Alternative 2: Both with feature detection (WebGPU primary, WebGL fallback)

- **Description**: Detect WebGPU support, use it if available, fall back to WebGL
- **Pros**: Best perf for users with WebGPU
- **Cons**: Double the testing matrix; visual differences between renderers; jam scope cannot afford
- **Estimated Effort**: 1.5-2x baseline
- **Rejection Reason**: Solo dev, 23 days — pick one path and ship

### Alternative 3: BabylonJS WebGPU

- **Description**: Switch engines entirely to BabylonJS which has more mature WebGPU
- **Pros**: Better WebGPU; great editor
- **Cons**: Throw away all the cloudai-x Three.js skills we just installed
- **Estimated Effort**: Massive
- **Rejection Reason**: Sunk cost in tooling + skills

## Consequences

### Positive

- Works in every modern browser (Chrome, Firefox, Safari, Edge)
- WebGL 2.0 is mature, well-documented, well-supported by Three.js skills
- One render path = simpler debugging and testing
- All Three.js examples and tutorials use WebGLRenderer

### Negative

- Slightly higher CPU per draw call vs WebGPU (~0.05-0.1 ms vs ~0.02 ms) — mitigated by instancing
- No compute shaders (we don't need any for jam)
- Cannot use the very latest Three.js features that are WebGPU-exclusive (mostly examples, not core)

### Neutral

- Forced to use `MeshStandardMaterial` and standard shader chunks (good thing)
- Compatible with all Three.js examples and skills

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Draw call count exceeds 200 | Medium | Medium | Use InstancedMesh for enemies/projectiles; merge static geometry |
| PBR materials look wrong on some browsers | Low | Medium | Test in all 4 target browsers before submission |
| Shadow performance hits frame budget | Medium | Medium | Single directional light, 1024×1024 map; fall back to blob shadows |
| WebGL 2.0 not available on user's browser | Very Low | High | Show friendly fallback message; WebGL 2.0 is universally supported in 2026 |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Draw calls (typical) | N/A | 100-150 | < 200 |
| Frame time render budget | N/A | 6-8 ms | < 8 ms |
| GPU memory | N/A | 80-120 MB (textures + meshes) | < 200 MB |
| Shadow pass cost | N/A | ~1-2 ms | < 3 ms |

## Migration Plan

N/A — greenfield.

**Rollback plan**: If we ever switch to WebGPU post-jam, the migration is mechanical: change `WebGLRenderer` to `WebGPURenderer`, update imports. Most Three.js code is renderer-agnostic. Cost: ~half a day.

## Validation Criteria

- [ ] Scene renders identically in Chrome, Firefox, Safari, Edge (visual diff)
- [ ] PBR materials show correct colors and lighting (color management correct per r152+ rules)
- [ ] Frame budget held: render < 8 ms in 95th percentile
- [ ] Draw call count < 200 in worst-case scene
- [ ] No deprecated API warnings in console (no `outputEncoding`, etc.)

## GDD Requirements Addressed

Foundational — no GDD requirement. Enables: every visual system; ensures jam audience reach across all major browsers.

## Related

- ADR-0001 (no bundler) — Three.js loaded via importmap
- ADR-0005 (Draco compression) — affects model loading, not rendering directly
- docs/engine-reference/threejs/VERSION.md → r152+ critical changes (color management)
- design/gdd/systems-index.md → Engine Bootstrap, all visual systems

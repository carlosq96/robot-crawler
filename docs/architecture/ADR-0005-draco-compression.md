# ADR-0005: Draco mesh compression mandatory on all GLBs

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Every GLB asset committed to `assets/models/` must be Draco-compressed before commit. Each compressed model must be under 2 MB. Total model budget: under 10 MB. This is enforced by an asset audit and is required for the Vibe Jam "instant load" rule.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Three.js r174 + GLTFLoader + DRACOLoader |
| **Domain** | Asset pipeline / Rendering |
| **Knowledge Risk** | LOW — Draco has been Three.js-supported since r93 |
| **References Consulted** | docs/engine-reference/threejs/VERSION.md, https://threejs.org/docs/#examples/en/loaders/DRACOLoader |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | DRACOLoader CDN URL works in production importmap |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0001 (no bundler — affects how DRACOLoader is loaded) |
| **Enables** | ADR-0010 (Meshy AI pipeline — defines the source format), instant-load jam compliance |
| **Blocks** | First model commit (cannot land an uncompressed asset) |
| **Ordering Note** | Must be in place before any GLB is committed |

## Context

### Problem Statement

Vibe Jam 2026 requires instant load. Three.js loads GLB models. Uncompressed GLBs from Meshy AI typically range 5-50 MB each. With ~7-10 models needed (player + 3-5 enemies + boss + dungeon tiles + crystal + sub-weapon FX), uncompressed totals would be 50-200 MB — far over jam budget.

### Current State

No assets committed yet; greenfield project.

### Constraints

- Total client wire size for instant load: ~10-15 MB max
- Of that, models should fit in ~10 MB (rest is textures, JS, audio)
- Draco encoding requires offline tooling (gltf-pipeline)

### Requirements

- Per-model budget: < 2 MB compressed
- Total models under 10 MB compressed
- Models load asynchronously without freezing the main thread
- DRACOLoader decoder runs in WASM worker (default Three.js behavior)

## Decision

All GLB files committed to `assets/models/` must be processed through the `gltf-pipeline` npm tool with Draco compression enabled. The asset audit (manual or scripted) rejects any GLB > 2 MB. Three.js loads them via `GLTFLoader` configured with a `DRACOLoader` instance pointing at the official Draco decoder CDN.

### Architecture

```
Author asset (Meshy AI)              Pre-commit pipeline                    Runtime
   │                                       │                                  │
   ▼                                       ▼                                  ▼
┌───────────┐    GLB (5-50MB)    ┌─────────────────┐  GLB (1-2MB)   ┌─────────────────┐
│  Meshy    │ ──────────────────▶│ gltf-pipeline   │───────────────▶│ Vercel /assets/  │
│  Export   │                    │ --draco         │                │     │           │
└───────────┘                    │ --draco-level=10│                │     ▼           │
                                 └─────────────────┘                │ GLTFLoader      │
                                          │                         │     +           │
                                          ▼                         │ DRACOLoader     │
                                   assets/models/*.glb              │     │           │
                                   (committed to git)               │     ▼           │
                                                                    │  WebGL Mesh     │
                                                                    └─────────────────┘
```

### Key Interfaces

```ts
// src/engine/loaders.ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
dracoLoader.setDecoderConfig({ type: 'js' }); // or 'wasm' if available

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

export async function loadModel(url: string) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, resolve, undefined, reject);
  });
}
```

```bash
# Pre-commit / authoring command (runs locally, not in CI for jam)
npx gltf-pipeline -i input.glb -o output.glb -d --draco.compressionLevel=10
```

### Implementation Guidelines

- All GLBs in `assets/models/` are Draco-compressed before being committed
- Use `gltf-pipeline -d` (the `-d` flag enables Draco)
- `--draco.compressionLevel=10` for maximum compression (slowest encoding, smallest output)
- Per-model budget enforced manually or by an `asset-audit` skill run before each commit
- DRACOLoader instance is shared across the app (one decoder, many GLTFLoader uses)
- Decoder CDN: `https://www.gstatic.com/draco/v1/decoders/` (Google official, very stable)

## Alternatives Considered

### Alternative 1: No compression (raw GLB)

- **Description**: Ship Meshy GLBs as-is
- **Pros**: Simplest pipeline; fastest decompression at runtime (none)
- **Cons**: Total assets >50 MB; breaks jam load rule
- **Estimated Effort**: Zero
- **Rejection Reason**: Hard fail on jam load budget

### Alternative 2: Meshopt compression (newer, faster decode)

- **Description**: Newer compression scheme, faster runtime decode
- **Pros**: ~10% smaller than Draco at comparable quality, faster decode
- **Cons**: Less mature in Three.js loader chain; less tooling; jam timeline
- **Estimated Effort**: Higher (less documentation, less battle-tested)
- **Rejection Reason**: Draco is the safer mature path for jam

### Alternative 3: KTX2 textures only (no mesh compression)

- **Description**: Compress textures with KTX2/Basis, leave meshes uncompressed
- **Pros**: Reduces texture size dramatically
- **Cons**: Doesn't address mesh size — meshes are still 50 MB
- **Estimated Effort**: Medium
- **Rejection Reason**: Solves the wrong problem

## Consequences

### Positive

- Total model budget fits in <10 MB
- First load < 2 seconds on 50 Mbps (jam-compliant)
- DRACOLoader is well-tested and reliable
- One enforcement rule, easy to audit

### Negative

- One-time CPU cost on first model load (~50 ms per model for Draco decompression in WASM)
- Adds an offline pipeline step (gltf-pipeline) that must be run manually before commit
- DRACOLoader requires the decoder CDN URL to be reachable at runtime

### Neutral

- Models in source repo are smaller (faster git operations)
- Draco-compressed models are still standard GLB; can be opened in Blender / inspected normally

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Forgot to compress an asset before commit | Medium | Medium | Asset audit script; manual check before commit |
| Draco decoder CDN goes down at runtime | Low | High | Mirror the decoder files into `public/draco/` as fallback |
| Compression breaks a model (artifacts, missing data) | Low | Medium | Verify visually after each compress; gltf-pipeline preserves animations and PBR |
| Per-model budget too tight for boss / hero | Medium | Medium | Allow exception for boss model up to 3 MB; document in asset audit |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Model file size | 5-50 MB | 1-2 MB | < 2 MB per model |
| Total model wire size | N/A | < 10 MB | < 10 MB |
| First-load decompression CPU | 0 | ~50 ms per model (one-time) | < 500 ms total |
| Runtime memory | same | same | n/a (decompressed mesh same size in GPU) |

## Migration Plan

N/A — greenfield, no assets exist yet.

**Rollback plan**: If Draco proves problematic for a specific model, fall back to uncompressed GLB for that model only and absorb the size hit.

## Validation Criteria

- [ ] All GLBs in `assets/models/` are < 2 MB
- [ ] Total `assets/models/` directory size < 10 MB
- [ ] Models load and render correctly with DRACOLoader configured
- [ ] First model load takes < 100 ms total (network + decompression) on a 50 Mbps connection
- [ ] DRACOLoader decoder CDN URL is reachable from production deployment

## GDD Requirements Addressed

Foundational — no GDD requirement. Enables: Vibe Jam "instant load" compliance and all visual entity systems (Player, Enemy, Boss, Dungeon, Pickup, Sub-Weapon).

## Related

- ADR-0001 (no bundler) — DRACOLoader loaded via importmap, decoder via CDN
- ADR-0010 (Meshy AI pipeline) — defines the source format that gets compressed
- design/gdd/systems-index.md → Engine Bootstrap (loader setup), all entity systems

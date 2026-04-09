# ADR-0010: Meshy AI as primary 3D asset pipeline

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

All 3D models for Robot Crawler are generated using **Meshy AI** (text-to-3D and image-to-3D), exported as GLB with PBR materials, post-processed with Draco compression (ADR-0005), and committed to `assets/models/`. Animations come from Meshy auto-rigging or Mixamo overlays. This is the only viable asset pipeline for a solo developer in a 23-day jam.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Three.js r174 + GLTFLoader + DRACOLoader |
| **Domain** | Asset pipeline / Art |
| **Knowledge Risk** | LOW — Meshy AI is well-documented; GLB is a standard format |
| **References Consulted** | https://www.meshy.ai/, https://www.mixamo.com/ |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Meshy GLB exports load via DRACOLoader without errors; PBR materials render correctly |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0005 (Draco compression — defines the post-processing step) |
| **Enables** | Every visual entity (Player, Enemy, Boss, Dungeon Tiles, Crystal, Sub-Weapon FX) |
| **Blocks** | First model commit |
| **Ordering Note** | Must be locked before any visual entity GDD is implemented |

## Context

### Problem Statement

Robot Crawler is a 3D game. It needs ~7-10 models: player character, 3-5 enemy types, boss, dungeon tile set, crystal pickup, sub-weapon FX. Traditional 3D modeling (Blender) takes weeks per model for a solo developer with no art background. The jam is 23 days.

### Current State

Greenfield; zero models exist.

### Constraints

- Solo developer; no art rotation
- 23-day jam timeline
- ~10 models needed minimum
- Per-model file size budget: <2 MB compressed (per ADR-0005)
- Total asset budget: <10 MB compressed
- Must export to GLB with PBR materials (compatible with Three.js + Meshy AI workflow)

### Requirements

- Each model has: base color, roughness, metallic, normal maps (PBR-ready)
- Each model is rigged + animated (player has Idle/Walk/Run/Shoot/Charge/Hit/Death; enemies have Idle/Attack/Death)
- All models share a consistent visual style (Megaman Legends-inspired stylized 3D)
- Pipeline is repeatable in <10 minutes per model

## Decision

Use Meshy AI as the primary 3D asset generator. Export to GLB with PBR materials. Use Mixamo as a fallback for rigging/animation if Meshy's auto-rig is insufficient. Post-process all GLBs through gltf-pipeline (Draco) before commit.

### Architecture

```
        Author (Meshy AI)                Process               Deploy
        ─────────────────                ───────               ──────
        
   1. Text-to-3D OR Image-to-3D      gltf-pipeline -d         Vercel /assets/
   prompt: "stylized robot soldier,  --draco.level=10
   PBR, low-poly, Megaman Legends                              ┌─────────────┐
   art style, 3000 tris max"        ┌──────────────┐           │ Browser     │
                                    │  Optimized   │           │   ┌───────┐ │
   ┌──────────────┐                 │  GLB         │           │   │ GLTF  │ │
   │ Meshy AI     │ ──────────────▶ │  ~1-2 MB     │ ────────▶ │   │ Loader│ │
   │ Web App      │                 │  Draco-comp  │           │   └───┬───┘ │
   └──────────────┘                 └──────────────┘           │       │     │
        │                                                      │       ▼     │
        │ (auto-rig)                                           │   WebGL     │
        ▼                                                      └─────────────┘
   GLB with skeleton                
   + animation clips                
        │                           
        │ (if Meshy rig is bad)     
        ▼                           
   Mixamo manual rig fallback       
        │                           
        ▼                           
   gltf-pipeline export             
```

### Key Interfaces

```bash
# Author workflow (offline, run locally)

# 1. Generate model in Meshy AI web app
#    - Mode: Text-to-3D
#    - Prompt: see prompt template below
#    - Style: PBR
#    - Polygon limit: 3000-5000 tris
#    - Auto-rig: Yes (humanoid for player/enemies, none for static)

# 2. Download as GLB

# 3. Compress with Draco
npx gltf-pipeline -i raw/player.glb -o assets/models/player.glb -d --draco.compressionLevel=10

# 4. Verify size
ls -lh assets/models/player.glb  # must be < 2 MB
```

```ts
// src/engine/loaders.ts (uses ADR-0005 DRACOLoader setup)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

const playerGLTF = await gltfLoader.loadAsync('/assets/models/player.glb');
const playerMesh = playerGLTF.scene;
const playerAnimations = playerGLTF.animations;  // → AnimationController (Animation Controller system)
```

### Implementation Guidelines

- **Prompt template** (use this format for every model so the visual style is consistent):
  > `"stylized robot, low-poly PBR, [N] tris max, Megaman Legends art style, [SPECIFIC_DESCRIPTION], front-facing T-pose, ready for game animation, no environment, white background"`
- **Polygon budget**: 3000-5000 tris per model max (Meshy can target this)
- **Texture resolution**: 1024×1024 base color, 512×512 for normal/roughness/metallic
- **Naming convention**: `assets/models/[entity-name].glb` (kebab-case)
- **Always Draco-compress before commit** (per ADR-0005)
- **Verify visually**: load each model in https://gltf-viewer.donmccurdy.com/ before committing
- **Animations from Meshy if good, Mixamo if not**: download `.fbx` from Mixamo, retarget in Blender, export to GLB
- **Priority generation order**: player → main enemy → boss → dungeon tiles → crystal pickup → other enemies → sub-weapon FX

## Alternatives Considered

### Alternative 1: Manual modeling (Blender)

- **Description**: Solo dev models everything in Blender from scratch
- **Pros**: Full creative control; no AI dependency
- **Cons**: ~1 week per model for a non-artist; total = 10+ weeks; jam fails
- **Estimated Effort**: Massive
- **Rejection Reason**: No solo dev with no art background can ship 10 quality models in 23 days

### Alternative 2: Free asset packs (Quaternius, Kenney, Synty)

- **Description**: Use existing CC0 / cheap asset packs
- **Pros**: Fast; free; consistent style within a pack
- **Cons**: Visual identity matches the pack, not Robot Crawler; finding a pack that fits "Megaman Legends meets dungeon crawler" is hard
- **Estimated Effort**: Lowest
- **Rejection Reason**: Loses visual identity; every game using the same pack looks the same. **However, this is the documented fallback if Meshy fails.**

### Alternative 3: Hire a contract 3D artist

- **Description**: Pay a freelancer for the models
- **Pros**: Best quality
- **Cons**: No budget; lead time on hiring is days
- **Estimated Effort**: Coordination overhead; cost
- **Rejection Reason**: No budget, no time

### Alternative 4: Sketchfab CC0 downloads

- **Description**: Browse Sketchfab for CC0 models matching our needs
- **Pros**: Free; high variety; some are excellent
- **Cons**: Inconsistent visual style across models; license attribution overhead
- **Estimated Effort**: Variable
- **Rejection Reason**: Documented as **fallback option** if Meshy quality is insufficient on a specific model

## Consequences

### Positive

- Fast iteration (text → model in ~5-10 minutes)
- Consistent visual style if prompts are templated
- One tool, one workflow, one mental model
- Models are unique to this project (no asset-pack overlap with other games)
- Auto-rigging covers most needs (player + enemies are humanoid)

### Negative

- AI quality is variable; some models need manual cleanup or regeneration
- Animation quality from Meshy auto-rig may be insufficient for hero / boss
- Legal: Meshy ToS allows commercial use as of 2026, but verify before publishing
- Dependency on Meshy as a service (their account, their uptime)

### Neutral

- Pipeline is offline (not in CI for jam) — runs on the dev machine
- All raw downloads go to `raw/` (gitignored); only compressed `.glb` files are committed

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Meshy quality insufficient for hero/boss models | Medium | High | Fallback: hand-pick from Sketchfab CC0 with matching style |
| Auto-rigging fails for unusual silhouettes | High | Medium | Mixamo retargeting fallback; manual Blender rig as last resort |
| Meshy API/account outage mid-jam | Low | High | Cache all generated raw models locally; have CC0 backup models pre-selected |
| Legal: AI-generated art ToS changes mid-jam | Low | Medium | Verify ToS at start of jam; document the version of ToS we relied on |
| Too many models needed → time spent in Meshy exceeds budget | Medium | Medium | Hard cap at 10 models for jam v1; reuse meshes (e.g. crystal pickup uses one mesh, color variants) |

## Performance Implications

N/A — asset pipeline is offline. Runtime perf is governed by ADR-0005 (Draco compression) and ADR-0009 (WebGL renderer).

## Migration Plan

N/A — greenfield, no assets exist.

**Rollback plan**: If Meshy proves entirely unworkable, fall back to Sketchfab CC0 downloads + Quaternius Free packs. The model paths and loaders stay the same; only the source changes.

## Validation Criteria

- [ ] First Meshy-generated model loads in Three.js with PBR materials rendering correctly
- [ ] Auto-rig produces playable animations on the player model
- [ ] Per-model size after Draco compression is < 2 MB
- [ ] Total `assets/models/` directory < 10 MB
- [ ] Visual style is consistent across at least 5 models (verified by side-by-side review)
- [ ] Meshy ToS allows commercial / public jam use (verified at jam start)

## GDD Requirements Addressed

Foundational — no GDD requirement. Enables: every visual entity in the game (Player, Enemies, Boss, Dungeon Tiles, Crystal Pickup, Sub-Weapon FX). Without an asset pipeline, the game has nothing to render.

## Related

- ADR-0005 (Draco compression) — defines the mandatory post-processing step
- ADR-0009 (WebGL over WebGPU) — affects PBR material compatibility
- design/gdd/systems-index.md → Player System, Enemy System, Dungeon Generator, Pickup System, Sub-Weapon System — all consume this pipeline

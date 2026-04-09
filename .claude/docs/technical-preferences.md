# Technical Preferences

<!-- Project: Robot Crawler — Vibe Jam 2026 entry -->
<!-- Updated: 2026-04-08 -->
<!-- All agents reference this file for project-specific standards and conventions. -->

## Engine & Language

- **Engine**: Three.js r174 (NOT a traditional game engine — pure TS/WebGL via importmap)
- **Language**: TypeScript ^5.x everywhere (server + client). Client source files are `.ts`, transpiled per-file by `tsc` at Vercel deploy time into `public/src/*.js` (ES modules). NOT bundled — 1:1 file mapping. See ADR-0008.
- **Rendering**: Three.js `WebGLRenderer` (NOT WebGPU — browser support varies; see ADR-0009)
- **Physics**: Rapier 3D via `@dimforge/rapier3d-compat` (WASM, bundler-free)
- **Multiplayer**: Colyseus 0.15 (server) + `@colyseus/sdk` (client)
- **Persistence**: Railway Postgres via `pg` npm (server-only, write on `onDispose`)

## Input & Platform

- **Target Platforms**: Web (Chrome 120+, Firefox 120+, Safari 17+, Edge)
- **Input Methods**: Keyboard/Mouse primary, Gamepad (Xbox/PS) secondary via Gamepad API
- **Primary Input**: Keyboard/Mouse (WASD movement + mouse aim/click)
- **Gamepad Support**: Partial — basic 4-axis movement + face buttons, no rebinding UI for jam
- **Touch Support**: None for jam (desktop browser focus; mobile is post-jam stretch)
- **Platform Notes**: Must load instantly (no loading screen, total assets under 10 MB Draco-compressed). Username only — no login flow.

## Naming Conventions

- **Classes**: `PascalCase` (e.g., `DungeonRoom`, `Player`, `Buster`)
- **Variables**: `camelCase` (e.g., `playerHp`, `lockedTarget`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_PLAYERS`, `BUSTER_COOLDOWN_MS`)
- **Files**: `kebab-case.ts` for client (e.g., `dungeon-gen.ts`, `lock-on.ts`); `PascalCase.ts` for server schema/room files (e.g., `DungeonRoom.ts`, `GameState.ts`); `kebab-case.ts` for shared schemas in `shared/schemas/`
- **Events/Messages**: `kebab-case` strings (e.g., `room.send("shoot", ...)`, `room.send("revive", ...)`)
- **Data files**: `kebab-case.json` (e.g., `enemy-types.json`, `weapon-stats.json`)

## Performance Budgets

- **Target Framerate**: 60 fps on a mid-range 2024 laptop (M2 MacBook Air, 2024 Dell XPS)
- **Frame Budget**: 16.6 ms total
  - Render: ≤ 8 ms
  - Physics step: ≤ 4 ms
  - Game logic + AI: ≤ 3 ms
  - Network sync: ≤ 1.5 ms
- **Draw Calls**: ≤ 200 per frame (use instanced rendering for enemies + projectiles)
- **Memory Ceiling**: 512 MB JavaScript heap, 100 MB GPU (textures + geometry)
- **Initial Load**: ≤ 3 seconds to playable on 50 Mbps connection (jam rule: instant load)
- **Total Asset Bundle**: ≤ 10 MB Draco-compressed GLBs + textures

## Testing

- **Framework**: Vitest (client and server share runner; ESM-native)
- **Minimum Coverage**: NONE for jam — pragmatic spot tests only
- **Required Tests**:
  - Procedural dungeon generation: same seed → same layout (determinism check)
  - Score formula: `(kills*10) + (crystals*5) - (seconds*0.5) + (zeroDeaths ? 500 : 0)`
  - Schema sync: server-side state mutations produce expected client deltas

## Forbidden Patterns

- ❌ **Bundlers** (Vite, Webpack, Parcel, esbuild, Rollup) — jam rule, instant load via CDN importmap
- ❌ **Frameworks** (React, Vue, Svelte, Solid) — overkill, breaks no-bundler rule
- ❌ **Per-client `package.json`** — there is ONE `package.json` at the repo root for `tsc` + server deps; the client never imports from `node_modules` at runtime. All third-party client code resolves via the CDN importmap.
- ❌ **Client runtime imports from `node_modules`** — bare specifiers in client code (`import * as THREE from 'three'`) are resolved at runtime by the importmap, never bundled in
- ❌ **`new Vector3()` / `new Quaternion()` in animation loop** — pre-allocate module-level temps
- ❌ **`document.querySelector()` for game UI** — use Three.js HUD via Canvas/Sprite, or a single overlay HTML layer updated by ID
- ❌ **Per-frame Postgres writes** — only `onDispose()` in Colyseus rooms writes to DB
- ❌ **Trusting client-side combat** — server is authoritative; clients send intents
- ❌ **Variable Rapier timestep** — fixed 1/60 step for determinism + multiplayer sync
- ❌ **Trimesh colliders for dynamic bodies** — use convex hulls
- ❌ **`outputEncoding`, `texture.encoding`** — removed in Three.js r152+; use `colorSpace` properties

## Allowed Libraries / Addons

### Client (CDN importmap, no install)
- `three@0.174.0` — renderer, math, scene graph
- `three/examples/jsm/loaders/GLTFLoader.js` — GLB asset loading
- `three/examples/jsm/loaders/DRACOLoader.js` — Draco mesh decompression
- `three/examples/jsm/controls/OrbitControls.js` — debug camera (dev only)
- `@dimforge/rapier3d-compat@0.14.0` — physics (WASM-inlined)
- `@colyseus/sdk@^0.15` — multiplayer client
- (Anything else requires an ADR.)

### Server + Build (one root `package.json`)
- `colyseus@^0.15`
- `@colyseus/schema@^2`
- `express@^4`
- `pg@^8` — Postgres client
- `typescript@^5` — used by BOTH server build AND client deploy-time transpile (per ADR-0008)
- `vitest@^1` — tests
- `gltf-pipeline` (dev only) — Draco compression CLI per ADR-0005
- (Anything else requires an ADR.)

### Asset Pipeline (external tools)
- Meshy AI — text-to-3D / image-to-3D model generation
- Draco compressor (gltf-pipeline npm tool) — compress GLBs offline before commit
- Audacity / SFXR — SFX (post-jam stretch)

## Architecture Decisions Log

Quick reference linking to full ADRs in `docs/architecture/`. All ten are
**Accepted** as of 2026-04-08.

- [Accepted] [ADR-0001 — No bundler (CDN importmap only)](../../docs/architecture/ADR-0001-no-bundler.md)
- [Accepted] [ADR-0002 — Colyseus over SpacetimeDB / WebRTC](../../docs/architecture/ADR-0002-colyseus-multiplayer.md)
- [Accepted] [ADR-0003 — Railway Postgres over Supabase](../../docs/architecture/ADR-0003-railway-postgres.md)
- [Accepted] [ADR-0004 — Server-authoritative combat (no client trust)](../../docs/architecture/ADR-0004-server-authoritative-combat.md)
- [Accepted] [ADR-0005 — Draco compression mandatory on all GLBs](../../docs/architecture/ADR-0005-draco-compression.md)
- [Accepted] [ADR-0006 — Postgres write only on `onDispose`](../../docs/architecture/ADR-0006-postgres-on-dispose.md)
- [Accepted] [ADR-0007 — Fixed Rapier timestep (1/60)](../../docs/architecture/ADR-0007-fixed-rapier-timestep.md)
- [Accepted] [ADR-0008 — TypeScript everywhere with deploy-time transpile](../../docs/architecture/ADR-0008-typescript-everywhere.md)
- [Accepted] [ADR-0009 — Three.js WebGLRenderer over WebGPURenderer](../../docs/architecture/ADR-0009-threejs-webgl-over-webgpu.md)
- [Accepted] [ADR-0010 — Meshy AI as primary 3D asset pipeline](../../docs/architecture/ADR-0010-meshy-asset-pipeline.md)

## Engine Specialists

<!-- Robot Crawler does NOT use a traditional game engine. -->
<!-- The standard Godot/Unity/Unreal specialists DO NOT APPLY. -->
<!-- All work is routed to the engine-agnostic programmer agents below. -->

- **Primary**: `engine-programmer` (for Three.js scene/renderer, Rapier integration, asset loading)
- **Language/Code Specialist**: N/A (vanilla JS — no language specialist needed)
- **Shader Specialist**: `engine-programmer` (for any custom Three.js ShaderMaterial work; consult `threejs-shaders` skill)
- **UI Specialist**: `ui-programmer`
- **Additional Specialists**: `gameplay-programmer`, `network-programmer`, `performance-analyst`, `qa-tester`, `game-designer`, `lead-programmer`
- **Routing Notes**: Skip all `godot-*`, `unity-*`, `unreal-*`, `ue-*` agents — they don't apply to a Three.js project. Engine-agnostic agents handle everything.

### File Extension Routing

| File Extension / Type | Specialist to Spawn |
|-----------------------|---------------------|
| `src/main.ts`, `src/engine/*.ts` | `engine-programmer` |
| `src/gameplay/*.ts`, `src/combat/*.ts` | `gameplay-programmer` |
| `src/networking/*.ts` | `network-programmer` |
| `src/ui/*.ts` | `ui-programmer` |
| `shared/schemas/*.ts` | `network-programmer` (Colyseus schemas shared between client + server) |
| `server/rooms/*.ts`, `server/index.ts` | `network-programmer` (Colyseus is server netcode) |
| `server/schemas/*.ts` | `network-programmer` |
| `server/routes/*.ts`, `server/db/*.ts` | `engine-programmer` (Postgres + Express infrastructure) |
| `assets/models/*.glb` | `technical-artist` (asset audit only — no code) |
| Tests in `tests/` | `qa-tester` |
| Custom GLSL shaders | `engine-programmer` + consult `threejs-shaders` skill |
| General architecture review | `lead-programmer` |

## Reference Documentation Map

When implementing anything, check these in order:

1. **Project-local skills** in `.claude/skills/threejs-*` (10 vetted Three.js skills)
2. **`docs/engine-reference/threejs/VERSION.md`** — pinned Three.js r174, footguns, deprecated APIs
3. **`docs/engine-reference/rapier/RAPIER-0.14.md`** — Rapier 0.14 patterns + footguns
4. **`docs/engine-reference/colyseus/COLYSEUS-0.15.md`** — Colyseus 0.15 patterns + footguns
5. **Canonical docs** (linked from each VERSION.md file) when uncertain — verify against the real source before guessing

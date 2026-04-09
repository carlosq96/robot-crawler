# ADR-0008: TypeScript everywhere — server + client with deploy-time transpile

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Both client and server use TypeScript. The server uses standard `tsc` build to JS. The client uses **per-file** `tsc` transpile (NOT bundling) at Vercel deploy time, producing 1:1 ES module outputs that work with the importmap from ADR-0001. This refines but does not violate ADR-0001's no-bundler rule because per-file transpilation is type-stripping, not bundling.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | TypeScript ^5.x · Three.js r174 · Node.js 20+ |
| **Domain** | Build pipeline / Language |
| **Knowledge Risk** | LOW — TypeScript is well-known to the LLM; tsc per-file transpile is a stable pattern |
| **References Consulted** | https://www.typescriptlang.org/docs/, ADR-0001 |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Vercel build runs `tsc` successfully and produces working ES modules in `public/src/` |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | ADR-0001 (no bundler — this ADR REFINES that rule) |
| **Enables** | All systems benefit from type-safe shared schemas (Colyseus state) and refactor confidence |
| **Blocks** | First commit of source code (must decide language first) |
| **Ordering Note** | Must be in place before any client code is written |

## Context

### Problem Statement

Vanilla JavaScript is faster to start with but offers no compile-time type checking. With **22 systems** to design and ship in 23 days, type errors at runtime would be a constant tax. Refactoring without types in a multi-system codebase is dangerous. Shared types between client and server (especially Colyseus state schemas) are critical for correctness.

### Current State

Greenfield. ADR-0001 originally implied vanilla JS for the client (because "no bundler"). This ADR resolves that ambiguity in favor of TypeScript.

### Constraints

- ADR-0001 prohibits Webpack/Vite/Rollup-style **bundling** for the client
- Vercel deploy can run a build command (this is normal for static sites)
- Output must be ES modules importable via the importmap
- Output `.js` files must be 1:1 with source `.ts` files (no concatenation, no chunking)

### Requirements

- Client and server both use TypeScript
- Type-safe Colyseus schemas shared between client and server
- Source files are `.ts`; output files are `.js`
- The output is **not** a bundle — it's a directory of plain ES module files
- Vercel deploy command transpiles the client at deploy time

## Decision

Use TypeScript on both server and client. Configure two separate `tsconfig.json` files. Server compiles normally. Client uses `tsc --module esnext --target esnext --outDir public/src` as a deploy-time transpile-only step that produces 1:1 ES module outputs. This is **not** bundling — it is per-file type-stripping.

### Architecture

```
Source (committed):                          Vercel deploy:                  Browser:
                                                                              
client/                                      tsc --project                   GET /index.html
└── src/                                     tsconfig.client.json            GET /src/main.js
    ├── main.ts                              ───────────────────▶            (relative imports
    ├── engine/                                                               resolved by browser
    │   ├── scene.ts                         output:                          via importmap)
    │   └── physics.ts                       public/src/
    ├── gameplay/                            ├── main.js            ◀────── importmap maps
    │   └── player.ts                        ├── engine/                     bare specifiers like
    └── ui/                                  │   ├── scene.js                "three" → CDN URL
        └── hud.ts                           │   └── physics.js
                                             ├── gameplay/
server/                                      │   └── player.js
├── index.ts                                 └── ui/
├── rooms/                                       └── hud.js
│   └── DungeonRoom.ts
└── ...                                      (1:1 file mapping; no bundling, 
                                              no chunking, no concatenation)
                                                                              
shared/                                      Server: standard tsc build      Server: Node.js
└── schemas/                                 to dist/, run with node          loads dist/index.js
    ├── GameState.ts
    ├── Player.ts                            ◀── shared/schemas/ imported by both
    └── Enemy.ts                                  client and server (typed!)
```

### Key Interfaces

```jsonc
// tsconfig.client.json (deploy-time client transpile)
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",   // allows bare specifiers (resolved by importmap at runtime)
    "outDir": "public/src",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,         // ensures per-file transpilable
    "noEmitOnError": false,          // jam tolerance: warnings don't block deploy
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*", "shared/**/*"]
}
```

```jsonc
// tsconfig.server.json (Node.js server build)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Node",
    "outDir": "dist",
    "rootDir": "server",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["server/**/*", "shared/**/*"]
}
```

```html
<!-- index.html — importmap targets the TRANSPILED client output -->
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.174.0",
    "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.14.0",
    "@colyseus/sdk": "https://esm.sh/@colyseus/sdk@0.15.0"
  }
}
</script>
<script type="module" src="/src/main.js"></script>
<!-- /src/main.js was transpiled from src/main.ts at deploy time -->
```

### Implementation Guidelines

- **Source extension is always `.ts`** for new code on both client and server
- **Local imports use `.js` extension** in TypeScript source: `import { foo } from './engine/scene.js'` — this is the TS recommendation for ES module output
- Bare specifiers like `import * as THREE from 'three'` resolve via the importmap at runtime, not at build time. The `tsconfig.client.json` `moduleResolution: "Bundler"` lets `tsc` accept these without error.
- **Shared types** (especially Colyseus Schemas) live in `shared/schemas/` and are imported by both `client/src/` and `server/`. This is the key win of TypeScript everywhere.
- Vercel build command: `tsc -p tsconfig.client.json && cp -r public/* .vercel/output/static/`
- `dist/` and `public/src/` are gitignored (build outputs, not committed)
- Strict mode is on. `noEmitOnError: false` allows deploys when there are warnings (jam tolerance) but **fix them**

## Alternatives Considered

### Alternative 1: Vanilla JS only (no TypeScript)

- **Description**: Skip TypeScript entirely
- **Pros**: Zero tooling
- **Cons**: No type safety; refactor terror; no shared types between client/server
- **Estimated Effort**: Lowest start
- **Rejection Reason**: 22 systems × no types = constant runtime bugs; jam time better spent on features than type-related debugging

### Alternative 2: Vite + TypeScript (full bundler)

- **Description**: Use Vite for client; full TS support
- **Pros**: Best DX
- **Cons**: Bundling violates ADR-0001
- **Estimated Effort**: Higher setup
- **Rejection Reason**: ADR-0001 prohibits bundlers; Vite is a bundler regardless of how light its output is

### Alternative 3: JSDoc-typed JavaScript

- **Description**: Plain `.js` files with JSDoc annotations checked by `tsc --checkJs`
- **Pros**: No build step; types in IDE
- **Cons**: Verbose; less ergonomic; missing TS features (generics, enums)
- **Estimated Effort**: Lower
- **Rejection Reason**: For 22 systems, real TypeScript is worth the small build step

### Alternative 4: Deno runtime (TS native)

- **Description**: Use Deno on server; TS runs natively
- **Pros**: No transpile step on server
- **Cons**: Server hosting on Railway is Node.js focused; Deno is a learning curve
- **Estimated Effort**: Higher
- **Rejection Reason**: Node.js + tsc is the path of least resistance for jam

## Consequences

### Positive

- Type safety end-to-end
- Refactor confidence (rename a field across 50 files in seconds)
- **Shared Colyseus Schema types** between client and server (huge win)
- IDE autocomplete and inline errors
- Output is still plain ES modules (jam load rule preserved)

### Negative

- Small build step at Vercel deploy time (~5-15 sec for jam-sized codebase)
- Slight nuance to ADR-0001: "no bundler" now means "no module bundling" (per-file transpile is allowed)
- Two `tsconfig.json` files to maintain
- Source files in `src/`, output files in `public/src/` — slight mental overhead

### Neutral

- `.gitignore` adds `dist/` and `public/src/`
- Vercel `vercel.json` declares the build command
- Local dev: `tsc --watch` produces the same `public/src/` output for testing locally

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `tsc` build fails on Vercel deploy due to TS error | Medium | Medium | `noEmitOnError: false` so deploys land; fix warnings post-deploy |
| Local dev workflow gets confusing (source vs output paths) | Medium | Low | Document in README; use `tsc --watch` |
| Type errors slow down jam pace | Medium | Medium | `// @ts-expect-error` is allowed for jam pragmatism; lint warnings only |
| Shared schema types diverge between client and server runtimes | Low | High | One source of truth in `shared/schemas/`; both tsconfigs include it |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| Vercel build time | 0s | 5-15s | < 60s |
| Runtime client load | identical | identical | n/a |
| Runtime server | identical | identical | n/a |

## Migration Plan

N/A — greenfield. All code is `.ts` from day 1.

**Rollback plan**: If `tsc` deploy step proves unworkable, we fall back to plain JavaScript by deleting tsconfig and renaming `.ts` files to `.js`. Estimated cost: half a day. We supersede this ADR.

## Validation Criteria

- [ ] `tsconfig.client.json` and `tsconfig.server.json` both exist and pass `tsc --noEmit`
- [ ] Vercel deploy successfully runs `tsc -p tsconfig.client.json` and serves `public/src/` files
- [ ] A shared Colyseus Schema type is imported and used by both client and server code
- [ ] Output `public/src/` contains 1:1 file mapping from source `src/`
- [ ] No `webpack`, `vite`, `rollup`, `parcel`, `esbuild` (as bundler) in `package.json`

## GDD Requirements Addressed

Foundational — no GDD requirement. Enables: type-safe implementation of every system in `design/gdd/systems-index.md`. Particularly critical for In-Room Sync (Colyseus schemas shared between client and server).

## Related

- ADR-0001 (no bundler) — this ADR refines that rule by clarifying that per-file transpile is allowed
- ADR-0002 (Colyseus) — biggest beneficiary of shared schema types
- docs/engine-reference/colyseus/COLYSEUS-0.15.md → schema patterns are TS-first

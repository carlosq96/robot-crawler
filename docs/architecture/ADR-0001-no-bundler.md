# ADR-0001: No bundler — CDN importmap only

## Status

Accepted

## Date

2026-04-08

## Last Verified

2026-04-08

## Decision Makers

Carlos (project lead, solo jam)

## Summary

Vibe Jam 2026 requires instant load with no build-step delays. We use a `<script type="importmap">` resolving to esm.sh CDN URLs for all client dependencies; **no Vite, Webpack, Parcel, Rollup, or any module bundler**. Per-file TypeScript transpilation (ADR-0008) is allowed because it is not bundling.

## Engine Compatibility

| Field | Value |
|---|---|
| **Engine** | Three.js r174 (web, no traditional engine) |
| **Domain** | Core / Build pipeline |
| **Knowledge Risk** | LOW — well-established pattern |
| **References Consulted** | docs/engine-reference/threejs/VERSION.md |
| **Post-Cutoff APIs Used** | None |
| **Verification Required** | Verify esm.sh availability + Three.js r174 ESM build URL works |

## ADR Dependencies

| Field | Value |
|---|---|
| **Depends On** | None (foundational) |
| **Enables** | ADR-0008 (TypeScript w/ deploy-time transpile), every client system |
| **Blocks** | Nothing — implementable from day 1 |
| **Ordering Note** | Must be in place before any client code is written |

## Context

### Problem Statement

Vibe Jam 2026 requires the game to load instantly — no spinners, no progress bars, no heavy downloads on first paint. Bundlers introduce a build step, slow first paint via large bundle files, and add toolchain complexity. For a solo jam project, build configuration is overhead we cannot afford.

### Current State

Greenfield project; no existing build pipeline.

### Constraints

- Vibe Jam rule: must load instantly, no loading screens
- Solo developer: minimize toolchain complexity
- Total client asset budget under 10 MB
- Vercel static hosting (no server-side bundling)

### Requirements

- Client code loads via plain `<script type="module">` from index.html
- Third-party dependencies (Three.js, Rapier, Colyseus) load via CDN URLs in an importmap
- Zero build step OR a per-file transpile step that produces 1:1 ES modules (no bundling)
- First paint < 2 seconds on a 50 Mbps connection

## Decision

Client uses an ES module importmap pointing at esm.sh CDN URLs for all third-party packages. Each local source file is its own ES module loaded relatively. No bundler, no module concatenation, no tree-shaking, no chunking.

### Architecture

```
index.html
├── <script type="importmap">
│     "three": "https://esm.sh/three@0.174.0"
│     "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.14.0"
│     "@colyseus/sdk": "https://esm.sh/@colyseus/sdk@0.15.0"
└── <script type="module" src="src/main.js">
        │
        ├── import { Scene } from 'three'           ← resolved via importmap → CDN
        ├── import RAPIER from '@dimforge/...'      ← resolved via importmap → CDN
        ├── import { initScene } from './engine/scene.js'  ← relative, served by Vercel
        └── import { Player } from './gameplay/player.js'  ← relative, served by Vercel
```

### Key Interfaces

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.174.0",
    "three/addons/": "https://esm.sh/three@0.174.0/examples/jsm/",
    "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.14.0",
    "@colyseus/sdk": "https://esm.sh/@colyseus/sdk@0.15.0"
  }
}
</script>
<script type="module" src="src/main.js"></script>
```

### Implementation Guidelines

- **Never** add `vite`, `webpack`, `parcel`, `rollup`, `esbuild` (as bundler), or any other bundler to the client
- All third-party deps go through esm.sh, never npm install on client
- Local files use relative imports: `import { foo } from './engine/scene.js'`
- ADR-0008 (TypeScript) is the **only** allowed compilation step, and it must be configured as transpile-only (no bundling, 1:1 file output)
- Server-side (Node.js) is exempt — server can use any tooling

## Alternatives Considered

### Alternative 1: Vite

- **Description**: Modern bundler with fast HMR and dev server
- **Pros**: Best DX, hot reload, optimal output
- **Cons**: Build step delays, source ≠ production, jam-rule risk
- **Estimated Effort**: Lower per-file but more setup
- **Rejection Reason**: Bundling adds latency between save and play; jam load requirement is "instant" and bundler output is not zero-latency

### Alternative 2: Esbuild as bundler

- **Description**: Faster bundler than Vite
- **Pros**: Very fast builds
- **Cons**: Still bundles; same jam-rule concern
- **Estimated Effort**: Medium
- **Rejection Reason**: Bundling = same problem as Vite

### Alternative 3: Plain JavaScript with no compilation at all

- **Description**: Skip TypeScript entirely, write vanilla JS that runs as-is
- **Pros**: Zero tooling
- **Cons**: No type safety
- **Estimated Effort**: Lowest
- **Rejection Reason**: Type safety is worth a per-file transpile step (see ADR-0008)

## Consequences

### Positive

- Zero bundling time at deploy
- Source files map 1:1 to served files (easy debugging, no source maps required)
- Vercel deploys are basically file copies
- Jam-rule compliant: instant first paint
- Easy to grok project structure (no abstract bundler config)

### Negative

- No tree-shaking — every imported symbol travels
- No minification — source-style files served (slightly larger over the wire)
- No code splitting — main.js loads all referenced modules
- Cannot use packages that require bundler-only features (CSS imports, asset URLs as imports)

### Neutral

- Forced ES modules at file granularity (good practice anyway)
- Importmap is a standard, well-supported feature in all evergreen browsers

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| esm.sh outage during deploy or playtest | Low | High | Pin exact versions; have a fallback CDN (unpkg) ready in importmap |
| Browser doesn't support importmap | Very Low | High | Modern browsers (Chrome 89+, Firefox 108+, Safari 16.4+) all support; document target browsers |
| Total wire size grows past 10 MB without minification | Low | Medium | Audit before submission; remove unused code manually |

## Performance Implications

| Metric | Before | Expected After | Budget |
|---|---|---|---|
| First paint | N/A | ~1.5-2s on 50 Mbps | < 3s |
| Build time at deploy | N/A | 0s (no bundling) | n/a |
| Total wire size (compressed) | N/A | ~3-5 MB code + ~10 MB assets | 15 MB |

## Migration Plan

N/A — greenfield.

**Rollback plan**: If we discover a hard requirement for bundling (unlikely), we adopt Vite and supersede this ADR with ADR-XXXX. The migration would involve adding a vite.config and changing the Vercel build command. Estimated cost: ~half a day.

## Validation Criteria

- [ ] index.html contains a working importmap pointing at esm.sh URLs
- [ ] First paint measured < 2 seconds on 50 Mbps from Vercel
- [ ] No `node_modules/` in the deployed output
- [ ] No bundler config files (`vite.config.*`, `webpack.config.*`) in repo
- [ ] DevTools Network tab shows source-style `.js` files, not bundled chunks

## GDD Requirements Addressed

Foundational — no GDD requirement. Enables: every client-side system in `design/gdd/systems-index.md`.

## Related

- ADR-0008 (TypeScript with deploy-time transpile) — refines this ADR; allows per-file TS→JS transpile while keeping the no-bundler rule
- ADR-0005 (Draco compression) — complementary; both target jam load budget

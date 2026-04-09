# Technical Stack Document — Robot Crawler

## Client (Browser Game)
- Three.js r174 via CDN importmap — renderer
- @dimforge/rapier3d-compat — physics
- @colyseus/sdk — multiplayer client
- GLTFLoader + DRACOLoader — load Meshy AI GLB assets
- TypeScript ^5 source, per-file `tsc` transpile to ES modules at Vercel deploy time (NOT bundled — see ADR-0001 + ADR-0008)
- No framework (no React/Vue/Svelte), no bundler

## Server (Colyseus)
- Node.js 20+
- colyseus ^0.15
- @colyseus/schema — binary state sync
- express — HTTP seed/leaderboard routes
- pg — Postgres client library
- TypeScript

## Asset Production
- Meshy AI → Text-to-3D / Image-to-3D → export GLB
- Target: each model under 2MB with Draco compression
- PBR maps: base color, roughness, metallic, normal

## Data
- Railway Postgres (same Railway project as Colyseus server)
- Tables: players, seeds, scores
- Auto-injected DATABASE_URL — no separate account required

## Deployment
- Vercel (frontend) — auto-deploy on push to main
- Railway (server) — free 500hr/month, Node.js buildpack
- Railway Postgres (persistence) — managed, same project as server

## Key Architecture Decisions

All ten ADRs are formally documented in `docs/architecture/` and **Accepted** as of 2026-04-08:

- **ADR-0001** — No bundler (CDN importmap only) — jam instant-load compliance
- **ADR-0002** — Colyseus over SpacetimeDB / WebRTC — TypeScript end-to-end, fits dungeon room model
- **ADR-0003** — Railway Postgres over Supabase — same platform as server, one DATABASE_URL
- **ADR-0004** — Server-authoritative combat — prevents cheating, simpler sync
- **ADR-0005** — Draco compression mandatory on all GLBs — total asset load under 10MB
- **ADR-0006** — Postgres write only on `onDispose` — clean atomic transaction per run
- **ADR-0007** — Fixed Rapier timestep (1/60) — deterministic physics for multiplayer + seeded dungeons
- **ADR-0008** — TypeScript everywhere with deploy-time per-file transpile — type safety without bundling
- **ADR-0009** — Three.js WebGLRenderer over WebGPURenderer — Firefox/Safari support for jam audience
- **ADR-0010** — Meshy AI as primary 3D asset pipeline — only viable solo art workflow for 23-day jam

Other supporting facts:
- Shared procedural seed — same seed = same dungeon for all players and leaderboard
- Postgres over SQLite — SQLite cannot handle concurrent multiplayer writes

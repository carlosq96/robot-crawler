# Technical Stack Document — Robot Crawler

## Client (Browser Game)
- Three.js r174 via CDN importmap — renderer
- @dimforge/rapier3d-compat — physics
- @colyseus/sdk — multiplayer client
- GLTFLoader + DRACOLoader — load Meshy AI GLB assets
- Vanilla JS ES modules — no framework, no bundler

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
- No bundler (Vite etc) — CDN only for jam instant-load compliance
- Server-authoritative combat (Colyseus) — prevents cheating, sync is clean
- Shared procedural seed — same seed = same dungeon for all players and leaderboard
- Draco compression mandatory on all GLBs — keep total asset load under 10MB
- Railway Postgres over Supabase — same platform, one DATABASE_URL, no extra account
- Postgres over SQLite — SQLite cannot handle concurrent multiplayer writes
- Write to Postgres only on run resolution (clear/fail) — clean atomic transaction
  in Colyseus `onDispose()`, never mid-dungeon

# Claude Code Game Studios — Robot Crawler
## Vibe Jam 2026 Entry

## JAM CONSTRAINTS (NON-NEGOTIABLE)
- Deadline: May 1 2026 @ 13:37 UTC
- Must load instantly — no loading screens, no heavy downloads
- Web-based, free-to-play, no login required (username only)
- 90%+ AI-written code — we are using Claude Code Game Studios
- New game created after March 24 2026

## GAME CONCEPT
Megaman Legends-inspired 3D dungeon crawler.
Ship hub → select/generate dungeon → drop in solo or co-op (up to 3 players) →
shoot enemies with buster + sub-weapons → collect crystals → return to ship → upgrade.
Procedural dungeons with shareable seeds and per-seed leaderboards.

## FOUNDATIONAL DOCUMENTS
- Game Design Document: @design/game-design-document.md
- Technical Design Document: @design/tech-stack.md
- Architecture Map: @docs/architecture.md

## TECH STACK
- Renderer: Three.js r174 (CDN importmap, no bundler)
- Physics: @dimforge/rapier3d-compat (WASM)
- Multiplayer: Colyseus 0.15 (authoritative server, self-hosted on Railway)
- Persistence: Railway Postgres via pg (same Railway project as server)
- Assets: Meshy AI → GLB → Three.js GLTFLoader + DRACOLoader
- Frontend deploy: Vercel (auto-deploy from GitHub main)
- Server deploy: Railway Node.js buildpack
- Language: TypeScript everywhere (server + client). Client is per-file `tsc` transpiled at Vercel deploy time — NOT bundled. Output is plain ES modules consumed via importmap. See ADR-0001 + ADR-0008.

## LAYER OWNERSHIP
- Colyseus → all realtime during sessions (positions, combat, loot, revival)
- Postgres → all persistence between sessions (seeds, scores, crystals, level)
- Rapier   → all physics (movement, collision, projectiles)
- Three.js → rendering only, no game logic

## STUDIO AGENTS IN USE
Engine: Three.js web (no Godot/Unity/Unreal agents — use web-specialist workflows)
Active agent set: game-designer, lead-programmer, gameplay-programmer,
network-programmer, ui-programmer, performance-analyst, qa-tester

## COLLABORATION PROTOCOL
Every task: Question → Options → Decision → Draft → Approval
Agents MUST ask before writing to any file.
No autonomous commits.

## CODING STANDARDS
@.claude/docs/coding-standards.md

## CONTEXT MANAGEMENT
@.claude/docs/context-management.md

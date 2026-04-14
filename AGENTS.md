# Codex Game Studios — Space Runner
## Vibe Jam 2026 Entry

> **Public title:** Space Runner
> **Internal repo name:** `robot-crawler` (not renamed — affects GitHub, Vercel, Railway deploy URLs)
> **Pivoted from:** Robot Crawler (MML-style co-op dungeon crawler) on 2026-04-09. See `design/archive/mml-dungeon-crawler/` for the superseded plan.

## JAM CONSTRAINTS (NON-NEGOTIABLE)
- Deadline: May 1 2026 @ 13:37 UTC
- Must load instantly — no loading screens, no heavy downloads
- Web-based, free-to-play, no login required (username only)
- 90%+ AI-written code — we are using Codex Game Studios
- New game created after March 24 2026

## GAME CONCEPT
Solo 3D endless runner in space.
Title → drop onto a hostile planet → auto-run forward → dodge / jump / slide
past hazards → reach the jump-gate → warp to the next (harder) planet → repeat
until HP hits 0 → leaderboard.
Three biomes (Rocky, Ice, Volcanic) recycled with rising difficulty.
One combat verb: Super Suit attack on cooldown (breaks obstacles, one-shots enemies).
Inspirations: Pepsi Man, Temple Run, Subway Surfers.

## FOUNDATIONAL DOCUMENTS (read on-demand, NOT auto-loaded)
- Game Concept: design/gdd/game-concept.md
- Systems Index: design/gdd/systems-index.md
- Technical Design Document: design/tech-stack.md
- Architecture Map: docs/architecture.md
Read these files when working on related systems. Do NOT reference with @ to avoid bloating every message.

## TECH STACK
- Renderer: Three.js r174 (CDN importmap, no bundler)
- Physics: rapier3d-compat (WASM, @dimforge/rapier3d-compat)
- Persistence: Railway Postgres via pg — single `runs` table for global leaderboard
- Assets: Meshy AI → GLB → Three.js GLTFLoader + DRACOLoader
- Frontend deploy: Vercel (auto-deploy from GitHub main)
- Server deploy: Railway Node.js buildpack (Express only, no Colyseus)
- Language: TypeScript everywhere (server + client). Client is per-file `tsc` transpiled at Vercel deploy time — NOT bundled. Output is plain ES modules consumed via importmap. See ADR-0001 + ADR-0008.
- **Dropped in pivot:** Colyseus (no multiplayer), colyseus/schema, server-authoritative combat. See Superseded ADR-0002 and ADR-0004.

## LAYER OWNERSHIP
- Postgres → leaderboard persistence (one write per run-end POST)
- Rapier   → all physics (movement, collision, hazard detection)
- Three.js → rendering only, no game logic
- Express  → HTTP leaderboard endpoints only (no realtime sockets)

## STUDIO AGENTS IN USE
Engine: Three.js web (no Godot/Unity/Unreal agents — use web-specialist workflows)
Active agent set: game-designer, lead-programmer, gameplay-programmer,
ui-programmer, performance-analyst, qa-tester
(network-programmer removed from active set after the pivot — no netcode)

## COLLABORATION PROTOCOL
Every task: Question → Options → Decision → Draft → Approval
Agents MUST ask before writing to any file.
No autonomous commits.

## CODING STANDARDS (read .Codex/docs/coding-standards.md when writing code)
- Doc comments on public APIs
- Gameplay values in config, never hardcoded
- Public methods must be unit-testable (DI over singletons)
- Verification-driven: tests first for gameplay, screenshots for UI
- Design docs: 8 required sections (Overview, Player Fantasy, Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs, Acceptance Criteria)

## CONTEXT MANAGEMENT (read .Codex/docs/context-management.md for full protocol)
- File is the memory, not the conversation
- Maintain production/session-state/active.md as living checkpoint
- Compact proactively at ~60-70% context usage
- Use subagents for research to keep main context clean
- Use /clear between unrelated tasks

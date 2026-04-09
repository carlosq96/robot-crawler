# Robot Crawler

A Megaman Legends-inspired 3D dungeon crawler. Built for **[Vibe Jam 2026](https://jam.pieter.com/)** — deadline May 1 2026.

Ship hub → pick a dungeon seed → solo or co-op (up to 3 players) → shoot enemies with buster + sub-weapons → collect crystals → return to ship → upgrade. Procedural dungeons with shareable seeds and per-seed leaderboards.

## Tech

- **Renderer:** Three.js r174 (CDN importmap, no bundler)
- **Physics:** Rapier3D (WASM)
- **Multiplayer:** Colyseus 0.15 (authoritative server)
- **Persistence:** Railway Postgres
- **Deploy:** Vercel (client) + Railway (server)

## Status

Pre-production. GDD and architecture in progress. Code not yet written.

## Credits

Built with [Claude Code Game Studios](https://github.com/Donchitos/claude-code-game-studios) — an AI game studio template (MIT). See `LICENSE` for attribution.

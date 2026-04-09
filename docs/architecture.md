# Architecture Map — Robot Crawler
## Updated: [DATE EACH SESSION]

### Client (TypeScript source — transpiled to `public/src/*.js` at deploy time per ADR-0008)
| File | Purpose |
|---|---|
| index.html | Entry point, importmap CDN config, loads `/src/main.js` (transpile output) |
| src/main.ts | Boot: init Three.js scene, Rapier, Colyseus client |
| src/engine/scene.ts | Three.js scene setup, renderer, camera |
| src/engine/physics.ts | Rapier world init, body registry |
| src/engine/loaders.ts | GLTFLoader + DRACOLoader configured for Draco-compressed GLBs |
| src/engine/animation-controller.ts | Reusable AnimationMixer wrapper (state machine, crossfade, events) |
| src/engine/audio.ts | Audio System: SFX bus + music bus + Web Audio API |
| src/gameplay/player.ts | Player entity: mesh, physics body, state machine |
| src/gameplay/movement.ts | WASD locomotion, aim direction |
| src/gameplay/dungeon.ts | Procedural room generation from seed |
| src/gameplay/enemies.ts | Enemy spawning, AI, state machine, drops |
| src/gameplay/pickups.ts | Crystal + material pickups, walk-over collection |
| src/gameplay/run-lifecycle.ts | Pure state machine: lobby → exploring → boss → cleared/failed |
| src/combat/buster.ts | Buster cannon with charge state machine + auto-lock-on |
| src/combat/subweapon.ts | Sub-weapon system: 4-weapon database, ammo, crafting |
| src/ui/hud.ts | HP, ammo, crystals, lock-on indicator, minimap |
| src/ui/hub.ts | Ship cockpit UI: upgrades, seed picker, co-op terminal |
| src/ui/results.ts | Run results screen: score, leaderboard rank, share seed |
| src/ui/tutorial.ts | Tutorial overlays: contextual hints, dismissible |
| src/ui/settings.ts | Minimal settings: volume, mouse sensitivity (localStorage) |
| src/networking/client.ts | Colyseus room join/create/state sync |
| src/networking/lobby.ts | Lobby: host create, join via code, join random |

### Server
| File | Purpose |
|---|---|
| server/index.ts | Colyseus app entry, Express routes, Postgres pool init |
| server/rooms/DungeonRoom.ts | Main game room: up to 3 players, owns Rapier world, calls RunLifecycle.tick(), writes to Postgres on `onDispose()` per ADR-0006 |
| server/routes/seeds.ts | POST/GET dungeon seeds (Postgres) |
| server/routes/scores.ts | POST/GET leaderboard (Postgres) |
| server/db/pool.ts | Postgres connection pool (pg) — singleton |
| server/db/schema.sql | One-shot SQL: `players`, `seeds`, `scores` tables |

### Shared (imported by both client and server — TypeScript only)
| File | Purpose |
|---|---|
| shared/schemas/GameState.ts | Top-level Colyseus state schema |
| shared/schemas/Player.ts | Per-player state schema |
| shared/schemas/Enemy.ts | Per-enemy state schema |

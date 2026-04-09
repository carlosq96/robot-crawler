# Architecture Map — Robot Crawler
## Updated: [DATE EACH SESSION]

### Client
| File | Purpose |
|---|---|
| index.html | Entry point, importmap CDN config |
| src/main.js | Boot: init Three.js scene, Rapier, Colyseus client |
| src/engine/scene.js | Three.js scene setup, renderer, camera |
| src/engine/physics.js | Rapier world init, body registry |
| src/gameplay/player.js | Player entity: mesh, physics body, input |
| src/gameplay/dungeon.js | Procedural room generation from seed |
| src/gameplay/enemies.js | Enemy spawning, AI, state |
| src/combat/buster.js | Primary weapon: energy-based infinite shoot |
| src/combat/subweapon.js | Sub-weapon system: resource-based |
| src/combat/lockon.js | Auto-lock-on with aim bias |
| src/ui/hud.js | Minimap, HP, ammo, crystal count |
| src/ui/hub.js | Ship cockpit UI |
| src/networking/client.js | Colyseus room join/create/state sync |

### Server
| File | Purpose |
|---|---|
| server/index.ts | Colyseus app entry, Express routes, Postgres pool init |
| server/rooms/DungeonRoom.ts | Main game room: up to 3 players |
| server/schemas/GameState.ts | Shared state: players, enemies, loot |
| server/routes/seeds.ts | POST/GET dungeon seeds (Postgres) |
| server/routes/scores.ts | POST/GET leaderboard (Postgres) |
| server/db/pool.ts | Postgres connection pool (pg) |

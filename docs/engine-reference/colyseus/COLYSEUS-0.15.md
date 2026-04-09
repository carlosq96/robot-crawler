# Colyseus — Version Reference

| Field | Value |
|-------|-------|
| **Server library** | `colyseus` ^0.15 |
| **Client SDK** | `@colyseus/sdk` ^0.15 |
| **Schema library** | `@colyseus/schema` ^2.x (paired with Colyseus 0.15) |
| **Project Pinned** | 2026-04-08 |
| **LLM Knowledge Cutoff** | May 2025 |

## Why Colyseus (and not SpacetimeDB / Geckos / WebRTC raw)

- TypeScript everywhere (matches our server stack)
- Room model fits dungeon sessions perfectly (1 room per dungeon, 1-3 players)
- Built-in binary delta sync via `@colyseus/schema`
- Active maintenance, mature, used in production games
- Self-host on Railway free tier; no vendor lock-in

## Server Architecture

```
server/
├── index.ts              # Colyseus app + Express routes + Postgres pool init
├── rooms/
│   └── DungeonRoom.ts    # Room class — gameplay loop, message handlers
├── schemas/
│   ├── GameState.ts      # Top-level synced state
│   ├── Player.ts         # Per-player state
│   └── Enemy.ts          # Per-enemy state
├── routes/
│   ├── seeds.ts          # POST/GET /seeds (Postgres)
│   └── scores.ts         # POST/GET /scores (Postgres)
└── db/
    └── pool.ts           # pg connection pool, exported singleton
```

## Schema Definitions

```ts
// schemas/Player.ts
import { Schema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") username: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 0;
  @type("number") hp: number = 100;
  @type("number") maxHp: number = 100;
  @type("boolean") downed: boolean = false;
  @type("number") revivals: number = 0;
  @type("number") crystals: number = 0;
  @type("string") lockedTarget: string = ""; // enemy id or empty
}
```

```ts
// schemas/GameState.ts
import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "./Player";
import { Enemy } from "./Enemy";

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Enemy }) enemies = new MapSchema<Enemy>();
  @type("string") phase: string = "exploring"; // "exploring" | "boss" | "cleared" | "failed"
  @type("number") elapsed: number = 0;
  @type("string") seed: string = "";
  @type("number") crystalPool: number = 0;
}
```

## Room Lifecycle

```ts
// rooms/DungeonRoom.ts
import { Room, Client } from "colyseus";
import { GameState } from "../schemas/GameState";
import { Player } from "../schemas/Player";
import { pool } from "../db/pool";

export class DungeonRoom extends Room<GameState> {
  maxClients = 3;
  
  async onCreate(options: { seed: string }) {
    this.setState(new GameState());
    this.state.seed = options.seed;
    
    // Server-authoritative tick (Rapier physics + AI here)
    this.setSimulationInterval((deltaMs) => this.tick(deltaMs / 1000), 1000 / 30);
    
    // Message handlers
    this.onMessage("move", (client, msg) => this.handleMove(client, msg));
    this.onMessage("shoot", (client, msg) => this.handleShoot(client, msg));
    this.onMessage("revive", (client, msg) => this.handleRevive(client, msg));
  }
  
  onJoin(client: Client, options: { username: string }) {
    const player = new Player();
    player.username = options.username;
    this.state.players.set(client.sessionId, player);
  }
  
  onLeave(client: Client) {
    // Don't delete — let the run continue with disconnected player frozen
    // (or delete if all-down detection runs server-side)
  }
  
  async onDispose() {
    // CRITICAL: this is the ONLY time we write to Postgres
    // Atomic transaction: save scores, update player crystals/journey level
    const cleared = this.state.phase === "cleared";
    await this.persistRunResults(cleared);
  }
  
  private tick(dt: number) {
    // Step Rapier world here
    // Run enemy AI
    // Update this.state.elapsed
    // Detect win/lose conditions
  }
}
```

## Client SDK

```js
// src/networking/client.js
import { Client } from "@colyseus/sdk";

const client = new Client("wss://robot-crawler-server.up.railway.app");

const room = await client.joinOrCreate("dungeon", {
  seed: "abc123",
  username: "player1",
});

// Listen for state changes (binary deltas, very efficient)
room.state.players.onAdd((player, sessionId) => {
  // Spawn player mesh in Three.js scene
});

room.state.players.onChange((player, sessionId) => {
  // Update mesh position, hp bar, etc.
});

room.state.players.onRemove((player, sessionId) => {
  // Despawn mesh
});

// Send messages to server
room.send("move", { x: 1, z: 0 });
room.send("shoot", { dirX, dirY, dirZ });
```

## Key Patterns for Robot Crawler

### Server-authoritative combat
Client sends "shoot" intent. Server validates (cooldown, ammo), runs the
raycast against the server-side Rapier world, applies damage, broadcasts
the hit. Client gets the result and plays VFX.

### Persistence on dispose only
Only `onDispose()` writes to Postgres. Mid-run state lives in `this.state`
(synced via Colyseus). On clear/fail/timeout, we serialize the final result
into one transaction. Never write per-frame or per-action.

### Crystal split
Crystals are world objects in `this.state` until run end. On `onDispose()`
with `cleared === true`, divide `crystalPool` by player count, write to each
player's row in `players` table.

### Disconnect handling
By default, Colyseus calls `onLeave` immediately on disconnect. We may want
`allowReconnection()` for grace period — but for jam, simpler to freeze the
disconnected player and let the rest finish.

## Footguns

1. **Mutating arrays/maps without `MapSchema.set()`** — use `state.players.set(id, p)`, not `state.players[id] = p`
2. **Storing non-Schema fields in Schema** — won't sync; will appear undefined on client
3. **Sending high-frequency messages** — use `setSimulationInterval` server-side; clients should send intents at ~20-30Hz max
4. **Forgetting `room.leave()` on client unload** — server takes longer to detect disconnect
5. **Heavy `onMessage` handlers** — they block the room's tick; offload to async or queue
6. **No backpressure on Postgres** — `onDispose` connects fresh; if pool exhausted under load, persistence fails silently. Always wrap in try/catch and log
7. **MapSchema iteration** — use `.forEach((value, key) => ...)`, not `for...of` (the iterator behavior changed in newer schema versions)

## Sources

- Official docs: https://docs.colyseus.io/
- Schema docs: https://docs.colyseus.io/state/schema/
- Client SDK docs: https://docs.colyseus.io/getting-started/javascript-client/
- GitHub: https://github.com/colyseus/colyseus
- Railway template: https://railway.app/template/colyseus (if it exists; otherwise standard Node buildpack)

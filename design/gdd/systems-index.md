# Systems Index: Robot Crawler

> **Status**: Approved
> **Created**: 2026-04-08
> **Last Updated**: 2026-04-08
> **Source Concept**: design/gdd/game-concept.md
> **Review Mode**: Solo (jam project)

---

## Overview

Robot Crawler is a Megaman Legends-inspired 3D dungeon crawler built for Vibe
Jam 2026. The game decomposes into **22 systems across 6 categories**, organized
into **7 dependency layers** (L0-L6). The mechanical scope is intentionally
focused on three pillars: crunchy buster combat, score-driven runs, and pure
cooperative co-op. Every system in this index serves at least one pillar.

The decomposition uses a **3-tier jam-pragmatic priority schema** (T1 Must Ship,
T2 Ship If Time, T3 Cut Order) instead of the standard CCGS 4-tier MVP/VS/Alpha/
Full Vision schema, because everything in this list is already MVP-scoped — the
meaningful axis at jam scale is what we cut first when time runs out.

---

## Systems Enumeration

| # | System Name | Category | Priority | Layer | Status | Design Doc | Depends On |
|---|---|---|---|---|---|---|---|
| 1 | Engine Bootstrap | Core | T1 | L0 | Implemented | design/quick-specs/engine-bootstrap-2026-04-08.md | — |
| 2 | Input Manager | Core | T1 | L0 | Implemented | design/quick-specs/input-manager-2026-04-08.md | — |
| 3 | Persistence Layer | Persistence | T1 | L0 | Not Started | — | — |
| 4 | Camera Rig | Core | T1 | L1 | Approved | design/quick-specs/camera-rig-2026-04-08.md | Engine Bootstrap |
| 5 | Animation Controller | Core | T1 | L1 | Approved | design/quick-specs/animation-controller-2026-04-08.md | Engine Bootstrap |
| 6 | Audio System | Audio | T1 | L1 | Not Started | — | Engine Bootstrap |
| 7 | Lobby System | Multiplayer | T1 | L1 | Not Started | — | Engine Bootstrap, Persistence Layer |
| 8 | Player System | Gameplay | T1 | L2 | Approved | design/quick-specs/player-system-2026-04-09.md | Engine Bootstrap, Input Manager, Animation Controller, Camera Rig |
| 9 | Settings (inferred) | Meta | T2 | L2 | Not Started | — | Engine Bootstrap, Audio System |
| 10 | Movement | Gameplay | T1 | L3 | Approved | design/quick-specs/movement-2026-04-09.md | Player System, Input Manager |
| 11 | Enemy System | Gameplay | T1 | L3 | Not Started | — | Engine Bootstrap, Animation Controller, Audio System |
| 12 | Pickup System | Gameplay | T1 | L3 | Not Started | — | Engine Bootstrap, Player System, Audio System |
| 13 | Buster Combat (incl. Lock-On) | Gameplay | T1 | L4 | Not Started | — | Player System, Input Manager, Enemy System, Audio System, Animation Controller, Pickup System |
| 14 | Sub-Weapon System | Gameplay | T2 | L4 | Not Started | — | Player System, Input Manager, Audio System, Animation Controller, Enemy System |
| 15 | Dungeon Generator | Gameplay | T1 | L4 | Not Started | — | Engine Bootstrap, Pickup System, Enemy System |
| 16 | Run Lifecycle (inferred) | Gameplay | T1 | L5 | Not Started | — | Player System, Enemy System, Dungeon Generator, Pickup System, Persistence Layer |
| 17 | In-Room Sync (Colyseus) | Multiplayer | T1 | L6 | Not Started | — | Engine Bootstrap, Lobby System, Player System, Enemy System, Pickup System, Run Lifecycle |
| 18 | HUD | UI | T1 | L5 | Not Started | — | Engine Bootstrap, Player System, Pickup System, Buster Combat, Dungeon Generator |
| 19 | Tutorial Overlays | UI | T2 | L5 | Not Started | — | Engine Bootstrap, Player System |
| 20 | Upgrade System | Progression | T2 | L5 | Not Started | — | Persistence Layer, Player System, Buster Combat |
| 21 | Run Results Screen (inferred) | UI | T1 | L6 | Not Started | — | Engine Bootstrap, Run Lifecycle, Persistence Layer |
| 22 | Ship Cockpit UI | UI | T2 | L6 | Not Started | — | Engine Bootstrap, Persistence Layer, Lobby System, Sub-Weapon System, Upgrade System |

**Legend:**
- **(inferred)** = system was not explicitly listed in the concept doc; added because explicit systems require it
- **Status** flows: Not Started → In Design → In Review → Approved → Implemented

---

## Categories Used

| Category | Description | Systems in This Game |
|---|---|---|
| **Core** | Foundation systems everything depends on | Engine Bootstrap, Input Manager, Camera Rig, Animation Controller |
| **Gameplay** | Systems that make the game fun | Player, Movement, Enemy, Pickup, Buster Combat, Sub-Weapon, Dungeon Generator, Run Lifecycle |
| **Multiplayer** | Networking and co-op | Lobby System, In-Room Sync |
| **Persistence** | Save state and continuity | Persistence Layer (Postgres) |
| **UI** | Player-facing displays | HUD, Run Results Screen, Ship Cockpit UI, Tutorial Overlays |
| **Audio** | Sound and music | Audio System |
| **Progression** | Player growth | Upgrade System |
| **Meta** | Outside the core loop | Settings |

Categories **not used**: Economy (no shop), Narrative (no story), Analytics (no telemetry).

---

## Priority Tiers (jam-pragmatic 3-tier schema)

| Tier | Definition | Count | Cut Behavior |
|---|---|---|---|
| **T1 — Must Ship** | The game cannot ship without these. They define the core experience. | 17 | Never cut |
| **T2 — Ship If Time** | Game ships without these but feels unfinished. | 5 | Cut in order below if behind schedule |
| **T3 — Cut Order** | Not a separate tier — the order in which T2 systems get axed if we run out of time | — | Tutorial → Settings → Sub-Weapon → Upgrade → Ship Cockpit UI → Lobby+In-Room Sync (drops to solo-only) |

**Why no Vertical Slice / Alpha / Full Vision tiers:** Everything in this index is already aggressively scoped to MVP. The standard CCGS tier model assumes a multi-month project. For a 23-day jam, the meaningful question is "what do we cut first when crunched", not "what's in alpha vs beta."

---

## Dependency Map

### Layer 0 — Foundation (no dependencies)

1. **Engine Bootstrap** — Three.js scene/renderer/camera + Rapier world + asset loader + main loop. THE foundation; everything in L1+ uses it.
2. **Input Manager** — DOM event listener wrapped in a polled state object. KB+M primary, gamepad-ready interface.
3. **Persistence Layer** — Postgres pool, table schemas (`players`, `seeds`, `scores`), CRUD ops. Server-side only.

### Layer 1 — Core Infrastructure (depends on L0 only)

1. **Camera Rig** — depends on: Engine Bootstrap. Fixed third-person follow with swappable rig interface.
2. **Animation Controller** — depends on: Engine Bootstrap. Reusable wrapper around `THREE.AnimationMixer` with state-machine API, crossfade, animation events.
3. **Audio System** — depends on: Engine Bootstrap. SFX bus + music bus, Web Audio API, volume control.
4. **Lobby System** — depends on: Engine Bootstrap, Persistence Layer. Host create, join via room code, join random, max 3 players.

### Layer 2 — Player + Configuration (depends on L0-L1)

1. **Player System** — depends on: Engine, Input Manager, Animation Controller, Camera Rig. Player entity + state machine (alive/downed/dead/spectator).
2. **Settings** — depends on: Engine, Audio System. Volume sliders + mouse sensitivity, persisted to localStorage.

### Layer 3 — Entities + Interactions (depends on L0-L2)

1. **Movement** — depends on: Player System, Input Manager. WASD locomotion, jump, aim direction.
2. **Enemy System** — depends on: Engine, Animation Controller, Audio System. Enemy database, AI state machine, spawning, drops.
3. **Pickup System** — depends on: Engine, Player System, Audio System. Crystals + materials as walk-over collectibles.

### Layer 4 — Combat + World (depends on L0-L3)

1. **Buster Combat (incl. Lock-On)** — depends on: Player, Input, Enemy, Audio, Animation, Pickup. Charge state machine + auto-lock-on + raycast hit detection + damage.
2. **Sub-Weapon System** — depends on: Player, Input, Audio, Animation, Enemy. Equipment slot + 4-weapon database (Spread Shot, Bomb Drop Arm, Grenade Launcher, Homing Buster).
3. **Dungeon Generator** — depends on: Engine, Pickup, Enemy. Seed → graph → room layout → mesh/collision (deterministic).

### Layer 5 — Run + Progression + Local UI (depends on L0-L4)

1. **Run Lifecycle** — depends on: Player, Enemy, Dungeon, Pickup, Persistence. Pure state machine: lobby → loading → exploring → boss → cleared/failed → results. **Architecturally decoupled from In-Room Sync via DI** (see Circular Dependencies).
2. **HUD** — depends on: Engine, Player, Pickup, Buster, Dungeon. HP, ammo, crystals, lock-on indicator, minimap.
3. **Tutorial Overlays** — depends on: Engine, Player. Contextual first-run hints, dismissible, never blocks input.
4. **Upgrade System** — depends on: Persistence, Player, Buster. 6 upgrade tracks (see Notes).

### Layer 6 — Multiplayer Wrapper + Final UI (depends on L0-L5)

1. **In-Room Sync (Colyseus)** — depends on: Engine, Lobby, Player, Enemy, Pickup, Run Lifecycle. State schemas + server-authoritative tick + client predict/reconcile + disconnect/reconnect grace.
2. **Run Results Screen** — depends on: Engine, Run Lifecycle, Persistence. Score breakdown, leaderboard rank, share seed.
3. **Ship Cockpit UI** — depends on: Engine, Persistence, Lobby, Sub-Weapon, Upgrade. Hub: upgrade bench, seed picker, co-op terminal, profile, sub-weapon crafting.

---

## Recommended Design Order

Combines dependency layer + priority tier. Design these systems in this order.
T1 systems are designed first within each layer; T2 systems are designed last so
that if we hit the wall, the **un**designed work is the right work to drop.

| Order | System | Tier | Layer | Designer Agent | Skill | Effort |
|---|---|---|---|---|---|---|
| 1 | Engine Bootstrap | T1 | L0 | engine-programmer | /quick-design | M |
| 2 | Input Manager | T1 | L0 | engine-programmer | /quick-design | S |
| 3 | Persistence Layer | T1 | L0 | network-programmer | /quick-design | M |
| 4 | Camera Rig | T1 | L1 | engine-programmer | /quick-design | S |
| 5 | Animation Controller | T1 | L1 | engine-programmer | /quick-design | M |
| 6 | Audio System | T1 | L1 | engine-programmer | /quick-design | S |
| 7 | Player System | T1 | L2 | gameplay-programmer | /quick-design | M |
| 8 | Enemy System | T1 | L3 | gameplay-programmer | /quick-design | M |
| 9 | Pickup System | T1 | L3 | gameplay-programmer | /quick-design | S |
| 10 | Movement | T1 | L3 | gameplay-programmer | /quick-design | S |
| 11 | Dungeon Generator | T1 | L4 | gameplay-programmer | **/design-system** | L |
| 12 | Buster Combat (incl. Lock-On) | T1 | L4 | gameplay-programmer | **/design-system** | L |
| 13 | Run Lifecycle | T1 | L5 | gameplay-programmer | /quick-design | M |
| 14 | HUD | T1 | L5 | ui-programmer | /quick-design | S |
| 15 | Lobby System | T1 | L1 | network-programmer | /quick-design | M |
| 16 | In-Room Sync | T1 | L6 | network-programmer | **/design-system** | L |
| 17 | Run Results Screen | T1 | L6 | ui-programmer | /quick-design | S |
| 18 | Sub-Weapon System | T2 | L4 | gameplay-programmer | /quick-design | M |
| 19 | Upgrade System | T2 | L5 | game-designer | /quick-design | S |
| 20 | Ship Cockpit UI | T2 | L6 | ui-programmer | /quick-design | M |
| 21 | Tutorial Overlays | T2 | L5 | ui-programmer | /quick-design | S |
| 22 | Settings | T2 | L2 | ui-programmer | /quick-design | S |

**Effort:** S = ~1-2h design session · M = ~half day · L = ~full day
**Skill choice:** Use `/quick-design` for jam pragmatism (lighter than `/design-system`).
Escalate to `/design-system` only for the 3 L-effort systems (Dungeon Generator,
Buster Combat, In-Room Sync) — these are the core of the game and worth the
deeper treatment.

**Total design effort estimate:** 3 × L (8h) + 8 × M (4h) + 11 × S (2h) = 24 + 32 + 22 ≈ **78 hours of design work**. With aggressive parallelism and `/quick-design` shortcuts, achievable in ~3-4 days.

---

## Circular Dependencies

**Found one — resolved before locking the index:**

### Run Lifecycle ⇄ In-Room Sync

**The naive cycle:** Run Lifecycle wants to broadcast phase changes via the
Colyseus room. In-Room Sync needs Run Lifecycle to know what phase to sync.

**Resolution: dependency injection.** Run Lifecycle is implemented as a **pure
state machine** that takes a state object and a delta time, mutates the state,
and returns. It has zero knowledge of Colyseus or networking. In-Room Sync owns
the room and the state schema, and **calls** `RunLifecycle.tick(state, dt)` each
server frame.

**Practical implications:**
- Run Lifecycle is unit-testable in isolation (no Colyseus needed for tests)
- In-Room Sync can be swapped for a fake/local-only implementation in tests
- Solo mode (no multiplayer) just calls `RunLifecycle.tick()` directly with no sync wrapper

This is a better architecture than the naive direct coupling anyway.

---

## High-Risk Systems (bottlenecks — design and lock interfaces early)

| System | Risk Type | Risk Description | Mitigation |
|---|---|---|---|
| **Engine Bootstrap** | Technical | 16 systems depend on it. If broken or late-changing, everything else stalls. | Design first, lock the public API before any L1 system starts. |
| **Player System** | Design | 10 systems depend on the Player API. Churn here cascades. | Lock the entity interface (component slots, state events) before Movement/Combat start. |
| **Animation Controller** | Technical + Scope | New abstraction; if late, every animated entity has to retrofit ad-hoc anim glue. | Design before Player; build a working prototype with one entity before designing Enemy. |
| **Audio System** | Technical | If late, every system has to retroactively wire SFX hooks. | Design and stub early so other systems can call `Audio.play("hit")` from day 1. |
| **Persistence Layer** | Technical | Schema churn = data migration pain. | Lock the 3 tables before any read/write code is written. |
| **Dungeon Generator** | Design + Technical | Procedural quality is hard. Concept hook depends on it (deterministic seeds = leaderboard). | **Prototype early.** Allocate L-effort. Have a fallback plan: 3 hand-crafted dungeons. |
| **Buster Combat** | Design | This IS the game. If it doesn't feel crunchy, the jam fails. | **Prototype early.** Spend more design time here than anywhere else. |
| **In-Room Sync** | Technical | Netcode is notoriously hard. Disconnect/reconnect grace adds complexity. | **Prototype early with a smoke test.** Have a fallback: solo-only ship if netcode slips. |

---

## Progress Tracker

| Metric | Count |
|---|---|
| Total systems identified | 22 |
| Design docs started | 6 |
| Design docs reviewed | 0 |
| Design docs approved | 6 |
| **T1 (Must Ship) systems designed** | 6 / 17 |
| **T2 (Ship If Time) systems designed** | 0 / 5 |

---

## Notes

### Sub-weapon roster (data-driven, defined in Sub-Weapon System GDD)

| Sub-weapon | Status | Description |
|---|---|---|
| **Spread Shot** | v1 starter (equipped from run 1) | 5-pellet shotgun blast, 3s cooldown |
| **Bomb Drop Arm** | Craftable / dungeon drop | Drops AoE bomb at feet |
| **Grenade Launcher** | Craftable / dungeon drop | Arc-throw AoE projectile |
| **Homing Buster** | Craftable / dungeon drop | Slow homing projectile, locks to nearest enemy |

All 4 share a common `SubWeapon` interface. Adding more post-jam = adding a JSON
entry to the sub-weapon database.

### Upgrade tracks (defined in Upgrade System GDD)

| Track | Effect | Tiers (jam v1) |
|---|---|---|
| 1. **Buster Damage** | +% damage per shot | 3 tiers (e.g. +10/+20/+30%) |
| 2. **Buster Charge Speed** | -% time to fully charge | 3 tiers |
| 3. **Max HP** | +% maximum health | 3 tiers |
| 4. **Armor Defense** | +% incoming damage reduction | 3 tiers |
| 5. **Revival Count** | Number of times teammates can revive you per run | Start with 1, +1 per tier (max 3) |
| 6. **Sub-Weapon Capacity** | Max ammo / slots for sub-weapon | 3 tiers |

Note: "Buster Shoot Speed" (fire rate) was deliberately deferred — pick one of
charge speed vs shoot speed to keep upgrade math simple. Can be added post-jam.

### Locked Design Decisions (from game-concept.md)

- Boss room: one fixed boss type, not Journey Level scaled
- Sub-weapon recipes: built in ship OR found as dungeon drops (dual source)
- Disconnect: kicked to lobby with reconnect option during grace period
- Camera: fixed third-person follow, swappable rig component

### Excluded from scope (not in this index)

- Story / narrative / NPCs / dialogue / cutscenes
- Walkable ship interior (cockpit is UI only)
- Permadeath / roguelike meta currency
- PvP
- Mobile / touch controls
- Localization (English only)
- Analytics / telemetry
- Anti-cheat (server authority is enough)
- Accessibility features beyond basic settings

---

## Next Steps

- [x] Review and approve this systems enumeration
- [ ] Design L0 systems first using `/quick-design Engine-Bootstrap`, then `/quick-design Input-Manager`, then `/quick-design Persistence-Layer`
- [ ] Use `/design-system` (full GDD) for the 3 L-effort systems: Dungeon Generator, Buster Combat, In-Room Sync
- [ ] Run `/architecture-decision` for the 5-7 ADRs already identified in `.claude/docs/technical-preferences.md`
- [ ] Run `/create-control-manifest` after architecture decisions are locked
- [ ] Run `/create-stories` after all T1 GDDs are approved
- [ ] Begin `/dev-story` implementation loop

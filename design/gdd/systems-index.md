# Systems Index: Space Runner

> **Status:** Approved (pivot version)
> **Created:** 2026-04-09 (superseding the 2026-04-08 MML dungeon-crawler index)
> **Source Concept:** design/gdd/game-concept.md
> **Review Mode:** Solo (jam project)
> **Previous Version:** design/archive/mml-dungeon-crawler/systems-index.md

---

## Overview

Space Runner is a solo 3D endless runner built for Vibe Jam 2026. The game
decomposes into **18 systems across 6 categories**, organized into
**7 dependency layers** (L0-L6). This is a **pivot** from the original
22-system Robot Crawler (MML dungeon crawler) plan — see
`design/archive/mml-dungeon-crawler/` for the superseded index.

Compared to the original plan, **four systems are cut** (Lobby, In-Room Sync,
Buster Combat, Sub-Weapon), **two systems are renamed** (Dungeon Generator →
Track Generator; Enemy System → Obstacle System), and **one new system is
introduced** (Planet/Checkpoint). Critically, **all three L-effort systems**
from the old plan (Dungeon Generator, Buster Combat, In-Room Sync) are
eliminated — Space Runner has zero L-effort systems. The mechanical scope
is intentionally narrow: three verbs (dodge, jump, slide), one combat
button (Super Suit), one meter (HP), one score.

The decomposition uses the same **3-tier jam-pragmatic priority schema**
(T1 Must Ship, T2 Ship If Time, T3 Cut Order) as the previous plan.

---

## Systems Enumeration

| # | System Name | Category | Priority | Layer | Status | Design Doc | Depends On |
|---|---|---|---|---|---|---|---|
| 1 | Engine Bootstrap | Core | T1 | L0 | Implemented | design/quick-specs/engine-bootstrap-2026-04-08.md | — |
| 2 | Input Manager | Core | T1 | L0 | Implemented | design/quick-specs/input-manager-2026-04-08.md | — |
| 3 | Persistence Layer | Persistence | T1 | L0 | Not Started | — | — |
| 4 | Camera Rig | Core | T1 | L1 | Implemented (needs chase-cam rework) | design/quick-specs/camera-rig-2026-04-08.md | Engine Bootstrap |
| 5 | Animation Controller | Core | T1 | L1 | Implemented | design/quick-specs/animation-controller-2026-04-08.md | Engine Bootstrap |
| 6 | Audio System | Audio | T1 | L1 | Not Started | — | Engine Bootstrap |
| 7 | Player System | Gameplay | T1 | L2 | Implemented | design/quick-specs/player-system-2026-04-09.md | Engine Bootstrap, Input Manager, Animation Controller, Camera Rig |
| 8 | Settings | Meta | T2 | L2 | Not Started | — | Engine Bootstrap, Audio System |
| 9 | Movement | Gameplay | T1 | L3 | Implemented (needs endless-runner rework) | design/quick-specs/movement-2026-04-09.md (archived); new spec needed | Player System, Input Manager |
| 10 | Obstacle System | Gameplay | T1 | L3 | Not Started | — | Engine Bootstrap, Animation Controller (optional), Audio System |
| 11 | Pickup System | Gameplay | T1 | L3 | Not Started | — | Engine Bootstrap, Player System, Audio System |
| 12 | Track Generator | Gameplay | T1 | L4 | Not Started | — | Engine Bootstrap, Obstacle System, Pickup System |
| 13 | Super-Suit Combat | Gameplay | T1 | L4 | Not Started | — | Player System, Input Manager, Obstacle System, Audio System, Animation Controller |
| 14 | Planet / Checkpoint System | Gameplay | T1 | L4 | Not Started | — | Track Generator, Player System |
| 15 | Run Lifecycle | Gameplay | T1 | L5 | Not Started | — | Player System, Planet/Checkpoint System, Persistence Layer |
| 16 | HUD | UI | T1 | L5 | Not Started | — | Engine Bootstrap, Player System, Pickup System, Super-Suit Combat, Planet/Checkpoint System |
| 17 | Tutorial Overlays | UI | T2 | L5 | Not Started | — | Engine Bootstrap, Player System |
| 18 | Run Results Screen | UI | T1 | L6 | Not Started | — | Engine Bootstrap, Run Lifecycle, Persistence Layer |

**Legend:**
- **Status** flows: Not Started → In Design → In Review → Approved → Implemented
- **(needs rework)** flags indicate a system that was implemented for the MML
  design and needs updating for Space Runner. The underlying code is reusable;
  only specific behaviours change.

---

## Cut from the MML plan (no longer in scope)

| # | Old System | Fate |
|---|---|---|
| — | Lobby System | Cut — solo-only game, no lobbies |
| — | In-Room Sync (Colyseus) | Cut — solo-only, no netcode |
| — | Dungeon Generator | Replaced by Track Generator (simpler, linear) |
| — | Enemy System | Replaced by Obstacle System (static hazards + optional T2 enemies) |
| — | Buster Combat | Replaced by Super-Suit Combat (one button, cooldown) |
| — | Sub-Weapon System | Cut — one combat verb is enough |
| — | Upgrade System | Cut — no meta progression per Pillar 3 |
| — | Ship Cockpit UI | Cut — replaced by simple title menu |

**Old system count:** 22. **New system count:** 18. **Net removed:** 4 systems.
**More importantly:** all three L-effort systems are gone. The new highest-risk
system is Track Generator (M effort).

---

## Categories Used

| Category | Description | Systems in This Game |
|---|---|---|
| **Core** | Foundation systems everything depends on | Engine Bootstrap, Input Manager, Camera Rig, Animation Controller |
| **Gameplay** | Systems that make the game fun | Player, Movement, Obstacle, Pickup, Track Generator, Super-Suit Combat, Planet/Checkpoint, Run Lifecycle |
| **Persistence** | Save state and continuity | Persistence Layer |
| **UI** | Player-facing displays | HUD, Run Results Screen, Tutorial Overlays |
| **Audio** | Sound and music | Audio System |
| **Meta** | Outside the core loop | Settings |

Categories **not used**: Economy (no shop), Narrative (no story),
Analytics (no telemetry), Multiplayer (no netcode), Progression (no upgrades).

---

## Priority Tiers (jam-pragmatic 3-tier schema)

| Tier | Definition | Count | Cut Behavior |
|---|---|---|---|
| **T1 — Must Ship** | The game cannot ship without these. They define the core experience. | 16 | Never cut |
| **T2 — Ship If Time** | Game ships without these but feels unfinished. | 2 | Cut in order below if behind schedule |
| **T3 — Cut Order** | Not a separate tier — the order in which T2 systems get axed if we run out of time | — | Tutorial → Settings |

**Why only 2 T2s:** Aggressive scope-cutting. Anything speculative got
removed. What's left is genuinely the minimum viable Space Runner.

---

## Dependency Map

### Layer 0 — Foundation (no dependencies)

1. **Engine Bootstrap** — Three.js scene/renderer/camera + Rapier world + asset loader + main loop. Foundation for everything in L1+.
2. **Input Manager** — DOM event listener wrapped in a polled state object. KB+M primary, gamepad-ready interface.
3. **Persistence Layer** — Postgres pool + a single `runs` table + POST/GET endpoints. Server-side only. Simpler than the MML plan: one table instead of three.

### Layer 1 — Core Infrastructure (depends on L0 only)

1. **Camera Rig** — depends on: Engine Bootstrap. **Chase-cam** locked behind and slightly above the player; fixed angle; FOV punches forward on speed change. Needs rework from the MML "fixed third-person follow" behaviour (different tuning, different feel).
2. **Animation Controller** — depends on: Engine Bootstrap. Reusable wrapper around `THREE.AnimationMixer` with state-machine API, crossfade, animation events. Unchanged from MML plan.
3. **Audio System** — depends on: Engine Bootstrap. SFX bus + music bus, Web Audio API, volume control.

### Layer 2 — Player + Configuration (depends on L0-L1)

1. **Player System** — depends on: Engine, Input Manager, Animation Controller, Camera Rig. Player entity + state machine (running / jumping / sliding / hit / dead). Reused from MML plan with state-machine updates.
2. **Settings** *(T2)* — depends on: Engine, Audio System. Volume sliders + mouse sensitivity, persisted to localStorage.

### Layer 3 — Entities + Interactions (depends on L0-L2)

1. **Movement** — depends on: Player System, Input Manager. **Auto-run forward + lateral dodge + jump + slide.** Replaces the MML WASD camera-relative model entirely. The existing `movement.ts` code is reusable for lateral + jump + slide; auto-forward replaces the WASD forward input.
2. **Obstacle System** — depends on: Engine, Animation Controller (optional), Audio System. Static hazards (rocks, pillars, lava pits, ice spikes) + **T2 stretch** forward-facing patrol enemies. Replaces MML Enemy System.
3. **Pickup System** — depends on: Engine, Player System, Audio System. Crystals as walk-through score collectibles. Simpler than MML plan — crystals are score only, no currency conversion.

### Layer 4 — World + Combat (depends on L0-L3)

1. **Track Generator** — depends on: Engine, Obstacle, Pickup. Deterministic per-planet procedural layout from biome template pool. **Replaces MML Dungeon Generator.** Key simplification: linear forward segment, not a graph of connected rooms.
2. **Super-Suit Combat** — depends on: Player, Input, Obstacle, Audio, Animation. One-button ability with cooldown; running-punch breaks certain obstacles and one-shots enemies. **Replaces MML Buster Combat + Sub-Weapon + Lock-On**.
3. **Planet / Checkpoint System** — depends on: Track Generator, Player. End-of-planet jump-gate detection, warp cinematic, full-HP restore, score bonus, difficulty increment. This is the unique hook of the game.

### Layer 5 — Run + Local UI (depends on L0-L4)

1. **Run Lifecycle** — depends on: Player, Planet/Checkpoint, Persistence. Pure state machine: `title → run → dead → results → retry`. Far simpler than MML plan (no lobby/loading/boss phases).
2. **HUD** — depends on: Engine, Player, Pickup, Super-Suit, Planet/Checkpoint. Distance, HP bar, crystal count, super-suit cooldown ring, current planet name.
3. **Tutorial Overlays** *(T2)* — depends on: Engine, Player. First-run hints (how to dodge, jump, slide, use Super Suit), dismissible, never blocks input.

### Layer 6 — Results (depends on L0-L5)

1. **Run Results Screen** — depends on: Engine, Run Lifecycle, Persistence. Distance + planets cleared + crystal count + score breakdown; submit to leaderboard; show rank; retry button.

---

## Recommended Design Order

Combines dependency layer + priority tier. Design T1 systems first within
each layer; T2 systems last so the undesigned work is the right work to drop.

| Order | System | Tier | Layer | Designer Agent | Skill | Effort | Carryover |
|---|---|---|---|---|---|---|---|
| — | Engine Bootstrap | T1 | L0 | engine-programmer | /quick-design | M | ✅ Done |
| — | Input Manager | T1 | L0 | engine-programmer | /quick-design | S | ✅ Done |
| 1 | Persistence Layer | T1 | L0 | gameplay-programmer | /quick-design | S | new (simpler) |
| — | Camera Rig | T1 | L1 | engine-programmer | /quick-design | S | ⚠ rework |
| — | Animation Controller | T1 | L1 | engine-programmer | /quick-design | M | ✅ Done |
| 2 | Audio System | T1 | L1 | engine-programmer | /quick-design | S | new |
| — | Player System | T1 | L2 | gameplay-programmer | /quick-design | M | ✅ Done |
| 3 | Movement (rework) | T1 | L3 | gameplay-programmer | /quick-design | S | ⚠ rework |
| 4 | Obstacle System | T1 | L3 | gameplay-programmer | /quick-design | M | new |
| 5 | Pickup System | T1 | L3 | gameplay-programmer | /quick-design | S | new |
| 6 | Track Generator | T1 | L4 | gameplay-programmer | /quick-design | M | new |
| 7 | Super-Suit Combat | T1 | L4 | gameplay-programmer | /quick-design | M | new |
| 8 | Planet/Checkpoint System | T1 | L4 | gameplay-programmer | /quick-design | S | new |
| 9 | Run Lifecycle | T1 | L5 | gameplay-programmer | /quick-design | S | new |
| 10 | HUD | T1 | L5 | ui-programmer | /quick-design | S | new |
| 11 | Run Results Screen | T1 | L6 | ui-programmer | /quick-design | S | new |
| 12 | Settings *(T2)* | T2 | L2 | ui-programmer | /quick-design | S | — |
| 13 | Tutorial Overlays *(T2)* | T2 | L5 | ui-programmer | /quick-design | S | — |

**Effort:** S = ~1-2h design session · M = ~half day · L = ~full day

**Critical observation: zero L-effort systems remaining.** The old plan had 3
L-effort systems (Dungeon Generator, Buster Combat, In-Room Sync) that were
the main risk vectors. Space Runner has none. All remaining undesigned
systems are S or M effort.

**Total design effort estimate:** 0 × L + 5 × M (2.5 days) + 8 × S (1.5 days)
≈ **4 days of design work** for the new/reworked systems. With aggressive
parallelism and `/quick-design` shortcuts, achievable in ~2 days. The
original MML plan needed 3-4 days just for the L-effort GDDs.

---

## Circular Dependencies

None. The pivot eliminated the old Run Lifecycle ⇄ In-Room Sync cycle by
deleting In-Room Sync entirely. Run Lifecycle is a plain main-thread state
machine now, no DI trick needed.

---

## High-Risk Systems (bottlenecks — design and lock interfaces early)

| System | Risk Type | Risk Description | Mitigation |
|---|---|---|---|
| **Track Generator** | Design | Procedural layouts must be *fair* — no unwinnable obstacle clumps. If quality is bad, the game feels cheap. | Hand-craft 4-6 obstacle "chunks" per biome; randomize chunk order rather than per-obstacle placement. Safer than fully procedural. |
| **Super-Suit Combat** | Design | Must feel impactful on activation or players won't use it. Cooldown must be tuned so it's available "when you need it" without being a spam button. | Prototype the feel on day 1 of implementation. Tuning knobs in JSON. Start with 10s cooldown, adjust from playtest. |
| **Movement (rework)** | Technical + Feel | The existing Rapier kinematic body is tuned for WASD free-move. Auto-run forward changes the physics profile (constant forward velocity). | Keep the existing Rapier body; change only the intent computation. Do NOT rewrite the body-driver. Spec the rework before touching code. |
| **Camera Rig (rework)** | Feel | FOV punch on speed change is easy to over-tune. Too much = motion sickness. Too little = no kinesthetic cue. | Start with subtle values (FOV 60 → 70 over 1s on planet transition). Iterate from playtest only, not from theory. |
| **Planet/Checkpoint System** | Design | This is the hook. If the jump-gate transition feels cheap, the unique selling point collapses. | Design the transition as a deliberate ~2-3s beat (fade-in warp, sound cue, loading mask). Don't skip. |

---

## Progress Tracker

| Metric | Count |
|---|---|
| Total systems identified | 18 |
| Design docs started | 6 (carryover from MML — 5 reusable, 1 needs rework) |
| Design docs approved | 5 (carryover: Engine, Input, Animation, Player, Camera needs light update) |
| Design docs implemented | 6 (Engine, Input, Camera, Animation, Player, Movement — last two need rework) |
| **T1 (Must Ship) systems designed** | 5 / 16 |
| **T2 (Ship If Time) systems designed** | 0 / 2 |

---

## Notes

### Biomes (v1 target: 3, defined in Track Generator GDD)

| Biome | Palette | Hazards |
|---|---|---|
| **Rocky** | Grey / brown / rust | Boulders (dodge), crevasses (jump), low arches (slide) |
| **Ice** | Blue / white / cyan | Ice pillars (dodge), sliding-floor modifier, falling icicles (jump) |
| **Volcanic** | Red / orange / black | Lava pits (jump), falling meteors (dodge), steam jets (slide) |

**Stretch biome:** Alien Jungle (green / purple / bioluminescent) — T2 goal.

### Locked Design Decisions (from game-concept.md)

- Movement: free 3D lateral on forward-auto-run (Pepsi Man, not Temple Run)
- Hit model: HP-based, restores fully on planet transition
- Endless mode — no win state
- Super Suit: always-on with cooldown, not pickup-based
- Crystals = score only
- Solo only — no Colyseus
- Camera: chase-cam with speed-based FOV punch
- Jam title: "Space Runner"; repo stays `robot-crawler`

### Excluded from scope (not in this index)

- Story / narrative / NPCs / dialogue / cutscenes (beyond jump-gate warp beat)
- Co-op / PvP / any multiplayer
- Walkable hub / ship interior / cockpit
- Permadeath meta-progression / unlockable player stats
- Sub-weapons / item builds
- Mobile / touch controls
- Localization (English only)
- Analytics / telemetry
- Anti-cheat (no client trust to break — leaderboard-side validation only)
- Accessibility features beyond basic settings

---

## Next Steps

- [x] Pivot approved (2026-04-09)
- [x] Rewrite game-concept.md and systems-index.md (this file)
- [ ] Rework `src/gameplay/movement.ts` from WASD free-move to auto-run + lateral + jump + slide (new `/quick-design Movement`)
- [ ] Rework Camera Rig for chase-cam + FOV punch (update the existing spec)
- [ ] `/quick-design` the 11 new undesigned systems (Persistence, Audio, Obstacle, Pickup, Track Generator, Super-Suit Combat, Planet/Checkpoint, Run Lifecycle, HUD, Results, + T2 Settings/Tutorial last)
- [ ] Mark ADR-0002 and ADR-0004 as Superseded (no longer applicable with no multiplayer)
- [ ] Refresh `production/session-state/active.md` with pivot log + new status

# Active Session State

**Last Updated:** 2026-04-09 (post-pivot)
**Project:** Space Runner — Vibe Jam 2026 entry (internal repo: `robot-crawler`)
**Jam Deadline:** 2026-05-01 @ 13:37 UTC (~22 days remaining)
**Review Mode:** Solo (`production/review-mode.txt`)
**Branch:** main
**Repo:** https://github.com/CarlosQ96/robot-crawler

---

## ⚠ PIVOT: Robot Crawler → Space Runner (2026-04-09)

**Old concept:** Megaman Legends-inspired 3D co-op dungeon crawler with
server-authoritative Colyseus multiplayer, procedural dungeons, Buster
combat, sub-weapons, upgrade tracks, ship cockpit hub.

**New concept:** Solo 3D endless runner in space. Auto-run forward across
hostile planets, dodge/jump/slide past hazards, break through with Super
Suit attack (cooldown), jump-gate warps you to the next planet, run ends
at 0 HP, post score to global leaderboard. Three biomes (Rocky, Ice,
Volcanic). No multiplayer. No upgrades. No story.

**Why:** With 22 days left and three L-effort systems in the old plan
(Dungeon Generator, Buster Combat, In-Room Sync) any one of which could
blow the deadline, the math stopped working. Space Runner reuses the six
already-implemented systems nearly as-is, eliminates all netcode, and
is a genre that solo devs can realistically ship in three weeks.

**What survived the pivot (unchanged):**
- Tech stack: Three.js r174 + Rapier + TypeScript + CDN importmap + Meshy pipeline
- 6 implemented systems (Engine Bootstrap, Input Manager, Camera Rig,
  Animation Controller, Player System, Movement)
- Robot hero model + 13 animation clips
- 8 of 10 ADRs (ADR-0001, 0003, 0005, 0006, 0007, 0008, 0009, 0010)

**What got archived (superseded):**
- `design/archive/mml-dungeon-crawler/game-concept.md` (old concept)
- `design/archive/mml-dungeon-crawler/systems-index.md` (old 22-system plan)
- `design/archive/mml-dungeon-crawler/movement-2026-04-09.md` (WASD free-move spec)
- `ADR-0002` (Colyseus) → marked Superseded
- `ADR-0004` (server-authoritative combat) → marked Superseded

**Full new plan:** `design/gdd/game-concept.md` + `design/gdd/systems-index.md`

---

## TL;DR — Where we are right now

**Phase:** Pivot complete (docs). Reimplementation phase starting.
**Build status:** Old `npm run dev` build still runs the MML movement
  code; visually it's the same scene until we rework movement + camera.
**Run command:** `npm run dev` → http://localhost:3000
**What works today visually:** Engine boots, player robot model loads with
  idle anim, camera follows player (MML-style, not the chase-cam yet),
  ground plane, shadows. WASD moves the player (will be replaced by
  auto-run + lateral dodge).

---

## Resume protocol — read these in order if reopening

If a Claude Code session has died, follow these steps to recover full context:

1. **`CLAUDE.md`** — project overview, tech stack, jam constraints, collaboration protocol (already refreshed for Space Runner)
2. **`design/gdd/game-concept.md`** — the new Space Runner vision + locked decisions
3. **`design/gdd/systems-index.md`** — the 18 systems, dependency layers, design order, **progress tracker** (Status column shows what's Implemented vs Approved vs Not Started vs Needs Rework)
4. **This file** — pivot log, current task, recent decisions
5. **`docs/architecture/`** — 10 ADRs (ADR-0002 and ADR-0004 are Superseded; the other 8 still govern)
6. **`docs/engine-reference/{threejs,rapier}/`** — version-pinned API references (Colyseus reference is now stale but harmless)
7. **`.claude/docs/technical-preferences.md`** — agent routing + project standards

After reading, run `git log --oneline | head -20` to see recent commits.

---

## Systems progress (live snapshot)

| # | System | Status | Fate after pivot |
|---|---|---|---|
| 1 | Engine Bootstrap | ✅ Implemented | Unchanged |
| 2 | Input Manager | ✅ Implemented | Unchanged |
| 3 | Persistence Layer | ⚠ Not Started | New — simpler (1 table) |
| 4 | Camera Rig | ✅ Implemented | ⚠ Needs chase-cam + FOV punch rework |
| 5 | Animation Controller | ✅ Implemented | Unchanged |
| 6 | Audio System | ⚠ Not Started | New |
| 7 | Player System | ✅ Implemented | Unchanged |
| 8 | Settings *(T2)* | ⚠ Not Started | Unchanged scope |
| 9 | Movement | ✅ Implemented | ⚠ Needs full rework (auto-run + lateral + jump + slide) |
| 10 | Obstacle System | ⚠ Not Started | New — replaces Enemy System |
| 11 | Pickup System | ⚠ Not Started | New — simpler (crystals = score only) |
| 12 | Track Generator | ⚠ Not Started | New — replaces Dungeon Generator (linear, not graph) |
| 13 | Super-Suit Combat | ⚠ Not Started | New — replaces Buster + Sub-Weapon + Lock-On |
| 14 | Planet/Checkpoint System | ⚠ Not Started | New — the unique hook |
| 15 | Run Lifecycle | ⚠ Not Started | New — simpler (no lobby/boss phases) |
| 16 | HUD | ⚠ Not Started | New |
| 17 | Tutorial Overlays *(T2)* | ⚠ Not Started | New |
| 18 | Run Results Screen | ⚠ Not Started | New |

**Old system count:** 22 (MML). **New system count:** 18 (Space Runner).
**L-effort systems remaining:** 0. (Previously 3.)
**Progress: 6 of 18 systems implemented, 2 of those 6 need rework.**

---

## What just happened (recent commit history)

```
ec2a62e fix(player,camera): feet-on-ground sync + closer over-shoulder camera
34f630e fix(movement,camera): diagonal stutter, jump replay, camera yaw-follow
4225b06 docs: Movement spec addendum + session state bug-fix log
dce0e7f fix(movement): ground collider, anti-tumble, yaw-follow, jump edge-trigger
7e964e5 feat(gameplay): Movement (system 6/22) — Vertical Slice 1 design complete
2b626dc feat(gameplay): Player System (system 5/22)
f66fd58 feat(engine): Camera Rig + Animation Controller (systems 3+4 of 22) parallel
6a0e67a feat(engine): Input Manager (system 2/22)
8ef19c5 feat(engine): Engine Bootstrap (system 1/22)
b6341c5 docs: 10 ADRs + adopt TypeScript everywhere
608ed9e docs: Systems index for Robot Crawler (22 systems)
3468434 docs: Game concept doc
160dc10 init: robot crawler — vibe jam 2026
```

**(Note: all `feat:` commits above were made under the MML concept.
The code they produced is mostly reusable under Space Runner — the
physics body, input mapping, animation controller, and camera rig
framework all survive; only the behavioural layer on top changes.)**

---

## Current task

**Doc pivot complete (this session).** All design docs and ADRs have been
updated or archived to reflect the Space Runner concept. No code has been
touched yet in this session. Next task is the **Movement rework**: the
existing `src/gameplay/movement.ts` needs to change from "WASD
camera-relative free-move" to "auto-run forward + lateral dodge + jump +
slide". The existing Rapier kinematic body and yaw-follow logic are
reusable; only the intent computation and the action set change.

---

## Locked design decisions (from the pivot; don't re-litigate)

- **Concept:** Solo 3D endless runner in space. Three biomes, endless
  planet-hop, HP-based death, Super Suit on cooldown, crystals = score
- **3 game pillars:** (1) Feel over depth, (2) Every planet is a fresh
  surprise, (3) The score is the whole game
- **Movement model:** Free 3D lateral on a forward auto-running corridor
  (Pepsi Man style, not Temple Run 3-lane)
- **Hit model:** HP-based, fully restores on planet transition
- **Endless mode:** no final boss, no win state
- **Super Suit:** always-on with cooldown (not pickup-based), cooldown ~8-12s
- **Biomes (v1):** Rocky, Ice, Volcanic; Alien Jungle is T2 stretch
- **Pickups:** crystals are score only, no currency conversion
- **Camera:** chase-cam behind + above, fixed angle, FOV punch on speed
- **Solo only:** no Colyseus, no rooms, no matchmaking
- **Jam title:** "Space Runner"
- **Internal repo stays `robot-crawler`** (GitHub/Vercel/Railway URL preservation)
- **Tech stack:** Three.js r174 + Rapier 0.19 + TypeScript + Postgres (no Colyseus)
- **No bundler** (CDN importmap), per-file `tsc` transpile
- **Fixed Rapier timestep 1/60** (still applies — ADR-0007 survives)

---

## Asset status (Meshy AI exports) — unchanged from MML era

| Asset | Path | Status | Notes |
|---|---|---|---|
| Player model | `assets/models/player/robot_hero.glb` | ✅ committed (9.3 MB raw) | Reused as-is — robot hero fits space runner perfectly |
| Player animations | `assets/models/player/robot_hero_animations.glb` | ✅ committed (9.3 MB raw) | Has `Running`, `RunFast`, `Regular_Jump`, `Dead`, `BeHit_FlyUp` — 80% of what a runner needs. **Need added clips:** `Slide`, `Punch` (super suit attack) |
| Spider enemy | `assets/models/enemies/spider_enemy.glb` | 🟡 unused for now | May repurpose as a patrolling obstacle enemy (T2) |
| Crystal pickup | `assets/models/pickups/crystal_shard.glb` | ✅ committed (48 KB) | Reused as score pickup, needs emissive shader |
| Floor tile A / B | `assets/models/dungeon/_source/` | 🟡 may repurpose | Need biome-specific variants or PBR-textured substitutes |

**Asset gaps created by pivot:**
- Biome-specific ground tiles (Rocky, Ice, Volcanic) — 3 variants needed
- Biome-specific obstacles (boulders, ice pillars, lava pits, etc.)
- Jump-gate visual (warp portal) for the checkpoint transition
- `Slide` + `Punch` animation clips for the robot hero

**Asset budget status:** still ~30 MB raw (over the jam 10 MB budget).
Deferred — user said "don't worry about the models for now, we testing with them."
Re-compression via `npm run compress-models` still pending before submission.

---

## Known doc drift to fix later (non-blocking)

- `docs/engine-reference/colyseus/` — now stale (Colyseus dropped). Can be
  deleted or moved to `docs/engine-reference/_archived/colyseus/`. Not
  blocking since no code references it.
- `docs/engine-reference/rapier/RAPIER-0.14.md` — should be RAPIER-0.19
- `ADR-0007` version number mismatch (says 0.14, package uses 0.19)
- `design/tech-stack.md` — needs a pass to strip Colyseus references and
  align with the Space Runner layer ownership. (CLAUDE.md already updated.)

These are documentation only — they don't affect agent code generation
because agents read the actual spec content and the `package.json` which
has the correct versions. Fix in a single sweep when there's a natural break.

---

## Next 5 actions (ordered, post-pivot)

1. **Rework Movement** — rewrite `src/gameplay/movement.ts` from WASD
   camera-relative free-move to **auto-run forward + lateral dodge + jump
   + slide**. Spec first (`/quick-design Movement`), then code. Keep the
   existing Rapier kinematic body + yaw-follow logic — only the intent
   computation changes.
2. **Rework Camera Rig** — update `src/engine/camera-rig.ts` from fixed
   third-person follow to **chase-cam with FOV punch on speed change**.
   Lighter rework than Movement; no new system, just parameter + behaviour
   changes.
3. **Spec Track Generator + Obstacle System in parallel** — these are the
   two biggest unknowns. Use `/quick-design` for both. Target: linear
   segment of hand-crafted obstacle "chunks" per biome, randomized chunk
   order.
4. **Spec Super-Suit Combat + Planet/Checkpoint System** — the unique
   hooks of the game. Both are M-effort `/quick-design`.
5. **Spec Audio + Persistence Layer in parallel** — Audio is needed by
   everything that shipped already (unwire from Engine Bootstrap stub).
   Persistence is a single `runs` table + POST/GET endpoints.

After these, we'd have the full L0-L4 design complete and most of the
code scaffolding reusable. Then L5-L6 (Run Lifecycle, HUD, Results) is a
sprint of smaller specs.

---

## Open questions / blockers

None right now. Pivot is fully locked in the docs.

---

## Files changed in this session (the pivot itself)

**Archived (moved to `design/archive/mml-dungeon-crawler/`):**
- `design/archive/mml-dungeon-crawler/game-concept.md` (was `design/gdd/game-concept.md`)
- `design/archive/mml-dungeon-crawler/systems-index.md` (was `design/gdd/systems-index.md`)
- `design/archive/mml-dungeon-crawler/movement-2026-04-09.md` (was `design/quick-specs/movement-2026-04-09.md`)

**Rewritten (overwrite with Space Runner version):**
- `design/gdd/game-concept.md` — new Space Runner concept
- `design/gdd/systems-index.md` — new 18-system index

**Edited:**
- `CLAUDE.md` — title, game concept section, tech stack (Colyseus removed),
  layer ownership, agent set (network-programmer removed)
- `docs/architecture/ADR-0002-colyseus-multiplayer.md` — Status: Superseded
- `docs/architecture/ADR-0004-server-authoritative-combat.md` — Status: Superseded
- `production/session-state/active.md` (this file)

**Not touched (intentional):**
- All `src/**` code — no code changes in the pivot pass
- Other quick-specs (Engine Bootstrap, Input Manager, Camera Rig,
  Animation Controller, Player System) — still valid; Camera Rig needs
  a behavioural update addendum but the core spec survives
- Other ADRs (0001, 0003, 0005, 0006, 0007, 0008, 0009, 0010) — still Accepted
- `assets/**` — all Meshy exports survive the pivot
- `package.json` — Colyseus deps not yet removed (deferred until after
  movement/camera rework verifies the core feel)

---

## Conventions to remember

- All client TypeScript: `src/**/*.ts` → transpile via `tsc -p tsconfig.client.json` → output `public/src/**/*.js`
- Local imports use `.js` extension in source: `import { foo } from './bar.js'` (TypeScript ESM convention)
- Bare specifiers (`'three'`, `'@dimforge/rapier3d-compat'`) resolve via importmap at runtime
- All gameplay values come from `assets/data/*.json` — never hardcoded
- All systems factory pattern: `createX(deps, config) => X` — no class hierarchies
- All `dispose()` is idempotent
- Animation update uses real elapsed time; physics uses fixed 1/60
- **No Colyseus, no netcode, no server-authoritative game logic** — the only
  server interaction is a single HTTP POST to `/api/runs` at run-end

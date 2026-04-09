# Active Session State

**Last Updated:** 2026-04-09
**Project:** Robot Crawler — Vibe Jam 2026 entry
**Jam Deadline:** 2026-05-01 @ 13:37 UTC (~22 days remaining)
**Review Mode:** Solo (`production/review-mode.txt`)
**Branch:** main
**Repo:** https://github.com/CarlosQ96/robot-crawler

---

## TL;DR — Where we are right now

**Phase:** Production / Vertical Slice 1 implementation
**Last commit ahead of session:** Movement (system 6/22)
**Build status:** `tsc -p tsconfig.client.json --noEmit` is clean (zero errors)
**Run command:** `npm run dev` → http://localhost:3000
**What works visually:** Engine boots, player robot model loads with idle anim, camera follows player, ground plane, shadows. Movement just landed but not visually verified yet.

---

## Resume protocol — read these in order if reopening

If a Claude Code session has died, follow these steps to recover full context:

1. **`CLAUDE.md`** — project overview, tech stack, jam constraints, collaboration protocol
2. **`design/gdd/game-concept.md`** — the game's vision and locked design decisions
3. **`design/gdd/systems-index.md`** — the 22 systems, dependency layers, design order, **progress tracker** (Status column shows what's Implemented vs Approved vs Not Started)
4. **`docs/architecture/`** — all 10 ADRs governing the architecture
5. **`docs/engine-reference/{threejs,rapier,colyseus}/`** — version-pinned API references
6. **`.claude/docs/technical-preferences.md`** — agent routing + project standards
7. **This file** — current task, recent decisions, blockers

After reading, run `git log --oneline | head -20` to see recent commits.

---

## Systems progress (live snapshot)

| # | System | Status | Spec | Code |
|---|---|---|---|---|
| 1 | Engine Bootstrap | ✅ **Implemented** | design/quick-specs/engine-bootstrap-2026-04-08.md | src/engine/bootstrap.ts |
| 2 | Input Manager | ✅ **Implemented** | design/quick-specs/input-manager-2026-04-08.md | src/engine/input.ts |
| 3 | Persistence Layer | ⚠ Not Started | — | — |
| 4 | Camera Rig | ✅ **Implemented** | design/quick-specs/camera-rig-2026-04-08.md | src/engine/camera-rig.ts |
| 5 | Animation Controller | ✅ **Implemented** | design/quick-specs/animation-controller-2026-04-08.md | src/engine/animation-controller.ts |
| 6 | Audio System | ⚠ Not Started | — | — |
| 7 | Lobby System | ⚠ Not Started | — | — |
| 8 | Player System | ✅ **Implemented** | design/quick-specs/player-system-2026-04-09.md | src/gameplay/player.ts |
| 9 | Settings | ⚠ Not Started | — | — |
| 10 | Movement | ✅ **Implemented** (just landed) | design/quick-specs/movement-2026-04-09.md | src/gameplay/movement.ts |
| 11 | Enemy System | ⚠ Not Started | — | — |
| 12 | Pickup System | ⚠ Not Started | — | — |
| 13 | Buster Combat | ⚠ Not Started — needs `/design-system` | — | — |
| 14 | Sub-Weapon System | ⚠ Not Started | — | — |
| 15 | Dungeon Generator | ⚠ Not Started — needs `/design-system` | — | — |
| 16 | Run Lifecycle | ⚠ Not Started | — | — |
| 17 | In-Room Sync | ⚠ Not Started — needs `/design-system` | — | — |
| 18 | HUD | ⚠ Not Started | — | — |
| 19 | Tutorial Overlays | ⚠ Not Started | — | — |
| 20 | Upgrade System | ⚠ Not Started | — | — |
| 21 | Run Results Screen | ⚠ Not Started | — | — |
| 22 | Ship Cockpit UI | ⚠ Not Started | — | — |

**Progress: 6 of 22 systems implemented (27%)** — all 6 are Vertical Slice 1 systems (the "WASD-movable player on screen" minimum).

---

## What just happened (last 24h of commits)

```
Movement (system 6/22) — gameplay-programmer agent       (this commit, in flight)
Player System (system 5/22) — gameplay-programmer agent  (2b626dc)
Camera Rig + Animation Controller (3+4 of 22) parallel   (f66fd58)
Input Manager (system 2/22) — engine-programmer agent    (6a0e67a)
Engine Bootstrap (system 1/22) implementation            (8ef19c5)
Movement spec + dev tooling scaffold                     (d28d6f6)
Player System spec                                       (24247ff)
Animation Controller spec + ADR fix                      (eb919bf)
10 ADRs + adopt TypeScript everywhere                    (b6341c5)
Systems index for Robot Crawler (22 systems)             (608ed9e)
Game concept doc                                         (3468434)
Tooling: Meshy → Draco compression pipeline              (a2088a1)
Init: robot crawler — vibe jam 2026                      (160dc10)
```

---

## Current task

**Vertical Slice 1 bug-fix pass in progress.** All 6 systems implemented; first playtest revealed 6 bugs, all fixed in commit `dce0e7f`. Re-test in progress.

### Bug fix log (2026-04-09 playtest)

| # | Bug | Fix |
|---|---|---|
| 1 | Player fell through ground | Added Rapier fixed body + cuboid collider to main.ts matching the visual ground |
| 2 | Player faced camera instead of away | `body.setRotation(180° around Y)` after createPlayer |
| 3 | Capsule tumbled on any WASD input | `setEnabledRotations(false, true, false, true)` — X/Z locked, Y enabled for yaw control |
| 4 | No strafe animations | Movement rotates body to face velocity direction (yaw-follow), always plays `walk` |
| 5 | Idle/walk clips swapped in feel | Swapped `clipMap` entries in player.json — Meshy labels were misleading |
| 6 | Jump had no anim + double-jump possible | Edge-triggered via `onActionPressed`, lockout flag prevents ground-window double-jump, `anim.play('jump')` added |

See `design/quick-specs/movement-2026-04-09.md` Implementation Addendum for the authoritative behavioral spec.

### Current control scheme (post-fix)

| Input | Behavior |
|---|---|
| **WASD** | Camera-relative movement; player rotates to face velocity direction (~180° in 0.31s at 10 rad/s) |
| **Space** | Jump when grounded; one jump per press; no double-jump |
| **Mouse** | Accumulates aim direction (read by future Buster Combat); does NOT rotate camera |
| **Release keys** | Player decelerates, returns to idle anim |

Camera is fixed third-person follow (Megaman Legends convention). Player rotates under a fixed camera. No strafe animations needed.

---

## Locked design decisions (don't re-litigate)

- **Concept:** Megaman Legends-inspired 3D dungeon crawler, co-op 1-3, score-attack with shareable seeds + per-seed leaderboards
- **3 game pillars:** (1) Buster combat is the whole game, (2) Every run is a score, (3) Co-op is pure cooperation
- **Boss room:** one fixed boss, NOT scaled by Journey Level
- **Sub-weapons:** dual source — built in ship OR found in dungeon. 4 in database (Spread Shot starter + Bomb Drop Arm + Grenade Launcher + Homing Buster)
- **Disconnect handling:** kicked to lobby with reconnect grace period
- **Camera:** fixed third-person follow (Megaman Legends style), swappable rig component for future
- **6 upgrade tracks:** Buster Damage, Charge Speed, Max HP, Armor Defense, Revival Count, Sub-Weapon Capacity
- **Tech stack:** Three.js r174 + Rapier 0.19 + Colyseus 0.17 + Railway Postgres
- **No bundler** (CDN importmap), TypeScript everywhere with per-file `tsc` transpile
- **Server-authoritative combat** (cannot be cheated)
- **Fixed Rapier timestep 1/60** for determinism + multiplayer sync

---

## Asset status (Meshy AI exports)

| Asset | Path | Status | Notes |
|---|---|---|---|
| Player model | `assets/models/player/robot_hero.glb` | ✅ committed (9.3 MB raw) | Has rig + placeholder clip; clips loaded from sibling file |
| Player animations | `assets/models/player/robot_hero_animations.glb` | ✅ committed (9.3 MB raw) | 13 clips: Idle_02, Walking, Running, RunFast, BeHit_FlyUp, Dead, Regular_Jump + 6 unused |
| Spider enemy | `assets/models/enemies/spider_enemy.glb` | ✅ committed (3.9 MB raw) | Single fused mesh, no rig — animate procedurally |
| Crystal pickup | `assets/models/pickups/crystal_shard.glb` | ✅ committed (48 KB) | No material — needs emissive shader later |
| Floor tile A | `assets/models/dungeon/_source/floor_tile_a.glb` | ✅ committed (3.0 MB raw) | Texture extraction needed |
| Floor tile B | `assets/models/dungeon/_source/floor_tile_b.glb` | ✅ committed (3.4 MB raw) | Texture extraction needed |

**TOTAL raw asset size: ~30 MB** — way over the jam 10 MB budget. Per user instruction: "don't worry about the models for now we testing with them." Re-compression via `npm run compress-models` is deferred. ADR-0005 will be enforced before submission.

---

## Known doc drift to fix later (non-blocking)

Some early docs still reference old version numbers from before I discovered version drift on npm:

- `CLAUDE.md` — TECH STACK section may say "Colyseus 0.15"
- `ADR-0002` — should be Colyseus 0.17, not 0.15
- `ADR-0007` — should be Rapier 0.19, not 0.14
- `design/tech-stack.md` — same fixes
- `docs/engine-reference/colyseus/COLYSEUS-0.15.md` — filename + content
- `docs/engine-reference/rapier/RAPIER-0.14.md` — filename + content

These are documentation only — they don't affect agent code generation because agents read the actual spec content and the package.json which has the correct versions. Fix in a single sweep when there's a natural break.

---

## Next 5 actions (ordered)

1. **Verify Movement visually** — `npm run dev` → http://localhost:3000 → test WASD + jump + camera follow + idle/walk anim transitions
2. **If working: commit "Vertical Slice 1 complete" milestone tag**
3. **Begin Vertical Slice 2:** combat. Next system = **Buster Combat (system 13/22)** — needs `/design-system` (full GDD, not quick-design — it's L effort and the game's pillar)
4. **In parallel:** **Audio System (system 6 in design order)** quick-design + implementation — many existing systems (Buster, Pickup, Player, Movement) want to play SFX cues but the audio bus is just stubbed in Engine Bootstrap
5. **In parallel:** **Enemy System** quick-design — needs spider enemy procedural animation pattern

After these, we'd have a "shoot-the-spider-and-collect-the-crystal" mini playable, which is 80% of the jam game.

---

## Open questions / blockers

None right now.

---

## Files in active work

- `src/gameplay/movement.ts` (just landed, not yet visually verified)
- `src/main.ts` (updated to wire Input + Movement)
- `production/session-state/active.md` (this file)

---

## Conventions to remember

- All client TypeScript: `src/**/*.ts` → transpile via `tsc -p tsconfig.client.json` → output `public/src/**/*.js`
- Local imports use `.js` extension in source: `import { foo } from './bar.js'` (TypeScript ESM convention)
- Bare specifiers (`'three'`, `'@dimforge/rapier3d-compat'`) resolve via importmap at runtime
- All gameplay values come from `assets/data/*.json` — never hardcoded
- All systems factory pattern: `createX(deps, config) => X` — no class hierarchies
- All `dispose()` is idempotent
- Animation update uses real elapsed time; physics uses fixed 1/60

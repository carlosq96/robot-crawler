# Active Session State

**Last Updated:** 2026-04-09 (end of session)
**Project:** Space Runner — Vibe Jam 2026 entry (internal repo: `robot-crawler`)
**Jam Deadline:** 2026-05-01 @ 13:37 UTC (~22 days remaining)
**Branch:** main
**Repo:** https://github.com/CarlosQ96/robot-crawler

---

## TL;DR — Where we are right now

**Phase:** Production — core game loop is functional.
**Last commit:** `836075a` (movement rework + 12 specs + split-export anims)
**Uncommitted work:** Bug fixes (death anim, retry, jump-over-obstacles, title idle, second-death anim fix) — NEEDS COMMIT.
**Build:** `tsc -p tsconfig.client.json --noEmit` is clean (zero errors)
**Run:** `npm run dev` → http://localhost:3000

**What works RIGHT NOW in the browser:**
- Title screen with START button
- Player auto-runs forward at 12 m/s
- A/D lateral dodge, Space jump, Shift slide
- 50 test obstacles on the runway (boulders, pillars, lava pits, spiders, crevasses)
- 100 star dust pickups (bobbing green octahedrons)
- On-touch death (any obstacle = instant death)
- Jump OVER obstacles to survive (Y-axis aware collision)
- Death animation holds last frame
- Results screen with score + RETRY button
- Retry resets player to origin and starts fresh run
- Score = distance + star dust collected

---

## Resume protocol — read these files in order

1. **`CLAUDE.md`** — project overview, tech stack (Space Runner, not Robot Crawler)
2. **`design/gdd/game-concept.md`** — the Space Runner concept + locked decisions
3. **`design/gdd/systems-index.md`** — 18 systems, which are implemented vs not
4. **This file** — current task, recent decisions, what's uncommitted
5. **`src/main.ts`** — the wiring hub. Every system is created and connected here.
6. **`src/gameplay/player.ts`** — Player entity. Has `reset()` for retry.
7. **`src/gameplay/movement.ts`** — Auto-run + lateral + jump + slide.
8. **`src/gameplay/obstacles.ts`** — Obstacle factory + distance-based death detection.
9. **`src/gameplay/pickups.ts`** — Star Dust factory + collection.
10. **`src/gameplay/run-lifecycle.ts`** — State machine: title → running → dead → results.
11. **`src/ui/title-screen.ts`** — DOM "SPACE RUNNER" + START button.
12. **`src/ui/results-screen.ts`** — DOM "RUN OVER" + stats + RETRY.
13. **`src/engine/animation-controller.ts`** — Has `holdOnFinish`, `timeScales`, `stopAll()`.
14. **`src/engine/camera-rig.ts`** — Chase-cam, world-space offset (no quaternion rotation).

---

## Systems progress

| # | System | Status |
|---|---|---|
| 1 | Engine Bootstrap | ✅ Implemented |
| 2 | Input Manager | ✅ Implemented |
| 3 | Persistence Layer | ⚠ Not Started (spec done) |
| 4 | Camera Rig | ✅ Implemented (chase-cam, world-space offset) |
| 5 | Animation Controller | ✅ Implemented (holdOnFinish, timeScales, stopAll) |
| 6 | Audio System | ⚠ Not Started (spec done) |
| 7 | Player System | ✅ Implemented (reset(), on-touch death) |
| 8 | Settings | ⚠ Not Started (T2, spec done) |
| 9 | Movement | ✅ Implemented (auto-run + lateral + jump + slide) |
| 10 | Obstacle System | ✅ Implemented (5 types, Y-aware collision) |
| 11 | Pickup System | ✅ Implemented (star dust, bobbing, collection) |
| 12 | Track Generator | ⚠ Not Started (spec done) — NEXT PRIORITY |
| 13 | Super-Suit Combat | ⚠ Not Started (spec done) |
| 14 | Planet/Checkpoint | ⚠ Not Started (spec done) |
| 15 | Run Lifecycle | ✅ Implemented (title→running→dead→results→retry) |
| 16 | HUD | ⚠ Not Started (spec done) |
| 17 | Tutorial Overlays | ⚠ Not Started (T2, spec done) |
| 18 | Run Results Screen | ✅ Implemented (DOM overlay, score, retry) |

**Progress: 11 of 18 systems implemented (61%)**
**All 18 systems have design specs in design/quick-specs/**

---

## Uncommitted changes (MUST COMMIT on next session start)

Files modified since last commit `836075a`:
- `src/gameplay/player.ts` — added `reset()` method, `stopAll()` before play
- `src/engine/animation-controller.ts` — added `stopAll()` public method
- `src/gameplay/obstacles.ts` — Y-axis aware collision (jump over obstacles)
- `src/main.ts` — wired run lifecycle, obstacles, pickups, title/results screens, retry flow, idle on title
- `assets/data/entities/player.json` — `holdOnFinish: ["jump", "death"]`
- `src/ui/title-screen.ts` — NEW (title screen DOM)
- `src/ui/results-screen.ts` — NEW (results screen DOM)
- `src/gameplay/run-lifecycle.ts` — NEW (state machine)
- `src/gameplay/obstacles.ts` — NEW (obstacle factory)
- `src/gameplay/pickups.ts` — NEW (star dust factory)
- `assets/data/run-lifecycle.json` — NEW
- `assets/data/obstacles.json` — NEW
- `assets/data/pickups.json` — NEW
- `public/styles/ui.css` — NEW
- `index.html` — updated title + CSS link

---

## Locked design decisions

- Game: Space Runner — solo 3D endless runner in space
- On-touch death (maxHp=1, any obstacle = instant death)
- Pickups called "Star Dust" (not crystals)
- Spider enemies are dodge-only obstacles (not killable)
- Jump over obstacles to survive (Y-axis collision)
- Three biomes: Rocky, Ice, Volcanic (recycled with rising difficulty)
- Score = distance + planetsCleared×500 + starDust×10 + obstaclesBroken×25
- Split-export animation pipeline (one GLB per clip, avoids Meshy bundler bug)
- No Colyseus, no multiplayer, solo only
- DOM overlays for UI (not Canvas2D, not Three.js)

---

## Next 5 actions (implementation order)

1. **COMMIT** the uncommitted bug fixes + new systems
2. **Track Generator** — procedural chunks replacing the hand-placed test obstacles. Spec: `design/quick-specs/track-generator-2026-04-09.md`. This is the biggest remaining system.
3. **HUD** — DOM overlay showing distance, star dust, score, planet label. Spec: `design/quick-specs/hud-2026-04-09.md`.
4. **Planet/Checkpoint** — jump-gate warp between planets, biome cycling. Spec: `design/quick-specs/planet-checkpoint-2026-04-09.md`.
5. **Audio System** — SFX + music buses. Spec: `design/quick-specs/audio-system-2026-04-09.md`.

After these 4 systems ship, the game is a complete playable loop with procedural content.

---

## Key data files

| File | Purpose |
|---|---|
| `assets/data/movement.json` | forwardSpeed, lateralSpeed, jumpVelocity, etc. |
| `assets/data/camera.json` | offsetX/Y/Z, followLerpFactor, lookLerpFactor |
| `assets/data/entities/player.json` | model URLs, clipMap, loopMap, holdOnFinish, timeScales |
| `assets/data/obstacles.json` | 5 obstacle types with mesh shapes + hitRadius |
| `assets/data/pickups.json` | stardust type with mesh + collectRadius + value |
| `assets/data/run-lifecycle.json` | deathHoldSec, scoreWeights |

---

## Known bugs / polish (deferred)

- Camera stutter on lateral dodge still present (minor — camera lerp tuning)
- Jump animation transition to sprint could be smoother
- Title screen player is in T-pose (no idle clip — need to import one or freeze sprint first frame)
- Obstacles are hand-placed (50 test obstacles) — Track Generator replaces this
- No HUD (score/distance not visible during gameplay)
- No audio
- No planet transitions (single continuous runway)

---

## Conventions

- TypeScript with .js import extensions (ESM)
- Factory pattern: createX(deps, config) => X
- Zero heap allocations in hot paths
- All gameplay values from JSON config files
- `npm run dev` = tsc watch + serve on port 3000
- `npx tsc -p tsconfig.client.json --noEmit` = type-check

# Game Concept — Space Runner

*Created: 2026-04-09 (pivot from Robot Crawler)*
*Status: Approved*
*Vibe Jam 2026 entry — deadline May 1 2026 @ 13:37 UTC*
*Internal repo name: `robot-crawler` (not renamed — see CLAUDE.md note)*

---

## Pivot Notice

On **2026-04-09**, the project pivoted from a Megaman Legends-inspired co-op
dungeon crawler ("Robot Crawler") to an endless space runner ("Space Runner").
The old concept and MML-era design documents are archived under
`design/archive/mml-dungeon-crawler/`.

**Why the pivot:** With 22 days left in the jam, the original scope carried
three L-effort systems (Buster Combat, Dungeon Generator, In-Room Sync netcode)
any one of which could blow the deadline. Space Runner reuses the six
already-implemented systems nearly as-is, drops all netcode and procedural
dungeon risk, and is a genre that solo devs can realistically ship in three
weeks. The pivot was a scope-first decision, not a creative disappointment.

**What we keep:** Tech stack (Three.js r174 + Rapier + TypeScript + CDN
importmap + Meshy asset pipeline), the six implemented systems (Engine
Bootstrap, Input Manager, Camera Rig, Animation Controller, Player System,
Movement — Movement needs rework), the robot hero model, all ADRs except
ADR-0002 (Colyseus) and ADR-0004 (server-authoritative combat) which are
superseded by this pivot.

---

## Elevator Pitch

A solo 3D endless runner. You're a robot bolting across hostile alien
planets, auto-sprinting forward and dodging lethal terrain. At each planet's
end, a **jump-gate warps you to the next planet** — a different biome, faster
speed, nastier hazards. You never stop. You never win. You die when your HP
runs out, and the number on the screen is how far you got.

---

## Core Identity

| Aspect | Detail |
|---|---|
| Genre | 3D endless runner / score-attack |
| Platform | Web browser (desktop, Chrome/Firefox/Safari) |
| Player Count | Solo only — no multiplayer |
| Session Length | 30 seconds to ~5 minutes per run |
| Monetization | None — free, no login, username only |
| Inspirations | Pepsi Man (PS1), Temple Run, Subway Surfers, Tron (visual) |
| Working Title | Space Runner (jam submission title) |
| Internal Repo | `robot-crawler` (not renamed; affects GitHub + Vercel + Railway URLs) |

---

## Core Fantasy

You're a robot explorer on a one-way express across the galaxy. Each planet
is a fresh obstacle course rolling at you — and you're already running before
you've seen the terrain. React, dodge, punch through the walls you can't
dodge. The jump-gate at the end of each planet is a promise: *"there's
another world coming, and it's harder."* You stop only when your circuits
give out.

---

## The Hook

**Endless + biome-hop.** Most endless runners put you on one surface forever.
Space Runner warps you to a **new planet** every ~60-90 seconds — new palette,
new hazards, faster base speed. Each run is a tour of the galaxy. The
leaderboard ranks players by total distance and planets cleared.

---

## Core Loop

- **1-3 seconds (moment-to-moment):** Auto-running forward. Dodge left,
  dodge right, jump, slide, or fire your Super Suit attack at a wall or
  enemy you can't dodge around.
- **60-90 seconds (planet segment):** Run one full planet. Dodge 40-60
  hazards, collect crystals, hit the jump-gate at the end → full HP restore,
  score bonus, +1 planet counter.
- **3-10 minutes (run):** Chain 3-8+ planets with rising difficulty until
  HP hits zero. Run ends; score posted to leaderboard.
- **10-30 minutes (session):** Multiple runs. Chase personal best. Climb
  the global leaderboard.

---

## Game Pillars (3 — non-negotiable)

1. **Feel over depth.** Every dodge, every jump, every slide must feel
   crisp. Input → visual response under 100 ms. No combos, no skill trees —
   just reaction and rhythm.
2. **Every planet is a fresh surprise.** Biomes differ visually *and*
   mechanically. No two adjacent planets should feel the same.
3. **The score is the whole game.** No unlockables that make you stronger.
   No meta-progression that trivializes future runs. Improvement comes from
   playing better, not grinding.

---

## Anti-Pillars (what this game is NOT)

- **NOT multiplayer** — solo only, no co-op, no PvP, no Colyseus rooms
- **NOT a roguelike** — no permadeath + meta currency, no item builds
- **NOT a platformer** — jumps are reactive, not puzzle-precision
- **NOT a fighting game** — Super Suit attack is a survival tool, not the point
- **NOT a story game** — no NPCs, no dialogue, no cutscenes beyond a jump-gate warp
- **NOT a 100-hour game** — mastered in an evening; replay is leaderboards

---

## Locked Design Decisions

Resolved 2026-04-09 during the pivot conversation. Do not re-litigate.

- **Movement model:** Free 3D lateral movement on a forward auto-running
  corridor (Pepsi Man style, **not** Temple Run 3-lane). Player controls
  lateral dodge continuously; forward speed is automatic.
- **Hit model:** One-hit death. Touching any obstacle ends the run
  immediately. No HP bar, no damage numbers, no healing.
  Superseded 2026-04-09 from an earlier HP-based design — simpler and
  more true to Pepsi Man / Temple Run than an HP crawl.
- **Planet structure:** Each planet is a single ~60-90-second forward
  segment ending in a jump-gate. Procedural obstacle layout per planet,
  pulled from a biome-specific template pool. Jump-gate is a fixed end
  marker, not a boss fight.
- **Endless mode:** True endless. No final boss, no "you win" screen. The
  game ends when HP reaches 0.
- **Super Suit (combat):** Always-on with cooldown timer (not a pickup).
  Activating the Super Suit briefly empowers the player: running-punch
  breaks certain obstacles and one-shots certain enemies. Cooldown ~8-12
  seconds. Meant for use on things you can't dodge, not as a primary verb.
- **Planet biomes (v1):** Three biomes — **Rocky**, **Ice**, **Volcanic** —
  recycled with rising difficulty. A fourth biome (Alien Jungle) is a T2
  stretch goal.
- **Pickups:** Crystals are **score only**. No crystal-to-power conversions,
  no crystal-activated super suit. Simpler = better for jam scope.
- **Camera:** Chase-cam locked behind and slightly above the player. Fixed
  angle. **FOV punches forward** on speed increase for a kinesthetic cue.
- **Solo only:** No Colyseus, no rooms, no matchmaking. Leaderboard is a
  simple POST to a single Postgres table (still hosted on Railway).
- **Jam submission title:** "Space Runner". Internal repo stays
  `robot-crawler` to avoid breaking GitHub + Vercel + Railway deploy URLs.

---

## MVP (must ship by May 1)

1. Auto-running player with lateral dodge, jump, slide
2. Three planet biomes (Rocky, Ice, Volcanic) with distinct palettes + hazards
3. Procedural obstacle placement per planet from biome templates
4. On-touch death (any obstacle contact → run ends)
5. Jump-gate checkpoint between planets + warp transition
6. Super Suit attack (one button, cooldown)
7. Crystal pickups + score accumulator
8. HUD: distance, crystals, super-suit cooldown, planet name
9. Title → run → death → results → retry loop
10. Global leaderboard via Postgres POST
11. Chase-cam with speed-based FOV punch

---

## Stretch (only if MVP is locked by Apr 25)

- **4th biome:** Alien Jungle
- **Enemies** (not just static hazards) — forward-patrolling drones the
  player can Super Suit-punch for score
- **Biome-specific music tracks**
- **Charged Super Suit** (hold-to-charge for a bigger hit)
- **Daily seed leaderboard** (same planet sequence for all players that day)
- **Cosmetic robot skins** unlocked by distance thresholds

---

## Top 3 Risks

1. **Feel tuning takes too long**
   → Fallback: lock reasonable values early; iterate only on movement
   friction, not input mapping. Set a "good enough" bar and move on.
2. **Procedural obstacle layouts produce unfair situations**
   → Fallback: hand-craft 4-6 obstacle template "chunks" per biome and
   randomize the chunk order. Trades variety for safety guarantee.
3. **Meshy AI can't generate biome-matching ground tiles fast enough**
   → Fallback: use simple PBR tiled materials (no unique mesh per biome);
   swap color / normal / roughness per biome.

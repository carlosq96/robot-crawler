# Game Concept — Robot Crawler

*Created: 2026-04-08*
*Status: Approved*
*Vibe Jam 2026 entry — deadline May 1 2026 @ 13:37 UTC*

---

## Elevator Pitch

A 3D dungeon crawler where you drop into procedurally generated robot ruins,
gun down enemies with your buster cannon, and race friends or strangers for
the best score on every dungeon seed.

---

## Core Identity

| Aspect | Detail |
|---|---|
| Genre | 3D action shooter / dungeon crawler / score-attack |
| Platform | Web browser (desktop, Chrome/Firefox/Safari) |
| Player Count | Solo or co-op 2-3 |
| Session Length | 5-15 min per run |
| Monetization | None — free, no login, username only |
| Inspirations | Megaman Legends (vibe + buster), Risk of Rain 2 (loop), Hades (run scoring) |

---

## Core Fantasy

You're a salvager pilot. Your ship is your home. Below you is a procedurally
generated robot ruin full of crystals, danger, and someone else's high score.
Drop in, blast through, climb the leaderboard, return to upgrade. The buster
on your arm is the only friend you need.

---

## The Hook

**Every dungeon is a competitive race.** Each procedural seed produces the
exact same dungeon for everyone. Clear it, publish your seed, and the
leaderboard tracks who blasted through fastest with the highest kill+crystal
score. Friends can race the seed you found yesterday.

---

## Core Loop

- **30 seconds (moment-to-moment)**: WASD movement, mouse aim, hold buster
  to charge, release to fire. Auto-lock-on biased toward aim direction. Pick
  up crystals as world drops.
- **5-15 minutes (run)**: Ship → pick seed → drop → fight 4-6 rooms →
  boss room → clear → score posted → return to ship.
- **30-90 minutes (session)**: Run several seeds, upgrade buster + armor
  between runs, climb leaderboards, share seeds you discovered.

---

## Game Pillars (3 — non-negotiable)

1. **Buster combat is the whole game.** Must feel crunchy and weighty in
   the first 5 seconds. Lock-on removes camera fight so players focus on
   positioning and charge timing.
2. **Every run is a score.** Every clear or fail produces a number. Numbers
   go on a leaderboard. Leaderboards are the meta-game.
3. **Co-op is pure cooperation.** No PvP, no grief, no FOMO. Friends play
   together, share crystals evenly, revive each other.

---

## Anti-Pillars (what this game is NOT)

- **NOT a roguelike** — no permadeath, no run-locked builds, no meta grind
- **NOT a walkable ship** — cockpit is a UI screen, not a 3D space
- **NOT a story game** — no NPCs, no dialogue, no cutscenes, no lore dumps
- **NOT a 100-hour game** — full content fits in one evening; replay value
  is leaderboards

---

## Locked Design Decisions

These were resolved 2026-04-08 before /map-systems:

- **Boss room**: one fixed boss type for the entire game. Not scaled by
  Journey Level. Difficulty comes from the dungeon path, not the boss tier.
- **Sub-weapon recipes**: dual source — recipes can be **built in the ship**
  from accumulated currency, **OR found as drops** while dungeon-crawling.
  Both paths feed the same sub-weapon inventory.
- **Disconnect handling**: disconnected player is kicked to lobby with a
  **reconnect option** during a grace period (e.g. 60s). Run continues for
  remaining players. If they reconnect in time, they rejoin in spectator
  mode and respawn at the next room transition.
- **Camera**: **fixed third-person follow** (Megaman Legends style) for the
  jam. The follow rig must be a swappable component — leave the architecture
  open to add a player-controlled orbit camera later if the fixed follow
  feels too dated in playtests.

---

## MVP (must ship by May 1)

1. Solo player with WASD + mouse aim
2. Buster cannon (energy infinite, hold-to-charge)
3. One sub-weapon slot (resource ammo; recipes built in ship OR found in dungeon)
4. One dungeon archetype with combat + resource room types
5. Boss room (one fixed boss type)
6. 3-5 enemy types
7. Crystal pickup + run-end score
8. Shareable seeds + per-seed leaderboard
9. Co-op 2-3 players via Colyseus, with disconnect-and-reconnect grace period
10. Ship cockpit UI: buster upgrades, armor upgrades, seed picker, sub-weapon crafting
11. Fixed third-person follow camera (swappable rig)

---

## Stretch (only if MVP is locked by Apr 22)

- Elite rooms (mid-tier mini-bosses)
- Second sub-weapon slot
- Custom shaders (charged buster glow, hit flash)
- Gamepad full support
- Player-controlled orbit camera as alternate option

---

## Top 3 Risks

1. **Multiplayer netcode harder than estimated**
   → Fallback: ship solo only; leaderboard still works
2. **Procgen quality slow to dial in**
   → Fallback: 3 hand-crafted dungeons; seeds become "variant" overlays
3. **Three.js perf on integrated GPUs**
   → Fallback: cap polycount, drop shadows, reduce texture resolution

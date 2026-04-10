# Quick Design Spec: Super-Suit Combat

**Type**: New Small System
**Scope**: The one combat verb in Space Runner. A single-button ability on a cooldown timer that briefly empowers the player's robot with a "super suit" state: during the active window, a forward-cone attack destroys breakable obstacles and one-shots any enemies in front of the player. Pure destruction, no damage dealt to the player. Does NOT own obstacle or enemy data (Obstacle System does).
**Date**: 2026-04-09
**Estimated Implementation**: ~3 hours (M effort)

---

## Overview

Super-Suit Combat is Space Runner's only combat mechanic. It's **not** the primary verb — dodging is. Super-Suit exists for the moments when the player sees a wall they can't dodge around, or wants a score bonus by breaking through obstacles. It is gated by a cooldown timer so players must *choose* when to use it; they can't spam it through every obstacle chunk.

When the player presses the `attack` action (mouse button 0 by default), if not on cooldown, the system enters the "super suit active" state for ~0.3 seconds. During this window, a forward-cone raycast query destroys every breakable obstacle within range. On exit, a 10-second cooldown begins. The HUD displays cooldown progress as a cooldown ring.

---

## Core Rules

### 1. State machine

States: `ready` → `active` → `cooldown` → `ready`

- **ready**: input enabled, cooldown at 0, player in base form. Pressing `attack` → `active`.
- **active**: 0.3 seconds. Input for `attack` ignored (cannot double-tap). On entry: play animation `punch` (or `jump` clip as placeholder — see rule 6), play SFX `super_suit`, immediately perform the attack sweep (rule 4). After the 0.3 s window: → `cooldown`.
- **cooldown**: 10 seconds. Input for `attack` ignored. HUD shows countdown. After 10 s: → `ready`.

### 2. Attack sweep (fired once on active-state entry)

Query the Obstacle System: `obstacleSystem.getObstaclesInRange(playerPos, 4.0)`.

Filter the returned handles:
- Keep only those forward of the player along -Z: `obstaclePos.z < playerPos.z`
- Keep only those within the attack cone: `|obstaclePos.x - playerPos.x| <= 3.0` (6 m wide corridor)
- Keep only those flagged `isBreakable === true`

For each kept handle:
1. Emit `onObstacleBroken(type)` for score
2. Call `obstacleSystem.despawn(handle)`
3. Accumulate broken-count for `onAttackResolved` event

After the sweep, emit `onAttackResolved(brokenCount, brokenObstacles)` — consumed by HUD for feedback flash.

**Note:** No enemies exist in v1 so the attack only hits obstacles. When Obstacle System's T2 enemy variant ships, the same sweep applies with `isKillable === true` filter (API reservation).

### 3. Cooldown rules

- Cooldown runs in real-time (seconds elapsed via `engine.onBeforeRender` real dt), not fixed-step
- Cooldown cannot be reset, skipped, or modified during gameplay
- `getCooldownFraction(): number` returns `elapsed / totalCooldown` in `[0, 1]`, with 1 meaning ready

### 4. Input gating

- Pressing `attack` during `cooldown` or `active` is silently ignored (no SFX, no animation, no feedback — avoids button-mashing "I did something!" confusion)
- Optional: a very small "denied" SFX could play on a denied press (deferred for polish)

### 5. Disable / pause

- `setEnabled(false)` freezes the current state AND pauses the cooldown timer
- On re-enable: resumes from the paused state
- Used by Planet/Checkpoint System during jump-gate warp so the cooldown doesn't tick during the transition

### 6. Animation placeholder

V1 does not ship a dedicated "punch" clip. The super-suit active window reuses the `jump` clip as a visual placeholder (arm movement-ish). When a proper attack animation is added to `player.json`'s `clipMap` as `"attack"`, this code switches to `player.anim.play('attack')` — one-line change.

### 7. Events

```ts
interface SuperSuitCombat {
  onAttackResolved(cb: (brokenCount: number, types: string[]) => void): () => void;
  onObstacleBroken(cb: (type: string) => void): () => void;
}
```

---

## Public API Surface (LOCKED contract)

```ts
export interface SuperSuitCombatConfig {
  cooldownSec: number;       // 10 default
  activeSec: number;         // 0.3 default
  attackRange: number;       // 4.0 default
  attackConeHalfWidth: number; // 3.0 default
}

export type SuperSuitState = 'ready' | 'active' | 'cooldown';

export interface SuperSuitCombat {
  getState(): SuperSuitState;
  getCooldownFraction(): number;   // 0 = just fired, 1 = ready
  setEnabled(enabled: boolean): void;
  onAttackResolved(cb: (brokenCount: number, types: string[]) => void): () => void;
  onObstacleBroken(cb: (type: string) => void): () => void;
  dispose(): void;
}

export function createSuperSuitCombat(
  engine: EngineHandle,
  player: Player,
  input: InputManager,
  obstacles: ObstacleSystem,
  audio: AudioSystem,
  config: SuperSuitCombatConfig,
): SuperSuitCombat;
```

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `cooldownSec` | 10.0 | 5–20 | balance | Long enough to force choice, short enough to feel useful |
| `activeSec` | 0.3 | 0.1–1.0 | feel | Instant feel; long enough for anim + SFX |
| `attackRange` | 4.0 m | 2–8 | feel | Covers ~2 chunk-widths ahead |
| `attackConeHalfWidth` | 3.0 m | 1–6 | balance | Wide enough for forward sweep, narrow enough to miss side obstacles |

All values live in `assets/data/super-suit.json`.

---

## Data Files

### `assets/data/super-suit.json`
```json
{
  "cooldownSec": 10.0,
  "activeSec": 0.3,
  "attackRange": 4.0,
  "attackConeHalfWidth": 3.0
}
```

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Input Manager | Reads `attack` action (added in Movement rework) | Already added |
| Obstacle System | Calls `getObstaclesInRange`, `despawn`, reads `isBreakable` | API already in Obstacle spec |
| Player System | Calls `player.anim.play('jump')` (placeholder) | No change |
| Audio System | Plays `super_suit` SFX | Already in Audio spec |
| HUD | Reads `getState()` and `getCooldownFraction()` for cooldown ring | Wired in HUD spec |
| Planet/Checkpoint | Calls `setEnabled(false/true)` during warp | Wired in Planet/Checkpoint spec |
| Run Lifecycle | Subscribes to `onObstacleBroken` for score bonus | Wired in Run Lifecycle spec |

---

## Acceptance Criteria

- [ ] Pressing `attack` from `ready` enters `active` for exactly 0.3 s, then `cooldown` for 10 s
- [ ] During `active`, all breakable obstacles in the forward 4 m × 6 m-wide cone are despawned
- [ ] Non-breakable obstacles in the cone are NOT destroyed
- [ ] Pressing `attack` during `cooldown` has no effect
- [ ] Pressing `attack` during `active` has no effect
- [ ] `getCooldownFraction()` transitions smoothly from 0 → 1 over 10 s during cooldown
- [ ] `setEnabled(false)` pauses the cooldown timer; `setEnabled(true)` resumes
- [ ] `onAttackResolved` fires exactly once per attack with the correct broken count
- [ ] Dispose unregisters the input subscription and cooldown tick

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #13, L4, T1, M-effort. No update needed.

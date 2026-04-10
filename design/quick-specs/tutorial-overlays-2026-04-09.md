# Quick Design Spec: Tutorial Overlays

**Type**: New Small System
**Scope**: First-run contextual hints shown as transparent text overlays during the player's first run. Dismissible (hit any key), never blocks input, never pauses the game. Remembers dismissal in localStorage so repeat players never see them. Four hints total: Dodge, Jump, Slide, Super Suit.
**Date**: 2026-04-09
**Estimated Implementation**: ~1.5 hours (S effort)
**Priority**: T2 (Ship If Time) — second to cut after Settings

---

## Overview

Tutorial Overlays ease first-time players into the four core verbs without a disruptive tutorial mode. Each hint is a small text overlay that fades in at a scripted moment during the first run, stays for ~4 seconds, and fades out. If the player performs the hinted action, the hint dismisses immediately and emits success feedback (small checkmark).

If the player has dismissed all hints (tracked in localStorage `spaceRunner.tutorialComplete`), the system is a no-op on subsequent runs.

---

## Core Rules

### 1. Hint definitions

```ts
const HINTS: Hint[] = [
  {
    id: 'dodge',
    text: 'A / D — DODGE',
    triggerAt: { runTimeSec: 2.0 },
    successAction: 'moveLeft' | 'moveRight',
    maxDurationSec: 4.0,
  },
  {
    id: 'jump',
    text: 'SPACE — JUMP',
    triggerAt: { runTimeSec: 8.0 },
    successAction: 'jump',
    maxDurationSec: 4.0,
  },
  {
    id: 'slide',
    text: 'SHIFT — SLIDE',
    triggerAt: { runTimeSec: 14.0 },
    successAction: 'slide',
    maxDurationSec: 4.0,
  },
  {
    id: 'attack',
    text: 'CLICK — SUPER SUIT',
    triggerAt: { runTimeSec: 20.0 },
    successAction: 'attack',
    maxDurationSec: 4.0,
  },
];
```

### 2. Lifecycle per hint

On creation, hints are all hidden + inactive.

Each frame (rAF):
1. For each hint not yet shown AND not yet dismissed:
   - If `runLifecycle.getStats().elapsedMs / 1000 >= hint.triggerAt.runTimeSec`:
     - Create a DOM overlay div with the hint text, positioned top-center
     - Fade in over 0.3 s
     - Start `maxDurationSec` timer
     - Subscribe to the relevant input action's `onActionPressed`
2. For each active hint:
   - If `maxDurationSec` elapsed: fade out, mark shown
   - If successAction fires: fade out + checkmark flash, mark shown AND successful

### 3. Visibility gate

Only visible during `runLifecycle.state === 'running'`. Hidden on state change. Never visible during `title`, `dead`, `results`.

### 4. One-shot completion

When all 4 hints have been shown at least once:
- Write `localStorage['spaceRunner.tutorialComplete'] = 'true'`
- On subsequent runs, skip hint creation entirely (no-op)

### 5. Skip all button (optional)

A small "skip tutorial" link on the title screen sets `tutorialComplete = true` without needing to play through. Deferred — low priority.

### 6. Dispose

- Removes any active hint DOM elements
- Unsubscribes from all input listeners
- Idempotent

---

## Public API Surface (LOCKED contract)

```ts
export interface TutorialOverlaysConfig {
  skipIfCompleted: boolean;  // true default — reads localStorage flag
}

export interface TutorialOverlays {
  start(): void;       // called on run start
  stop(): void;        // called on run end / title
  resetForTesting(): void;  // clears localStorage flag for QA
  dispose(): void;
}

export function createTutorialOverlays(
  input: InputManager,
  runLifecycle: RunLifecycle,
  config: TutorialOverlaysConfig,
): TutorialOverlays;
```

The factory subscribes to `runLifecycle.onStateChange` internally to auto-start/stop.

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| Hint trigger times | 2, 8, 14, 20 s | 1–30 | pacing | Spaced so the player experiences each verb in context |
| `maxDurationSec` per hint | 4.0 | 2–8 | readability | Long enough to read, short enough not to clutter |

Tuning lives in `assets/data/tutorial.json`.

---

## Data Files

### `assets/data/tutorial.json`
```json
{
  "hints": [
    { "id": "dodge",  "text": "A / D — DODGE",         "triggerAtSec":  2.0, "maxDurationSec": 4.0 },
    { "id": "jump",   "text": "SPACE — JUMP",          "triggerAtSec":  8.0, "maxDurationSec": 4.0 },
    { "id": "slide",  "text": "SHIFT — SLIDE",         "triggerAtSec": 14.0, "maxDurationSec": 4.0 },
    { "id": "attack", "text": "CLICK — SUPER SUIT",    "triggerAtSec": 20.0, "maxDurationSec": 4.0 }
  ]
}
```

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Input Manager | Subscribes to all four hint action presses | No change |
| Run Lifecycle | Polls `getStats().elapsedMs`, subscribes to `onStateChange` | No change |

---

## Acceptance Criteria

- [ ] First run: Dodge hint appears at t=2 s and stays up to 4 s OR until the player presses A/D
- [ ] Jump hint appears at t=8 s, similar behaviour
- [ ] Slide hint appears at t=14 s, similar behaviour
- [ ] Super Suit hint appears at t=20 s, similar behaviour
- [ ] Pressing the hinted action dismisses the hint with a checkmark flash
- [ ] All 4 hints completed → `localStorage['spaceRunner.tutorialComplete'] = 'true'`
- [ ] Second run (with flag set) shows zero hints
- [ ] `resetForTesting()` clears the flag
- [ ] Hints never block input
- [ ] Hints hidden in states other than `running`
- [ ] Dispose removes all overlays

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #17, L5, **T2**, S-effort. No update needed.

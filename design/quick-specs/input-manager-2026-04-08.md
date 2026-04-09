# Quick Design Spec: Input Manager

**Type**: New Small System
**Scope**: Read keyboard, mouse, and (stretch) gamepad input. Translate DOM events into named "actions" that gameplay systems can poll or subscribe to. Reads bindings from a data file. Has zero Three.js / Rapier / gameplay knowledge.
**Date**: 2026-04-08
**Estimated Implementation**: ~2 hours

---

## Overview

Input Manager is the abstraction layer between raw DOM events (`keydown`, `mousemove`, `mousedown`, `wheel`) and the gameplay systems that need to know "is the player trying to move forward right now?" It exposes two API styles: **polling** (`input.isActionDown('moveForward')` for held-state queries) and **event subscription** (`input.onActionPressed('shoot', cb)` for one-shot triggers). All key bindings are loaded from `assets/data/input-bindings.json` so we can rebind without recompiling and so the system is data-driven (per the `gameplay-code` rule).

This system has zero engine dependencies — it can be tested headlessly with synthetic DOM events.

---

## Core Rules

### 1. Action vocabulary

Input Manager exposes a fixed set of named actions. Gameplay systems consume actions by name; they never care which physical key triggered them.

| Action | Type | Default Binding | Used By |
|---|---|---|---|
| `moveForward` | digital | W | Movement |
| `moveBack` | digital | S | Movement |
| `moveLeft` | digital | A | Movement |
| `moveRight` | digital | D | Movement |
| `jump` | digital | Space | Movement (if jump is enabled) |
| `shoot` | digital | Mouse Left | Buster Combat |
| `chargeStart` | digital | Mouse Left held | Buster Combat |
| `chargeRelease` | digital | Mouse Left release | Buster Combat |
| `subWeapon` | digital | Mouse Right | Sub-Weapon System |
| `aimX` | analog (-1..1) | Mouse delta X | Buster Combat (lock-on bias) |
| `aimY` | analog (-1..1) | Mouse delta Y | Buster Combat (lock-on bias) |
| `interact` | digital | E | Pickup System (manual pickups, if any) |
| `pause` | digital | Escape | UI |
| `confirm` | digital | Enter | UI |
| `cancel` | digital | Escape | UI |

### 2. Two API styles

- **Polling** (cheap, frame-coherent): `input.isActionDown(action): boolean` and `input.getActionAxis(action): number`. Read at the start of each tick by Movement, Buster Combat, etc.
- **Event subscription** (one-shot): `input.onActionPressed(action, cb)` fires exactly once on the rising edge. `input.onActionReleased(action, cb)` fires exactly once on the falling edge. Returns an unsubscribe function.

### 3. Frame coherence

Mouse delta is **accumulated** across all `mousemove` events between polls, then reset on read. Gameplay reads `input.consumeMouseDelta()` once per fixed-step tick (1/60). Multiple reads in the same tick return zero on the second-and-later read.

### 4. Bindings are data-driven

`assets/data/input-bindings.json` maps action names to DOM key codes / mouse button indices:

```json
{
  "moveForward": { "type": "key", "code": "KeyW" },
  "shoot": { "type": "mouseButton", "button": 0 },
  "aimX": { "type": "mouseAxisX" },
  "subWeapon": { "type": "mouseButton", "button": 2 }
}
```

If the file is missing, the manager falls back to hardcoded defaults but logs a warning. **Never throw on missing bindings** — gameplay should still run.

### 5. Browser quirks handled

- `event.preventDefault()` on mouse buttons inside the canvas (prevent right-click menu)
- `tabindex="0"` on the canvas so it can receive keyboard focus
- Pointer lock for mouse aim (request on first canvas click; document only)
- Pause polling when document is hidden (`document.hidden` true) to avoid jitter on tab unfocus

### 6. Gamepad (stretch, only if time)

The gamepad layer is wired but inactive in v1. Architecture supports it: each action can also map to a gamepad button index or axis. Stretch only.

---

## Public API Surface

```ts
// src/engine/input.ts
export type ActionName =
  | 'moveForward' | 'moveBack' | 'moveLeft' | 'moveRight'
  | 'jump' | 'shoot' | 'chargeStart' | 'chargeRelease'
  | 'subWeapon' | 'aimX' | 'aimY'
  | 'interact' | 'pause' | 'confirm' | 'cancel';

export interface InputManager {
  // Polling API
  isActionDown(action: ActionName): boolean;
  getActionAxis(action: ActionName): number;       // -1..1 for analog actions
  consumeMouseDelta(): { dx: number; dy: number };  // resets accumulator on read
  getMousePosition(): { x: number; y: number };     // screen coords, current

  // Event API
  onActionPressed(action: ActionName, cb: () => void): () => void;  // unsubscribe fn
  onActionReleased(action: ActionName, cb: () => void): () => void;

  // Lifecycle
  dispose(): void;
}

export async function init(canvas: HTMLCanvasElement): Promise<InputManager>;
```

`init()` is async so it can `fetch('/assets/data/input-bindings.json')` before attaching event listeners.

---

## Tuning Knobs

All values live in `assets/data/input-bindings.json` (bindings) and `assets/data/input.json` (sensitivities) per the `gameplay-code` rule.

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `mouseSensitivityX` | `1.0` | 0.1 — 5.0 | feel | Aim sensitivity multiplier |
| `mouseSensitivityY` | `1.0` | 0.1 — 5.0 | feel | Aim sensitivity multiplier |
| `mouseInvertY` | `false` | bool | feel | Inverted vertical for some players |
| `mouseSmoothing` | `0.0` | 0.0 — 0.5 | feel | Low-pass filter on delta; 0 = raw |
| `gamepadDeadzone` | `0.15` | 0.0 — 0.3 | feel | Stick deadzone for stretch gamepad support |
| `pauseOnBlur` | `true` | bool | tech | Pause polling when tab unfocused |

---

## Acceptance Criteria

### Functional
- [ ] `init(canvas)` resolves with a valid `InputManager` after loading bindings
- [ ] `isActionDown('moveForward')` returns `true` while W is held, `false` otherwise
- [ ] `consumeMouseDelta()` returns accumulated delta since the last call; subsequent calls in same tick return zero
- [ ] `onActionPressed('shoot', cb)` fires the callback exactly once when LMB is pressed (rising edge)
- [ ] `onActionReleased('shoot', cb)` fires exactly once when LMB is released (falling edge)
- [ ] Multiple subscribers to the same action all receive the event
- [ ] Unsubscribe function actually removes the listener (verified by counter)
- [ ] Missing `input-bindings.json` falls back to defaults and logs a warning (does not throw)
- [ ] `dispose()` removes all DOM listeners (verified by event count before/after)

### Behavior
- [ ] Tab unfocus + refocus does NOT cause input to fire spuriously (paused on blur)
- [ ] Right-click does NOT show the browser context menu inside the canvas
- [ ] Pointer lock activates on first canvas click (mouse stays in canvas)
- [ ] Mouse delta respects `mouseSensitivityX/Y` from data file

### Architectural / Test
- [ ] Input Manager has NO imports from `three`, `@dimforge/rapier3d-compat`, or `src/gameplay/`
- [ ] Can be tested headlessly with synthetic `KeyboardEvent` / `MouseEvent` (no canvas needed for unit tests)
- [ ] All bindings load from JSON, no hardcoded keys (except fallback defaults)

---

## Constraining ADRs

| ADR | Constraint |
|---|---|
| ADR-0008 (TypeScript) | Source is `.ts`, output per-file `.js`; `ActionName` is a typed union for compile-time safety |

(No other ADRs constrain this system — Input Manager is intentionally decoupled from rendering, physics, and persistence.)

---

## Systems Index

Already in `design/gdd/systems-index.md` as **system #2** (Foundation, T1, L0, S effort). Update progress tracker to mark Input Manager as **Approved** after this spec is written.

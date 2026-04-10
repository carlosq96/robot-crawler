/**
 * @file src/engine/input.ts
 * @description Input Manager — translates raw DOM events (keyboard, mouse) into
 * named game actions. Exposes both a polling API (isActionDown, getActionAxis)
 * and an event-subscription API (onActionPressed, onActionReleased). All key
 * bindings are loaded from /assets/data/input-bindings.json; all sensitivity
 * tuning knobs are loaded from /assets/data/input.json. Falls back to
 * hardcoded defaults if either file is missing (warning logged, never throws).
 *
 * This module has ZERO engine or gameplay dependencies. It can be tested
 * headlessly with synthetic KeyboardEvent / MouseEvent instances.
 *
 * Constraining ADRs:
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports;
 *             ActionName is a typed union for compile-time safety
 *
 * @example
 * ```ts
 * import { init } from './engine/input.js';
 * const input = await init(document.getElementById('game-canvas') as HTMLCanvasElement);
 *
 * // Polling — called each fixed-step tick
 * if (input.isActionDown('moveForward')) { player.velocity.z -= speed; }
 *
 * // Event subscription — fires once on rising edge
 * const unsub = input.onActionPressed('shoot', () => { buster.fire(); });
 *
 * // Mouse aim — consume accumulated delta each tick
 * const { dx, dy } = input.consumeMouseDelta();
 * camera.rotation.y -= dx * AIM_SCALE;
 *
 * // Cleanup
 * input.dispose();
 * ```
 */

// ---------------------------------------------------------------------------
// Config schemas — mirrors assets/data/input-bindings.json and
// assets/data/input.json
// ---------------------------------------------------------------------------

/** Binding entry for a keyboard key. */
interface KeyBinding {
  type: 'key';
  code: string;
}

/** Binding entry for a mouse button. */
interface MouseButtonBinding {
  type: 'mouseButton';
  button: number;
}

/** Binding entry for mouse X-axis delta. */
interface MouseAxisXBinding {
  type: 'mouseAxisX';
}

/** Binding entry for mouse Y-axis delta. */
interface MouseAxisYBinding {
  type: 'mouseAxisY';
}

type ActionBinding =
  | KeyBinding
  | MouseButtonBinding
  | MouseAxisXBinding
  | MouseAxisYBinding;

/** Full bindings map from input-bindings.json. */
type BindingsConfig = Partial<Record<ActionName, ActionBinding>>;

/** Tuning knobs from input.json. */
interface InputConfig {
  mouseSensitivityX: number;
  mouseSensitivityY: number;
  mouseInvertY: boolean;
  mouseSmoothing: number;
  gamepadDeadzone: number;
  pauseOnBlur: boolean;
}

// ---------------------------------------------------------------------------
// Public API — LOCKED contract (every gameplay system depends on this
// interface). Changes here require an ADR.
// ---------------------------------------------------------------------------

/**
 * All named game actions exposed by the Input Manager.
 * Gameplay systems always refer to actions by name — never to raw key codes.
 */
export type ActionName =
  | 'moveForward'
  | 'moveBack'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'slide'
  | 'attack'
  | 'shoot'
  | 'chargeStart'
  | 'chargeRelease'
  | 'subWeapon'
  | 'aimX'
  | 'aimY'
  | 'interact'
  | 'pause'
  | 'confirm'
  | 'cancel';

/**
 * The Input Manager handle returned by {@link init}. Provides both polling
 * and event-subscription APIs for reading game actions.
 *
 * @example
 * ```ts
 * const input = await init(canvas);
 *
 * // Polling in fixed-step loop
 * const { dx, dy } = input.consumeMouseDelta();
 *
 * // One-shot subscription
 * const unsub = input.onActionPressed('jump', () => player.jump());
 * // Later:
 * unsub(); // detach listener
 *
 * input.dispose(); // remove all DOM listeners
 * ```
 */
export interface InputManager {
  /**
   * Returns true while the given action's physical input is held down.
   * For analog-only actions (aimX, aimY) always returns false — use
   * getActionAxis() instead.
   *
   * @param action - The action name to query.
   * @returns Whether the action is currently active.
   *
   * @example
   * ```ts
   * if (input.isActionDown('moveForward')) velocity.z -= SPEED * dt;
   * ```
   */
  isActionDown(action: ActionName): boolean;

  /**
   * Returns the analog value (-1..1) for the given action.
   * For digital actions, returns 1 when held and 0 otherwise.
   * For mouse-axis actions, returns the sensitivity-scaled accumulated
   * delta since the last consumeMouseDelta() call (NOT consumed here).
   *
   * @param action - The action name to query.
   * @returns Analog value in range -1..1 (or 0/1 for digital actions).
   *
   * @example
   * ```ts
   * const aimX = input.getActionAxis('aimX'); // mouse X delta, scaled
   * ```
   */
  getActionAxis(action: ActionName): number;

  /**
   * Returns the accumulated mouse delta since the last call to this method,
   * then resets the accumulator to zero. Sensitivity multipliers from
   * input.json are already applied. Call once per fixed-step tick.
   *
   * @returns Object with dx (horizontal) and dy (vertical) delta values.
   *
   * @example
   * ```ts
   * const { dx, dy } = input.consumeMouseDelta();
   * yaw -= dx * AIM_SCALE;
   * pitch -= dy * AIM_SCALE;
   * ```
   */
  consumeMouseDelta(): { dx: number; dy: number };

  /**
   * Returns the current mouse cursor position in screen (client) coordinates.
   * Not affected by pointer lock — always tracks the last known position.
   *
   * @returns Object with x and y screen coordinates.
   */
  getMousePosition(): { x: number; y: number };

  /**
   * Registers a callback that fires exactly once on the rising edge of the
   * given action (physical input transitions from released to pressed).
   * Multiple subscribers to the same action all receive the event.
   *
   * @param action - The action name to watch.
   * @param cb - Callback to invoke on press.
   * @returns A function that removes this listener when called.
   *
   * @example
   * ```ts
   * const unsub = input.onActionPressed('interact', () => pickup.tryPickup());
   * // Detach when leaving the dungeon room:
   * unsub();
   * ```
   */
  onActionPressed(action: ActionName, cb: () => void): () => void;

  /**
   * Registers a callback that fires exactly once on the falling edge of the
   * given action (physical input transitions from pressed to released).
   *
   * @param action - The action name to watch.
   * @param cb - Callback to invoke on release.
   * @returns A function that removes this listener when called.
   *
   * @example
   * ```ts
   * const unsub = input.onActionReleased('chargeRelease', () => buster.releaseCharge());
   * ```
   */
  onActionReleased(action: ActionName, cb: () => void): () => void;

  /**
   * Tears down the Input Manager: removes ALL DOM event listeners and clears
   * all subscriber registries. Idempotent — safe to call multiple times.
   *
   * @example
   * ```ts
   * // Hot-reload: dispose before re-initializing
   * input.dispose();
   * const newInput = await init(canvas);
   * ```
   */
  dispose(): void;
}

/**
 * Initialize the Input Manager. Fetches bindings from
 * /assets/data/input-bindings.json and config from /assets/data/input.json,
 * falls back to defaults if either is missing, then attaches DOM event
 * listeners to the document and the provided canvas.
 *
 * @param canvas - The <canvas> element used for pointer lock and context-menu
 *   suppression. Must be mounted in the DOM.
 * @returns A fully initialized InputManager.
 *
 * @example
 * ```ts
 * const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
 * const input = await init(canvas);
 * ```
 */
export async function init(canvas: HTMLCanvasElement): Promise<InputManager> {
  // -------------------------------------------------------------------------
  // Default bindings (fallback when input-bindings.json is missing)
  // -------------------------------------------------------------------------
  const DEFAULT_BINDINGS: Required<BindingsConfig> = {
    moveForward:   { type: 'key',         code: 'KeyW' },
    moveBack:      { type: 'key',         code: 'KeyS' },
    moveLeft:      { type: 'key',         code: 'KeyA' },
    moveRight:     { type: 'key',         code: 'KeyD' },
    jump:          { type: 'key',         code: 'Space' },
    slide:         { type: 'key',         code: 'ShiftLeft' },
    attack:        { type: 'mouseButton', button: 0 },
    shoot:         { type: 'mouseButton', button: 0 },
    chargeStart:   { type: 'mouseButton', button: 0 },
    chargeRelease: { type: 'mouseButton', button: 0 },
    subWeapon:     { type: 'mouseButton', button: 2 },
    interact:      { type: 'key',         code: 'KeyE' },
    pause:         { type: 'key',         code: 'Escape' },
    confirm:       { type: 'key',         code: 'Enter' },
    cancel:        { type: 'key',         code: 'Escape' },
    aimX:          { type: 'mouseAxisX' },
    aimY:          { type: 'mouseAxisY' },
  };

  const DEFAULT_INPUT_CONFIG: InputConfig = {
    mouseSensitivityX: 1.0,
    mouseSensitivityY: 1.0,
    mouseInvertY:      false,
    mouseSmoothing:    0.0,
    gamepadDeadzone:   0.15,
    pauseOnBlur:       true,
  };

  // -------------------------------------------------------------------------
  // Step 1 — Load bindings (never throw on missing file)
  // -------------------------------------------------------------------------
  let bindings: Required<BindingsConfig> = { ...DEFAULT_BINDINGS };

  try {
    const resp = await fetch('/assets/data/input-bindings.json');
    if (resp.ok) {
      const parsed = (await resp.json()) as BindingsConfig;
      bindings = { ...DEFAULT_BINDINGS, ...parsed };
    } else {
      console.warn(
        `[InputManager] /assets/data/input-bindings.json responded HTTP ${resp.status}. ` +
        'Using default bindings.',
      );
    }
  } catch (err) {
    console.warn(
      '[InputManager] Failed to load /assets/data/input-bindings.json. ' +
      'Using default bindings.',
      err,
    );
  }

  // -------------------------------------------------------------------------
  // Step 2 — Load sensitivity config (never throw on missing file)
  // -------------------------------------------------------------------------
  let inputConfig: InputConfig = { ...DEFAULT_INPUT_CONFIG };

  try {
    const resp = await fetch('/assets/data/input.json');
    if (resp.ok) {
      const parsed = (await resp.json()) as Partial<InputConfig>;
      inputConfig = { ...DEFAULT_INPUT_CONFIG, ...parsed };
    } else {
      console.warn(
        `[InputManager] /assets/data/input.json responded HTTP ${resp.status}. ` +
        'Using default input config.',
      );
    }
  } catch (err) {
    console.warn(
      '[InputManager] Failed to load /assets/data/input.json. ' +
      'Using default input config.',
      err,
    );
  }

  // -------------------------------------------------------------------------
  // Step 3 — Canvas focusability
  // -------------------------------------------------------------------------
  if (canvas.getAttribute('tabindex') === null) {
    canvas.setAttribute('tabindex', '0');
  }

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  /** Set of currently pressed keyboard codes (event.code values). */
  const keysDown = new Set<string>();

  /** Set of currently pressed mouse button indices. */
  const mouseButtonsDown = new Set<number>();

  /** Accumulated mouse delta since the last consumeMouseDelta() call. */
  const mouseDeltaAccumulator = { dx: 0, dy: 0 };

  /** Last known absolute cursor position in screen (client) coordinates. */
  const mousePosition = { x: 0, y: 0 };

  /**
   * Last absolute client position — used to compute delta when pointer is
   * NOT locked. Initialized to -1 so the first move event is skipped (avoids
   * a spurious jump from 0,0 to the real position).
   */
  let lastClientX = -1;
  let lastClientY = -1;

  /** Whether the document pointer is currently locked to the canvas. */
  let isPointerLocked = false;

  /**
   * Whether input polling is paused (tab unfocused, document hidden, etc.).
   * When paused, keydown/mousedown events are still recorded in keysDown /
   * mouseButtonsDown so state is consistent; but mousemove deltas are
   * discarded to prevent aim jitter on tab-switch.
   */
  let isPaused = false;

  /** Whether dispose() has been called. Guards against double-disposal. */
  let disposed = false;

  // -------------------------------------------------------------------------
  // Action state (computed from raw input state)
  // -------------------------------------------------------------------------

  /** Current pressed state for each action. */
  const actionState = new Map<ActionName, boolean>();

  /** Pressed state from the previous event cycle — used for edge detection. */
  const lastActionState = new Map<ActionName, boolean>();

  /** Current analog axis value for each action. */
  const actionAxes = new Map<ActionName, number>();

  // Initialize maps for all actions
  const ALL_ACTIONS: ActionName[] = [
    'moveForward', 'moveBack', 'moveLeft', 'moveRight',
    'jump', 'slide', 'attack',
    'shoot', 'chargeStart', 'chargeRelease',
    'subWeapon', 'aimX', 'aimY',
    'interact', 'pause', 'confirm', 'cancel',
  ];

  for (const action of ALL_ACTIONS) {
    actionState.set(action, false);
    lastActionState.set(action, false);
    actionAxes.set(action, 0);
  }

  // -------------------------------------------------------------------------
  // Subscriber registries
  // -------------------------------------------------------------------------

  const pressedSubscribers = new Map<ActionName, Array<() => void>>();
  const releasedSubscribers = new Map<ActionName, Array<() => void>>();

  for (const action of ALL_ACTIONS) {
    pressedSubscribers.set(action, []);
    releasedSubscribers.set(action, []);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Compute whether an action's binding is currently active, based on the
   * current keysDown and mouseButtonsDown sets. Analog-only actions always
   * return false here (they are not "digital" pressed states).
   */
  function computeActionDown(action: ActionName): boolean {
    const binding = bindings[action];
    if (!binding) return false;

    switch (binding.type) {
      case 'key':
        return keysDown.has(binding.code);
      case 'mouseButton':
        return mouseButtonsDown.has(binding.button);
      case 'mouseAxisX':
      case 'mouseAxisY':
        // Analog-only — not a pressed state
        return false;
    }
  }

  /**
   * Recompute actionState for all actions and fire pressed/released callbacks
   * for any action whose state changed since the last call. Should be invoked
   * after every key/button event.
   */
  function processEdges(): void {
    for (const action of ALL_ACTIONS) {
      const prev = lastActionState.get(action) ?? false;
      const curr = computeActionDown(action);
      actionState.set(action, curr);

      if (curr && !prev) {
        // Rising edge — fire pressed callbacks
        const subs = pressedSubscribers.get(action);
        if (subs) {
          for (const cb of subs) cb();
        }
      } else if (!curr && prev) {
        // Falling edge — fire released callbacks
        const subs = releasedSubscribers.get(action);
        if (subs) {
          for (const cb of subs) cb();
        }
      }

      lastActionState.set(action, curr);
    }
  }

  // -------------------------------------------------------------------------
  // DOM event handlers
  // -------------------------------------------------------------------------

  const onKeyDown = (event: KeyboardEvent): void => {
    // Do not add to keysDown if modifier-only (performance; not needed for actions)
    keysDown.add(event.code);
    processEdges();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    keysDown.delete(event.code);
    processEdges();
  };

  const onMouseDown = (event: MouseEvent): void => {
    mouseButtonsDown.add(event.button);
    processEdges();
  };

  const onMouseUp = (event: MouseEvent): void => {
    mouseButtonsDown.delete(event.button);
    processEdges();
  };

  const onMouseMove = (event: MouseEvent): void => {
    // Always track absolute position regardless of lock / pause state
    mousePosition.x = event.clientX;
    mousePosition.y = event.clientY;

    // Discard delta when paused (tab unfocused) to prevent aim jitter
    if (isPaused) {
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      return;
    }

    let rawDx: number;
    let rawDy: number;

    if (isPointerLocked) {
      // Pointer lock provides true movement deltas directly
      rawDx = event.movementX;
      rawDy = event.movementY;
    } else {
      // Compute delta from absolute position change
      if (lastClientX === -1) {
        // First move event — skip to avoid spurious jump
        lastClientX = event.clientX;
        lastClientY = event.clientY;
        return;
      }
      rawDx = event.clientX - lastClientX;
      rawDy = event.clientY - lastClientY;
      lastClientX = event.clientX;
      lastClientY = event.clientY;
    }

    // Apply sensitivity multipliers
    const scaledDx = rawDx * inputConfig.mouseSensitivityX;
    const scaledDy = rawDy * inputConfig.mouseSensitivityY * (inputConfig.mouseInvertY ? -1 : 1);

    // Apply smoothing (mouseSmoothing = 0 means raw; > 0 means LERP toward new value)
    if (inputConfig.mouseSmoothing > 0) {
      const t = 1 - inputConfig.mouseSmoothing;
      mouseDeltaAccumulator.dx = mouseDeltaAccumulator.dx * (1 - t) + scaledDx * t;
      mouseDeltaAccumulator.dy = mouseDeltaAccumulator.dy * (1 - t) + scaledDy * t;
    } else {
      mouseDeltaAccumulator.dx += scaledDx;
      mouseDeltaAccumulator.dy += scaledDy;
    }

    // Update axis values so getActionAxis('aimX/aimY') reflects the latest delta
    actionAxes.set('aimX', mouseDeltaAccumulator.dx);
    actionAxes.set('aimY', mouseDeltaAccumulator.dy);
  };

  const onContextMenu = (event: MouseEvent): void => {
    // Prevent right-click context menu inside the canvas
    if (event.target === canvas) {
      event.preventDefault();
    }
  };

  const onCanvasClick = (): void => {
    // Request pointer lock on first canvas click (must be user-gesture)
    if (!isPointerLocked && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  };

  const onPointerLockChange = (): void => {
    isPointerLocked = document.pointerLockElement === canvas;
    if (!isPointerLocked) {
      // Reset last position so next non-locked move doesn't teleport
      lastClientX = -1;
      lastClientY = -1;
    }
  };

  const onBlur = (): void => {
    if (inputConfig.pauseOnBlur) {
      isPaused = true;
      // Clear held state so keys do not appear stuck after tab switch
      keysDown.clear();
      mouseButtonsDown.clear();
      processEdges();
    }
  };

  const onFocus = (): void => {
    isPaused = false;
  };

  const onVisibilityChange = (): void => {
    if (document.hidden) {
      onBlur();
    } else {
      onFocus();
    }
  };

  // -------------------------------------------------------------------------
  // Attach DOM listeners
  // -------------------------------------------------------------------------

  document.addEventListener('keydown',          onKeyDown);
  document.addEventListener('keyup',            onKeyUp);
  document.addEventListener('mousedown',        onMouseDown);
  document.addEventListener('mouseup',          onMouseUp);
  document.addEventListener('mousemove',        onMouseMove);
  document.addEventListener('contextmenu',      onContextMenu);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur',               onBlur);
  window.addEventListener('focus',              onFocus);
  canvas.addEventListener('click',              onCanvasClick);

  // -------------------------------------------------------------------------
  // Assemble and return the InputManager
  // -------------------------------------------------------------------------

  const handle: InputManager = {
    isActionDown(action: ActionName): boolean {
      return actionState.get(action) ?? false;
    },

    getActionAxis(action: ActionName): number {
      const binding = bindings[action];
      if (!binding) return 0;

      // For analog mouse axes, return the current sensitivity-scaled accumulator
      if (binding.type === 'mouseAxisX') return mouseDeltaAccumulator.dx;
      if (binding.type === 'mouseAxisY') return mouseDeltaAccumulator.dy;

      // For digital actions, return 1 when held, 0 otherwise
      return (actionState.get(action) ?? false) ? 1 : 0;
    },

    consumeMouseDelta(): { dx: number; dy: number } {
      const result = { dx: mouseDeltaAccumulator.dx, dy: mouseDeltaAccumulator.dy };
      mouseDeltaAccumulator.dx = 0;
      mouseDeltaAccumulator.dy = 0;
      // Reset axis values so getActionAxis reflects the consumed state
      actionAxes.set('aimX', 0);
      actionAxes.set('aimY', 0);
      return result;
    },

    getMousePosition(): { x: number; y: number } {
      return { x: mousePosition.x, y: mousePosition.y };
    },

    onActionPressed(action: ActionName, cb: () => void): () => void {
      const subs = pressedSubscribers.get(action);
      if (!subs) return (): void => { /* no-op for unknown action */ };
      subs.push(cb);
      return (): void => {
        const idx = subs.indexOf(cb);
        if (idx !== -1) subs.splice(idx, 1);
      };
    },

    onActionReleased(action: ActionName, cb: () => void): () => void {
      const subs = releasedSubscribers.get(action);
      if (!subs) return (): void => { /* no-op for unknown action */ };
      subs.push(cb);
      return (): void => {
        const idx = subs.indexOf(cb);
        if (idx !== -1) subs.splice(idx, 1);
      };
    },

    dispose(): void {
      if (disposed) return; // idempotent
      disposed = true;

      document.removeEventListener('keydown',           onKeyDown);
      document.removeEventListener('keyup',             onKeyUp);
      document.removeEventListener('mousedown',         onMouseDown);
      document.removeEventListener('mouseup',           onMouseUp);
      document.removeEventListener('mousemove',         onMouseMove);
      document.removeEventListener('contextmenu',       onContextMenu);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('visibilitychange',  onVisibilityChange);
      window.removeEventListener('blur',                onBlur);
      window.removeEventListener('focus',               onFocus);
      canvas.removeEventListener('click',               onCanvasClick);

      // Clear all subscriber registries
      for (const action of ALL_ACTIONS) {
        pressedSubscribers.get(action)!.length = 0;
        releasedSubscribers.get(action)!.length = 0;
      }

      keysDown.clear();
      mouseButtonsDown.clear();
    },
  };

  return handle;
}

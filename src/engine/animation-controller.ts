/**
 * @file src/engine/animation-controller.ts
 * @description Animation Controller — a reusable wrapper around THREE.AnimationMixer
 * that exposes a state-machine API. Each animated entity (Player, Enemy, Boss) gets
 * one instance, configured via a per-entity JSON config that maps abstract state
 * names ("idle", "shoot", "hit") to actual GLB clip names.
 *
 * Features:
 *  - Named states with automatic crossfading
 *  - Loop vs. one-shot per state (from config)
 *  - One-shot states auto-return to returnState; "hit" returns to previous state
 *  - Animation events fired at configurable normalized times (0..1)
 *  - Multi-subscriber onEvent with unsubscribe
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — update() takes REAL elapsed time, NOT fixed step
 *             (animations are visual, decoupled from physics simulation)
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports; strict mode
 *
 * Design spec: design/quick-specs/animation-controller-2026-04-08.md
 *
 * @example
 * ```ts
 * import { createAnimationController } from './engine/animation-controller.js';
 *
 * const gltf = await engine.loadGLTF('/assets/models/player.glb');
 * const config = await fetch('/assets/data/entities/player.json').then(r => r.json());
 * const anim = createAnimationController(gltf.scene, gltf.animations, config.animation);
 *
 * // Wire into the engine's per-render-frame hook (real dt, not fixed step)
 * engine.onBeforeRender((dt) => anim.update(dt));
 *
 * // Play states
 * anim.play('idle');
 * anim.play('walk');          // crossfades over defaultCrossfade seconds
 * anim.play('shoot');         // one-shot — auto-returns to 'idle' when done
 * anim.play('hit');           // one-shot — auto-returns to previous state
 *
 * // Animation events
 * const unsub = anim.onEvent('shoot.fire', () => spawnProjectile());
 * // Later:
 * unsub(); // remove listener
 *
 * // Query
 * anim.getCurrentState();     // "walk"
 * anim.isPlaying('walk');     // true
 *
 * // Cleanup
 * anim.dispose();
 * ```
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Public API types — LOCKED contract (per spec section "Public API Surface")
// ---------------------------------------------------------------------------

/**
 * Per-entity animation configuration. Passed into createAnimationController()
 * at construction time. Typically loaded from assets/data/entities/[entity].json.
 *
 * @example
 * ```json
 * {
 *   "clipMap": { "idle": "Idle_02", "walk": "Walking", "hit": "BeHit_FlyUp" },
 *   "loopMap": { "idle": true, "walk": true, "hit": false },
 *   "returnState": "idle",
 *   "defaultCrossfade": 0.2,
 *   "crossfadeOverrides": { "hit": 0.05 },
 *   "events": [{ "state": "shoot", "normalizedTime": 0.3, "name": "shoot.fire" }]
 * }
 * ```
 */
export interface AnimationControllerConfig {
  /** Maps abstract state names to actual GLB clip names. */
  clipMap: Record<string, string>;
  /** Whether each state loops. true → LoopRepeat; false → LoopOnce + clampWhenFinished. */
  loopMap: Record<string, boolean>;
  /** State to return to after any one-shot (except "hit" which returns to previous). */
  returnState: string;
  /** Default crossfade duration in seconds. */
  defaultCrossfade: number;
  /** Per-state crossfade overrides (take priority over defaultCrossfade). */
  crossfadeOverrides?: Record<string, number>;
  /** Animation events to fire at normalized timestamps within specific states. */
  events?: AnimationEventDef[];
}

/**
 * Declares an animation event that fires when a clip crosses a normalized time threshold.
 *
 * @example
 * ```ts
 * // Fires when "shoot" clip reaches 30% completion
 * { state: "shoot", normalizedTime: 0.3, name: "shoot.fire" }
 * ```
 */
export interface AnimationEventDef {
  /** The state name this event belongs to. */
  state: string;
  /** Normalized time (0..1) at which to fire the event. */
  normalizedTime: number;
  /** Event name used to subscribe via onEvent(). */
  name: string;
}

/**
 * The Animation Controller handle returned by {@link createAnimationController}.
 * One instance per animated entity; independent instances do NOT share state.
 *
 * @example
 * ```ts
 * const anim = createAnimationController(mesh, clips, config);
 *
 * // Typical movement code (called each fixed-step tick)
 * if (isMoving) {
 *   if (anim.getCurrentState() !== 'walk') anim.play('walk');
 * } else {
 *   if (anim.getCurrentState() !== 'idle') anim.play('idle');
 * }
 *
 * // Typical combat code
 * anim.onEvent('shoot.fire', () => combatSystem.spawnBusterShot(player));
 * input.onActionPressed('shoot', () => anim.play('shoot'));
 * ```
 */
export interface AnimationController {
  /**
   * Transition to the named state. Crossfades from the current state over
   * crossfadeOverrides[state] ?? options.crossfade ?? defaultCrossfade seconds.
   * No-op if state is already current. Logs a warning if state is unknown.
   *
   * @param state - Abstract state name (must be a key in config.clipMap).
   * @param options - Optional crossfade override for this specific call.
   *
   * @example
   * ```ts
   * anim.play('walk');
   * anim.play('shoot', { crossfade: 0.0 }); // instant cut
   * ```
   */
  play(state: string, options?: { crossfade?: number }): void;

  /**
   * Returns the currently active state name, or null if nothing has been played yet.
   *
   * @example
   * ```ts
   * if (anim.getCurrentState() !== 'idle') anim.play('idle');
   * ```
   */
  getCurrentState(): string | null;

  /**
   * Returns true if the given state is the currently active state.
   *
   * @param state - State name to check.
   *
   * @example
   * ```ts
   * if (!anim.isPlaying('walk')) anim.play('walk');
   * ```
   */
  isPlaying(state: string): boolean;

  /**
   * Subscribe to a named animation event. The callback fires each time the
   * event's normalizedTime threshold is crossed during update().
   * Multiple subscribers to the same event all receive it.
   *
   * @param eventName - The event name from config.events[].name.
   * @param cb - Callback to invoke when the event fires.
   * @returns An unsubscribe function. Call it to remove this listener.
   *
   * @example
   * ```ts
   * const unsub = anim.onEvent('shoot.fire', () => spawnProjectile());
   * // Remove when leaving the dungeon:
   * unsub();
   * ```
   */
  onEvent(eventName: string, cb: () => void): () => void;

  /**
   * Advance the animation mixer by real elapsed time. Must be called once per
   * render frame from engine.onBeforeRender(). Uses REAL dt, NOT the fixed
   * physics step — per ADR-0007, animations are visual and must be smooth at
   * native frame rate.
   *
   * @param realDt - Seconds elapsed since the last render frame.
   *
   * @example
   * ```ts
   * engine.onBeforeRender((dt) => anim.update(dt));
   * ```
   */
  update(realDt: number): void;

  /**
   * Tear down the controller: stops all actions, uncaches mixer state, removes
   * the finished listener, clears subscriber registries. Idempotent — safe to
   * call multiple times.
   *
   * @example
   * ```ts
   * // When the enemy is destroyed:
   * anim.dispose();
   * ```
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal type for THREE.AnimationMixer's 'finished' event
// Three.js dispatches an event object with action and direction properties.
// ---------------------------------------------------------------------------

interface MixerFinishedEvent {
  action: THREE.AnimationAction;
  direction: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an Animation Controller for a mesh hierarchy.
 *
 * Initialization:
 *  1. Creates a THREE.AnimationMixer bound to `mesh`
 *  2. For each state in config.clipMap, finds the matching clip by name
 *     (warns + falls back to first available clip for "idle" if not found)
 *  3. Pre-creates all AnimationActions and configures loop modes
 *
 * @param mesh - The root Object3D with the skeleton/bones (e.g. gltf.scene).
 * @param clips - Array of AnimationClips from the loaded GLB (e.g. gltf.animations).
 * @param config - Per-entity animation configuration.
 * @returns A fully initialized AnimationController.
 *
 * @example
 * ```ts
 * const gltf = await engine.loadGLTF('/assets/models/player/robot_hero.glb');
 * const playerConfig = await fetch('/assets/data/entities/player.json').then(r => r.json());
 * const anim = createAnimationController(gltf.scene, gltf.animations, playerConfig.animation);
 * engine.onBeforeRender((dt) => anim.update(dt));
 * anim.play('idle');
 * ```
 */
export function createAnimationController(
  mesh: THREE.Object3D,
  clips: THREE.AnimationClip[],
  config: AnimationControllerConfig,
): AnimationController {
  // -------------------------------------------------------------------------
  // Step 1 — Create mixer
  // -------------------------------------------------------------------------
  const mixer = new THREE.AnimationMixer(mesh);

  // -------------------------------------------------------------------------
  // Step 2 — Resolve clips and pre-create actions
  //
  // For each entry in clipMap, find the matching THREE.AnimationClip by name.
  // If not found:
  //   - "idle" state → warn and use the first available clip as fallback
  //   - any other state → warn, store null (play() will ignore at runtime)
  // -------------------------------------------------------------------------
  const actionMap = new Map<string, THREE.AnimationAction>();

  for (const [stateName, clipName] of Object.entries(config.clipMap)) {
    let clip: THREE.AnimationClip | null = THREE.AnimationClip.findByName(clips, clipName);

    if (!clip) {
      if (stateName === 'idle' && clips.length > 0) {
        console.warn(
          `[AnimationController] Clip "${clipName}" not found for state "${stateName}". ` +
          `Falling back to first available clip: "${clips[0].name}".`,
        );
        clip = clips[0];
      } else {
        console.warn(
          `[AnimationController] Clip "${clipName}" not found for state "${stateName}". ` +
          `play("${stateName}") will be ignored at runtime.`,
        );
        continue; // do not create an action for this state
      }
    }

    const action = mixer.clipAction(clip);

    // Configure loop mode from loopMap
    const shouldLoop = config.loopMap[stateName] ?? true;
    if (shouldLoop) {
      action.setLoop(THREE.LoopRepeat, Infinity);
    } else {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }

    actionMap.set(stateName, action);
  }

  // -------------------------------------------------------------------------
  // State machine bookkeeping
  // -------------------------------------------------------------------------
  let currentState: string | null = null;
  let previousState: string | null = null;

  // -------------------------------------------------------------------------
  // Per-state last normalized time (for animation event threshold detection)
  // Keyed by state name.
  // -------------------------------------------------------------------------
  const lastNormalizedTime = new Map<string, number>();

  // -------------------------------------------------------------------------
  // Event subscriber registry
  // Keyed by event name → array of callbacks.
  // -------------------------------------------------------------------------
  const eventSubscribers = new Map<string, Array<() => void>>();

  // Pre-populate registry for events declared in config
  if (config.events) {
    for (const evtDef of config.events) {
      if (!eventSubscribers.has(evtDef.name)) {
        eventSubscribers.set(evtDef.name, []);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dispose guard
  // -------------------------------------------------------------------------
  let disposed = false;

  // -------------------------------------------------------------------------
  // mixer 'finished' event handler
  //
  // Fires when a LoopOnce action reaches its end. We check if the finished
  // action matches the current state's action and, if so, transition:
  //   - "hit" state → return to previousState (the state before hit was played)
  //   - any other one-shot → return to config.returnState
  // -------------------------------------------------------------------------
  const onMixerFinished = (e: MixerFinishedEvent): void => {
    if (disposed) return;

    const finishedState = currentState;
    if (finishedState === null) return;

    const finishedAction = actionMap.get(finishedState);
    if (finishedAction !== e.action) return; // some other action finished, ignore

    // Determine return target
    let targetState: string;
    if (finishedState === 'hit' && previousState !== null) {
      targetState = previousState;
    } else {
      targetState = config.returnState;
    }

    // Guard: returnState must be in actionMap
    if (!actionMap.has(targetState)) {
      console.warn(
        `[AnimationController] One-shot "${finishedState}" finished but ` +
        `return state "${targetState}" is not in clipMap. Staying in current state.`,
      );
      return;
    }

    // Transition without crossfade on completion (instant snap or default — use
    // crossfadeOverrides[targetState] if available, else defaultCrossfade)
    play(targetState);
  };

  // THREE.AnimationMixer uses generic EventDispatcher.addEventListener with
  // (type: string, listener: (event: Event) => void). We cast through unknown
  // to satisfy the typed signature while keeping our own typed handler.
  mixer.addEventListener('finished', onMixerFinished as unknown as (event: THREE.Event) => void);

  // -------------------------------------------------------------------------
  // play() — internal implementation (shared by public API and onMixerFinished)
  // -------------------------------------------------------------------------
  function play(state: string, options?: { crossfade?: number }): void {
    if (disposed) return;

    if (!actionMap.has(state)) {
      console.warn(
        `[AnimationController] play("${state}") ignored — state not in clipMap.`,
      );
      return;
    }

    // No-op if already in this state
    if (state === currentState) return;

    // Determine crossfade duration (priority: config override > call option > default)
    const crossfadeDuration =
      config.crossfadeOverrides?.[state] ??
      options?.crossfade ??
      config.defaultCrossfade;

    const newAction = actionMap.get(state)!;
    const previousAction = currentState !== null ? actionMap.get(currentState) : null;

    // Reset and play the new action
    newAction.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();

    // Crossfade from previous to new
    if (previousAction !== undefined && previousAction !== null) {
      previousAction.crossFadeTo(newAction, crossfadeDuration, false);
    }

    // Update state tracking — save previous before overwriting current
    previousState = currentState;
    currentState = state;

    // Reset normalized time tracking for the new state so events fire correctly
    lastNormalizedTime.set(state, 0);
  }

  // -------------------------------------------------------------------------
  // update() — advances mixer + polls animation events
  // -------------------------------------------------------------------------
  function update(realDt: number): void {
    if (disposed) return;

    // Advance mixer by real elapsed time (ADR-0007: animations are visual,
    // NOT tied to the fixed Rapier physics step)
    mixer.update(realDt);

    // Poll animation events for the current state
    if (currentState === null) return;
    if (!config.events || config.events.length === 0) return;

    const action = actionMap.get(currentState);
    if (!action) return;

    const clip = action.getClip();
    const clipDuration = clip.duration;
    if (clipDuration <= 0) return;

    // Current normalized time in [0, 1). Use modulo for looping clips.
    const currentNorm = (action.time / clipDuration) % 1;
    const lastNorm = lastNormalizedTime.get(currentState) ?? 0;

    for (const evtDef of config.events) {
      if (evtDef.state !== currentState) continue;

      const threshold = evtDef.normalizedTime;
      const subscribers = eventSubscribers.get(evtDef.name);
      if (!subscribers || subscribers.length === 0) continue;

      // Detect threshold crossing. Two cases:
      //   Normal forward pass:  lastNorm < threshold <= currentNorm
      //   Loop wrap-around:     lastNorm > currentNorm (clip looped back past 0)
      //                         → threshold > lastNorm OR threshold <= currentNorm
      const wrapped = lastNorm > currentNorm;
      const crossed = wrapped
        ? threshold > lastNorm || threshold <= currentNorm
        : lastNorm < threshold && threshold <= currentNorm;

      if (crossed) {
        // Fire all subscribers for this event
        for (const cb of subscribers) cb();
      }
    }

    // Store current normalized time for next frame comparison
    lastNormalizedTime.set(currentState, currentNorm);
  }

  // -------------------------------------------------------------------------
  // Assemble and return the AnimationController handle
  // -------------------------------------------------------------------------
  const handle: AnimationController = {
    play(state: string, options?: { crossfade?: number }): void {
      play(state, options);
    },

    getCurrentState(): string | null {
      return currentState;
    },

    isPlaying(state: string): boolean {
      return currentState === state;
    },

    onEvent(eventName: string, cb: () => void): () => void {
      // Lazily create subscriber list (supports typo'd event names — they just
      // never fire, per spec section 9: "failure handling")
      let subs = eventSubscribers.get(eventName);
      if (!subs) {
        subs = [];
        eventSubscribers.set(eventName, subs);
      }
      subs.push(cb);
      return (): void => {
        const idx = subs!.indexOf(cb);
        if (idx !== -1) subs!.splice(idx, 1);
      };
    },

    update(realDt: number): void {
      update(realDt);
    },

    dispose(): void {
      if (disposed) return; // idempotent

      disposed = true;

      // Remove the 'finished' listener before stopping actions
      mixer.removeEventListener(
        'finished',
        onMixerFinished as unknown as (event: THREE.Event) => void,
      );

      // Stop all tracked actions
      for (const action of actionMap.values()) {
        action.stop();
      }

      // Uncache mixer state for all clips (frees internal mixer cache)
      for (const action of actionMap.values()) {
        mixer.uncacheClip(action.getClip());
      }
      mixer.uncacheRoot(mesh);

      // Clear all subscriber registries
      eventSubscribers.clear();

      // Clear action map and state
      actionMap.clear();
      lastNormalizedTime.clear();
      currentState = null;
      previousState = null;
    },
  };

  return handle;
}

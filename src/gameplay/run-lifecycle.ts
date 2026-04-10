/**
 * @file src/gameplay/run-lifecycle.ts
 * @description Run Lifecycle System — owns the top-level game run state machine and
 * all per-run statistics. Coordinates the transitions between title, running, dead,
 * and results states, enforcing valid transitions and emitting typed events for
 * downstream systems (HUD, Results screen, Audio) to react to.
 *
 * Implements spec: design/gdd/run-lifecycle.md (system #6 of 22)
 *
 * State machine transition table:
 *   title   → running  : start(seed) called
 *   running → dead     : player.onDeath fires
 *   dead    → results  : deathHoldSec elapsed (timed in onBeforeRender)
 *   results → running  : retry(seed) called
 *   results → title    : toTitle() called
 *   All other transitions: rejected with console.warn, no-op
 *
 * Statistics are zeroed on every start()/retry() and updated via:
 *   - onBeforeRender: distance (from body.translation().z) and elapsedMs
 *   - reportPickup(value):    crystalsCollected += 1
 *   - reportPlanetCleared():  planetsCleared += 1
 *   - reportObstacleBroken(): obstaclesBroken += 1
 *
 * Score formula (all weights from config):
 *   score = distance * weights.distance
 *         + planetsCleared * weights.planetsCleared
 *         + crystalsCollected * weights.crystalsCollected
 *         + obstaclesBroken * weights.obstaclesBroken
 *
 * Data-driven: ALL numeric values come from the RunLifecycleConfig parameter
 * (loaded from assets/data/run-lifecycle.json by the caller). Zero hardcoded
 * gameplay values.
 *
 * Constraining ADRs:
 *   ADR-0007  Fixed Rapier timestep — distance is sampled in onBeforeRender (real
 *             dt), NOT in onBeforeStep. Distance is a derived read, not a physics
 *             mutation, so render-rate sampling is correct here.
 *   ADR-0008  TypeScript everywhere — .js extensions on local imports; strict mode
 *
 * @example
 * ```ts
 * const config = await fetch('/assets/data/run-lifecycle.json').then(r => r.json());
 * const lifecycle = createRunLifecycle({ engine, player }, config);
 *
 * lifecycle.onStateChange((from, to) => console.log(`${from} → ${to}`));
 * lifecycle.onResultsReady((stats) => resultsScreen.show(stats));
 *
 * lifecycle.start('seed-abc123');
 * ```
 */

import type { EngineHandle } from '../engine/bootstrap.js';
import type { Player } from './player.js';

// ---------------------------------------------------------------------------
// Public API — all types exported for downstream system consumption (HUD, UI).
// ---------------------------------------------------------------------------

/** Union of all valid run lifecycle states. */
export type RunState = 'title' | 'running' | 'dead' | 'results';

/**
 * Snapshot of all per-run statistics. Emitted via {@link RunLifecycle.onResultsReady}
 * and readable at any time via {@link RunLifecycle.getStats}.
 *
 * All counters are zeroed at start()/retry() and accumulate over the run.
 */
export interface RunStats {
  /** Wall-clock milliseconds from run start to player death. */
  elapsedMs: number;
  /** Furthest negative-Z distance the player reached (integer metres). */
  distance: number;
  /** Number of planets the player cleared (reported externally). */
  planetsCleared: number;
  /** Number of crystal pickups collected (reported externally). */
  crystalsCollected: number;
  /** Number of breakable obstacles destroyed (reported externally). */
  obstaclesBroken: number;
  /** Composite score computed from the above fields and config weights. */
  score: number;
}

/**
 * Configuration passed to {@link createRunLifecycle}. Loaded from
 * assets/data/run-lifecycle.json by the caller. No defaults are applied here —
 * all fields are required in the JSON.
 */
export interface RunLifecycleConfig {
  /**
   * Seconds to hold in the 'dead' state before automatically advancing to 'results'.
   * Gives the death animation time to play. Default in JSON: 1.5.
   */
  deathHoldSec: number;
  /**
   * Per-metric multipliers used in the score formula:
   *   score = distance * distance
   *         + planetsCleared * planetsCleared
   *         + crystalsCollected * crystalsCollected
   *         + obstaclesBroken * obstaclesBroken
   */
  scoreWeights: {
    distance: number;
    planetsCleared: number;
    crystalsCollected: number;
    obstaclesBroken: number;
  };
}

/**
 * Dependencies injected into {@link createRunLifecycle}. Caller owns these
 * instances and is responsible for their lifecycle.
 */
export interface RunLifecycleDeps {
  /** Engine handle from bootstrap.init() — used for onBeforeRender hook. */
  engine: EngineHandle;
  /** Player handle — used to subscribe to onDeath. */
  player: Player;
}

/**
 * The RunLifecycle handle returned by {@link createRunLifecycle}.
 *
 * External systems interact with the lifecycle exclusively through this interface:
 *   - Read state / stats: getState(), getStats()
 *   - Drive transitions: start(), retry(), toTitle()
 *   - React to transitions: onStateChange(), onRunStarted(), onResultsReady()
 *   - Report in-run events: reportPickup(), reportPlanetCleared(), reportObstacleBroken()
 *
 * @example
 * ```ts
 * const lc = createRunLifecycle({ engine, player }, config);
 * const unsub = lc.onResultsReady((stats) => hud.showResults(stats));
 * lc.start('abc');
 * // ... during run:
 * lc.reportPickup(10);
 * lc.reportPlanetCleared();
 * // On next run:
 * lc.retry('abc');
 * unsub(); // clean up
 * lc.dispose();
 * ```
 */
export interface RunLifecycle {
  // -------------------------------------------------------------------------
  // State & stats queries
  // -------------------------------------------------------------------------

  /** Current lifecycle state. Cheap — readable every frame. */
  getState(): RunState;

  /**
   * Current run statistics snapshot. Returns a live object that reflects
   * the latest values — do not cache; read each frame if needed.
   */
  getStats(): RunStats;

  // -------------------------------------------------------------------------
  // State transitions (invalid transitions are no-ops with a console.warn)
  // -------------------------------------------------------------------------

  /**
   * Begin a new run from the title or results screen.
   * Resets all stats to zero, records run start time, then transitions:
   *   title   → running (normal new game)
   * Fires {@link onRunStarted} with the seed.
   *
   * @param seed - Dungeon seed string for procedural generation.
   */
  start(seed: string): void;

  /**
   * Restart the current run from the results screen.
   * Resets all stats to zero and transitions:
   *   results → running
   * Fires {@link onRunStarted} with the seed.
   *
   * @param seed - Dungeon seed string (may be same as previous run).
   */
  retry(seed: string): void;

  /**
   * Return to the title screen from the results screen.
   * Transitions: results → title.
   */
  toTitle(): void;

  // -------------------------------------------------------------------------
  // Event subscriptions (each returns an unsubscribe function)
  // -------------------------------------------------------------------------

  /**
   * Subscribe to every state transition.
   * Fires with (fromState, toState) immediately after the transition completes.
   *
   * @returns Unsubscribe function.
   */
  onStateChange(cb: (from: RunState, to: RunState) => void): () => void;

  /**
   * Subscribe to the moment a run starts (title→running or results→running).
   * Fires with the seed that was passed to start() / retry().
   *
   * @returns Unsubscribe function.
   */
  onRunStarted(cb: (seed: string) => void): () => void;

  /**
   * Subscribe to the dead→results transition. Receives a frozen stats snapshot
   * captured at the moment of player death (distance / elapsedMs will not change
   * further after this fires).
   *
   * @returns Unsubscribe function.
   */
  onResultsReady(cb: (finalStats: RunStats) => void): () => void;

  // -------------------------------------------------------------------------
  // In-run event reporting — called by pickups, planet, and super-suit systems
  // -------------------------------------------------------------------------

  /**
   * Increment crystalsCollected by 1. The value parameter is reserved for
   * future weighted pickups but is currently unused.
   *
   * @param value - Crystal value (unused — all crystals count as 1 for now).
   */
  reportPickup(value: number): void;

  /** Increment planetsCleared by 1. */
  reportPlanetCleared(): void;

  /** Increment obstaclesBroken by 1. */
  reportObstacleBroken(): void;

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /**
   * Tear down the lifecycle system:
   *   - Unsubscribes the onDeath listener from player
   *   - Unregisters the onBeforeRender callback from engine
   *   - Clears all subscriber arrays
   * Idempotent — safe to call multiple times.
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RunLifecycle instance. Synchronous — no asset loading required.
 *
 * Wires up:
 *  1. player.onDeath → transition running → dead, capture finalStats
 *  2. engine.onBeforeRender → update distance, elapsedMs, score (while running);
 *                             advance deathHoldTimer (while dead)
 *
 * @param deps   - Engine and Player handles (owned by caller).
 * @param config - Loaded from assets/data/run-lifecycle.json by caller.
 * @returns A fully initialized RunLifecycle handle.
 *
 * @example
 * ```ts
 * const config = await fetch('/assets/data/run-lifecycle.json').then(r => r.json());
 * const lifecycle = createRunLifecycle({ engine, player }, config);
 * lifecycle.start('seed-abc123');
 * ```
 */
export function createRunLifecycle(
  deps: RunLifecycleDeps,
  config: RunLifecycleConfig,
): RunLifecycle {
  const { engine, player } = deps;

  // -------------------------------------------------------------------------
  // Mutable state
  // -------------------------------------------------------------------------

  let runState: RunState = 'title';

  /** Mutable live statistics. Zeroed on start()/retry(). */
  const stats: RunStats = {
    elapsedMs: 0,
    distance: 0,
    planetsCleared: 0,
    crystalsCollected: 0,
    obstaclesBroken: 0,
    score: 0,
  };

  /**
   * Frozen copy of stats captured at the moment of death.
   * Emitted via onResultsReady once the deathHold timer expires.
   */
  let finalStats: RunStats | null = null;

  /** performance.now() timestamp recorded at start()/retry(). */
  let startTimeMs = 0;

  /** Accumulated real seconds spent in the 'dead' state. */
  let deathHoldAccumMs = 0;

  /** Guards against double-disposal. */
  let disposed = false;

  // -------------------------------------------------------------------------
  // Event subscriber registries
  // -------------------------------------------------------------------------
  const stateChangeSubscribers: Array<(from: RunState, to: RunState) => void> = [];
  const runStartedSubscribers: Array<(seed: string) => void> = [];
  const resultsReadySubscribers: Array<(finalStats: RunStats) => void> = [];

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Recompute stats.score from current counter values and config weights.
   * Called every render frame while state === 'running'. No allocations.
   */
  function recomputeScore(): void {
    const w = config.scoreWeights;
    stats.score =
      stats.distance * w.distance +
      stats.planetsCleared * w.planetsCleared +
      stats.crystalsCollected * w.crystalsCollected +
      stats.obstaclesBroken * w.obstaclesBroken;
  }

  /**
   * Execute a state transition and fire onStateChange subscribers.
   *
   * @param to - The new state to transition into.
   */
  function transitionState(to: RunState): void {
    const from = runState;
    runState = to;
    for (const cb of stateChangeSubscribers) cb(from, to);
  }

  /**
   * Reset all mutable per-run statistics to zero and record the new start time.
   * Called by start() and retry() before transitioning to 'running'.
   */
  function resetStats(): void {
    startTimeMs = performance.now();
    deathHoldAccumMs = 0;
    finalStats = null;
    stats.elapsedMs = 0;
    stats.distance = 0;
    stats.planetsCleared = 0;
    stats.crystalsCollected = 0;
    stats.obstaclesBroken = 0;
    stats.score = 0;
  }

  /**
   * Capture a frozen clone of the current stats for emitting via onResultsReady.
   * Called once at the moment of player death.
   */
  function captureFinalStats(): RunStats {
    return {
      elapsedMs: stats.elapsedMs,
      distance: stats.distance,
      planetsCleared: stats.planetsCleared,
      crystalsCollected: stats.crystalsCollected,
      obstaclesBroken: stats.obstaclesBroken,
      score: stats.score,
    };
  }

  // -------------------------------------------------------------------------
  // Wire up player.onDeath subscription
  //
  // Fires when the player transitions to 'dead' (alive → dead or downed → dead).
  // We only act during 'running' — ignore death events that arrive out-of-order
  // (e.g. if Player somehow fires onDeath while in 'title' state).
  // -------------------------------------------------------------------------
  const unsubPlayerDeath = player.onDeath(() => {
    if (runState !== 'running') return;

    // Snapshot stats at the moment of death (distance/time stop updating
    // after we transition away from 'running')
    finalStats = captureFinalStats();
    deathHoldAccumMs = 0;
    transitionState('dead');
  });

  // -------------------------------------------------------------------------
  // Wire up engine.onBeforeRender
  //
  // Runs once per rendered frame (real dt, not fixed physics dt — correct for
  // timing and animation-rate stat updates).
  //
  // Responsibilities:
  //   state === 'running':
  //     - Update elapsedMs from wall clock
  //     - Update distance from player body Z translation
  //     - Recompute score
  //   state === 'dead':
  //     - Accumulate deathHoldTimer
  //     - Transition dead → results when timer expires, emit onResultsReady
  // -------------------------------------------------------------------------
  const unsubBeforeRender = engine.onBeforeRender((realDt: number) => {
    if (disposed) return;

    if (runState === 'running') {
      stats.elapsedMs = performance.now() - startTimeMs;

      // Distance is the furthest negative-Z position reached.
      // player.body.translation().z decreases as the player moves forward.
      // We negate and floor to get a non-negative integer metre value.
      const z = player.body.translation().z;
      stats.distance = Math.max(0, Math.floor(-z));

      recomputeScore();
      return;
    }

    if (runState === 'dead') {
      deathHoldAccumMs += realDt * 1000;
      if (deathHoldAccumMs >= config.deathHoldSec * 1000) {
        // Transition dead → results and emit the frozen stats snapshot.
        // finalStats is always set before entering 'dead' (see onDeath handler).
        transitionState('results');
        const snapshot = finalStats as RunStats;
        for (const cb of resultsReadySubscribers) cb(snapshot);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Assemble and return the RunLifecycle handle
  // -------------------------------------------------------------------------
  const lifecycle: RunLifecycle = {
    // -----------------------------------------------------------------------
    // State & stats queries
    // -----------------------------------------------------------------------

    getState(): RunState {
      return runState;
    },

    getStats(): RunStats {
      return stats;
    },

    // -----------------------------------------------------------------------
    // State transitions
    // -----------------------------------------------------------------------

    start(seed: string): void {
      if (runState !== 'title') {
        console.warn(
          `[RunLifecycle] start() called from state '${runState}' — only valid from 'title'. No-op.`,
        );
        return;
      }
      resetStats();
      transitionState('running');
      for (const cb of runStartedSubscribers) cb(seed);
    },

    retry(seed: string): void {
      if (runState !== 'results') {
        console.warn(
          `[RunLifecycle] retry() called from state '${runState}' — only valid from 'results'. No-op.`,
        );
        return;
      }
      resetStats();
      transitionState('running');
      for (const cb of runStartedSubscribers) cb(seed);
    },

    toTitle(): void {
      if (runState !== 'results') {
        console.warn(
          `[RunLifecycle] toTitle() called from state '${runState}' — only valid from 'results'. No-op.`,
        );
        return;
      }
      transitionState('title');
    },

    // -----------------------------------------------------------------------
    // Event subscriptions
    // -----------------------------------------------------------------------

    onStateChange(cb: (from: RunState, to: RunState) => void): () => void {
      stateChangeSubscribers.push(cb);
      return (): void => {
        const idx = stateChangeSubscribers.indexOf(cb);
        if (idx !== -1) stateChangeSubscribers.splice(idx, 1);
      };
    },

    onRunStarted(cb: (seed: string) => void): () => void {
      runStartedSubscribers.push(cb);
      return (): void => {
        const idx = runStartedSubscribers.indexOf(cb);
        if (idx !== -1) runStartedSubscribers.splice(idx, 1);
      };
    },

    onResultsReady(cb: (finalStats: RunStats) => void): () => void {
      resultsReadySubscribers.push(cb);
      return (): void => {
        const idx = resultsReadySubscribers.indexOf(cb);
        if (idx !== -1) resultsReadySubscribers.splice(idx, 1);
      };
    },

    // -----------------------------------------------------------------------
    // In-run event reporting
    // -----------------------------------------------------------------------

    reportPickup(_value: number): void {
      // value is reserved for future weighted pickups; all pickups count as 1.
      stats.crystalsCollected += 1;
    },

    reportPlanetCleared(): void {
      stats.planetsCleared += 1;
    },

    reportObstacleBroken(): void {
      stats.obstaclesBroken += 1;
    },

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    dispose(): void {
      if (disposed) return; // idempotent

      disposed = true;

      // Unsubscribe from external systems
      unsubPlayerDeath();
      unsubBeforeRender();

      // Clear all subscriber arrays
      stateChangeSubscribers.length = 0;
      runStartedSubscribers.length = 0;
      resultsReadySubscribers.length = 0;
    },
  };

  return lifecycle;
}

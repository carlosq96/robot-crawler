/**
 * @file src/ui/hud.ts
 * @description HUD System — DOM overlay showing live run stats (distance,
 * star dust collected, composite score) plus +value popup animations on pickup.
 *
 * Implements spec: design/quick-specs/hud-2026-04-09.md (system #16, L5, T1)
 *
 * Design decisions:
 *   - Pure DOM — no Three.js, no Canvas2D. Fast to iterate, trivial to style.
 *   - Updates via requestAnimationFrame (real frame rate, not fixed physics tick).
 *   - Reads RunLifecycle.getStats() each frame — no caching needed at jam scope.
 *   - Visible ONLY during 'running' state. Hidden in title / dead / results.
 *   - Popup animations are CSS @keyframes driven; JS only creates/removes nodes.
 *   - No HP bar — Space Runner uses on-touch death (obstacle = instant kill).
 *   - planet label + super-suit cooldown deferred to Planet/Checkpoint +
 *     Super-Suit systems (not yet implemented). API is designed for easy extension.
 *
 * @example
 * ```ts
 * const hudConfig = await fetch('/assets/data/hud.json').then(r => r.json());
 * const hud = createHUD(runLifecycle, pickups, hudConfig);
 * // hud auto-shows/hides via runLifecycle.onStateChange
 * // call hud.dispose() on teardown
 * ```
 */

import type { RunLifecycle } from '../gameplay/run-lifecycle.js';
import type { PickupSystem } from '../gameplay/pickups.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Configuration loaded from assets/data/hud.json. */
export interface HUDConfig {
  /** Seconds a pickup popup lives before disappearing. Default: 1.0 */
  popupDurationSec: number;
}

/** Handle returned by createHUD. */
export interface HUD {
  /** Manually show the HUD (normally driven by run state). */
  show(): void;
  /** Manually hide the HUD. */
  hide(): void;
  /**
   * Tear down: cancel rAF loop, unsubscribe events, remove DOM element.
   * Idempotent.
   */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and mount the HUD overlay.
 *
 * Automatically shows when RunLifecycle transitions to 'running' and hides
 * for all other states. Spawns pickup popups via PickupSystem.onPickup.
 *
 * @param runLifecycle - Live run state + stats source.
 * @param pickups      - Pickup system used to subscribe to collection events.
 * @param config       - Loaded from assets/data/hud.json by caller.
 */
export function createHUD(
  runLifecycle: RunLifecycle,
  pickups: PickupSystem,
  config: HUDConfig,
): HUD {
  // -------------------------------------------------------------------------
  // Build DOM tree
  // -------------------------------------------------------------------------

  const root = document.createElement('div');
  root.id = 'hud';
  root.style.display = 'none'; // hidden until 'running' state

  root.innerHTML = `
    <div class="hud-top-left">
      <div class="hud-distance">0 m</div>
      <div class="hud-distance-label">Distance</div>
    </div>

    <div class="hud-top-right">
      <div class="hud-score">0</div>
      <div class="hud-score-label">Score</div>
      <div class="hud-stardust">
        <span class="hud-stardust-icon">◈</span><span class="hud-stardust-count">0</span>
      </div>
    </div>

    <div class="hud-popups"></div>
  `;

  document.body.appendChild(root);

  // Cache element references — queried once, never re-queried in the hot path.
  const distanceEl  = root.querySelector('.hud-distance')      as HTMLDivElement;
  const scoreEl     = root.querySelector('.hud-score')         as HTMLDivElement;
  const stardustEl  = root.querySelector('.hud-stardust-count') as HTMLSpanElement;
  const popupsEl    = root.querySelector('.hud-popups')        as HTMLDivElement;

  // -------------------------------------------------------------------------
  // rAF loop — updates text each rendered frame while visible
  // -------------------------------------------------------------------------

  let rafId = 0;
  let disposed = false;

  // Track last-rendered values to skip DOM writes when nothing changed.
  let lastDistance = -1;
  let lastScore    = -1;
  let lastStardust = -1;

  function tick(): void {
    if (disposed) return;

    const stats = runLifecycle.getStats();

    if (stats.distance !== lastDistance) {
      distanceEl.textContent = `${stats.distance} m`;
      lastDistance = stats.distance;
    }
    if (stats.score !== lastScore) {
      scoreEl.textContent = `${Math.floor(stats.score)}`;
      lastScore = stats.score;
    }
    if (stats.crystalsCollected !== lastStardust) {
      stardustEl.textContent = `${stats.crystalsCollected}`;
      lastStardust = stats.crystalsCollected;
    }

    rafId = requestAnimationFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Pickup popups
  // -------------------------------------------------------------------------

  /**
   * Spawn a "+N" popup near the score element. Positioned at a slightly random
   * offset in the top-right area so multiple pickups don't stack exactly.
   */
  function spawnPopup(value: number): void {
    const popup = document.createElement('div');
    popup.className = 'hud-popup';
    popup.textContent = `+${value}`;

    // Random position near top-right so stacked pickups are readable.
    const rightPx  = 20 + Math.random() * 60;  // 20–80 px from right
    const topPx    = 80 + Math.random() * 40;   // 80–120 px from top

    popup.style.right = `${rightPx}px`;
    popup.style.top   = `${topPx}px`;
    popup.style.setProperty('--popup-duration', `${config.popupDurationSec}s`);

    popupsEl.appendChild(popup);

    // Remove node after animation completes to avoid DOM bloat.
    popup.addEventListener('animationend', () => {
      popup.remove();
    }, { once: true });
  }

  // -------------------------------------------------------------------------
  // Subscribe to pickup events
  // -------------------------------------------------------------------------

  const unsubPickup = pickups.onPickup((_type: string, value: number) => {
    spawnPopup(value);
  });

  // -------------------------------------------------------------------------
  // State-based visibility — driven by RunLifecycle
  // -------------------------------------------------------------------------

  const unsubState = runLifecycle.onStateChange((_from, to) => {
    if (to === 'running') {
      hud.show();
    } else {
      hud.hide();
    }
  });

  // -------------------------------------------------------------------------
  // Public handle
  // -------------------------------------------------------------------------

  const hud: HUD = {
    show(): void {
      root.style.display = '';
      lastDistance = -1; // force DOM refresh on next tick
      lastScore    = -1;
      lastStardust = -1;
      if (!rafId) {
        rafId = requestAnimationFrame(tick);
      }
    },

    hide(): void {
      root.style.display = 'none';
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;

      hud.hide();
      unsubPickup();
      unsubState();
      root.remove();
    },
  };

  return hud;
}

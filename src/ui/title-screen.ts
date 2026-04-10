/**
 * @file src/ui/title-screen.ts
 * @description Title screen overlay for Space Runner.
 *
 * Displays on game load and whenever RunLifecycle transitions back to 'title'.
 * START button seeds a new run with a random 8-character alphanumeric seed and
 * calls runLifecycle.start().
 *
 * Lifecycle:
 *   - Created once; lives for the entire session.
 *   - Subscribes to RunLifecycle.onStateChange to show/hide automatically.
 *   - dispose() removes the DOM node and unsubscribes all listeners.
 */

// ---------------------------------------------------------------------------
// Inline type aliases — RunLifecycle is built in parallel; no import needed.
// ---------------------------------------------------------------------------

type RunState = 'title' | 'running' | 'dead' | 'results';

interface RunStats {
  elapsedMs: number;
  distance: number;
  planetsCleared: number;
  crystalsCollected: number;
  obstaclesBroken: number;
  score: number;
}

interface RunLifecycle {
  getState(): RunState;
  start(seed: string): void;
  retry(seed: string): void;
  toTitle(): void;
  onStateChange(cb: (from: RunState, to: RunState) => void): () => void;
  onResultsReady(cb: (finalStats: RunStats) => void): () => void;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface TitleScreen {
  /** Make the title screen visible. */
  show(): void;
  /** Hide the title screen (does not destroy it). */
  hide(): void;
  /** Remove the DOM element and unsubscribe all lifecycle listeners. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the title screen overlay and injects it into document.body.
 *
 * @param runLifecycle - The run lifecycle controller used to start a new run.
 * @returns TitleScreen handle for manual show/hide/dispose.
 */
export function createTitleScreen(runLifecycle: RunLifecycle): TitleScreen {
  // -------------------------------------------------------------------------
  // Build DOM structure
  // -------------------------------------------------------------------------

  const overlay = document.createElement('div');
  overlay.id = 'title-screen';
  overlay.className = 'ui-overlay';

  const panel = document.createElement('div');
  panel.className = 'ui-panel';

  const heading = document.createElement('h1');
  heading.className = 'ui-title';
  heading.textContent = 'SPACE RUNNER';

  const subtitle = document.createElement('p');
  subtitle.className = 'ui-subtitle';
  subtitle.textContent = 'Dodge obstacles. Collect star dust. Survive.';

  const startBtn = document.createElement('button');
  startBtn.className = 'ui-button';
  startBtn.textContent = 'START';
  startBtn.setAttribute('type', 'button');

  panel.appendChild(heading);
  panel.appendChild(subtitle);
  panel.appendChild(startBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // -------------------------------------------------------------------------
  // Button handler — generate a random 8-char seed and start the run
  // -------------------------------------------------------------------------

  function handleStart(): void {
    const seed = Math.random().toString(36).slice(2, 10);
    runLifecycle.start(seed);
  }

  startBtn.addEventListener('click', handleStart);

  // -------------------------------------------------------------------------
  // Subscribe to lifecycle state changes
  // -------------------------------------------------------------------------

  const unsubscribeStateChange = runLifecycle.onStateChange(
    (from: RunState, to: RunState) => {
      if (to === 'title') {
        show();
      } else if (from === 'title') {
        hide();
      }
    },
  );

  // -------------------------------------------------------------------------
  // Public API implementation
  // -------------------------------------------------------------------------

  function show(): void {
    overlay.style.display = 'flex';
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  function dispose(): void {
    startBtn.removeEventListener('click', handleStart);
    unsubscribeStateChange();
    overlay.remove();
  }

  // Title screen is visible on creation — game starts in 'title' state.
  show();

  return { show, hide, dispose };
}

/**
 * @file src/ui/results-screen.ts
 * @description Results screen overlay for Space Runner.
 *
 * Shown automatically when RunLifecycle emits onResultsReady.
 * Displays Distance, Star Dust collected, and final Score.
 * RETRY button starts a new run with a fresh random seed.
 *
 * Lifecycle:
 *   - Created once; lives for the entire session.
 *   - Initially hidden (display: none).
 *   - Subscribes to RunLifecycle.onResultsReady to populate and show.
 *   - Subscribes to RunLifecycle.onStateChange to hide when leaving 'results'.
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

export interface ResultsScreen {
  /** Populate the stats panel and make the screen visible. */
  show(stats: RunStats): void;
  /** Hide the results screen (does not destroy it). */
  hide(): void;
  /** Remove the DOM element and unsubscribe all lifecycle listeners. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a single stat row: label on the left, value on the right.
 *
 * @param label - Human-readable label text.
 * @param valueClass - CSS class(es) applied to the value span.
 * @returns Tuple of [row element, value span element] so the caller can
 *          update the value span later.
 */
function createStatRow(
  label: string,
  valueClass: string,
): [HTMLDivElement, HTMLSpanElement] {
  const row = document.createElement('div');
  row.className = 'ui-stat-row';

  const labelEl = document.createElement('span');
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = valueClass;

  row.appendChild(labelEl);
  row.appendChild(valueEl);

  return [row, valueEl];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates the results screen overlay and injects it into document.body.
 *
 * @param runLifecycle - The run lifecycle controller used to trigger a retry.
 * @returns ResultsScreen handle for manual show/hide/dispose.
 */
export function createResultsScreen(runLifecycle: RunLifecycle): ResultsScreen {
  // -------------------------------------------------------------------------
  // Build DOM structure
  // -------------------------------------------------------------------------

  const overlay = document.createElement('div');
  overlay.id = 'results-screen';
  overlay.className = 'ui-overlay';
  overlay.style.display = 'none'; // Initially hidden

  const panel = document.createElement('div');
  panel.className = 'ui-panel';

  const heading = document.createElement('h1');
  heading.className = 'ui-title';
  heading.style.fontSize = '2.5rem';
  heading.textContent = 'RUN OVER';

  // Stats section
  const statsContainer = document.createElement('div');

  const [distanceRow, distanceValue] = createStatRow('Distance', 'ui-stat-value');
  const [dustRow, dustValue] = createStatRow('Star Dust', 'ui-stat-value');
  const [scoreRow, scoreValue] = createStatRow('Score', 'ui-score-value');

  statsContainer.appendChild(distanceRow);
  statsContainer.appendChild(dustRow);
  statsContainer.appendChild(scoreRow);

  // Retry button
  const retryBtn = document.createElement('button');
  retryBtn.className = 'ui-button';
  retryBtn.textContent = 'RETRY';
  retryBtn.setAttribute('type', 'button');

  panel.appendChild(heading);
  panel.appendChild(statsContainer);
  panel.appendChild(retryBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // -------------------------------------------------------------------------
  // Button handler — generate a fresh random seed and retry
  // -------------------------------------------------------------------------

  function handleRetry(): void {
    const seed = Math.random().toString(36).slice(2, 10);
    runLifecycle.retry(seed);
  }

  retryBtn.addEventListener('click', handleRetry);

  // -------------------------------------------------------------------------
  // Subscribe to lifecycle events
  // -------------------------------------------------------------------------

  // onResultsReady: fill in stats and show the overlay
  const unsubscribeResultsReady = runLifecycle.onResultsReady(
    (finalStats: RunStats) => {
      show(finalStats);
    },
  );

  // onStateChange: hide when navigating away from 'results'
  const unsubscribeStateChange = runLifecycle.onStateChange(
    (from: RunState, _to: RunState) => {
      if (from === 'results') {
        hide();
      }
    },
  );

  // -------------------------------------------------------------------------
  // Public API implementation
  // -------------------------------------------------------------------------

  function show(stats: RunStats): void {
    distanceValue.textContent = `${stats.distance} m`;
    dustValue.textContent = String(stats.crystalsCollected);
    scoreValue.textContent = String(stats.score);
    overlay.style.display = 'flex';
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  function dispose(): void {
    retryBtn.removeEventListener('click', handleRetry);
    unsubscribeResultsReady();
    unsubscribeStateChange();
    overlay.remove();
  }

  return { show, hide, dispose };
}

/**
 * @file src/ui/results-screen.ts
 * @description Results screen overlay for Space Runner.
 *
 * Shown automatically when RunLifecycle emits onResultsReady.
 * Displays Distance, Star Dust collected, and final Score.
 * Accepts a username, submits to the leaderboard, shows top-10.
 * RETRY button starts a new run with a fresh random seed.
 *
 * Lifecycle:
 *   - Created once; lives for the entire session.
 *   - Initially hidden (display: none).
 *   - Subscribes to RunLifecycle.onResultsReady to populate and show.
 *   - Subscribes to RunLifecycle.onStateChange to hide when leaving 'results'.
 *   - dispose() removes the DOM node and unsubscribes all listeners.
 */

import {
  submitRun,
  fetchTopRuns,
  getStoredUsername,
  setStoredUsername,
  updatePersonalBest,
  type RunRow,
} from '../networking/leaderboard.js';

// ---------------------------------------------------------------------------
// Inline type aliases
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
  show(stats: RunStats): void;
  hide(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStatRow(label: string, valueClass: string): [HTMLDivElement, HTMLSpanElement] {
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

function formatNumber(n: number): string {
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createResultsScreen(runLifecycle: RunLifecycle): ResultsScreen {
  // -------------------------------------------------------------------------
  // Build DOM structure
  // -------------------------------------------------------------------------

  const overlay = document.createElement('div');
  overlay.id = 'results-screen';
  overlay.className = 'ui-overlay';
  overlay.style.display = 'none';

  const panel = document.createElement('div');
  panel.className = 'ui-panel';
  panel.style.maxWidth = '480px';
  panel.style.width = '90%';

  // Heading
  const heading = document.createElement('h1');
  heading.className = 'ui-title';
  heading.style.fontSize = '2.5rem';
  heading.textContent = 'RUN OVER';

  // Stats
  const statsContainer = document.createElement('div');
  const [distanceRow, distanceValue] = createStatRow('Distance', 'ui-stat-value');
  const [dustRow, dustValue]         = createStatRow('Star Dust', 'ui-stat-value');
  const [planetsRow, planetsValue]   = createStatRow('Planets', 'ui-stat-value');
  const [scoreRow, scoreValue]       = createStatRow('Score', 'ui-score-value');
  statsContainer.appendChild(distanceRow);
  statsContainer.appendChild(dustRow);
  statsContainer.appendChild(planetsRow);
  statsContainer.appendChild(scoreRow);

  // Personal best badge (hidden until a PB is set)
  const pbBadge = document.createElement('div');
  pbBadge.textContent = '🏆 New Personal Best!';
  pbBadge.style.cssText = 'display:none;color:#ffd700;font-weight:bold;margin:4px 0 8px;font-size:1rem;';

  // Username row
  const usernameRow = document.createElement('div');
  usernameRow.style.cssText = 'display:flex;gap:8px;margin:12px 0 4px;align-items:center;';
  const usernameLabel = document.createElement('label');
  usernameLabel.textContent = 'Name:';
  usernameLabel.style.cssText = 'color:#ccc;font-size:0.9rem;white-space:nowrap;';
  const usernameInput = document.createElement('input');
  usernameInput.type = 'text';
  usernameInput.maxLength = 32;
  usernameInput.placeholder = 'your name';
  usernameInput.value = getStoredUsername() ?? '';
  usernameInput.style.cssText = 'flex:1;background:#1a1a2e;color:#fff;border:1px solid #444;border-radius:4px;padding:4px 8px;font-size:0.9rem;';
  const submitBtn = document.createElement('button');
  submitBtn.className = 'ui-button';
  submitBtn.textContent = 'SUBMIT';
  submitBtn.style.cssText = 'font-size:0.8rem;padding:4px 12px;';
  usernameRow.appendChild(usernameLabel);
  usernameRow.appendChild(usernameInput);
  usernameRow.appendChild(submitBtn);

  // Rank badge (shown after submit)
  const rankBadge = document.createElement('div');
  rankBadge.style.cssText = 'color:#4af;font-size:0.9rem;margin-bottom:8px;min-height:1.2em;';

  // Leaderboard section
  const lbHeading = document.createElement('div');
  lbHeading.textContent = 'TOP 10';
  lbHeading.style.cssText = 'color:#888;font-size:0.75rem;letter-spacing:2px;margin-top:12px;margin-bottom:4px;';

  const lbTable = document.createElement('div');
  lbTable.style.cssText = 'width:100%;font-size:0.82rem;';

  // Retry button
  const retryBtn = document.createElement('button');
  retryBtn.className = 'ui-button';
  retryBtn.textContent = 'RETRY';
  retryBtn.setAttribute('type', 'button');
  retryBtn.style.marginTop = '14px';

  panel.appendChild(heading);
  panel.appendChild(statsContainer);
  panel.appendChild(pbBadge);
  panel.appendChild(usernameRow);
  panel.appendChild(rankBadge);
  panel.appendChild(lbHeading);
  panel.appendChild(lbTable);
  panel.appendChild(retryBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // -------------------------------------------------------------------------
  // Internal state
  // -------------------------------------------------------------------------

  let pendingStats: RunStats | null = null;
  let submitted = false;

  // -------------------------------------------------------------------------
  // Leaderboard render
  // -------------------------------------------------------------------------

  function renderLeaderboard(rows: RunRow[], highlightId?: number): void {
    lbTable.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#555;text-align:center;padding:8px 0;';
      empty.textContent = 'No runs yet — be the first!';
      lbTable.appendChild(empty);
      return;
    }
    rows.forEach((row, i) => {
      const entry = document.createElement('div');
      const isHighlight = row.id === highlightId;
      entry.style.cssText = `display:flex;justify-content:space-between;padding:2px 4px;border-radius:3px;${isHighlight ? 'background:#1a3a5c;color:#7df;' : 'color:#aaa;'}`;
      const left = document.createElement('span');
      left.textContent = `${i + 1}. ${row.username}`;
      const right = document.createElement('span');
      right.textContent = formatNumber(row.score);
      entry.appendChild(left);
      entry.appendChild(right);
      lbTable.appendChild(entry);
    });
  }

  // -------------------------------------------------------------------------
  // Submit logic
  // -------------------------------------------------------------------------

  async function handleSubmit(): Promise<void> {
    if (!pendingStats || submitted) return;
    const username = usernameInput.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
    if (!username) {
      rankBadge.textContent = 'Enter a name first.';
      return;
    }
    setStoredUsername(username);
    submitBtn.disabled = true;
    submitBtn.textContent = '...';
    rankBadge.textContent = 'Submitting…';

    const run = {
      username,
      distance: pendingStats.distance,
      planetsCleared: pendingStats.planetsCleared,
      crystals: pendingStats.crystalsCollected,
      score: pendingStats.score,
    };

    const result = await submitRun(run);
    if (result) {
      submitted = true;
      rankBadge.textContent = `You ranked #${result.rank}`;
      submitBtn.textContent = '✓';
    } else {
      rankBadge.textContent = 'Could not submit — playing offline.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'RETRY SUBMIT';
    }

    const rows = await fetchTopRuns(10);
    renderLeaderboard(rows, result?.id);
  }

  submitBtn.addEventListener('click', handleSubmit);
  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit();
  });

  // -------------------------------------------------------------------------
  // Button handler
  // -------------------------------------------------------------------------

  function handleRetry(): void {
    const seed = Math.random().toString(36).slice(2, 10);
    runLifecycle.retry(seed);
  }

  retryBtn.addEventListener('click', handleRetry);

  // -------------------------------------------------------------------------
  // Subscribe to lifecycle
  // -------------------------------------------------------------------------

  const unsubscribeResultsReady = runLifecycle.onResultsReady((finalStats: RunStats) => {
    show(finalStats);
  });

  const unsubscribeStateChange = runLifecycle.onStateChange((from: RunState, _to: RunState) => {
    if (from === 'results') hide();
  });

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function show(stats: RunStats): void {
    pendingStats = stats;
    submitted = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'SUBMIT';
    rankBadge.textContent = '';

    distanceValue.textContent = `${formatNumber(stats.distance)} m`;
    dustValue.textContent = formatNumber(stats.crystalsCollected);
    planetsValue.textContent = String(stats.planetsCleared);
    scoreValue.textContent = formatNumber(stats.score);

    // Personal best check
    const run = {
      username: usernameInput.value || 'anon',
      distance: stats.distance,
      planetsCleared: stats.planetsCleared,
      crystals: stats.crystalsCollected,
      score: stats.score,
    };
    const isNewPB = updatePersonalBest(run);
    pbBadge.style.display = isNewPB ? 'block' : 'none';

    // Load leaderboard immediately (read-only, no username needed)
    fetchTopRuns(10).then((rows) => renderLeaderboard(rows));

    overlay.style.display = 'flex';
  }

  function hide(): void {
    overlay.style.display = 'none';
  }

  function dispose(): void {
    submitBtn.removeEventListener('click', handleSubmit);
    retryBtn.removeEventListener('click', handleRetry);
    unsubscribeResultsReady();
    unsubscribeStateChange();
    overlay.remove();
  }

  return { show, hide, dispose };
}

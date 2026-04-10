# Quick Design Spec: Run Results Screen

**Type**: New Small System
**Scope**: Full-screen DOM overlay shown at run-end. Displays final stats (distance, planets cleared, crystals, obstacles broken, total score), a username input, a Submit button that POSTs to `/api/runs`, a leaderboard table (top 10 via `GET /api/runs/top`), and a Retry button that triggers `runLifecycle.retry(newSeed)`. Does NOT compute the score (Run Lifecycle does) and does NOT own the DB (Persistence Layer does).
**Date**: 2026-04-09
**Estimated Implementation**: ~2 hours (S effort)

---

## Overview

Results Screen is triggered by `runLifecycle.onResultsReady(finalStats)`. It builds (or reveals) a DOM overlay with stats, a username input, submit + retry buttons, and a leaderboard panel. Submission is a single POST via the Persistence Layer client helper; the response rank is displayed inline.

The screen is not pre-rendered — it's created lazily on first results to avoid allocating DOM for nothing. On `retry` or `toTitle`, the overlay is hidden (not destroyed) so subsequent runs can reveal it cheaply.

---

## Core Rules

### 1. DOM structure

```html
<div id="results-screen" class="results-screen" style="display: none">
  <div class="results-panel">
    <h1 class="results-title">RUN COMPLETE</h1>
    <div class="results-stats">
      <div class="stat"><span class="label">Distance</span><span class="value">0</span> m</div>
      <div class="stat"><span class="label">Planets</span><span class="value">0</span></div>
      <div class="stat"><span class="label">Crystals</span><span class="value">0</span></div>
      <div class="stat"><span class="label">Broken</span><span class="value">0</span></div>
      <div class="stat big"><span class="label">SCORE</span><span class="value">0</span></div>
      <div class="stat pb" style="display: none">NEW PERSONAL BEST!</div>
    </div>
    <div class="results-submit">
      <input type="text" class="username-input" maxlength="32" placeholder="name" />
      <button class="submit-btn">Submit Score</button>
      <div class="rank-display" style="display: none">Rank: <span class="rank">—</span></div>
    </div>
    <div class="results-leaderboard">
      <h2>Top 10</h2>
      <ol class="leaderboard-list"></ol>
    </div>
    <div class="results-actions">
      <button class="retry-btn">Retry</button>
      <button class="title-btn">Title</button>
    </div>
  </div>
</div>
```

### 2. Show on results-ready

On `runLifecycle.onResultsReady(finalStats)`:
1. Create the overlay DOM if not yet created; otherwise reveal with `display: block`
2. Fill in all stat values from `finalStats`
3. Check + update personal best via `updatePersonalBest(finalStats)`; if true, show the `NEW PERSONAL BEST!` badge
4. Prefill the username input from `getStoredUsername()`
5. Fetch + render the leaderboard via `fetchTopRuns(10)`
6. Attach button handlers (if not already attached)

### 3. Submit button

On click:
1. Read the username from the input
2. Sanitize (client-side: strip non-alphanumeric, lowercase, max 32)
3. Save via `setStoredUsername(name)`
4. Build the submission payload from the current stats
5. Call `submitRun(payload)` (async)
6. If success: show the rank inline (`Rank: 42`), disable the submit button, refresh the leaderboard panel (new submission now visible)
7. If failure: show `"couldn't submit — playing offline"` text, leave submit enabled for retry

### 4. Retry button

On click:
1. Hide the overlay
2. Generate a new seed (e.g. `Math.random().toString(36).slice(2, 10)`)
3. Call `runLifecycle.retry(newSeed)`

### 5. Title button

On click:
1. Hide the overlay
2. Call `runLifecycle.toTitle()`

### 6. Leaderboard rendering

`fetchTopRuns(10)` → array of rows. For each row, append `<li>` with username, distance, planets, score. Highlight the row if its `id` matches the current submission's id.

### 7. Dispose

- Removes the overlay from DOM
- Removes button event listeners
- Unsubscribes from `runLifecycle.onResultsReady`
- Idempotent

---

## Public API Surface (LOCKED contract)

```ts
export interface RunResultsScreenConfig {
  rootElementId: string;  // 'results-screen' default
  leaderboardLimit: number; // 10 default
}

export interface RunResultsScreen {
  show(finalStats: RunStats): Promise<void>;   // renders + fetches leaderboard
  hide(): void;
  dispose(): void;
}

export function createRunResultsScreen(
  runLifecycle: RunLifecycle,
  config: RunResultsScreenConfig,
): RunResultsScreen;
```

The factory subscribes to `runLifecycle.onResultsReady` internally — main.ts only needs to call `createRunResultsScreen(...)` once.

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `leaderboardLimit` | 10 | 5–25 | UI | Fits on a single Results panel |

Tuning lives in `assets/data/run-results.json`.

---

## Data Files

### `assets/data/run-results.json`
```json
{
  "leaderboardLimit": 10
}
```

### CSS

`public/styles/results.css` — static file, includes overlay + panel + button styles.

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Run Lifecycle | Subscribes to `onResultsReady`; calls `retry` / `toTitle` | No change |
| Persistence Layer | Calls `submitRun`, `fetchTopRuns`, `getStoredUsername`, `setStoredUsername`, `updatePersonalBest` | Uses the client helper |

---

## Acceptance Criteria

- [ ] `onResultsReady` shows the overlay with correct stats filled in
- [ ] Username input prefills from localStorage
- [ ] Submit button POSTs to `/api/runs`, shows returned rank inline
- [ ] Submit button disables after successful submission
- [ ] Submit button re-enables after failed submission
- [ ] Leaderboard panel fetches and renders top 10
- [ ] Current submission's row is highlighted in the leaderboard
- [ ] New personal best triggers the badge
- [ ] Retry button hides the overlay and calls `runLifecycle.retry(newSeed)`
- [ ] Title button hides the overlay and calls `runLifecycle.toTitle()`
- [ ] Dispose removes the overlay cleanly

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #18, L6, T1, S-effort. No update needed.

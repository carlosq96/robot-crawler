/**
 * @file src/ui/tutorial-overlays.ts
 * @description First-run contextual hints for Space Runner.
 *
 * Shows four timed hints during the first run only (dodge, jump, slide,
 * super suit). Each hint fades in at a scripted time, stays up to
 * maxDurationSec, and dismisses instantly when the player performs the action.
 * Never blocks input. After all hints are shown once, sets a localStorage
 * flag and skips entirely on future runs.
 *
 * Design spec: design/quick-specs/tutorial-overlays-2026-04-09.md
 */

import type { InputManager } from '../engine/input.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionName = 'moveLeft' | 'moveRight' | 'jump' | 'slide' | 'attack';
type RunState = 'title' | 'running' | 'dead' | 'results';

interface RunStats { elapsedMs: number; }

interface RunLifecycle {
  getState(): RunState;
  getStats(): RunStats;
  onStateChange(cb: (from: RunState, to: RunState) => void): () => void;
}

export interface HintDef {
  id: string;
  text: string;
  triggerAtSec: number;
  maxDurationSec: number;
}

export interface TutorialConfig {
  hints: HintDef[];
}

export interface TutorialOverlays {
  start(): void;
  stop(): void;
  resetForTesting(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

const LS_KEY = 'spaceRunner.tutorialComplete';

function isComplete(): boolean {
  try { return localStorage.getItem(LS_KEY) === 'true'; } catch { return false; }
}

function markComplete(): void {
  try { localStorage.setItem(LS_KEY, 'true'); } catch { /* blocked */ }
}

// ---------------------------------------------------------------------------
// Action → hint mapping
// ---------------------------------------------------------------------------

const HINT_ACTIONS: Record<string, ActionName[]> = {
  dodge:  ['moveLeft', 'moveRight'],
  jump:   ['jump'],
  slide:  ['slide'],
  attack: ['attack'],
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTutorialOverlays(
  input: InputManager,
  runLifecycle: RunLifecycle,
  config: TutorialConfig,
): TutorialOverlays {

  // Container for all active hint elements (appended to body)
  const activeElements = new Map<string, HTMLDivElement>();
  const shownIds       = new Set<string>();
  const unsubFns: Array<() => void> = [];
  let rafId: number | null = null;
  let running = false;

  // -------------------------------------------------------------------------
  // Create a hint DOM element
  // -------------------------------------------------------------------------
  function createHintEl(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed',
      'bottom:15%',
      'left:50%',
      'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.55)',
      'color:#fff',
      'font-family:Segoe UI,system-ui,sans-serif',
      'font-size:1.1rem',
      'font-weight:bold',
      'letter-spacing:0.15em',
      'padding:0.6rem 1.8rem',
      'border-radius:4px',
      'border:1px solid rgba(255,255,255,0.15)',
      'pointer-events:none',
      'z-index:200',
      'opacity:0',
      'transition:opacity 0.3s ease',
      'white-space:nowrap',
    ].join(';');
    el.textContent = text;
    document.body.appendChild(el);
    // Trigger fade-in on next frame
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    return el;
  }

  function showCheck(el: HTMLDivElement): void {
    el.textContent = '✓';
    el.style.color = '#66ffcc';
    el.style.borderColor = '#66ffcc';
  }

  function removeEl(id: string, immediate = false): void {
    const el = activeElements.get(id);
    if (!el) return;
    if (immediate) {
      el.remove();
    } else {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }
    activeElements.delete(id);
  }

  // -------------------------------------------------------------------------
  // Per-hint timer tracking
  // -------------------------------------------------------------------------
  const hintShownAt = new Map<string, number>(); // hint.id → timestamp shown

  // -------------------------------------------------------------------------
  // RAF tick — checks trigger times and max durations
  // -------------------------------------------------------------------------
  function tick(): void {
    if (!running) return;
    rafId = requestAnimationFrame(tick);

    const elapsedSec = runLifecycle.getStats().elapsedMs / 1000;

    for (const hint of config.hints) {
      if (shownIds.has(hint.id)) continue;

      // Should we show it?
      if (!activeElements.has(hint.id) && elapsedSec >= hint.triggerAtSec) {
        const el = createHintEl(hint.text);
        activeElements.set(hint.id, el);
        hintShownAt.set(hint.id, performance.now());

        // Subscribe to success actions
        const actions = HINT_ACTIONS[hint.id] ?? [];
        const unsubs = actions.map((action) =>
          input.onActionPressed(action as Parameters<typeof input.onActionPressed>[0], () => {
            if (!activeElements.has(hint.id)) return;
            showCheck(activeElements.get(hint.id)!);
            setTimeout(() => removeEl(hint.id), 400);
            shownIds.add(hint.id);
            checkAllDone();
          }),
        );
        unsubFns.push(...unsubs);
      }

      // Max duration timeout
      if (activeElements.has(hint.id)) {
        const age = (performance.now() - (hintShownAt.get(hint.id) ?? 0)) / 1000;
        if (age >= hint.maxDurationSec) {
          removeEl(hint.id);
          shownIds.add(hint.id);
          checkAllDone();
        }
      }
    }
  }

  function checkAllDone(): void {
    if (shownIds.size >= config.hints.length) {
      markComplete();
    }
  }

  // -------------------------------------------------------------------------
  // Clear all active hint elements
  // -------------------------------------------------------------------------
  function clearAll(): void {
    for (const id of activeElements.keys()) removeEl(id, true);
    activeElements.clear();
  }

  // -------------------------------------------------------------------------
  // Subscribe to lifecycle state changes
  // -------------------------------------------------------------------------
  const unsubState = runLifecycle.onStateChange((_from, to) => {
    if (to === 'running') {
      start();
    } else {
      stop();
    }
  });

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function start(): void {
    if (isComplete()) return; // skip for returning players
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  }

  function stop(): void {
    running = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    clearAll();
  }

  function resetForTesting(): void {
    try { localStorage.removeItem(LS_KEY); } catch { /* blocked */ }
    shownIds.clear();
    hintShownAt.clear();
  }

  function dispose(): void {
    stop();
    unsubState();
    for (const unsub of unsubFns) unsub();
    unsubFns.length = 0;
  }

  return { start, stop, resetForTesting, dispose };
}

/**
 * @file src/ui/settings.ts
 * @description Settings overlay for Space Runner.
 *
 * Two sliders: SFX volume and music volume. Immediately applies changes to
 * the Audio System and persists to localStorage. Opened from the title screen's
 * gear button; back button returns to the title screen.
 *
 * Design spec: design/quick-specs/settings-2026-04-09.md
 */

import type { AudioSystem } from '../engine/audio-system.js';

// ---------------------------------------------------------------------------
// localStorage keys (shared with leaderboard.ts namespace)
// ---------------------------------------------------------------------------

const LS_SFX  = 'spaceRunner.sfxVolume';
const LS_MUSIC = 'spaceRunner.musicVolume';

function lsGet(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = parseFloat(raw);
    return Number.isNaN(n) ? fallback : Math.max(0, Math.min(1, n));
  } catch { return fallback; }
}

function lsSet(key: string, value: number): void {
  try { localStorage.setItem(key, String(value)); } catch { /* blocked */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Settings {
  show(): void;
  hide(): void;
  /** Subscribe to the settings panel being hidden (back button pressed). */
  onHidden(cb: () => void): () => void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSettings(audio: AudioSystem): Settings {
  const hiddenSubs: Array<() => void> = [];

  // -------------------------------------------------------------------------
  // DOM
  // -------------------------------------------------------------------------

  const overlay = document.createElement('div');
  overlay.id = 'settings-screen';
  overlay.className = 'ui-overlay';
  overlay.style.display = 'none';

  const panel = document.createElement('div');
  panel.className = 'ui-panel';
  panel.style.maxWidth = '380px';

  const heading = document.createElement('h1');
  heading.className = 'ui-title';
  heading.style.fontSize = '2rem';
  heading.style.marginBottom = '2rem';
  heading.textContent = 'SETTINGS';

  function makeSliderRow(
    label: string,
    lsKey: string,
    defaultVal: number,
    onChange: (v: number) => void,
  ): HTMLDivElement {
    const initial = lsGet(lsKey, defaultVal);

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:1.2rem;';

    const lbl = document.createElement('label');
    lbl.textContent = label;
    lbl.style.cssText = 'color:#ccc;font-size:0.95rem;width:110px;text-align:left;flex-shrink:0;';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(initial * 100));
    slider.style.cssText = 'flex:1;accent-color:#66ffcc;cursor:pointer;';

    const valLabel = document.createElement('span');
    valLabel.textContent = slider.value;
    valLabel.style.cssText = 'color:#66ffcc;font-size:0.9rem;width:32px;text-align:right;flex-shrink:0;';

    slider.addEventListener('input', () => {
      const v = slider.valueAsNumber / 100;
      valLabel.textContent = slider.value;
      onChange(v);
      lsSet(lsKey, v);
    });

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valLabel);
    return row;
  }

  const sfxRow   = makeSliderRow('SFX Volume',   LS_SFX,   0.8, (v) => audio.setSfxVolume(v));
  const musicRow = makeSliderRow('Music Volume', LS_MUSIC, 0.5, (v) => audio.setMusicVolume(v));

  const backBtn = document.createElement('button');
  backBtn.className = 'ui-button';
  backBtn.textContent = 'BACK';
  backBtn.style.marginTop = '1.5rem';

  panel.appendChild(heading);
  panel.appendChild(sfxRow);
  panel.appendChild(musicRow);
  panel.appendChild(backBtn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // -------------------------------------------------------------------------
  // Apply persisted volumes to audio on creation
  // -------------------------------------------------------------------------
  audio.setSfxVolume(lsGet(LS_SFX, 0.8));
  audio.setMusicVolume(lsGet(LS_MUSIC, 0.5));

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function handleBack(): void {
    hide();
    for (const cb of hiddenSubs) cb();
  }

  backBtn.addEventListener('click', handleBack);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  function show(): void { overlay.style.display = 'flex'; }
  function hide(): void { overlay.style.display = 'none'; }

  function onHidden(cb: () => void): () => void {
    hiddenSubs.push(cb);
    return () => { const i = hiddenSubs.indexOf(cb); if (i !== -1) hiddenSubs.splice(i, 1); };
  }

  function dispose(): void {
    backBtn.removeEventListener('click', handleBack);
    overlay.remove();
  }

  return { show, hide, onHidden, dispose };
}

// ---------------------------------------------------------------------------
// Convenience: read saved volumes without constructing a full Settings object.
// Used by main.ts to apply saved values before the Settings UI is shown.
// ---------------------------------------------------------------------------

export function applySavedVolumes(audio: AudioSystem): void {
  audio.setSfxVolume(lsGet(LS_SFX, 0.8));
  audio.setMusicVolume(lsGet(LS_MUSIC, 0.5));
}

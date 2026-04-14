/**
 * @file src/engine/audio-system.ts
 * @description Audio System — thin wrapper around the Web Audio API.
 * Two buses: SFX (one-shots via Web Audio BufferSourceNode) and music
 * (looping HTMLAudioElement — NOT routed through Web Audio so it is
 * immune to AudioContext suspend/resume timing issues).
 * Buffers are preloaded at startup and cached by logical name.
 * Gracefully no-ops on missing files — never throws.
 *
 * Browser autoplay policy: AudioContext is created suspended. A one-time
 * user-gesture listener (click or keydown) resumes it. SFX calls before
 * that gesture are dropped silently. Music calls use HTMLAudioElement
 * directly so they are not blocked by context state.
 *
 * Design spec: design/quick-specs/audio-system-2026-04-09.md
 *
 * @example
 * ```ts
 * const audio = await createAudioSystem(config);
 * audio.playSfx('jump');
 * audio.playMusic('biome_rocky', { loop: true, fadeInSec: 1 });
 * audio.stopMusic({ fadeOutSec: 0.5 });
 * ```
 */

export interface AudioSystemConfig {
  sfxPaths: Record<string, string>;
  musicPaths: Record<string, string>;
  defaultSfxVolume: number;
  defaultMusicVolume: number;
}

export interface AudioSystem {
  playSfx(name: string): void;
  playMusic(name: string, opts?: { loop?: boolean; fadeInSec?: number }): void;
  stopMusic(opts?: { fadeOutSec?: number }): void;
  setSfxVolume(volume: number): void;
  setMusicVolume(volume: number): void;
  getSfxVolume(): number;
  getMusicVolume(): number;
  dispose(): void;
}

export async function createAudioSystem(config: AudioSystemConfig): Promise<AudioSystem> {
  const ctx = new AudioContext();

  const sfxGain = ctx.createGain();
  sfxGain.gain.value = config.defaultSfxVolume;
  sfxGain.connect(ctx.destination);

  // Resume AudioContext on first user gesture (autoplay policy — SFX only)
  const resumeOnGesture = () => {
    ctx.resume();
    document.removeEventListener('click', resumeOnGesture);
    document.removeEventListener('keydown', resumeOnGesture);
  };
  document.addEventListener('click', resumeOnGesture);
  document.addEventListener('keydown', resumeOnGesture);

  // Preload SFX buffers
  const bufferCache = new Map<string, AudioBuffer>();

  async function loadBuffer(name: string, url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(name, audioBuffer);
      console.log(`[AudioSystem] Loaded SFX "${name}" (${audioBuffer.duration.toFixed(1)}s)`);
    } catch (err) {
      console.warn(`[AudioSystem] Failed to load SFX "${name}":`, err);
    }
  }

  await Promise.all(
    Object.entries(config.sfxPaths).map(([name, url]) => loadBuffer(name, url)),
  );

  // -------------------------------------------------------------------------
  // Music — plain HTMLAudioElement, NOT routed through Web Audio.
  // This sidesteps AudioContext suspend/resume entirely so music starts
  // immediately on the user gesture that triggers the state change.
  // -------------------------------------------------------------------------
  let currentMusicEl: HTMLAudioElement | null = null;
  let musicFadeTimer: ReturnType<typeof setInterval> | null = null;
  let _musicVolume = Math.max(0, Math.min(1, config.defaultMusicVolume));

  function clearFadeTimer(): void {
    if (musicFadeTimer !== null) {
      clearInterval(musicFadeTimer);
      musicFadeTimer = null;
    }
  }

  function fadeOutElement(el: HTMLAudioElement, durationSec: number, onDone: () => void): void {
    clearFadeTimer();
    if (durationSec <= 0) {
      el.pause();
      el.src = '';
      onDone();
      return;
    }
    const startVol = el.volume;
    const steps = 20;
    const intervalMs = (durationSec * 1000) / steps;
    const decrement = startVol / steps;
    let step = 0;
    musicFadeTimer = setInterval(() => {
      step++;
      el.volume = Math.max(0, startVol - decrement * step);
      if (step >= steps) {
        clearFadeTimer();
        el.pause();
        el.src = '';
        onDone();
      }
    }, intervalMs);
  }

  function playMusic(name: string, opts: { loop?: boolean; fadeInSec?: number } = {}): void {
    const { loop = true, fadeInSec = 1.0 } = opts;
    const url = config.musicPaths[name];
    if (!url) {
      console.warn(`[AudioSystem] playMusic: unknown key "${name}"`);
      return;
    }

    // Fade out current track if any, then start new one
    if (currentMusicEl) {
      const old = currentMusicEl;
      currentMusicEl = null;
      fadeOutElement(old, fadeInSec / 2, () => { /* old track cleaned up */ });
    } else {
      clearFadeTimer();
    }

    const el = new Audio(url);
    el.loop = loop;
    el.volume = 0; // start silent for fade-in
    currentMusicEl = el;

    console.log(`[AudioSystem] playMusic "${name}" url=${url} targetVol=${_musicVolume}`);

    el.play().catch((e) => console.warn('[AudioSystem] playMusic play() failed:', e));

    // Fade in
    if (fadeInSec > 0) {
      const target = _musicVolume;
      const steps = 20;
      const intervalMs = (fadeInSec * 1000) / steps;
      const increment = target / steps;
      let step = 0;
      musicFadeTimer = setInterval(() => {
        if (el !== currentMusicEl) { clearFadeTimer(); return; }
        step++;
        el.volume = Math.min(target, increment * step);
        if (step >= steps) clearFadeTimer();
      }, intervalMs);
    } else {
      el.volume = _musicVolume;
    }
  }

  function stopMusic(opts: { fadeOutSec?: number } = {}): void {
    if (!currentMusicEl) return;
    const { fadeOutSec = 0.5 } = opts;
    const el = currentMusicEl;
    currentMusicEl = null;
    fadeOutElement(el, fadeOutSec, () => { /* cleaned up inside */ });
  }

  // -------------------------------------------------------------------------
  // SFX — Web Audio BufferSourceNode
  // -------------------------------------------------------------------------
  function playSfx(name: string): void {
    if (ctx.state !== 'running') return;
    const buffer = bufferCache.get(name);
    if (!buffer) {
      console.warn(`[AudioSystem] playSfx: unknown key "${name}"`);
      return;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(sfxGain);
    source.start(0);
  }

  function setSfxVolume(volume: number): void {
    sfxGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  function setMusicVolume(volume: number): void {
    _musicVolume = Math.max(0, Math.min(1, volume));
    if (currentMusicEl) currentMusicEl.volume = _musicVolume;
  }

  function getSfxVolume(): number {
    return sfxGain.gain.value;
  }

  function getMusicVolume(): number {
    return _musicVolume;
  }

  function dispose(): void {
    clearFadeTimer();
    if (currentMusicEl) {
      currentMusicEl.pause();
      currentMusicEl.src = '';
      currentMusicEl = null;
    }
    ctx.close();
    bufferCache.clear();
  }

  return { playSfx, playMusic, stopMusic, setSfxVolume, setMusicVolume, getSfxVolume, getMusicVolume, dispose };
}

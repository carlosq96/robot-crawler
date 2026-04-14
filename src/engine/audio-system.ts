/**
 * @file src/engine/audio-system.ts
 * @description Audio System — thin wrapper around the Web Audio API.
 * Two buses: SFX (one-shots) and music (looping, cross-fades).
 * Buffers are preloaded at startup and cached by logical name.
 * Gracefully no-ops on missing files — never throws.
 *
 * Browser autoplay policy: AudioContext is created suspended. A one-time
 * user-gesture listener (click or keydown) resumes it. SFX calls before
 * that gesture are dropped silently.
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

interface MusicTrack {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export async function createAudioSystem(config: AudioSystemConfig): Promise<AudioSystem> {
  const ctx = new AudioContext();

  const sfxGain = ctx.createGain();
  sfxGain.gain.value = config.defaultSfxVolume;
  sfxGain.connect(ctx.destination);

  const musicGain = ctx.createGain();
  musicGain.gain.value = config.defaultMusicVolume;
  musicGain.connect(ctx.destination);

  // Resume AudioContext on first user gesture (autoplay policy)
  const resumeOnGesture = () => {
    ctx.resume();
    document.removeEventListener('click', resumeOnGesture);
    document.removeEventListener('keydown', resumeOnGesture);
  };
  document.addEventListener('click', resumeOnGesture);
  document.addEventListener('keydown', resumeOnGesture);

  // Preload buffers
  const bufferCache = new Map<string, AudioBuffer>();

  async function loadBuffer(name: string, url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(name, audioBuffer);
      console.log(`[AudioSystem] Loaded "${name}" (${audioBuffer.duration.toFixed(1)}s)`);
    } catch (err) {
      console.warn(`[AudioSystem] Failed to load "${name}" from ${url}:`, err);
      // Do NOT cache a silent fallback — missing key means "failed to load"
      // so playMusic/playSfx will log a warning instead of playing silence.
    }
  }

  await Promise.all([
    ...Object.entries(config.sfxPaths).map(([name, url]) => loadBuffer(name, url)),
    ...Object.entries(config.musicPaths).map(([name, url]) => loadBuffer(name, url)),
  ]);

  let currentMusic: MusicTrack | null = null;

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

  function fadeOutTrack(track: MusicTrack, durationSec: number): void {
    const now = ctx.currentTime;
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + durationSec);
    track.source.stop(now + durationSec);
  }

  function playMusic(name: string, opts: { loop?: boolean; fadeInSec?: number } = {}): void {
    const { loop = true, fadeInSec = 1.0 } = opts;
    const buffer = bufferCache.get(name);
    if (!buffer) {
      console.warn(`[AudioSystem] playMusic: unknown key "${name}"`);
      return;
    }

    // Fade out current track if any
    if (currentMusic) {
      fadeOutTrack(currentMusic, fadeInSec / 2);
      currentMusic = null;
    }

    const trackGain = ctx.createGain();
    trackGain.gain.value = 0;
    trackGain.connect(musicGain);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(trackGain);

    // Resume the context explicitly here — the gesture handler may not have
    // resolved yet when playMusic is called in the same event-loop tick as
    // the user's click. ctx.resume() is idempotent when already running.
    ctx.resume().then(() => {
      source.start(0);
      const now = ctx.currentTime;
      trackGain.gain.setValueAtTime(0, now);
      trackGain.gain.linearRampToValueAtTime(1, now + fadeInSec);
    }).catch((e) => console.warn('[AudioSystem] playMusic resume failed:', e));

    currentMusic = { source, gain: trackGain };
  }

  function stopMusic(opts: { fadeOutSec?: number } = {}): void {
    if (!currentMusic) return;
    const { fadeOutSec = 0.5 } = opts;
    fadeOutTrack(currentMusic, fadeOutSec);
    currentMusic = null;
  }

  function setSfxVolume(volume: number): void {
    sfxGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  function setMusicVolume(volume: number): void {
    musicGain.gain.value = Math.max(0, Math.min(1, volume));
  }

  function getSfxVolume(): number {
    return sfxGain.gain.value;
  }

  function getMusicVolume(): number {
    return musicGain.gain.value;
  }

  function dispose(): void {
    stopMusic({ fadeOutSec: 0 });
    ctx.close();
    bufferCache.clear();
  }

  return { playSfx, playMusic, stopMusic, setSfxVolume, setMusicVolume, getSfxVolume, getMusicVolume, dispose };
}

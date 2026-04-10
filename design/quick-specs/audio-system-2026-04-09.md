# Quick Design Spec: Audio System

**Type**: New Small System
**Scope**: Thin wrapper around the Web Audio API. Owns two buses (SFX and music), a buffer cache, volume controls, and one-shot SFX + looping music playback. Every other system that needs audio calls `audio.playSfx(name)` or `audio.playMusic(name)`. Gracefully no-ops if an audio file is missing — never throws.
**Date**: 2026-04-09
**Estimated Implementation**: ~2 hours (S effort)

---

## Overview

Audio System is the single point of truth for all sound in Space Runner. It wraps the Web Audio API's `AudioContext` + `GainNode` topology, caches decoded `AudioBuffer` instances in a map keyed by logical name (e.g. `"pickup_crystal"`), and exposes a tiny public API: `playSfx`, `playMusic`, `setSfxVolume`, `setMusicVolume`, `dispose`.

**Browser autoplay policy**: `AudioContext.resume()` is called on the first user input (click or key) to satisfy the user-gesture requirement. Before that gesture, all `playSfx` calls are no-ops (queued or dropped — we drop for simplicity). After the resume, all systems work normally.

**Jam scope simplification**: If a sound file fails to load (HTTP 404, decode error), the system logs once and stubs the entry with a silent buffer. Gameplay continues — no audio asset is a blocker for shipping.

---

## Core Rules

### 1. Initialization

```ts
const audio = await createAudioSystem(config);
```

On creation:
1. Create `AudioContext` (suspended on page load due to autoplay policy)
2. Create SFX master `GainNode` → destination
3. Create music master `GainNode` → destination
4. Preload all buffers listed in `audio.json` (parallel fetch + `decodeAudioData`)
5. Failed loads get a `silentBuffer` stub (warning logged once per failure)
6. Attach a one-time `document.click` listener that calls `audioContext.resume()` and removes itself

### 2. SFX playback

```ts
audio.playSfx('pickup_crystal');
```

- Look up the buffer by name. If not in cache, log warn + return.
- Create a new `AudioBufferSourceNode`, connect to SFX gain, start at t=0.
- No stop semantics — SFX are one-shots, they end when the buffer ends.
- Multiple concurrent plays of the same sound are allowed (each gets its own source node).

### 3. Music playback

```ts
audio.playMusic('biome_rocky', { loop: true, fadeInSec: 1.0 });
```

- Fades out currently-playing music (if any) over `fadeInSec / 2`
- Creates a new source node connected to a temporary per-track `GainNode` → music master gain
- Starts the new track with the per-track gain ramping from 0 → 1 over `fadeInSec`
- Stores a reference to the current music source for later stop/fade

Only one music track at a time. Calling `playMusic` again cross-fades.

### 4. Volume controls

```ts
audio.setSfxVolume(0.8);    // 0..1
audio.setMusicVolume(0.5);  // 0..1
```

Sets the master gain value for the respective bus. Linear scale (0 = silent, 1 = full). Persisted by Settings system (not here).

### 5. Stop music

```ts
audio.stopMusic({ fadeOutSec: 0.5 });
```

Fades the currently-playing music to 0 over `fadeOutSec`, then disposes the source node. No-op if nothing is playing.

### 6. Dispose

- Stops any currently-playing music
- Closes `AudioContext` (releases system resources)
- Clears the buffer cache
- Idempotent

---

## Public API Surface (LOCKED contract)

```ts
export interface AudioSystemConfig {
  sfxPaths: Record<string, string>;     // name → URL
  musicPaths: Record<string, string>;   // name → URL
  defaultSfxVolume: number;             // 0..1
  defaultMusicVolume: number;           // 0..1
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

export function createAudioSystem(config: AudioSystemConfig): Promise<AudioSystem>;
```

---

## Tuning Knobs

| Knob | Default | Range | Category | Rationale |
|---|---|---|---|---|
| `defaultSfxVolume` | 0.8 | 0..1 | mix | Slightly below max so UI sliders have headroom |
| `defaultMusicVolume` | 0.5 | 0..1 | mix | Music should sit behind SFX in the mix |
| default `fadeInSec` | 1.0 | 0–3 | feel | Music fade-in on biome change |
| default `fadeOutSec` | 0.5 | 0–2 | feel | Music fade-out on stop |

All tuning lives in `assets/data/audio.json` alongside the path tables.

---

## Data Files

### `assets/data/audio.json`
```json
{
  "defaultSfxVolume": 0.8,
  "defaultMusicVolume": 0.5,
  "sfxPaths": {
    "pickup_crystal":    "/assets/audio/sfx/pickup_crystal.ogg",
    "obstacle_hit_rock": "/assets/audio/sfx/obstacle_hit_rock.ogg",
    "obstacle_hit_ice":  "/assets/audio/sfx/obstacle_hit_ice.ogg",
    "jump":              "/assets/audio/sfx/jump.ogg",
    "slide":             "/assets/audio/sfx/slide.ogg",
    "super_suit":        "/assets/audio/sfx/super_suit.ogg",
    "jump_gate_warp":    "/assets/audio/sfx/jump_gate_warp.ogg",
    "player_death":      "/assets/audio/sfx/player_death.ogg"
  },
  "musicPaths": {
    "title":        "/assets/audio/music/title.ogg",
    "biome_rocky":  "/assets/audio/music/biome_rocky.ogg",
    "biome_ice":    "/assets/audio/music/biome_ice.ogg",
    "biome_volcanic": "/assets/audio/music/biome_volcanic.ogg"
  }
}
```

**Asset production note:** Jam-scope audio can all be free CC0 sources or cheap procedural synthesis. This file lists names; actual sound files come later. System handles missing files gracefully.

---

## Affected Systems

| System | Impact | Action Required |
|---|---|---|
| Obstacle System | Calls `playSfx('obstacle_hit_...')` on hit | Dependency; no change |
| Pickup System | Calls `playSfx('pickup_crystal')` on pickup | Dependency; no change |
| Movement | Calls `playSfx('jump')`, `playSfx('slide')` on actions | Wire in the Movement rework (follow-up) |
| Super-Suit Combat | Calls `playSfx('super_suit')` on activation | Wire in that spec |
| Planet/Checkpoint | Calls `playMusic(biome_*)` on planet change + `playSfx('jump_gate_warp')` | Wire in that spec |
| Player System | Calls `playSfx('player_death')` on death | Wire in player.ts's `triggerDeath` |
| Settings | Calls `setSfxVolume/setMusicVolume` | Wire in Settings spec |

---

## Acceptance Criteria

- [ ] `createAudioSystem(cfg)` resolves without throwing, even if every audio file 404s
- [ ] First user gesture (click / key) resumes the AudioContext
- [ ] `playSfx('pickup_crystal')` produces audible sound (when the file exists) after gesture
- [ ] Multiple concurrent `playSfx('jump')` calls do not truncate each other
- [ ] `playMusic('biome_rocky', { fadeInSec: 1 })` fades in over 1 s
- [ ] Calling `playMusic` again while music is playing cross-fades cleanly
- [ ] `setSfxVolume(0)` mutes all SFX immediately; `setSfxVolume(1)` restores
- [ ] Dispose closes the AudioContext and clears the buffer cache
- [ ] Missing audio file logs a single warning, does not throw, returns silent stub

---

## Systems Index
Present in `design/gdd/systems-index.md` as system #6, L1, T1, S-effort. No update needed.

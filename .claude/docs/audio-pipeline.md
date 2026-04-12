# Audio Pipeline — Space Runner

## ElevenLabs Skills (installed 2026-04-11)

Two Claude Code skills are installed for AI-generated audio:

```
npx skills add elevenlabs/skills --skill music
npx skills add elevenlabs/skills --skill sound-effects
```

### `/music` skill
Generates background music tracks via ElevenLabs API.
Use for: biome music (rocky, ice, volcanic), title screen theme, results screen sting.

**Usage:**
```
/music "tense electronic sci-fi loop, 120bpm, 30 seconds, seamless loop"
```

### `/sound-effects` skill
Generates one-shot SFX via ElevenLabs API.
Use for: jump, land, slide, obstacle hit, gate warp, stardust pickup, death.

**Usage:**
```
/sound-effects "robotic jump whoosh, short, punchy"
```

## Planned SFX list (Space Runner)

| Event | Description | Priority |
|---|---|---|
| `jump` | Short whoosh upward | T1 |
| `land` | Metallic thud | T1 |
| `slide` | Scrape/skid | T1 |
| `death` | Crash + crunch | T1 |
| `stardust_pickup` | Sparkle chime | T1 |
| `warp_launch` | Sci-fi launch whoosh | T1 |
| `warp_land` | Impact boom on new planet | T1 |
| `obstacle_break` | Crunch/shatter | T2 |

## Planned music tracks

| Track | Description | Priority |
|---|---|---|
| `title` | Ambient space, slow | T1 |
| `rocky` | Gritty industrial, driving | T1 |
| `ice` | Cold electronic, tense | T1 |
| `volcanic` | Heavy, intense | T1 |
| `results` | Short victory/defeat sting | T1 |

## Audio System integration

Audio System is not yet implemented (spec: `design/quick-specs/audio-system-2026-04-09.md`).
When implemented, SFX events will be:
- `audio.playSfx('jump')` — fire-and-forget
- `audio.playMusic('rocky', { crossfadeSec: 1.0 })` — with cross-fade

Generated files go to `assets/audio/sfx/` and `assets/audio/music/`.

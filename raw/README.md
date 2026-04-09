# raw/ — Meshy AI raw downloads

This directory holds **uncompressed** Meshy AI GLB exports before they get
Draco-compressed and committed to `assets/models/`.

**This entire directory is gitignored.** Only the compressed outputs in
`assets/models/` are committed.

## Workflow

1. Generate a model in [Meshy AI](https://www.meshy.ai/)
2. Download as GLB
3. Save it here with a kebab-case name: `raw/player.glb`, `raw/enemy-grunt.glb`, etc.
4. Run the compression pipeline:
   ```bash
   npm install              # first time only
   npm run compress-models
   ```
5. The compressed output lands at `assets/models/<name>.glb`
6. Verify it loads at https://gltf-viewer.donmccurdy.com/ (drag-and-drop)
7. `git add assets/models/<name>.glb` and commit

## Per-model size budget

- Standard models: **< 2 MB** compressed (per ADR-0005)
- Boss model exception: **< 3 MB** compressed
- Total `assets/models/` budget: **< 10 MB** (jam load rule)

The `compress-models` script enforces these and exits with an error if exceeded.

## If a model is over budget

In Meshy:
- Reduce target poly count (try 3000-5000 tris max)
- Reduce texture resolution (1024 → 512 for normal/roughness/metallic)
- Re-export → re-run `npm run compress-models`

## Naming convention

`kebab-case.glb` (per `.claude/docs/technical-preferences.md`):

| Source | Output |
|---|---|
| `raw/player.glb` | `assets/models/player.glb` |
| `raw/enemy-grunt.glb` | `assets/models/enemy-grunt.glb` |
| `raw/dungeon-tile-floor.glb` | `assets/models/dungeon-tile-floor.glb` |
| `raw/crystal-pickup.glb` | `assets/models/crystal-pickup.glb` |
| `raw/boss.glb` | `assets/models/boss.glb` |

## See also

- ADR-0005 (Draco compression mandatory): `docs/architecture/ADR-0005-draco-compression.md`
- ADR-0010 (Meshy AI pipeline): `docs/architecture/ADR-0010-meshy-asset-pipeline.md`
- Compression script: `scripts/compress-models.mjs`

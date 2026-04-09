#!/usr/bin/env node
/**
 * compress-models.mjs
 *
 * Batch-compresses Meshy AI raw GLB downloads from raw/ into Draco-compressed
 * outputs in assets/models/. Per ADR-0005 (Draco mandatory) and ADR-0010
 * (Meshy AI pipeline).
 *
 * Usage:
 *   1. Drop a Meshy GLB into raw/ (e.g. raw/player.glb)
 *   2. Run: npm run compress-models
 *   3. The compressed output appears at assets/models/player.glb
 *
 * Naming convention (kebab-case):
 *   raw/player.glb           → assets/models/player.glb
 *   raw/enemy-grunt.glb      → assets/models/enemy-grunt.glb
 *   raw/dungeon-tile-wall.glb → assets/models/dungeon-tile-wall.glb
 *
 * Per-model size budget: 2 MB (3 MB max for boss). The script logs sizes
 * and warns if any model exceeds the budget.
 */

import { readdir, mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, basename, extname } from 'node:path';

const exec = promisify(execFile);

const RAW_DIR = 'raw';
const OUT_DIR = 'assets/models';
const SIZE_BUDGET_MB = 2;
const SIZE_BUDGET_BOSS_MB = 3;
const DRACO_LEVEL = 10;

const fmt = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

async function main() {
  // Ensure raw/ exists
  try {
    await stat(RAW_DIR);
  } catch {
    console.error(`[compress-models] raw/ directory does not exist. Create it and drop Meshy GLBs in.`);
    process.exit(1);
  }

  // Ensure assets/models/ exists
  await mkdir(OUT_DIR, { recursive: true });

  // Find all .glb files in raw/
  const entries = await readdir(RAW_DIR);
  const glbs = entries.filter((f) => extname(f).toLowerCase() === '.glb');

  if (glbs.length === 0) {
    console.log('[compress-models] No .glb files in raw/ — nothing to do.');
    console.log('  Drop a Meshy export into raw/ and re-run.');
    return;
  }

  console.log(`[compress-models] Found ${glbs.length} GLB(s) to compress\n`);

  let allOk = true;
  for (const file of glbs) {
    const input = join(RAW_DIR, file);
    // Strip any ".raw." suffix and use kebab-case name
    const stem = basename(file, '.glb').replace(/\.raw$/, '');
    const output = join(OUT_DIR, `${stem}.glb`);

    const inputStat = await stat(input);
    process.stdout.write(`  ${file} (${fmt(inputStat.size)}) → ${output} ... `);

    try {
      await exec('npx', [
        'gltf-pipeline',
        '-i', input,
        '-o', output,
        '-d',
        `--draco.compressionLevel=${DRACO_LEVEL}`,
      ]);

      const outputStat = await stat(output);
      const ratio = ((1 - outputStat.size / inputStat.size) * 100).toFixed(0);
      const isBoss = stem.toLowerCase().includes('boss');
      const budget = isBoss ? SIZE_BUDGET_BOSS_MB : SIZE_BUDGET_MB;

      if (outputStat.size / 1024 / 1024 > budget) {
        console.log(`OVER BUDGET: ${fmt(outputStat.size)} (limit ${budget} MB, -${ratio}%)`);
        console.log(`    ⚠ Reduce poly count or texture size in Meshy and re-export.`);
        allOk = false;
      } else {
        console.log(`${fmt(outputStat.size)} (-${ratio}%)`);
      }
    } catch (err) {
      console.log(`FAILED`);
      console.log(`    ${err.message}`);
      allOk = false;
    }
  }

  // Final total budget check (per ADR-0005: < 10 MB total)
  const allOutputs = await readdir(OUT_DIR);
  let totalSize = 0;
  for (const f of allOutputs) {
    if (extname(f).toLowerCase() === '.glb') {
      const s = await stat(join(OUT_DIR, f));
      totalSize += s.size;
    }
  }
  const totalMb = totalSize / 1024 / 1024;
  console.log(`\n[compress-models] Total assets/models/ size: ${fmt(totalSize)} (budget: 10 MB)`);
  if (totalMb > 10) {
    console.log(`  ⚠ TOTAL OVER BUDGET — drop or re-compress models.`);
    allOk = false;
  }

  if (!allOk) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[compress-models] fatal:', err);
  process.exit(1);
});

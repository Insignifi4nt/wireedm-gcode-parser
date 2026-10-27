// Captures the frozen PlaneGCS corpus used to compare native sketch solves with PlaneGCS:
//   npm run solver:corpus -- --check    fails unless the corpus holds every input the CAD suites solve, unchanged
//   npm run solver:corpus -- --update   adds new inputs and refreshes recorded ones, keeping the rest
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mode = process.argv.includes('--update') ? 'update' : process.argv.includes('--check') ? 'check' : undefined;
if (!mode) { console.error('Usage: npm run solver:corpus -- --check | --update'); process.exit(2); }
const shards = mkdtempSync(join(tmpdir(), 'planegcs-corpus-'));
const vitest = env => spawnSync('npx', ['vitest', 'run', '--config', 'vitest.planegcs-corpus.config.ts'],
  { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, PLANEGCS_CORPUS_SHARDS: shards, ...env } }).status;
try {
  if (vitest({}) !== 0) throw new Error('The CAD suites failed while their inputs were recorded.');
  if (vitest({ PLANEGCS_CORPUS_PHASE: 'build', PLANEGCS_CORPUS_MODE: mode }) !== 0) throw new Error(`The corpus ${mode} failed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { rmSync(shards, { recursive: true, force: true }); }

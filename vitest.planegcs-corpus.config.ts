import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// `npm run solver:corpus`: the first pass runs the CAD suites and records every sketch solve input;
// the build pass asks PlaneGCS for each one's outcome. See `scripts/planegcs-corpus.mjs`.
const build = process.env.PLANEGCS_CORPUS_PHASE === 'build';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: build
    ? { globals: true, environment: 'node', include: ['src/features/cad/sketch-solver/native/__tests__/planeGcsCorpusBuild.corpus.ts'], testTimeout: 600_000 }
    : { globals: true, environment: 'jsdom', maxWorkers: 4, include: ['src/features/cad/**/*.{test,spec}.{ts,tsx}'],
      // The replay solves every record already in the corpus; capturing it would only echo them.
      exclude: ['**/node_modules/**', 'src/features/cad/sketch-solver/__tests__/planeGcsCorpus.test.ts'],
      setupFiles: ['./src/testSetup.ts', './src/features/cad/sketch-solver/native/__tests__/planeGcsCorpusCapture.ts'] }
});

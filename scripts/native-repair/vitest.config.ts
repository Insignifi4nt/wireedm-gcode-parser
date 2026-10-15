import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Existing native fixtures run against an explicitly selected CANDIDATE pair.
// The original installed dependency, loader and WASM remain untouched.
export default defineConfig({
  resolve: { alias: {
    'replicad-opencascadejs': fileURLToPath(new URL('./candidate-factory.ts', import.meta.url)),
    '@': fileURLToPath(new URL('../../src', import.meta.url))
  } },
  test: { globals: true, environment: 'jsdom', setupFiles: ['./src/testSetup.ts'],
    include: ['src/features/cad/kernel/*.test.ts', 'scripts/native-repair/*.test.ts'], maxWorkers: 4 }
});

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Pure geometry/planning suites need no DOM or browser-storage coordination shim.
const pureDomainTests = [
  'src/domain/{compensation,execution-plan,path-editor,path-intel,simulation}/**/*.{test,spec}.{ts,tsx}'
];

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: { name: 'pure-domain', environment: 'node', include: pureDomainTests, setupFiles: [] }
      },
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: pureDomainTests,
          setupFiles: ['./src/testSetup.ts']
        }
      }
    ]
  }
});

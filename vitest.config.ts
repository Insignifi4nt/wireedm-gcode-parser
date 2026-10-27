import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

// Pure geometry/planning suites need no DOM or browser-storage coordination shim.
const pureDomainTests = [
  'src/domain/{compensation,execution-plan,path-editor,path-intel,simulation}/**/*.{test,spec}.{ts,tsx}',
  // CAD geometry, expression and schema suites have no DOM dependencies.
  // CAD storage suites live outside this directory and keep the browser adapter.
  'src/domain/cad/__tests__/**/*.{test,spec}.{ts,tsx}'
];

// Suites that solve sketches with the PlaneGCS runtime or the application runtime.
const nativeDifferentialTests = [
  'src/features/cad/sketch-solver/{cadSketchMidpointRuntime,cadSketchSolver*Relations,cadSketchSolverAxisDistance,cadSketchSolverCorners,cadSketchSolverRuntime,cadSketchSolveContracts}.test.ts',
  'src/features/cad/cad*Preparation.test.ts'
];

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  test: {
    globals: true,
    // Many-core hosts otherwise run dozens of jsdom/native-kernel workers at
    // once and starve real serialization/cancellation checks of their time budget.
    maxWorkers: Math.min(4, availableParallelism()),
    projects: [
      {
        extends: true,
        test: { name: 'pure-domain', environment: 'node', include: pureDomainTests, setupFiles: [] }
      },
      {
        // Compares the sketch suites' solves with PlaneGCS alone; see the setup file.
        extends: true,
        test: {
          name: 'native-differential',
          environment: 'node',
          include: nativeDifferentialTests,
          setupFiles: ['./src/features/cad/sketch-solver/native/__tests__/nativeDifferentialSetup.ts']
        }
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

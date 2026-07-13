import { describe, expect, it } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';

import { clusterSegmentEndpoints } from '../endpointClusters';
import { sanitizePathSegments } from '../sanitizeSegments';
import { createLineSegment } from '../segments';
import { SpatialHash } from '../spatialIndex';

describe('path-intel endpoint clustering performance', () => {
  it(
    'keeps 4,000 sequential lines comfortably sub-quadratic after warm-up',
    { timeout: 30_000 },
    () => {
      const oneThousand = sequentialLines(1_000);
      const fourThousand = sequentialLines(4_000);

      clusterSegmentEndpoints(sequentialLines(250));
      clusterSegmentEndpoints(oneThousand);

      const oneThousandMs = median([0, 1, 2].map(() => timeClustering(oneThousand)));
      const fourThousandMs = median([0, 1, 2].map(() => timeClustering(fourThousand)));
      const growthRatio = fourThousandMs / Math.max(oneThousandMs, 0.001);

      console.info(
        `[path-intel-performance] 1000=${oneThousandMs.toFixed(2)}ms 4000=${fourThousandMs.toFixed(2)}ms ratio=${growthRatio.toFixed(2)}x`
      );

      expect(fourThousandMs).toBeLessThan(5_000);
      expect(growthRatio).toBeLessThan(8);
    }
  );

  it(
    'keeps disjoint oversized-bound queries sub-quadratic',
    { timeout: 30_000 },
    () => {
      exerciseOversizedBounds(100);

      const fourThousandMs = median(
        [0, 1, 2].map(() => timeOversizedBounds(4_000))
      );
      const sixteenThousandMs = median(
        [0, 1, 2].map(() => timeOversizedBounds(16_000))
      );
      const growthRatio = sixteenThousandMs / Math.max(fourThousandMs, 0.001);

      console.info(
        `[path-intel-overflow-performance] 4000=${fourThousandMs.toFixed(2)}ms 16000=${sixteenThousandMs.toFixed(2)}ms ratio=${growthRatio.toFixed(2)}x`
      );

      expect(sixteenThousandMs).toBeLessThan(10_000);
      expect(growthRatio).toBeLessThan(8);
    }
  );

  it(
    'keeps mixed near-origin and far-coordinate point queries sub-quadratic',
    { timeout: 30_000 },
    () => {
      exerciseMixedLocationPoints(100);

      const oneThousandMs = median(
        [0, 1, 2].map(() => timeMixedLocationPoints(1_000))
      );
      const fourThousandMs = median(
        [0, 1, 2].map(() => timeMixedLocationPoints(4_000))
      );
      const growthRatio = fourThousandMs / Math.max(oneThousandMs, 0.001);

      console.info(
        `[path-intel-mixed-performance] 1000=${oneThousandMs.toFixed(2)}ms 4000=${fourThousandMs.toFixed(2)}ms ratio=${growthRatio.toFixed(2)}x`
      );

      expect(fourThousandMs).toBeLessThan(5_000);
      expect(growthRatio).toBeLessThan(8);
    }
  );

  it(
    'keeps equal mixed-size disjoint segment bounds sub-quadratic',
    { timeout: 30_000 },
    () => {
      const oneThousand = mixedSizeLines(1_000);
      const fourThousand = mixedSizeLines(4_000);
      sanitizeMixedSizeLines(mixedSizeLines(100));
      sanitizeMixedSizeLines(oneThousand);

      const oneThousandMs = median(
        [0, 1, 2, 3, 4].map(() => timeMixedSizeSanitization(oneThousand))
      );
      const fourThousandMs = median(
        [0, 1, 2, 3, 4].map(() => timeMixedSizeSanitization(fourThousand))
      );
      const growthRatio = fourThousandMs / Math.max(oneThousandMs, 0.001);

      console.info(
        `[path-intel-mixed-size-performance] 1000=${oneThousandMs.toFixed(2)}ms 4000=${fourThousandMs.toFixed(2)}ms ratio=${growthRatio.toFixed(2)}x`
      );

      expect(growthRatio).toBeLessThan(8);
    }
  );

  it(
    'keeps live validation of 4,000 disjoint G40 open paths sub-quadratic',
    { timeout: 30_000 },
    () => {
      const oneThousand = disjointOpenDocument(1_000);
      const fourThousand = disjointOpenDocument(4_000);
      validateDisjointOpenDocument(disjointOpenDocument(100));
      validateDisjointOpenDocument(oneThousand);

      const oneThousandMs = median(
        [0, 1, 2].map(() => timeDisjointOpenValidation(oneThousand))
      );
      const fourThousandMs = median(
        [0, 1, 2].map(() => timeDisjointOpenValidation(fourThousand))
      );
      const growthRatio = fourThousandMs / Math.max(oneThousandMs, 0.001);

      console.info(
        `[upid-live-validation-performance] 1000=${oneThousandMs.toFixed(2)}ms 4000=${fourThousandMs.toFixed(2)}ms ratio=${growthRatio.toFixed(2)}x`
      );

      expect(fourThousandMs).toBeLessThan(10_000);
      expect(growthRatio).toBeLessThan(8);
    }
  );
});

function sequentialLines(count: number) {
  return Array.from({ length: count }, (_, index) =>
    createLineSegment({
      id: `perf_${String(index).padStart(5, '0')}`,
      source: {
        sourceEntityIndex: index,
        sourceEntityType: 'line',
        layer: 'PERF',
        exact: true
      },
      start: { x: index, y: 0 },
      end: { x: index + 1, y: 0 }
    })
  );
}

function timeClustering(segments: ReturnType<typeof sequentialLines>) {
  const start = performance.now();
  clusterSegmentEndpoints(segments);
  return performance.now() - start;
}

function median(values: number[]) {
  return values.slice().sort((left, right) => left - right)[Math.floor(values.length / 2)];
}

function timeOversizedBounds(count: number) {
  const start = performance.now();
  exerciseOversizedBounds(count);
  return performance.now() - start;
}

function exerciseOversizedBounds(count: number) {
  const index = new SpatialHash<number>({ cellSize: 1, maxCellsPerBounds: 4 });

  for (let entry = 0; entry < count; entry++) {
    const minX = entry * 2_000;
    index.insertBounds(
      { minX, minY: 0, maxX: minX + 1_000, maxY: 1_000 },
      entry
    );
    const result = index.queryPoint({ x: minX + 500, y: 500 });
    if (result.length !== 1 || result[0] !== entry) {
      throw new Error(`Unexpected oversized-bound query result at entry ${entry}.`);
    }
  }
}

function timeMixedLocationPoints(count: number) {
  const start = performance.now();
  exerciseMixedLocationPoints(count);
  return performance.now() - start;
}

function exerciseMixedLocationPoints(count: number) {
  const index = new SpatialHash<number>({ cellSize: 1, maxCellsPerBounds: 4 });

  for (let entry = 0; entry < count; entry++) {
    index.insertPoint({ x: entry * 4, y: 0 }, entry);
  }
  for (let entry = 0; entry < count; entry++) {
    const value = count + entry;
    const x = 1e16 + entry * 4;
    index.insertPoint({ x, y: 0 }, value);
    const result = index.queryPoint({ x, y: 0 });
    if (result.length !== 1 || result[0] !== value) {
      throw new Error(`Unexpected mixed-location query result at entry ${entry}.`);
    }
  }
}

function timeMixedSizeSanitization(segments: ReturnType<typeof mixedSizeLines>) {
  const start = performance.now();
  sanitizeMixedSizeLines(segments);
  return performance.now() - start;
}

function sanitizeMixedSizeLines(segments: ReturnType<typeof mixedSizeLines>) {
  const result = sanitizePathSegments(segments, { coincidenceEpsilon: 1e-6 });
  if (result.segments.length !== segments.length || result.diagnostics.length !== 0) {
    throw new Error('Unexpected mixed-size sanitization result.');
  }
}

function mixedSizeLines(count: number) {
  const half = Math.floor(count / 2);
  const large = Array.from({ length: half }, (_, index) =>
    createLineSegment({
      id: `mixed_large_${String(index).padStart(5, '0')}`,
      source: {
        sourceEntityIndex: index,
        sourceEntityType: 'line',
        layer: 'PERF',
        exact: true
      },
      start: { x: index * 2e110, y: 0 },
      end: { x: index * 2e110 + 1e110, y: 0 }
    })
  );
  const small = Array.from({ length: count - half }, (_, index) =>
    createLineSegment({
      id: `mixed_small_${String(index).padStart(5, '0')}`,
      source: {
        sourceEntityIndex: half + index,
        sourceEntityType: 'line',
        layer: 'PERF',
        exact: true
      },
      start: { x: -1_000_000 - index * 4, y: 0 },
      end: { x: -999_999 - index * 4, y: 0 }
    })
  );
  return [...large, ...small];
}

function disjointOpenDocument(count: number) {
  return createUpidFromDxfEntities(
    Array.from({ length: count }, (_, index) => ({
      type: 'line' as const,
      layer: 'PERF',
      start: { x: index * 3, y: 0 },
      end: { x: index * 3 + 1, y: 0 }
    })),
    { operationOrderStrategy: 'source-order' }
  );
}

function timeDisjointOpenValidation(document: ReturnType<typeof disjointOpenDocument>) {
  const start = performance.now();
  validateDisjointOpenDocument(document);
  return performance.now() - start;
}

function validateDisjointOpenDocument(document: ReturnType<typeof disjointOpenDocument>) {
  const report = validateUpidDocument(document);
  if (!report.structurallyValid || !report.valid) {
    throw new Error('Unexpected invalid disjoint G40 open-path document.');
  }
}

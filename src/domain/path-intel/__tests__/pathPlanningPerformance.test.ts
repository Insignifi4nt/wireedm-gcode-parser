import { describe, expect, it } from 'vitest';

import { clusterSegmentEndpoints } from '../endpointClusters';
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

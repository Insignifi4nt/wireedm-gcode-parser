import { expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { compileReleasedPieces } from '../releasedPieces';
import { resolveSimulationSettings } from '../simulation';
import type { SimulationStep } from '../types';

function fixture(ranges: readonly { start: number; end: number }[]) {
  const document = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
  document.geometryBasis = 'wire-centre';
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: 5, y: 0 }, review: 'reviewed' } };
  const execution = compileWireEdmExecutionPlan(document);
  if (!execution.ok) throw new Error(JSON.stringify(execution.diagnostics));
  const motion = execution.plan.events.find(event => event.kind === 'motion' && event.role === 'contour');
  if (!motion || motion.kind !== 'motion') throw new Error('Expected contour motion');
  const steps: SimulationStep[] = ranges.map((sourceRange, index) => ({
    event: { ...motion, id: `fragment-${index}`, sourceRange },
    startSeconds: index, endSeconds: index + 1, lengthMm: 0, path: [], wireThreaded: true
  }));
  const settings = resolveSimulationSettings({ stock: { originX: -10, originY: -10, width: 20, depth: 20, bottomZ: 0, thickness: 5 },
    wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, retention: 'retain' })!;
  return (count = steps.length) => compileReleasedPieces(document, steps.slice(0, count), settings, execution.plan.source.operationIds);
}

it('merges many contour fragments with a bounded amount of ordering work', () => {
  const fragmentCount = 20_000;
  const compile = fixture(Array.from({ length: fragmentCount }, (_, index) => ({ start: index / fragmentCount, end: (index + 1) / fragmentCount })));
  // Count comparator work instead of imposing a CI wall-clock threshold. Other
  // material topology sorts remain allowed; whole-history re-sorting does not.
  const originalSort = Array.prototype.sort;
  let comparisons = 0;
  let result: ReturnType<typeof compile>;
  try {
    Array.prototype.sort = function (compare) {
      return originalSort.call(this, compare && ((a, b) => { comparisons++; return compare(a, b); }));
    };
    result = compile();
  } finally {
    Array.prototype.sort = originalSort;
  }
  expect(result.pieces).toHaveLength(1);
  expect(result.pieces[0].releaseSeconds).toBe(fragmentCount);
  expect(result.diagnostics).toEqual([]);
  expect(comparisons).toBeLessThan(fragmentCount * 10);
});

it('merges reversed, overlapping and out-of-order fragments only when the entire circular source is cut', () => {
  const compile = fixture([
    { start: 1, end: 0.75 }, { start: 0.25, end: 0 }, { start: 0.6, end: 0.4 },
    { start: 0.2, end: 0.5 }, { start: 0.5, end: 0.7 }, { start: 0.65, end: 0.9 }
  ]);
  for (let count = 1; count < 6; count++) expect(compile(count).pieces).toEqual([]);
  expect(compile().pieces).toMatchObject([{ releaseSeconds: 6, releaseEventId: 'fragment-5' }]);
});

it('preserves a sub-tolerance uncut bridge until an exact fragment fills it', () => {
  const compile = fixture([
    { start: 0, end: 0.5 }, { start: 0.5 + 1e-12, end: 1 },
    { start: 0.75, end: 1 }, { start: 0.5, end: 0.5 + 1e-12 }
  ]);
  expect(compile(3).pieces).toEqual([]);
  expect(compile().pieces).toMatchObject([{ releaseSeconds: 4, releaseEventId: 'fragment-3' }]);
});

it('tracks each completed source once for a long closed contour instead of rescanning every prior segment', () => {
  const segmentCount = 2_000;
  const document = createUpidFromDxfEntities([{ type: 'lwpolyline', layer: 'CUT', closed: true,
    vertices: Array.from({ length: segmentCount }, (_, index) => ({
      x: 5 * Math.cos(2 * Math.PI * index / segmentCount), y: 5 * Math.sin(2 * Math.PI * index / segmentCount), bulge: 0
    })) }]);
  document.geometryBasis = 'wire-centre';
  document.setup = { initialWirePosition: { kind: 'manual', point: { ...document.plan.operations[0].startPoint }, review: 'reviewed' } };
  const execution = compileWireEdmExecutionPlan(document);
  if (!execution.ok) throw new Error(JSON.stringify(execution.diagnostics));
  const motions = execution.plan.events.filter(event => event.kind === 'motion' && event.role === 'contour');
  expect(motions).toHaveLength(segmentCount);
  const steps: SimulationStep[] = motions.map((event, index) => ({ event,
    startSeconds: index, endSeconds: index + 1, lengthMm: 0, path: [], wireThreaded: true }));
  let referenceReads = 0;
  for (const ref of document.plan.operations[0].segmentRefs) {
    const id = ref.segmentId;
    Object.defineProperty(ref, 'segmentId', { get: () => { referenceReads++; return id; } });
  }
  const settings = resolveSimulationSettings({ stock: { originX: -10, originY: -10, width: 20, depth: 20, bottomZ: 0, thickness: 5 },
    wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, retention: 'retain' })!;
  const result = compileReleasedPieces(document, steps, settings, execution.plan.source.operationIds);
  expect(result.pieces).toHaveLength(1);
  expect(result.pieces[0]).toMatchObject({ releaseSeconds: segmentCount, releaseEventId: motions.at(-1)!.id });
  expect(result.diagnostics).toEqual([]);
  expect(referenceReads).toBeLessThan(segmentCount * 10);
});

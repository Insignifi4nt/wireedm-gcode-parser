import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileSimulation } from '../simulation';

import {
  arcSweep, distanceToMotion, interpolateMotion, motionLength, motionPolyline, pointInPolygon, type SimulationMotion
} from '../geometry';

function tinyArcMotion(clockwise: boolean, reversed: boolean, radius = 2.5e15): SimulationMotion {
  const centerY = clockwise ? -radius : radius;
  let document = createUpidFromDxfEntities([{
    type: 'arc', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
    center: { x: 0.5, y: centerY }, radius, startAngle: clockwise ? 90 : -90,
    endAngle: clockwise ? 90 : -90, sweepRadians: (clockwise ? -1 : 1) / radius, clockwise
  }]);
  document.geometryBasis = 'wire-centre';
  if (reversed) {
    const next = reversePathOperation(document, document.plan.operations[0].id);
    if (!next) throw new Error('Expected reversible arc operation');
    document = next;
  }
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: reversed ? 1 : 0, y: 0 }, review: 'reviewed' } };
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const motion = compiled.plan.events.find((event) => event.kind === 'motion');
  if (!motion || motion.kind !== 'motion') throw new Error('Expected compiled arc motion');
  return motion;
}

describe('simulation arc arithmetic', () => {
  it.each([
    { clockwise: false, reversed: false }, { clockwise: true, reversed: false },
    { clockwise: false, reversed: true }, { clockwise: true, reversed: true }
  ])('preserves sub-ulp sweep interpolation, clockwise=$clockwise reversed=$reversed', ({ clockwise, reversed }) => {
    const motion = tinyArcMotion(clockwise, reversed);
    const midpoint = interpolateMotion(motion, 0.5);
    // The one-millimeter chord is symmetric about x=0.5. Its sag is -1/(8r)
    // for the CCW arc below its center, with corrections below 1e-48 mm.
    expect(midpoint.x).toBeCloseTo(0.5, 14);
    expect(Math.abs(midpoint.y - (clockwise ? 5e-17 : -5e-17))).toBeLessThan(1e-30);
    expect(motionLength(motion)).toBeCloseTo(1, 14);
    expect(Math.sign(arcSweep(motion))).toBe(clockwise !== reversed ? -1 : 1);
    expect(interpolateMotion(motion, 0)).toEqual(motion.start);
    expect(interpolateMotion(motion, 1)).toEqual(motion.end);
  });

  it('keeps finite arc length when unscaled radial products overflow', () => {
    const motion = tinyArcMotion(false, false, 1e200);
    expect(motionLength(motion)).toBeCloseTo(1, 14);
    expect(interpolateMotion(motion, 0.5).x).toBeCloseTo(0.5, 14);
    expect(Math.abs(interpolateMotion(motion, 0.5).y / (-1 / (8e200)) - 1)).toBeLessThan(1e-14);
  });

  it('retains small endpoint displacement after rotating a distant-center arc', () => {
    const angle = 0.1;
    const radius = 2.5e15;
    const base = tinyArcMotion(false, false);
    const motion = { ...base, start: { x: 0, y: 0 }, end: { x: -Math.sin(angle), y: Math.cos(angle) },
      center: { x: -radius * Math.cos(angle), y: -radius * Math.sin(angle) } };
    expect(motionLength(motion)).toBeCloseTo(1, 14);
    const midpoint = interpolateMotion(motion, 0.5);
    expect(midpoint.x).toBeCloseTo(-Math.sin(angle) / 2, 14);
    expect(midpoint.y).toBeCloseTo(Math.cos(angle) / 2, 14);
  });

  it.each([
    { clockwise: false, reversed: false }, { clockwise: true, reversed: false },
    { clockwise: false, reversed: true }, { clockwise: true, reversed: true }
  ])('does not extend a tiny cut beyond its endpoints, clockwise=$clockwise reversed=$reversed', ({ clockwise, reversed }) => {
    const motion = tinyArcMotion(clockwise, reversed);
    expect(distanceToMotion({ x: -0.2, y: 0 }, motion)).toBeCloseTo(0.2, 14);
    expect(distanceToMotion({ x: 1.2, y: 0 }, motion)).toBeCloseTo(0.2, 14);
    expect(distanceToMotion(motion.start, motion)).toBe(0);
    expect(distanceToMotion(motion.end, motion)).toBe(0);
  });

  it('preserves a transverse offset that is smaller than an arc radius ulp', () => {
    const motion = tinyArcMotion(false, false);
    expect(distanceToMotion({ x: 0.5, y: 0.1 }, motion)).toBeCloseTo(0.1, 14);
    expect(distanceToMotion({ x: 0.5, y: -0.1 }, motion)).toBeCloseTo(0.1, 14);
  });

  it('keeps ordinary radial distances for full circles and partial arcs, including their center', () => {
    const base = tinyArcMotion(false, false);
    const motion = { ...base, start: { x: 8, y: -2 }, end: { x: 3, y: 3 }, center: { x: 3, y: -2 } };
    expect(distanceToMotion(motion.center, motion)).toBe(5);
    expect(distanceToMotion(motion.start, motion)).toBe(0);
    expect(distanceToMotion(motion.end, motion)).toBe(0);
    expect(distanceToMotion({ x: 3, y: 5 }, motion)).toBe(2);
    const full = { ...motion, end: motion.start, fullCircle: true };
    expect(distanceToMotion(full.center, full)).toBe(5);
    expect(distanceToMotion({ x: 3, y: -9 }, full)).toBe(2);
    expect(distanceToMotion({ x: 3, y: -5 }, full)).toBe(2);
  });

  it.each([false, true])('samples full circles from their exact start and preserves endpoints, clockwise=%s', (clockwise) => {
    const base = tinyArcMotion(false, false);
    const motion = { ...base, clockwise, fullCircle: true,
      start: { x: 4, y: 3 }, end: { x: 4, y: 3 }, center: { x: 4, y: -2 } };
    const points = motionPolyline(motion);
    expect(points).toHaveLength(181);
    expect(points[0]).toEqual(motion.start);
    expect(points.at(-1)).toEqual(motion.end);
    expect(points[45]).toEqual({ x: clockwise ? 9 : -1, y: -2 });
    expect(points[90]).toEqual({ x: 4, y: -7 });
    expect(points[135]).toEqual({ x: clockwise ? -1 : 9, y: -2 });
    points.forEach((point, index) => expect(point).toEqual(interpolateMotion(motion, index / 180)));
  });
});

describe('continuous simulation clearance', () => {
  it.each(['project-default', 'operation-override'] as const)('keeps continued wire threaded and detects off-arc stock travel, source=%s', (source) => {
    const document = clearanceDocument();
    document.setup!.threadingDefault = source === 'project-default'
      ? { mode: 'continuous', wireSeparation: 'already-separated' }
      : { mode: 'manual', wireSeparation: 'manual-before-positioning' };
    if (source === 'operation-override') document.plan.operations[1].threadingTransition = {
      mode: 'continuous', wireSeparation: 'already-separated', source
    };
    const result = compileSimulation(document, clearanceSettings);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const positioning = result.plan.steps.find(({ event }) => event.kind === 'position');
    expect(positioning?.wireThreaded).toBe(true);
    expect(result.plan.executionPlan.events.some(event => event.kind === 'wire-continue')).toBe(true);
    expect(result.plan.warnings).toContainEqual(expect.objectContaining({ code: 'SIMULATION_UNCUT_STOCK_OBSTRUCTION' }));
  });

  it('keeps manually pre-separated positioning unthreaded', () => {
    const document = clearanceDocument();
    document.setup!.threadingDefault = { mode: 'manual', wireSeparation: 'already-separated' };
    const result = compileSimulation(document, clearanceSettings);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.plan.steps.find(({ event }) => event.kind === 'position')?.wireThreaded).toBe(false);
    expect(result.plan.warnings).toEqual([]);
  });
});

function clearanceDocument() {
  const document = createUpidFromDxfEntities([{
    type: 'arc', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 1, y: 0 },
    center: { x: 0.5, y: 2.5e15 }, radius: 2.5e15, startAngle: -90, endAngle: -90,
    sweepRadians: 4e-16, clockwise: false
  }, { type: 'line', layer: 'CUT', start: { x: 0.5, y: 0.1 }, end: { x: 0.5, y: 1.1 } }],
  { operationOrderStrategy: 'source-order' });
  document.geometryBasis = 'wire-centre';
  document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
  return document;
}

const clearanceSettings = {
  stock: { originX: -1, originY: -1, width: 3, depth: 3, thickness: 10, bottomZ: 0 },
  wireDiameter: 0.1, cutSpeedMmPerSecond: 1, rapidSpeedMmPerSecond: 1,
  eventHoldSeconds: 0, guideClearanceMm: 20, guideRadiusMm: 0, supportFloorZ: 0
};

describe('point in polygon', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it('counts the boundary and points just outside it as inside, and nothing farther out', () => {
    for (const point of [{ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 10 }, { x: 10 + 5e-9, y: 5 }, { x: 5, y: -5e-9 }]) {
      expect(pointInPolygon(point, square)).toBe(true);
    }
    for (const point of [{ x: 10 + 2e-8, y: 5 }, { x: -2e-8, y: -2e-8 }, { x: 20, y: 5 }]) {
      expect(pointInPolygon(point, square)).toBe(false);
    }
  });
});

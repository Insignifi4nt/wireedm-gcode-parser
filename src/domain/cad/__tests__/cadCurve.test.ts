import { describe, expect, it } from 'vitest';
import type { CadCurveFeature, CadDocument, CadFeature, CadPathSegment, CadPlane } from '../cadDocument';
import { CadError } from '../cadError';
import { inspectCadCurve, resolveCadCurve } from '../cadCurve';
import { measureCadCurve } from '../cadCurveMeasurements';
import { createCadOpenCurveSegments } from '../cadPathConstruction';
import { cadConsumedBodyIds, cadFeatureDependencies, cadFeatureInputs, cadFeatureProducesBody, cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { cadPlaneBasis, cadPlanePointToWorld } from '../cadPlanes';
import { cadSketchToCam } from '../cadCam';

const line = (start: readonly [number, number], end: readonly [number, number]): CadPathSegment => ({ kind: 'line', start, end });
const arc: CadPathSegment = { kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep: -270 };
function curve(segments: readonly CadPathSegment[] = [line([0, 0], [10, 0])], plane: CadPlane = 'XY', offset: number | string = 0): CadCurveFeature {
  return { id: 'rail', name: 'Reference curve', kind: 'curve', suppressed: false, plane, offset, segments };
}
function document(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Curve part', 'cad_curve'), features, parameters });
}
function expectCode(operation: () => unknown, code: string) {
  try { operation(); throw new Error('Expected failure'); } catch (error) { expect(error).toBeInstanceOf(CadError); expect(error).toMatchObject({ code }); }
}

describe('ordered open reference geometry', () => {
  it('constructs a single exact line without adding an implicit closing edge or material role', () => {
    const segments = createCadOpenCurveSegments([0, 0], [{ kind: 'line', end: [3, 4] }]);
    expect(segments).toEqual([line([0, 0], [3, 4])]); expect(Object.isFrozen(segments)).toBe(true);
    const measured = measureCadCurve(document([curve(segments)]), 'rail');
    expect(measured).toMatchObject({ curveId: 'rail', segmentCount: 1, lengthMm: 5, boundsMm: { minX: 0, minY: 0, maxX: 3, maxY: 4 }, startMm: [0, 0], endMm: [3, 4] });
    expect(measured).not.toHaveProperty('areaMm2'); expect(measured).not.toHaveProperty('role');
  });
  it('preserves clockwise major direction, exact arc bounds and unit tangents', () => {
    const resolved = resolveCadCurve(curve([arc]), {});
    expect(resolved.entities).toHaveLength(1); expect(resolved.entities[0]).toMatchObject({ type: 'arc', clockwise: true, sweepRadians: -3 * Math.PI / 2 });
    expect(resolved.length).toBeCloseTo(15 * Math.PI / 2, 12);
    expect(resolved.bounds).toEqual({ minX: expect.closeTo(-5, 12), minY: expect.closeTo(-5, 12), maxX: expect.closeTo(5, 12), maxY: expect.closeTo(5, 12) });
    expect(resolved.start).toEqual([5, 0]); expect(resolved.end[0]).toBeCloseTo(0, 12); expect(resolved.end[1]).toBe(5);
    expect(resolved.startTangent[0]).toBeCloseTo(0, 12); expect(resolved.startTangent[1]).toBe(-1);
    expect(resolved.endTangent[0]).toBeCloseTo(1, 12); expect(resolved.endTangent[1]).toBeCloseTo(0, 12);
  });
  it.each([
    { plane: 'XY', start: [1, 2, 7], end: [4, 6, 7], tangent: [.6, .8, 0], normal: [0, 0, 1] },
    { plane: 'XZ', start: [1, -7, 2], end: [4, -7, 6], tangent: [.6, 0, .8], normal: [0, -1, 0] },
    { plane: 'YZ', start: [7, 1, 2], end: [7, 4, 6], tangent: [0, .6, .8], normal: [1, 0, 0] }
  ] satisfies { plane: CadPlane; start: number[]; end: number[]; tangent: number[]; normal: number[] }[])('resolves $plane offset and world frame using the shared right-handed basis', expected => {
    const resolved = resolveCadCurve(curve([line([1, 2], [4, 6])], expected.plane, 'height'), { height: 7 });
    expect(resolved.startWorld).toEqual(expected.start); expect(resolved.endWorld).toEqual(expected.end); expect(resolved.startTangentWorld).toEqual(expected.tangent);
    expect(resolved.worldBounds).toEqual({ min: expected.start, max: expected.end }); expect(cadPlaneBasis(expected.plane).normal).toEqual(expected.normal);
    expect(cadPlanePointToWorld(expected.plane, -7, [1, 2])).toEqual(expected.start.map((value, index) => value - 14 * expected.normal[index]));
  });
  it('accepts sharp reference joints and preserves an arithmetic-scale joint without moving it', () => {
    const feature = curve([line([0, 0], [1, 0]), line([1 + 1e-13, 0], [1, 2])]);
    const resolved = resolveCadCurve(feature, {}); expect(resolved.segments[1]).toEqual(feature.segments[1]);
    expect(inspectCadCurve(feature, {})).toMatchObject({ eligible: true });
  });
  it('rejects disconnected, closed and full-circle chains without repairing or dropping segments', () => {
    expectCode(() => resolveCadCurve(curve([line([0, 0], [10, 0]), line([10.00001, 0], [10, 5])]), {}), 'disconnected-curve');
    expectCode(() => resolveCadCurve(curve([line([0, 0], [10, 0]), line([10, 0], [0, 0])]), {}), 'closed-curve');
    expectCode(() => resolveCadCurve(curve([{ ...arc, sweep: 360 }]), {}), 'closed-curve');
    expect(() => createCadOpenCurveSegments([0, 0], [{ kind: 'line', end: [5, 0] }, { kind: 'line', end: [0, 0] }])).toThrow(CadError);
  });
  it('rejects crossings, retracing, and non-adjacent endpoint contact', () => {
    for (const segments of [
      [line([0, 0], [5, 5]), line([5, 5], [0, 5]), line([0, 5], [5, 0])],
      [line([0, 0], [5, 0]), line([5, 0], [2, 0])],
      [line([0, 0], [5, 0]), line([5, 0], [5, 5]), line([5, 5], [2, 0]), line([2, 0], [0, -5])]
    ]) expectCode(() => resolveCadCurve(curve(segments), {}), 'self-intersection');
  });
  it('retains actual points near the coordinate limit and rejects unstable numerical construction', () => {
    const origin = 999999990;
    const segments = createCadOpenCurveSegments([origin, origin], [{ kind: 'arc', end: [origin + 2, origin], through: [origin + 1, origin + 1] }]);
    expect(resolveCadCurve(curve(segments), {}).length).toBeCloseTo(Math.PI, 10);
    expect(() => createCadOpenCurveSegments([0, 0], [{ kind: 'arc', end: [2, 0], through: [1, 1e-6] }])).toThrow(CadError);
  });
  it('preserves supplied circular support and angles instead of deriving angles from rounded far-origin points', () => {
    const feature = curve([{ kind: 'arc', center: [1e8, 1e8], radius: 1, startAngle: 1.23456789, sweep: -170 }]);
    const resolved = resolveCadCurve(feature, {}); const entity = resolved.entities[0];
    if (entity.type !== 'arc') throw new Error('Expected arc');
    expect(entity.startAngle).toBe(1.23456789 * Math.PI / 180); expect(entity.sweepRadians).toBe(-170 * Math.PI / 180);
    expect(entity.center).toEqual({ x: 1e8, y: 1e8 }); expect(entity.radius).toBe(1);
    expect(Math.atan2(entity.start.y - 1e8, entity.start.x - 1e8)).not.toBe(entity.startAngle);
  });
  it('encloses actual support extrema when rounded endpoints would imply a smaller radius', () => {
    const resolved = resolveCadCurve(curve([{ kind: 'arc', center: [1, 0], radius: 1, startAngle: 3, sweep: 270 }]), {});
    expect(resolved.bounds.minX).toBeLessThanOrEqual(0); expect(Math.abs(resolved.bounds.minX)).toBeLessThan(1e-12);
    const quarter = resolveCadCurve(curve([{ kind: 'arc', center: [0, 0], radius: 1, startAngle: 90, sweep: -90 }]), {});
    expect(quarter.bounds.minX).toBe(0); expect(quarter.bounds.minY).toBe(0);
    expect(quarter.bounds.maxX).toBeGreaterThanOrEqual(1); expect(quarter.bounds.maxY).toBeGreaterThanOrEqual(1);
  });
});

describe('curve document and history boundaries', () => {
  it('evaluates parameter changes while retaining expressions and rejects invalid edits atomically', () => {
    const initial = document([curve([{ kind: 'line', start: [0, 0], end: ['length', 0] }], 'XZ', 'height')], { length: 10, height: 2 });
    const updated = applyCadEdits(initial, [{ kind: 'set-parameter', name: 'length', value: 25 }]);
    expect(measureCadCurve(updated, 'rail')).toMatchObject({ lengthMm: 25, offsetMm: 2, startWorldMm: [0, -2, 0] });
    expect(updated.features[0]).toMatchObject({ segments: [{ end: ['length', 0] }] });
    const original = JSON.stringify(updated);
    expect(() => applyCadEdits(updated, [{ kind: 'set-parameter', name: 'length', value: 0 }])).toThrow(CadError);
    expect(() => applyCadEdits(updated, [{ kind: 'remove-parameter', name: 'length' }])).toThrow(CadError); expect(JSON.stringify(updated)).toBe(original);
  });
  it('never treats a curve as a body, sketch generator or CAM contour', () => {
    const reference = curve(); const sketch: CadFeature = { kind: 'sketch', id: 'profile', name: 'Profile', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] };
    const pad: CadFeature = { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false, sketchId: 'profile', distance: 5, symmetric: false, operation: 'new', targetId: null };
    const accepted = document([reference, sketch, pad]);
    expect(cadFeatureProducesBody(reference)).toBe(false); expect(cadFeatureProducesBody(pad)).toBe(true);
    expect(cadFeatureInputs(reference)).toEqual({ datumIds: [], sketchIds: [], curveIds: [], bodyIds: [] });
    expect(cadFeatureDependencies(reference)).toEqual([]); expect(cadConsumedBodyIds(reference, accepted)).toEqual([]); expect(cadVisibleBodyIds(accepted.features, accepted)).toEqual(['pad']);
    const move: CadFeature = { kind: 'transform', id: 'move', name: 'Move', suppressed: true, sourceId: 'rail', translation: [0, 0, 0], rotation: [0, 0, 0] };
    expectCode(() => document([reference, move]), 'invalid-reference');
    expectCode(() => document([reference, { ...pad, sketchId: 'rail' }]), 'invalid-reference');
    expectCode(() => cadSketchToCam(accepted, 'rail'), 'missing-sketch');
  });
  it('preserves independent curve order/deletion and validates suppression without discarding geometry', () => {
    const original = document([curve(), { ...curve(), id: 'second', suppressed: true }]);
    const suppressed = original.features[1]; if (suppressed.kind !== 'curve') throw new Error('Expected curve');
    expect(inspectCadCurve(suppressed, {})).toMatchObject({ eligible: false, code: 'suppressed-curve' });
    expect(measureCadCurve(original, 'second')).toMatchObject({ suppressed: true, lengthMm: 10 });
    const reordered = applyCadEdits(original, [{ kind: 'move-feature', featureId: 'second', beforeId: 'rail' }]);
    expect(reordered.features.map(feature => feature.id)).toEqual(['second', 'rail']);
    const removed = applyCadEdits(reordered, [{ kind: 'delete-feature', featureId: 'rail', cascade: false }]); expect(removed.features.map(feature => feature.id)).toEqual(['second']);
    expect(() => document([{ ...curve([]), suppressed: true }])).toThrow(CadError);
  });
  it('checks own-data before reading getters and rejects legacy-role fields, sparse arrays and numeric overflow', () => {
    let reads = 0; const input = { ...curve(), get segments() { reads++; return [line([0, 0], [1, 0])]; } };
    expect(() => resolveCadCurve(input, {})).toThrow(CadError); expect(reads).toBe(0);
    for (const feature of [{ ...curve(), role: 'outer' }, curve(Array(1)), curve([line([0, 0], [Infinity, 0])]), curve([line([0, 0], [1e9 + 1, 0])]),
      curve([{ kind: 'line', start: [0, 0], end: ['missing', 0] }]), curve([{ ...arc, radius: -1 }])]) expect(() => document([feature])).toThrow(CadError);
  });
  it('accepts exact curves beyond former per-curve and aggregate edge ceilings without changing the original', () => {
    const segments = Array.from({ length: 2048 }, (_, index) => line([index, 0], [index + 1, 0]));
    const original = document(Array.from({ length: 4 }, (_, index) => ({ ...curve(segments), id: `rail_${index}` })));
    expect(original.features).toHaveLength(4);
    const longer = document([curve([...segments, line([2048, 0], [2049, 0])])]);
    expect(longer.features[0]).toMatchObject({ segments: [...segments, line([2048, 0], [2049, 0])] });
    const expanded = applyCadEdits(original, [{ kind: 'add-feature', feature: curve() }]);
    expect(expanded.features).toHaveLength(5); expect(expanded.features.slice(0, 4)).toEqual(original.features);
    expect(original.features).toHaveLength(4);
  });
  it('preserves and freezes exact original DXF sources above the former aggregate document limit', () => {
    const source = { format: 'dxf' as const, fileName: 'rail.dxf', text: '\uFEFF0\r\nEOF\r\n', units: 'mm' as const };
    const accepted = document([{ ...curve(), source }]); source.text = 'Changed';
    expect(accepted.features[0]).toMatchObject({ source: { text: '\uFEFF0\r\nEOF\r\n' } }); expect(Object.isFrozen(accepted.features[0])).toBe(true);
    const large = { ...source, text: '\uFEFF0\r\nEOF\r\n' + ' '.repeat(1_500_000) };
    const largeDocument = document(Array.from({ length: 3 }, (_, index) => ({ ...curve(), id: `large_${index}`, source: large })));
    expect(largeDocument.features).toHaveLength(3);
    for (const feature of largeDocument.features) {
      expect(feature).toMatchObject({ source: large, segments: curve().segments });
      expect(Object.isFrozen(feature)).toBe(true);
      if (feature.kind !== 'curve') throw new Error('Missing accepted reference curve.');
      expect(Object.isFrozen(feature.source)).toBe(true);
    }
  });
});

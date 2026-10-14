import { describe, expect, it } from 'vitest';
import type { CadProfile, CadSketchFeature } from '../cadDocument';
import { applyCadEdits } from '../cadOperations';
import { createCadDocument, createCadSketchProfile, parseCadDocument } from '../cadSchema';
import { resolveCadProfile } from '../cadSketchGeometry';
import { inspectCadSketchDimensions, unlinkCadSketchDimension } from '../cadSketchConstraints';
import { CadError } from '../cadError';
import { measureCadSketch } from '../cadMeasurements';

const rectangle = { kind: 'rectangle', x: 2, y: 3, width: 20, height: 10, cornerRadius: 0 } satisfies CadProfile;
function documentWith(geometry: CadProfile = rectangle) {
  return parseCadDocument({ ...createCadDocument('Dimensions', 'dimensions'), parameters: { size: 12 }, features: [{
    id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'profile', name: 'Profile', construction: false, geometry }]
  }] });
}
function sketch(document: ReturnType<typeof documentWith>): CadSketchFeature {
  const feature = document.features[0];
  if (feature.kind !== 'sketch') throw new Error('Expected sketch fixture.');
  return feature;
}
function expectCode(action: () => unknown, code: string) {
  try { action(); } catch (error) {
    if (!(error instanceof CadError)) throw error;
    expect(error.code).toBe(code); return;
  }
  throw new Error(`Expected ${code} rejection.`);
}

describe('explicit sketch dimensions', () => {
  it('constrains a drawn rectangle width without changing its exact geometry, then drives only that width', () => {
    const initial = documentWith();
    const fixed = applyCadEdits(initial, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    expect(sketch(fixed).profiles[0].geometry).toEqual(rectangle);
    expect(sketch(fixed).profiles[0].constraints).toEqual([{ id: 'width_dimension', kind: 'dimension', quantity: 'width' }]);
    const resized = applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 35 }]);
    expect(resolveCadProfile(sketch(resized).profiles[0].geometry, resized.parameters)).toEqual({ ...rectangle, width: 35 });
    expect(sketch(initial).profiles[0]).not.toHaveProperty('constraints');
  });

  it('moves a width-constrained rectangle without changing its dimensions or constraint', () => {
    const fixed = applyCadEdits(documentWith(), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    const moved = applyCadEdits(fixed, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [5, -8] }]);
    expect(resolveCadProfile(sketch(moved).profiles[0].geometry, moved.parameters)).toEqual({ ...rectangle, x: 7, y: -5 });
    expect(sketch(moved).profiles[0].constraints).toEqual(sketch(fixed).profiles[0].constraints);
    expect(sketch(fixed).profiles[0].geometry).toEqual(rectangle);
  });

  it('accepts explicit dimension intent in the shared contour constructor', () => {
    const contour = createCadSketchProfile({ id: 'profile', geometry: rectangle, constraints: [{ id: 'width_dimension', kind: 'dimension', quantity: 'width' }] });
    expect(contour.constraints).toEqual([{ id: 'width_dimension', kind: 'dimension', quantity: 'width' }]);
    expect(contour.geometry).toEqual(rectangle);
  });

  it('shows no dimensions on numeric free geometry and preserves legacy serialized data exactly', () => {
    const initial = documentWith({ ...rectangle, width: '20' });
    const original = JSON.stringify(initial);
    expect(inspectCadSketchDimensions(sketch(initial).profiles[0], initial.parameters)).toEqual([]);
    expect(JSON.stringify(parseCadDocument(JSON.parse(original)))).toBe(original);
  });

  it('keeps existing parameter expressions driving sizes without attaching dimension records', () => {
    const initial = documentWith({ ...rectangle, width: 'size * 2' });
    const contour = sketch(initial).profiles[0];
    expect(inspectCadSketchDimensions(contour, initial.parameters)).toEqual([{ id: null, quantity: 'width', field: 'width', expression: 'size * 2', value: 24, scale: 1, source: 'expression', units: 'mm' }]);
    const fixed = applyCadEdits(initial, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    expect(sketch(fixed).profiles[0].geometry).toEqual(contour.geometry);
    const changed = applyCadEdits(fixed, [{ kind: 'set-parameter', name: 'size', value: 15 }]);
    expect(resolveCadProfile(sketch(changed).profiles[0].geometry, changed.parameters)).toEqual({ ...rectangle, width: 30 });
    expect(inspectCadSketchDimensions(sketch(changed).profiles[0], changed.parameters)[0]).toMatchObject({ id: 'width_dimension', value: 30, source: 'constraint' });
  });

  it('edits an explicitly dimensioned named width through its shared parameter while preserving the binding', () => {
    const fixed = applyCadEdits(documentWith({ ...rectangle, width: 'size' }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    const changed = applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 30 }]);
    expect(changed.parameters.size).toBe(30);
    expect(sketch(changed).profiles[0].geometry).toEqual({ ...rectangle, width: 'size' });
    expect(resolveCadProfile(sketch(changed).profiles[0].geometry, changed.parameters)).toEqual({ ...rectangle, width: 30 });
    expect(fixed.parameters.size).toBe(12);
  });

  it('rejects an edit that would detach a compound driving expression and preserves the whole batch', () => {
    const fixed = applyCadEdits(documentWith({ ...rectangle, width: 'size * 2' }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    const original = JSON.stringify(fixed);
    expectCode(() => applyCadEdits(fixed, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 30 }]), 'driven-sketch-dimension');
    expect(JSON.stringify(fixed)).toBe(original);
  });

  it('converts a named diameter edit to its radius parameter while retaining the exact stored binding', () => {
    const fixed = applyCadEdits(documentWith({ kind: 'circle', x: 0, y: 0, radius: ' size ' }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'diameter_dimension', kind: 'dimension', quantity: 'diameter' } }]);
    const changed = applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'diameter_dimension', value: 30 }]);
    expect(changed.parameters.size).toBe(15);
    expect(sketch(changed).profiles[0].geometry).toEqual({ kind: 'circle', x: 0, y: 0, radius: ' size ' });
    expect(inspectCadSketchDimensions(sketch(changed).profiles[0], changed.parameters)[0]).toMatchObject({ quantity: 'diameter', value: 30, expression: ' size ' });
  });

  it('updates every quantity sharing a named dimension parameter instead of detaching one scalar', () => {
    const fixed = applyCadEdits(documentWith({ ...rectangle, width: 'size', height: 'size' }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    const changed = applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 30 }]);
    expect(sketch(changed).profiles[0].geometry).toEqual({ ...rectangle, width: 'size', height: 'size' });
    expect(measureCadSketch(changed, 'sketch')).toMatchObject({ materialAreaMm2: 900, boundaryLengthMm: 120 });
  });

  it('allows an explicitly chosen expression on a literal dimension to become its new driver', () => {
    const fixed = applyCadEdits(documentWith(), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    const changed = applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 'size * 2' }]);
    expect(sketch(changed).profiles[0].geometry).toEqual({ ...rectangle, width: 'size * 2' });
    const grown = applyCadEdits(changed, [{ kind: 'set-parameter', name: 'size', value: 15 }]);
    expect(resolveCadProfile(sketch(grown).profiles[0].geometry, grown.parameters)).toEqual({ ...rectangle, width: 30 });
  });

  it('rejects a named dimension edit that would invalidate a correlated contour without changing its parameter', () => {
    const fixed = applyCadEdits(documentWith({ ...rectangle, width: 20, height: 'size', cornerRadius: 4 }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'height_dimension', kind: 'dimension', quantity: 'height' } }]);
    const original = JSON.stringify(fixed);
    expectCode(() => applyCadEdits(fixed, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'height_dimension', value: 6 }]), 'invalid-profile');
    expect(JSON.stringify(fixed)).toBe(original); expect(fixed.parameters.size).toBe(12);
  });

  it('drives a circle diameter through its sole radius scalar and retains parameter relationships', () => {
    const initial = documentWith({ kind: 'circle', x: 0, y: 0, radius: 5 });
    const fixed = applyCadEdits(initial, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'diameter_dimension', kind: 'dimension', quantity: 'diameter' } }]);
    const changed = applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'diameter_dimension', value: 'size * 3' }]);
    expect(resolveCadProfile(sketch(changed).profiles[0].geometry, changed.parameters)).toEqual({ kind: 'circle', x: 0, y: 0, radius: 18 });
    expect(inspectCadSketchDimensions(sketch(changed).profiles[0], changed.parameters)[0]).toMatchObject({ quantity: 'diameter', value: 36, scale: 2 });
    const renamed = applyCadEdits(changed, [{ kind: 'rename-parameter', name: 'size', newName: 'pitch' }, { kind: 'set-parameter', name: 'pitch', value: 20 }]);
    expect(resolveCadProfile(sketch(renamed).profiles[0].geometry, renamed.parameters)).toEqual({ kind: 'circle', x: 0, y: 0, radius: 30 });
    expect(sketch(renamed).profiles[0].constraints).toEqual(sketch(changed).profiles[0].constraints);
  });

  it('rejects adding radius and diameter as competing circle dimensions without changing the part', () => {
    const initial = documentWith({ kind: 'circle', x: 0, y: 0, radius: 5 });
    const fixed = applyCadEdits(initial, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'diameter_dimension', kind: 'dimension', quantity: 'diameter' } }]);
    const original = JSON.stringify(fixed);
    expectCode(() => applyCadEdits(fixed, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'radius_dimension', kind: 'dimension', quantity: 'radius' } }]), 'overconstrained-sketch-dimension');
    expect(JSON.stringify(fixed)).toBe(original);
  });

  it('removes a dimension without replacing its driving expression or current geometry', () => {
    const fixed = applyCadEdits(documentWith({ ...rectangle, width: 'size / 3' }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]);
    const removed = applyCadEdits(fixed, [{ kind: 'remove-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension' }]);
    expect(sketch(removed).profiles[0].geometry).toEqual(sketch(fixed).profiles[0].geometry);
    expect(inspectCadSketchDimensions(sketch(removed).profiles[0], removed.parameters)[0]).toMatchObject({ id: null, source: 'expression', value: 4 });
  });

  it('explicitly unlinks a circle diameter while preserving its size and freeing future parameter changes', () => {
    const fixed = applyCadEdits(documentWith({ kind: 'circle', x: 0, y: 0, radius: 'size / 3' }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'diameter_dimension', kind: 'dimension', quantity: 'diameter' } }]);
    const feature = sketch(fixed), contour = unlinkCadSketchDimension({ profile: feature.profiles[0], quantity: 'diameter', parameters: fixed.parameters });
    const unlinked = applyCadEdits(fixed, [{ kind: 'update-feature', feature: { ...feature, profiles: [contour] } }, { kind: 'set-parameter', name: 'size', value: 60 }]);
    expect(resolveCadProfile(sketch(unlinked).profiles[0].geometry, unlinked.parameters)).toEqual({ kind: 'circle', x: 0, y: 0, radius: 4 });
    expect(inspectCadSketchDimensions(sketch(unlinked).profiles[0], unlinked.parameters)).toEqual([]);
  });

  it('rejects a width dimension on a circle at the document import boundary', () => {
    const initial = documentWith({ kind: 'circle', x: 0, y: 0, radius: 5 }), feature = sketch(initial);
    expectCode(() => parseCadDocument({ ...initial, features: [{ ...feature, profiles: [{ ...feature.profiles[0], constraints: [{ id: 'width_dimension', kind: 'dimension', quantity: 'width' }] }] }] }), 'unsupported-sketch-dimension');
  });

  it('rejects dimensions on imported analytic paths and does not claim a general sketch solver', () => {
    const initial = documentWith({ kind: 'path', segments: [
      { kind: 'line', start: [0, 0], end: [10, 0] }, { kind: 'line', start: [10, 0], end: [0, 10] }, { kind: 'line', start: [0, 10], end: [0, 0] }
    ] });
    expectCode(() => applyCadEdits(initial, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'length_dimension', kind: 'dimension', quantity: 'length' } }]), 'unsupported-sketch-dimension');
  });

  it('keeps slot length at least its width and accepts correlated changes in one atomic batch', () => {
    const initial = documentWith({ kind: 'slot', x: 0, y: 0, length: 20, width: 6, angle: 0 });
    const fixed = applyCadEdits(initial, [
      { kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'length_dimension', kind: 'dimension', quantity: 'length' } },
      { kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } },
      { kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'angle_dimension', kind: 'dimension', quantity: 'angle' } }
    ]);
    expectCode(() => applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 25 }]), 'invalid-profile');
    const changed = applyCadEdits(fixed, [
      { kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value: 25 },
      { kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'length_dimension', value: 40 },
      { kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'angle_dimension', value: -90 }
    ]);
    expect(resolveCadProfile(sketch(changed).profiles[0].geometry, changed.parameters)).toEqual({ kind: 'slot', x: 0, y: 0, length: 40, width: 25, angle: -90 });
    expect(inspectCadSketchDimensions(sketch(changed).profiles[0], changed.parameters).find(dimension => dimension.quantity === 'angle')).toMatchObject({ value: -90, units: 'deg' });
  });

  it('retains a rectangle rounded-corner relationship when rejecting a dimension that would invalidate it', () => {
    const fixed = applyCadEdits(documentWith({ ...rectangle, cornerRadius: 4 }), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'height_dimension', kind: 'dimension', quantity: 'height' } }]);
    expectCode(() => applyCadEdits(fixed, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'height_dimension', value: 6 }]), 'invalid-profile');
    expect(resolveCadProfile(sketch(fixed).profiles[0].geometry, fixed.parameters)).toEqual({ ...rectangle, cornerRadius: 4 });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e10, 'missing_parameter'])('rejects invalid driving width %s and preserves the input batch', value => {
    const fixed = applyCadEdits(documentWith(), [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]), original = JSON.stringify(fixed);
    expect(() => applyCadEdits(fixed, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'width_dimension', value }])).toThrow(CadError);
    expect(JSON.stringify(fixed)).toBe(original);
  });

  it('rejects stale contour and dimension targets instead of resizing another selection', () => {
    const initial = documentWith();
    expectCode(() => applyCadEdits(initial, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'missing', constraint: { id: 'width_dimension', kind: 'dimension', quantity: 'width' } }]), 'missing-profile');
    expectCode(() => applyCadEdits(initial, [{ kind: 'set-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'missing', value: 20 }]), 'missing-sketch-dimension');
    expectCode(() => applyCadEdits(initial, [{ kind: 'remove-sketch-dimension', sketchId: 'sketch', profileId: 'profile', dimensionId: 'missing' }]), 'missing-sketch-dimension');
  });

  it('locks only a formula-driven position axis and allows motion along its free axis', () => {
    const initial = documentWith({ ...rectangle, x: 'size', y: '3' });
    expectCode(() => applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [5, 0] }]), 'driven-sketch-position');
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [0, -8] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ ...rectangle, x: 'size', y: -5 });
    const unchanged = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [0, 0] }]);
    expect(sketch(unchanged).profiles[0].geometry).toEqual(sketch(initial).profiles[0].geometry);
  });

  it('rejects a mixed free/driven translation atomically without moving the first selected contour', () => {
    const initial = documentWith(), feature = sketch(initial);
    const multiple = parseCadDocument({ ...initial, features: [{ ...feature, profiles: [...feature.profiles, { id: 'second', name: 'Second', construction: false, geometry: { kind: 'circle', x: 'size + 100', y: 0, radius: 5 } }] }] });
    const original = JSON.stringify(multiple);
    expectCode(() => applyCadEdits(multiple, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile', 'second'], translation: [2, 3] }]), 'driven-sketch-position');
    expect(JSON.stringify(multiple)).toBe(original);
  });

  it('rejects duplicate dimension identities across contours in one sketch', () => {
    const initial = documentWith(), feature = sketch(initial);
    const multiple = parseCadDocument({ ...initial, features: [{ ...feature, profiles: [...feature.profiles, { id: 'second', name: 'Second', construction: false, geometry: { kind: 'circle', x: 100, y: 0, radius: 5 } }] }] });
    expectCode(() => applyCadEdits(multiple, [
      { kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'shared', kind: 'dimension', quantity: 'width' } },
      { kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'second', constraint: { id: 'shared', kind: 'dimension', quantity: 'diameter' } }
    ]), 'duplicate-sketch-constraint');
  });
});

describe('translation of existing polygon and analytic path contours', () => {
  it('moves every polygon vertex by one displacement while preserving its area and side lengths', () => {
    const initial = documentWith({ kind: 'polygon', points: [[0, 0], [10, 0], [0, 6]] });
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [25, -3] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ kind: 'polygon', points: [[25, -3], [35, -3], [25, 3]] });
    expect(measureCadSketch(moved, 'sketch')).toMatchObject({ materialAreaMm2: 30, boundsMm: { minX: 25, minY: -3, maxX: 35, maxY: 3 } });
    expect(measureCadSketch(moved, 'sketch').boundaryLengthMm).toBeCloseTo(27.6619037896906, 12);
    expect(sketch(initial).profiles[0].geometry).toEqual({ kind: 'polygon', points: [[0, 0], [10, 0], [0, 6]] });
  });

  it('translates line endpoints and arc centers without changing analytic arc definitions or closure', () => {
    const initial = documentWith({ kind: 'path', segments: [
      { kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep: 180 },
      { kind: 'line', start: [-5, 0], end: [5, 0] }
    ] });
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [10, -7] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ kind: 'path', segments: [
      { kind: 'arc', center: [10, -7], radius: 5, startAngle: 0, sweep: 180 },
      { kind: 'line', start: [5, -7], end: [15, -7] }
    ] });
    expect(measureCadSketch(moved, 'sketch').materialAreaMm2).toBeCloseTo(39.269908169872416, 12);
    expect(measureCadSketch(moved, 'sketch').boundaryLengthMm).toBeCloseTo(25.707963267948966, 12);
    expect(measureCadSketch(moved, 'sketch').boundsMm).toMatchObject({ minX: 5, minY: -7, maxX: 15, maxY: expect.closeTo(-2, 12) });
  });

  it('retains full-circle direction, radius and angle expressions when moving its support center', () => {
    const initial = documentWith({ kind: 'path', segments: [{ kind: 'arc', center: [3, 4], radius: 'size', startAngle: 'size * 2', sweep: -360 }] });
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [5, -9] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ kind: 'path', segments: [{ kind: 'arc', center: [8, -5], radius: 'size', startAngle: 'size * 2', sweep: -360 }] });
    expect(measureCadSketch(moved, 'sketch').materialAreaMm2).toBeCloseTo(452.3893421169302, 12);
    expect(measureCadSketch(moved, 'sketch').boundaryLengthMm).toBeCloseTo(75.39822368615503, 12);
    const grown = applyCadEdits(moved, [{ kind: 'set-parameter', name: 'size', value: 5 }]);
    expect(resolveCadProfile(sketch(grown).profiles[0].geometry, grown.parameters)).toEqual({ kind: 'path', segments: [{ kind: 'arc', center: [8, -5], radius: 5, startAngle: 10, sweep: -360 }] });
  });

  it('locks driven polygon vertex coordinates while retaining free-axis motion and future parameter changes', () => {
    const initial = documentWith({ kind: 'polygon', points: [['size', 0], ['size + 10', 0], ['size', 6]] });
    expectCode(() => applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [2, 0] }]), 'driven-sketch-position');
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [0, 3] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ kind: 'polygon', points: [['size', 3], ['size + 10', 3], ['size', 9]] });
    const changed = applyCadEdits(moved, [{ kind: 'set-parameter', name: 'size', value: 20 }]);
    expect(resolveCadProfile(sketch(changed).profiles[0].geometry, changed.parameters)).toEqual({ kind: 'polygon', points: [[20, 3], [30, 3], [20, 9]] });
  });

  it('locks a path line endpoint expression without losing closure when the free axis moves', () => {
    const initial = documentWith({ kind: 'path', segments: [
      { kind: 'line', start: [0, 'size'], end: [10, 'size'] },
      { kind: 'line', start: [10, 'size'], end: [10, 'size + 6'] },
      { kind: 'line', start: [10, 'size + 6'], end: [0, 'size + 6'] },
      { kind: 'line', start: [0, 'size + 6'], end: [0, 'size'] }
    ] });
    const original = JSON.stringify(initial);
    expectCode(() => applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [0, 2] }]), 'driven-sketch-position');
    expect(JSON.stringify(initial)).toBe(original);
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [5, 0] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ kind: 'path', segments: [
      { kind: 'line', start: [5, 'size'], end: [15, 'size'] },
      { kind: 'line', start: [15, 'size'], end: [15, 'size + 6'] },
      { kind: 'line', start: [15, 'size + 6'], end: [5, 'size + 6'] },
      { kind: 'line', start: [5, 'size + 6'], end: [5, 'size'] }
    ] });
    expect(measureCadSketch(moved, 'sketch')).toMatchObject({ materialAreaMm2: 60, boundaryLengthMm: 32 });
  });

  it('locks a driven arc center axis while allowing its other axis to move', () => {
    const initial = documentWith({ kind: 'path', segments: [{ kind: 'arc', center: ['size', 4], radius: 5, startAngle: 37, sweep: 360 }] });
    expectCode(() => applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [2, 0] }]), 'driven-sketch-position');
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [0, -3] }]);
    expect(sketch(moved).profiles[0].geometry).toEqual({ kind: 'path', segments: [{ kind: 'arc', center: ['size', 1], radius: 5, startAngle: 37, sweep: 360 }] });
    expect(measureCadSketch(moved, 'sketch').materialAreaMm2).toBeCloseTo(78.53981633974483, 12);
  });

  it('rejects a mixed polygon/path translation atomically when a later coordinate is driven', () => {
    const initial = documentWith({ kind: 'polygon', points: [[0, 0], [10, 0], [0, 6]] }), feature = sketch(initial);
    const multiple = parseCadDocument({ ...initial, features: [{ ...feature, profiles: [...feature.profiles, {
      id: 'second', name: 'Arc', construction: false,
      geometry: { kind: 'path', segments: [{ kind: 'arc', center: ['size + 100', 0], radius: 5, startAngle: 0, sweep: 360 }] }
    }] }] });
    const original = JSON.stringify(multiple);
    expectCode(() => applyCadEdits(multiple, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile', 'second'], translation: [2, 3] }]), 'driven-sketch-position');
    expect(JSON.stringify(multiple)).toBe(original);
  });

  it('preserves serialized numeric strings and formula bindings on a zero displacement', () => {
    const initial = documentWith({ kind: 'polygon', points: [['size', '0'], ['size + 10', 0], ['size', '6']] });
    const moved = applyCadEdits(initial, [{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: ['profile'], translation: [0, 0] }]);
    expect(JSON.stringify(moved)).toBe(JSON.stringify(initial));
  });
});

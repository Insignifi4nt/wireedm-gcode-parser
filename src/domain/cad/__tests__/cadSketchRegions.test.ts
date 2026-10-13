import { describe, expect, it } from 'vitest';
import type { CadDocument, CadProfile, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { CadError } from '../cadError';
import { applyCadEdits } from '../cadOperations';
import { createCadDocument, createCadSketchProfile, parseCadDocument } from '../cadSchema';
import { cadSketchToEntities, resolveCadSketchRegions } from '../cadSketchGeometry';
import { measureCadSketch } from '../cadMeasurements';
import { cadSketchToCam } from '../cadCam';

function contour(id: string, geometry: CadProfile, construction = false): CadSketchProfile {
  return createCadSketchProfile({ id, name: id, geometry, construction });
}
const circle = (id: string, radius: number, x = 0, y = 0) => contour(id, { kind: 'circle', x, y, radius });
function sketch(profiles: readonly CadSketchProfile[]): CadSketchFeature {
  return { kind: 'sketch', id: 'sketch', name: 'Regions', suppressed: false, plane: 'XY', offset: 0, profiles };
}
function document(profiles: readonly CadSketchProfile[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Regions', 'cad_regions'), parameters, features: [sketch(profiles)] });
}
function summarize(feature: CadSketchFeature, parameters: Readonly<Record<string, number>> = {}) {
  return resolveCadSketchRegions(feature, parameters).map(region => ({ id: region.boundary.profile.id, depth: region.boundary.depth,
    parentId: region.boundary.parentId, voids: region.voids.map(item => ({ id: item.profile.id, depth: item.depth, parentId: item.parentId })) }));
}

describe('automatic planar material regions', () => {
  it('creates detached contour defaults without a manual region role', () => {
    const geometry = { kind: 'circle', x: 0, y: 0, radius: 4 } satisfies CadProfile;
    const created = createCadSketchProfile({ geometry });
    expect(created).toMatchObject({ name: 'Contour', construction: false }); expect(created.id).toMatch(/^contour_/);
    expect('role' in created).toBe(false); expect(Object.isFrozen(created.geometry)).toBe(true);
    geometry.radius = 8; expect(created.geometry).toMatchObject({ radius: 4 });
    expect(() => createCadSketchProfile({ geometry: { kind: 'circle', x: Infinity, y: 0, radius: 4 } })).toThrow(CadError);
  });
  it('derives nested voids, islands and disconnected regions independently of contour order', () => {
    const profiles = [circle('level3', 1), circle('level1', 6), circle('separate', 2, 30), circle('level2', 3), circle('level0', 10)];
    expect(summarize(sketch(profiles))).toEqual([
      { id: 'separate', depth: 0, parentId: null, voids: [] },
      { id: 'level2', depth: 2, parentId: 'level1', voids: [{ id: 'level3', depth: 3, parentId: 'level2' }] },
      { id: 'level0', depth: 0, parentId: null, voids: [{ id: 'level1', depth: 1, parentId: 'level0' }] }
    ]);
    const part = document(profiles);
    expect(measureCadSketch(part, 'sketch').materialAreaMm2).toBeCloseTo(76 * Math.PI, 10);
    expect(cadSketchToCam(part, 'sketch').contours).toHaveLength(5);
    expect(part.features[0]).toMatchObject({ profiles });
    expect(JSON.stringify(part)).not.toContain('"role"');
  });
  it('infers mixed rounded rectangle, rotated slot and circle regions exactly', () => {
    const profiles = [contour('base', { kind: 'rectangle', x: 0, y: 0, width: 30, height: 20, cornerRadius: 3 }),
      contour('slot', { kind: 'slot', x: 15, y: 10, length: 10, width: 4, angle: 30 }), circle('island', .5, 15, 10)];
    expect(summarize(sketch(profiles))).toEqual([
      { id: 'base', depth: 0, parentId: null, voids: [{ id: 'slot', depth: 1, parentId: 'base' }] },
      { id: 'island', depth: 2, parentId: 'slot', voids: [] }
    ]);
    const measured = measureCadSketch(document(profiles), 'sketch');
    expect(measured.materialAreaMm2).toBeCloseTo(600 - (4 - Math.PI) * 9 - (24 + 4 * Math.PI) + .25 * Math.PI, 9);
    expect(cadSketchToEntities(sketch(profiles), {}).filter(entity => entity.type === 'arc')).toHaveLength(6);
  });
  it('handles maximum-radius rounded rectangles and circular slots as analytic regions', () => {
    const feature = sketch([
      contour('capsule', { kind: 'rectangle', x: -40, y: -20, width: 80, height: 40, cornerRadius: 20 }),
      contour('circular_slot', { kind: 'slot', x: 0, y: 0, length: 10, width: 10, angle: 123 })
    ]);
    expect(summarize(feature)).toEqual([{ id: 'capsule', depth: 0, parentId: null,
      voids: [{ id: 'circular_slot', depth: 1, parentId: 'capsule' }] }]);
    expect(cadSketchToEntities(feature, {}).filter(entity => entity.type === 'circle')).toHaveLength(1);
  });
  it.each([false, true])('uses actual concave containment rather than centroid/bounding-box guesses, reversed=%s', reversed => {
    const points: readonly (readonly [number, number])[] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]];
    const profiles = [contour('concave', { kind: 'polygon', points: reversed ? [...points].reverse() : points }),
      circle('void', .5, 1, 5), circle('notch_region', 1, 6, 5)];
    expect(summarize(sketch(profiles))).toEqual([
      { id: 'concave', depth: 0, parentId: null, voids: [{ id: 'void', depth: 1, parentId: 'concave' }] },
      { id: 'notch_region', depth: 0, parentId: null, voids: [] }
    ]);
    expect(measureCadSketch(document(profiles), 'sketch').materialAreaMm2).toBeCloseTo(52 + .75 * Math.PI, 10);
  });
  it('excludes construction contours from nesting and material while still validating their geometry', () => {
    const profiles = [circle('base', 10), contour('construction', { kind: 'circle', x: 0, y: 0, radius: 5 }, true), circle('void', 2)];
    expect(summarize(sketch(profiles))).toEqual([{ id: 'base', depth: 0, parentId: null,
      voids: [{ id: 'void', depth: 1, parentId: 'base' }] }]);
    expect(measureCadSketch(document(profiles), 'sketch').materialAreaMm2).toBeCloseTo(96 * Math.PI, 10);
    expect(resolveCadSketchRegions(sketch([profiles[1]]), {})).toEqual([]);
    expect(resolveCadSketchRegions(sketch([]), {})).toEqual([]);
    expect(() => document([contour('bad', { kind: 'circle', x: 0, y: 0, radius: -1 }, true)])).toThrow(CadError);
  });
  it('propagates geometry expressions into automatic region changes without storing inferred roles', () => {
    const part = document([circle('base', 10), contour('moving', { kind: 'circle', x: 'location', y: 0, radius: 2 })], { location: 0 });
    expect(measureCadSketch(part, 'sketch').materialAreaMm2).toBeCloseTo(96 * Math.PI, 10);
    const moved = applyCadEdits(part, [{ kind: 'set-parameter', name: 'location', value: 30 }]);
    expect(measureCadSketch(moved, 'sketch').materialAreaMm2).toBeCloseTo(104 * Math.PI, 10);
    expect(JSON.stringify(moved)).not.toContain('"role"');
    expect(part.parameters.location).toBe(0);
  });
  it('keeps far-origin polygon areas and strict nesting stable', () => {
    const origin = 999999900;
    const profiles = [contour('polygon', { kind: 'polygon', points: [[origin, origin], [origin, origin + 80], [origin + 80, origin + 80], [origin + 80, origin]] }),
      circle('void', 10, origin + 40, origin + 40)];
    expect(summarize(sketch(profiles))[0].voids).toHaveLength(1);
    expect(measureCadSketch(document(profiles), 'sketch').materialAreaMm2).toBeCloseTo(6400 - 100 * Math.PI, 8);
  });
  it('keeps valid micrometre-scale concentric contours nested', () => {
    expect(summarize(sketch([circle('base', 4e-6), circle('void', 1e-6)]))[0].voids).toEqual([{ id: 'void', depth: 1, parentId: 'base' }]);
  });
});

describe('exact touching, overlapping and legacy contour boundaries', () => {
  it.each([
    { name: 'external circle tangent', profiles: [circle('a', 10), circle('b', 10, 20)] },
    { name: 'internal circle tangent', profiles: [circle('a', 10), circle('b', 3, 7)] },
    { name: 'circle/line tangent', profiles: [contour('a', { kind: 'rectangle', x: 0, y: 0, width: 20, height: 20, cornerRadius: 0 }), circle('b', 5, 5, 10)] },
    { name: 'shared rounded-rectangle edge', profiles: [contour('a', { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 2 }), contour('b', { kind: 'rectangle', x: 10, y: 0, width: 10, height: 10, cornerRadius: 2 })] },
    { name: 'polygon vertex contact', profiles: [contour('a', { kind: 'polygon', points: [[0, 0], [2, 0], [2, 2], [0, 2]] }), contour('b', { kind: 'polygon', points: [[2, 2], [4, 2], [4, 4], [2, 4]] })] },
    { name: 'overlapping circles', profiles: [circle('a', 5), circle('b', 5, 3)] },
    { name: 'duplicate boundary', profiles: [circle('a', 5), circle('b', 5)] },
    { name: 'near contact within native precision', profiles: [circle('a', 5), circle('b', 5, 10 + 5e-8)] }
  ])('rejects $name before assigning automatic regions', ({ profiles }) => {
    expect(() => resolveCadSketchRegions(sketch(profiles), {})).toThrow('overlap or touch');
  });
  it('retains safely separated boundaries and rejects a self-intersecting polygon atomically', () => {
    expect(summarize(sketch([circle('a', 5), circle('b', 5, 10 + 1e-6)]))).toHaveLength(2);
    const part = document([circle('original', 3)]);
    expect(() => applyCadEdits(part, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'update-feature', feature: sketch([
      contour('crossing', { kind: 'polygon', points: [[0, 0], [4, 4], [0, 4], [4, 0], [5, -1]] })
    ]) }])).toThrow(CadError);
    expect(part.name).toBe('Regions');
  });
  it('preserves accepted legacy fields and original contour order without silently repairing constraints', () => {
    const legacy = [{ ...circle('void', 3), role: 'hole' as const }, { ...circle('base', 10), role: 'outer' as const }, circle('island', 1)];
    const input = { ...createCadDocument('Legacy', 'cad_legacy'), features: [sketch(legacy)] };
    const part = parseCadDocument(input);
    expect(part).toEqual(input); expect(part.features[0]).toMatchObject({ profiles: legacy });
    expect(cadSketchToEntities(sketch(legacy), {}).map(entity => entity.layer)).toEqual(['CAD_HOLE', 'CAD_OUTER', 'CAD_OUTER']);
    expect(() => document([{ ...circle('base', 10), role: 'outer' }, { ...circle('invalid_saved_constraint', 3), role: 'outer' }])).toThrow('Legacy profile');
    const explicitEdit = applyCadEdits(part, [{ kind: 'update-feature', feature: sketch(legacy.map(profile => contour(profile.id, profile.geometry))) }]);
    expect(JSON.stringify(explicitEdit)).not.toContain('"role"');
    expect(part).toEqual(input);
  });
});

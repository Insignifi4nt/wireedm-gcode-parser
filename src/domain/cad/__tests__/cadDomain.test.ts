import { describe, expect, it } from 'vitest';
import type { CadDocument, CadFeature, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { evaluateCadAngle, evaluateCadScalar } from '../cadExpression';
import { CadError } from '../cadError';
import { applyCadEdits } from '../cadOperations';
import { cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';
import { cadProfileToEntities, cadSketchToEntities, resolveCadProfile } from '../cadSketchGeometry';
import { cadSketchToCam, cadSketchToDxf } from '../cadCam';
import { parseDxf } from '@/domain/dxf/parseDxf';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { parsePortableUpid } from '@/domain/upid/portableUpidProject';

function circle(id: string, radius: number, role: 'outer' | 'hole' = 'outer', x = 0): CadSketchProfile {
  return { id, name: id, construction: false, role, geometry: { kind: 'circle', x, y: 0, radius } };
}
function sketch(profiles: readonly CadSketchProfile[]): CadSketchFeature {
  return { id: 'sketch1', name: 'Profile', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles };
}
function document(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Part', 'cad_test'), features, parameters });
}
const extrude: CadFeature = { kind: 'extrude', id: 'body', name: 'Body', suppressed: false, sketchId: 'sketch1', distance: 5, symmetric: false, operation: 'new', targetId: null };
function errorCode(operation: () => unknown, code: string) {
  try { operation(); throw new Error('Expected CAD error'); } catch (error) { expect(error).toBeInstanceOf(CadError); expect(error).toMatchObject({ code }); }
}

describe('CAD dimensions and strict document boundaries', () => {
  it('evaluates arithmetic precedence, scientific literals, unary signs and named parameters', () => {
    expect(evaluateCadScalar('width * (2 + height) / -2 + 1e-2', { width: 10, height: 3 })).toBe(-24.99);
    expect(evaluateCadScalar('--.5', {})).toBe(.5);
    expect(evaluateCadAngle(1e9, {})).toBe(280);
    expect(resolveCadProfile({ kind: 'slot', x: 0, y: 0, length: 20, width: 6, angle: 1e9 }, {})).toMatchObject({ angle: 280 });
  });
  it.each(['globalThis.alert(1)', 'width.toString()', '2 ** 3', 'Math.PI', '2(3)', '', '1 +', '1,2', '1;2'])('rejects executable or malformed expression %s', expression => {
    expect(() => evaluateCadScalar(expression, { width: 2 })).toThrow(CadError);
  });
  it('rejects missing parameters, zero division, overflow and excessive nesting', () => {
    errorCode(() => evaluateCadScalar('missing', {}), 'unknown-parameter');
    errorCode(() => evaluateCadScalar('2 / (width-width)', { width: 4 }), 'division-by-zero');
    errorCode(() => evaluateCadScalar('1e300', {}), 'invalid-scalar');
    errorCode(() => evaluateCadScalar('('.repeat(33) + '1' + ')'.repeat(33), {}), 'expression-limit');
  });
  it('creates a blank document with portable identity', () => {
    const blank = createCadDocument();
    expect(blank.name).toBe('Untitled part'); expect(blank.features).toEqual([]); expect(blank.parameters).toEqual({}); expect(blank.id).toMatch(/^cad_[a-z0-9-]+$/);
  });
  it('detaches and freezes accepted history and refuses reserved parameter writes', () => {
    const input = { ...createCadDocument('Part', 'cad_test'), parameters: { width: 5 } };
    const parsed = parseCadDocument(input);
    input.parameters.width = 10;
    expect(parsed.parameters.width).toBe(5);
    expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.parameters)).toBe(true);
    errorCode(() => applyCadEdits(parsed, [{ kind: 'set-parameter', name: '__proto__', value: 1 }]), 'invalid-parameter');
    errorCode(() => parseCadDocument(Object.create(input)), 'invalid-document');
  });
  it('rejects extra properties, duplicate IDs, unknown fields, nonfinite values and wrong units', () => {
    const blank = createCadDocument('Part', 'cad_test');
    expect(() => parseCadDocument({ ...blank, surprise: true })).toThrow(CadError);
    expect(() => parseCadDocument({ ...blank, units: 'inch' })).toThrow(CadError);
    expect(() => parseCadDocument({ ...blank, parameters: { width: Infinity } })).toThrow(CadError);
    expect(() => parseCadDocument({ ...blank, parameters: { 'bad-name': 1 } })).toThrow(CadError);
    expect(() => parseCadDocument({ ...blank, id: 'CON' })).toThrow(CadError);
    expect(() => parseCadDocument({ ...blank, id: 'con' })).toThrow(CadError);
    errorCode(() => document([sketch([]), sketch([])]), 'duplicate-id');
    expect(() => parseCadDocument({ ...blank, features: [{ ...sketch([]), profiles: [{ ...circle('a', 1), geometry: { kind: 'circle', x: 0, y: 0, radius: 1, extra: 1 } }] }] })).toThrow(CadError);
  });
  it('requires preceding correctly typed references and consistent operation targets', () => {
    errorCode(() => document([extrude, sketch([circle('a', 2)])]), 'invalid-reference');
    errorCode(() => document([sketch([circle('a', 2)]), { ...extrude, operation: 'cut', targetId: null }]), 'invalid-operation');
    errorCode(() => document([sketch([]), extrude]), 'empty-sketch');
    errorCode(() => document([sketch([circle('a', 2)]), extrude, { kind: 'transform', id: 'move', name: 'Move', suppressed: false, sourceId: 'sketch1', translation: [0, 0, 0], rotation: [0, 0, 0] }]), 'invalid-reference');
  });
  it('rejects exponential nested patterns and references to consumed or suppressed history bodies', () => {
    const first: CadFeature = { kind: 'linear-pattern', id: 'pattern1', name: 'Pattern', suppressed: false, sourceId: 'body', count: 100, spacing: [30, 0, 0] };
    const second: CadFeature = { ...first, id: 'pattern2', sourceId: 'pattern1' };
    errorCode(() => document([sketch([circle('a', 2)]), extrude, first, second]), 'feature-limit');
    errorCode(() => document([sketch([circle('a', 2)]), extrude, first, { kind: 'mirror', id: 'mirror', name: 'Mirror', suppressed: false, sourceId: 'body', plane: 'XY' }]), 'unavailable-body');
    errorCode(() => document([sketch([circle('a', 2)]), { ...extrude, suppressed: true }, first]), 'unavailable-body');
    const mirrored: CadFeature = { kind: 'mirror', id: 'mirror', name: 'Mirror', suppressed: false, sourceId: 'body', plane: 'XY' };
    const valid = document([sketch([circle('a', 2)]), extrude, mirrored, first]);
    expect(cadVisibleBodyIds(valid.features)).toEqual(['mirror', 'pattern1']);
  });
});

describe('atomic CAD edits', () => {
  it('updates parameter expressions without modifying saved input', () => {
    const profile = { ...circle('a', 2), geometry: { kind: 'circle', x: 0, y: 0, radius: 'diameter / 2' } } satisfies CadSketchProfile;
    const original = document([sketch([profile]), extrude], { diameter: 10 });
    const updated = applyCadEdits(original, [{ kind: 'set-parameter', name: 'diameter', value: 20 }]);
    expect(resolveCadProfile(profile.geometry, updated.parameters)).toMatchObject({ radius: 10 });
    expect(original.parameters.diameter).toBe(10); expect(profile.geometry.radius).toBe('diameter / 2');
  });
  it('rejects invalid final geometry atomically and allows dependent corrections within a batch', () => {
    const profile = { ...circle('a', 2), geometry: { kind: 'circle', x: 0, y: 0, radius: 'r' } } satisfies CadSketchProfile;
    const original = document([sketch([profile])], { r: 2 });
    const snapshot = JSON.stringify(original);
    errorCode(() => applyCadEdits(original, [{ kind: 'rename-document', name: 'Edited' }, { kind: 'set-parameter', name: 'r', value: -1 }]), 'invalid-profile');
    expect(JSON.stringify(original)).toBe(snapshot);
    errorCode(() => applyCadEdits(original, [{ kind: 'remove-parameter', name: 'r' }]), 'unknown-parameter');
    const corrected = applyCadEdits(original, [{ kind: 'remove-parameter', name: 'r' }, { kind: 'update-feature', feature: sketch([circle('a', 3)]) }]);
    expect(corrected.parameters).toEqual({});
  });
  it('requires explicit cascade deletion and removes transitive descendants', () => {
    const original = document([sketch([circle('a', 2)]), extrude, { kind: 'mirror', id: 'mirrored', name: 'Mirror', suppressed: false, sourceId: 'body', plane: 'XY' }]);
    errorCode(() => applyCadEdits(original, [{ kind: 'delete-feature', featureId: 'sketch1', cascade: false }]), 'dependent-feature');
    expect(applyCadEdits(original, [{ kind: 'delete-feature', featureId: 'sketch1', cascade: true }]).features).toEqual([]);
    expect(original.features).toHaveLength(3);
    errorCode(() => applyCadEdits(original, [{ kind: 'move-feature', featureId: 'sketch1', beforeId: null }]), 'invalid-reference');
    expect(applyCadEdits(original, [{ kind: 'move-feature', featureId: 'mirrored', beforeId: 'body' }, { kind: 'delete-feature', featureId: 'sketch1', cascade: true }]).features).toEqual([]);
  });
});

describe('analytic sketch geometry and CAM handoff', () => {
  it('validates dimensions and rejects intersecting or touching contours', () => {
    errorCode(() => document([sketch([circle('a', -1)])]), 'invalid-profile');
    errorCode(() => document([sketch([circle('a', 2), circle('b', 2, 'outer', 3)])]), 'profile-intersection');
    errorCode(() => document([sketch([circle('a', 2), circle('b', 2, 'outer', 4)])]), 'profile-intersection');
    errorCode(() => document([sketch([circle('a', 5), circle('b', 3, 'hole', 2)])]), 'profile-intersection');
    errorCode(() => document([sketch([circle('a', 2, 'hole')])]), 'invalid-profile-role');
  });
  it('rejects self-intersection, duplicate edges and degenerate polygons', () => {
    const polygon = (points: readonly (readonly [number, number])[]) => sketch([{ ...circle('a', 1), geometry: { kind: 'polygon', points } }]);
    expect(() => document([polygon([[0, 0], [10, 10], [0, 10], [10, 0]])])).toThrow(CadError);
    errorCode(() => document([polygon([[0, 0], [10, 0], [10, 0], [0, 10]])]), 'invalid-profile');
    errorCode(() => document([polygon([[0, 0], [5, 0], [10, 0]])]), 'invalid-profile');
  });
  it('validates polygon area in local differences at large coordinate offsets', () => {
    const offset = 1e9 - 10;
    const polygon: CadSketchProfile = { ...circle('polygon', 1), geometry: { kind: 'polygon', points: [[offset, offset], [offset + 1, offset], [offset + 1, offset + 1], [offset, offset + 1]] } };
    expect(() => document([sketch([polygon])])).not.toThrow();
    const entities = cadProfileToEntities(resolveCadProfile(polygon.geometry, {}));
    expect(entities).toHaveLength(4);
    expect(entities[0]).toMatchObject({ start: { x: offset, y: offset }, end: { x: offset + 1, y: offset } });
  });
  it('preserves four rounded-rectangle arcs, two rotated slot semicircles and circle geometry', () => {
    const rectangle: CadSketchProfile = { ...circle('rect', 1), geometry: { kind: 'rectangle', x: 0, y: 0, width: 30, height: 20, cornerRadius: 2 } };
    const slot: CadSketchProfile = { ...circle('slot', 1), role: 'hole', geometry: { kind: 'slot', x: 15, y: 10, length: 10, width: 4, angle: 30 } };
    const part = document([sketch([rectangle, slot])]);
    const raw = createPathPlanningDocumentFromDxfEntities(cadSketchToEntities(sketch([rectangle, slot]), {}));
    expect(raw.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    const cam = cadSketchToCam(part, 'sketch1');
    expect(cam.segments.filter(segment => segment.kind === 'arc')).toHaveLength(6);
    expect(cam.segments.filter(segment => segment.kind === 'line')).toHaveLength(6);
    expect(cam.contours).toHaveLength(2); expect(cam.contours.every(contour => contour.closed)).toBe(true);
    expect(cam.diagnostics.filter(diagnostic => diagnostic.severity === 'error')).toEqual([]);
    const dxf = parseDxf(cadSketchToDxf(part, 'sketch1'));
    expect(dxf.unitDeclaration.status).toBe('recognized'); expect(dxf.entities.filter(entity => entity.type === 'arc')).toHaveLength(6);
    expect(dxf.entities.filter(entity => entity.type === 'arc').map(arc => arc.radius).sort()).toEqual([2, 2, 2, 2, 2, 2]);
  });
  it('preserves nested islands and holes, excludes construction, and uses local coordinates for every plane', () => {
    const profiles = [circle('outer', 20), circle('hole', 10, 'hole'), circle('island', 3), { ...circle('construction', 25), construction: true }];
    const cam = cadSketchToCam(document([{ ...sketch(profiles), plane: 'YZ', offset: 200 }]), 'sketch1');
    expect(cam.segments).toHaveLength(3); expect(cam.segments.every(segment => segment.kind === 'circle')).toBe(true);
    expect(cam.contours.map(contour => contour.containmentDepth).sort()).toEqual([0, 1, 2]);
    expect(cam.segments[0].start.x).toBe(20); expect(cam.segments[0].start.y).toBe(0);
  });
  it('handles a slot with length equal to width as an exact circle', () => {
    expect(cadProfileToEntities({ kind: 'slot', x: 1, y: 2, length: 4, width: 4, angle: 90 })).toEqual([{ type: 'circle', layer: 'CAD', center: { x: 1, y: 2 }, radius: 2 }]);
  });
  it('preserves sub-millimetre contours with CAD precision instead of import-gap clustering', () => {
    const rectangle: CadSketchProfile = { ...circle('rect', 1), geometry: { kind: 'rectangle', x: 0, y: 0, width: .0005, height: .0004, cornerRadius: 0 } };
    const cam = cadSketchToCam(document([sketch([rectangle])]), 'sketch1');
    expect(cam.segments).toHaveLength(4); expect(cam.contours).toHaveLength(1); expect(cam.contours[0].closed).toBe(true);
    expect(cam.source.coordinateScaleToMillimeters).toBe(1); expect(cam.source.appliedUnits?.confirmed).toBe(true);
    const portable = parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: cam.schemaVersion, document: cam }));
    expect(portable).toMatchObject({ ok: true });
  });
  it('rejects empty, suppressed and missing sketches for transfer', () => {
    errorCode(() => cadSketchToCam(document([sketch([])]), 'sketch1'), 'empty-sketch');
    errorCode(() => cadSketchToCam(document([{ ...sketch([circle('a', 1)]), suppressed: true }]), 'sketch1'), 'suppressed-sketch');
    errorCode(() => cadSketchToCam(createCadDocument('Part', 'cad_test'), 'absent'), 'missing-sketch');
  });
});

import { describe, expect, it } from 'vitest';
import type { CadDocument, CadFeature } from '../cadDocument';
import { applyCadEdits } from '../cadOperations';
import { CadError } from '../cadError';
import { resolveCadCircularPattern, type CadCircularPatternFeature } from '../cadPatterns';
import { cadConsumedBodyIds, cadFeatureDependencies, cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';

const sketch: CadFeature = { kind: 'sketch', id: 'sketch', name: 'Seed profile', suppressed: false, plane: 'XY', offset: 0,
  profiles: [{ id: 'contour', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 10, y: 0, radius: 2 } }] };
const body: CadFeature = { kind: 'extrude', id: 'body', name: 'Seed solid', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null };
const pattern: CadCircularPatternFeature = { kind: 'circular-pattern', id: 'pattern', name: 'Circular pattern', suppressed: false,
  sourceId: 'body', count: 4, axis: 'z', center: [0, 0, 0], angle: 360 };
const linear: CadFeature = { kind: 'linear-pattern', id: 'linear', name: 'Linear pattern', suppressed: false, sourceId: 'body', count: 50, spacing: [20, 0, 0] };
function document(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Pattern part', 'cad_patterns'), features, parameters });
}
function expectCode(operation: () => unknown, code: string) {
  expect(operation).toThrow(CadError);
  try { operation(); } catch (error) { expect(error).toMatchObject({ code }); }
}

describe('circular pattern placements', () => {
  it.each([360, -360])('divides a full %s degree extent without duplicating the seed at closure', angle => {
    const resolved = resolveCadCircularPattern({ ...pattern, angle }, {});
    expect(resolved.fullTurn).toBe(true); expect(resolved.angle).toBe(angle);
    expect(resolved.angles).toEqual([0, angle / 4, angle / 2, 3 * angle / 4]);
    expect(resolved.angles).not.toContain(angle); expect(Object.is(resolved.angles[0], -0)).toBe(false);
    expect(resolved.center).toEqual([0, 0, 0]); expect(resolved.direction).toEqual([0, 0, 1]);
  });
  it.each([180, -90, 359.999999])('includes both endpoints of a partial %s degree extent', angle => {
    const resolved = resolveCadCircularPattern({ ...pattern, angle }, {});
    expect(resolved.fullTurn).toBe(false);
    expect(resolved.angles).toEqual([0, angle / 3, 2 * angle / 3, angle]);
  });
  it('resolves world-space center expressions and all principal axes without modifying the feature', () => {
    const input: CadCircularPatternFeature = { ...pattern, center: ['cx + 1', 'cy / 2', '-cz'], angle: 'extent', count: 2 };
    for (const [axis, direction] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]] as const) {
      const resolved = resolveCadCircularPattern({ ...input, axis }, { cx: 9, cy: 6, cz: 4, extent: 120 });
      expect(resolved.center).toEqual([10, 3, -4]); expect(resolved.direction).toEqual(direction); expect(resolved.angles).toEqual([0, 120]);
      expect(Object.isFrozen(resolved)).toBe(true); expect(Object.isFrozen(resolved.angles)).toBe(true); expect(Object.isFrozen(resolved.center)).toBe(true);
    }
    expect(input.center).toEqual(['cx + 1', 'cy / 2', '-cz']); expect(input.angle).toBe('extent');
  });
  it.each([1, 101, 2.5, NaN, Infinity])('rejects an unbounded or noninteger count %s before allocating placements', count => {
    expectCode(() => resolveCadCircularPattern({ ...pattern, count }, {}), 'pattern-limit');
  });
  it.each([0, -0, 1e-7, -1e-7, 360.001, -360.001])('rejects zero, tiny or excessive angular extent %s', angle => {
    expectCode(() => resolveCadCircularPattern({ ...pattern, angle }, {}), 'invalid-dimension');
  });
  it('uses finite raw scalar evaluation and retains the maximum 100 distinct full-turn placements', () => {
    const resolved = resolveCadCircularPattern({ ...pattern, count: 100, angle: 'turn * 2' }, { turn: 180 });
    expect(resolved.angles).toHaveLength(100); expect(new Set(resolved.angles).size).toBe(100); expect(resolved.angles.at(-1)).toBe(356.4);
    expectCode(() => resolveCadCircularPattern({ ...pattern, angle: 'missing' }, {}), 'unknown-parameter');
    expectCode(() => resolveCadCircularPattern({ ...pattern, center: [0, '1/0', 0] }, {}), 'division-by-zero');
    expectCode(() => resolveCadCircularPattern({ ...pattern, center: [1e10, 0, 0] }, {}), 'invalid-scalar');
  });
});

describe('circular pattern document and edit semantics', () => {
  it('accepts additive saved history while preserving old linear patterns unchanged', () => {
    const old = document([sketch, body, linear]);
    expect(JSON.parse(JSON.stringify(old)).features[2]).toEqual(linear);
    const mixed = document([sketch, body, linear, { ...pattern, sourceId: 'linear' }]);
    expect(cadFeatureDependencies(mixed.features[3])).toEqual(['linear']);
    expect(cadConsumedBodyIds(mixed.features[3])).toEqual(['linear']);
    expect(cadVisibleBodyIds(mixed.features)).toEqual(['pattern']);
    expect(JSON.parse(JSON.stringify(mixed)).features[3]).toEqual({ ...pattern, sourceId: 'linear' });
  });
  it('enforces strict shape, preceding visible solid references and suppression', () => {
    const blank = createCadDocument('Part', 'cad_patterns');
    for (const malformed of [{ ...pattern, axis: 'XY' }, { ...pattern, count: '4' }, { ...pattern, center: [0, 0] }, { ...pattern, fullTurn: true }]) {
      expectCode(() => parseCadDocument({ ...blank, features: [sketch, body, malformed] }), 'invalid-document');
    }
    expectCode(() => document([sketch, pattern, body]), 'invalid-reference');
    expectCode(() => document([sketch, body, { ...pattern, sourceId: 'sketch' }]), 'invalid-reference');
    expectCode(() => document([sketch, { ...body, suppressed: true }, pattern]), 'unavailable-body');
    expectCode(() => document([sketch, body, linear, pattern]), 'unavailable-body');
    const suppressed = document([sketch, body, { ...pattern, suppressed: true }]);
    expect(cadConsumedBodyIds(suppressed.features[2])).toEqual([]); expect(cadVisibleBodyIds(suppressed.features)).toEqual(['body']);
  });
  it('enforces the shared expanded limit across both pattern kinds in either order', () => {
    expect(document([sketch, body, linear, { ...pattern, count: 20, sourceId: 'linear' }]).features).toHaveLength(4);
    expectCode(() => document([sketch, body, linear, { ...pattern, count: 21, sourceId: 'linear' }]), 'feature-limit');
    expectCode(() => document([sketch, body, { ...pattern, count: 100 }, { ...linear, sourceId: 'pattern', count: 11 }]), 'feature-limit');
    expectCode(() => document([sketch, body, { ...pattern, count: 100 }, { ...pattern, id: 'nested', sourceId: 'pattern', count: 11 }]), 'feature-limit');
  });
  it('enforces the shared aggregate instance budget across independent circular and linear patterns', () => {
    const branches: CadFeature[] = [];
    for (let i = 0; i < 10; i++) {
      const sourceId = `mirror_${i}`;
      branches.push({ kind: 'mirror', id: sourceId, name: sourceId, suppressed: false, sourceId: 'body', plane: 'YZ' });
      branches.push(i % 2 ? { ...linear, id: `pattern_${i}`, sourceId, count: 100 } : { ...pattern, id: `pattern_${i}`, sourceId, count: 100 });
    }
    expect(document([sketch, body, ...branches]).features).toHaveLength(22);
    expectCode(() => document([sketch, body, ...branches, { ...pattern, count: 2 }]), 'feature-limit');
  });
  it('recomputes named dimensions atomically and retains source expressions and original saved input', () => {
    const feature: CadCircularPatternFeature = { ...pattern, center: ['center', 0, 0], angle: 'extent' };
    const original = document([sketch, body, feature], { center: 0, extent: 360 });
    const updated = applyCadEdits(original, [{ kind: 'set-parameter', name: 'center', value: 10 }, { kind: 'set-parameter', name: 'extent', value: -180 }]);
    expect(resolveCadCircularPattern(feature, updated.parameters)).toMatchObject({ center: [10, 0, 0], angles: [0, -60, -120, -180] });
    expect(updated.features[2]).toEqual(feature); expect(original.parameters).toEqual({ center: 0, extent: 360 });
    expectCode(() => applyCadEdits(updated, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-parameter', name: 'extent', value: 0 }]), 'invalid-dimension');
    expect(updated.name).toBe('Pattern part'); expect(updated.parameters.extent).toBe(-180);
    expectCode(() => applyCadEdits(updated, [{ kind: 'remove-parameter', name: 'center' }]), 'unknown-parameter');
  });
  it('guards dependency deletion and reorder, and permits explicit cascade through circular descendants', () => {
    const original = document([sketch, body, pattern, { ...linear, sourceId: 'pattern', count: 2 }]);
    expectCode(() => applyCadEdits(original, [{ kind: 'delete-feature', featureId: 'pattern', cascade: false }]), 'dependent-feature');
    expectCode(() => applyCadEdits(original, [{ kind: 'move-feature', featureId: 'pattern', beforeId: 'body' }]), 'invalid-reference');
    expect(applyCadEdits(original, [{ kind: 'delete-feature', featureId: 'body', cascade: true }]).features).toEqual([sketch]);
    const replacement: CadCircularPatternFeature = { ...pattern, count: 6, angle: 180 };
    expect(applyCadEdits(original, [{ kind: 'update-feature', feature: replacement }]).features[2]).toEqual(replacement);
  });
});

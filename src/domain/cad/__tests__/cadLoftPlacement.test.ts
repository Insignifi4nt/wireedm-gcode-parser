import { describe, expect, it } from 'vitest';
import type { CadDatumPlaneFeature, CadDocument, CadFeature, CadPlane, CadSketchFeature } from '../cadDocument';
import { CadError } from '../cadError';
import { applyCadEdits } from '../cadOperations';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { cadFramePointToWorld, prepareCadDatumFrames, resolveCadWorldDatum } from '../cadDatumPlanes';
import {
  inspectCadLoftSectionPair,
  inspectCadLoftSketch,
  resolveCadLoftSectionPlacements,
  resolveCadLoftSections,
  type CadLoftFeature,
  type CadLoftSection,
} from '../cadLoft';

const loft: CadLoftFeature = {
  kind: 'loft',
  id: 'loft',
  name: 'Loft',
  suppressed: false,
  sketchIds: ['a', 'b', 'c'],
  ruled: false,
  operation: 'new',
  targetId: null,
};
const datum = (id: string, basePlane: CadPlane = 'XY'): CadDatumPlaneFeature => ({
  id,
  kind: 'datum-plane',
  name: id,
  suppressed: false,
  definition: { kind: 'world', basePlane, origin: [37, -24, 11], rotation: [23, -37, 61] },
});
const section = (id: string, planeId: string, offset = 0): CadSketchFeature => ({
  id,
  kind: 'sketch',
  name: id,
  suppressed: false,
  plane: { kind: 'datum-plane', featureId: planeId },
  offset,
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 2, y: 3, radius: 5 } }],
});
function accepted(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Placed loft', 'cad_placed_loft'), features, parameters });
}
function sources(basePlane: CadPlane = 'XY'): readonly CadFeature[] {
  const first = datum('plane_a', basePlane);
  const frame = resolveCadWorldDatum(first, {});
  const second = { ...first, id: 'plane_b', definition: { ...first.definition, origin: cadFramePointToWorld(frame, 10, [3, -4]) } };
  const third = { ...first, id: 'plane_c', definition: { ...first.definition, origin: cadFramePointToWorld(frame, 20, [-2, 6]) } };
  return [first, second, third, section('a', 'plane_a', 2), section('b', 'plane_b', 2), section('c', 'plane_c', 2)];
}
const map = (features: readonly CadFeature[]) => new Map(features.map((feature) => [feature.id, feature]));
function errorCode(operation: () => unknown, code: string) {
  expect(operation).toThrow(CadError);
  try {
    operation();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}
function inspect(sketch: CadSketchFeature, features: readonly CadFeature[], parameters = {}): CadLoftSection {
  const result = inspectCadLoftSketch(sketch, parameters, prepareCadDatumFrames(features, parameters));
  if (!result.eligible) throw new Error(result.message);
  return result.section;
}

describe('common-frame Loft placement', () => {
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])(
    'preserves oriented %s local sections and tangential datum shifts in both orders',
    (basePlane) => {
      const features = sources(basePlane);
      for (const ids of [
        ['a', 'b', 'c'],
        ['c', 'b', 'a'],
      ]) {
        const document = accepted([...features, { ...loft, sketchIds: ids }]);
        const result = resolveCadLoftSections({ ...loft, sketchIds: ids }, map(document.features), {});
        expect(result.legacyPrincipalPlane).toBeNull();
        expect(result.sections.map((section) => section.stationMm)).toEqual(expect.arrayContaining([0]));
        result.sections.forEach((resolved, index) => expect(resolved.stationMm).toBeCloseTo((ids[0] === 'a' ? 1 : -1) * index * 10, 12));
        expect(result.sections.map((section) => section.offset)).toEqual([2, 2, 2]);
        expect(result.sections[0].tangentialOffsetMm).toEqual([0, 0]);
        if (ids[0] === 'a') {
          expect(result.sections[1].tangentialOffsetMm[0]).toBeCloseTo(3, 13);
          expect(result.sections[1].tangentialOffsetMm[1]).toBeCloseTo(-4, 13);
        }
        const first = result.sections[0];
        expect(result.commonFrame.origin).toEqual(cadFramePointToWorld(first.placement.frame, first.offset, [0, 0]));
        expect(result.placementUncertaintyMm).toBeLessThan(1e-7);
        expect(Object.isFrozen(result.commonFrame)).toBe(true);
        expect(Object.isFrozen(result.sections[1].tangentialOffsetMm)).toBe(true);
      }
    },
  );
  it('uses placed station order rather than raw authored offsets and supports cached reorder validation', () => {
    const features = sources().map((feature) =>
      feature.kind === 'sketch' ? { ...feature, offset: feature.id === 'a' ? 0 : -5 } : feature,
    );
    const document = accepted([...features, loft]);
    const result = resolveCadLoftSections(loft, map(document.features), {});
    result.sections.forEach((section, index) => expect(section.stationMm).toBeCloseTo([0, 5, 15][index], 12));
    expect(resolveCadLoftSectionPlacements([...result.sections].reverse()).sections[1].stationMm).toBeCloseTo(-10, 12);
    errorCode(() => resolveCadLoftSectionPlacements([result.sections[0], result.sections[2], result.sections[1]]), 'invalid-loft-order');
    expect(document.features.find((feature) => feature.id === 'b')).toMatchObject({ offset: -5 });
  });
  it('accepts mixed principal/datum frames only through canonical construction, including a principal first section', () => {
    const frame: CadDatumPlaneFeature = {
      ...datum('plane'),
      definition: { kind: 'world', basePlane: 'XZ', origin: [5, -20, 0], rotation: [0, 0, 0] },
    };
    const a: CadSketchFeature = { ...section('a', 'plane'), plane: 'XZ', offset: 4 };
    const b = section('b', 'plane', 2);
    const result = resolveCadLoftSections({ ...loft, sketchIds: ['a', 'b'] }, map([frame, a, b]), {});
    expect(result).toMatchObject({ legacyPrincipalPlane: null, commonFrame: { origin: [0, -4, 0] } });
    expect(result.sections[0]).toMatchObject({ stationMm: 0, tangentialOffsetMm: [0, 0] });
    expect(result.sections[1]).toMatchObject({ stationMm: 18, tangentialOffsetMm: [5, 0] });
    const middle = { ...a, id: 'middle', offset: 10 };
    const triple = resolveCadLoftSections({ ...loft, sketchIds: ['a', 'middle', 'b'] }, map([frame, a, middle, b]), {});
    expect(triple.sections.map((section) => section.stationMm)).toEqual([0, 6, 18]);
    expect(triple.sections[1].tangentialOffsetMm).toEqual([0, 0]);
  });
  it('retains legacy absolute principal stations and offset tolerance without a new precision restriction', () => {
    const a = { ...section('a', 'unused'), plane: 'XY' as const, offset: 999999990 };
    const b = { ...a, id: 'b', offset: 999999991 };
    const result = resolveCadLoftSections({ ...loft, sketchIds: ['a', 'b'] }, map([a, b]), {});
    expect(result).toMatchObject({ legacyPrincipalPlane: 'XY', placementUncertaintyMm: 0, commonFrame: { origin: [0, 0, 0] } });
    expect(result.sections.map((section) => section.stationMm)).toEqual([a.offset, b.offset]);
    expect(result.offsetTolerance).toBe(8 * Number.EPSILON * b.offset);
  });
  it('keeps basis compatibility independent of coplanar gaps, and rejects rolled, reversed or twisted axes', () => {
    const first = datum('plane');
    const a = section('a', 'plane');
    const resolved = inspect(a, [first]);
    expect(inspectCadLoftSectionPair(resolved, resolved)).toMatchObject({ compatible: true, stationMm: 0 });
    errorCode(() => resolveCadLoftSectionPlacements([resolved, { ...resolved, sketchId: 'b' }]), 'invalid-loft-order');
    for (const rotation of [
      [180, 0, 0],
      [0, 0, 180],
      [23.1, -37, 61],
    ] as const) {
      const other = { ...first, id: 'other', definition: { ...first.definition, rotation } };
      const pair = inspectCadLoftSectionPair(resolved, inspect(section('b', 'other', 10), [other]));
      expect(pair).toMatchObject({ compatible: false, code: 'unsupported-loft-planes' });
    }
  });
  it('guards far-world placement and amplified numerical equivalence without constraining reference sketches', () => {
    const far = { ...datum('plane'), definition: { ...datum('plane').definition, origin: [1e8, 0, 0] as const } };
    const a = section('a', 'plane');
    const b = section('b', 'plane', 20);
    expect(accepted([far, a, b]).features).toHaveLength(3);
    errorCode(() => accepted([far, a, b, { ...loft, sketchIds: ['a', 'b'] }]), 'unsupported-datum-precision');
    const origin: CadDatumPlaneFeature = {
      ...datum('plane'),
      definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [37, 0, 0] },
    };
    const large = (id: string, planeId: string, offset: number): CadSketchFeature => ({
      ...section(id, planeId, offset),
      profiles: [{ id: 'large', name: 'Large', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 7e5 } }],
    });
    const first = large('a', 'plane', 0);
    const second = large('b', 'plane', 7e5);
    expect(inspectCadLoftSectionPair(inspect(first, [origin]), inspect(second, [origin]))).toMatchObject({ compatible: true });
    const near = { ...origin, id: 'near', definition: { ...origin.definition, rotation: [37 + 1e-12, 0, 0] as const } };
    expect(inspectCadLoftSectionPair(inspect(first, [origin]), inspect(large('b', 'near', 7e5), [near]))).toMatchObject({
      compatible: false,
      code: 'unsupported-datum-precision',
    });
  });
  it('reserves both frames angular uncertainty even when a noncardinal gimbal frame matches a cardinal basis', () => {
    const cardinal: CadDatumPlaneFeature = {
      ...datum('cardinal'),
      definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [0, 90, 0] },
    };
    const gimbal: CadDatumPlaneFeature = { ...cardinal, id: 'gimbal', definition: { ...cardinal.definition, rotation: [37, 90, 37] } };
    const translatedSection = (id: string, planeId: string, offset: number): CadSketchFeature => ({
      ...section(id, planeId, offset),
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 3.6e6, y: 0, radius: 1 } }],
    });
    const a = inspect(translatedSection('a', 'cardinal', 0), [cardinal]);
    const b = inspect(translatedSection('b', 'gimbal', 1), [gimbal]);
    expect(a.placement.frame.precision.angularUncertainty).toBe(0);
    expect(b.placement.frame.precision.angularUncertainty).toBeGreaterThan(0);
    expect(inspectCadLoftSectionPair(a, b)).toMatchObject({ compatible: false, code: 'unsupported-datum-precision' });
    // Reordering does not make the same unsupported frame pair eligible.
    expect(inspectCadLoftSectionPair(b, a)).toMatchObject({ compatible: false, code: 'unsupported-datum-precision' });
  });
  it('keeps unsupported Sweep/Pocket gates and atomic history/reference repair behavior', () => {
    const features = sources();
    const document = accepted([...features, loft]);
    const firstDatum = features[0];
    if (firstDatum.kind !== 'datum-plane') throw new Error('Missing datum');
    errorCode(
      () =>
        applyCadEdits(document, [
          { kind: 'set-parameter', name: 'angle', value: 23.1 },
          { kind: 'update-feature', feature: { ...firstDatum, definition: { ...firstDatum.definition, rotation: ['angle', -37, 61] } } },
        ]),
      'unsupported-loft-planes',
    );
    expect(document.parameters).toEqual({});
    errorCode(() => applyCadEdits(document, [{ kind: 'delete-feature', featureId: firstDatum.id, cascade: false }]), 'dependent-feature');
    expect(
      applyCadEdits(document, [{ kind: 'delete-feature', featureId: firstDatum.id, cascade: true }]).features.map((feature) => feature.id),
    ).not.toContain('loft');
    errorCode(() => applyCadEdits(document, [{ kind: 'move-feature', featureId: firstDatum.id, beforeId: null }]), 'invalid-reference');
    const firstSketch = features.find((feature) => feature.id === 'a');
    if (firstSketch?.kind !== 'sketch') throw new Error('Missing sketch');
    const repaired = applyCadEdits(document, [
      { kind: 'update-feature', feature: { ...loft, suppressed: true } },
      { kind: 'update-feature', feature: { ...firstSketch, offset: 12 } },
    ]);
    errorCode(() => applyCadEdits(repaired, [{ kind: 'update-feature', feature: loft }]), 'invalid-loft-order');
    expect(repaired.features.at(-1)?.suppressed).toBe(true);
  });
});

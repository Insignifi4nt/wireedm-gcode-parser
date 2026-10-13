import { describe, expect, it } from 'vitest';
import type { CadFeature, CadPlane, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { CadError } from '../cadError';
import {
  resolveCadPocketExtent,
  resolveCadPocketInputs,
  type CadPocketDirection,
  type CadPocketExtentInput,
  type CadPocketFeature,
} from '../cadPocket';
import { applyCadEdits } from '../cadOperations';
import {
  cadFeatureDependencies,
  cadFeatureInputs,
  cadFeatureProducesBody,
  cadVisibleBodyIds,
  createCadDocument,
  parseCadDocument,
} from '../cadSchema';

const feature: CadPocketFeature = {
  kind: 'pocket',
  id: 'pocket',
  name: 'Pocket',
  suppressed: false,
  sketchId: 'section',
  targetId: 'target',
  extent: { kind: 'through-all', direction: 'both' },
};
const circle = (id = 'circle', radius: number | string = 2, construction = false): CadSketchProfile => ({
  id,
  name: id,
  construction,
  geometry: { kind: 'circle', x: 10, y: 10, radius },
});
const section = (profiles: readonly CadSketchProfile[] = [circle()], offset: number | string = 0): CadSketchFeature => ({
  kind: 'sketch',
  id: 'section',
  name: 'Section',
  suppressed: false,
  plane: 'XY',
  offset,
  profiles,
});
const base: CadFeature = {
  kind: 'extrude',
  id: 'target',
  name: 'Plate',
  suppressed: false,
  sketchId: 'section',
  distance: 'thickness',
  symmetric: false,
  operation: 'new',
  targetId: null,
};
const inputs = (sketch = section(), target: CadFeature = base) =>
  new Map<string, CadFeature>([
    [sketch.id, sketch],
    [target.id, target],
  ]);
const bounds = { min: [0, 0, 0] as const, max: [20, 20, 10] as const };
function extent(overrides: Partial<CadPocketExtentInput> = {}) {
  return resolveCadPocketExtent({
    plane: 'XY',
    offsetMm: 5,
    direction: 'both',
    targetBounds: bounds,
    nativeToleranceMm: 1e-7,
    sectionScaleMm: 2,
    ...overrides,
  });
}
function expectCode(operation: () => unknown, code: string) {
  try {
    operation();
    throw new Error('Expected CAD failure');
  } catch (error) {
    expect(error).toBeInstanceOf(CadError);
    expect(error).toMatchObject({ code });
  }
}

describe('Through-all Pocket finite extent', () => {
  it.each(['positive', 'negative', 'both'] satisfies CadPocketDirection[])(
    'uses exact authored one-sided stations and bounded absolute %s caps',
    (direction) => {
      const value = extent({ direction });
      expect(value.targetNormalIntervalMm).toEqual([0, 10]);
      expect(value.requiredSpanMm).toBe(direction === 'both' ? 10 : 5);
      if (direction === 'positive') {
        expect(value.startStationMm).toBe(5);
        expect(value.startOffsetMm).toBe(0);
        expect(value.endStationMm).toBeGreaterThan(10);
      }
      if (direction === 'negative') {
        expect(value.endStationMm).toBe(5);
        expect(value.endOffsetMm).toBe(0);
        expect(value.startStationMm).toBeLessThan(0);
      }
      if (direction === 'both') {
        expect(value.startStationMm).toBeLessThan(0);
        expect(value.endStationMm).toBeGreaterThan(10);
      }
      expect(value.capMarginMm).toBe(1e-6);
      expect(value.spanMm).toBeCloseTo(value.endStationMm - value.startStationMm, 12);
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.targetNormalIntervalMm)).toBe(true);
    },
  );
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('projects the full selected target bounds with the correct %s normal sign', (plane) => {
    const targetBounds = { min: [3, -14, -7] as const, max: [9, -4, 2] as const };
    const station = plane === 'XY' ? 0 : plane === 'XZ' ? 8 : 6;
    const value = extent({ plane, offsetMm: station, targetBounds });
    expect(value.targetNormalIntervalMm).toEqual(plane === 'XY' ? [-7, 2] : plane === 'XZ' ? [4, 14] : [3, 9]);
  });
  it('covers disconnected target solids across their complete normal interval', () => {
    const value = extent({ targetBounds: { min: [0, 0, -40], max: [20, 20, 90] } });
    expect(value.requiredSpanMm).toBe(130);
    expect(value.startStationMm).toBeLessThan(-40);
    expect(value.endStationMm).toBeGreaterThan(90);
  });
  it('builds Both at nearby absolute stations even when the authored plane is remote', () => {
    const nearby = extent({ offsetMm: 0 });
    const remote = extent({ offsetMm: 1e9 });
    expect(remote.startStationMm).toBe(nearby.startStationMm);
    expect(remote.endStationMm).toBe(nearby.endStationMm);
    expect(remote.capMarginMm).toBe(nearby.capMarginMm);
    expect(remote.startStationMm).not.toBe(1e9 + remote.startOffsetMm);
    expectCode(() => extent({ offsetMm: 1e9, direction: 'negative' }), 'pocket-span-limit');
    expectCode(() => extent({ offsetMm: 1e9, direction: 'positive' }), 'pocket-no-material');
  });
  it('retains deliberate one-sided cuts when the sketch is outside the body on the entry side', () => {
    const positive = extent({ offsetMm: -5, direction: 'positive' });
    expect(positive.startStationMm).toBe(-5);
    expect(positive.requiredSpanMm).toBe(15);
    const negative = extent({ offsetMm: 15, direction: 'negative' });
    expect(negative.endStationMm).toBe(15);
    expect(negative.requiredSpanMm).toBe(15);
  });
  it('rejects wrong directions and padded tangent/precision-scale material before extending caps', () => {
    expectCode(() => extent({ offsetMm: 15, direction: 'positive' }), 'pocket-no-material');
    expectCode(() => extent({ offsetMm: -5, direction: 'negative' }), 'pocket-no-material');
    expectCode(() => extent({ offsetMm: 10, direction: 'positive' }), 'unsupported-pocket-precision');
    expectCode(
      () => extent({ offsetMm: 10, direction: 'positive', targetBounds: { min: [0, 0, -1e-7], max: [20, 20, 10 + 1e-7] } }),
      'unsupported-pocket-precision',
    );
    expectCode(() => extent({ targetBounds: { min: [0, 0, 0], max: [20, 20, 1e-7] } }), 'unsupported-pocket-precision');
  });
  it('accepts the one-million-mm required span including native bounds padding and bounded margins', () => {
    for (const direction of ['positive', 'both'] satisfies CadPocketDirection[]) {
      const value = extent({ offsetMm: 0, direction, targetBounds: { min: [0, 0, -1e-7], max: [20, 20, 1e6 + 1e-7] } });
      expect(value.spanMm).toBeGreaterThan(1e6);
      expect(value.spanMm).toBeLessThan(1e6 + 1e-4);
    }
    expectCode(() => extent({ targetBounds: { min: [0, 0, 0], max: [20, 20, 1e6 + 1] } }), 'pocket-span-limit');
  });
  it('accounts for target-native tolerance and coordinate arithmetic without widening saved dimensions', () => {
    const native = extent({ nativeToleranceMm: 1e-4 });
    expect(native.capMarginMm).toBeGreaterThanOrEqual(4e-4);
    const far = extent({ targetBounds: { min: [0, 0, 1e8], max: [20, 20, 1e8 + 10] } });
    expect(far.capMarginMm).toBeGreaterThan(1e-6);
    expect(far.startStationMm).toBeLessThan(1e8);
    expect(far.endStationMm).toBeGreaterThan(1e8 + 10);
    expectCode(() => extent({ nativeToleranceMm: 1e6 }), 'unsupported-pocket-precision');
  });
  it('rejects malformed/native nonfinite, reversed, accessor and unknown fields without side effects', () => {
    for (const targetBounds of [
      { min: [0, 0, 0], max: [20, 20, Infinity] },
      { min: [0, 0, 10], max: [20, 20, 0] },
      { min: [0, 0, 0], max: [0, 20, 10] },
    ] as CadPocketExtentInput['targetBounds'][]) {
      expect(() => extent({ targetBounds })).toThrow(CadError);
    }
    expect(() => extent({ nativeToleranceMm: NaN })).toThrow(CadError);
    expectCode(
      () =>
        resolveCadPocketExtent({
          ...{ plane: 'XY', offsetMm: 5, direction: 'both', targetBounds: bounds, nativeToleranceMm: 1e-7, sectionScaleMm: 2 },
          distance: 20,
        } as CadPocketExtentInput),
      'invalid-pocket-extent',
    );
    let reads = 0;
    const getter = { plane: 'XY', offsetMm: 5, direction: 'both', targetBounds: bounds, nativeToleranceMm: 1e-7, sectionScaleMm: 2 };
    Object.defineProperty(getter, 'offsetMm', {
      get() {
        reads++;
        return 5;
      },
    });
    expectCode(() => resolveCadPocketExtent(getter as CadPocketExtentInput), 'invalid-pocket-extent');
    expect(reads).toBe(0);
  });
  it('bounds the cap reserve relative to section and required span, including tiny bores in large bodies', () => {
    expectCode(() => extent({ nativeToleranceMm: 0.1 }), 'unsupported-pocket-precision');
    expectCode(() => extent({ sectionScaleMm: 8e-6 }), 'unsupported-pocket-precision');
    expectCode(() => extent({ offsetMm: 10 - 4e-6, direction: 'positive' }), 'unsupported-pocket-precision');
    const bore = extent({ sectionScaleMm: 0.001, targetBounds: { min: [0, 0, 0], max: [1e6, 1e6, 1e6] } });
    expect(bore.requiredSpanMm).toBe(1e6);
    expect(bore.capMarginMm).toBeLessThan(0.001 / 8);
    expect(extent({ sectionScaleMm: 9e-6 }).capMarginMm).toBe(1e-6);
  });
  it('requires representable outward caps at far world coordinates without using the remote source plane', () => {
    const far = extent({ offsetMm: -1e9, targetBounds: { min: [1e9, 1e9, 1e9], max: [1e9 + 20, 1e9 + 20, 1e9 + 10] } });
    expect(far.startStationMm).toBeLessThan(1e9);
    expect(far.endStationMm).toBeGreaterThan(1e9 + 10);
    expectCode(
      () => extent({ sectionScaleMm: 0.0001, targetBounds: { min: [1e9, 1e9, 1e9], max: [1e9 + 20, 1e9 + 20, 1e9 + 10] } }),
      'unsupported-pocket-precision',
    );
  });
});

describe('Through-all Pocket region and reference resolution', () => {
  it('preserves expressions, all material islands/voids and construction exclusion', () => {
    const sketch = section([circle('outer', 'radius'), circle('hole', 2), circle('island', 1), circle('guide', 8, true)], 'offset');
    const result = resolveCadPocketInputs(feature, inputs(sketch), { radius: 5, offset: 3 });
    expect(result).toMatchObject({
      sketch,
      plane: 'XY',
      offset: 3,
      direction: 'both',
      targetId: 'target',
      regionCount: 2,
      sectionEdgeCount: 3,
    });
    expect(result.regions[0].voids).toHaveLength(1);
    expect(result.sketch.offset).toBe('offset');
    expect(sketch.profiles[0].geometry).toMatchObject({ radius: 'radius' });
    expect(Object.isFrozen(result.regions)).toBe(true);
  });
  it('rejects empty/suppressed/non-sketch sources and unavailable/non-body targets', () => {
    expectCode(() => resolveCadPocketInputs(feature, inputs(section([])), {}), 'empty-sketch');
    expectCode(() => resolveCadPocketInputs(feature, inputs({ ...section(), suppressed: true }), {}), 'suppressed-sketch');
    expectCode(() => resolveCadPocketInputs({ ...feature, sketchId: 'target' }, inputs(), {}), 'invalid-reference');
    expectCode(() => resolveCadPocketInputs({ ...feature, targetId: 'section' }, inputs(), {}), 'invalid-reference');
    expectCode(() => resolveCadPocketInputs(feature, inputs(section(), { ...base, suppressed: true }), {}), 'unavailable-body');
    const map = inputs();
    map.set('replacement', {
      kind: 'transform',
      id: 'replacement',
      name: 'Replacement',
      suppressed: false,
      sourceId: 'target',
      translation: [0, 0, 0],
      rotation: [0, 0, 0],
    });
    expectCode(() => resolveCadPocketInputs(feature, map, {}), 'unavailable-body');
  });
  it('rejects hidden inactive dimensions and accessor-backed authoring at its strict boundary', () => {
    for (const extra of [{ distance: 15 }, { symmetric: true }, { operation: 'cut' }])
      expectCode(() => resolveCadPocketInputs({ ...feature, ...extra } as CadPocketFeature, inputs(), {}), 'invalid-feature');
    let reads = 0;
    const getter = { ...feature };
    Object.defineProperty(getter, 'targetId', {
      get() {
        reads++;
        return 'target';
      },
    });
    expectCode(() => resolveCadPocketInputs(getter, inputs(), {}), 'invalid-feature');
    expect(reads).toBe(0);
  });
  it('uses contour spans and circular support radii without penalizing arc segmentation', () => {
    const whole = resolveCadPocketInputs(feature, inputs(section([circle('circle', 5)])), {});
    for (const count of [2, 4, 32]) {
      const geometry: CadSketchProfile['geometry'] = {
        kind: 'path',
        segments: Array.from({ length: count }, (_, index) => ({
          kind: 'arc',
          center: [10, 10],
          radius: 5,
          startAngle: (index * 360) / count,
          sweep: 360 / count,
        })),
      };
      const split = resolveCadPocketInputs(feature, inputs(section([{ ...circle(), geometry }])), {});
      expect(split.sectionScaleMm).toBe(whole.sectionScaleMm);
      expect(split.sectionEdgeCount).toBe(count);
    }
    const shapes: readonly [CadSketchProfile['geometry'], number][] = [
      [{ kind: 'rectangle', x: 0, y: 0, width: 8, height: 10, cornerRadius: 1 }, 1],
      [{ kind: 'slot', x: 0, y: 0, length: 12, width: 4, angle: 37 }, 2],
      [
        {
          kind: 'polygon',
          points: [
            [0, 0],
            [10, 0],
            [10, 3],
            [0, 3],
          ],
        },
        3,
      ],
    ];
    for (const [geometry, scale] of shapes)
      expect(resolveCadPocketInputs(feature, inputs(section([{ ...circle(), geometry }])), {}).sectionScaleMm).toBe(scale);
  });
});

function document(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = { thickness: 10 }) {
  return parseCadDocument({ ...createCadDocument('Pocket part', 'cad_pocket'), features, parameters });
}
describe('Through-all Pocket schema and atomic history', () => {
  it('preserves old distance cuts and expressions without migrating them into through-all features', () => {
    const cut: CadFeature = { ...base, id: 'distance_cut', operation: 'cut', targetId: 'target', distance: 'thickness / 2' };
    const value = document([section(), base, cut]);
    expect(JSON.stringify(value.features[2])).toBe(JSON.stringify(cut));
    expect(value.features[2].kind).toBe('extrude');
    expect(document([section(), base, feature]).features[2]).toEqual(feature);
  });
  it('has typed sketch/solid dependencies and consumes only its selected current target', () => {
    expect(cadFeatureInputs(feature)).toEqual({ sketchIds: ['section'], curveIds: [], bodyIds: ['target'] });
    expect(cadFeatureDependencies(feature)).toEqual(['section', 'target']);
    expect(cadFeatureProducesBody(feature)).toBe(true);
    const other: CadFeature = { ...base, id: 'other' };
    const value = document([section(), base, other, feature]);
    expect(cadVisibleBodyIds(value.features)).toEqual(['other', 'pocket']);
    for (const changed of [
      { ...feature, sketchId: 'target' },
      { ...feature, targetId: 'section' },
    ])
      expectCode(() => document([section(), base, changed]), 'invalid-reference');
    expectCode(() => document([section(), feature, base]), 'invalid-reference');
    expectCode(() => document([section(), base, feature, { ...feature, id: 'second' }]), 'unavailable-body');
  });
  it('rejects inactive fields and invalid direction instead of saving ignored authoring data', () => {
    for (const extra of [
      { distance: 10 },
      { symmetric: true },
      { operation: 'cut' },
      { extent: { kind: 'through-all', direction: 'positive', distance: 10 } },
      { extent: { kind: 'distance', direction: 'both' } },
      { extent: { kind: 'through-all', direction: 'sideways' } },
    ]) {
      expect(() => document([section(), base, { ...feature, ...extra } as CadPocketFeature])).toThrow(CadError);
    }
  });
  it('updates source parameters atomically and keeps suppressed history repairable', () => {
    const source = section([circle('circle', 'radius')], 'station');
    const value = document([source, base, feature], { radius: 2, station: 3, thickness: 10 });
    const changed = applyCadEdits(value, [
      { kind: 'set-parameter', name: 'radius', value: 4 },
      { kind: 'set-parameter', name: 'station', value: 7 },
    ]);
    // Only a preceding prefix is accepted by the actual feature resolver.
    const preceding = new Map(changed.features.slice(0, 2).map((item) => [item.id, item]));
    expect(resolveCadPocketInputs(feature, preceding, changed.parameters)).toMatchObject({ offset: 7, sectionScaleMm: 4 });
    expectCode(() => applyCadEdits(value, [{ kind: 'set-parameter', name: 'radius', value: 0 }]), 'invalid-profile');
    expect(value.parameters.radius).toBe(2);
    const stock = { ...section(), id: 'stock' };
    const suppressed = document([stock, { ...base, sketchId: 'stock' }, source, { ...feature, suppressed: true }], {
      radius: 2,
      station: 3,
      thickness: 10,
    });
    const empty = applyCadEdits(suppressed, [{ kind: 'update-feature', feature: { ...source, profiles: [] } }]);
    expectCode(() => applyCadEdits(empty, [{ kind: 'update-feature', feature }]), 'empty-sketch');
    expect(empty.features[3].suppressed).toBe(true);
    expectCode(
      () => document([source, base, { ...feature, suppressed: true, sketchId: 'missing' }], suppressed.parameters),
      'invalid-reference',
    );
  });
  it('protects dependent history on delete and reorder, and cascades only when explicitly requested', () => {
    const value = document([section(), base, feature]);
    expectCode(() => applyCadEdits(value, [{ kind: 'delete-feature', featureId: 'target', cascade: false }]), 'dependent-feature');
    expect(applyCadEdits(value, [{ kind: 'delete-feature', featureId: 'target', cascade: true }]).features.map((item) => item.id)).toEqual([
      'section',
    ]);
    expectCode(() => applyCadEdits(value, [{ kind: 'move-feature', featureId: 'pocket', beforeId: 'target' }]), 'invalid-reference');
    expect(value.features.map((item) => item.id)).toEqual(['section', 'target', 'pocket']);
  });
  it('counts every new material operand in the combined pattern expansion budget', () => {
    function pattern(id: string, sourceId: string, count: number): CadFeature {
      return { kind: 'linear-pattern', id, name: id, suppressed: false, sourceId, count, spacing: [30, 0, 0] };
    }
    const p100 = pattern('p100', 'target', 100);
    const p500 = pattern('p500', 'p100', 5);
    const p1000 = pattern('p1000', 'p100', 10);
    expectCode(
      () => document([section(), base, p100, p500, { ...feature, targetId: 'p500' }, pattern('double', 'pocket', 2)]),
      'feature-limit',
    );
    expectCode(() => document([section(), base, p100, p1000, { ...feature, targetId: 'p1000' }]), 'feature-limit');
    // Legacy distance-cut preflight retains its existing counts.
    expect(document([section(), base, p100, p1000, { ...base, id: 'old_cut', operation: 'cut', targetId: 'p1000' }]).features).toHaveLength(
      5,
    );
    const disjoint = section([circle('a'), { ...circle('b'), geometry: { kind: 'circle', x: 30, y: 10, radius: 2 } }]);
    const p999a = pattern('p37', 'target', 37);
    const p999b = pattern('p999', 'p37', 27);
    expect(resolveCadPocketInputs(feature, inputs(disjoint), {}).regionCount).toBe(2);
    expectCode(() => document([disjoint, base, p999a, p999b, { ...feature, targetId: 'p999' }]), 'feature-limit');
  });
});

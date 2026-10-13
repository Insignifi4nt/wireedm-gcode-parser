import { describe, expect, it } from 'vitest';
import type { CadCurveFeature, CadDatumPlaneFeature, CadDocument, CadFeature, CadPlane, CadSketchFeature } from '../cadDocument';
import { CadError } from '../cadError';
import { applyCadEdits } from '../cadOperations';
import {
  cadFeatureDependencies,
  cadFeatureInputs,
  cadFeatureProducesBody,
  cadVisibleBodyIds,
  createCadDocument,
  parseCadDocument,
} from '../cadSchema';
import {
  cadFrameDirectionToWorld,
  cadFramePointToWorld,
  cadPrincipalFrame,
  prepareCadDatumFrames,
  resolveCadExtrudeRevolvePlacement,
  resolveCadSketchPlacement,
  resolveCadWorldDatum,
} from '../cadDatumPlanes';
import { prepareCadDocumentFrames } from '../cadDocumentFrames';
import { cadFrameEntityBounds } from '../cadFrameBounds';
import { placeCadCurveGeometry, resolveCadCurve, resolveCadCurveGeometry } from '../cadCurve';
import { measureCadSketch } from '../cadMeasurements';
import { measureCadCurve } from '../cadCurveMeasurements';
import { cadSketchToDxf } from '../cadCam';

const datum: CadDatumPlaneFeature = {
  kind: 'datum-plane',
  id: 'tilt',
  name: 'Tilt',
  suppressed: false,
  definition: {
    kind: 'world',
    basePlane: 'XY',
    origin: [37, -24, 11],
    rotation: [23, -37, 61],
  },
};
const plane = { kind: 'datum-plane', featureId: 'tilt' } as const;
const sketch: CadSketchFeature = {
  kind: 'sketch',
  id: 'section',
  name: 'Section',
  suppressed: false,
  plane,
  offset: 'station',
  profiles: [
    {
      id: 'circle',
      name: 'Circle',
      construction: false,
      geometry: { kind: 'circle', x: 2, y: 3, radius: 'radius' },
    },
  ],
};
const curve: CadCurveFeature = {
  kind: 'curve',
  id: 'rail',
  name: 'Rail',
  suppressed: false,
  plane,
  offset: 'station',
  segments: [
    {
      kind: 'arc',
      center: [0, 0],
      radius: 'radius',
      startAngle: 0,
      sweep: -270,
    },
  ],
};
const pad: Extract<CadFeature, { kind: 'extrude' }> = {
  kind: 'extrude',
  id: 'pad',
  name: 'Pad',
  suppressed: false,
  sketchId: 'section',
  operation: 'new',
  targetId: null,
  distance: -10,
  symmetric: true,
};
const parameters = { station: -3, radius: 2 };
function document(features: readonly CadFeature[] = [datum, sketch, curve, pad], params = parameters): CadDocument {
  return parseCadDocument({
    ...createCadDocument('Datum part', 'cad_datum'),
    features,
    parameters: params,
  });
}
function code(action: () => unknown, expected: string) {
  try {
    action();
    throw new Error('Expected validation failure');
  } catch (error) {
    expect(error).toBeInstanceOf(CadError);
    expect(error).toMatchObject({ code: expected });
  }
}
function near(a: readonly number[], b: readonly number[], digits = 13) {
  a.forEach((value, index) => expect(value).toBeCloseTo(b[index], digits));
}

describe('world datum frames and analytic placement', () => {
  it('keeps origin unrotated and applies exact cardinal basis/normal offset without roundoff axes', () => {
    const frame = resolveCadWorldDatum({ ...datum, definition: { ...datum.definition, rotation: [90, 0, 0] } }, {});
    expect(frame).toMatchObject({
      origin: [37, -24, 11],
      u: [1, 0, 0],
      v: [0, 0, 1],
      normal: [0, -1, 0],
      precision: { angularUncertainty: 0 },
    });
    expect(cadFramePointToWorld(frame, -3, [2, 3])).toEqual([39, -21, 14]);
    expect(cadFrameDirectionToWorld(frame, [2, 3])).toEqual([2, 0, 3]);
    for (const value of [frame, frame.origin, frame.u, frame.v, frame.normal, frame.precision]) expect(Object.isFrozen(value)).toBe(true);
  });
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])(
    'preserves the existing %s principal origin, handedness and signed offset',
    (basePlane) => {
      const actual = resolveCadWorldDatum(
        {
          ...datum,
          definition: {
            kind: 'world',
            basePlane,
            origin: [0, 0, 0],
            rotation: [0, 0, 0],
          },
        },
        {},
      );
      expect(actual).toEqual(cadPrincipalFrame(basePlane));
      const placement = resolveCadSketchPlacement({ ...sketch, plane: basePlane }, parameters);
      expect(placement.offsetMm).toBe(-3);
      expect(placement.datumId).toBeNull();
    },
  );
  it('normalizes whole turns before trig, supports parameter angles and never snaps near cardinal angles', () => {
    const numeric = resolveCadWorldDatum({ ...datum, definition: { ...datum.definition, rotation: [0, 0, 1e9] } }, {});
    const expression = resolveCadWorldDatum(
      {
        ...datum,
        definition: { ...datum.definition, rotation: [0, 0, 'angle'] },
      },
      { angle: 280 },
    );
    expect(numeric).toEqual(expression);
    const nearCardinal = resolveCadWorldDatum(
      {
        ...datum,
        definition: { ...datum.definition, rotation: [89.9999, 0, 0] },
      },
      {},
    );
    expect(nearCardinal.normal[2]).toBeGreaterThan(1e-6);
    expect(nearCardinal.precision.angularUncertainty).toBeGreaterThan(0);
    const frame = resolveCadWorldDatum(datum, {});
    near([Math.hypot(...frame.u), Math.hypot(...frame.v), Math.hypot(...frame.normal)], [1, 1, 1]);
    const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);
    near([dot(frame.u, frame.v), dot(frame.u, frame.normal), dot(frame.v, frame.normal)], [0, 0, 0]);
  });
  it('rejects extra attachment fields, nonfinite expressions and accessors without executing them', () => {
    for (const changed of [
      { ...datum, normal: [0, 0, 1] },
      {
        ...datum,
        definition: { ...datum.definition, origin: [0, 0, Infinity] },
      },
      { ...datum, definition: { ...datum.definition, kind: 'planar-face' } },
    ])
      expect(() => resolveCadWorldDatum(changed as CadDatumPlaneFeature, {})).toThrow(CadError);
    let reads = 0;
    const getter = { ...datum };
    Object.defineProperty(getter, 'definition', {
      get() {
        reads++;
        return datum.definition;
      },
    });
    code(() => resolveCadWorldDatum(getter, {}), 'invalid-datum-plane');
    expect(reads).toBe(0);
    code(
      () =>
        resolveCadWorldDatum(
          {
            ...datum,
            definition: { ...datum.definition, rotation: ['unknown', 0, 0] },
          },
          {},
        ),
      'unknown-parameter',
    );
  });
  it('bounds tilted circles and signed major arcs by true world extrema rather than two local corners', () => {
    const frame = resolveCadWorldDatum(
      {
        ...datum,
        definition: {
          kind: 'world',
          basePlane: 'XY',
          origin: [0, 0, 0],
          rotation: [0, 0, 45],
        },
      },
      {},
    );
    const circle = cadFrameEntityBounds([{ type: 'circle', layer: 'CAD', center: { x: 0, y: 0 }, radius: 5 }], frame, 3);
    near(circle.min, [-5, -5, 3]);
    near(circle.max, [5, 5, 3]);
    const placement = resolveCadSketchPlacement(curve, parameters, prepareCadDatumFrames([datum], parameters));
    const resolved = resolveCadCurve(curve, parameters, prepareCadDatumFrames([datum], parameters));
    const entities = resolved.entities;
    expect(entities).toHaveLength(1);
    // Every sampled point must lie in independently computed analytic bounds.
    for (let index = 0; index <= 270; index++) {
      const angle = (-index * Math.PI) / 180;
      const point = cadFramePointToWorld(placement.frame, placement.offsetMm, [2 * Math.cos(angle), 2 * Math.sin(angle)]);
      point.forEach((value, axis) => {
        expect(value).toBeGreaterThanOrEqual(resolved.worldBounds.min[axis] - 1e-13);
        expect(value).toBeLessThanOrEqual(resolved.worldBounds.max[axis] + 1e-13);
      });
    }
    expect(
      cadFrameEntityBounds(
        [
          {
            type: 'line',
            layer: 'CAD',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
          },
        ],
        frame,
        0,
      ).max[0],
    ).toBe(0);
  });
  it('separates local Curve geometry from placement and rejects inconsistent explicit placement', () => {
    const local = resolveCadCurveGeometry(curve, parameters);
    expect(local.length).toBeCloseTo(3 * Math.PI, 13);
    expect(local).not.toHaveProperty('worldBounds');
    expect(local.plane).toEqual(plane);
    const lookup = prepareCadDatumFrames([datum], parameters);
    const placement = resolveCadSketchPlacement(curve, parameters, lookup);
    expect(placeCadCurveGeometry(local, placement)).toEqual(resolveCadCurve(curve, parameters, lookup));
    code(() => placeCadCurveGeometry(local, { ...placement, offsetMm: 0 }), 'invalid-curve-placement');
    code(
      () =>
        placeCadCurveGeometry(local, {
          ...placement,
          plane: 'XY',
          datumId: null,
        }),
      'invalid-curve-placement',
    );
    const principal = resolveCadCurveGeometry({ ...curve, plane: 'XY' }, parameters);
    code(
      () =>
        placeCadCurveGeometry(principal, {
          ...placement,
          plane: 'XY',
          datumId: null,
        }),
      'invalid-curve-placement',
    );
  });
  it('encloses mapped circles and endpoint-bounded arcs when large world and local coordinates cancel', () => {
    for (const radius of [0.2, 0.7]) {
      const frame = resolveCadWorldDatum(
        {
          ...datum,
          definition: {
            kind: 'world',
            basePlane: 'XY',
            origin: [1e8, 0, 0],
            rotation: [0, 0, 0],
          },
        },
        {},
      );
      const bounds = cadFrameEntityBounds([{ type: 'circle', layer: 'CAD', center: { x: -1e8, y: 0 }, radius }], frame, 0);
      const extremum = cadFramePointToWorld(frame, 0, [-1e8 + radius, 0]);
      expect(extremum[0]).toBeLessThanOrEqual(bounds.max[0]);
    }
    const angle = (37 * Math.PI) / 180;
    const frame = resolveCadWorldDatum(
      {
        ...datum,
        definition: {
          kind: 'world',
          basePlane: 'XY',
          origin: [1e8 * Math.cos(angle), 1e8 * Math.sin(angle), 0],
          rotation: [0, 0, 37],
        },
      },
      {},
    );
    const start = -angle + 0.0001;
    const sweep = 0.0001;
    const point = (a: number) => ({
      x: -1e8 + 0.2 * Math.cos(a),
      y: 0.2 * Math.sin(a),
    });
    const entity = {
      type: 'arc' as const,
      layer: 'CAD',
      clockwise: false,
      center: { x: -1e8, y: 0 },
      radius: 0.2,
      startAngle: start,
      endAngle: start + sweep,
      sweepRadians: sweep,
      start: point(start),
      end: point(start + sweep),
    };
    const bounds = cadFrameEntityBounds([entity], frame, 0);
    const lineBounds = cadFrameEntityBounds([{ type: 'line', layer: 'CAD', start: entity.start, end: entity.end }], frame, 0);
    for (let index = 0; index <= 100; index++) {
      const local = point(start + (sweep * index) / 100);
      const world = cadFramePointToWorld(frame, 0, [local.x, local.y]);
      world.forEach((value, axis) => {
        expect(value).toBeGreaterThanOrEqual(bounds.min[axis]);
        expect(value).toBeLessThanOrEqual(bounds.max[axis]);
      });
      const fraction = index / 100;
      const chord = cadFramePointToWorld(frame, 0, [
        entity.start.x + (entity.end.x - entity.start.x) * fraction,
        entity.start.y + (entity.end.y - entity.start.y) * fraction,
      ]);
      chord.forEach((value, axis) => {
        expect(value).toBeGreaterThanOrEqual(lineBounds.min[axis]);
        expect(value).toBeLessThanOrEqual(lineBounds.max[axis]);
      });
    }
  });
});

describe('datum document history, measurement and native support guards', () => {
  it('publishes immutable cached lookups only for accepted snapshots and never observes later caller mutation', () => {
    const accepted = document();
    const lookup = prepareCadDocumentFrames(accepted);
    expect(prepareCadDocumentFrames(accepted)).toBe(lookup);
    expect(Object.isFrozen(lookup)).toBe(true);
    expect(lookup.get('tilt')).toEqual(resolveCadWorldDatum(datum, parameters));
    expect(lookup.get('section')).toBeUndefined();
    const mutable = structuredClone(accepted);
    const earlier = prepareCadDocumentFrames(mutable);
    const feature = mutable.features[0];
    if (feature.kind !== 'datum-plane') throw new Error('Datum missing');
    Object.assign(feature.definition, { origin: [0, 0, 0] });
    expect(earlier.get('tilt')?.origin).toEqual([37, -24, 11]);
    expect(prepareCadDocumentFrames(mutable).get('tilt')?.origin).toEqual([0, 0, 0]);
  });
  it('has non-consuming datum dependencies, preserves all local source bytes and evaluates changed dimensions atomically', () => {
    const source = {
      format: 'dxf',
      fileName: 'Exact.dxf',
      text: '\uFEFForiginal\r\n名称',
      units: 'mm',
    } as const;
    const accepted = document([datum, { ...sketch, source }, curve, pad]);
    expect(cadFeatureInputs(sketch)).toMatchObject({
      datumIds: ['tilt'],
      bodyIds: [],
    });
    expect(cadFeatureDependencies(sketch)).toEqual(['tilt']);
    expect(cadFeatureProducesBody(datum)).toBe(false);
    expect(cadVisibleBodyIds(accepted.features)).toEqual(['pad']);
    const changed = applyCadEdits(accepted, [
      {
        kind: 'update-feature',
        feature: {
          ...datum,
          definition: { ...datum.definition, rotation: ['tilt', 0, 0] },
        },
      },
      { kind: 'set-parameter', name: 'tilt', value: 90 },
      { kind: 'set-parameter', name: 'station', value: 4 },
    ]);
    expect(measureCadSketch(changed, 'section')).toMatchObject({
      plane,
      offsetMm: 4,
      frame: { normal: [0, -1, 0] },
    });
    expect(measureCadCurve(changed, 'rail')).toMatchObject({
      plane,
      offsetMm: 4,
      placementDiagnostic: null,
    });
    expect(changed.features[1]).toMatchObject({
      source,
      profiles: sketch.profiles,
    });
    expect(accepted.parameters.station).toBe(-3);
    code(() => applyCadEdits(changed, [{ kind: 'remove-parameter', name: 'tilt' }]), 'unknown-parameter');
    const principal = document([{ ...sketch, plane: 'XY' }]);
    expect(cadSketchToDxf(accepted, 'section')).toBe(cadSketchToDxf(principal, 'section'));
  });
  it('rejects missing/later/non-datum and nonbody inputs, and protects cascading deletion/reordering', () => {
    code(() => document([sketch, datum]), 'invalid-reference');
    code(() => document([{ ...sketch, plane: { kind: 'datum-plane', featureId: 'absent' } }]), 'invalid-reference');
    code(
      () =>
        document([
          { ...sketch, plane: 'XY' },
          { ...curve, plane: { kind: 'datum-plane', featureId: 'section' } },
        ]),
      'invalid-reference',
    );
    code(() => document([datum, { ...sketch, plane: 'XY' }, { ...pad, operation: 'join', targetId: 'tilt' }]), 'invalid-reference');
    const accepted = document();
    code(() => applyCadEdits(accepted, [{ kind: 'delete-feature', featureId: 'tilt', cascade: false }]), 'dependent-feature');
    expect(applyCadEdits(accepted, [{ kind: 'delete-feature', featureId: 'tilt', cascade: true }]).features).toEqual([]);
    code(() => applyCadEdits(accepted, [{ kind: 'move-feature', featureId: 'tilt', beforeId: null }]), 'invalid-reference');
  });
  it('allows explicit suppressed repair and local Curve metrics without fabricating an active world placement', () => {
    const accepted = document();
    code(() => applyCadEdits(accepted, [{ kind: 'update-feature', feature: { ...datum, suppressed: true } }]), 'unavailable-datum-plane');
    const suppressed = document([
      { ...datum, suppressed: true },
      { ...sketch, suppressed: true },
      { ...curve, suppressed: true },
      { ...pad, suppressed: true },
    ]);
    expect(prepareCadDocumentFrames(suppressed).get('tilt')).toBeUndefined();
    expect(measureCadCurve(suppressed, 'rail')).toMatchObject({
      lengthMm: 3 * Math.PI,
      frame: null,
      startWorldMm: null,
      worldBoundsMm: null,
      placementDiagnostic: { code: 'unavailable-datum-plane' },
    });
    expect(measureCadSketch(suppressed, 'section').frame).toBeNull();
    code(() => applyCadEdits(suppressed, [{ kind: 'update-feature', feature: curve }]), 'unavailable-datum-plane');
    expect(
      applyCadEdits(
        suppressed,
        [datum, sketch, curve, pad].map((feature) => ({
          kind: 'update-feature',
          feature,
        })),
      ).features,
    ).toEqual(accepted.features);
    code(
      () =>
        document([
          {
            ...datum,
            suppressed: true,
            definition: { ...datum.definition, rotation: ['bad', 0, 0] },
          },
        ]),
      'unknown-parameter',
    );
  });
  it('rejects unsupported datum consumers during parser preflight and keeps suppressed history repairable', () => {
    const last: CadSketchFeature = { ...sketch, id: 'last', offset: 10 };
    const target = { ...pad, sketchId: 'principal' };
    const principal = { ...sketch, id: 'principal', plane: 'YZ' as const };
    const consumers: readonly CadFeature[] = [
      {
        kind: 'sweep',
        id: 'operation',
        name: 'Sweep',
        suppressed: false,
        sketchId: 'principal',
        curveId: 'rail',
        operation: 'new',
        targetId: null,
      },
      {
        kind: 'pocket',
        id: 'operation',
        name: 'Pocket',
        suppressed: false,
        sketchId: 'section',
        targetId: 'pad',
        extent: { kind: 'through-all', direction: 'both' },
      },
    ];
    for (const operation of consumers) {
      const prefix = [datum, sketch, last, curve, principal, target];
      code(() => document([...prefix, operation]), 'unsupported-datum-operation');
      expect(document([...prefix, { ...operation, suppressed: true }]).features.at(-1)?.suppressed).toBe(true);
    }
  });
  it('guards actual world placed origins and signed/symmetric native travel while leaving legacy principal preflight unchanged', () => {
    const lookup = prepareCadDatumFrames([datum], parameters);
    expect(resolveCadExtrudeRevolvePlacement(pad, sketch, parameters, lookup).offsetMm).toBe(-3);
    const distant = {
      ...datum,
      definition: {
        ...datum.definition,
        origin: [0, 0, 3e6] as const,
        rotation: [0, 0, 0] as const,
      },
    };
    const raised = { ...sketch, offset: 3e6 };
    const small = { ...pad, distance: 1, symmetric: false };
    code(
      () => resolveCadExtrudeRevolvePlacement(small, raised, parameters, prepareCadDatumFrames([distant], parameters)),
      'unsupported-datum-precision',
    );
    code(() => document([distant, raised, small]), 'unsupported-datum-precision');
    expect(document([{ ...raised, plane: 'XY' }, small]).features).toHaveLength(2);
    const far = {
      ...datum,
      definition: { ...datum.definition, origin: [1e8, 0, 0] as const },
    };
    const references = document([far, sketch, curve]);
    expect(measureCadCurve(references, 'rail').worldBoundsMm).not.toBeNull();
    code(() => document([far, sketch, pad]), 'unsupported-datum-precision');
  });
});

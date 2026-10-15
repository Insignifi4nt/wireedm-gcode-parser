import { describe, expect, it } from 'vitest';
import type { CadCurveFeature, CadDatumPlaneFeature, CadDocument, CadFeature, CadPlane, CadSketchFeature, CadSweepFeature } from '../cadDocument';
import { CadError } from '../cadError';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { cadFramePointToWorld, prepareCadDatumFrames, resolveCadWorldDatum } from '../cadDatumPlanes';
import { inspectCadSweepInputs, resolveCadSweepInputs } from '../cadSweep';

const sweep: CadSweepFeature = { kind: 'sweep', id: 'sweep', name: 'Sweep', suppressed: false, sketchId: 'section', curveId: 'rail', operation: 'new', targetId: null };
const datum = (id: string, basePlane: CadPlane, rotation: readonly [number, number, number] = [23, -37, 61]): CadDatumPlaneFeature => ({ kind: 'datum-plane', id, name: id, suppressed: false,
  definition: { kind: 'world', basePlane, origin: [37, -24, 11], rotation } });
const circle = (x = 0, y = 0): CadSketchFeature['profiles'] => [{ id: 'profile', name: 'Profile', construction: false, geometry: { kind: 'circle', x, y, radius: 1 } }];
const map = (features: readonly CadFeature[]) => new Map(features.map(feature => [feature.id, feature]));
function accepted(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Placed Sweep', 'cad_placed_sweep'), features, parameters });
}
function fixtures(basePlane: CadPlane = 'XY'): readonly CadFeature[] {
  // The chosen section bases have normal parallel to the first local +u rail tangent.
  const sectionPlane = basePlane === 'XY' || basePlane === 'XZ' ? 'YZ' : 'XZ';
  const railPlane = datum('rail_plane', basePlane); const profilePlane = datum('section_plane', sectionPlane);
  const section: CadSketchFeature = { kind: 'sketch', id: 'section', name: 'Section', suppressed: false,
    plane: { kind: 'datum-plane', featureId: 'section_plane' }, offset: 0, profiles: circle() };
  const rail: CadCurveFeature = { kind: 'curve', id: 'rail', name: 'Rail', suppressed: false,
    plane: { kind: 'datum-plane', featureId: 'rail_plane' }, offset: 0,
    segments: [{ kind: 'line', start: [0, 0], end: [5, 0] }, { kind: 'arc', center: [5, 5], radius: 5, startAngle: -90, sweep: 90 }] };
  return [railPlane, profilePlane, section, rail];
}

describe('datum Sweep source placement and precision', () => {
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('preserves %s rail frame, source position and either normal direction', basePlane => {
    const features = fixtures(basePlane); const document = accepted([...features, sweep]);
    const result = resolveCadSweepInputs(sweep, map(document.features), {}, prepareCadDatumFrames(document.features, {}));
    expect(result.placement.legacyPrincipal).toBe(false);
    result.placement.anchorInSectionMm.forEach(value => expect(value).toBeCloseTo(0, 13));
    expect(result.placement.planeResidualMm).toBeLessThan(1e-13);
    expect(result.placement.tangentResidual).toBeLessThan(1e-13);
    expect(result.clearance.transportUncertaintyMm).toBeLessThan(1e-7);
    expect(result.frame.binormal).toEqual(result.curve.frame.normal);
    expect(result.section.sketch).toEqual(features[2]);
    expect(result.curveFeature).toEqual(features[3]);
    expect(Object.isFrozen(result.placement.anchorInSectionMm)).toBe(true);
    if (basePlane === 'YZ') expect(result.section.placement.frame.normal.reduce((sum, value, index) => sum + value * result.frame.tangent[index], 0)).toBeCloseTo(-1, 13);
  });
  it('retains arbitrary authored section roll and an off-center profile rather than matching bases or relocating it', () => {
    const features = fixtures().map(feature => feature.kind === 'datum-plane' && feature.id === 'section_plane'
      ? { ...feature, definition: { ...feature.definition, rotation: [113, -37, 61] as const } }
      : feature.kind === 'sketch' ? { ...feature, profiles: circle(2) } : feature);
    const result = resolveCadSweepInputs(sweep, map(features), {});
    expect(result.clearance.profileRadiusMm).toBeCloseTo(3, 12);
    expect(result.section.placement.frame.u).not.toEqual(result.curve.frame.u);
    expect(result.placement.anchorInSectionMm).toEqual([0, 0]);
  });
  it('resolves independent section/rail signed offsets in their actual tilted frames', () => {
    const features = fixtures().map(feature => feature.kind === 'sketch' ? { ...feature, offset: 3, profiles: circle(2, 7) }
      : feature.kind === 'curve' ? { ...feature, offset: 7, segments: [{ kind: 'line' as const, start: [3, 2] as const, end: [8, 2] as const }] } : feature);
    const result = resolveCadSweepInputs(sweep, map(features), {});
    expect(result.placement.anchorInSectionMm[0]).toBeCloseTo(2, 12);
    expect(result.placement.anchorInSectionMm[1]).toBeCloseTo(7, 12);
    expect(result.clearance.profileRadiusMm).toBeCloseTo(1, 12);
    const source = features[0];
    if (source.kind !== 'datum-plane') throw new Error('Missing datum');
    expect(result.curve.startWorld).toEqual(cadFramePointToWorld(resolveCadWorldDatum(source, {}), 7, [3, 2]));
  });
  it('supports mixed principal/datum sources without guessing a section plane', () => {
    const features = fixtures().map(feature => feature.kind === 'datum-plane' ? { ...feature, definition: { ...feature.definition, origin: [0, 0, 0] as const, rotation: [0, 0, 0] as const } }
      : feature.kind === 'sketch' ? { ...feature, plane: 'YZ' as const } : feature);
    expect(resolveCadSweepInputs(sweep, map(features), {}).placement.legacyPrincipal).toBe(false);
    const invalid = features.map(feature => feature.kind === 'sketch' ? { ...feature, offset: 2 } : feature);
    expect(inspectCadSweepInputs(sweep, map(invalid), {})).toMatchObject({ eligible: false, code: 'unsupported-sweep-placement' });
    const diagnostic = inspectCadSweepInputs(sweep, map(invalid), {});
    if (diagnostic.eligible) throw new Error('Expected placement diagnostic');
    expect(diagnostic.message).toContain('Curve starts at');
    expect(diagnostic.message).not.toContain('principal sketch plane');
  });
  it('counts actual world native scale at every transport step and keeps far references independently valid', () => {
    const features = fixtures().map(feature => feature.kind === 'datum-plane' ? { ...feature, definition: { ...feature.definition, origin: [1e6, 0, 0] as const, rotation: [0, 0, 0] as const } }
      : feature.kind === 'curve' ? { ...feature, segments: [{ kind: 'line' as const, start: [0, 0] as const, end: [1, 0] as const }] } : feature);
    expect(inspectCadSweepInputs(sweep, map(features), {})).toMatchObject({ eligible: true });
    const many = features.map(feature => feature.kind === 'curve' ? { ...feature, segments: Array.from({ length: 64 }, (_, index) => ({ kind: 'line' as const,
      start: [index, 0] as const, end: [index + 1, 0] as const })) } : feature);
    expect(accepted(many).features).toHaveLength(4);
    expect(inspectCadSweepInputs(sweep, map(many), {})).toMatchObject({ eligible: false, code: 'unsupported-sweep-precision' });
    const far = features.map(feature => feature.kind === 'datum-plane' ? { ...feature, definition: { ...feature.definition, origin: [1e8, 0, 0] as const } } : feature);
    expect(accepted(far).features).toHaveLength(4);
    expect(inspectCadSweepInputs(sweep, map(far), {})).toMatchObject({ eligible: false, code: 'unsupported-sweep-precision' });
  });
  it('adds accepted Curve joint gaps to transport uncertainty instead of repairing the chain', () => {
    const features = fixtures().map(feature => feature.kind === 'datum-plane' ? { ...feature, definition: { ...feature.definition, origin: [0, 0, 0] as const, rotation: [0, 0, 0] as const } }
      : feature.kind === 'sketch' ? { ...feature, offset: 1e5 } : feature);
    const rail = features.find(feature => feature.kind === 'curve');
    if (rail?.kind !== 'curve') throw new Error('Missing rail');
    const chain = (gap: number) => ({ ...rail, segments: Array.from({ length: 64 }, (_, index) => ({ kind: 'line' as const,
      start: [1e5 + index + index * gap, 0] as const, end: [1e5 + index + 1 + index * gap, 0] as const })) });
    const replace = (gap: number) => features.map(feature => feature.kind === 'curve' ? chain(gap) : feature);
    expect(inspectCadSweepInputs(sweep, map(replace(0)), {})).toMatchObject({ eligible: true });
    const gapped = replace(1e-10);
    expect(accepted(gapped).features).toHaveLength(4);
    expect(inspectCadSweepInputs(sweep, map(gapped), {})).toMatchObject({ eligible: false, code: 'unsupported-sweep-precision' });
  });
  it('preserves atomic expression edits, prefix references and suppression repair', () => {
    const features = fixtures().map(feature => feature.kind === 'datum-plane' && feature.id === 'section_plane'
      ? { ...feature, definition: { ...feature.definition, rotation: ['roll', -37, 61] as const } } : feature);
    const document = accepted([...features, sweep], { roll: 23 });
    const rotated = applyCadEdits(document, [{ kind: 'set-parameter', name: 'roll', value: 113 }]);
    expect(rotated.features).toEqual(document.features);
    const section = document.features.find(feature => feature.kind === 'sketch');
    if (section?.kind !== 'sketch') throw new Error('Missing section');
    expect(() => applyCadEdits(document, [{ kind: 'update-feature', feature: { ...section, offset: 1 } }])).toThrow(CadError);
    expect(document.features).toEqual(features.concat(sweep));
    const suppressed = applyCadEdits(document, [{ kind: 'update-feature', feature: { ...sweep, suppressed: true } },
      { kind: 'update-feature', feature: { ...section, offset: 1 } }]);
    expect(() => applyCadEdits(suppressed, [{ kind: 'update-feature', feature: sweep }])).toThrow(CadError);
    expect(suppressed.features.at(-1)?.suppressed).toBe(true);
    expect(() => applyCadEdits(document, [{ kind: 'move-feature', featureId: 'rail_plane', beforeId: null }])).toThrow(CadError);
    expect(() => applyCadEdits(document, [{ kind: 'delete-feature', featureId: 'section_plane', cascade: false }])).toThrow(CadError);
    expect(applyCadEdits(document, [{ kind: 'delete-feature', featureId: 'section_plane', cascade: true }]).features.map(feature => feature.id)).not.toContain('sweep');
  });
  it('reserves actual swept section supports beyond rotated rail endpoint coordinates', () => {
    const features = fixtures().map(feature => feature.kind === 'datum-plane'
      ? { ...feature, definition: { ...feature.definition, origin: [0, 0, 0] as const, rotation: [0, 0, 45] as const } }
      : feature.kind === 'sketch' ? { ...feature, profiles: [{ id: 'profile', name: 'Profile', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 4 } }] }
      : feature.kind === 'curve' ? { ...feature, segments: [{ kind: 'line' as const, start: [0, 0] as const, end: [20, 0] as const }] } : feature);
    const result = resolveCadSweepInputs(sweep, map(features), {});
    const endpointCoordinateScale = Math.max(...result.curve.endWorld.map(Math.abs));
    let actualSupportScale = 0;
    for (let index = 0; index < 360; index++) {
      const angle = index * Math.PI / 180;
      const point = cadFramePointToWorld(result.curve.frame, 4 * Math.sin(angle), [20, 4 * Math.cos(angle)]);
      actualSupportScale = Math.max(actualSupportScale, ...point.map(Math.abs));
    }
    expect(actualSupportScale).toBeGreaterThan(endpointCoordinateScale + 2);
    expect(actualSupportScale).toBeLessThanOrEqual(result.placement.worldScaleMm);
  });
  it('reserves rail angular uncertainty about an off-anchor section, beyond small rail coordinates', () => {
    const gimbal: CadDatumPlaneFeature = { ...datum('rail_plane', 'YZ', [37, 90, 37]), definition: { kind: 'world', basePlane: 'YZ', origin: [0, 0, 0], rotation: [37, 90, 37] } };
    const section: CadSketchFeature = { kind: 'sketch', id: 'section', name: 'Off-anchor', suppressed: false, plane: 'YZ', offset: 0, profiles: circle(1.5e6) };
    const rail: CadCurveFeature = { kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: { kind: 'datum-plane', featureId: 'rail_plane' }, offset: 0,
      segments: [{ kind: 'line', start: [0, 0], end: [0, 1] }] };
    const inspection = inspectCadSweepInputs(sweep, map([gimbal, section, rail]), {});
    expect(inspection).toMatchObject({ eligible: false, code: 'unsupported-sweep-precision' });
  });
});

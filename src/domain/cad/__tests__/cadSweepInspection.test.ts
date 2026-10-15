import { describe, expect, it } from 'vitest';
import type { CadCurveFeature, CadDocument, CadFeature, CadSketchFeature } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { inspectCadSweep } from '../cadSweepInspection';

const section: CadSketchFeature = { kind: 'sketch', id: 'section', name: 'Section', suppressed: false, plane: 'YZ', offset: 0,
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } }] };
const rail: CadCurveFeature = { kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: 'XY', offset: 0,
  segments: [{ kind: 'line', start: [0, 0], end: [20, 0] },
    { kind: 'arc', center: [20, 10], radius: 10, startAngle: -90, sweep: 90 },
    { kind: 'line', start: [30, 10], end: [30, 30] }] };
const document = (features: readonly CadFeature[]): CadDocument => parseCadDocument({
  ...createCadDocument('Sweep preflight', 'cad_sweep_inspection'), features,
});

describe('bounded Sweep placement inspection', () => {
  it('keeps principal source placement and native build requirements explicit', () => {
    const input = document([section, rail]);
    const result = inspectCadSweep(input, 'section', 'rail');
    expect(result).toMatchObject({ eligible: true, scope: 'new-feature-at-end', units: 'mm', nativeBuildRequired: true,
      transport: 'fixed-binormal', nativeWork: 3,
      section: { plane: 'YZ', offsetMm: 0, edgeCount: 1, originWorldMm: [0, 0, 0], normalWorld: [1, 0, 0] },
      curve: { plane: 'XY', offsetMm: 0, segmentCount: 3, startWorldMm: [0, 0, 0], endWorldMm: [30, 30, 0],
        startTangentWorld: [1, 0, 0], lengthMm: expect.closeTo(40 + 5 * Math.PI, 10) } });
    expect(Object.isFrozen(result)).toBe(true);
    if (!result.eligible) throw new Error('Expected eligible Sweep');
    expect(Object.isFrozen(result.section)).toBe(true); expect(Object.isFrozen(result.curve)).toBe(true);
    expect(input.features).toEqual([section, rail]);
  });
  it('returns authored datum origins and world directions without changing placement', () => {
    const ref = (featureId: string) => ({ kind: 'datum-plane' as const, featureId });
    const datums: CadFeature[] = [
      { kind: 'datum-plane', id: 'section_plane', name: 'Section plane', suppressed: false,
        definition: { kind: 'world', basePlane: 'YZ', origin: [30, -20, 12], rotation: [30, 0, 15] } },
      { kind: 'datum-plane', id: 'rail_plane', name: 'Rail plane', suppressed: false,
        definition: { kind: 'world', basePlane: 'XY', origin: [30, -20, 12], rotation: [30, 0, 15] } },
    ];
    const sources = [ ...datums, { ...section, plane: ref('section_plane') }, { ...rail, plane: ref('rail_plane') } ];
    const input = document(sources); const result = inspectCadSweep(input, 'section', 'rail');
    expect(result).toMatchObject({ eligible: true,
      section: { plane: ref('section_plane'), originWorldMm: [30, -20, 12], normalWorld: [expect.closeTo(Math.cos(Math.PI / 12), 12), expect.closeTo(Math.sin(Math.PI / 12), 12), 0] },
      curve: { plane: ref('rail_plane'), startWorldMm: [30, -20, 12], lengthMm: expect.closeTo(40 + 5 * Math.PI, 10) } });
    if (!result.eligible) throw new Error('Expected eligible datum Sweep');
    expect(result.curve.startTangentWorld).toEqual(result.section.normalWorld);
    expect(result.clearance.transportUncertaintyMm).toBeGreaterThan(0);
    const misplaced = document([...datums, { ...section, plane: ref('section_plane'), offset: 3 }, { ...rail, plane: ref('rail_plane') }]);
    expect(inspectCadSweep(misplaced, 'section', 'rail')).toMatchObject({ eligible: false, code: 'unsupported-sweep-placement' });
    expect(input.features).toEqual(sources);
  });
  it('bounds receipts independently from source files and returns repair diagnostics', () => {
    const source = { format: 'dxf' as const, fileName: 'rail.dxf', units: 'mm' as const,
      text: '\uFEFF999\r\n' + 'Original source '.repeat(90_000) + '\r\n0\r\nEOF\r\n' };
    const input = document([section, { ...rail, source }]);
    const result = inspectCadSweep(input, 'section', 'rail');
    expect(result).toMatchObject({ eligible: true });
    const json = JSON.stringify(result);
    expect(json.length).toBeLessThan(2048); expect(json).not.toContain('Original source'); expect(json).not.toContain('segments');
    expect(inspectCadSweep(input, 'missing', 'rail')).toMatchObject({ eligible: false, code: 'invalid-reference' });
    expect(inspectCadSweep(document([{ ...section, suppressed: true }, rail]), 'section', 'rail'))
      .toMatchObject({ eligible: false, code: 'suppressed-sketch' });
    expect(input.features[1]).toMatchObject({ source });
  });
  it('rejects malformed direct-call selections without coercion', () => {
    const input = document([section, rail]);
    for (const id of ['', 'bad id', 'x'.repeat(97)]) {
      expect(() => inspectCadSweep(input, id, 'rail')).toThrow(expect.objectContaining({ code: 'invalid-sweep-selection' }));
      expect(() => inspectCadSweep(input, 'section', id)).toThrow(expect.objectContaining({ code: 'invalid-sweep-selection' }));
    }
  });
});

import { describe, expect, it } from 'vitest';
import type { CadDocument, CadFeature, CadSketchFeature } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { inspectCadLoft } from '../cadLoftInspection';

const sketch = (id: string, offset: number, plane: CadSketchFeature['plane'] = 'XY'): CadSketchFeature => ({
  kind: 'sketch', id, name: id, suppressed: false, plane, offset,
  profiles: [{ id: `${id}_profile`, name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 4 } }],
});
const document = (features: readonly CadFeature[]): CadDocument => parseCadDocument({ ...createCadDocument('Loft inspection', 'cad_inspect_loft'), features });

describe('bounded ordered Loft preflight', () => {
  it('retains principal station semantics and authored order without a native build', () => {
    const input = document([sketch('lower', -4, 'XZ'), sketch('upper', 8, 'XZ')]);
    const receipt = inspectCadLoft(input, ['upper', 'lower']);
    expect(receipt).toMatchObject({ eligible: true, units: 'mm', scope: 'new-feature-at-end', nativeBuildRequired: true,
      stationOrigin: 'principal-origin', commonFrame: { origin: [0, 0, 0], normal: [0, -1, 0] },
      sections: [{ sketchId: 'upper', offsetMm: 8, stationMm: 8, tangentialOffsetMm: [0, 0] },
        { sketchId: 'lower', offsetMm: -4, stationMm: -4, tangentialOffsetMm: [0, 0] }] });
    expect(Object.isFrozen(receipt)).toBe(true);
    if (!receipt.eligible) throw new Error('Expected eligible sections');
    expect(Object.isFrozen(receipt.sections)).toBe(true); expect(Object.isFrozen(receipt.sections[0])).toBe(true);
    expect(input.features.map(feature => feature.id)).toEqual(['lower', 'upper']);
  });
  it('reports datum station and tangential origins independently from authored offsets', () => {
    const input = document([
      { kind: 'datum-plane', id: 'start_plane', name: 'Start plane', suppressed: false,
        definition: { kind: 'world', basePlane: 'XY', origin: [10, -20, 30], rotation: [90, 0, 0] } },
      { kind: 'datum-plane', id: 'end_plane', name: 'End plane', suppressed: false,
        definition: { kind: 'world', basePlane: 'XY', origin: [13, -30, 35], rotation: [90, 0, 0] } },
      sketch('first', 2, { kind: 'datum-plane', featureId: 'start_plane' }),
      sketch('last', 4, { kind: 'datum-plane', featureId: 'end_plane' }),
    ]);
    expect(inspectCadLoft(input, ['first', 'last'])).toMatchObject({ eligible: true,
      stationOrigin: 'first-placed-section', commonFrame: { origin: [10, -22, 30], normal: [0, -1, 0] },
      sections: [{ sketchId: 'first', offsetMm: 2, stationMm: 0, tangentialOffsetMm: [0, 0] },
        { sketchId: 'last', offsetMm: 4, stationMm: 12, tangentialOffsetMm: [3, 5] }] });
  });
  it('returns repair diagnostics without copying original source text or local profiles', () => {
    const original = '999\n' + 'Preserved original '.repeat(80_000) + '\n0\nEOF\n';
    const first: CadSketchFeature = { ...sketch('first', 0), source: { format: 'dxf', fileName: 'section.dxf', units: 'mm', text: original } };
    const input = document([first, sketch('last', 10), sketch('fold', 5), { ...sketch('suppressed', 20), suppressed: true }]);
    const receipt = inspectCadLoft(input, ['first', 'last']);
    expect(receipt).toMatchObject({ eligible: true });
    const json = JSON.stringify(receipt);
    expect(json.length).toBeLessThan(2048); expect(json).not.toContain('Preserved original'); expect(json).not.toContain('profiles');
    expect(inspectCadLoft(input, ['first', 'last', 'fold'])).toMatchObject({ eligible: false, code: 'invalid-loft-order' });
    expect(inspectCadLoft(input, ['first', 'suppressed'])).toMatchObject({ eligible: false, code: 'suppressed-sketch' });
    expect(inspectCadLoft(input, ['first', 'missing'])).toMatchObject({ eligible: false, code: 'invalid-reference' });
    expect(input.features[0]).toEqual(first);
  });
  it('bounds direct-call input and detaches its requested ID list', () => {
    const input = document([sketch('first', 0), sketch('last', 10)]); const ids = ['first', 'last'];
    const receipt = inspectCadLoft(input, ids); ids.reverse();
    expect(receipt.sketchIds).toEqual(['first', 'last']); expect(Object.isFrozen(receipt.sketchIds)).toBe(true);
    for (const invalid of [[], ['first'], Array.from({ length: 17 }, (_, i) => `section_${i}`), ['first', 'bad id']]) {
      expect(() => inspectCadLoft(input, invalid)).toThrow(expect.objectContaining({ code: 'invalid-loft-selection' }));
    }
    let reads = 0; const accessor = ['first', 'last'];
    Object.defineProperty(accessor, '1', { get() { reads++; return 'last'; } });
    expect(() => inspectCadLoft(input, accessor)).toThrow(expect.objectContaining({ code: 'invalid-loft-selection' }));
    expect(reads).toBe(0);
  });
});

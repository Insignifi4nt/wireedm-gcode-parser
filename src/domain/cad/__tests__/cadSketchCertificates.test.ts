import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature, CadSketchFeature } from '../cadDocument';
import { createCadDocument, hasValidCadSketchGeometry, parseCadDocument } from '../cadSchema';
import { resolveCadSketchRegions, validateCadSketchGeometry } from '../cadSketchGeometry';

vi.mock('../cadSketchGeometry', async importOriginal => {
  const original = await importOriginal<typeof import('../cadSketchGeometry')>();
  return { ...original, validateCadSketchGeometry: vi.fn(original.validateCadSketchGeometry), resolveCadSketchRegions: vi.fn(original.resolveCadSketchRegions) };
});
const validated = vi.mocked(validateCadSketchGeometry), resolved = vi.mocked(resolveCadSketchRegions);
/** How often the parse checked the sketch with this id: its geometry, or its regions for an extrude. */
const checks = (mock: typeof validated | typeof resolved, id: string) => mock.mock.calls.filter(([sketch]) => sketch.id === id).length;

type Outcome = { readonly document: CadDocument } | { readonly error: { readonly name: string; readonly code: unknown; readonly message: string } };
function parse(input: unknown): Outcome {
  try { return { document: parseCadDocument(input) }; }
  catch (error) { return { error: { name: (error as Error).name, code: (error as { code?: unknown }).code, message: (error as Error).message } }; }
}
const base = (id: string) => ({ id, name: id, suppressed: false });
/** A plate whose width reads `w`, extruded by `depth`, and a boss sketch that reads no parameter. */
function part(parameters: Record<string, number>): CadDocument {
  return parseCadDocument({ ...createCadDocument('Certificates', 'certificates'), parameters, features: [
    { ...base('plate_sketch'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [
      { id: 'outline', name: 'Outline', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 'w', height: 30, cornerRadius: 0 } }] },
    { ...base('plate'), kind: 'extrude', sketchId: 'plate_sketch', distance: 'depth', symmetric: false, operation: 'new', targetId: null },
    { ...base('boss_sketch'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [
      { id: 'boss', name: 'Boss', construction: false, geometry: { kind: 'circle', x: 100, y: 0, radius: 5 } }] }
  ] as unknown as CadFeature[] });
}
const sketchOf = (document: CadDocument, id: string) => document.features.find((feature): feature is CadSketchFeature => feature.id === id && feature.kind === 'sketch')!;

describe('certificates of accepted sketch checks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('skip the geometry and region checks while the values a sketch reads stay the same', () => {
    const first = part({ w: 40, depth: 8 });
    expect(checks(validated, 'plate_sketch')).toBe(1);
    expect(checks(resolved, 'plate_sketch')).toBe(1);
    vi.clearAllMocks();
    // Other parameters, including the extrude's own distance, are not read by the sketches.
    const next = parseCadDocument({ ...first, name: 'Next', parameters: { w: 40, depth: 9, unused: 1 } });
    expect(validated).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
    next.features.forEach((feature, index) => expect(feature).toBe(first.features[index]));
    const plate = sketchOf(next, 'plate_sketch');
    expect(hasValidCadSketchGeometry(plate, next.parameters)).toBe(true);
    expect(hasValidCadSketchGeometry(plate, { ...next.parameters, w: 41 })).toBe(false);
    expect(hasValidCadSketchGeometry(plate, {})).toBe(false);
  });

  it('check again when a value the sketch reads changes, keep no failure, and reach the full outcome', () => {
    const first = part({ w: 40, depth: 8 });
    // The rectangle needs a positive width, so 0 is rejected however often it is tried.
    for (const [w, geometry, accepted] of [[50, 1, true], [0, 1, false], [0, 1, false], [50, 0, true]] as const) {
      vi.clearAllMocks();
      const input = { ...first, parameters: { ...first.parameters, w } }, outcome = parse(input);
      expect([w, checks(validated, 'plate_sketch'), checks(resolved, 'plate_sketch')]).toStrictEqual([w, geometry, accepted ? geometry : 0]);
      expect(checks(validated, 'boss_sketch')).toBe(0);
      expect('document' in outcome).toBe(accepted);
      expect(outcome).toStrictEqual(parse(structuredClone(input)));
    }
  });

  it('keep nothing from a parse that fails after the checks passed', () => {
    const first = part({ w: 40, depth: 8 }), wider = { ...first, parameters: { ...first.parameters, w: 60 } };
    vi.clearAllMocks();
    expect(() => parseCadDocument({ ...wider, features: [...wider.features, { ...first.features[1], id: 'flat', distance: 0 }] }))
      .toThrow('Extrusion distance must be nonzero and within one million millimetres.');
    expect(checks(validated, 'plate_sketch')).toBe(1);
    parseCadDocument(wider);
    expect(checks(validated, 'plate_sketch')).toBe(2);
    expect(checks(resolved, 'plate_sketch')).toBe(3);
  });

  it('never trust a lookalike sketch, and tie an extrude to the sketch object it was checked with', () => {
    const first = part({ w: 40, depth: 8 }), [plate, extrude, boss] = first.features;
    const lookalike = structuredClone(plate) as CadSketchFeature;
    expect(hasValidCadSketchGeometry(lookalike, first.parameters)).toBe(false);
    vi.clearAllMocks();
    const copied = parseCadDocument({ ...first, features: [lookalike, extrude, boss] });
    // The copy is checked in full, and so is the accepted extrude, whose sketch is now another object.
    expect([checks(validated, 'plate_sketch'), checks(resolved, 'plate_sketch'), checks(validated, 'boss_sketch')]).toStrictEqual([1, 1, 0]);
    expect(copied.features[0]).not.toBe(lookalike);
    vi.clearAllMocks();
    parseCadDocument({ ...copied, name: 'Again' });
    expect(validated).not.toHaveBeenCalled();
    expect(resolved).not.toHaveBeenCalled();
  });
});

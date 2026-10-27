// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDatumPlaneFeature, CadDocument, CadFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { createCadBenchmarkDependentDragPreview, createCadBenchmarkDragPreview } from './benchmark/cadBenchmarkCases';
import { prepareCadEdits } from './cadEditPreparation';
import { prepareCadViewportReferences, type CadViewportReference } from './cadViewportReferences';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const prepare = (document: CadDocument) => prepareCadViewportReferences(document.features, document.parameters);
/** The same preparation from copies the parser never accepted, so it never uses a kept result. */
const fresh = (features: readonly CadFeature[], parameters: Readonly<Record<string, number>>) => prepareCadViewportReferences(structuredClone(features), { ...parameters });
const of = (references: readonly CadViewportReference[], featureId: string) => references.filter(reference => reference.featureId === featureId);
/** Sketch references only: datum glyphs are rebuilt on every preparation. */
const sketches = (references: readonly CadViewportReference[]) => references.filter(reference => reference.featureKind === 'sketch');
const same = (left: readonly CadViewportReference[], right: readonly CadViewportReference[]) => left.length === right.length && left.every((reference, index) => reference === right[index]);
function outcome(prepare: () => readonly CadViewportReference[]) {
  try { return { references: prepare() }; }
  catch (error) { return { error: { name: (error as Error).name, code: (error as { code?: unknown }).code, message: (error as Error).message } }; }
}

const mount: CadDatumPlaneFeature = { id: 'mount', name: 'Mount', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 10], rotation: [0, 0, 45] } };
/** A plate that reads `w` and is lifted by `lift`, and a boss on a datum plane whose circle reads `far`. */
function part(parameters: Record<string, number>): CadDocument {
  const base = (id: string) => ({ id, name: id, suppressed: false });
  return parseCadDocument({ ...createCadDocument('Reference cache', 'reference_cache'), parameters, features: [mount,
    { ...base('plate'), kind: 'sketch', plane: 'XY', offset: 'lift', profiles: [
      { id: 'outline', name: 'Outline', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 'w', height: 30, cornerRadius: 0 } }] },
    { ...base('boss'), kind: 'sketch', plane: { kind: 'datum-plane', featureId: 'mount' }, offset: 0, profiles: [
      { id: 'hole', name: 'Hole', construction: false, geometry: { kind: 'circle', x: 'far', y: 'far', radius: 2 } }] }
  ] as unknown as CadFeature[] });
}
const values = { w: 40, lift: 2, far: 5, other: 1 };

describe('viewport references of unchanged accepted sketches', () => {
  it('keeps the references of the sketches an edit leaves unchanged and rebuilds the edited one', async () => {
    const { document, edit } = createCadBenchmarkDragPreview(4, 2, true), before = prepare(document);
    const { document: after } = await prepareCadEdits(document, [edit], createCadSketchTestSolver());
    const references = prepare(after);
    expect(references).toEqual(fresh(after.features, after.parameters));
    for (const id of ['sketch_1', 'sketch_2', 'sketch_3']) {
      expect(of(references, id).length).toBeGreaterThan(0);
      expect(same(of(references, id), of(before, id))).toBe(true);
    }
    expect(of(references, 'sketch_0').every((reference, index) => reference !== of(before, 'sketch_0')[index])).toBe(true);
  });

  it('rebuilds a sketch that uses another sketch whenever an edit gives it a new feature', async () => {
    const { document, referencedEdit, unreferencedEdit } = createCadBenchmarkDependentDragPreview(2), before = prepare(document);
    for (const edit of [unreferencedEdit, referencedEdit]) {
      const { document: after } = await prepareCadEdits(document, [edit], createCadSketchTestSolver());
      const references = prepare(after);
      expect(references).toEqual(fresh(after.features, after.parameters));
      expect(same(of(references, 'sketch_1'), of(before, 'sketch_1'))).toBe(after.features[1] === document.features[1]);
    }
  });

  it('rebuilds a sketch when a value it reads or its placement changes, and only then', () => {
    const first = part(values), initial = prepare(first);
    const revise = (parameters: Record<string, number>, features = first.features) => parseCadDocument({ ...first, parameters, features });
    const cases: [string, CadDocument, readonly string[]][] = [
      ['an unread parameter', revise({ ...values, other: 2 }), []],
      ['the plate width', revise({ ...values, w: 50 }), ['plate']],
      ['the plate offset', revise({ ...values, lift: 3 }), ['plate']],
      ['the boss position', revise({ ...values, far: 6 }), ['boss']],
      ['the datum frame', revise(values, [{ ...mount, definition: { ...mount.definition, origin: [0, 0, 12] } } as CadDatumPlaneFeature, ...first.features.slice(1)]), ['boss']]
    ];
    for (const [change, document, rebuilt] of cases) {
      const references = prepare(document);
      expect(references, change).toEqual(fresh(document.features, document.parameters));
      expect(document.features.slice(1).every((feature, index) => feature === first.features[index + 1]), change).toBe(true);
      for (const id of ['plate', 'boss']) {
        expect(of(references, id).length, change).toBeGreaterThan(0);
        expect(same(of(references, id), of(initial, id)), `${change}: ${id}`).toBe(!rebuilt.includes(id));
      }
      // Back to the first values: what was kept for them is used again.
      expect(same(sketches(prepare(first)), sketches(initial)), change).toBe(true);
    }
  });

  it('shows nothing for a sketch on a suppressed datum and its kept references once the datum is back', () => {
    const document = part(values), initial = prepare(document), [, plate, boss] = document.features;
    const suppressed = [{ ...mount, suppressed: true }, plate, boss], references = prepareCadViewportReferences(suppressed, document.parameters);
    expect(references).toEqual(fresh(suppressed, document.parameters));
    expect(of(references, 'boss')).toEqual([]);
    expect(same(of(references, 'plate'), of(initial, 'plate'))).toBe(true);
    expect(same(sketches(prepare(document)), sketches(initial))).toBe(true);
  });

  it('reads accessor parameters on every preparation and never keeps what they gave', () => {
    // Without the datum, which itself requires own data parameters.
    const document = parseCadDocument({ ...part(values), features: part(values).features.slice(1, 2) }), initial = prepare(document);
    let width = 40;
    const parameters = { lift: 2, far: 5, other: 1, get w() { return width; } };
    const first = prepareCadViewportReferences(document.features, parameters);
    width = 55;
    const second = prepareCadViewportReferences(document.features, parameters);
    expect(first).toEqual(initial);
    expect(second).toEqual(fresh(document.features, { ...values, w: 55 }));
    expect(of(second, 'plate')).not.toEqual(of(first, 'plate'));
    // The kept references of the first values are still there.
    expect(same(prepare(document), initial)).toBe(true);
  });

  it('drops a sketch that cannot be placed in the world as before, and still finds its other kept values', () => {
    const document = part(values), initial = prepare(document), huge = { ...values, far: 1.5e308 };
    const kept = outcome(() => prepareCadViewportReferences(document.features, huge));
    expect(kept).toEqual(outcome(() => fresh(document.features, huge)));
    expect(kept.references && of(kept.references, 'boss')).toEqual([]);
    expect(same(sketches(prepare(document)), sketches(initial))).toBe(true);
  });

  it('holds the sketches of the last two preparations that kept any', async () => {
    const { document, edit } = createCadBenchmarkDragPreview(2, 1), base = prepare(document);
    const { document: preview } = await prepareCadEdits(document, [edit], createCadSketchTestSolver()), shown = prepare(preview);
    // Switching between a preview and its document keeps both.
    expect(same(prepare(document), base)).toBe(true);
    expect(same(prepare(preview), shown)).toBe(true);
    // A preparation without sketches leaves them alone.
    expect(prepareCadViewportReferences([], {})).toEqual([]);
    expect(same(prepare(preview), shown)).toBe(true);
    // Two other documents with sketches replace them.
    prepare(createCadBenchmarkDragPreview(1, 1).document); prepare(createCadBenchmarkDragPreview(1, 1).document);
    const again = prepare(preview);
    expect(again).toEqual(shown);
    expect(again.every((reference, index) => reference !== shown[index])).toBe(true);
  });

  it('never keeps references of sketches the parser did not accept', () => {
    const document = part(values), copies = structuredClone(document.features) as CadFeature[];
    const first = prepareCadViewportReferences(copies, document.parameters);
    (copies[1] as { -readonly [K in keyof CadSketchFeature]: CadSketchFeature[K] }).name = 'Renamed plate';
    const second = prepareCadViewportReferences(copies, document.parameters);
    expect(of(second, 'plate').every(reference => reference.name === 'Renamed plate')).toBe(true);
    expect(of(first, 'plate').every(reference => reference.name === 'plate')).toBe(true);
  });
});

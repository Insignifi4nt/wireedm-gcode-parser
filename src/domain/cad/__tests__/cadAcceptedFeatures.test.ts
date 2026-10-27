import { describe, expect, it } from 'vitest';
import type { CadDocument, CadFeature } from '../cadDocument';
import { CadDocumentSchema, CadFeatureSchema, createCadDocument, isAcceptedCadSketchSource, parseCadDocument } from '../cadSchema';
import { createCadBenchmarkDependentDragPreview, createCadBenchmarkDragPreview, createCadKernelBenchmarkCases } from '@/features/cad/benchmark/cadBenchmarkCases';
import { circleReferencePart, lineReferencePart } from './cadSketchExternalReferenceFixtures';
import { pad, part, refs, sketch, stock } from './cadSketchRegionFixtures';

type Outcome = { readonly document: CadDocument } | { readonly error: { readonly name: string; readonly code: unknown; readonly message: string } };
function parse(input: unknown): Outcome {
  try { return { document: parseCadDocument(input) }; }
  catch (error) { return { error: { name: (error as Error).name, code: (error as { code?: unknown }).code, message: (error as Error).message } }; }
}
const deeplyFrozen = (value: unknown): boolean => value === null || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);

/** Parses `input` as it is and as a structured clone, which reuses no accepted feature, and expects one outcome. */
function expectFullParseOutcome(input: object): Outcome {
  const reference = parse(structuredClone(input)), outcome = parse(input);
  expect(outcome).toStrictEqual(reference);
  if ('document' in outcome) expect(deeplyFrozen(outcome.document)).toBe(true);
  return outcome;
}

const base = (id: string) => ({ id, name: id, suppressed: false });
const disc = (id: string, x: number, y: number, radius: number | string) => ({ id, name: id, construction: false, geometry: { kind: 'circle', x, y, radius } });
const outline = (id: string, x: number, y: number, width: number, height: number) =>
  ({ id, name: id, construction: false, geometry: { kind: 'rectangle', x, y, width, height, cornerRadius: 0 } });
/** A datum plane, a curve and most body features, with expressions read from the document's parameters. */
function manyKinds(): CadDocument {
  return parseCadDocument({ ...createCadDocument('Many kinds', 'many_kinds'), parameters: { station: -3, radius: 2, thickness: 8 }, features: [
    { ...base('tilt'), kind: 'datum-plane', definition: { kind: 'world', basePlane: 'XY', origin: [37, -24, 11], rotation: [23, -37, 61] } },
    { ...base('section'), kind: 'sketch', plane: { kind: 'datum-plane', featureId: 'tilt' }, offset: 'station', profiles: [disc('disc', 2, 3, 'radius')] },
    { ...base('rail'), kind: 'curve', plane: 'XY', offset: 0, segments: [{ kind: 'line', start: [0, 0], end: [0, 40] }] },
    { ...base('plate_sketch'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [outline('plate_outline', 100, 0, 40, 30)] },
    { ...base('plate'), kind: 'extrude', sketchId: 'plate_sketch', distance: 'thickness', symmetric: false, operation: 'new', targetId: null },
    { ...base('edges'), kind: 'chamfer', targetId: 'plate', radius: 1 },
    { ...base('moved'), kind: 'transform', sourceId: 'edges', translation: [0, 50, 0], rotation: [0, 0, 0] },
    { ...base('mirrored'), kind: 'mirror', sourceId: 'moved', plane: 'XZ' },
    { ...base('first'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [disc('first_circle', 300, 0, 5)] },
    { ...base('last'), kind: 'sketch', plane: 'XY', offset: 10, profiles: [disc('last_circle', 300, 0, 3)] },
    { ...base('loft'), kind: 'loft', sketchIds: ['first', 'last'], ruled: false, operation: 'new', targetId: null },
    { ...base('ring'), kind: 'circular-pattern', sourceId: 'loft', count: 3, axis: 'z', center: [0, 0, 0], angle: 360 },
    { ...base('lathe_sketch'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [outline('lathe_outline', 5, 500, 4, 10)] },
    { ...base('lathe'), kind: 'revolve', sketchId: 'lathe_sketch', angle: 180, axis: 'y', operation: 'new', targetId: null }
  ] as unknown as CadFeature[] });
}

function corpus(): readonly (readonly [string, CadDocument])[] {
  return [
    ...createCadKernelBenchmarkCases().flatMap(kernelCase => kernelCase.steps.map(step => [`${kernelCase.id} ${step.label}`, step.document] as const)),
    ['independent graph sketches', createCadBenchmarkDragPreview(3, 2).document],
    ['a used edge', createCadBenchmarkDependentDragPreview(2).document],
    ['a used line with a midpoint and a consumer', lineReferencePart(true, true)],
    ['a used circle', circleReferencePart(true)],
    ['DXF regions', parseCadDocument(part([...stock(), sketch(), pad([refs.outer])]))],
    ['many kinds', manyKinds()]
  ];
}

const without = <T,>(items: readonly T[], index: number) => [...items.slice(0, index), ...items.slice(index + 1)];
const replaced = <T,>(items: readonly T[], index: number, item: T) => items.map((other, at) => at === index ? item : other);
/** Documents listing the accepted features of `accepted`, alone or beside changed copies, with an envelope that may no longer hold them. */
function variants(accepted: CadDocument): readonly (readonly [string, object])[] {
  const { features, parameters } = accepted;
  return [
    ['as it is', { ...accepted, features: [...features] }],
    ['renamed', { ...accepted, name: 'Renamed part' }],
    ['with a reserved id', { ...accepted, id: 'con' }],
    ['with an unknown field', { ...accepted, extra: true }],
    ['at schema 1', { ...accepted, schemaVersion: 1 }],
    ['reversed', { ...accepted, features: [...features].reverse() }],
    ['with every other feature copied', { ...accepted, features: features.map((feature, index) => index % 2 ? structuredClone(feature) : feature) }],
    ...Object.keys(parameters).flatMap(name => [
      [`without ${name}`, { ...accepted, parameters: Object.fromEntries(Object.entries(parameters).filter(([other]) => other !== name)) }],
      [`with ${name} changed`, { ...accepted, parameters: { ...parameters, [name]: parameters[name] + 1.5 } }]
    ] as const),
    ...features.flatMap((feature, index) => [
      [`without ${feature.id}`, { ...accepted, features: without(features, index) }],
      [`with ${feature.id} twice`, { ...accepted, features: [...features.slice(0, index + 1), ...features.slice(index)] }],
      [`with ${feature.id} last`, { ...accepted, features: [...without(features, index), feature] }],
      [`with ${feature.id} suppressed`, { ...accepted, features: replaced(features, index, { ...feature, suppressed: !feature.suppressed }) }],
      [`with ${feature.id} renamed`, { ...accepted, features: replaced(features, index, { ...feature, id: `${feature.id}_copy` }) }],
      [`with an unknown field on ${feature.id}`, { ...accepted, features: replaced(features, index, { ...feature, extra: 1 }) }],
      [`with ${feature.id} repeated`, { ...accepted, features: [...features, ...Array.from({ length: 12 }, (_, copy) => ({ ...feature, id: `${feature.id}_${copy}` }))] }]
    ] as const)
  ];
}

describe('accepted CAD features in a new document', () => {
  it('reach the outcome a full parse reaches, for every document and every change around them', () => {
    let accepted = 0, rejected = 0;
    for (const [label, document] of corpus()) {
      for (const [change, input] of variants(document)) {
        const outcome = expectFullParseOutcome(input);
        if ('document' in outcome) accepted++; else rejected++;
        if (change === 'as it is' && 'document' in outcome) {
          expect(outcome.document, label).not.toBe(input);
          outcome.document.features.forEach((feature, index) => expect(feature, `${label} ${feature.id}`).toBe(document.features[index]));
        }
      }
    }
    // Both outcomes are reached often, so the comparison is not vacuous.
    expect(accepted).toBeGreaterThan(150);
    expect(rejected).toBeGreaterThan(150);
  });

  it('keep their identity, their accepted graphs and their accepted sketch sources', () => {
    const source = lineReferencePart(true, true), next = parseCadDocument({ ...source, name: 'Next' });
    expect(next).not.toBe(source);
    next.features.forEach((feature, index) => expect(feature).toBe(source.features[index]));
    const plate = next.features.find(feature => feature.id === 'plate');
    expect(plate?.kind === 'sketch' && isAcceptedCadSketchSource(plate)).toBe(true);
  });

  it('are told apart from frozen and cloned lookalikes, which cross the whole boundary', () => {
    const source = lineReferencePart(true, true), [layout] = source.features;
    const freeze = (value: unknown): unknown => { if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
    const lookalike = freeze(structuredClone(layout)) as CadFeature;
    const parsed = parseCadDocument({ ...source, features: [lookalike, ...source.features.slice(1)] });
    expect(parsed.features[0]).toStrictEqual(layout);
    expect(parsed.features[0]).not.toBe(lookalike);
    expect(lookalike.kind === 'sketch' && isAcceptedCadSketchSource(lookalike)).toBe(false);
    const forged = freeze({ ...structuredClone(layout), extra: 1 });
    expect(() => parseCadDocument({ ...source, features: [forged, ...source.features.slice(1)] })).toThrow(/^Invalid CAD document at \/features\/0/);
  });

  it('do not let accessors, inherited fields or cycles around them through', () => {
    const source = lineReferencePart(true, true), incomplete = 'CAD documents must contain their own complete JSON data fields.';
    let reads = 0;
    const getter = { ...source, features: [...source.features] };
    Object.defineProperty(getter, 'name', { enumerable: true, get: () => { reads++; return 'Read'; } });
    expect(() => parseCadDocument(getter)).toThrow(incomplete);
    const listed = [...source.features];
    Object.defineProperty(listed, 0, { enumerable: true, get: () => { reads++; return source.features[0]; } });
    expect(() => parseCadDocument({ ...source, features: listed })).toThrow(incomplete);
    expect(reads).toBe(0);
    expect(() => parseCadDocument(Object.assign(Object.create({ name: 'Inherited' }), { ...source, features: [...source.features] }))).toThrow(incomplete);
    const cyclic = { ...source, features: [...source.features] as unknown[] };
    cyclic.features.push(cyclic);
    expect('error' in expectFullParseOutcome(cyclic)).toBe(true);
    // Copies keep what they share, and one copy listed twice is still a duplicate.
    const shared = { ...source.features[0], id: 'shared' };
    expect('document' in expectFullParseOutcome({ ...source, features: [...source.features, shared, { ...shared, id: 'shared_too' }] })).toBe(true);
    expect('error' in expectFullParseOutcome({ ...source, features: [...source.features, shared, shared] })).toBe(true);
  });

  // A list with accepted features is read once through descriptors and copied around them, so a
  // transparent proxy there is copied. Without one, the whole input is structured-cloned as before.
  it('copy a transparent proxy around them, which a document without them still rejects', () => {
    const source = lineReferencePart(true, true), portable = 'CAD document must contain portable declarative data.';
    expect(parseCadDocument(new Proxy({ ...source, features: [...source.features] }, {}))).toStrictEqual(source);
    expect(parseCadDocument({ ...source, features: new Proxy([...source.features], {}) })).toStrictEqual(source);
    expect(() => parseCadDocument(new Proxy(structuredClone(source), {}))).toThrow(portable);
    // The schema reads through `get` and the copy through descriptors, so a proxy cannot show them two documents.
    const twoFaced = new Proxy({ ...source, features: [...source.features] }, { get: (target, key) => key === 'name' ? 'Shown' : Reflect.get(target, key) });
    expect(() => parseCadDocument(Object.defineProperty(twoFaced, 'name', { value: 42, enumerable: true, configurable: true, writable: true })))
      .toThrow('CAD document must contain its own complete JSON fields.');
  });

  it('skip only the feature schema, which the document list adds nothing to', () => {
    const list = CadDocumentSchema.properties.features;
    expect(list.items).toBe(CadFeatureSchema);
    expect(Object.keys(list).sort()).toEqual(['items', 'type']);
  });
});

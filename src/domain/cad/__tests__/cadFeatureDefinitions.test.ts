import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Static } from '@sinclair/typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CadFeature, CadSketchFeature } from '../cadDocument';
import { cadConsumedBodyIds, cadFeatureInputs, cadVisibleBodyIds, type CadFeatureInputs } from '../cadFeatureInputs';
import { mapCadFeatureScalars } from '../cadParameters';
import type { CadFeatureKind, CadFeatureTrait, CadStoredFeatureOf } from '../features/cadFeatureDefinitionTypes';
import { cadFeatureDefinition, cadFeatureDefinitions, cadFeatureKinds, cadFeatureLayout, cadFeatureSchemaUnion, findCadFeatureDefinition } from '../features/cadFeatureRegistry';
import { lineReferencePart } from './cadSketchExternalReferenceFixtures';

type Definitions = ReturnType<typeof cadFeatureDefinitions>;

describe('feature definitions', () => {
  it('declare every kind once, and the stored shapes are features of their kind', () => {
    // Checked when the suite is type-checked: a kind without a definition, or a schema that stores a shape its kind's
    // feature type does not allow, fails the build.
    expectTypeOf<keyof Definitions>().toEqualTypeOf<CadFeatureKind>();
    expectTypeOf<Static<ReturnType<typeof cadFeatureSchemaUnion>>['kind']>().toEqualTypeOf<CadFeatureKind>();
    type Unstorable = { [K in CadFeatureKind]: Static<Definitions[K]['schema']> extends CadStoredFeatureOf<K> ? never : K }[CadFeatureKind];
    expectTypeOf<Unstorable>().toBeNever();
    type Misnamed = { [K in CadFeatureKind]: Definitions[K]['kind'] extends K ? never : K }[CadFeatureKind];
    expectTypeOf<Misnamed>().toBeNever();

    const kinds = cadFeatureKinds();
    expect(new Set(kinds).size).toBe(17);
    for (const kind of kinds) {
      const definition = cadFeatureDefinition(kind);
      expect(definition.kind).toBe(kind);
      expect(findCadFeatureDefinition(kind)).toBe(definition);
      expect(definition.schema.properties.kind).toBeDefined();
    }
    expect(findCadFeatureDefinition('hole')).toBeUndefined();
    expect(findCadFeatureDefinition(undefined)).toBeUndefined();
    // Fillet and chamfer share one stored shape.
    expect(cadFeatureSchemaUnion().anyOf).toHaveLength(16);
  });

  it('name each id-holding field as a slot of the trait its features must give', () => {
    const given = new Set<CadFeatureTrait>(cadFeatureKinds().flatMap(kind => cadFeatureDefinition(kind).outputs));
    for (const kind of cadFeatureKinds()) {
      const { schema, fields, outputs, body } = cadFeatureDefinition(kind);
      expect(Object.keys(fields).every(name => name in schema.properties), kind).toBe(true);
      for (const { name, meaning } of cadFeatureLayout({ kind }).slots) {
        expect(given.has(meaning.accepts[0]), `${kind}.${name}`).toBe(true);
        if (meaning.count === 'optional') expect(fields[name].condition ?? name === 'plane', `${kind}.${name}`).toBeTruthy();
      }
      expect(outputs.includes('body')).toBe(body !== 'none');
    }
  });

  it('give forms that bind declared fields', () => {
    for (const kind of cadFeatureKinds()) {
      const { form, fields } = cadFeatureDefinition(kind);
      if (form.editor !== 'fields') continue;
      for (const control of form.controls) {
        if (control.control === 'part') continue;
        const field = fields[control.field];
        expect(field, `${kind}.${control.field}`).toBeDefined();
        if (control.control === 'choice' || control.control === 'operation') expect(field.choices?.length, `${kind}.${control.field}`).toBeGreaterThan(1);
        if (control.control === 'count') expect(field.scalar?.integer, `${kind}.${control.field}`).toBe(true);
        if (control.control === 'scalar' || control.control === 'vector') expect(field.scalar?.components, `${kind}.${control.field}`).toBe(control.control === 'vector' ? 3 : undefined);
        if (control.control === 'body') expect(field.slot?.accepts, `${kind}.${control.field}`).toEqual(['body']);
        if (control.control === 'operation') expect(fields[control.target].condition?.field, `${kind}.${control.target}`).toBe(control.field);
      }
    }
  });

  it('declare diagnostic codes the application raises', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf8' })
      .split('\n').filter(file => /\.tsx?$/.test(file) && !/(__tests__|\.test\.)/.test(file));
    const raised = new Set<string>();
    for (const file of files) for (const match of readFileSync(path.join(root, file), 'utf8').matchAll(/CadError\(\s*'([a-z-]+)'/g)) raised.add(match[1]);
    for (const kind of cadFeatureKinds()) {
      const declared = cadFeatureDefinition(kind).diagnostics;
      expect(new Set(declared).size, kind).toBe(declared.length);
      expect(declared.filter(code => !raised.has(code)), kind).toEqual([]);
    }
  });
});

const base = { name: 'Feature', suppressed: false };
const feature = (id: string, kind: CadFeatureKind, fields: Record<string, unknown>) => ({ id, kind, ...base, ...fields }) as unknown as CadFeature;
const world = { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [0, 0, 0] };
const onDatum = { kind: 'datum-plane' as const, featureId: 'datum' };
const linkedSketch = lineReferencePart(true).features.find((entry): entry is CadSketchFeature => entry.id === 'plate' && entry.kind === 'sketch')!;

/** One feature of each kind, with the inputs its slots name. */
const cases: readonly { readonly feature: CadFeature; readonly inputs: Partial<CadFeatureInputs>; readonly consumed?: readonly string[] }[] = [
  { feature: feature('datum', 'datum-plane', { definition: world }), inputs: {} },
  { feature: feature('curve', 'curve', { plane: onDatum, offset: 0, segments: [] }), inputs: { datumIds: ['datum'] } },
  { feature: feature('origin-curve', 'curve', { plane: 'XZ', offset: 0, segments: [] }), inputs: {} },
  { feature: { ...linkedSketch, plane: onDatum }, inputs: { sketchIds: ['layout'], datumIds: ['datum'] } },
  { feature: feature('imported', 'imported', { source: {} }), inputs: {} },
  { feature: feature('pad', 'extrude', { sketchId: 'profile', distance: 5, symmetric: false, operation: 'new', targetId: null }), inputs: { sketchIds: ['profile'] } },
  { feature: feature('boss', 'extrude', { sketchId: 'profile', distance: 5, symmetric: false, operation: 'join', targetId: 'stock' }),
    inputs: { sketchIds: ['profile'], bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('pocket', 'pocket', { sketchId: 'profile', targetId: 'stock', extent: { kind: 'through-all', direction: 'both' } }),
    inputs: { sketchIds: ['profile'], bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('turn', 'revolve', { sketchId: 'profile', angle: 90, axis: 'x', operation: 'cut', targetId: 'stock' }),
    inputs: { sketchIds: ['profile'], bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('loft', 'loft', { sketchIds: ['top', 'bottom', 'middle'], ruled: false, operation: 'new', targetId: null }), inputs: { sketchIds: ['top', 'bottom', 'middle'] } },
  { feature: feature('sweep', 'sweep', { sketchId: 'profile', curveId: 'rail', operation: 'join', targetId: 'stock' }),
    inputs: { sketchIds: ['profile'], curveIds: ['rail'], bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('fillet', 'fillet', { targetId: 'stock', radius: 1 }), inputs: { bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('chamfer', 'chamfer', { targetId: 'stock', radius: 1, selection: null }), inputs: { bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('shell', 'shell', { targetId: 'stock', thickness: 1, opening: {} }), inputs: { bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('boolean', 'boolean', { targetId: 'stock', toolId: 'tool', operation: 'cut' }), inputs: { bodyIds: ['stock', 'tool'] }, consumed: ['stock', 'tool'] },
  { feature: feature('move', 'transform', { sourceId: 'stock', translation: [0, 0, 0], rotation: [0, 0, 0] }), inputs: { bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('row', 'linear-pattern', { sourceId: 'stock', count: 2, spacing: [1, 0, 0] }), inputs: { bodyIds: ['stock'] }, consumed: ['stock'] },
  { feature: feature('ring', 'circular-pattern', { sourceId: 'stock', count: 2, axis: 'z', center: [0, 0, 0], angle: 360 }), inputs: { bodyIds: ['stock'] }, consumed: ['stock'] },
  // The source stays beside its mirrored copy.
  { feature: feature('mirror', 'mirror', { sourceId: 'stock', plane: 'XY' }), inputs: { bodyIds: ['stock'] } }
];

describe('feature inputs', () => {
  it('cover every kind', () => {
    expect(new Set(cases.map(entry => entry.feature.kind))).toEqual(new Set(cadFeatureKinds()));
  });

  it.each(cases.map(entry => [entry.feature.id, entry] as const))('reads %s inputs from its slots', (_id, { feature: subject, inputs, consumed = [] }) => {
    expect(cadFeatureInputs(subject)).toEqual({ sketchIds: [], curveIds: [], bodyIds: [], datumIds: [], ...inputs });
    expect(cadConsumedBodyIds(subject, { parameters: {} })).toEqual(consumed);
    expect(cadConsumedBodyIds({ ...subject, suppressed: true }, { parameters: {} })).toEqual([]);
  });

  it('keep each body until a feature replaces it, and an inactive feature replaces none', () => {
    const stock = feature('stock', 'imported', { source: {} }), tool = feature('tool', 'imported', { source: {} });
    const cut = feature('boolean', 'boolean', { targetId: 'stock', toolId: 'tool', operation: 'cut' });
    const mirrored = feature('mirror', 'mirror', { sourceId: 'boolean', plane: 'XY' });
    expect(cadVisibleBodyIds([stock, tool, cut, mirrored], { parameters: {} })).toEqual(['boolean', 'mirror']);
    expect(cadVisibleBodyIds([stock, tool, { ...cut, suppressed: true }], { parameters: {} })).toEqual(['stock', 'tool']);
  });

  it('map exactly the expression-bearing scalars, leaving literal counts', () => {
    const paths = (subject: CadFeature) => { const seen: string[] = []; mapCadFeatureScalars(subject, (value, at) => { seen.push(at); return value; }); return seen; };
    expect(paths(cases.find(entry => entry.feature.kind === 'circular-pattern')!.feature)).toEqual(['center.0', 'center.1', 'center.2', 'angle']);
    expect(paths(cases.find(entry => entry.feature.kind === 'transform')!.feature)).toEqual(['translation.0', 'translation.1', 'translation.2', 'rotation.0', 'rotation.1', 'rotation.2']);
    expect(paths(cases.find(entry => entry.feature.kind === 'boolean')!.feature)).toEqual([]);
  });
});

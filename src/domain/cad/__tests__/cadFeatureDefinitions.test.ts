import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Static } from '@sinclair/typebox';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CadFeature, CadSketchFeature } from '../cadDocument';
import { cadConsumedBodyIds, cadFeatureInputs, cadVisibleBodyIds, type CadFeatureInputs } from '../cadFeatureInputs';
import { mapCadFeatureScalars } from '../cadParameters';
import type { CadFeatureKind, CadFeatureTrait, CadStoredFeatureOf } from '../features/cadFeatureDefinitionTypes';
import { CAD_FEATURE_PRESENTATION, cadFeaturePresentation } from '../features/cadFeaturePresentation';
import { cadFeatureDefinition, cadFeatureDefinitions, cadFeatureKinds, cadFeatureLayout, cadFeatureSchemaUnion, findCadFeatureDefinition } from '../features/cadFeatureRegistry';
import { lineReferencePart } from './cadSketchExternalReferenceFixtures';

type Definitions = ReturnType<typeof cadFeatureDefinitions>;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The source files `entry` loads at run time: its value imports, re-exports and dynamic imports within `src`, followed to the end. */
function loadedModules(entry: string): ReadonlySet<string> {
  const seen = new Set<string>(), queue = [entry];
  const resolve = (from: string, specifier: string) => {
    const bare = specifier.split('?')[0];
    const base = bare.startsWith('@/') ? `src/${bare.slice(2)}` : bare.startsWith('.') ? path.posix.join(path.posix.dirname(from), bare) : undefined;
    return base && ['.ts', '.tsx', '/index.ts', '/index.tsx', ''].map(ending => base + ending).find(candidate => /.tsx?$/.test(candidate) && fs.existsSync(path.join(root, candidate)));
  };
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      let specifier: ts.Expression | undefined;
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const named = node.importClause?.namedBindings;
        const typesOnly = node.importClause && !node.importClause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly);
        if (!typesOnly) specifier = node.moduleSpecifier;
      } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0];
      const resolved = specifier && ts.isStringLiteral(specifier) ? resolve(file, specifier.text) : undefined;
      if (resolved) queue.push(resolved);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return seen;
}

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

  it('present every kind apart from its definition, and the kernel worker loads only definitions', () => {
    // Checked when the suite is type-checked: a kind without a presentation, or a form control bound to a field its kind does not
    // store, fails the build.
    expectTypeOf<keyof typeof CAD_FEATURE_PRESENTATION>().toEqualTypeOf<CadFeatureKind>();
    type Unbound = { [K in CadFeatureKind]: (typeof CAD_FEATURE_PRESENTATION)[K]['form'] extends { readonly controls: readonly (infer C)[] }
      ? C extends { readonly field: infer F } ? F extends keyof CadStoredFeatureOf<K> ? never : K : never : never }[CadFeatureKind];
    expectTypeOf<Unbound>().toBeNever();
    expect(Object.keys(CAD_FEATURE_PRESENTATION)).toEqual(cadFeatureKinds());
    expect(cadFeaturePresentation('sketch').agent.authoringSchema).toBeDefined();

    const worker = loadedModules('src/features/cad/kernel/cadKernel.worker.ts');
    expect(worker.has('src/domain/cad/features/cadFeatureRegistry.ts')).toBe(true);
    expect(worker.has('src/domain/cad/features/cadFeaturePresentation.ts')).toBe(false);
  });

  it('give forms that bind declared fields', () => {
    for (const kind of cadFeatureKinds()) {
      const { fields } = cadFeatureDefinition(kind), { form } = cadFeaturePresentation(kind);
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

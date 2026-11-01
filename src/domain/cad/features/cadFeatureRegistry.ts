import { Type } from '@sinclair/typebox';
import type { CadFeature } from '../cadDocument';
import type { CadAnyFeatureDefinition, CadFeatureDefinition, CadFeatureDefinitions, CadFeatureField, CadFeatureKind, CadFeatureScalar, CadFeatureSlot } from './cadFeatureDefinitionTypes';
import { curve, datumPlane, sketch } from './kinds/references';
import { extrude, imported, loft, pocket, revolve, sweep } from './kinds/solids';
import { chamfer, fillet, shell } from './kinds/dressUps';
import { boolean, circularPattern, linearPattern, mirror, transform } from './kinds/bodies';

// The kinds modules and the resolvers they call import each other, so the record is built on first use rather than while modules load.
const catalog = () => Object.freeze({
  'datum-plane': datumPlane, curve, sketch,
  imported, extrude, pocket, revolve, loft, sweep,
  fillet, chamfer, shell,
  boolean, transform, 'linear-pattern': linearPattern, 'circular-pattern': circularPattern, mirror
} satisfies CadFeatureDefinitions);
let definitions: ReturnType<typeof catalog> | undefined;
/** Every kind's definition, in catalog order: references, solids, dress-ups, then body operations. */
export function cadFeatureDefinitions() {
  return definitions ??= catalog();
}

/**
 * The stored shapes as the document schema lists them. The order fixes the published document and edit schemas, so it stays as it was
 * when kinds were declared one by one. Fillet and chamfer share one shape.
 */
export function cadFeatureSchemaUnion() {
  const all = cadFeatureDefinitions();
  return Type.Union([all['datum-plane'].schema, all.curve.schema, all.sweep.schema, all.pocket.schema, all.imported.schema, all.sketch.schema, all.extrude.schema,
    all.revolve.schema, all.loft.schema, all.fillet.schema, all.shell.schema, all.boolean.schema, all.transform.schema, all['linear-pattern'].schema,
    all['circular-pattern'].schema, all.mirror.schema]);
}

/** Every kind, in catalog order. */
export function cadFeatureKinds(): readonly CadFeatureKind[] {
  return layout().kinds;
}

/** The definition of `kind`. */
export function cadFeatureDefinition<K extends CadFeatureKind>(kind: K): CadFeatureDefinition<K>;
export function cadFeatureDefinition(kind: CadFeatureKind): CadAnyFeatureDefinition;
export function cadFeatureDefinition(kind: CadFeatureKind): CadAnyFeatureDefinition {
  return (cadFeatureDefinitions() as CadFeatureDefinitions)[kind];
}

/** The definition of a kind named by unchecked data, if there is one. */
export function findCadFeatureDefinition(kind: unknown): CadAnyFeatureDefinition | undefined {
  return typeof kind === 'string' ? layout().byKind.get(kind) : undefined;
}

/** A stored field, with its name. */
export interface CadFeatureNamedField<T> { readonly name: string; readonly field: CadFeatureField; readonly meaning: T }
interface CadFeatureLayout {
  readonly slots: readonly CadFeatureNamedField<CadFeatureSlot>[];
  readonly scalars: readonly CadFeatureNamedField<CadFeatureScalar>[];
  /** Fields holding expression-bearing scalars, in schema order. */
  readonly mapped: readonly CadFeatureNamedField<CadFeatureField>[];
  /** Fields with their own checks, in schema order. */
  readonly checked: readonly CadFeatureNamedField<CadFeatureField>[];
  readonly conditioned: readonly CadFeatureNamedField<NonNullable<CadFeatureField['condition']>>[];
  readonly repeats: readonly string[];
}
interface CadFeatureLayouts {
  readonly kinds: readonly CadFeatureKind[];
  readonly byKind: ReadonlyMap<string, CadAnyFeatureDefinition>;
  readonly fields: ReadonlyMap<CadFeatureKind, CadFeatureLayout>;
}

let layouts: CadFeatureLayouts | undefined;
function layout(): CadFeatureLayouts {
  if (layouts) return layouts;
  const all: CadFeatureDefinitions = cadFeatureDefinitions();
  const kinds = Object.keys(all) as CadFeatureKind[];
  const fields = new Map<CadFeatureKind, CadFeatureLayout>();
  for (const kind of kinds) {
    const entries = Object.entries(all[kind].fields);
    const named = <T>(pick: (field: CadFeatureField) => T | undefined) =>
      entries.flatMap(([name, field]) => { const meaning = pick(field); return meaning === undefined ? [] : [{ name, field, meaning }]; });
    fields.set(kind, Object.freeze({
      slots: named(field => field.slot), scalars: named(field => field.scalar), mapped: named(field => field.scalars ? field : undefined),
      checked: named(field => field.check ? field : undefined), conditioned: named(field => field.condition),
      repeats: entries.flatMap(([name, field]) => field.scalar?.repeats ? [name] : [])
    }));
  }
  return layouts = Object.freeze({ kinds: Object.freeze(kinds), byKind: new Map<string, CadAnyFeatureDefinition>(kinds.map(kind => [kind, all[kind]])), fields });
}

/** The slots, scalars, mapped and checked fields of `feature`'s kind, each in schema order. */
export function cadFeatureLayout(feature: Pick<CadFeature, 'kind'>): CadFeatureLayout {
  const found = layout().fields.get(feature.kind);
  if (!found) throw new TypeError(`Unknown CAD feature kind "${String(feature.kind)}".`);
  return found;
}

/** The declared dimension `field` of `kind`. */
export function cadFeatureScalar(kind: CadFeatureKind, field: string): CadFeatureScalar {
  const scalar = cadFeatureDefinition(kind).fields[field]?.scalar;
  if (!scalar) throw new TypeError(`"${field}" is not a declared dimension of ${kind} features.`);
  return scalar;
}
/**
 * Whether `size` is within the scalar's declared range and whole where it must be. For a `magnitude` scalar, pass the absolute value.
 * Range comparisons are written as refusals, so a value that is not a number passes to the checks that evaluate it.
 */
export function cadFeatureScalarAccepts(scalar: CadFeatureScalar, size: number): boolean {
  return !(scalar.integer && !Number.isInteger(size) || scalar.min !== undefined && (scalar.exclusiveMin ? size <= scalar.min : size < scalar.min)
    || scalar.max !== undefined && size > scalar.max);
}

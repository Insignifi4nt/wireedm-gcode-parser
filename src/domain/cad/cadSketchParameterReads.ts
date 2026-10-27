import type { CadDocument, CadSketchFeature } from './cadDocument';
import { cadScalarParameterNames, mapCadFeatureScalars } from './cadParameters';

/** What a sketch's geometry reads of a document's parameters, captured once for both a cache key and the geometry. */
export interface CadSketchGeometryReads {
  /** The value of each parameter its profiles and graph name, in a fixed order per sketch; `undefined` where it is missing. */
  readonly values: readonly (number | undefined)[];
  /** Only those parameters, so geometry resolved from it depends on nothing but `values`. */
  readonly environment: CadDocument['parameters'];
}

const geometryNames = new WeakMap<CadSketchFeature, readonly string[]>();

/**
 * Reads the parameters a sketch's profiles and graph name. Only for a sketch that cannot change, such as an
 * accepted one: its names are collected once per object. Null when one of them is an accessor or not a finite
 * number, so the caller takes its ordinary path and never adopts that result.
 */
export function readCadSketchGeometryParameters(sketch: CadSketchFeature, parameters: CadDocument['parameters']): CadSketchGeometryReads | null {
  let names = geometryNames.get(sketch);
  if (!names) {
    const used = new Set<string>();
    mapCadFeatureScalars(sketch, (value, path) => {
      if (path.startsWith('profiles.') || path.startsWith('graph.')) for (const name of cadScalarParameterNames(value)) used.add(name);
      return value;
    });
    names = [...used];
    geometryNames.set(sketch, names);
  }
  const values: (number | undefined)[] = [], environment: Record<string, number> = Object.create(null);
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(parameters, name);
    if (!field) { values.push(undefined); continue; }
    if (!('value' in field) || typeof field.value !== 'number' || !Number.isFinite(field.value)) return null;
    values.push(field.value); environment[name] = field.value;
  }
  return { values, environment };
}

/** Whether two reads of the same sketch saw the same values. */
export function sameCadSketchGeometryValues(left: readonly (number | undefined)[], right: readonly (number | undefined)[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

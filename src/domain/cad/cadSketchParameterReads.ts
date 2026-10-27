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

// Collected once per object, so only for a sketch that cannot change, such as an accepted one.
function geometryParameterNames(sketch: CadSketchFeature): readonly string[] {
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
  return names;
}

const isFiniteData = (field: PropertyDescriptor) => 'value' in field && typeof field.value === 'number' && Number.isFinite(field.value);

/**
 * Reads the parameters an unchanging sketch's profiles and graph name. Null when one of them is an accessor or not
 * a finite number, so the caller takes its ordinary path and never adopts that result.
 */
export function readCadSketchGeometryParameters(sketch: CadSketchFeature, parameters: CadDocument['parameters']): CadSketchGeometryReads | null {
  const values: (number | undefined)[] = [], environment: Record<string, number> = Object.create(null);
  for (const name of geometryParameterNames(sketch)) {
    const field = Object.getOwnPropertyDescriptor(parameters, name);
    if (!field) { values.push(undefined); continue; }
    if (!isFiniteData(field)) return null;
    values.push(field.value); environment[name] = field.value;
  }
  return { values, environment };
}

/** Whether two reads of the same sketch saw the same values. */
export function sameCadSketchGeometryValues(left: readonly (number | undefined)[], right: readonly (number | undefined)[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Whether an unchanging sketch reads the same values from both parameter sets: each parameter its profiles and
 * graph name is missing from both or the same finite number in both. False when one is an accessor or invalid.
 */
export function sameCadSketchGeometryParameters(sketch: CadSketchFeature, left: CadDocument['parameters'], right: CadDocument['parameters']): boolean {
  return geometryParameterNames(sketch).every(name => {
    const before = Object.getOwnPropertyDescriptor(left, name), after = Object.getOwnPropertyDescriptor(right, name);
    if (!before || !after) return !before && !after;
    return isFiniteData(before) && isFiniteData(after) && Object.is(before.value, after.value);
  });
}

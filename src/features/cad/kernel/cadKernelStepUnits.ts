import { CadError } from '../../../domain/cad/cadError';

const metricPrefixes = new Map<string, number>([
  ['$', 1], ['.EXA.', 1e18], ['.PETA.', 1e15], ['.TERA.', 1e12], ['.GIGA.', 1e9], ['.MEGA.', 1e6],
  ['.KILO.', 1e3], ['.HECTO.', 1e2], ['.DECA.', 1e1], ['.DECI.', 1e-1], ['.CENTI.', 1e-2],
  ['.MILLI.', 1e-3], ['.MICRO.', 1e-6], ['.NANO.', 1e-9], ['.PICO.', 1e-12], ['.FEMTO.', 1e-15], ['.ATTO.', 1e-18],
]);
const stepNumber = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][+-]?\\d+)?';
function invalidUnits(): never {
  throw new CadError('step-units', 'Every three-dimensional STEP context must declare valid explicit length units with finite positive conversion factors and metre-based references.');
}

/** Resolve the complete conversion chain before OCCT can substitute defaults. */
function lengthScale(id: string, entities: ReadonlyMap<string, string>): { scaleMm: number; nativeTransferSupported: boolean } {
  const visiting = new Set<string>(), factors: number[] = [];
  let current = id, nativeTransferSupported = true;
  while (true) {
    if (visiting.has(current)) return invalidUnits();
    visiting.add(current);
    const record = entities.get(current);
    if (!record || !/\bLENGTH_UNIT\s*\(\s*\)/i.test(record)) return invalidUnits();
    const si = /\bSI_UNIT\s*\(\s*(\$|\.[A-Z]+\.)\s*,\s*\.METRE\.\s*\)/i.exec(record);
    if (si) {
      if (/\bCONVERSION_BASED_UNIT\s*\(/i.test(record)) return invalidUnits();
      const prefix = metricPrefixes.get(si[1].toUpperCase());
      if (prefix === undefined) return invalidUnits();
      let scale = prefix * 1000;
      // Preserve the original right-associated conversion arithmetic and reject
      // invalid intermediate scales before an outer factor could mask them.
      for (let index = factors.length - 1; index >= 0; index--) {
        scale = factors[index] * scale;
        if (!Number.isFinite(scale) || scale <= 0) return invalidUnits();
      }
      return { scaleMm: scale, nativeTransferSupported };
    }
    const conversion = /\bCONVERSION_BASED_UNIT\s*\(\s*,\s*#(\d+)\s*\)/i.exec(record);
    const dimensions = /\bNAMED_UNIT\s*\(\s*#(\d+)\s*\)/i.exec(record);
    if (!conversion || !dimensions || /\bSI_UNIT\s*\(/i.test(record)) return invalidUnits();
    const dimensionRecord = entities.get(dimensions[1]);
    const exponent = dimensionRecord && /^\s*DIMENSIONAL_EXPONENTS\s*\(([^)]*)\)\s*$/i.exec(dimensionRecord);
    const powers = exponent?.[1].split(',').map(value => new RegExp(`^\\s*${stepNumber}\\s*$`).test(value) ? Number(value) : NaN);
    if (!powers || powers.length !== 7 || powers.some((power, axis) => power !== (axis === 0 ? 1 : 0))) return invalidUnits();
    const measure = entities.get(conversion[1]);
    const factor = measure && new RegExp(`^\\s*LENGTH_MEASURE_WITH_UNIT\\s*\\(\\s*(?:LENGTH_MEASURE\\s*\\(\\s*(${stepNumber})\\s*\\)|(${stepNumber}))\\s*,\\s*#(\\d+)\\s*\\)\\s*$`, 'i').exec(measure);
    if (!factor) return invalidUnits();
    const value = Number(factor[1] ?? factor[2]);
    if (!Number.isFinite(value) || value <= 0) return invalidUnits();
    // The pinned OCCT ComputeFactors accepts a conversion target only when it
    // is an SI unit; a conversion-to-conversion target falls back to millimetres.
    if (/\bCONVERSION_BASED_UNIT\s*\(/i.test(entities.get(factor[3]) ?? '')) nativeTransferSupported = false;
    factors.push(value);
    current = factor[3];
  }
}

/** FileUnits' sequence constructor is not bound in the pinned WASM. Inspect
 * explicit physical-file context references; native OC performs the conversion. */
export function assertCadStepLengthUnits(source: string): { readonly contextScalesMm: readonly number[]; readonly nativeTransferSupported: boolean } {
  const tokens = source.replace(/\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, ' ');
  const entities = new Map<string, string>();
  // Split once rather than repeatedly searching an unterminated entity tail.
  for (const statement of tokens.split(';')) {
    const match = /^\s*#(\d+)\s*=\s*([\s\S]*)$/.exec(statement);
    if (!match) continue;
    if (entities.has(match[1])) throw new CadError('step-units', 'The STEP physical file contains duplicate entity identifiers.');
    entities.set(match[1], match[2]);
  }
  const contextScalesMm: number[] = [];
  let nativeTransferSupported = true;
  for (const record of entities.values()) {
    if (!/\bGEOMETRIC_REPRESENTATION_CONTEXT\s*\(\s*3\s*\)/i.test(record)) continue;
    const assigned = /\bGLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)\s*\)/i.exec(record);
    if (!assigned || !/^\s*#\d+(?:\s*,\s*#\d+)*\s*$/.test(assigned[1])) return invalidUnits();
    const ids = [...assigned[1].matchAll(/#(\d+)/g)].map(reference => reference[1]);
    if (new Set(ids).size !== ids.length || ids.some(id => !entities.has(id))) return invalidUnits();
    const lengths = ids.filter(id => /\bLENGTH_UNIT\s*\(\s*\)/i.test(entities.get(id) ?? ''));
    if (lengths.length !== 1) return invalidUnits();
    const resolved = lengthScale(lengths[0], entities);
    contextScalesMm.push(resolved.scaleMm); nativeTransferSupported &&= resolved.nativeTransferSupported;
  }
  if (!contextScalesMm.length) throw new CadError('step-units', 'The STEP file has no supported three-dimensional context with explicit length units.');
  return { contextScalesMm, nativeTransferSupported };
}

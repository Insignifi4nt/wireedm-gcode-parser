import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { cadUtf8SourceLength } from './cadSourceEncoding';

const fileName = Type.String({ minLength: 1, maxLength: 160 });
const strict = { additionalProperties: false };
/** Original file contents are part of the portable document and its ordinary atomic save. */
export const CadSolidImportSourceSchema = Type.Union([
  Type.Object({ format: Type.Literal('step'), fileName, encoding: Type.Literal('utf8'), data: Type.String({ minLength: 1 }) }, strict),
  Type.Object({ format: Type.Literal('stl'), fileName, encoding: Type.Literal('base64'), data: Type.String({ minLength: 4 }),
    units: Type.Union([Type.Literal('mm'), Type.Literal('inch')]) }, strict)
]);
export type CadSolidImportSource = Static<typeof CadSolidImportSourceSchema>;
export interface CadSolidImportResult {
  readonly format: 'step' | 'stl';
  readonly fileName: string;
  readonly representation: 'exact-brep' | 'faceted-brep';
  readonly volume: number;
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly solidCount: number;
  readonly sourceBytes: number;
}

export function parseCadSolidImportSource(value: unknown): CadSolidImportSource {
  if (!isCadImportData(value) || !Value.Check(CadSolidImportSourceSchema, value)) throw new CadError('invalid-import', 'Supply a STEP text file or a base64 STL file with millimeter or inch units.');
  if (/[\\/\u0000-\u001f\u007f]/.test(value.fileName) || !new RegExp(value.format === 'step' ? '\\.(?:step|stp)$' : '\\.stl$', 'i').test(value.fileName)) {
    throw new CadError('invalid-import', 'Use a filename ending in .step, .stp or .stl that matches the supplied format.');
  }
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.values(fields).some(field => !('value' in field))) throw new CadError('invalid-import', 'Import sources must contain plain data fields.');
  const source = Object.freeze({ ...value });
  if (!Value.Check(CadSolidImportSourceSchema, source)) throw new CadError('invalid-import', 'Import sources must contain their own complete fields.');
  cadSolidImportByteLength(source);
  return source;
}

/** Validate canonical encoding and count bytes without decoding a full original. */
export function cadSolidImportByteLength(source: CadSolidImportSource): number {
  if (source.format === 'step') {
    const length = cadUtf8SourceLength(source.data);
    if (length === null) throw new CadError('invalid-import-encoding', 'STEP text must be valid Unicode without unpaired surrogates.');
    if (!length) throw new CadError('import-size', 'STEP source files must be nonempty.');
    return length;
  }
  const data = source.data, length = data.length;
  const invalid = () => { throw new CadError('invalid-import-encoding', 'STL data must be canonical standard padded base64 without whitespace or a data URL prefix.'); };
  if (length < 4 || length % 4) return invalid();
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  let last = 0;
  for (let index = 0; index < length - padding; index++) {
    const code = data.charCodeAt(index);
    last = code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 71
      : code >= 48 && code <= 57 ? code + 4 : code === 43 ? 62 : code === 47 ? 63 : -1;
    if (last < 0) return invalid();
  }
  if (padding && (last & (padding === 2 ? 15 : 3))) return invalid();
  return length / 4 * 3 - padding;
}

export function cadSolidImportBytes(source: CadSolidImportSource): Uint8Array {
  const length = cadSolidImportByteLength(source);
  if (source.format === 'step') return new TextEncoder().encode(source.data);
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < source.data.length; offset += 32768) {
    const binary = atob(source.data.slice(offset, offset + 32768));
    for (let index = 0; index < binary.length; index++) bytes[offset / 4 * 3 + index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function cadBytesToBase64(bytes: Uint8Array): string {
  if (!bytes.length) throw new CadError('import-size', 'STL source files must be nonempty.');
  const parts: string[] = [];
  // Chunks are divisible by three, so padding occurs only at the original end.
  for (let offset = 0; offset < bytes.length; offset += 24576) parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  return parts.join('');
}

export function isCadSolidImportResult(value: unknown): value is CadSolidImportResult {
  if (!isCadImportData(value)) return false;
  function dataFields(input: unknown, names: readonly string[]): input is Record<string, unknown> {
    if (typeof input !== 'object' || input === null) return false;
    const fields = Object.getOwnPropertyDescriptors(input);
    return Reflect.ownKeys(fields).length === names.length && names.every(name => fields[name] && 'value' in fields[name]);
  }
  if (!dataFields(value, ['format', 'fileName', 'representation', 'volume', 'bounds', 'solidCount', 'sourceBytes'])) return false;
  const item = value as Record<string, unknown>;
  if ((item.format !== 'step' && item.format !== 'stl') || typeof item.fileName !== 'string' || !item.fileName.length || item.fileName.length > 160
    || item.representation !== (item.format === 'step' ? 'exact-brep' : 'faceted-brep')
    || typeof item.volume !== 'number' || !Number.isFinite(item.volume) || item.volume <= 0
    || typeof item.solidCount !== 'number' || !Number.isSafeInteger(item.solidCount) || item.solidCount < 1
    || typeof item.sourceBytes !== 'number' || !Number.isSafeInteger(item.sourceBytes) || item.sourceBytes < 1
    || !dataFields(item.bounds, ['min', 'max'])) return false;
  const { min, max } = item.bounds;
  const point = (input: unknown): input is number[] => Array.isArray(input) && input.length === 3 && dataFields(input, ['0', '1', '2', 'length'])
    && Array.from(input).every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e9);
  return point(min) && point(max) && min.every((number, axis) => number <= max[axis]);
}

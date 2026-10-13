import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';

export const MAX_CAD_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_CAD_DOCUMENT_BYTES = 4 * 1024 * 1024;
const fileName = Type.String({ minLength: 1, maxLength: 160 });
const strict = { additionalProperties: false };
/** Original file contents are part of the portable document and its ordinary atomic save. */
export const CadSolidImportSourceSchema = Type.Union([
  Type.Object({ format: Type.Literal('step'), fileName, encoding: Type.Literal('utf8'), data: Type.String({ minLength: 1, maxLength: MAX_CAD_IMPORT_BYTES }) }, strict),
  Type.Object({ format: Type.Literal('stl'), fileName, encoding: Type.Literal('base64'), data: Type.String({ minLength: 4, maxLength: Math.ceil(MAX_CAD_IMPORT_BYTES / 3) * 4 }),
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
  cadSolidImportBytes(source);
  return source;
}

export function cadSolidImportBytes(source: CadSolidImportSource): Uint8Array {
  let bytes: Uint8Array;
  if (source.format === 'step') {
    bytes = new TextEncoder().encode(source.data);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== source.data) throw new CadError('invalid-import-encoding', 'STEP text must be valid Unicode without unpaired surrogates.');
  } else {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.data)) {
      throw new CadError('invalid-import-encoding', 'STL data must be standard padded base64 without whitespace or a data URL prefix.');
    }
    const binary = atob(source.data);
    // Reject noncanonical padding bits; otherwise different originals could decode to identical bytes.
    if (btoa(binary) !== source.data) throw new CadError('invalid-import-encoding', 'STL base64 has noncanonical padding bits.');
    bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  if (!bytes.length || bytes.length > MAX_CAD_IMPORT_BYTES) throw new CadError('import-size', 'STEP and STL source files must be nonempty and at most 2 MiB.');
  return bytes;
}

export function cadBytesToBase64(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_CAD_IMPORT_BYTES) throw new CadError('import-size', 'STL source files must be nonempty and at most 2 MiB.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
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
    || typeof item.solidCount !== 'number' || !Number.isInteger(item.solidCount) || item.solidCount < 1 || item.solidCount > 256
    || typeof item.sourceBytes !== 'number' || !Number.isInteger(item.sourceBytes) || item.sourceBytes < 1 || item.sourceBytes > MAX_CAD_IMPORT_BYTES
    || !dataFields(item.bounds, ['min', 'max'])) return false;
  const { min, max } = item.bounds;
  const point = (input: unknown): input is number[] => Array.isArray(input) && input.length === 3 && dataFields(input, ['0', '1', '2', 'length'])
    && Array.from(input).every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e9);
  return point(min) && point(max) && min.every((number, axis) => number <= max[axis]);
}

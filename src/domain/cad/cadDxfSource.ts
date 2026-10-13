import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';

export const MAX_CAD_DXF_SOURCE_BYTES = 2 * 1024 * 1024;
export const CadDxfUnitsSchema = Type.Union([Type.Literal('mm'), Type.Literal('inch'), Type.Literal('cm'), Type.Literal('m')]);
export const CadDxfImportSourceSchema = Type.Object({ format: Type.Literal('dxf'),
  fileName: Type.String({ minLength: 1, maxLength: 160, pattern: '^[^/\\\\]+\\.[dD][xX][fF]$' }),
  text: Type.String({ minLength: 1, maxLength: MAX_CAD_DXF_SOURCE_BYTES }), units: Type.Optional(CadDxfUnitsSchema)
}, { additionalProperties: false });
export type CadDxfImportSource = Readonly<Static<typeof CadDxfImportSourceSchema>>;
export type CadDxfUnits = Static<typeof CadDxfUnitsSchema>;
export function parseCadDxfImportSource(value: unknown): CadDxfImportSource {
  if (!isCadImportData(value) || !Value.Check(CadDxfImportSourceSchema, value)) throw new CadError('invalid-dxf-source', 'Provide an exact DXF original and optional explicit units.');
  let source: Static<typeof CadDxfImportSourceSchema>;
  try { source = structuredClone(value); }
  catch { throw new CadError('invalid-dxf-source', 'DXF import source must contain portable declarative data.'); }
  if (!Value.Check(CadDxfImportSourceSchema, source)) throw new CadError('invalid-dxf-source', 'DXF import source must contain its own fields.');
  if (/[\u0000-\u001f\u007f]/.test(source.fileName)) throw new CadError('invalid-dxf-source', 'DXF filenames must not contain control characters.');
  const bytes = new TextEncoder().encode(source.text);
  if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== source.text) throw new CadError('invalid-dxf-source', 'DXF text must be valid Unicode without unpaired surrogates.');
  if (bytes.length > MAX_CAD_DXF_SOURCE_BYTES) throw new CadError('dxf-source-size', 'CAD DXF originals must be at most 2 MiB.');
  return Object.freeze(source);
}

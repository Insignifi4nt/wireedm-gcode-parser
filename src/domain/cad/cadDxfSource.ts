import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import { cadUtf8SourceLength } from './cadSourceEncoding';

export const CadDxfUnitsSchema = Type.Union([Type.Literal('mm'), Type.Literal('inch'), Type.Literal('cm'), Type.Literal('m')]);
export const CadDxfImportSourceSchema = Type.Object({ format: Type.Literal('dxf'),
  fileName: Type.String({ minLength: 1, maxLength: 160, pattern: '^[^/\\\\]+\\.[dD][xX][fF]$' }),
  text: Type.String({ minLength: 1 }), units: Type.Optional(CadDxfUnitsSchema)
}, { additionalProperties: false });
export type CadDxfImportSource = Readonly<Static<typeof CadDxfImportSourceSchema>>;
export type CadDxfUnits = Static<typeof CadDxfUnitsSchema>;
export function parseCadDxfImportSource(value: unknown): CadDxfImportSource {
  if (!isCadImportData(value) || !Value.Check(CadDxfImportSourceSchema, value)) throw new CadError('invalid-dxf-source', 'Provide an exact DXF original and optional explicit units.');
  // The strict source contains only immutable primitives; retain its text
  // without structured-cloning another full original at each validation seam.
  const source: Static<typeof CadDxfImportSourceSchema> = { ...value };
  if (!Value.Check(CadDxfImportSourceSchema, source)) throw new CadError('invalid-dxf-source', 'DXF import source must contain its own fields.');
  if (/[\u0000-\u001f\u007f]/.test(source.fileName)) throw new CadError('invalid-dxf-source', 'DXF filenames must not contain control characters.');
  if (cadUtf8SourceLength(source.text) === null) throw new CadError('invalid-dxf-source', 'DXF text must be valid Unicode without unpaired surrogates.');
  return Object.freeze(source);
}

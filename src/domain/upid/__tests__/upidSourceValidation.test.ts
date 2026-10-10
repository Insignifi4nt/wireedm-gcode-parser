import { describe, expect, it } from 'vitest';

import { dxfUnitsFromInsunitsCode } from '@/domain/dxf/parseDxf';
import { createUpidFromDxfEntities } from '../upidDocument';
import { validateUpidDocument } from '../validateUpidDocument';

function documentWithSource(source: unknown, schemaVersion: 1 | 2 | 3 = 1) {
  const document = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  document.schemaVersion = schemaVersion;
  Reflect.set(document, 'source', source);
  return document;
}

describe('UPID source metadata compatibility', () => {
  it.each([1, 2, 3] as const)('retains optional historical source metadata in v%s', (schemaVersion) => {
    const document = documentWithSource({ kind: 'dxf-entities', entityCount: 1 }, schemaVersion);
    const original = structuredClone(document);
    expect(validateUpidDocument(document).structurallyValid).toBe(true);
    expect(document).toEqual(original);
  });

  it.each([0, ...Array.from({ length: 24 }, (_, index) => index + 1), 99])(
    'accepts matching DXF unit declaration for code %s', (code) => {
      const units = dxfUnitsFromInsunitsCode(code);
      const document = documentWithSource({
        kind: 'dxf-entities', entityCount: 1, units,
        unitDeclaration: { status: code === 0 ? 'unitless' : units.scaleToMillimeters === null ? 'unknown' : 'recognized', units: { ...units } }
      });
      expect(validateUpidDocument(document).structuralDiagnostics).toEqual([]);
    }
  );

  it.each(['millimeters', 'inches'] as const)('accepts a reviewed %s reinterpretation of malformed units', (label) => {
    const scaleToMillimeters = label === 'millimeters' ? 1 : 25.4;
    const document = documentWithSource({
      kind: 'dxf-entities', entityCount: 1,
      unitDeclaration: { status: 'malformed', rawValue: 'bad' },
      coordinateScaleToMillimeters: scaleToMillimeters,
      appliedUnits: { label, scaleToMillimeters, basis: 'user-confirmed', confirmed: true, confirmedAt: '2026-10-11T00:00:00Z' }
    });
    expect(validateUpidDocument(document).structuralDiagnostics).toEqual([]);
  });

  it('preserves complete diagnostic order, identities and original invalid metadata', () => {
    const document = documentWithSource({
      kind: 'unknown', entityCount: -1, fileName: 12, projectId: '',
      importWarnings: ['notice', false], importedAt: 'bad-date',
      coordinateScaleToMillimeters: 0,
      appliedUnits: { label: '', scaleToMillimeters: -1, basis: 'user-confirmed', confirmed: false, confirmedAt: 'bad-date' },
      drawing: { basePoint: { x: '0', y: 0 }, extents: { min: null, max: { x: 0, y: Infinity } } },
      units: { source: 'other', code: 4, label: 'inches', scaleToMillimeters: 25.4 },
      unitDeclaration: { status: 'recognized', units: { source: 'dxf-insunits', code: 4, label: 'millimeters', scaleToMillimeters: 1 } }
    });
    const original = structuredClone(document);
    const report = validateUpidDocument(document);
    const messages = [
      'UPID source kind unknown is unsupported.',
      'source.entityCount must be an integer of at least 0.',
      'source.fileName must be a string when present.',
      'source.projectId must be a non-empty string when present.',
      'source.importWarnings[1] must be a string.',
      'source.importedAt must be a valid date string.',
      'source.coordinateScaleToMillimeters is invalid or non-finite.',
      'source.appliedUnits.label must be a non-empty string.',
      'source.appliedUnits.scaleToMillimeters is invalid or non-finite.',
      'source.appliedUnits.confirmedAt must be a valid date string.',
      'source.drawing.basePoint must contain finite X/Y coordinates.',
      'source.drawing.extents.min must contain finite X/Y coordinates.',
      'source.drawing.extents.max must contain finite X/Y coordinates.',
      'source.units.source is unsupported.',
      'source.units label and scale must match DXF INSUNITS code 4.',
      'source.unitDeclaration.units must match source.units.',
      'User-confirmed source.appliedUnits must be confirmed.',
      'User-confirmed source.appliedUnits require a valid confirmation timestamp.',
      'User-confirmed source.appliedUnits label and scale are inconsistent.'
    ];
    expect(report.structuralDiagnostics).toEqual(messages.map((message, index) => ({
      id: `diag_upid_validation_${String(index + 1).padStart(4, '0')}`,
      severity: 'error', code: 'upid-invalid-value', message
    })));
    expect(report.structurallyValid).toBe(false);
    expect(document).toEqual(original);
  });

  it.each([null, [], 'source'])('reports a nonobject source %j without throwing', (source) => {
    expect(validateUpidDocument(documentWithSource(source)).structuralDiagnostics).toEqual([
      { id: 'diag_upid_validation_0001', severity: 'error', code: 'upid-invalid-value', message: 'UPID source must be an object.' }
    ]);
  });
});

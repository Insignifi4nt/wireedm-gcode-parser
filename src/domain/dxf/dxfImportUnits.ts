import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';

import type { DxfDrawingUnits, DxfUnitDeclaration } from './types';

export type DxfImportUnitCandidateSource =
  | 'dxf-declared'
  | 'workbench-preference'
  | 'explicit-choice';

export interface DxfImportUnitCandidate {
  readonly id: string;
  readonly label: string;
  readonly scaleToMillimeters: number;
  readonly source: DxfImportUnitCandidateSource;
  readonly units: DxfDrawingUnits;
}

type ImportUnitPreference = WorkbenchCatalogManifest['preferences']['importUnits'];

export function buildDxfImportUnitCandidates(
  declaration: DxfUnitDeclaration,
  preference: ImportUnitPreference
): readonly DxfImportUnitCandidate[] {
  const candidates: DxfImportUnitCandidate[] = [];
  if (preference.mode === 'fixed') {
    candidates.push(namedCandidate(preference.unit, 'workbench-preference'));
  }
  if (declaration.status === 'recognized') {
    const scale = declaration.units.scaleToMillimeters;
    if (scale !== null && Number.isFinite(scale) && scale > 0) {
      candidates.push({
        id: declaredCandidateId(declaration.units),
        label: declaration.units.label,
        scaleToMillimeters: scale,
        source: 'dxf-declared',
        units: structuredClone(declaration.units)
      });
    }
  }
  candidates.push(
    namedCandidate('millimeters', 'explicit-choice'),
    namedCandidate('inches', 'explicit-choice')
  );

  const scales = new Set<number>();
  return Object.freeze(candidates.filter(({ scaleToMillimeters }) => {
    if (scales.has(scaleToMillimeters)) return false;
    scales.add(scaleToMillimeters);
    return true;
  }));
}

export function defaultDxfImportUnitCandidateId(
  declaration: DxfUnitDeclaration,
  preference: ImportUnitPreference
) {
  if (preference.mode === 'fixed') return preference.unit;
  if (declaration.status !== 'recognized') return null;
  const scale = declaration.units.scaleToMillimeters;
  return scale !== null && Number.isFinite(scale) && scale > 0
    ? declaredCandidateId(declaration.units)
    : null;
}

function declaredCandidateId(units: DxfDrawingUnits) {
  if (units.code === 1) return 'inches';
  if (units.code === 4) return 'millimeters';
  return `dxf-insunits-${units.code}`;
}

function namedCandidate(
  unit: 'millimeters' | 'inches',
  source: DxfImportUnitCandidateSource
): DxfImportUnitCandidate {
  const units: DxfDrawingUnits = unit === 'inches'
    ? { source: 'dxf-insunits', code: 1, label: 'inches', scaleToMillimeters: 25.4 }
    : { source: 'dxf-insunits', code: 4, label: 'millimeters', scaleToMillimeters: 1 };
  return {
    id: unit,
    label: units.label,
    scaleToMillimeters: unit === 'inches' ? 25.4 : 1,
    source,
    units
  };
}

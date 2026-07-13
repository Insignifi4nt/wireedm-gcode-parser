import type {
  DxfDrawingUnits,
  DxfUnitDeclaration
} from './types';
import type { MachineProfile } from '@/domain/workbench/types';

export type DxfImportUnitCandidateSource =
  | 'dxf-declared'
  | 'machine-suggestion'
  | 'fallback';

export interface DxfImportUnitCandidate {
  id: string;
  label: string;
  scaleToMillimeters: number;
  source: DxfImportUnitCandidateSource;
  units: DxfDrawingUnits;
  suggestion?: {
    kind: 'machine-profile';
    profileId: string;
  };
}

export function buildDxfImportUnitCandidates(
  declaration: DxfUnitDeclaration,
  machineProfile: MachineProfile
): DxfImportUnitCandidate[] {
  const candidates: DxfImportUnitCandidate[] = [];

  if (
    declaration.status === 'recognized' &&
    declaration.units.scaleToMillimeters != null &&
    Number.isFinite(declaration.units.scaleToMillimeters) &&
    declaration.units.scaleToMillimeters > 0
  ) {
    candidates.push(candidateFromDeclaredUnits(declaration.units));
  }

  const suggestion = machineProfile.preferredDxfImportUnit;
  if (suggestion) {
    candidates.push({
      ...candidateForNamedUnit(suggestion),
      source: 'machine-suggestion',
      suggestion: { kind: 'machine-profile', profileId: machineProfile.id }
    });
  }

  candidates.push({
    ...candidateForNamedUnit('millimeters'),
    source: 'fallback'
  });

  const seenScales = new Set<number>();
  return candidates.filter((candidate) => {
    if (seenScales.has(candidate.scaleToMillimeters)) return false;
    seenScales.add(candidate.scaleToMillimeters);
    return true;
  });
}

function candidateFromDeclaredUnits(units: DxfDrawingUnits): DxfImportUnitCandidate {
  return {
    id: stableDeclaredCandidateId(units),
    label: units.label,
    scaleToMillimeters: units.scaleToMillimeters!,
    source: 'dxf-declared',
    units: { ...units }
  };
}

function stableDeclaredCandidateId(units: DxfDrawingUnits) {
  if (units.code === 1) return 'inches';
  if (units.code === 4) return 'millimeters';
  return `dxf-insunits-${units.code}`;
}

function candidateForNamedUnit(unit: NonNullable<MachineProfile['preferredDxfImportUnit']>) {
  const units: DxfDrawingUnits = unit === 'inches'
    ? {
        source: 'dxf-insunits',
        code: 1,
        label: 'inches',
        scaleToMillimeters: 25.4
      }
    : {
        source: 'dxf-insunits',
        code: 4,
        label: 'millimeters',
        scaleToMillimeters: 1
      };

  return {
    id: unit,
    label: units.label,
    scaleToMillimeters: units.scaleToMillimeters!,
    units
  };
}

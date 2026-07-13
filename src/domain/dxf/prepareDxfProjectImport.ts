import {
  evaluateMachineFitBounds,
  type MachineFitResult
} from '@/domain/machine/machineFit';
import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import { pathSegmentsFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { mergeBounds } from '@/domain/path-intel/segments';
import type { Bounds2 } from '@/domain/path-intel/types';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  buildDxfImportUnitCandidates,
  type DxfImportUnitCandidate
} from './dxfImportUnits';
import { DEFAULT_DXF_UPID_OPTIONS } from './dxfToUpid';
import { normalizeDxfGeometry } from './normalizeDxfGeometry';
import { parseDxf } from './parseDxf';
import type { DxfParseResult } from './types';

export interface DxfImportSelection {
  machineProfileId: string;
  unitCandidateId: string;
}

export interface DxfImportPreparation {
  fileName: string;
  text: string;
  preparedAt: string;
  parseResult: DxfParseResult;
  entityCount: number;
  unsupportedEntityCount: number;
  warningCount: number;
  machineProfiles: MachineProfile[];
  activeMachineProfileId: string;
  unitCandidates: DxfImportUnitCandidate[];
  defaultSelection: DxfImportSelection;
}

export interface DxfImportPreview {
  boundsMm: Bounds2;
  sizeMm: { widthMm: number; lengthMm: number };
  machineFit: MachineFitResult;
  machineProfile: MachineProfile;
  unitCandidate: DxfImportUnitCandidate;
  unitCandidates: DxfImportUnitCandidate[];
}

export function prepareDxfProjectImport(
  workbench: ConnectedWorkbench,
  input: { fileName: string; text: string; now?: Date }
): DxfImportPreparation {
  const parseResult = parseDxf(input.text);
  const rawSegments = pathSegmentsFromDxfEntities(
    parseResult.entities,
    DEFAULT_DXF_UPID_OPTIONS
  );
  if (rawSegments.segments.length === 0) {
    throw new Error('DXF did not contain supported cut geometry.');
  }

  const machineProfiles = workbench.manifest.machineProfiles.map(normalizeMachineProfile);
  const activeMachineProfileId = workbench.manifest.activeMachineProfileId;
  const activeMachine = requireMachineProfile(machineProfiles, activeMachineProfileId);
  const unitCandidates = buildDxfImportUnitCandidates(
    parseResult.unitDeclaration,
    activeMachine
  );

  return {
    fileName: input.fileName,
    text: input.text,
    preparedAt: (input.now ?? new Date()).toISOString(),
    parseResult,
    entityCount: parseResult.entities.length,
    unsupportedEntityCount: parseResult.unsupportedEntities.length,
    warningCount: parseResult.warnings.length,
    machineProfiles,
    activeMachineProfileId,
    unitCandidates,
    defaultSelection: {
      machineProfileId: activeMachineProfileId,
      unitCandidateId: unitCandidates[0].id
    }
  };
}

export function unitCandidatesForDxfImport(
  preparation: DxfImportPreparation,
  machineProfileId: string
) {
  const machine = requireMachineProfile(preparation.machineProfiles, machineProfileId);
  return buildDxfImportUnitCandidates(preparation.parseResult.unitDeclaration, machine);
}

export function previewDxfProjectImport(
  preparation: DxfImportPreparation,
  selection: DxfImportSelection
): DxfImportPreview {
  const machineProfile = requireMachineProfile(
    preparation.machineProfiles,
    selection.machineProfileId
  );
  const unitCandidates = buildDxfImportUnitCandidates(
    preparation.parseResult.unitDeclaration,
    machineProfile
  );
  const unitCandidate = unitCandidates.find(({ id }) => id === selection.unitCandidateId);
  if (!unitCandidate) {
    throw new Error(`DXF unit candidate not found for selected machine: ${selection.unitCandidateId}.`);
  }

  const normalized = normalizeDxfGeometry({
    entities: preparation.parseResult.entities,
    options: DEFAULT_DXF_UPID_OPTIONS,
    sourceMetadata: { units: unitCandidate.units }
  });
  const segmentBuild = pathSegmentsFromDxfEntities(normalized.entities, normalized.options);
  const boundsMm = boundsForSegments(segmentBuild.segments.map(({ bounds }) => bounds));
  if (!boundsMm) {
    throw new Error('DXF unit preview did not contain valid supported cut geometry.');
  }

  const machineFit = evaluateMachineFitBounds({ bounds: boundsMm, profile: machineProfile });
  if (!machineFit.bounds) {
    throw new Error('DXF unit preview produced invalid millimeter bounds.');
  }

  return {
    boundsMm,
    sizeMm: { ...machineFit.bounds },
    machineFit,
    machineProfile,
    unitCandidate,
    unitCandidates
  };
}

function requireMachineProfile(profiles: MachineProfile[], profileId: string) {
  const profile = profiles.find(({ id }) => id === profileId);
  if (!profile) throw new Error(`Machine profile not found: ${profileId}.`);
  return profile;
}

function boundsForSegments(segmentBounds: Bounds2[]): Bounds2 | null {
  if (segmentBounds.length === 0) return null;
  return segmentBounds.reduce((bounds, current) => mergeBounds(bounds, current));
}

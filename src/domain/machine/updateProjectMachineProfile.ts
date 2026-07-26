import { serializeMachineProfileFile } from '@/domain/machine/machineProfileFile';
import {
  markMachineProfileUserVerified,
  normalizeMachineProfile
} from '@/domain/machine/machineProfiles';
import type { MachineProfile, WorkbenchProject } from '@/domain/workbench/types';

export interface ProjectMachineProfileDraft {
  coordinatePrecision: string;
  validationLeadLengthMm: string;
  workAreaLengthMm: string;
  workAreaWidthMm: string;
}

export type ProjectMachineProfileDraftField = keyof ProjectMachineProfileDraft;

export type ProjectMachineProfileUpdateResult =
  | { ok: true; project: WorkbenchProject }
  | {
      ok: false;
      errors: Partial<Record<ProjectMachineProfileDraftField, string>>;
    };

export function projectMachineProfileDraft(
  profile: MachineProfile
): ProjectMachineProfileDraft {
  return {
    coordinatePrecision: profile.output.coordinatePrecision.toString(),
    validationLeadLengthMm: profile.compensation.validationLeadLengthMm.toString(),
    workAreaLengthMm: profile.workArea.lengthMm?.toString() ?? '',
    workAreaWidthMm: profile.workArea.widthMm?.toString() ?? ''
  };
}

export function updateProjectMachineProfile(
  project: WorkbenchProject,
  draft: ProjectMachineProfileDraft,
  options: { reviewedAt?: Date } = {}
): ProjectMachineProfileUpdateResult {
  const parsed = parseDraft(draft);
  if (!parsed.ok) return parsed;

  const changed =
    parsed.coordinatePrecision !== project.machine.output.coordinatePrecision ||
    parsed.validationLeadLengthMm !== project.machine.compensation.validationLeadLengthMm ||
    parsed.workAreaLengthMm !== project.machine.workArea.lengthMm ||
    parsed.workAreaWidthMm !== project.machine.workArea.widthMm;
  let machine = structuredClone(project.machine);

  if (changed) {
    machine = {
      ...machine,
      controller: {
        ...machine.controller,
        verification: { status: 'unverified' }
      },
      compensation: {
        ...machine.compensation,
        validationLeadLengthMm: parsed.validationLeadLengthMm
      },
      output: {
        ...machine.output,
        coordinatePrecision: parsed.coordinatePrecision
      },
      workArea: {
        widthMm: parsed.workAreaWidthMm,
        lengthMm: parsed.workAreaLengthMm
      }
    };
    serializeMachineProfileFile(machine);
    machine = normalizeMachineProfile(machine);
  }

  if (options.reviewedAt) {
    machine = markMachineProfileUserVerified(machine, options.reviewedAt);
  }

  return {
    ok: true,
    project: {
      ...structuredClone(project),
      machine
    }
  };
}

type ParsedDraft =
  | {
      ok: true;
      coordinatePrecision: number;
      validationLeadLengthMm: number;
      workAreaLengthMm: number | null;
      workAreaWidthMm: number | null;
    }
  | Extract<ProjectMachineProfileUpdateResult, { ok: false }>;

function parseDraft(draft: ProjectMachineProfileDraft): ParsedDraft {
  const errors: Partial<Record<ProjectMachineProfileDraftField, string>> = {};
  const validationLeadLengthMm = Number(draft.validationLeadLengthMm);
  const coordinatePrecision = Number(draft.coordinatePrecision);
  const workAreaWidthMm = nullablePositiveNumber(draft.workAreaWidthMm);
  const workAreaLengthMm = nullablePositiveNumber(draft.workAreaLengthMm);

  if (
    draft.validationLeadLengthMm.trim() === '' ||
    !Number.isFinite(validationLeadLengthMm) ||
    validationLeadLengthMm <= 0
  ) {
    errors.validationLeadLengthMm = 'Lead length must be greater than 0 mm.';
  }
  if (
    draft.coordinatePrecision.trim() === '' ||
    !Number.isInteger(coordinatePrecision) ||
    coordinatePrecision < 0 ||
    coordinatePrecision > 6
  ) {
    errors.coordinatePrecision =
      'Coordinate precision must be a whole number from 0 to 6.';
  }
  if (workAreaWidthMm === undefined) {
    errors.workAreaWidthMm = 'Work-area width must be blank or greater than 0 mm.';
  }
  if (workAreaLengthMm === undefined) {
    errors.workAreaLengthMm = 'Work-area length must be blank or greater than 0 mm.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    coordinatePrecision,
    validationLeadLengthMm,
    workAreaLengthMm: workAreaLengthMm!,
    workAreaWidthMm: workAreaWidthMm!
  };
}

function nullablePositiveNumber(value: string): number | null | undefined {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

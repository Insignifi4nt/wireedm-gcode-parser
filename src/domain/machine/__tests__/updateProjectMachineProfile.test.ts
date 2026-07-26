import { describe, expect, it } from 'vitest';

import {
  machineProfileHasCurrentVerification,
  machineProfileVerificationFingerprint,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  projectMachineProfileDraft,
  updateProjectMachineProfile
} from '@/domain/machine/updateProjectMachineProfile';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';

describe('updateProjectMachineProfile', () => {
  it('updates only the project snapshot and invalidates verification after causal edits', () => {
    const project = createWorkbenchProject({
      id: 'project-machine-snapshot',
      name: 'Project machine snapshot',
      now: new Date('2026-07-27T09:00:00.000Z'),
      sourceKind: 'dxf'
    });
    project.machine = markMachineProfileUserVerified(project.machine);
    const originalProject = structuredClone(project);

    const result = updateProjectMachineProfile(
      project,
      {
        ...projectMachineProfileDraft(project.machine),
        coordinatePrecision: '4',
        validationLeadLengthMm: '0.0004',
        workAreaLengthMm: '45',
        workAreaWidthMm: ''
      }
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Expected a valid project-machine update.');
    expect(result.project).not.toBe(project);
    expect(result.project.machine).not.toBe(project.machine);
    expect(result.project.machine).toMatchObject({
      id: originalProject.machine.id,
      controller: {
        family: originalProject.machine.controller.family,
        verification: { status: 'unverified' }
      },
      compensation: {
        validationLeadLengthMm: 0.0004
      },
      output: {
        coordinatePrecision: 4,
        extension: originalProject.machine.output.extension
      },
      workArea: {
        widthMm: null,
        lengthMm: 45
      }
    });
    expect(project).toEqual(originalProject);
    expect(machineProfileHasCurrentVerification(result.project.machine)).toBe(false);
  });

  it('marks the validated project snapshot reviewed only through the explicit review option', () => {
    const project = createWorkbenchProject({
      id: 'reviewed-project-machine',
      name: 'Reviewed project machine',
      sourceKind: 'dxf'
    });
    const reviewedAt = new Date('2026-07-27T10:30:00.000Z');

    const result = updateProjectMachineProfile(
      project,
      {
        ...projectMachineProfileDraft(project.machine),
        coordinatePrecision: '5'
      },
      { reviewedAt }
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Expected a reviewed project-machine update.');
    expect(result.project.machine.controller.verification).toMatchObject({
      status: 'user-verified',
      verifiedAt: reviewedAt.toISOString()
    });
    expect(machineProfileHasCurrentVerification(result.project.machine)).toBe(true);
  });

  it('creates a new current fingerprint when only the validation lead is reviewed', () => {
    const project = createWorkbenchProject({
      id: 'reviewed-project-machine-lead',
      name: 'Reviewed project machine lead',
      sourceKind: 'dxf'
    });
    project.machine = markMachineProfileUserVerified(
      project.machine,
      new Date('2026-07-27T09:00:00.000Z')
    );
    const originalFingerprint = machineProfileVerificationFingerprint(project.machine);

    const result = updateProjectMachineProfile(
      project,
      {
        ...projectMachineProfileDraft(project.machine),
        validationLeadLengthMm: '0.5'
      },
      { reviewedAt: new Date('2026-07-27T10:30:00.000Z') }
    );

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('Expected a reviewed project-machine update.');
    expect(machineProfileVerificationFingerprint(result.project.machine)).not.toBe(
      originalFingerprint
    );
    expect(result.project.machine.controller.verification.verifiedFingerprint).toBe(
      machineProfileVerificationFingerprint(result.project.machine)
    );
    expect(machineProfileHasCurrentVerification(result.project.machine)).toBe(true);
  });

  it.each([
    ['validationLeadLengthMm', '0', 'Lead length must be greater than 0 mm.'],
    ['coordinatePrecision', '2.5', 'Coordinate precision must be a whole number from 0 to 6.'],
    ['coordinatePrecision', '7', 'Coordinate precision must be a whole number from 0 to 6.'],
    ['workAreaWidthMm', '-1', 'Work-area width must be blank or greater than 0 mm.'],
    ['workAreaLengthMm', 'NaN', 'Work-area length must be blank or greater than 0 mm.']
  ] as const)('rejects invalid %s truthfully', (field, value, message) => {
    const project = createWorkbenchProject({
      id: `invalid-${field}`,
      name: 'Invalid machine edit',
      sourceKind: 'dxf'
    });
    const draft = {
      ...projectMachineProfileDraft(project.machine),
      [field]: value
    };

    const result = updateProjectMachineProfile(project, draft);

    expect(result).toEqual({
      ok: false,
      errors: {
        [field]: message
      }
    });
  });
});

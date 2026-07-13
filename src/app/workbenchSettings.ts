import { serializeMachineProfileFile } from '@/domain/machine/machineProfileFile';
import {
  machineProfileVerificationFingerprint,
  markMachineProfileUserVerified,
  normalizeMachineProfile,
  normalizeOutput
} from '@/domain/machine/machineProfiles';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type {
  MachineCompensationPolicy,
  MachineControllerPolicy,
  MachineProfile,
  MachineProfileVerification,
  OutputExtension
} from '@/domain/workbench/types';

export interface SettingsDraft {
  activation: MachineCompensationPolicy['activation'];
  arcCenterMode: MachineControllerPolicy['arcCenterMode'];
  blockFormatting: MachineControllerPolicy['blockFormatting'];
  cancellation: MachineCompensationPolicy['cancellation'];
  compensationEnabledByDefault: boolean;
  compensationSupported: boolean;
  controllerFamily: MachineControllerPolicy['family'];
  coordinatePrecision: string;
  coordinateSystem: MachineControllerPolicy['coordinateSystem'];
  customExtension: string;
  dRegisterIndex: string;
  distanceMode: MachineControllerPolicy['distanceMode'];
  expectedMaximumOffsetMm: string;
  extension: OutputExtension;
  footer: string;
  header: string;
  lifecycleScope: MachineCompensationPolicy['lifecycleScope'];
  lineEnding: 'lf' | 'crlf';
  machineName: string;
  notes: string;
  planeCode: MachineControllerPolicy['planeCode'];
  postVersion: string;
  preActivationCodes: string;
  profileId: string;
  programEnd: MachineControllerPolicy['programEnd'];
  sourceKey: string;
  unitsCode: MachineControllerPolicy['unitsCode'];
  validationLeadLengthMm: string;
  verificationStatus: MachineProfileVerification['status'];
  workAreaLengthMm: string;
  workAreaWidthMm: string;
  workOffsetCode: MachineControllerPolicy['workOffsetCode'];
}

export function settingsDraftFromWorkbench(
  workbench: ConnectedWorkbench | null,
  selectedProfileId?: string
): SettingsDraft {
  if (!workbench) return emptySettingsDraft();

  const profile =
    workbench.manifest.machineProfiles.find(({ id }) => id === selectedProfileId) ??
    workbench.activeMachineProfile;

  return settingsDraftFromProfile(
    profile,
    [workbench.adapter.kind, workbench.adapter.name, JSON.stringify(profile)].join('\u0000')
  );
}

export function machineProfileFromSettingsDraft(
  sourceProfile: MachineProfile,
  draft: SettingsDraft
): MachineProfile {
  const candidate = profileCandidateFromSettingsDraft(sourceProfile, draft);

  // The portable codec is the strict, versioned profile boundary. Reusing it here
  // keeps settings validation aligned with import/export instead of silently
  // normalizing malformed controller values.
  serializeMachineProfileFile(candidate);
  return normalizeMachineProfile(candidate);
}

export function acknowledgeMachineProfileFromSettingsDraft(
  sourceProfile: MachineProfile,
  draft: SettingsDraft,
  now: Date = new Date()
) {
  return markMachineProfileUserVerified(
    machineProfileFromSettingsDraft(sourceProfile, draft),
    now
  );
}

export function applySettingsDraftPatch(
  sourceProfile: MachineProfile,
  draft: SettingsDraft,
  patch: Partial<Omit<SettingsDraft, 'sourceKey'>>
): SettingsDraft {
  const next = { ...draft, ...patch };
  const previousFingerprint = machineProfileVerificationFingerprint(
    profileCandidateFromSettingsDraft(sourceProfile, draft)
  );
  const nextFingerprint = machineProfileVerificationFingerprint(
    profileCandidateFromSettingsDraft(sourceProfile, next)
  );

  return {
    ...next,
    verificationStatus:
      previousFingerprint === nextFingerprint ? draft.verificationStatus : 'unverified'
  };
}

export function settingsDraftValidationMessage(
  sourceProfile: MachineProfile,
  draft: SettingsDraft
) {
  try {
    machineProfileFromSettingsDraft(sourceProfile, draft);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Machine profile settings are invalid.';
  }
}

export function workbenchSettingsInputFromDraft(
  activeWorkbench: ConnectedWorkbench,
  draft: SettingsDraft
): UpdateWorkbenchSettingsInput {
  const machineProfile = machineProfileFromSettingsDraft(
    activeWorkbench.activeMachineProfile,
    draft
  );

  return {
    header: machineProfile.templates.header,
    footer: machineProfile.templates.footer,
    machineProfile,
    output: machineProfile.output
  };
}

function settingsDraftFromProfile(profile: MachineProfile, sourceKey: string): SettingsDraft {
  return {
    activation: profile.compensation.activation,
    arcCenterMode: profile.controller.arcCenterMode,
    blockFormatting: profile.controller.blockFormatting,
    cancellation: profile.compensation.cancellation,
    compensationEnabledByDefault: profile.compensation.enabledByDefault,
    compensationSupported: profile.compensation.supported,
    controllerFamily: profile.controller.family,
    coordinatePrecision: profile.output.coordinatePrecision.toString(),
    coordinateSystem: profile.controller.coordinateSystem,
    customExtension: profile.output.customExtension ?? '',
    dRegisterIndex: profile.compensation.offsetSelection.index.toString(),
    distanceMode: profile.controller.distanceMode,
    expectedMaximumOffsetMm:
      profile.compensation.expectedMaximumOffsetMm?.toString() ?? '',
    extension: profile.output.extension,
    footer: profile.templates.footer,
    header: profile.templates.header,
    lifecycleScope: profile.compensation.lifecycleScope,
    lineEnding: profile.output.lineEnding,
    machineName: profile.name,
    notes: profile.notes,
    planeCode: profile.controller.planeCode,
    postVersion: profile.controller.postVersion.toString(),
    preActivationCodes: profile.compensation.preActivationCodes.join('\n'),
    profileId: profile.id,
    programEnd: profile.controller.programEnd,
    sourceKey,
    unitsCode: profile.controller.unitsCode,
    validationLeadLengthMm: profile.compensation.validationLeadLengthMm.toString(),
    verificationStatus: profile.controller.verification.status,
    workAreaLengthMm: profile.workArea.lengthMm?.toString() ?? '',
    workAreaWidthMm: profile.workArea.widthMm?.toString() ?? '',
    workOffsetCode: profile.controller.workOffsetCode
  };
}

function profileCandidateFromSettingsDraft(
  sourceProfile: MachineProfile,
  draft: SettingsDraft
): MachineProfile {
  const output = normalizeOutput({
    extension: draft.extension,
    customExtension: draft.extension === 'custom' ? draft.customExtension : undefined,
    lineEnding: draft.lineEnding,
    coordinatePrecision: numberOrNaN(draft.coordinatePrecision)
  });
  output.coordinatePrecision = numberOrNaN(draft.coordinatePrecision);
  const verification = verificationForDraft(sourceProfile, draft);

  return {
    ...sourceProfile,
    id: draft.profileId,
    name: draft.machineName,
    controller: {
      family: draft.controllerFamily,
      postVersion: numberOrNaN(draft.postVersion),
      verification,
      blockFormatting: draft.blockFormatting,
      coordinateSystem: draft.coordinateSystem,
      unitsCode: draft.unitsCode,
      planeCode: draft.planeCode,
      workOffsetCode: draft.workOffsetCode,
      distanceMode: draft.distanceMode,
      arcCenterMode: draft.arcCenterMode,
      programEnd: draft.programEnd
    },
    compensation: {
      supported: draft.compensationSupported,
      enabledByDefault: draft.compensationEnabledByDefault,
      offsetSelection: { address: 'D', index: numberOrNaN(draft.dRegisterIndex) },
      activation: draft.activation,
      cancellation: draft.cancellation,
      lifecycleScope: draft.lifecycleScope,
      preActivationCodes: linesOrEmpty(draft.preActivationCodes),
      validationLeadLengthMm: numberOrNaN(draft.validationLeadLengthMm),
      expectedMaximumOffsetMm: nullableNumberOrNaN(draft.expectedMaximumOffsetMm)
    },
    templates: { header: draft.header, footer: draft.footer },
    output,
    workArea: {
      widthMm: nullableNumberOrNaN(draft.workAreaWidthMm),
      lengthMm: nullableNumberOrNaN(draft.workAreaLengthMm)
    },
    notes: draft.notes
  };
}

function verificationForDraft(
  sourceProfile: MachineProfile,
  draft: SettingsDraft
): MachineProfileVerification {
  if (draft.verificationStatus !== 'user-verified') return { status: 'unverified' };
  return sourceProfile.controller.verification.status === 'user-verified'
    ? { ...sourceProfile.controller.verification }
    : { status: 'unverified' };
}

function linesOrEmpty(value: string) {
  return value === '' ? [] : value.split(/\r?\n/);
}

function nullableNumberOrNaN(value: string) {
  return value.trim() === '' ? null : Number(value);
}

function numberOrNaN(value: string) {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function emptySettingsDraft(): SettingsDraft {
  return {
    activation: 'linear-lead',
    arcCenterMode: 'incremental-from-start',
    blockFormatting: 'spaced',
    cancellation: 'linear-lead-out',
    compensationEnabledByDefault: false,
    compensationSupported: false,
    controllerFamily: 'custom',
    coordinatePrecision: '3',
    coordinateSystem: 'template-managed',
    customExtension: '',
    dRegisterIndex: '0',
    distanceMode: 'G90',
    expectedMaximumOffsetMm: '',
    extension: 'iso',
    footer: '',
    header: '',
    lifecycleScope: 'operation',
    lineEnding: 'crlf',
    machineName: '',
    notes: '',
    planeCode: 'omit',
    postVersion: '1',
    preActivationCodes: '',
    profileId: '',
    programEnd: 'template-managed',
    sourceKey: 'none',
    unitsCode: 'omit',
    validationLeadLengthMm: '2',
    verificationStatus: 'unverified',
    workAreaLengthMm: '',
    workAreaWidthMm: '',
    workOffsetCode: 'template-managed'
  };
}

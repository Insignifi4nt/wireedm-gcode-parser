import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type {
  MachineCompensationPolicy,
  MachineControllerPolicy,
  MachineProfile,
  MachineProfileVerification,
  OutputFormat
} from '@/domain/workbench/types';

function unverified(): MachineProfileVerification {
  return { status: 'unverified' };
}

export function normalizeMachineProfile(profile: Partial<MachineProfile> | null | undefined): MachineProfile {
  const fallback = createDefaultMachineProfile();
  const output = normalizeOutput(profile?.output ?? fallback.output);
  const controller = normalizeController(profile?.controller, fallback.controller);
  const compensation = normalizeCompensation(profile?.compensation, fallback.compensation);
  const normalizedWithoutVerification: MachineProfile = {
    id: profile?.id?.trim() || fallback.id,
    name: profile?.name?.trim() || fallback.name,
    preferredDxfImportUnit: normalizePreferredDxfImportUnit(
      profile?.preferredDxfImportUnit
    ),
    controller: { ...controller, verification: unverified() },
    compensation,
    templates: {
      header: profile?.templates?.header ?? fallback.templates.header,
      footer: profile?.templates?.footer ?? fallback.templates.footer
    },
    output,
    workArea: {
      widthMm: normalizeNullableLimit(profile?.workArea?.widthMm),
      lengthMm: normalizeNullableLimit(profile?.workArea?.lengthMm)
    },
    notes: profile?.notes ?? fallback.notes
  };

  return {
    ...normalizedWithoutVerification,
    controller: {
      ...controller,
      verification: normalizeVerification(
        controller.verification,
        machineProfileVerificationFingerprint(normalizedWithoutVerification),
        legacyMachineProfileVerificationFingerprint(normalizedWithoutVerification)
      )
    }
  };
}

export function createBlankMachineProfile(id = 'untitled-wire-machine'): MachineProfile {
  return normalizeMachineProfile({
    ...createDefaultMachineProfile(),
    id,
    name: 'Untitled Wire EDM',
    controller: {
      family: 'custom',
      postVersion: 1,
      verification: unverified(),
      blockFormatting: 'spaced',
      coordinateSystem: 'template-managed',
      unitsCode: 'omit',
      planeCode: 'omit',
      workOffsetCode: 'template-managed',
      distanceMode: 'G90',
      arcCenterMode: 'incremental-from-start',
      programEnd: 'template-managed'
    },
    compensation: {
      supported: false,
      enabledByDefault: false,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'linear-lead',
      cancellation: 'linear-lead-out',
      lifecycleScope: 'operation',
      preActivationCodes: [],
      validationLeadLengthMm: 2,
      expectedMaximumOffsetMm: null
    },
    templates: { header: '', footer: '' },
    workArea: { widthMm: null, lengthMm: null },
    notes: ''
  });
}

export function createCharmillesRobofilClassicProfile(
  id = 'charmilles-robofil-classic'
): MachineProfile {
  return normalizeMachineProfile({
    ...createDefaultMachineProfile(),
    id,
    name: 'Charmilles Robofil Classic',
    controller: {
      family: 'charmilles-robofil-classic',
      postVersion: 1,
      verification: unverified(),
      blockFormatting: 'spaced',
      coordinateSystem: 'wire-position-g92',
      unitsCode: 'omit',
      planeCode: 'omit',
      workOffsetCode: 'template-managed',
      distanceMode: 'G90',
      arcCenterMode: 'incremental-from-start',
      programEnd: 'M30'
    },
    compensation: {
      supported: true,
      enabledByDefault: true,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'linear-lead',
      cancellation: 'linear-lead-out',
      lifecycleScope: 'operation',
      preActivationCodes: [],
      validationLeadLengthMm: 2,
      expectedMaximumOffsetMm: 0.5
    },
    templates: {
      header: ['%', 'G90 G21 G17 G40'].join('\n'),
      footer: ['G40', 'M30', '%'].join('\n')
    },
    notes: 'Verify controller dialect and compensation behavior with graphics and a dry run before use.'
  });
}

export function createVerifiedCharmillesRobofil100Profile(
  id = 'charmilles-robofil-100-verified',
  verifiedAt: Date = new Date()
): MachineProfile {
  const profile = normalizeMachineProfile({
    ...createDefaultMachineProfile(),
    id,
    name: 'Charmilles Robofil 100 / Classic (verified 2026-07-13)',
    controller: {
      family: 'charmilles-robofil-classic',
      postVersion: 1,
      verification: unverified(),
      blockFormatting: 'spaced',
      coordinateSystem: 'wire-position-g92',
      unitsCode: 'omit',
      planeCode: 'omit',
      workOffsetCode: 'omit',
      distanceMode: 'G90',
      arcCenterMode: 'absolute',
      programEnd: 'M02'
    },
    compensation: {
      supported: true,
      enabledByDefault: true,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'charmilles-g38',
      cancellation: 'program-end',
      lifecycleScope: 'program',
      preActivationCodes: ['G60'],
      validationLeadLengthMm: 2,
      expectedMaximumOffsetMm: 0.5
    },
    templates: { header: '', footer: '' },
    output: {
      extension: 'iso',
      lineEnding: 'crlf',
      coordinatePrecision: 3
    },
    notes: 'Physically verified on the local Charmilles Robofil 100 on 2026-07-13; confirm D0 before every job.'
  });

  return markMachineProfileUserVerified(profile, verifiedAt);
}

export function createCharmillesRobofil100V2CandidateProfile(
  id = 'charmilles-robofil-100-v2-candidate'
): MachineProfile {
  return normalizeMachineProfile({
    ...createDefaultMachineProfile(),
    id,
    name: 'Charmilles Robofil 100 / Classic (v2 multi-contour candidate)',
    controller: {
      family: 'charmilles-robofil-classic',
      postVersion: 2,
      verification: unverified(),
      blockFormatting: 'spaced',
      coordinateSystem: 'wire-position-g92',
      unitsCode: 'omit',
      planeCode: 'omit',
      workOffsetCode: 'omit',
      distanceMode: 'G90',
      arcCenterMode: 'absolute',
      programEnd: 'M02'
    },
    compensation: {
      supported: true,
      enabledByDefault: true,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'charmilles-g38',
      cancellation: 'charmilles-g39',
      lifecycleScope: 'operation',
      preActivationCodes: ['G60'],
      validationLeadLengthMm: 2,
      expectedMaximumOffsetMm: 0.5
    },
    templates: { header: '', footer: '' },
    output: {
      extension: 'iso',
      lineEnding: 'crlf',
      coordinatePrecision: 3
    },
    notes: [
      'Candidate multi-contour post: emits operation-scoped G39/G40 boundaries before rapid travel.',
      'Verify in controller graphics, SIM mode, and a supervised dry run before cutting.'
    ].join(' ')
  });
}

export function machineProfileVerificationFingerprint(profile: MachineProfile): string {
  return JSON.stringify({
    family: profile.controller.family,
    postVersion: profile.controller.postVersion,
    blockFormatting: profile.controller.blockFormatting,
    coordinateSystem: profile.controller.coordinateSystem,
    unitsCode: profile.controller.unitsCode,
    planeCode: profile.controller.planeCode,
    workOffsetCode: profile.controller.workOffsetCode,
    distanceMode: profile.controller.distanceMode,
    arcCenterMode: profile.controller.arcCenterMode,
    programEnd: profile.controller.programEnd,
    supported: profile.compensation.supported,
    offsetSelection: profile.compensation.offsetSelection,
    activation: profile.compensation.activation,
    cancellation: profile.compensation.cancellation,
    lifecycleScope: profile.compensation.lifecycleScope,
    preActivationCodes: profile.compensation.preActivationCodes,
    templates: profile.templates,
    lineEnding: profile.output.lineEnding,
    coordinatePrecision: profile.output.coordinatePrecision
  });
}

export function machineProfileHasCurrentVerification(profile: MachineProfile) {
  const verification = profile.controller.verification;
  if (verification.status !== 'user-verified' || !verification.verifiedAt) return false;
  return (
    verification.verifiedFingerprint === machineProfileVerificationFingerprint(profile) ||
    verification.verifiedFingerprint === legacyMachineProfileVerificationFingerprint(profile)
  );
}

function legacyMachineProfileVerificationFingerprint(profile: MachineProfile): string {
  return JSON.stringify({
    family: profile.controller.family,
    postVersion: profile.controller.postVersion,
    blockFormatting: profile.controller.blockFormatting,
    coordinateSystem: profile.controller.coordinateSystem,
    unitsCode: profile.controller.unitsCode,
    planeCode: profile.controller.planeCode,
    workOffsetCode: profile.controller.workOffsetCode,
    distanceMode: profile.controller.distanceMode,
    arcCenterMode: profile.controller.arcCenterMode,
    programEnd: profile.controller.programEnd,
    supported: profile.compensation.supported,
    enabledByDefault: profile.compensation.enabledByDefault,
    offsetSelection: profile.compensation.offsetSelection,
    activation: profile.compensation.activation,
    cancellation: profile.compensation.cancellation,
    lifecycleScope: profile.compensation.lifecycleScope,
    preActivationCodes: profile.compensation.preActivationCodes,
    templates: profile.templates,
    lineEnding: profile.output.lineEnding,
    coordinatePrecision: profile.output.coordinatePrecision
  });
}

export function markMachineProfileUserVerified(
  profile: MachineProfile,
  now: Date = new Date()
): MachineProfile {
  const normalized = normalizeMachineProfile(profile);
  return {
    ...normalized,
    controller: {
      ...normalized.controller,
      verification: {
        status: 'user-verified',
        verifiedAt: now.toISOString(),
        verifiedFingerprint: machineProfileVerificationFingerprint(normalized)
      }
    }
  };
}

export function machineProfileFromLegacySettings(input: {
  header: string;
  footer: string;
  output: Partial<OutputFormat> & Pick<OutputFormat, 'extension' | 'lineEnding'>;
}) {
  const fallback = createDefaultMachineProfile();

  return normalizeMachineProfile({
    ...fallback,
    templates: {
      header: input.header,
      footer: input.footer
    },
    output: normalizeOutput(input.output)
  });
}

export function upsertMachineProfile(
  profiles: MachineProfile[],
  profile: MachineProfile
): MachineProfile[] {
  const normalized = normalizeMachineProfile(profile);
  const existingIndex = profiles.findIndex((candidate) => candidate.id === normalized.id);

  if (existingIndex === -1) return [...profiles.map(normalizeMachineProfile), normalized];

  return profiles.map((candidate, index) => (index === existingIndex ? normalized : normalizeMachineProfile(candidate)));
}

export function activeMachineProfileFromList(
  profiles: MachineProfile[],
  activeMachineProfileId: string | undefined
) {
  const normalizedProfiles = profiles.map(normalizeMachineProfile);
  return (
    normalizedProfiles.find((profile) => profile.id === activeMachineProfileId) ??
    normalizedProfiles[0] ??
    createDefaultMachineProfile()
  );
}

export function normalizeOutput(
  output: Partial<OutputFormat> & Pick<OutputFormat, 'extension' | 'lineEnding'>
): OutputFormat {
  const normalized: OutputFormat = {
    extension: output.extension,
    lineEnding: output.lineEnding,
    coordinatePrecision: normalizeCoordinatePrecision(output.coordinatePrecision)
  };

  if (output.extension === 'custom') {
    const customExtension = output.customExtension?.trim().replace(/^\.+/, '').toLowerCase();
    if (customExtension) normalized.customExtension = customExtension;
  }

  return normalized;
}

export function normalizeCoordinatePrecision(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : 3;
}

function normalizeNullableLimit(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizePreferredDxfImportUnit(value: unknown): MachineProfile['preferredDxfImportUnit'] {
  return value === 'millimeters' || value === 'inches' ? value : null;
}

function normalizeController(
  controller: MachineControllerPolicy | undefined,
  fallback: MachineControllerPolicy
): MachineControllerPolicy {
  if (!controller) return { ...fallback, verification: unverified() };

  return {
    family: ['generic-iso', 'charmilles-robofil-classic', 'custom'].includes(controller.family)
      ? controller.family
      : fallback.family,
    postVersion: Number.isSafeInteger(controller.postVersion) && controller.postVersion > 0
      ? controller.postVersion
      : fallback.postVersion,
    verification: controller.verification ?? unverified(),
    blockFormatting: ['spaced', 'compact'].includes(controller.blockFormatting)
      ? controller.blockFormatting
      : fallback.blockFormatting,
    coordinateSystem: ['template-managed', 'work-offset', 'wire-position-g92'].includes(controller.coordinateSystem)
      ? controller.coordinateSystem
      : fallback.coordinateSystem,
    unitsCode: ['G20', 'G21', 'omit'].includes(controller.unitsCode)
      ? controller.unitsCode
      : fallback.unitsCode,
    planeCode: ['G17', 'omit'].includes(controller.planeCode)
      ? controller.planeCode
      : fallback.planeCode,
    workOffsetCode: ['G54', 'omit', 'template-managed'].includes(controller.workOffsetCode)
      ? controller.workOffsetCode
      : fallback.workOffsetCode,
    distanceMode: controller.distanceMode === 'G90' ? 'G90' : fallback.distanceMode,
    arcCenterMode: ['incremental-from-start', 'absolute'].includes(controller.arcCenterMode)
      ? controller.arcCenterMode
      : fallback.arcCenterMode,
    programEnd: ['M02', 'M30', 'template-managed'].includes(controller.programEnd)
      ? controller.programEnd
      : fallback.programEnd
  };
}

function normalizeCompensation(
  compensation: MachineCompensationPolicy | undefined,
  fallback: MachineCompensationPolicy
): MachineCompensationPolicy {
  if (!compensation) return { ...fallback, enabledByDefault: false, supported: false };

  const supported = compensation.supported === true;
  return {
    supported,
    enabledByDefault: supported && compensation.enabledByDefault === true,
    offsetSelection: {
      address: 'D',
      index: Number.isInteger(compensation.offsetSelection?.index) && compensation.offsetSelection.index >= 0
        ? compensation.offsetSelection.index
        : fallback.offsetSelection.index
    },
    activation: ['linear-lead', 'charmilles-g38'].includes(compensation.activation)
      ? compensation.activation
      : fallback.activation,
    cancellation: ['linear-lead-out', 'charmilles-g39', 'program-end'].includes(compensation.cancellation)
      ? compensation.cancellation
      : fallback.cancellation,
    lifecycleScope: ['operation', 'program'].includes(compensation.lifecycleScope)
      ? compensation.lifecycleScope
      : fallback.lifecycleScope,
    preActivationCodes: normalizePreActivationCodes(compensation.preActivationCodes),
    validationLeadLengthMm: isPositiveFinite(compensation.validationLeadLengthMm)
      ? compensation.validationLeadLengthMm
      : fallback.validationLeadLengthMm,
    expectedMaximumOffsetMm: compensation.expectedMaximumOffsetMm === null
      ? null
      : isPositiveFinite(compensation.expectedMaximumOffsetMm)
        ? compensation.expectedMaximumOffsetMm
        : fallback.expectedMaximumOffsetMm
  };
}

function normalizePreActivationCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16) return [];
  return value.every(isSafePreActivationCode) ? [...value] : [];
}

function isSafePreActivationCode(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[\x20-\x7e]+$/.test(value);
}

function normalizeVerification(
  verification: MachineProfileVerification,
  currentFingerprint: string,
  legacyFingerprint: string
): MachineProfileVerification {
  if (
    verification.status !== 'user-verified' ||
    !verification.verifiedAt ||
    (verification.verifiedFingerprint !== currentFingerprint &&
      verification.verifiedFingerprint !== legacyFingerprint)
  ) {
    return unverified();
  }

  return {
    status: 'user-verified',
    verifiedAt: verification.verifiedAt,
    verifiedFingerprint: currentFingerprint
  };
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

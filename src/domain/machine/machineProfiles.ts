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
        machineProfileVerificationFingerprint(normalizedWithoutVerification)
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
      verification: unverified(),
      blockFormatting: 'spaced',
      coordinateSystem: 'template-managed',
      programEnd: 'template-managed'
    },
    compensation: {
      supported: false,
      enabledByDefault: false,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'linear-lead',
      cancellation: 'linear-lead-out',
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
      verification: unverified(),
      blockFormatting: 'spaced',
      coordinateSystem: 'wire-position-g92',
      programEnd: 'M30'
    },
    compensation: {
      supported: true,
      enabledByDefault: true,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'linear-lead',
      cancellation: 'linear-lead-out',
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

export function machineProfileVerificationFingerprint(profile: MachineProfile): string {
  return JSON.stringify({
    family: profile.controller.family,
    blockFormatting: profile.controller.blockFormatting,
    coordinateSystem: profile.controller.coordinateSystem,
    programEnd: profile.controller.programEnd,
    offsetSelection: profile.compensation.offsetSelection,
    activation: profile.compensation.activation,
    cancellation: profile.compensation.cancellation
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

function normalizeController(
  controller: MachineControllerPolicy | undefined,
  fallback: MachineControllerPolicy
): MachineControllerPolicy {
  if (!controller) return { ...fallback, verification: unverified() };

  return {
    family: ['generic-iso', 'charmilles-robofil-classic', 'custom'].includes(controller.family)
      ? controller.family
      : fallback.family,
    verification: controller.verification ?? unverified(),
    blockFormatting: ['spaced', 'compact'].includes(controller.blockFormatting)
      ? controller.blockFormatting
      : fallback.blockFormatting,
    coordinateSystem: ['template-managed', 'work-offset', 'wire-position-g92'].includes(controller.coordinateSystem)
      ? controller.coordinateSystem
      : fallback.coordinateSystem,
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
    cancellation: ['linear-lead-out', 'charmilles-g39'].includes(compensation.cancellation)
      ? compensation.cancellation
      : fallback.cancellation,
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

function normalizeVerification(
  verification: MachineProfileVerification,
  currentFingerprint: string
): MachineProfileVerification {
  if (
    verification.status !== 'user-verified' ||
    !verification.verifiedAt ||
    verification.verifiedFingerprint !== currentFingerprint
  ) {
    return unverified();
  }

  return {
    status: 'user-verified',
    verifiedAt: verification.verifiedAt,
    verifiedFingerprint: verification.verifiedFingerprint
  };
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

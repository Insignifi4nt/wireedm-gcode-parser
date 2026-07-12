import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile, OutputFormat } from '@/domain/workbench/types';

export function normalizeMachineProfile(profile: Partial<MachineProfile> | null | undefined): MachineProfile {
  const fallback = createDefaultMachineProfile();
  const output = normalizeOutput(profile?.output ?? fallback.output);

  return {
    id: profile?.id?.trim() || fallback.id,
    name: profile?.name?.trim() || fallback.name,
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

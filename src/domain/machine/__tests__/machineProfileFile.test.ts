import { describe, expect, it } from 'vitest';

import {
  createBlankMachineProfile,
  createCharmillesRobofilClassicProfile,
  markMachineProfileUserVerified
} from '../machineProfiles';
import {
  parseMachineProfileFile,
  planMachineProfileImport,
  serializeMachineProfileFile
} from '../machineProfileFile';

const now = new Date('2026-07-13T09:30:00.000Z');

function portableDocument(profile: ReturnType<typeof createBlankMachineProfile>) {
  return {
    format: 'wire-edm-machine-profile',
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    profile
  };
}

describe('portable machine profile files', () => {
  it('round-trips one versioned portable profile and resets imported verification', () => {
    const verifiedRobofil = markMachineProfileUserVerified(createCharmillesRobofilClassicProfile(), now);
    const text = serializeMachineProfileFile(verifiedRobofil, now);
    const parsed = parseMachineProfileFile(text);

    expect(JSON.parse(text)).toMatchObject({
      format: 'wire-edm-machine-profile',
      schemaVersion: 1,
      exportedAt: now.toISOString()
    });
    expect(parsed.id).toBe(verifiedRobofil.id);
    expect(parsed.controller.verification.status).toBe('unverified');
  });

  it('rejects files larger than 256 KiB before parsing', () => {
    expect(() => parseMachineProfileFile(' '.repeat(256 * 1024 + 1))).toThrow(/256 KiB/i);
  });

  it('rejects malformed JSON and unsupported wrappers', () => {
    expect(() => parseMachineProfileFile('{')).toThrow(/JSON/i);
    expect(() => parseMachineProfileFile(JSON.stringify({
      ...portableDocument(createBlankMachineProfile()),
      schemaVersion: 2
    }))).toThrow(/schema/i);
    expect(() => parseMachineProfileFile(JSON.stringify({
      ...portableDocument(createBlankMachineProfile()),
      format: 'other-profile'
    }))).toThrow(/format/i);
  });

  it('rejects NUL template content', () => {
    const profile = createBlankMachineProfile();
    profile.templates.header = 'G40\0M30';

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/NUL/i);
  });

  it('rejects templates longer than 64 KiB', () => {
    const profile = createBlankMachineProfile();
    profile.templates.footer = 'G'.repeat(64 * 1024 + 1);

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/profile/i);
  });

  it('rejects notes longer than 16 KiB', () => {
    const profile = createBlankMachineProfile();
    profile.notes = 'n'.repeat(16 * 1024 + 1);

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/profile/i);
  });

  it.each([
    { label: 'blank ID', mutate: (profile: Record<string, unknown>) => { profile.id = ' '; } },
    { label: 'unsafe ID', mutate: (profile: Record<string, unknown>) => { profile.id = '../machine'; } },
    { label: 'overlong ID', mutate: (profile: Record<string, unknown>) => { profile.id = 'a'.repeat(65); } },
    { label: 'overlong name', mutate: (profile: Record<string, unknown>) => { profile.name = 'n'.repeat(121); } },
    { label: 'invalid extension', mutate: (profile: Record<string, unknown>) => {
      (profile.output as Record<string, unknown>).extension = 'tap';
    } },
    { label: 'invalid line ending', mutate: (profile: Record<string, unknown>) => {
      (profile.output as Record<string, unknown>).lineEnding = 'native';
    } },
    { label: 'invalid precision', mutate: (profile: Record<string, unknown>) => {
      (profile.output as Record<string, unknown>).coordinatePrecision = 7;
    } },
    { label: 'invalid work area', mutate: (profile: Record<string, unknown>) => {
      (profile.workArea as Record<string, unknown>).widthMm = 0;
    } },
    { label: 'invalid controller family', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).family = 'unknown';
    } },
    { label: 'invalid D index', mutate: (profile: Record<string, unknown>) => {
      (((profile.compensation as Record<string, unknown>).offsetSelection) as Record<string, unknown>).index = -1;
    } },
    { label: 'invalid lead length', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).validationLeadLengthMm = 0;
    } },
    { label: 'invalid offset envelope', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).expectedMaximumOffsetMm = -0.5;
    } }
  ])('rejects $label', ({ mutate }) => {
    const profile = createCharmillesRobofilClassicProfile() as unknown as Record<string, unknown>;
    mutate(profile);

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(
      profile as unknown as ReturnType<typeof createBlankMachineProfile>
    )))).toThrow(/profile/i);
  });

  it('strips unknown keys while reconstructing an imported profile', () => {
    const document = portableDocument(createBlankMachineProfile()) as Record<string, unknown>;
    const profile = document.profile as ReturnType<typeof createBlankMachineProfile> & { injected?: string };
    profile.injected = 'discard me';
    (profile.output as typeof profile.output & { injected?: string }).injected = 'discard me';
    document.injected = 'discard me';

    const parsed = parseMachineProfileFile(JSON.stringify(document));

    expect(parsed).not.toHaveProperty('injected');
    expect(parsed.output).not.toHaveProperty('injected');
  });

  it('selects the installed profile for a semantic duplicate', () => {
    const existing = markMachineProfileUserVerified(createCharmillesRobofilClassicProfile(), now);
    const imported = createCharmillesRobofilClassicProfile();

    expect(planMachineProfileImport([existing], imported)).toEqual({
      kind: 'already-installed',
      profile: existing
    });
  });

  it('adds a profile whose ID is not installed', () => {
    const imported = createBlankMachineProfile('shop-machine');

    expect(planMachineProfileImport([], imported)).toEqual({ kind: 'add', profile: imported });
  });

  it('imports a conflicting ID as a deterministic copy', () => {
    const existing = createBlankMachineProfile('shop-machine');
    existing.name = 'Shop Machine';
    const occupiedCopy = createBlankMachineProfile('shop-machine-2');
    const changed = { ...existing, notes: 'Different setup.' };

    expect(planMachineProfileImport([existing, occupiedCopy], changed)).toMatchObject({
      kind: 'copy',
      profile: { id: `${existing.id}-3`, name: `${existing.name} (3)` }
    });
  });
});
